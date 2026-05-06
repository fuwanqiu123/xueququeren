#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
学区总览图PDF生成器
遍历文件夹中所有geojson文件，将所有学区范围绘制到一张大图并导出为PDF
用法:
    python 学区总览图生成PDF.py <输入文件夹路径> [-o 输出PDF路径]
"""

import os
import sys
import io
import time
import warnings
warnings.filterwarnings('ignore')

import geopandas as gpd
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.backends.backend_pdf import PdfPages
from shapely.geometry import box
from PIL import Image
import numpy as np
import requests

# ==================== 默认配置 ====================
CONFIG = {
    # 出图视野：向所有范围外扩多少米
    "buffer_meters": 1500,
    "dpi": 300,
    
    # 字体：Windows用Microsoft YaHei，Mac用PingFang SC，Linux用DejaVu Sans
    "font": "Microsoft YaHei",
    
    # 天地图服务端Key（支持多Key轮换）
    # 申请 https://console.tianditu.gov.cn/api/key，类型必须选"服务端"
    "tianditu_keys": [
        "cacc8bb34c1a5799407fb0e21b2695e4",
        "0a80ce2522a6dbd742e9c1c3d87b9964",
    ],
    "base_map_type": "vec",         # vec=矢量底图 | img=影像底图
    "show_annotation": True,        # 是否叠加道路/地名注记
    
    "tile_cache_dir": "./tdt_cache_c",
    "request_interval": 0.03,
}
# ==================================================

plt.rcParams['font.sans-serif'] = [CONFIG["font"], 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 天地图瓦片模板（WGS84 经纬度投影）
TD_URLS = {
    "vec": "http://t{s}.tianditu.gov.cn/vec_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "img": "http://t{s}.tianditu.gov.cn/img_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cva": "http://t{s}.tianditu.gov.cn/cva_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cia": "http://t{s}.tianditu.gov.cn/cia_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
}

# 高对比度配色（12色轮）
DISTRICT_COLORS = [
    '#E74C3C', '#E67E22', '#F1C40F', '#A3CB38',
    '#2ECC71', '#1ABC9C', '#00CED1', '#3498DB',
    '#6C5CE7', '#9B59B6', '#E84393', '#FD79A8'
]

# ---------- 瓦片坐标转换 ----------
def get_tile_colrow(lon, lat, z):
    ncols = 2**z
    nrows = 2**(z - 1)
    tile_w = 360.0 / ncols
    tile_h = 180.0 / nrows
    col = int((lon + 180.0) / tile_w)
    row = int((90.0 - lat) / tile_h)
    return col, row

def get_tile_bounds(col, row, z):
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
    keys = CONFIG["tianditu_keys"]
    k = keys[_key_idx % len(keys)]
    _key_idx += 1
    return k

def fetch_tile(url_template, z, x, y, cache_dir, tile_type="base"):
    cache_file = os.path.join(cache_dir, f"{tile_type}/{z}/{y}/{x}.png")
    if os.path.exists(cache_file):
        return Image.open(cache_file).convert("RGBA")
    url = url_template.format(s=(x+y)%8, z=z, x=x, y=y, k=get_key())
    try:
        r = requests.get(url, timeout=15, headers={"User-Agent":"curl/7.68.0"})
        if r.status_code == 200 and len(r.content) > 100:
            img = Image.open(io.BytesIO(r.content)).convert("RGBA")
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            img.save(cache_file)
            time.sleep(CONFIG["request_interval"])
            return img
    except Exception:
        pass
    return None

def build_basemap(minx, miny, maxx, maxy, z, cache_dir):
    c1, r1 = get_tile_colrow(minx, maxy, z)
    c2, r2 = get_tile_colrow(maxx, miny, z)
    tile_w = 256
    base_type = CONFIG["base_map_type"]
    anno_type = "cva" if base_type == "vec" else "cia"
    composite = Image.new("RGBA", ((c2-c1+1)*tile_w, (r2-r1+1)*tile_w), (255,255,255,255))
    for c in range(c1, c2+1):
        for r in range(r1, r2+1):
            img = fetch_tile(TD_URLS[base_type], z, c, r, cache_dir, base_type)
            if img:
                composite.paste(img, ((c-c1)*tile_w, (r-r1)*tile_w))
            if CONFIG["show_annotation"]:
                img_anno = fetch_tile(TD_URLS[anno_type], z, c, r, cache_dir, anno_type)
                if img_anno:
                    composite.paste(img_anno, ((c-c1)*tile_w, (r-r1)*tile_w), img_anno)
    t_minx, _, _, t_maxy = get_tile_bounds(c1, r1, z)
    _, t_miny, t_maxx, _ = get_tile_bounds(c2, r2, z)
    return composite, (t_minx, t_miny, t_maxx, t_maxy)

def choose_zoom(width_deg, height_deg, min_px):
    for z in range(19, 13, -1):
        ncols, nrows = 2**z, 2**(z-1)
        tile_w_deg, tile_h_deg = 360.0/ncols, 180.0/nrows
        cols = int(width_deg/tile_w_deg) + 3
        rows = int(height_deg/tile_h_deg) + 3
        if cols*rows > 512:
            continue
        if cols*256 >= min_px and rows*256 >= min_px:
            return z
    for z in range(19, 13, -1):
        ncols, nrows = 2**z, 2**(z-1)
        cols = int(width_deg/(360.0/ncols)) + 3
        rows = int(height_deg/(180.0/nrows)) + 3
        if cols*rows <= 512:
            return z
    return 14

# ---------- 读取geojson ----------
def load_geojson_files(folder_path):
    files = [os.path.join(folder_path, f) for f in sorted(os.listdir(folder_path)) if f.lower().endswith('.geojson')]
    if not files:
        print(f"[!] 文件夹中没有 .geojson 文件: {folder_path}")
        return None
    print(f"[*] 找到 {len(files)} 个 geojson 文件")
    all_gdfs = []
    for fp in files:
        try:
            gdf = gpd.read_file(fp)
            gdf = gdf[gdf.geometry.type.isin(['Polygon','MultiPolygon'])].copy()
            if len(gdf) == 0:
                continue
            if 'name' not in gdf.columns:
                gdf['name'] = os.path.splitext(os.path.basename(fp))[0]
            all_gdfs.append(gdf)
        except Exception as e:
            print(f"  [!] 读取失败: {os.path.basename(fp)} - {e}")
    if not all_gdfs:
        return None
    return gpd.GeoDataFrame(pd.concat(all_gdfs, ignore_index=True), crs='EPSG:4326')

# ---------- 重叠检测 ----------
def detect_overlaps(gdf):
    overlaps = []
    gdf_proj = gdf.to_crs(epsg=3857)
    for i in range(len(gdf_proj)):
        for j in range(i+1, len(gdf_proj)):
            inter = gdf_proj.iloc[i].geometry.intersection(gdf_proj.iloc[j].geometry)
            if not inter.is_empty and inter.area > 0.5:
                overlaps.append({
                    'a': gdf.iloc[i]['name'], 'b': gdf.iloc[j]['name'],
                    'geom': gpd.GeoSeries([inter], crs='EPSG:3857').to_crs(epsg=4326).iloc[0],
                    'area': inter.area
                })
    return overlaps

# ---------- 绘制总览图 ----------
def plot_overview(all_gdf, overlaps, output_pdf, cache_dir):
    # 计算总bounds + buffer
    all_proj = all_gdf.to_crs(epsg=3857)
    total_geom = box(*all_proj.total_bounds)
    buffered = total_geom.buffer(CONFIG["buffer_meters"])
    buffered_4326 = gpd.GeoDataFrame(geometry=[buffered], crs='EPSG:3857').to_crs(epsg=4326).iloc[0].geometry
    minx, miny, maxx, maxy = buffered_4326.bounds
    w, h = maxx - minx, maxy - miny
    print(f"[*] 总览范围: ({minx:.4f},{miny:.4f}) ~ ({maxx:.4f},{maxy:.4f})")
    
    # A3横版
    page_w, page_h = 16.54, 11.69
    aspect = w / h if h > 0 else 1
    if aspect > page_w / page_h:
        fig_w, fig_h = page_w, page_w / aspect
    else:
        fig_w, fig_h = page_h * aspect, page_h
    target_px = int(max(fig_w, fig_h) * CONFIG["dpi"])
    
    z = choose_zoom(w, h, target_px)
    print(f"[*] 下载底图 z={z} ...", end="", flush=True)
    basemap_img, (t_minx, t_miny, t_maxx, t_maxy) = build_basemap(minx, miny, maxx, maxy, z, cache_dir)
    print(" OK")
    
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)
    ax.imshow(np.array(basemap_img), extent=[t_minx, t_maxx, t_miny, t_maxy],
              interpolation='nearest', aspect='equal', zorder=0)
    
    # 颜色分配
    unique_names = sorted(all_gdf['name'].unique())
    color_map = {name: DISTRICT_COLORS[i % len(DISTRICT_COLORS)] for i, name in enumerate(unique_names)}
    
    # 画重叠区
    if overlaps:
        for ov in overlaps:
            gpd.GeoDataFrame(geometry=[ov['geom']], crs='EPSG:4326').plot(
                ax=ax, facecolor='none', edgecolor='darkred', hatch='///', linewidth=1.5, zorder=3)
    
    # 画各学校范围
    for name, color in color_map.items():
        school_gdf = all_gdf[all_gdf['name'] == name].copy()
        school_gdf.plot(ax=ax, facecolor=color, edgecolor='#333333',
                        linewidth=0.8, alpha=0.5, zorder=4)
    
    # 每个多边形上都标注学校名称
    for _, row in all_gdf.iterrows():
        name = row['name']
        c = row.geometry.centroid
        ax.text(c.x, c.y, name, fontsize=6.5, ha='center', va='center',
                color='#222222', fontweight='bold', zorder=10,
                bbox=dict(boxstyle='round,pad=0.2', facecolor='white',
                         edgecolor='#888888', alpha=0.8, linewidth=0.5))
    
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.axis('off')
    
    # 图例（仅显示学校颜色）
    legend_elements = [mpatches.Patch(facecolor=color_map[n], edgecolor='#333333',
                                       alpha=0.7, linewidth=0.8, label=n)
                       for n in sorted(color_map.keys())]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=6.5,
              framealpha=0.92, edgecolor='#cccccc', ncol=3)
    
    fig.suptitle('学区范围总览图', fontsize=14, fontweight='bold', y=0.98, color='#333333')
    
    with PdfPages(output_pdf) as pdf:
        pdf.savefig(fig, dpi=CONFIG["dpi"])
    plt.close(fig)
    print(f"[OK] 总览图已保存: {output_pdf}")
    print(f"    共 {len(color_map)} 所学校，{len(overlaps)} 处重叠")

# ---------- 主流程 ----------
def main():
    if len(sys.argv) < 2:
        print("用法: python 学区总览图生成PDF.py <输入文件夹路径> [输出PDF路径]")
        print("示例: python 学区总览图生成PDF.py ./data/middle/雨湖初中 ./雨湖初中总览.pdf")
        sys.exit(1)
    
    input_folder = sys.argv[1]
    output_pdf = sys.argv[2] if len(sys.argv) > 2 else "./overview.pdf"
    output_pdf = os.path.abspath(output_pdf)
    
    # 如果用户指定的是目录而非文件，自动在该目录下生成 overview.pdf
    if os.path.isdir(output_pdf):
        output_pdf = os.path.join(output_pdf, "overview.pdf")
    
    print(f"[*] 输出文件: {output_pdf}")
    
    if not CONFIG["tianditu_keys"] or "你的Key" in str(CONFIG["tianditu_keys"]):
        print("[!] 请在 CONFIG['tianditu_keys'] 中填入天地图服务端Key")
        return
    
    test_url = f"http://t0.tianditu.gov.cn/vec_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX=10&TILEROW=176&TILECOL=833&tk={CONFIG['tianditu_keys'][0]}"
    try:
        r = requests.get(test_url, timeout=10, headers={"User-Agent":"curl/7.68.0"})
        key_valid = r.status_code == 200 and len(r.content) > 100
    except Exception:
        key_valid = False
    if not key_valid:
        print("[!] 天地图Key无效，请检查")
        return
    
    if not os.path.isdir(input_folder):
        print(f"[!] 文件夹不存在: {input_folder}")
        return
    
    import pandas as pd
    
    print(f"[*] 读取文件夹: {input_folder}")
    all_gdf = load_geojson_files(input_folder)
    if all_gdf is None:
        return
    
    print(f"[*] 检测重叠...")
    overlaps = detect_overlaps(all_gdf)
    print(f"[!] 发现 {len(overlaps)} 组重叠" if overlaps else "[OK] 无重叠")
    
    os.makedirs(CONFIG["tile_cache_dir"], exist_ok=True)
    out_dir = os.path.dirname(output_pdf)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    
    plot_overview(all_gdf, overlaps, output_pdf, CONFIG["tile_cache_dir"])

if __name__ == '__main__':
    main()
