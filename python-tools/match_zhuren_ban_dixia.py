#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
507 简易房台账地址匹配工具

功能：
1. 读取 Excel 中的【台账_项目名称_xmmc】字段作为地址；
2. 与 PostgreSQL 中【北京市400万房屋底账】表的【adress】字段进行匹配；
3. 输出匹配结果：完全匹配 / 基本匹配（高置信）/ 未匹配。

使用：
    python python-tools/match_507_jianyifang.py
"""

import os
import re
import time
from datetime import datetime

import pandas as pd
import psycopg

# ============================================
# 路径配置
# ============================================
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_FILE = os.path.join(
    PROJECT_ROOT,
    "tmp_data",
    "住人半3005原始.xlsx",
)
OUTPUT_FILE = os.path.join(
    PROJECT_ROOT,
    "tmp_data",
    "住人半地下室匹配结果.xlsx",
)

# Excel 中存储地址的字段名
ADDRESS_FIELD = "建筑地址"

# ============================================
# 数据库配置（与 server.py 保持一致）
# ============================================
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DB_PORT", "5432")),
    "dbname": os.environ.get("DB_NAME", "postgres"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", "135086"),
}
TABLE_NAME = "北京市400万房屋底账"

# 基本匹配（模糊匹配）的相似度阈值
# 0.8 表示非常高的置信度，只有数据库中地址与输入地址高度相似时才认为匹配成功。
SIMILARITY_THRESHOLD = 0.8


# 北京市行政区前缀（长的放前面，优先匹配）
BEIJING_DISTRICT_PREFIXES = [
    "北京市东城区", "北京市西城区", "北京市朝阳区", "北京市丰台区",
    "北京市石景山区", "北京市海淀区", "北京市门头沟区", "北京市房山区",
    "北京市通州区", "北京市顺义区", "北京市昌平区", "北京市大兴区",
    "北京市怀柔区", "北京市平谷区", "北京市密云区", "北京市延庆区",
    "东城区", "西城区", "朝阳区", "丰台区", "石景山区", "海淀区",
    "门头沟区", "房山区", "通州区", "顺义区", "昌平区", "大兴区",
    "怀柔区", "平谷区", "密云区", "延庆区", "北京市",
]


def remove_district_prefix(address):
    """
    去掉地址开头的行政区名称，如"北京市通州区XX" → "通州区XX" 或 "XX"。
    注意：只匹配完整的行政区名，避免误删小区名（如"东城根小区"不会被删）。
    """
    for prefix in BEIJING_DISTRICT_PREFIXES:
        if address.startswith(prefix):
            remainder = address[len(prefix):].lstrip()
            return remainder if remainder else address
    return address


def normalize_address(address):
    """
    地址标准化预处理。
    1. 去掉开头行政区名称；
    2. 把 "数字楼/栋" 统一补成 "数字号楼"（避免 Excel 写 "21楼/21栋"、数据库写 "21号楼" 导致失配）。
    """
    if not address:
        return address
    addr = str(address).strip()
    addr = remove_district_prefix(addr)
    # 将 "X楼"、"X栋" 补为 "X号楼"；正则保证 "X号楼" 不会被重复处理。
    addr = re.sub(r"(\d+)楼", r"\1号楼", addr)
    addr = re.sub(r"(\d+)栋", r"\1号楼", addr)
    return addr


def get_db_connection():
    """获取数据库连接"""
    return psycopg.connect(
        host=DB_CONFIG["host"],
        port=DB_CONFIG["port"],
        dbname=DB_CONFIG["dbname"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        connect_timeout=10,
    )


def ensure_pg_trgm(conn):
    """确保 pg_trgm 扩展已启用"""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
        conn.commit()


def exact_match(conn, address):
    """
    完全匹配：adress 字段与输入地址字符串完全相等。
    返回 (matched_row_dict, similarity) 或 (None, 0)
    """
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT * FROM "{TABLE_NAME}" WHERE adress = %s LIMIT 1;',
            (address,),
        )
        row = cur.fetchone()
        if row:
            attrs = {d.name: row[i] for i, d in enumerate(cur.description)}
            return attrs, 1.0
    return None, 0.0


def fuzzy_match(conn, address):
    """
    模糊匹配：使用 pg_trgm 的 similarity 与 %% 运算符。
    返回相似度最高的一条记录 (attrs, similarity) 或 (None, 0)。
    """
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT *, similarity(adress, %s) AS sim '
            f'FROM "{TABLE_NAME}" '
            f'WHERE adress %% %s '
            f'ORDER BY sim DESC LIMIT 1;',
            (address, address),
        )
        row = cur.fetchone()
        if row:
            attrs = {
                d.name: row[i]
                for i, d in enumerate(cur.description)
                if d.name != "sim"
            }
            sim = float(row[-1])
            return attrs, sim
    return None, 0.0


def contains_match(conn, address):
    """
    包含匹配：数据库地址包含输入地址（如输入"箭厂胡同4号楼"，
    数据库有"东城区箭厂胡同4号楼"）。
    返回 (attrs, similarity) 或 (None, 0)。
    """
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT *, similarity(adress, %s) AS sim '
            f'FROM "{TABLE_NAME}" '
            f'WHERE adress LIKE %s '
            f'ORDER BY length(adress) ASC, similarity(adress, %s) DESC '
            f'LIMIT 1;',
            (address, f"%{address}%", address),
        )
        row = cur.fetchone()
        if row:
            attrs = {
                d.name: row[i]
                for i, d in enumerate(cur.description)
                if d.name != "sim"
            }
            sim = float(row[-1])
            return attrs, sim
    return None, 0.0


def match_address(conn, address, cache):
    """
    对单个地址进行匹配，优先使用缓存。
    返回结果字典。
    """
    if not address or not str(address).strip():
        return {
            "match_status": "地址为空",
            "matched_adress": None,
            "pfhouseid": None,
            "similarity": 0.0,
            "db_qxname": None,
            "db_jdname": None,
            "db_ldname": None,
        }

    addr_key = str(address).strip()
    normalized_key = normalize_address(addr_key)
    cache_key = normalized_key  # 用标准化后的地址做缓存键
    if cache_key in cache:
        return cache[cache_key]

    # 1. 先尝试完全匹配
    attrs, sim = exact_match(conn, normalized_key)
    match_type = "exact"

    # 2. 没有完全匹配则尝试高阈值模糊匹配
    if attrs is None:
        attrs, sim = fuzzy_match(conn, normalized_key)
        match_type = "fuzzy"

    # 3. 模糊匹配也没命中或低于阈值，尝试包含匹配
    #    例如输入"箭厂胡同4号楼"，数据库有"东城区箭厂胡同4号楼"
    if attrs is None or sim < SIMILARITY_THRESHOLD:
        contains_attrs, contains_sim = contains_match(conn, normalized_key)
        if contains_attrs is not None:
            attrs, sim = contains_attrs, contains_sim
            match_type = "contains"

    if attrs is None:
        # 三种方式都没有命中：真正未匹配
        result = {
            "match_status": "未匹配",
            "matched_adress": None,
            "pfhouseid": None,
            "similarity": 0.0,
            "db_qxname": None,
            "db_jdname": None,
            "db_ldname": None,
        }
    elif match_type == "contains":
        result = {
            "match_status": "包含匹配",
            "matched_adress": attrs.get("adress"),
            "pfhouseid": attrs.get("pfhouseid"),
            "similarity": sim,
            "db_qxname": attrs.get("qxname"),
            "db_jdname": attrs.get("jdname"),
            "db_ldname": attrs.get("ldname"),
        }
    elif sim >= 1.0:
        result = {
            "match_status": "完全匹配",
            "matched_adress": attrs.get("adress"),
            "pfhouseid": attrs.get("pfhouseid"),
            "similarity": sim,
            "db_qxname": attrs.get("qxname"),
            "db_jdname": attrs.get("jdname"),
            "db_ldname": attrs.get("ldname"),
        }
    elif sim >= SIMILARITY_THRESHOLD:
        result = {
            "match_status": "基本匹配",
            "matched_adress": attrs.get("adress"),
            "pfhouseid": attrs.get("pfhouseid"),
            "similarity": sim,
            "db_qxname": attrs.get("qxname"),
            "db_jdname": attrs.get("jdname"),
            "db_ldname": attrs.get("ldname"),
        }
    else:
        # 有命中但相似度低于阈值且不属于包含匹配：视为未匹配，不强行匹配
        result = {
            "match_status": "未匹配",
            "matched_adress": None,
            "pfhouseid": None,
            "similarity": sim,
            "db_qxname": None,
            "db_jdname": None,
            "db_ldname": None,
        }
    cache[cache_key] = result
    return result


def main():
    print(f"[{datetime.now().isoformat()}] 开始读取 Excel: {INPUT_FILE}")
    if not os.path.exists(INPUT_FILE):
        raise FileNotFoundError(f"输入文件不存在: {INPUT_FILE}")

    df = pd.read_excel(INPUT_FILE)
    total = len(df)
    print(f"[{datetime.now().isoformat()}] 共读取 {total} 条台账记录")

    if ADDRESS_FIELD not in df.columns:
        raise ValueError(f"Excel 中缺少字段: {ADDRESS_FIELD}，实际列名为: {list(df.columns)}")

    print(f"[{datetime.now().isoformat()}] 正在连接数据库 {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['dbname']} ...")
    with get_db_connection() as conn:
        ensure_pg_trgm(conn)
        print(f"[{datetime.now().isoformat()}] 数据库连接成功，开始逐条匹配（阈值 {SIMILARITY_THRESHOLD}）...")

        cache = {}
        results = []
        start_time = time.time()

        for idx, row in df.iterrows():
            address = row[ADDRESS_FIELD]
            match_result = match_address(conn, address, cache)
            results.append(match_result)

            if (idx + 1) % 50 == 0 or (idx + 1) == total:
                elapsed = time.time() - start_time
                print(
                    f"[{datetime.now().isoformat()}] 已处理 {idx + 1}/{total}，"
                    f"耗时 {elapsed:.1f}s，缓存命中 {len(cache)} 个唯一地址"
                )

    # 合并匹配结果到 DataFrame
    result_df = pd.DataFrame(results)
    output_df = pd.concat([df.reset_index(drop=True), result_df], axis=1)

    # 统计
    status_counts = output_df["match_status"].value_counts().to_dict()
    print(f"\n[{datetime.now().isoformat()}] 匹配完成，统计如下:")
    for status, count in status_counts.items():
        print(f"  - {status}: {count} 条")

    # 按匹配状态分类输出到同一个 Excel 的不同 Sheet
    # 如果默认输出文件被占用（例如 Excel 正在打开），则写入带时间戳的备用文件
    actual_output_file = OUTPUT_FILE
    try:
        with pd.ExcelWriter(actual_output_file, engine="openpyxl") as writer:
            output_df.to_excel(writer, sheet_name="全部结果", index=False)
            for status in ["完全匹配", "包含匹配", "基本匹配", "未匹配", "地址为空"]:
                if status in status_counts:
                    sub_df = output_df[output_df["match_status"] == status]
                    sheet_name = status.replace("匹配", "")
                    sub_df.to_excel(writer, sheet_name=sheet_name, index=False)
    except PermissionError:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        actual_output_file = OUTPUT_FILE.replace(".xlsx", f"_{ts}.xlsx")
        print(f"\n[{datetime.now().isoformat()}] 警告: 默认输出文件被占用，将保存到备用路径")
        with pd.ExcelWriter(actual_output_file, engine="openpyxl") as writer:
            output_df.to_excel(writer, sheet_name="全部结果", index=False)
            for status in ["完全匹配", "包含匹配", "基本匹配", "未匹配", "地址为空"]:
                if status in status_counts:
                    sub_df = output_df[output_df["match_status"] == status]
                    sheet_name = status.replace("匹配", "")
                    sub_df.to_excel(writer, sheet_name=sheet_name, index=False)

    print(f"\n[{datetime.now().isoformat()}] 结果已保存到: {actual_output_file}")


if __name__ == "__main__":
    main()
