
import geopandas as gpd
import pandas as pd
import os
from glob import glob
from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union
import json
import sys

def merge_school_geojson_to_shp(geojson_folder, excel_path, output_shp_path):
    """
    将多个学校GeoJSON文件合并为Shapefile，每个文件合并为一个MultiPolygon，并关联Excel属性表
    
    参数:
        geojson_folder: GeoJSON文件夹路径
        excel_path: Excel属性表路径
        output_shp_path: 输出Shapefile路径
    """
    
    def split_text_by_bytes(text, max_bytes=254):
        """按UTF-8字节长度拆分文本，避免切在多字节字符中间"""
        text = str(text) if pd.notna(text) else ''
        encoded = text.encode('utf-8')
        parts = []
        while encoded:
            if len(encoded) <= max_bytes:
                parts.append(encoded.decode('utf-8'))
                break
            # 从 max_bytes 位置向前找，直到找到一个合法的 UTF-8 边界
            # UTF-8 中，多字节字符的后续字节都以 10xxxxxx 开头（即 & 0xC0 == 0x80）
            pos = max_bytes
            while pos > 0 and (encoded[pos] & 0xC0) == 0x80:
                pos -= 1
            parts.append(encoded[:pos].decode('utf-8'))
            encoded = encoded[pos:]
        return parts
    
    print(f"📁 扫描GeoJSON文件夹: {geojson_folder}")
    
    # 1. 递归获取所有geojson文件（包含子文件夹）
    geojson_pattern = os.path.join(geojson_folder, "**/*.geojson")
    geojson_files = glob(geojson_pattern, recursive=True)
    
    if not geojson_files:
        print(f"❌ 未找到任何.geojson文件，请检查路径: {geojson_folder}")
        return
    
    print(f"✅ 找到 {len(geojson_files)} 个GeoJSON文件（对应{len(geojson_files)}个学校）")
    
    # 2. 处理每个GeoJSON文件 -> 合并为单个MultiPolygon
    school_records = []
    
    for file_path in geojson_files:
        try:
            # 获取学校名称（优先用文件内的name，否则用文件名）
            school_name = os.path.splitext(os.path.basename(file_path))[0]
            
            # 方法：使用geopandas读取，然后合并几何
            gdf = gpd.read_file(file_path)
            
            if len(gdf) == 0:
                print(f"⚠️ 跳过空文件: {os.path.basename(file_path)}")
                continue
            
            # 获取名称（如果第一个feature有name属性，用它；否则用文件名）
            if 'name' in gdf.columns and pd.notna(gdf.iloc[0]['name']):
                school_name = str(gdf.iloc[0]['name']).strip()
            
            # 合并所有几何为一个：先union，再转为MultiPolygon
            # unary_union会将重叠或相邻的多边形合并，不连续的会转为MultiPolygon
            combined_geom = unary_union(gdf.geometry)
            
            # 确保是MultiPolygon（即使原始是单个Polygon或GeometryCollection）
            if combined_geom.geom_type == 'Polygon':
                combined_geom = MultiPolygon([combined_geom])
            elif combined_geom.geom_type == 'GeometryCollection':
                # 提取其中的多边形部分
                polygons = [geom for geom in combined_geom.geoms if geom.geom_type in ['Polygon', 'MultiPolygon']]
                if polygons:
                    combined_geom = unary_union(polygons)
                    if combined_geom.geom_type == 'Polygon':
                        combined_geom = MultiPolygon([combined_geom])
                else:
                    print(f"⚠️ 警告: {school_name} 中没有有效的多边形几何")
                    continue
            elif combined_geom.geom_type in ['MultiPolygon']:
                pass  # 已经是MultiPolygon，无需处理
            else:
                print(f"⚠️ 警告: {school_name} 的几何类型是 {combined_geom.geom_type}，不是多边形，已跳过")
                continue
            
            # 收集其他可能的属性（取第一个feature的）
            properties = {'name': school_name}
            
            # 保存记录
            school_records.append({
                'geometry': combined_geom,
                'name': school_name,
                'source_file': os.path.basename(file_path),
                'original_feature_count': len(gdf)  # 记录原始多边形数量
            })
            
            print(f"  ✓ 处理: {school_name} ({len(gdf)}个多边形合并为1个MultiPolygon)")
            
        except Exception as e:
            print(f"  ❌ 处理失败: {os.path.basename(file_path)} - {str(e)}")
    
    if not school_records:
        print("❌ 没有成功处理任何GeoJSON文件")
        return
    
    # 3. 创建GeoDataFrame
    print(f"\n🔧 创建空间数据表...")
    merged_gdf = gpd.GeoDataFrame(school_records, crs='EPSG:4326')
    
    print(f"📊 共处理 {len(merged_gdf)} 个学校")
    
    # 4. 读取Excel属性表
    print(f"\n📖 读取Excel属性表: {excel_path}")
    try:
        if excel_path.endswith('.xlsx'):
            df_excel = pd.read_excel(excel_path, engine='openpyxl')
        else:
            df_excel = pd.read_excel(excel_path)
        
        print(f"✅ Excel读取成功，共 {len(df_excel)} 条记录")
        print(f"   包含列: {list(df_excel.columns)}")
        
    except Exception as e:
        print(f"❌ 读取Excel失败: {str(e)}")
        return
    
    # 5. 数据关联
    print("\n🔗 关联空间数据与属性表...")
    
    # 重命名Excel的"学校名称"为name以便匹配
    if '学校' in df_excel.columns:
        df_excel = df_excel.rename(columns={'学校': 'name'})
    else:
        print("⚠️ 警告: Excel中未找到'学校名称'列，请检查列名")
        print(f"   可用列名: {list(df_excel.columns)}")
        return
    
    # 清理数据：去除前后空格，统一类型
    merged_gdf['name'] = merged_gdf['name'].astype(str).str.strip()
    df_excel['name'] = df_excel['name'].astype(str).str.strip()
    
    # 执行连接（左连接，保留所有空间数据）
    final_gdf = merged_gdf.merge(df_excel, on='name', how='left')
    
    # 检查匹配情况
    unmatched_mask = final_gdf['学校类型'].isna() if '学校类型' in final_gdf.columns else final_gdf.iloc[:, -1].isna()
    matched_count = (~unmatched_mask).sum()
    
    print(f"✅ 匹配成功: {matched_count}/{len(final_gdf)} 个学校关联到属性表")
    
    if matched_count < len(final_gdf):
        unmatched_names = final_gdf[unmatched_mask]['name'].tolist()
        if unmatched_names:
            print(f"⚠️ 未匹配的学校名称（请检查Excel中是否存在）：")
            for name in unmatched_names[:10]:  # 只显示前10个
                print(f"   - {name}")
            if len(unmatched_names) > 10:
                print(f"   ... 还有 {len(unmatched_names)-10} 个未显示")
    
    # 6. 字段名处理（适配Shapefile 10字符限制）
    print("\n✂️ 处理字段名（适配Shapefile 10字符限制）...")
    
    column_mapping = {
        'name': 'sch_name',           # 学校名称
        '学校编码': 'sch_code',       # 学校编码
        '学校类型': 'sch_type',       # 学校类型
        '标准名称': 'std_name',       # 标准名称
        '招生服务范围': 'srv_range',  # 招生服务范围
        '所属行政区': 'district',     # 所属行政区
        '备注': 'remark',             # 备注
        '序号': 'seq_num',
        'original_feature_count': 'feat_cnt'  # 原始多边形数量（调试用）
    }
    
    # 只重命名存在的字段
    rename_dict = {k: v for k, v in column_mapping.items() if k in final_gdf.columns}
    final_gdf = final_gdf.rename(columns=rename_dict)
    
    # 移除不需要的字段
    if 'source_file' in final_gdf.columns:
        final_gdf = final_gdf.drop(columns=['source_file'])
    
    print(f"📋 最终字段列表:")
    for old, new in rename_dict.items():
        print(f"   {old} → {new}")
    
    # 7. 坐标系转换（转为CGCS2000适合湘潭）
    print(f"\n🌍 当前坐标系: {final_gdf.crs}")
    try:
        final_gdf = final_gdf.to_crs(epsg=4544)
        print(f"✅ 已转换为: CGCS2000 / 3-degree Gauss-Kruger CM 111E (EPSG:4544)")
    except Exception as e:
        print(f"⚠️ 坐标转换失败，保持原始坐标系: {str(e)}")
    
    # 拆分长文本字段 srv_range，避免 shapefile 254 字节限制导致截断
    if 'srv_range' in final_gdf.columns:
        print(f"\n✂️ 拆分 srv_range 长文本字段...")
        split_results = final_gdf['srv_range'].apply(lambda x: split_text_by_bytes(x, 254))
        final_gdf['srv_range'] = split_results.apply(lambda x: x[0] if len(x) > 0 else '')
        final_gdf['srv_rng1'] = split_results.apply(lambda x: x[1] if len(x) > 1 else '')
        final_gdf['srv_rng2'] = split_results.apply(lambda x: x[2] if len(x) > 2 else '')
        final_gdf['srv_rng3'] = split_results.apply(lambda x: x[3] if len(x) > 3 else '')
        split_counts = split_results.apply(len)
        print(f"   需要拆分的记录数: {(split_counts > 1).sum()}")
        print(f"   最大拆分段数: {split_counts.max()}")
    
    # 8. 保存为Shapefile
    print(f"\n💾 保存Shapefile到: {output_shp_path}")
    
    output_dir = os.path.dirname(output_shp_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    try:
        # --- 修复字段截断问题：手动指定schema，确保长文本字段有足够的宽度 ---
        # Shapefile的.dbf对字符串字段最大支持254字符，但Fiona默认按数据内容自动推断宽度，
        # 如果前面几条记录短，后面的长文本就会被截断。这里强制设置宽字段宽度为254。
        from collections import OrderedDict
        
        # 几何类型（前面已统一转换为MultiPolygon）
        geom_type = 'MultiPolygon'
        
        properties = OrderedDict()
        for col in final_gdf.columns:
            if col == 'geometry':
                continue
            dtype = final_gdf[col].dtype
            if pd.api.types.is_integer_dtype(dtype):
                properties[col] = 'int'
            elif pd.api.types.is_float_dtype(dtype):
                properties[col] = 'float'
            else:
                # 对长文本字段直接给最大宽度254，其他字段也至少给80避免被截断
                if col in ['srv_range', 'srv_rng1', 'srv_rng2', 'srv_rng3', 'remark', 'std_name', 'sch_name']:
                    properties[col] = 'str:254'
                else:
                    max_len = final_gdf[col].astype(str).str.len().max()
                    width = min(800, max(80, int(max_len) if pd.notna(max_len) else 80))
                    properties[col] = f'str:{width}'
        
        schema = {'geometry': geom_type, 'properties': properties}
        final_gdf.to_file(output_shp_path, encoding='utf-8', engine='fiona', schema=schema)
        
        # 统计信息
        print(f"\n✅ 保存成功!")
        print(f"   总学校数: {len(final_gdf)}")
        print(f"   几何类型: {final_gdf.geometry.type.unique().tolist()}")
        print(f"   属性匹配: {matched_count}/{len(final_gdf)}")
        
        # 生成字段对照表
        readme_path = os.path.join(output_dir, '字段对照表.txt')
        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write("Shapefile字段名对照表\n")
            f.write("="*50 + "\n\n")
            f.write("原始名称 → Shapefile字段名（10字符限制）\n\n")
            for old, new in rename_dict.items():
                f.write(f"{old:15s} → {new}\n")
            f.write(f"\n坐标系: {final_gdf.crs}\n")
            f.write(f"学校总数: {len(final_gdf)}\n")
        print(f"📄 已生成字段对照表: {readme_path}")
        
    except Exception as e:
        print(f"❌ 保存失败: {str(e)}")
        raise

# 使用示例
if __name__ == "__main__":
    EXCEL_FILE = r"./tmp_data/全市学区招生服务范围描述.xlsx"  # Excel路径
    #小学
    #GEOJSON_FOLDER = r"./data/primary"  # GeoJSON文件夹路径
    #OUTPUT_SHP = r"./output/primary-shp/primary.shp"   # 输出Shapefile路径
    #中学
    GEOJSON_FOLDER = r"./data/middle"  # GeoJSON文件夹路径
    OUTPUT_SHP = r"./output/middle-shp/middle.shp"   # 输出Shapefile路径

    print("="*60)
    print("学校GeoJSON合并工具（支持文件内多边形合并）")
    print("="*60)
    
    merge_school_geojson_to_shp(GEOJSON_FOLDER, EXCEL_FILE, OUTPUT_SHP)
