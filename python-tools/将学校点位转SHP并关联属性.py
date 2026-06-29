
import geopandas as gpd
import pandas as pd
import os

def merge_middle_point_to_shp(geojson_path, excel_path, output_shp_path):
    """
    将学校点位GeoJSON转为SHP，并关联初中分校表格属性
    关联方式：sch_code下划线前面的部分 对应 学校编码
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
    df['match_key'] = df['学校编码'].astype(str).str.strip()
    
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
                 'match_key', '学校编码']
    for col in drop_cols:
        if col in merged.columns:
            merged = merged.drop(columns=[col])
    
    # 字段名映射（适配Shapefile 10字符限制）
    column_mapping = {
        'text': 'sch_name',           # 学校名称（点位里的text）
        'sch_code': 'sch_code',       # 学校编码
        '学校名称': 'sch_name2',      # 学校名称（表格里的）
        '办学类型': 'sch_type',       # 办学类型
        '办学类型编码': 'sch_typ_cd', # 办学类型编码
        '举办者性质': 'holder',       # 举办者性质
        '举办者分组': 'hld_grp',      # 举办者分组
        '举办者类型': 'hld_typ',      # 举办者类型
        '举办者编码': 'hld_code',     # 举办者编码
        '城乡分组': 'urb_rur',        # 城乡分组
        '城乡类型': 'urb_typ',        # 城乡类型
        '城乡编码': 'urb_code',       # 城乡编码
        '是否计校': 'is_count',       # 是否计校
        '是否撤销': 'is_revoke',      # 是否撤销
        '是否新增': 'is_new',         # 是否新增
        '是否民族校': 'is_min',       # 是否民族校
        '区划编码': 'area_code',      # 区划编码
        '省': 'province',             # 省
        '市': 'city',                 # 市
        '区县': 'district',           # 区县
        '街道': 'street',             # 街道
        '社区': 'community',          # 社区
        '经度': 'lon',                # 经度
        '纬度': 'lat',                # 纬度
        '班数合计': 'cls_ttl',        # 班数合计
        '班数_一': 'cls_gr1',         # 班数_一
        '班数_二': 'cls_gr2',         # 班数_二
        '班数_三': 'cls_gr3',         # 班数_三
        '班数_四': 'cls_gr4',         # 班数_四
        '班数_五': 'cls_gr5',         # 班数_五
        '班数_六': 'cls_gr6',         # 班数_六
        '班数_初一': 'cls_cy1',       # 班数_初一
        '班数_初二': 'cls_cy2',       # 班数_初二
        '班数_初三': 'cls_cy3',       # 班数_初三
        '班数_初四': 'cls_cy4',       # 班数_初四
        '班额36-40': 'cls36_40',      # 班额36-40
        '班额41-45': 'cls41_45',      # 班额41-45
        '班额46-50': 'cls46_50',      # 班额46-50
        '班额51-55': 'cls51_55',      # 班额51-55
        '班额56-60': 'cls56_60',      # 班额56-60
        '班额61-65': 'cls61_65',      # 班额61-65
        '班额66+': 'cls66plus',       # 班额66+
        '小教班合计': 'pri_cls_tt',   # 小教班合计
        '小教班_一': 'pri_cls_1',     # 小教班_一
        '小教班_二': 'pri_cls_2',     # 小教班_二
        '小教班_三': 'pri_cls_3',     # 小教班_三
        '小教班_四': 'pri_cls_4',     # 小教班_四
        '小教班_五': 'pri_cls_5',     # 小教班_五
        '小教班_六': 'pri_cls_6',     # 小教班_六
        '毕业生数': 'graduates',      # 毕业生数
        '毕业生女': 'grad_f',         # 毕业生女
        '招生数': 'enroll',           # 招生数
        '招生女': 'enroll_f',         # 招生女
        '预计毕业生': 'est_grad',     # 预计毕业生
        '预计毕女': 'est_gr_f',       # 预计毕女
        '在校生数': 'stu_ttl',        # 在校生数
        '在校女': 'stu_f',            # 在校女
        '在校少数': 'stu_min',        # 在校少数
        '寄宿生': 'boarder',          # 寄宿生
        '在校_一': 'stu_gr1',         # 在校_一
        '在校_二': 'stu_gr2',         # 在校_二
        '在校_三': 'stu_gr3',         # 在校_三
        '在校_四': 'stu_gr4',         # 在校_四
        '在校_五': 'stu_gr5',         # 在校_五
        '在校_六': 'stu_gr6',         # 在校_六
        '在校_初一': 'stu_cy1',       # 在校_初一
        '在校_初二': 'stu_cy2',       # 在校_初二
        '在校_初三': 'stu_cy3',       # 在校_初三
        '在校_初四': 'stu_cy4',       # 在校_初四
        '随迁招生': 'mig_enr',        # 随迁招生
        '随迁在校': 'mig_stu',        # 随迁在校
        '务工随迁招生': 'work_mig_e', # 务工随迁招生
        '务工随迁在校': 'work_mig_s', # 务工随迁在校
        '留守招生': 'left_enr',       # 留守招生
        '留守在校': 'left_stu',       # 留守在校
        '随班就读': 'incl_edu',       # 随班就读
        '小教在校合计': 'pri_stu_tt', # 小教在校合计
        '小教在校女': 'pri_stu_f',    # 小教在校女
        '小教在校少数': 'pri_stu_mn', # 小教在校少数
        '小教_一': 'pri_stu_1',       # 小教_一
        '小教_二': 'pri_stu_2',       # 小教_二
        '小教_三': 'pri_stu_3',       # 小教_三
        '小教_四': 'pri_stu_4',       # 小教_四
        '小教_五': 'pri_stu_5',       # 小教_五
        '小教_六': 'pri_stu_6',       # 小教_六
        '上年初在校': 'last_year',    # 上年初在校
        '上年初女': 'last_y_f',       # 上年初女
        '上年初少数': 'last_y_mn',    # 上年初少数
        '复学': 'return_s',           # 复学
        '休学': 'suspend',            # 休学
        '退学': 'dropout',            # 退学
        '死亡': 'death',              # 死亡
        '教职工': 'teachers',         # 教职工
        '教职工女': 'teach_f',        # 教职工女
        '教职工少数': 'teach_min',    # 教职工少数
        '在编': 'on_staff',           # 在编
        '专任教师': 'full_teach',     # 专任教师
        '专师女': 'full_t_f',         # 专师女
        '专师少数': 'full_t_min',     # 专师少数
        '行政': 'admin',              # 行政
        '教辅': 'aux_staff',          # 教辅
        '工勤': 'workers',            # 工勤
        '其他': 'others',             # 其他
        '校外教师': 'external',       # 校外教师
        '正高级': 'senior1',          # 正高级
        '副高级': 'senior2',          # 副高级
        '中级': 'mid_level',          # 中级
        '助理级': 'assistant',        # 助理级
        '员级': 'junior',             # 员级
        '博士': 'phd',                # 博士
        '硕士': 'master',             # 硕士
        '本科': 'bachelor',           # 本科
        '专科': 'associate',          # 专科
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
    #EXCEL_FILE = r"./tmp_data/分析教基1003_初中分校一览表_精简版.xlsx"
    #OUTPUT_SHP = r"./output/middle-point-shp/middle_point.shp"

    #小学
    GEOJSON_FILE = r"./data/primary/辅助元素图层_primary_point.geojson"
    EXCEL_FILE = r"./tmp_data/分析教基1002_小学分校一览表_精简版.xlsx"
    OUTPUT_SHP = r"./output/primary-point-shp/primary_point.shp"
    
    print("="*60)
    print("学校点位转SHP并关联属性")
    print("="*60)
    
    merge_middle_point_to_shp(GEOJSON_FILE, EXCEL_FILE, OUTPUT_SHP)
