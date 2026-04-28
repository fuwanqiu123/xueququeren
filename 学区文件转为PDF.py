#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
湘潭市学区批量确认图（带天地图底图）
每所学校一页A4横版，自动下载天地图瓦片拼底图
"""

import os
import io
import math
import time
import hashlib
import warnings
warnings.filterwarnings('ignore')

import geopandas as gpd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import box
from PIL import Image
import numpy as np
import requests

# ==================== 只改这里 ====================
CONFIG = {
    "input_geojson": "./湘潭市和平小学.geojson",   # 合并后的学区GeoJSON
    "name_field": "name",                       # 学校名称字段
    "output_dir": "./output",       # 每个学校单独输出PDF的目录
    "buffer_meters": 1200,          # 出图视野：向校外扩多少米
    "dpi": 600,
    
    # 字体：Windows用Microsoft YaHei，Mac用PingFang SC或Heiti TC，Linux用DejaVu Sans
    "font": "Microsoft YaHei",
    
    # 天地图配置（必须填服务端Key，支持多Key轮换防限流）
    # 去 https://console.tianditu.gov.cn/api/key 申请，Key类型必须选"服务端"
    "tianditu_keys": [
        "0a80ce2522a6dbd742e9c1c3d87b9964",
        # "你的服务端Key2",
    ],
    "base_map_type": "vec",         # vec=矢量底图（推荐，有道路地名） | img=影像底图
    "show_annotation": True,        # 是否叠加道路/地名注记（强烈推荐打开）
    
    "tile_cache_dir": "./tdt_cache_c",# 瓦片缓存目录（WGS84经纬度投影c，与之前的w投影分开）
    "request_interval": 0.03,       # 下载间隔秒数，防被封
}
# ==================================================

plt.rcParams['font.sans-serif'] = [CONFIG["font"], 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 天地图瓦片模板（WGS84 经纬度投影 / CGCS2000）
TD_URLS = {
    "vec": "http://t{s}.tianditu.gov.cn/vec_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "img": "http://t{s}.tianditu.gov.cn/img_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cva": "http://t{s}.tianditu.gov.cn/cva_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cia": "http://t{s}.tianditu.gov.cn/cia_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
}

# ---------- 瓦片坐标转换（WGS84 经纬度投影） ----------
def get_tile_colrow(lon, lat, z):
    """WGS84经纬度投影瓦片行列号（z=1: 2x1, z=n: 2^n x 2^(n-1)）"""
    ncols = 2**z
    nrows = 2**(z - 1)
    tile_w = 360.0 / ncols
    tile_h = 180.0 / nrows
    col = int((lon + 180.0) / tile_w)
    row = int((90.0 - lat) / tile_h)
    return col, row

def get_tile_bounds(col, row, z):
    """WGS84经纬度投影瓦片地理范围"""
    ncols = 2**z
    nrows = 2**(z - 1)
    tile_w = 360.0 / ncols
    tile_h = 180.0 / nrows
    minx = col * tile_w - 180.0
    maxx = (col + 1) * tile_w - 180.0
    maxy = 90.0 - row * tile_h
    miny = 90.0 - (row + 1) * tile_h
    return minx, miny, maxx, maxy

# ---------- 瓦片下载 ----------
_key_idx = 0
def get_key():
    global _key_idx
    k = CONFIG["tianditu_keys"][_key_idx % len(CONFIG["tianditu_keys"])]
    _key_idx += 1
    return k

def fetch_tile(url_template, z, x, y, cache_dir, tile_type="base"):
    """下载单张瓦片，带本地缓存"""
    cache_file = os.path.join(cache_dir, f"{tile_type}/{z}/{y}/{x}.png")
    if os.path.exists(cache_file):
        return Image.open(cache_file).convert("RGBA")
    
    url = url_template.format(s=(x+y)%8, z=z, x=x, y=y, k=get_key())
    try:
        # 注意：天地图服务端Key要求非浏览器UA，如curl
        r = requests.get(url, timeout=15, headers={"User-Agent":"curl/7.68.0"})
        if r.status_code == 200 and len(r.content) > 100:
            img = Image.open(io.BytesIO(r.content)).convert("RGBA")
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            img.save(cache_file)
            time.sleep(CONFIG["request_interval"])
            return img
    except Exception as e:
        pass
    return None

def build_basemap(minx, miny, maxx, maxy, z, cache_dir):
    """把指定经纬度范围内的瓦片拼成一张大图（WGS84经纬度投影）"""
    c1, r1 = get_tile_colrow(minx, maxy, z)  # 左上
    c2, r2 = get_tile_colrow(maxx, miny, z)  # 右下
    
    tile_w = 256
    cols = c2 - c1 + 1
    rows = r2 - r1 + 1
    
    # 底图类型
    base_type = CONFIG["base_map_type"]
    anno_type = "cva" if base_type == "vec" else "cia"
    
    composite = Image.new("RGBA", (cols * tile_w, rows * tile_w), (255,255,255,255))
    
    for c in range(c1, c2 + 1):
        for r in range(r1, r2 + 1):
            # 底图瓦片
            img = fetch_tile(TD_URLS[base_type], z, c, r, cache_dir, base_type)
            if img:
                composite.paste(img, ((c - c1) * tile_w, (r - r1) * tile_w))
            # 注记瓦片
            if CONFIG["show_annotation"]:
                img_anno = fetch_tile(TD_URLS[anno_type], z, c, r, cache_dir, anno_type)
                if img_anno:
                    composite.paste(img_anno, ((c - c1) * tile_w, (r - r1) * tile_w), img_anno)
    
    # 计算瓦片拼图的地理范围（取左上角瓦片的左/上边界，右下角瓦片的右/下边界）
    t_minx, _, _, t_maxy = get_tile_bounds(c1, r1, z)
    _, t_miny, t_maxx, _ = get_tile_bounds(c2, r2, z)
    
    return composite, (t_minx, t_miny, t_maxx, t_maxy)

def choose_zoom(width_deg, height_deg, min_px):
    """Auto choose zoom level so that the stitched basemap has enough resolution.

    min_px : int
        Minimum required pixel size for the longer side of the basemap image.
        Should be derived from figsize × dpi so the raster text is not upscaled.
    """
    for z in range(19, 13, -1):          # try higher zoom first (19 → 14)
        ncols = 2**z
        nrows = 2**(z - 1)
        tile_w_deg = 360.0 / ncols
        tile_h_deg = 180.0 / nrows

        cols = int(width_deg / tile_w_deg) + 3
        rows = int(height_deg / tile_h_deg) + 3
        map_px_w = cols * 256
        map_px_h = rows * 256

        # hard cap: avoid OOM (512 tiles ≈ 8k×8k image, still fine on modern PCs)
        if cols * rows > 512:
            continue

        # pick the zoom where the basemap is at least as large as the canvas
        if map_px_w >= min_px and map_px_h >= min_px:
            return z

    # fallback: return the highest zoom that does not exceed tile cap
    for z in range(19, 13, -1):
        ncols = 2**z
        nrows = 2**(z - 1)
        tile_w_deg = 360.0 / ncols
        tile_h_deg = 180.0 / nrows
        cols = int(width_deg / tile_w_deg) + 3
        rows = int(height_deg / tile_h_deg) + 3
        if cols * rows <= 512:
            return z
    return 14

# ---------- 重叠检测 ----------
def detect_overlaps(gdf):
    overlaps = []
    gdf_proj = gdf.to_crs(epsg=3857)
    for i in range(len(gdf_proj)):
        for j in range(i+1, len(gdf_proj)):
            inter = gdf_proj.iloc[i].geometry.intersection(gdf_proj.iloc[j].geometry)
            if not inter.is_empty and inter.area > 0.5:
                overlaps.append({
                    'a': gdf.iloc[i][CONFIG["name_field"]],
                    'b': gdf.iloc[j][CONFIG["name_field"]],
                    'geom': gpd.GeoSeries([inter], crs='EPSG:3857').to_crs(epsg=4326).iloc[0],
                    'area': inter.area
                })
    return overlaps

# ---------- 单页出图 ----------
def plot_one(school_row, all_gdf, overlaps, output_dir, cache_dir):
    name = school_row[CONFIG["name_field"]]
    sid = school_row.name
    
    # 缓冲出视野：先在3857下按米buffer，再转回4326（WGS84经纬度）
    school_geom_3857 = gpd.GeoDataFrame([school_row], crs='EPSG:4326').to_crs(epsg=3857).iloc[0].geometry
    view_3857 = school_geom_3857.buffer(CONFIG["buffer_meters"])
    view_4326 = gpd.GeoDataFrame(geometry=[view_3857], crs='EPSG:3857').to_crs(epsg=4326).iloc[0].geometry
    minx, miny, maxx, maxy = view_4326.bounds
    w, h = maxx - minx, maxy - miny
    
    # 先按A4页面算出 figsize，再反推底图需要的分辨率
    page_w, page_h = 11.69, 8.27
    aspect = w / h if h > 0 else 1
    if aspect > page_w / page_h:
        fig_w, fig_h = page_w, page_w / aspect
    else:
        fig_w, fig_h = page_h * aspect, page_h

    # 底图长边至少要有画布长边×dpi 的像素，这样文字不会被强行放大
    target_px = int(max(fig_w, fig_h) * CONFIG["dpi"])

    # 自动选zoom并下载底图（传入经纬度范围）
    z = choose_zoom(w, h, target_px)
    print(f"    下载底图 z={z} ...", end="", flush=True)
    basemap_img, (t_minx, t_miny, t_maxx, t_maxy) = build_basemap(minx, miny, maxx, maxy, z, cache_dir)
    print(" OK")
    
    # 开始画图：figsize按底图宽高比匹配A4页面，最大化利用空间
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)
    
    # 先画底图（extent对齐经纬度坐标，nearest保持像素锐利）
    ax.imshow(np.array(basemap_img), extent=[t_minx, t_maxx, t_miny, t_maxy], 
              interpolation='nearest', aspect='equal', zorder=0)
    
    # 筛选视野内的学校（直接在4326下）
    nearby = all_gdf[all_gdf.geometry.intersects(box(minx, miny, maxx, maxy))].copy()
    neighbors = nearby[nearby.index != sid]
    itself = nearby[nearby.index == sid]
    
    # 画邻校：浅灰虚线
    if len(neighbors):
        neighbors.plot(ax=ax, facecolor='none', edgecolor='#888888', 
                       linewidth=1.2, linestyle='--', alpha=0.9, zorder=2)
        for _, r in neighbors.iterrows():
            c = r.geometry.centroid
            ax.text(c.x, c.y, r[CONFIG["name_field"]], fontsize=8, ha='center', va='center',
                    color='#555555', alpha=0.85, zorder=3,
                    bbox=dict(boxstyle='round,pad=0.2', facecolor='white', edgecolor='none', alpha=0.6))
    
    # 画本校：蓝填充 + 红粗边 + 黄底黑字
    itself.plot(ax=ax, facecolor='#1f77b4', edgecolor='#d62728', 
                linewidth=3.5, alpha=0.32, zorder=5)
    c = itself.iloc[0].geometry.centroid
    ax.text(c.x, c.y, name, fontsize=10, fontweight='bold', ha='center', va='center',
            color='#d62728', zorder=10,
            bbox=dict(boxstyle='round,pad=0.3', facecolor='yellow', edgecolor='#d62728', alpha=0.95))
    
    # 画重叠区（只画和本校有关的，geom已在4326）
    ov_count = 0
    for ov in overlaps:
        if ov['a'] == name or ov['b'] == name:
            gpd.GeoDataFrame(geometry=[ov['geom']], crs='EPSG:4326').plot(
                ax=ax, facecolor='red', edgecolor='darkred', hatch='///', alpha=0.35, zorder=4)
            ov_count += 1
    
    # 锁定视野（经纬度范围）
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.axis('off')
    
    # 重叠提示（简洁，放在角落）
    if ov_count:
        fig.text(0.02, 0.98, f'检测到 {ov_count} 处重叠区域',
                 ha='left', va='top', fontsize=10, color='darkred',
                 bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='darkred', alpha=0.9))
    
    # 图例（半透明，不遮挡地图）
    legend_elements = [
        mpatches.Patch(facecolor='#1f77b4', edgecolor='#d62728', linewidth=2.5, label=f'本校学区：{name}'),
        mpatches.Patch(facecolor='none', edgecolor='#888888', linestyle='--', linewidth=1.2, label='相邻学区边界'),
    ]
    if ov_count:
        legend_elements.append(mpatches.Patch(facecolor='red', hatch='///', edgecolor='darkred', label='重叠区域'))
    ax.legend(handles=legend_elements, loc='upper left', fontsize=9, framealpha=0.85, edgecolor='#cccccc')
    
    # 输出：按figsize直接保存，避免bbox_inches='tight'导致二次缩放模糊
    safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '-', '_')).strip()
    pdf_path = os.path.join(output_dir, f"{safe_name}.pdf")
    with PdfPages(pdf_path) as pdf:
        pdf.savefig(fig, dpi=CONFIG["dpi"])
    plt.close(fig)
    print(f"  [OK] {name} -> {pdf_path}（邻校{len(neighbors)}所{'，重叠'+str(ov_count)+'处' if ov_count else ''}）")

# ---------- 主流程 ----------
def main():
    if not CONFIG["tianditu_keys"] or "你的Key" in CONFIG["tianditu_keys"][0]:
        print("错误：请先在 CONFIG['tianditu_keys'] 里填入你的天地图服务端Key！")
        print("      申请地址：https://console.tianditu.gov.cn/api/key")
        print("      注意：Key类型必须选'服务端'，浏览器端Key无法用于WMTS瓦片下载。")
        return
    
    # 检测Key是否有效（注意：天地图服务端Key要求非浏览器UA）
    test_url = f"http://t0.tianditu.gov.cn/vec_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX=10&TILEROW=176&TILECOL=833&tk={CONFIG['tianditu_keys'][0]}"
    try:
        r = requests.get(test_url, timeout=10, headers={"User-Agent":"curl/7.68.0"})
        key_valid = r.status_code == 200 and len(r.content) > 100
    except Exception:
        key_valid = False
    
    if not key_valid:
        print("[!] 警告：天地图Key无法下载瓦片（请检查Key是否有效或配额已用完）")
        print("[!] 申请地址：https://console.tianditu.gov.cn/api/key")
        print("[!] 注意：Key类型必须选'服务端'，且应用管理中需勾选'瓦片服务'")
        return
    
    print(f"[*] 读取 {CONFIG['input_geojson']}")
    gdf = gpd.read_file(CONFIG["input_geojson"])
    gdf = gdf[gdf.geometry.type.isin(['Polygon','MultiPolygon'])].reset_index(drop=True)
    
    if CONFIG["name_field"] not in gdf.columns:
        print(f"错误：找不到字段 '{CONFIG['name_field']}'，可用字段：{list(gdf.columns)}")
        return
    
    os.makedirs(CONFIG["tile_cache_dir"], exist_ok=True)
    
    print(f"[*] 共 {len(gdf)} 个学区，检测重叠中...")
    overlaps = detect_overlaps(gdf)
    print(f"[!] 发现 {len(overlaps)} 组重叠" if overlaps else "[OK] 无重叠")
    
    print(f"[*] 开始出图，输出目录：{CONFIG['output_dir']}")
    print(f"[*] 瓦片缓存目录：{os.path.abspath(CONFIG['tile_cache_dir'])}")
    os.makedirs(CONFIG["output_dir"], exist_ok=True)
    
    for _, row in gdf.iterrows():
        plot_one(row, gdf, overlaps, CONFIG["output_dir"], CONFIG["tile_cache_dir"])
    
    print(f"[OK] 完成，共生成 {len(gdf)} 个PDF文件")

if __name__ == '__main__':
    main()