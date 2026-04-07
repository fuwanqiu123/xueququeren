# 湘潭市学区地图查看工具

为湘潭市中小学教师提供的移动端学区范围确认工具，支持在手机浏览器中直接打开查看，无需安装。

## 功能特点

- 📱 **移动端优先**：针对手机屏幕优化，触控操作流畅
- 🗺️ **双模式切换**：支持中学学区和小学学区查看
- 🔍 **智能搜索**：支持学校名称模糊匹配搜索
- 🎨 **可视化展示**：不同学校用不同颜色区分，边界清晰
- 📍 **定位导航**：支持学区定位和高亮显示
- 🛰️ **底图切换**：支持矢量地图和卫星影像切换

## 快速开始

### 1. 配置天地图密钥

编辑 `config.js` 文件，将 `tiandituKey` 替换为您申请的天地图密钥：

```javascript
const CONFIG = {
    tiandituKey: '您的天地图密钥',  // ← 替换这里
    // ...
};
```

**申请天地图密钥**：
1. 访问 [天地图开发者中心](https://console.tianditu.gov.cn/)
2. 注册并登录账号
3. 创建新应用，获取密钥

### 2. 准备数据

#### 数据目录结构
```
data/
├── xiangtan_boundary.json     # 湘潭市行政区划边界
├── middle/                    # 中学学区数据
│   ├── index.json            # 文件索引（可选）
│   ├── 学校1.json
│   ├── 学校2.json
│   └── ...
└── primary/                   # 小学学区数据
    ├── index.json            # 文件索引（可选）
    ├── 学校1.json
    ├── 学校2.json
    └── ...
```

#### 数据格式规范

每个学校的 GeoJSON 文件格式如下：

```json
{
  "type": "FeatureCollection",
  "name": "学校名称",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "学校名称",
        "school_name": "学校完整名称",
        "code": "学校编码",
        "district": "所属区县",
        "county": "所属区县（备用）",
        "address": "学校地址",
        "type": "middle/primary",
        "level": "学校等级"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [经度, 纬度],
            [经度, 纬度],
            ...
          ]
        ]
      }
    }
  ]
}
```

### 3. 部署使用

#### 方式一：直接打开（本地测试）
1. 配置好密钥和数据后
2. 直接用浏览器打开 `index.html` 文件
3. 注意：需要允许浏览器访问本地文件或使用本地服务器

#### 方式二：本地服务器（推荐）
```bash
# 使用 Python 简单服务器
cd school-district-map
python -m http.server 8080

# 然后访问 http://localhost:8080
```

#### 方式三：部署到 Web 服务器
将项目文件夹上传到任意 Web 服务器（Nginx、Apache 等）即可。

### 4. URL 参数

支持通过 URL 参数指定默认模式：

- 打开即显示中学学区：`index.html?mode=middle`
- 打开即显示小学学区：`index.html?mode=primary`

## 项目结构

```
school-district-map/
├── index.html          # 主页面
├── config.js           # 配置文件
├── app.js              # 应用逻辑
├── README.md           # 使用说明
└── data/               # 数据文件夹
    ├── xiangtan_boundary.json
    ├── middle/
    │   ├── index.json
    │   └── *.json
    └── primary/
        ├── index.json
        └── *.json
```

## 浏览器兼容性

- iOS Safari 12+
- Android Chrome 80+
- 微信内置浏览器
- 其他现代浏览器

## 常见问题

### Q: 地图显示空白？
A: 请检查：
1. 天地图密钥是否正确配置
2. 网络连接是否正常
3. 浏览器控制台是否有错误信息

### Q: 学区数据不显示？
A: 请检查：
1. 数据文件路径是否正确
2. GeoJSON 格式是否规范
3. 坐标系是否为 WGS84（经纬度）

### Q: 如何转换坐标系？
A: 如果数据是其他坐标系（如 CGCS2000），可以使用 QGIS、ArcGIS 等工具转换为 WGS84（EPSG:4326）。

## 技术支持

如有问题或建议，请联系开发团队。

## 开源协议

MIT License
