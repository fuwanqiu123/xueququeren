import geopandas as gpd
import os
import json


def geometry_to_polygons(geom):
    """
    将任意几何对象拆分为独立的 Polygon 列表。
    Polygon -> [Polygon]
    MultiPolygon -> [Polygon, Polygon, ...]
    """
    if geom.geom_type == 'Polygon':
        return [geom]
    elif geom.geom_type == 'MultiPolygon':
        return list(geom.geoms)
    else:
        return []


def shp_to_geojsons(shp_path, output_folder):
    """
    将Shapefile中的每个要素分别保存为独立的GeoJSON文件。
    如果要素是MultiPolygon，则拆分为多个Polygon，放在同一个FeatureCollection中。

    参数:
        shp_path: 输入Shapefile路径
        output_folder: 输出GeoJSON文件夹路径
    """
    print(f"[INFO] 读取Shapefile: {shp_path}")

    # 读取Shapefile
    gdf = gpd.read_file(shp_path)
    print(f"[INFO] 读取成功，共 {len(gdf)} 个要素")
    print(f"[INFO] 原始坐标系: {gdf.crs}")

    # 转为 CGCS2000 地理坐标系 (EPSG:4490)，输出经纬度
    if gdf.crs is not None:
        try:
            gdf = gdf.to_crs(epsg=4490)
            print(f"[INFO] 已转换为 CGCS2000 地理坐标系 (EPSG:4490)")
        except Exception as e:
            print(f"[WARN] 坐标转换失败: {e}")

    # 创建输出目录
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
        print(f"[INFO] 创建输出目录: {output_folder}")

    # 逐要素导出
    success_count = 0
    for idx, row in gdf.iterrows():
        try:
            # 获取学校名称，用于文件名
            sch_name = str(row.get('sch_name', '')).strip()
            if not sch_name:
                sch_name = f"feature_{idx}"
                print(f"[WARN] 第 {idx} 个要素缺少 sch_name，使用默认文件名: {sch_name}")

            # 构造安全文件名（去除非法字符）
            safe_name = "".join(c for c in sch_name if c not in r'\/:*?"<>|').strip()
            if not safe_name:
                safe_name = f"feature_{idx}"

            output_path = os.path.join(output_folder, f"{safe_name}.geojson")

            # 将几何拆分为多个Polygon
            polygons = geometry_to_polygons(row.geometry)
            if not polygons:
                print(f"[WARN] 第 {idx} 个要素没有有效的多边形几何")
                continue

            # 构建 FeatureCollection
            features = []
            for poly in polygons:
                feature = {
                    "type": "Feature",
                    "properties": {
                        "name": sch_name,
                        "isAssistFeature": False
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": list(poly.__geo_interface__["coordinates"])
                    }
                }
                features.append(feature)

            geojson_obj = {
                "type": "FeatureCollection",
                "features": features
            }

            # 写入文件
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(geojson_obj, f, ensure_ascii=False, indent=2)

            success_count += 1
            poly_count = len(polygons)
            print(f"[OK] [{idx+1}/{len(gdf)}] {sch_name} ({poly_count}个Polygon) -> {os.path.basename(output_path)}")

        except Exception as e:
            print(f"[ERROR] 处理第 {idx} 个要素失败: {str(e)}")

    print(f"[INFO] 完成! 成功导出 {success_count}/{len(gdf)} 个GeoJSON文件到: {output_folder}")


if __name__ == "__main__":
    # 默认处理 output/合并学校.shp
    SHP_FILE = r"primary\primary.shp"
    OUTPUT_DIR = r"output\geojsons"

    print("=" * 60)
    print("SHP转GeoJSON工具（每个要素一个文件，MultiPolygon自动拆分）")
    print("=" * 60)

    shp_to_geojsons(SHP_FILE, OUTPUT_DIR)
