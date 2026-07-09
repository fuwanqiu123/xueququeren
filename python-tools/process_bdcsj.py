# -*- coding: utf-8 -*-
"""
处理 tmp_data/bdc/bdcsj.shp：
1. 将中文字段/属性值统一转为 UTF-8 编码，避免在 ArcGIS Pro 中乱码。
2. 新增字段 BDCDYH，为每条记录生成一个虚拟不动产单元号。
"""
import os
import random
import geopandas as gpd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE_DIR, "tmp_data", "bdc", "bdcsj.shp")
BAK_DIR = os.path.join(BASE_DIR, "tmp_data", "bdc")

# 先备份原始文件（如果不存在）
for ext in ("shp", "shx", "dbf", "prj", "cpg", "cst"):
    src_f = os.path.join(BAK_DIR, f"bdcsj.{ext}")
    bak_f = os.path.join(BAK_DIR, f"bdcsj_original.{ext}")
    if os.path.exists(src_f) and not os.path.exists(bak_f):
        # 复制文件内容
        with open(src_f, "rb") as f1, open(bak_f, "wb") as f2:
            f2.write(f1.read())

# 读取原始数据；原始 DBF 实际为 GBK 编码
print("读取数据源:", SRC)
gdf = gpd.read_file(SRC, encoding="gbk")
print(f"共读取 {len(gdf)} 条记录，字段：{list(gdf.columns)}")

# 生成虚拟不动产单元号，形如 430302116001GB00001F00080000
def make_bdcdyh(idx):
    # 前缀固定为湘潭市雨湖区示例 430302
    prefix = "430302"
    # 地籍区/子区：6 位，随机但保证不重复即可
    djq = f"{random.randint(100000, 999999):06d}"
    # 宗地顺序号 5 位
    zdh = f"GB{random.randint(1, 99999):05d}"
    # 定着物顺序号 8 位
    dzw = f"F{random.randint(1, 99999999):08d}"
    return f"{prefix}{djq}{zdh}{dzw}"

random.seed(42)
gdf["BDCDYH"] = [make_bdcdyh(i) for i in range(len(gdf))]

# 写出为 UTF-8 编码的 Shapefile，ArcGIS Pro 会读取 .cpg 中的 UTF-8 并正确显示中文
print("写出处理后的 Shapefile（UTF-8 编码）...")
gdf.to_file(SRC, driver="ESRI Shapefile", encoding="utf-8")

# 移除可能残留的旧的 .cst 编码声明，避免与新的 UTF-8 .cpg 冲突
cst_path = os.path.join(BAK_DIR, "bdcsj.cst")
if os.path.exists(cst_path):
    os.remove(cst_path)
    print("已移除旧的 bdcsj.cst 编码声明文件")

# 验证
gdf2 = gpd.read_file(SRC)
print("处理后字段：", list(gdf2.columns))
print("编码声明 (.cpg)：", open(os.path.join(BAK_DIR, "bdcsj.cpg"), encoding="utf-8").read().strip())
print("示例 BDCDYH：")
print(gdf2["BDCDYH"].head(5).tolist())
print("中文属性示例（UTF-8）：")
print(gdf2["BDCQZH"].dropna().head(3).tolist())
print("处理完成。")
