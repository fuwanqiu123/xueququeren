
import geopandas as gpd
import pandas as pd
import os

def merge_middle_point_to_shp(geojson_path, excel_path, output_shp_path):
    """
    将学校点位GeoJSON转为SHP，并关联初中分校表格属性
    关联方式：sch_code下划线前面的部分 对应 机构编码
    """
    
    print(f">>> 读取点位GeoJSON: {geojson_path}")
    gdf = gpd.read_file(geojson_path)
    print(f"   共 {len(gdf)} 个点位")
    
    print(f"\n>>> 读取属性表: {excel_path}")
    df = pd.read_excel(excel_path)
    print(f"   共 {len(df)} 条记录")
    
    # 提取匹配键：sch_code下划线前面的部分
    print("\n>>> 提取匹配键...")
    gdf['match_key'] = gdf['sch_code'].astype(str).str.split('_').str[0].str.strip()
    df['match_key'] = df['机构编码'].astype(str).str.strip()
    
    # 执行关联（左连接，保留所有点位）
    merged = gdf.merge(df, on='match_key', how='left')
    
    # 检查匹配情况
    matched = merged['学校名称'].notna().sum()
    print(f"[OK] 匹配成功: {matched}/{len(merged)}")
    if matched < len(merged):
        unmatched = merged[merged['学校名称'].isna()]['text'].tolist()
        print(f"[WARN] 未匹配的学校: {unmatched}")
    
    # 移除不需要的辅助字段和临时字段
    drop_cols = ['id', 'iconType', 'iconColor', 'iconSize', 'textColor',
                 'assistFileId', 'sourceFileName', 'type', 'isAssistFeature',
                 'match_key', '机构编码']
    for col in drop_cols:
        if col in merged.columns:
            merged = merged.drop(columns=[col])
    
    # 字段名映射（适配Shapefile 10字符限制）
    column_mapping = {
        'text': 'sch_name',           # 学校名称（点位里的text）
        'sch_code': 'sch_code',       # 学校编码
        '学校名称': 'sch_name2',      # 学校名称（表格里的）
        '办学类型': 'sch_type',       # 办学类型
        '省': 'province',             # 省
        '市': 'city',                 # 市
        '区县': 'district',           # 区县
        '乡镇街道': 'town',           # 乡镇街道
        '村社区': 'village',          # 村社区
        '所在地编码': 'loc_code',     # 所在地编码
        '经度': 'lon',                # 经度
        '纬度': 'lat',                # 纬度
        '城乡分组': 'urb_rur',        # 城乡分组
        '城乡类型': 'urb_typ',        # 城乡类型
        '举办者性质': 'holder',       # 举办者性质
        '举办者类型分组': 'hld_grp',  # 举办者类型分组
        '举办者类型': 'hld_typ',      # 举办者类型
        '班数合计': 'cls_ttl',        # 班数合计
        '毕业生女': 'grad_f',         # 毕业生女
        '招生数': 'enroll',           # 招生数
        '招生女': 'enroll_f',         # 招生女
        '预计毕业生数': 'est_grad',   # 预计毕业生数
        '预计毕业生女': 'est_gr_f',   # 预计毕业生女
        '在校生合计': 'stu_ttl',      # 在校生合计
        '在校生女': 'stu_f',          # 在校生女
        '女生占比': 'f_pct',          # 女生占比
        '平均班额': 'avg_cls',        # 平均班额
        '招生毕业差额': 'en_gr_dif',  # 招生毕业差额
        '大班额班数': 'lrg_cls',      # 大班额班数
        '大班额占比': 'lrg_pct',      # 大班额占比
    }
    
    # 只重命名存在的字段
    rename_dict = {k: v for k, v in column_mapping.items() if k in merged.columns}
    merged = merged.rename(columns=rename_dict)
    
    print(f"\n>>> 最终字段列表:")
    for old, new in rename_dict.items():
        print(f"   {old:12s} → {new}")
    
    # 坐标系转换（转为CGCS2000适合湘潭）
    print(f"\n>>> 当前坐标系: {merged.crs}")
    try:
        merged = merged.to_crs(epsg=4544)
        print(f"[OK] 已转换为: CGCS2000 / 3-degree Gauss-Kruger CM 111E (EPSG:4544)")
    except Exception as e:
        print(f"[WARN] 坐标转换失败，保持原始坐标系: {str(e)}")
    
    # 保存为Shapefile
    print(f"\n>>> 保存Shapefile到: {output_shp_path}")
    output_dir = os.path.dirname(output_shp_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    try:
        merged.to_file(output_shp_path, encoding='utf-8')
        
        print(f"\n[OK] 保存成功!")
        print(f"   总记录数: {len(merged)}")
        print(f"   几何类型: {merged.geometry.type.unique().tolist()}")
        print(f"   属性匹配: {matched}/{len(merged)}")
        
        # 生成字段对照表
        readme_path = os.path.join(output_dir, '字段对照表.txt')
        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write("Shapefile字段名对照表\n")
            f.write("="*50 + "\n\n")
            f.write("原始名称 → Shapefile字段名（10字符限制）\n\n")
            for old, new in rename_dict.items():
                f.write(f"{old:15s} → {new}\n")
            f.write(f"\n坐标系: {merged.crs}\n")
            f.write(f"学校总数: {len(merged)}\n")
        print(f">>> 已生成字段对照表: {readme_path}")
        
    except Exception as e:
        print(f"[ERR] 保存失败: {str(e)}")
        raise


if __name__ == "__main__":
    #中学
    #GEOJSON_FILE = r"./data/middle/辅助元素图层_middle_point.geojson"
    #EXCEL_FILE = r"./tmp_data/湘潭市初中分校_精简后.xlsx"
    #OUTPUT_SHP = r"./output/middle-point-shp/middle_point.shp"

    #小学
    GEOJSON_FILE = r"./data/primary/辅助元素图层_primary_point.geojson"
    EXCEL_FILE = r"./tmp_data/湘潭市小学分校_精简后.xlsx"
    OUTPUT_SHP = r"./output/primary-point-shp/primary_point.shp"
    
    print("="*60)
    print("学校点位转SHP并关联属性")
    print("="*60)
    
    merge_middle_point_to_shp(GEOJSON_FILE, EXCEL_FILE, OUTPUT_SHP)
