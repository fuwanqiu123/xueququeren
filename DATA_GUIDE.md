# 学区数据制作指南

本文档介绍如何制作和准备学区地图数据。

## 数据格式说明

### 1. 行政区划数据

**文件**: `data/xiangtan_boundary.json`

包含湘潭市及各区县的边界，用于在地图上显示行政区划。

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "湘潭市",
        "code": "430300"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[经度, 纬度], ...]]
      }
    }
  ]
}
```

### 2. 学区数据

**中学目录**: `data/middle/`
**小学目录**: `data/primary/`

每个学校一个独立的 GeoJSON 文件：

```json
{
  "type": "FeatureCollection",
  "name": "湘潭市第一中学学区",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "学校名称（必填）",
        "school_name": "学校完整名称",
        "code": "学校编码",
        "district": "所属区县（必填）",
        "county": "所属区县（备用）",
        "address": "学校地址",
        "type": "middle/primary",
        "level": "学校等级"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [112.8800, 27.8650],
            [112.9000, 27.8600],
            ...
          ]
        ]
      }
    }
  ]
}
```

## 如何获取学区边界数据

### 方法一：从 GIS 系统导出

如果当地教育局有 GIS 系统，可以直接导出 GeoJSON 格式的学区边界。

### 方法二：使用 QGIS 绘制

1. **下载安装 QGIS**
   - 访问 https://qgis.org/ 下载并安装

2. **创建新项目**
   - 打开 QGIS → Project → New

3. **添加底图**
   - 浏览器面板 → XYZ Tiles → 右键 New Connection
   - 添加天地图: `https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=您的密钥`

4. **创建学区图层**
   - Layer → Create Layer → New GeoPackage Layer
   - 选择 Polygon 类型
   - 添加字段: name, code, district, address

5. **绘制学区**
   - 点击 Toggle Editing（铅笔图标）
   - 点击 Add Polygon Feature
   - 在地图上点击绘制学区边界
   - 右键完成，输入属性信息

6. **导出 GeoJSON**
   - 右键图层 → Export → Save Features As...
   - 格式选择 GeoJSON
   - 坐标系选择 EPSG:4326 - WGS 84

### 方法三：从 Shapefile 转换

如果已有 Shapefile (.shp) 格式数据：

1. **使用 QGIS 转换**
   - Layer → Add Layer → Add Vector Layer
   - 选择 .shp 文件
   - 右键图层 → Export → Save Features As...
   - 格式选择 GeoJSON，坐标系选 WGS84

2. **使用 ogr2ogr 命令行**
   ```bash
   ogr2ogr -f GeoJSON output.json input.shp -t_srs EPSG:4326
   ```

### 方法四：在线工具绘制

**geojson.io**
1. 访问 http://geojson.io/
2. 在右侧地图上用多边形工具绘制
3. 左侧自动生成 GeoJSON 代码
4. 复制保存为 .json 文件

## 坐标系说明

**必须使用 WGS84 (EPSG:4326)** 坐标系，即经纬度格式。

示例坐标（湘潭市中心）：
```
纬度: 27.8297°N
经度: 112.9441°E

GeoJSON 格式: [112.9441, 27.8297]  // 注意顺序：经度在前，纬度在后
```

## 数据检查清单

在添加数据前，请确认：

- [ ] GeoJSON 格式有效（可用 geojson.io 验证）
- [ ] 坐标系为 WGS84 (EPSG:4326)
- [ ] 属性字段包含 `name` 和 `district`
- [ ] 多边形闭合（首尾坐标相同）
- [ ] 没有自相交的边界
- [ ] 文件名使用英文，避免特殊字符

## 批量处理工具

### 批量检查 GeoJSON 文件

```python
import json
import glob
import os

def validate_geojson(filepath):
    """验证 GeoJSON 文件"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 检查必需的字段
        if 'features' not in data:
            return False, "缺少 features 字段"
        
        for feature in data['features']:
            props = feature.get('properties', {})
            if 'name' not in props:
                return False, "缺少 name 属性"
            if 'district' not in props:
                return False, "缺少 district 属性"
        
        return True, "验证通过"
    except Exception as e:
        return False, str(e)

# 检查所有文件
for filepath in glob.glob('data/middle/*.json'):
    valid, msg = validate_geojson(filepath)
    status = "✓" if valid else "✗"
    print(f"{status} {os.path.basename(filepath)}: {msg}")
```

### 批量重命名文件

如果文件名需要规范：

```python
import os
import glob

def standardize_filename(school_name):
    """将学校名转换为标准文件名"""
    # 去除空格和特殊字符
    name = school_name.replace(' ', '').replace('市', '').replace('区', '')
    # 转换为拼音或英文名（这里简化处理）
    return f"{name}.json"

# 重命名所有文件
for filepath in glob.glob('data/middle/*.json'):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    school_name = data['features'][0]['properties']['name']
    new_name = standardize_filename(school_name)
    new_path = os.path.join(os.path.dirname(filepath), new_name)
    
    os.rename(filepath, new_path)
    print(f"重命名: {filepath} -> {new_path}")
```

## 生成索引文件

当添加新学校后，需要更新索引文件：

```python
import json
import glob
import os

def generate_index(directory):
    """为目录生成索引文件"""
    files = []
    for filepath in glob.glob(os.path.join(directory, '*.json')):
        filename = os.path.basename(filepath)
        if filename != 'index.json':
            files.append(filename)
    
    files.sort()
    
    with open(os.path.join(directory, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(files, f, ensure_ascii=False, indent=2)
    
    print(f"已生成索引: {directory}/index.json，共 {len(files)} 个文件")

# 生成中学和小学索引
generate_index('data/middle')
generate_index('data/primary')
```

## 数据示例

### 单个学校学区示例

```json
{
  "type": "FeatureCollection",
  "name": "湘潭市第一中学学区",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "湘潭市第一中学",
        "school_name": "湘潭市第一中学",
        "code": "430302001",
        "district": "雨湖区",
        "county": "雨湖区",
        "address": "湘潭市雨湖区建设北路117号",
        "type": "middle",
        "level": "市重点"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [112.8800, 27.8650],
            [112.9000, 27.8600],
            [112.9150, 27.8700],
            [112.9100, 27.8850],
            [112.8900, 27.8900],
            [112.8750, 27.8800],
            [112.8800, 27.8650]
          ]
        ]
      }
    }
  ]
}
```

## 注意事项

1. **文件编码**: 所有 JSON 文件必须使用 UTF-8 编码
2. **坐标顺序**: GeoJSON 使用 [经度, 纬度] 顺序，不要搞反
3. **多边形闭合**: 多边形的第一个点和最后一个点必须相同
4. **文件命名**: 建议使用英文或拼音，避免中文和特殊字符
5. **数据备份**: 修改数据前做好备份

## 需要帮助？

如果在数据制作过程中遇到问题：

1. 使用 [geojson.io](http://geojson.io/) 验证 GeoJSON 格式
2. 使用 [geojsonlint.com](https://geojsonlint.com/) 检查数据有效性
3. 参考示例数据文件
