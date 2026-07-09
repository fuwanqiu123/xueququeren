# -*- coding: utf-8 -*-
"""
参考 index_relative.html / app_relative.js 中的天地图 POI 搜索逻辑，
批量采集湘潭市雨湖区、岳塘区范围内的真实兴趣点，生成含 XQMC/FWWZ/JD/WD 的 Excel。
"""
import os
import json
import time
import random
import urllib.parse
from datetime import datetime

import requests
import pandas as pd
import geopandas as gpd
from shapely.ops import polygonize
from shapely.geometry import MultiPolygon, Point

# ---------------- 配置 ----------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "tmp_data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 天地图浏览器端 Key（来自 config.js）
KEYS = [
    '8a0f9bb6aa0f510af5a5885159e077e6',
    'f14e4bb40aa997803b046bcfbbd7aaa4',
    '8fd8de7a161f3164a6da3f6615ecb386',
    'a7097827e4299ac41d3d50b45da1c193',
    'f0c0b3fbe98a7dcc92661e345f17e8ff',
    'e495b48f1c8eb41d17dd7f8a5bd47c18',
    '98ef794563cdf1d71e1411fd28091b0b',
    '4c2d0fc4e36cfd9d255aa3ca61567c7b',
    '1b9f5b539a57891fa8419423adf9e010',
    '20d9014ee072f032fc7d7fee8da01e21'
]

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    ),
    'Referer': 'http://localhost:8080/',
    'Accept': 'application/json, text/plain, */*'
}

SLEEP_BETWEEN_REQUESTS = 0.15
PAGE_SIZE = 100
TARGET_TOTAL = 1000
TARGET_PER_DISTRICT = 550   # 每个区多采一些，最后各抽 500，保证两区都有
MAX_PER_KEYWORD = 500       # 单个关键词最多抓前多少条


# ---------------- 行政区范围 ----------------
def load_districts():
    """从项目边界文件读取雨湖区、岳塘区的范围，并构建多边形。"""
    boundary_path = os.path.join(BASE_DIR, 'data', 'xiangtan_boundary.geojson')
    gdf = gpd.read_file(boundary_path, encoding='utf-8')
    districts = []
    for _, row in gdf.iterrows():
        did = str(row['id'])
        # 项目 geojson 中的 name 字段编码异常，按行政区划代码写死
        name = '雨湖区' if did == '430302' else ('岳塘区' if did == '430304' else did)
        polys = list(polygonize(row.geometry))
        polygon = MultiPolygon(polys) if len(polys) > 1 else polys[0]
        bounds = polygon.bounds
        districts.append({
            'id': did,
            'name': name,
            'polygon': polygon,
            'mapBound': f"{bounds[0]},{bounds[1]},{bounds[2]},{bounds[3]}"
        })
    return districts


class KeyManager:
    def __init__(self, keys):
        self.keys = keys
        self.idx = 0
        self.usage = {k: 0 for k in keys}
        self.failed = set()

    def current(self):
        return self.keys[self.idx]

    def next(self):
        self.failed.add(self.idx)
        for _ in range(len(self.keys)):
            self.idx = (self.idx + 1) % len(self.keys)
            if self.idx not in self.failed:
                return self.keys[self.idx]
        self.failed.clear()
        self.idx = 0
        return self.keys[0]

    def record(self):
        key = self.current()
        self.usage[key] += 1
        return key


key_mgr = KeyManager(KEYS)


def search_poi(keyword, map_bound, start=0, count=PAGE_SIZE):
    """调用天地图 POI 搜索接口。"""
    post_str = json.dumps({
        'keyWord': keyword,
        'level': 12,
        'mapBound': map_bound,
        'queryType': 1,
        'start': start,
        'count': count
    }, ensure_ascii=False)

    key = key_mgr.record()
    url = (
        f"https://api.tianditu.gov.cn/v2/search"
        f"?postStr={urllib.parse.quote(post_str)}"
        f"&type=query&tk={key}"
    )

    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Key 类型/权限错误时换 Key 重试一次
    if data.get('code') in (301012, 301013):
        key = key_mgr.next()
        url = (
            f"https://api.tianditu.gov.cn/v2/search"
            f"?postStr={urllib.parse.quote(post_str)}"
            f"&type=query&tk={key}"
        )
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()

    return data


def parse_pois(data):
    """解析天地图返回的 POI 列表。"""
    results = []
    for poi in data.get('pois', []):
        lonlat = poi.get('point') or poi.get('lonlat')
        if not lonlat:
            continue
        parts = str(lonlat).split(',')
        if len(parts) != 2:
            continue
        try:
            lon = float(parts[0].strip())
            lat = float(parts[1].strip())
        except ValueError:
            continue
        name = (poi.get('name') or '').strip()
        address = (poi.get('address') or '').strip()
        if not name:
            continue
        results.append({
            'name': name,
            'address': address,
            'lon': lon,
            'lat': lat,
            'hotPointID': poi.get('hotPointID', '')
        })
    return results


def collect_district_pois(district, keywords):
    """为单个行政区采集 POI，返回落在行政区多边形内的去重记录。"""
    unique = {}
    target = TARGET_PER_DISTRICT
    polygon = district['polygon']
    dist_name = district['name']

    print(f"\n开始采集 [{dist_name}]，范围 {district['mapBound']}")

    for kw in keywords:
        start = 0
        while start < MAX_PER_KEYWORD:
            try:
                data = search_poi(kw, district['mapBound'], start=start, count=PAGE_SIZE)
            except Exception as e:
                print(f"  [{kw}] start={start} 请求失败: {e}")
                break

            if data.get('code') not in (None, 0, '0'):
                print(f"  [{kw}] start={start} 接口返回错误: {data.get('msg')}")
                break

            pois = parse_pois(data)
            if not pois:
                break

            for p in pois:
                pid = p['hotPointID'] or f"{p['lon']}_{p['lat']}_{p['name']}"
                if pid in unique:
                    continue
                # 只保留落在行政区边界内的点（避免 bounding box 带来的外围点）
                pt = Point(p['lon'], p['lat'])
                if polygon.contains(pt) or polygon.distance(pt) < 1e-4:
                    p['district'] = dist_name
                    unique[pid] = p

            print(f"  [{kw}] start={start}, 返回 {len(pois)}, 本区累计 {len(unique)}")

            total = data.get('count', 0)
            if start + PAGE_SIZE >= total or len(pois) < PAGE_SIZE:
                break
            start += PAGE_SIZE
            time.sleep(SLEEP_BETWEEN_REQUESTS)

        if len(unique) >= target:
            print(f"  [{dist_name}] 已达到目标数量 {target}，提前结束")
            break

    print(f"[{dist_name}] 最终有效 POI：{len(unique)}")
    return list(unique.values())


def normalize_address(name, address, district_name):
    """把天地图地址整理成较完整的地址描述。"""
    if not address:
        return f"湖南省湘潭市{district_name}{name}"

    addr = address.strip()
    if addr.startswith('湖南省湘潭市'):
        return addr
    if addr.startswith('湘潭市'):
        return '湖南省' + addr
    if addr.startswith(district_name):
        return f"湖南省湘潭市{addr}"
    return f"湖南省湘潭市{district_name}{addr}"


def build_excel(all_records, target=TARGET_TOTAL):
    """生成指定格式的 Excel。"""
    # 按行政区分组，尽量各取一半
    by_district = {}
    for r in all_records:
        by_district.setdefault(r['district'], []).append(r)

    half = target // 2
    sampled = []
    for dist_name, recs in by_district.items():
        n = min(half, len(recs))
        sampled.extend(random.sample(recs, n))

    # 如果总数不够，从剩余记录中补充
    if len(sampled) < target:
        remaining = [r for r in all_records if r not in sampled]
        need = target - len(sampled)
        if remaining:
            sampled.extend(random.sample(remaining, min(need, len(remaining))))

    random.shuffle(sampled)

    rows = []
    for idx, rec in enumerate(sampled[:target], start=1):
        rows.append({
            '序号': idx,
            'id': idx,
            'XQMC': rec['name'],
            'FWWZ': normalize_address(rec['name'], rec['address'], rec['district']),
            'JD': round(float(rec['lon']), 6),
            'WD': round(float(rec['lat']), 6)
        })

    df = pd.DataFrame(rows, columns=['序号', 'id', 'XQMC', 'FWWZ', 'JD', 'WD'])

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    excel_path = os.path.join(OUTPUT_DIR, f"湘潭市兴趣点_{target}条_{timestamp}.xlsx")
    df.to_excel(excel_path, index=False, engine='openpyxl')

    csv_path = os.path.join(OUTPUT_DIR, f"湘潭市兴趣点_{target}条_{timestamp}.csv")
    df.to_csv(csv_path, index=False, encoding='utf-8-sig')

    print(f"\n已生成 Excel：{excel_path}")
    print(f"已生成 CSV：{csv_path}")
    print(df.head(10).to_string(index=False))

    # 统计
    print(f"\n共 {len(df)} 条，JD 范围 {df['JD'].min():.6f} ~ {df['JD'].max():.6f}")
    print(f"WD 范围 {df['WD'].min():.6f} ~ {df['WD'].max():.6f}")
    return excel_path


if __name__ == '__main__':
    districts = load_districts()
    print('读取到行政区：')
    for d in districts:
        print(' ', d['id'], d['name'], d['mapBound'])

    keywords = [
        '小区', '社区', '花园', '广场', '大厦',
        '学校', '中学', '小学', '幼儿园', '医院',
        '银行', '超市', '酒店', '公园', '商场',
        '药店', '菜市场', '便利店', '餐厅', '公交站',
        '写字楼', '公司', '工厂', '加油站', '停车场',
        '政府机关', '派出所', '图书馆', '体育馆', '景点',
        '村', '组', '街道', '居委会', '服务中心'
    ]

    all_records = []
    for district in districts:
        recs = collect_district_pois(district, keywords)
        all_records.extend(recs)

    print(f"\n两区去重后共采集 {len(all_records)} 条有效 POI")
    if len(all_records) < TARGET_TOTAL:
        print(f"警告：仅采集到 {len(all_records)} 条，不足 {TARGET_TOTAL} 条，将输出全部。")

    build_excel(all_records, TARGET_TOTAL)
