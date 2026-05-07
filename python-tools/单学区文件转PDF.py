#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
单学区地图PDF生成器
输入一个geojson文件，输出一页带天地图底图的PDF
用法:
    python 单学区文件转PDF.py <输入geojson文件> [输出PDF路径]
"""

import os
import sys
import io
import time
import warnings
warnings.filterwarnings('ignore')

import geopandas as gpd
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image
import numpy as np
import requests

# ==================== 默认配置 ====================
CONFIG = {
    "buffer_meters": 1200,          # 出图视野：向校外扩多少米
    "dpi": 600,
    "font": "Microsoft YaHei",
    "tianditu_keys": [
        "cacc8bb34c1a5799407fb0e21b2695e4",
        "0a80ce2522a6dbd742e9c1c3d87b9964",
    ],
    "base_map_type": "vec",         # vec=矢量底图 | img=影像底图
    "show_annotation": True,
    "tile_cache_dir": "./tdt_cache_c",
    "request_interval": 0.03,
}
# ==================================================

plt.rcParams['font.sans-serif'] = [CONFIG["font"], 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

TD_URLS = {
    "vec": "http://t{s}.tianditu.gov.cn/vec_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "img": "http://t{s}.tianditu.gov.cn/img_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cva": "http://t{s}.tianditu.gov.cn/cva_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
    "cia": "http://t{s}.tianditu.gov.cn/cia_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={k}",
}

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
    cols = c2 - c1 + 1
    rows = r2 - r1 + 1
    base_type = CONFIG["base_map_type"]
    anno_type = "cva" if base_type == "vec" else "cia"
    composite = Image.new("RGBA", (cols * tile_w, rows * tile_w), (255,255,255,255))
    for c in range(c1, c2 + 1):
        for r in range(r1, r2 + 1):
            img = fetch_tile(TD_URLS[base_type], z, c, r, cache_dir, base_type)
            if img:
                composite.paste(img, ((c - c1) * tile_w, (r - r1) * tile_w))
            if CONFIG["show_annotation"]:
                img_anno = fetch_tile(TD_URLS[anno_type], z, c, r, cache_dir, anno_type)
                if img_anno:
                    composite.paste(img_anno, ((c - c1) * tile_w, (r - r1) * tile_w), img_anno)
    t_minx, _, _, t_maxy = get_tile_bounds(c1, r1, z)
    _, t_miny, t_maxx, _ = get_tile_bounds(c2, r2, z)
    return composite, (t_minx, t_miny, t_maxx, t_maxy)

def choose_zoom(width_deg, height_deg, min_px):
    for z in range(19, 13, -1):
        ncols = 2**z
        nrows = 2**(z - 1)
        tile_w_deg = 360.0 / ncols
        tile_h_deg = 180.0 / nrows
        cols = int(width_deg / tile_w_deg) + 3
        rows = int(height_deg / tile_h_deg) + 3
        map_px_w = cols * 256
        map_px_h = rows * 256
        if cols * rows > 512:
            continue
        if map_px_w >= min_px and map_px_h >= min_px:
            return z
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

# ---------- 绘制单页 ----------
def plot_one(gdf, output_pdf, cache_dir):
    # 提取学校名称
    school_name = os.path.splitext(os.path.basename(output_pdf))[0]
    if 'name' in gdf.columns and gdf['name'].notna().any():
        school_name = str(gdf.iloc[0]['name']).strip()
    
    # 缓冲出视野（3857下buffer米数，再转回4326）
    gdf_proj = gdf.to_crs(epsg=3857)
    union_geom = gdf_proj.union_all()
    view_3857 = union_geom.buffer(CONFIG["buffer_meters"])
    view_4326 = gpd.GeoDataFrame(geometry=[view_3857], crs='EPSG:3857').to_crs(epsg=4326).iloc[0].geometry
    minx, miny, maxx, maxy = view_4326.bounds
    w, h = maxx - minx, maxy - miny
    
    # A4横版
    page_w, page_h = 11.69, 8.27
    aspect = w / h if h > 0 else 1
    if aspect > page_w / page_h:
        fig_w, fig_h = page_w, page_w / aspect
    else:
        fig_w, fig_h = page_h * aspect, page_h
    target_px = int(max(fig_w, fig_h) * CONFIG["dpi"])
    
    # 下载底图
    z = choose_zoom(w, h, target_px)
    print(f"    下载底图 z={z} ...", end="", flush=True)
    basemap_img, (t_minx, t_miny, t_maxx, t_maxy) = build_basemap(minx, miny, maxx, maxy, z, cache_dir)
    print(" OK")
    
    # 绘图
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.subplots_adjust(left=0, right=1, bottom=0, top=1)
    
    ax.imshow(np.array(basemap_img), extent=[t_minx, t_maxx, t_miny, t_maxy],
              interpolation='nearest', aspect='equal', zorder=0)
    
    # 绘制所有多边形（同一学校，蓝填充+红边）
    gdf.plot(ax=ax, facecolor='#1f77b4', edgecolor='#d62728',
             linewidth=3.5, alpha=0.32, zorder=5)
    
    # 每个多边形中心标注名称
    for _, row in gdf.iterrows():
        c = row.geometry.centroid
        ax.text(c.x, c.y, school_name, fontsize=10, fontweight='bold',
                ha='center', va='center', color='#d62728', zorder=10,
                bbox=dict(boxstyle='round,pad=0.3', facecolor='yellow',
                         edgecolor='#d62728', alpha=0.95))
    
    # 锁定视野
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.axis('off')
    
    # 图例
    legend_elements = [
        mpatches.Patch(facecolor='#1f77b4', edgecolor='#d62728', linewidth=2.5,
                       label=f'学区范围：{school_name}'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=9,
              framealpha=0.85, edgecolor='#cccccc')
    
    # 保存
    with PdfPages(output_pdf) as pdf:
        pdf.savefig(fig, dpi=CONFIG["dpi"])
    plt.close(fig)
    print(f"  [OK] {school_name} -> {output_pdf}")

# ---------- 主流程 ----------
def main():
    if len(sys.argv) < 2:
        print("用法: python 单学区文件转PDF.py <输入geojson文件> [输出PDF路径]")
        print("示例: python 单学区文件转PDF.py ./data/middle/湘潭市三中.geojson ./output/湘潭市三中.pdf")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_pdf = sys.argv[2] if len(sys.argv) > 2 else "./output.pdf"
    output_pdf = os.path.abspath(output_pdf)
    
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
    
    if not os.path.isfile(input_file):
        print(f"[!] 文件不存在: {input_file}")
        return
    
    print(f"[*] 读取: {input_file}")
    gdf = gpd.read_file(input_file)
    gdf = gdf[gdf.geometry.type.isin(['Polygon','MultiPolygon'])].copy()
    
    if len(gdf) == 0:
        print("[!] 没有有效的Polygon数据")
        return
    
    os.makedirs(CONFIG["tile_cache_dir"], exist_ok=True)
    out_dir = os.path.dirname(output_pdf)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    
    plot_one(gdf, output_pdf, CONFIG["tile_cache_dir"])

if __name__ == '__main__':
    main()
