/**
 * 学区地图查看工具 - 主应用
 * 基于 OpenLayers 8.2.0 + 天地图
 */

// ============================================
// 全局状态
// ============================================
const AppState = {
    // 当前模式: 'middle'(中学) 或 'primary'(小学)
    currentMode: null,
    
    // 地图实例
    map: null,
    
    // 底图图层
    baseLayers: {},
    
    // 当前显示的底图类型
    currentMapType: 'vec',
    
    // 学区矢量源
    districtSource: null,
    
    // 学区图层
    districtLayer: null,
    
    // 行政区划源
    boundarySource: null,
    
    // 行政区划图层
    boundaryLayer: null,
    
    // 标签图层
    labelLayer: null,
    
    // 所有学校数据
    schools: [],
    
    // 当前选中的学校
    selectedSchool: null,
    
    // 学校名称到颜色的映射
    colorMap: {},
    
    // 颜色索引
    colorIndex: 0,
    
    // 选中特征的样式
    selectedFeature: null,
    
    // ============================================
    // 编辑相关状态
    // ============================================
    // 是否处于编辑模式
    isEditing: false,
    
    // 当前正在编辑的学校
    editingSchool: null,
    
    // 当前正在编辑的特征
    editingFeature: null,
    
    // 修改交互实例
    modifyInteraction: null,
    
    // 编辑前的原始几何（用于取消）
    originalGeometry: null,
    
    // 导入的学区（临时显示）
    importedFeatures: []
};

// ============================================
// 初始化
// ============================================

/**
 * 页面加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', function() {
    // 检查URL参数，看是否有预设模式
    checkUrlParams();
});

/**
 * 检查URL参数
 */
function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    
    if (mode === 'middle' || mode === 'primary') {
        selectMode(mode);
    }
}

/**
 * 选择模式
 */
function selectMode(mode) {
    AppState.currentMode = mode;
    
    // 隐藏选择界面
    document.getElementById('mode-selector').classList.add('hidden');
    
    // 显示地图相关UI
    document.getElementById('top-bar').style.display = 'flex';
    document.getElementById('map-type-switch').style.display = 'block';
    document.getElementById('right-controls').style.display = 'flex';
    document.getElementById('legend').style.display = 'block';
    
    // 显示全览按钮（教育局查看模式默认始终显示）
    const clearBtn = document.getElementById('clear-highlight-btn');
    if (clearBtn) {
        clearBtn.classList.add('visible');
    }
    
    // 更新切换按钮文字
    const btnText = mode === 'middle' ? '切小学' : '切中学';
    document.getElementById('mode-switch-btn').textContent = btnText;
    
    // 初始化地图
    initMap();
    
    // 加载数据
    loadData();
}

/**
 * 显示模式选择界面
 */
function showModeSelector() {
    // 清理地图
    if (AppState.map) {
        AppState.map.setTarget(null);
        AppState.map = null;
    }
    
    // 重置状态
    AppState.schools = [];
    AppState.selectedSchool = null;
    AppState.colorMap = {};
    AppState.colorIndex = 0;
    AppState.selectedFeature = null;
    if (AppState.highlightedSchools) {
        AppState.highlightedSchools.clear();
    }
    
    // 隐藏地图相关UI
    document.getElementById('top-bar').style.display = 'none';
    document.getElementById('map-type-switch').style.display = 'none';
    document.getElementById('right-controls').style.display = 'none';
    document.getElementById('legend').style.display = 'none';
    document.getElementById('selected-schools-panel').classList.remove('visible');
    
    // 隐藏清除高亮按钮
    const clearBtn = document.getElementById('clear-highlight-btn');
    if (clearBtn) {
        clearBtn.classList.remove('visible');
    }
    
    // 清空搜索
    document.getElementById('search-input').value = '';
    document.getElementById('search-dropdown').classList.remove('active');
    
    // 显示选择界面
    document.getElementById('mode-selector').classList.remove('hidden');
}

/**
 * 切换模式
 */
function switchMode() {
    const newMode = AppState.currentMode === 'middle' ? 'primary' : 'middle';
    
    // 清理当前数据
    if (AppState.districtSource) {
        AppState.districtSource.clear();
    }
    if (AppState.labelLayer) {
        AppState.labelLayer.getSource().clear();
    }
    
    AppState.schools = [];
    AppState.selectedSchool = null;
    AppState.colorMap = {};
    AppState.colorIndex = 0;
    AppState.selectedFeature = null;
    if (AppState.highlightedSchools) {
        AppState.highlightedSchools.clear();
    }
    
    // 清空搜索
    document.getElementById('search-input').value = '';
    document.getElementById('search-dropdown').classList.remove('active');
    
    // 切换模式
    AppState.currentMode = newMode;
    
    // 更新切换按钮文字
    const btnText = newMode === 'middle' ? '切小学' : '切中学';
    document.getElementById('mode-switch-btn').textContent = btnText;
    
    // 更新图例颜色
    const legendColor = newMode === 'middle' 
        ? 'rgba(102, 126, 234, 0.5)' 
        : 'rgba(255, 107, 107, 0.5)';
    document.getElementById('legend-district').style.background = legendColor;
    
    // 重新加载数据
    loadData();
}

// ============================================
// 地图初始化
// ============================================

/**
 * 创建天地图瓦片源（支持KEY轮询）
 */
function createTiandituSource(layerType) {
    const layerMap = {
        'vec': 'vec_w',      // 矢量底图
        'cva': 'cva_w',      // 矢量注记
        'img': 'img_w',      // 影像底图
        'cia': 'cia_w'       // 影像注记
    };
    
    const layerName = layerMap[layerType] || layerType;
    let key = TiandituKeyManager.getCurrentKey();
    
    // 记录使用量，并在接近上限时自动轮换
    key = TiandituKeyManager.recordUsage(key);
    
    // 使用urls数组形式，支持多个子域
    const urls = [];
    for (let i = 0; i <= 7; i++) {
        urls.push(`https://t${i}.tianditu.gov.cn/${layerName}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerType}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`);
    }
    
    const source = new ol.source.XYZ({
        urls: urls,
        maxZoom: CONFIG.maxZoom,
        attributions: '© 天地图'
    });
    
    // 监听瓦片加载错误，自动轮换Key
    let errorCount = 0;
    const MAX_ERRORS = 5; // 连续错误5次后切换Key
    
    source.on('tileloaderror', function(event) {
        errorCount++;
        console.warn(`[天地图] 瓦片加载错误 (${errorCount}/${MAX_ERRORS}):`, event.tile.getKey());
        
        if (errorCount >= MAX_ERRORS) {
            console.warn('[天地图] 连续多次加载失败，触发Key轮换');
            errorCount = 0;
            
            // 切换到下一个Key并刷新所有图层
            const newKey = TiandituKeyManager.getNextKey();
            if (newKey) {
                showToast('天地图Key已自动轮换，继续加载...');
                
                // 延迟刷新，避免频繁切换
                setTimeout(() => {
                    refreshTiandituSources();
                }, 1000);
            }
        }
    });
    
    source.on('tileloadend', function() {
        // 加载成功时重置错误计数
        if (errorCount > 0) {
            errorCount = 0;
        }
    });
    
    return source;
}

/**
 * 初始化地图
 */
function initMap() {
    // 创建矢量底图图层 (天地图矢量)
    AppState.baseLayers.vec = new ol.layer.Tile({
        source: createTiandituSource('vec'),
        visible: true
    });
    
    // 创建矢量注记图层
    AppState.baseLayers.vecLabel = new ol.layer.Tile({
        source: createTiandituSource('cva'),
        visible: true
    });
    
    // 创建影像底图图层
    AppState.baseLayers.img = new ol.layer.Tile({
        source: createTiandituSource('img'),
        visible: false
    });
    
    // 创建影像注记图层
    AppState.baseLayers.imgLabel = new ol.layer.Tile({
        source: createTiandituSource('cia'),
        visible: false
    });
    
    // 创建行政区划源
    AppState.boundarySource = new ol.source.Vector();
    
    // 创建行政区划图层
    AppState.boundaryLayer = new ol.layer.Vector({
        source: AppState.boundarySource,
        style: new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: CONFIG.boundaryStyle.color,
                width: CONFIG.boundaryStyle.weight,
                lineDash: [5, 5]
            }),
            fill: new ol.style.Fill({
                color: 'rgba(0, 0, 0, 0)'
            })
        }),
        zIndex: 5
    });
    
    // 创建学区源
    AppState.districtSource = new ol.source.Vector();
    
    // 创建学区图层 - 默认全局着色显示
    AppState.districtLayer = new ol.layer.Vector({
        source: AppState.districtSource,
        style: function(feature) {
            // 根据学校颜色全局着色，透明度适中便于宏观查看重叠区域
            const color = feature.get('color') || '#667eea';
            return new ol.style.Style({
                fill: new ol.style.Fill({
                    color: hexToRgba(color, 0.3)
                }),
                stroke: new ol.style.Stroke({
                    color: color,
                    width: 2
                })
            });
        },
        zIndex: 10
    });
    
    // 创建标签源
    const labelSource = new ol.source.Vector();
    
    // 创建标签图层
    AppState.labelLayer = new ol.layer.Vector({
        source: labelSource,
        style: function(feature) {
            const name = feature.get('name');
            const color = feature.get('color') || '#667eea';
            return new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: '12px "Microsoft YaHei", sans-serif',
                    fill: new ol.style.Fill({ color: '#fff' }),
                    backgroundFill: new ol.style.Fill({ 
                        color: hexToRgba(color, 0.9) 
                    }),
                    padding: [4, 10, 4, 10],
                    offsetY: 0
                })
            });
        },
        zIndex: 20,
        minZoom: CONFIG.labelMinZoom
    });
    
    // 创建地图视图
    const view = new ol.View({
        center: ol.proj.fromLonLat(CONFIG.defaultCenter),
        zoom: CONFIG.defaultZoom,
        minZoom: CONFIG.minZoom,
        maxZoom: CONFIG.maxZoom
    });
    
    // 创建地图
    AppState.map = new ol.Map({
        target: 'map-container',
        layers: [
            AppState.baseLayers.vec,
            AppState.baseLayers.img,
            AppState.baseLayers.vecLabel,
            AppState.baseLayers.imgLabel,
            AppState.boundaryLayer,
            AppState.districtLayer,
            AppState.labelLayer
        ],
        view: view,
        controls: ol.control.defaults.defaults({
            zoom: false,
            attribution: false,
            rotate: false
        }).extend([
            new ol.control.Zoom({
                className: 'ol-zoom'
            })
        ])
    });
    
    // 添加点击事件监听
    AppState.map.on('click', handleMapClick);
    
    // 添加指针移动事件监听（用于悬停效果）
    AppState.map.on('pointermove', handlePointerMove);
}

/**
 * 处理地图点击事件 - 教育局查看模式：点击显示学校详情
 */
function handleMapClick(event) {
    // 编辑状态下禁用地图点击选择功能，避免误操作
    if (AppState.isEditing) {
        return;
    }
    
    // 获取点击位置下的所有学区特征（处理重叠情况）
    const features = [];
    AppState.map.forEachFeatureAtPixel(event.pixel, function(feature) {
        features.push(feature);
        return false; // 继续遍历，获取所有特征
    }, {
        layerFilter: function(layer) {
            return layer === AppState.districtLayer;
        }
    });
    
    if (features.length === 0) {
        // 点击空白处关闭信息面板
        document.getElementById('info-panel').classList.remove('active');
        return;
    }
    
    // 获取唯一的学校列表
    const clickedSchools = [];
    const schoolIds = new Set();
    
    features.forEach(feature => {
        const schoolId = feature.get('schoolId');
        if (!schoolIds.has(schoolId)) {
            schoolIds.add(schoolId);
            const school = AppState.schools.find(s => s.id === schoolId);
            if (school) {
                clickedSchools.push(school);
            }
        }
    });
    
    // 显示信息面板，展示点击到的所有学校
    showInfoPanel(clickedSchools);
    
    // 飞移到第一个学校的范围
    if (clickedSchools.length > 0 && clickedSchools[0].features && clickedSchools[0].features.length > 0) {
        const extent = clickedSchools[0].features[0].getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [100, 100, 250, 100],
            duration: 500
        });
    }
    
    if (clickedSchools.length > 1) {
        showToast(`该位置涉及 ${clickedSchools.length} 个学区`);
    }
}

/**
 * 处理指针移动事件
 */
function handlePointerMove(event) {
    const feature = AppState.map.forEachFeatureAtPixel(event.pixel, function(feature) {
        return feature;
    }, {
        layerFilter: function(layer) {
            return layer === AppState.districtLayer;
        }
    });
    
    // 设置鼠标样式
    AppState.map.getTargetElement().style.cursor = feature ? 'pointer' : '';
}

/**
 * 刷新所有天地图源（KEY切换后调用）
 */
function refreshTiandituSources() {
    AppState.baseLayers.vec.setSource(createTiandituSource('vec'));
    AppState.baseLayers.vecLabel.setSource(createTiandituSource('cva'));
    AppState.baseLayers.img.setSource(createTiandituSource('img'));
    AppState.baseLayers.imgLabel.setSource(createTiandituSource('cia'));
    
    console.log('[地图源] 已刷新天地图瓦片源');
}

/**
 * 手动轮换到下一个天地图Key
 * 用户可以在浏览器控制台调用此函数
 */
function rotateTiandituKey() {
    const oldKey = TiandituKeyManager.getCurrentKey();
    const newKey = TiandituKeyManager.getNextKey();
    
    console.log('[KEY轮换] 手动触发');
    console.log('[KEY轮换] 旧Key:', oldKey.substring(0, 8) + '...');
    console.log('[KEY轮换] 新Key:', newKey.substring(0, 8) + '...');
    
    // 刷新地图源
    refreshTiandituSources();
    
    // 显示状态
    const status = TiandituKeyManager.getStatus();
    showToast(`Key已轮换 (${status.currentIndex + 1}/${status.totalKeys})`);
    
    return status;
}

/**
 * 查看天地图Key使用状态
 * 用户可以在浏览器控制台调用此函数
 */
function checkTiandituKeyStatus() {
    const status = TiandituKeyManager.getStatus();
    
    console.log('===== 天地图Key状态 =====');
    console.log(`总Key数: ${status.totalKeys}`);
    console.log(`当前Key索引: ${status.currentIndex + 1}`);
    console.log(`当前Key: ${status.currentKey}`);
    console.log(`已失效Key数: ${status.failedCount}`);
    console.log('使用统计:', status.usageStats);
    console.log('========================');
    
    return status;
}

/**
 * 切换地图类型
 */
function switchMapType(type) {
    AppState.currentMapType = type;
    
    // 更新按钮状态
    document.getElementById('btn-vec').classList.toggle('active', type === 'vec');
    document.getElementById('btn-img').classList.toggle('active', type === 'img');
    
    // 切换图层可见性
    if (type === 'vec') {
        AppState.baseLayers.vec.setVisible(true);
        AppState.baseLayers.vecLabel.setVisible(true);
        AppState.baseLayers.img.setVisible(false);
        AppState.baseLayers.imgLabel.setVisible(false);
    } else {
        AppState.baseLayers.vec.setVisible(false);
        AppState.baseLayers.vecLabel.setVisible(false);
        AppState.baseLayers.img.setVisible(true);
        AppState.baseLayers.imgLabel.setVisible(true);
    }
}

// ============================================
// 数据加载
// ============================================

/**
 * 加载数据
 */
async function loadData() {
    showLoading('正在加载数据...');
    
    try {
        // 如果是调试模式且启用模拟数据
        if (CONFIG.debug && CONFIG.useMockData) {
            loadMockData();
            return;
        }
        
        // 加载行政区划
        await loadBoundary();
        
        // 加载学区数据
        await loadDistricts();
        
        // 适配视图到所有学区范围（教育局查看模式：默认全览）
        fitToBounds();
        
        // 渲染学校列表面板
        updateSelectedSchoolsPanel();
        
        showToast('数据加载完成');
    } catch (error) {
        console.error('数据加载失败:', error);
        showToast('数据加载失败，请检查配置');
        
        // 如果真实数据加载失败，尝试加载模拟数据
        if (confirm('真实数据加载失败，是否使用模拟数据进行测试？')) {
            loadMockData();
        }
    } finally {
        hideLoading();
    }
}

/**
 * 加载行政区划边界
 */
async function loadBoundary() {
    try {
        const response = await fetch(CONFIG.boundaryFile);
        if (!response.ok) throw new Error('行政区划数据加载失败');
        
        const data = await response.json();
        
        // 使用 GeoJSON 格式读取
        const features = new ol.format.GeoJSON().readFeatures(data, {
            featureProjection: 'EPSG:3857'
        });
        
        AppState.boundarySource.addFeatures(features);
        
    } catch (error) {
        console.warn('行政区划加载失败:', error);
        // 行政区划不是必须的，继续加载学区数据
    }
}

/**
 * 加载学区数据
 */
async function loadDistricts() {
    const dataPath = AppState.currentMode === 'middle' 
        ? CONFIG.middleDataPath 
        : CONFIG.primaryDataPath;
    
    // 尝试加载索引文件
    try {
        const indexResponse = await fetch(`${dataPath}/index.json`);
        if (indexResponse.ok) {
            const fileList = await indexResponse.json();
            await loadDistrictFiles(dataPath, fileList);
            return;
        }
    } catch (e) {
        // 索引文件不存在，尝试其他方式
    }
    
    // 使用模拟的示例数据（开发测试用）
    const sampleFiles = [
        'school_001.json',
        'school_002.json',
        'school_003.json'
    ];
    
    await loadDistrictFiles(dataPath, sampleFiles);
}

/**
 * 加载学区文件
 */
async function loadDistrictFiles(basePath, fileList) {
    const loadPromises = fileList.map(async (filename) => {
        try {
            const response = await fetch(`${basePath}/${filename}`);
            if (!response.ok) return null;
            
            const data = await response.json();
            return processDistrictData(data, filename);
        } catch (error) {
            console.warn(`加载文件失败: ${filename}`, error);
            return null;
        }
    });
    
    const results = await Promise.all(loadPromises);
    AppState.schools = results.filter(s => s !== null);
    
    // 根据空间相邻关系重新分配颜色，确保相邻学区颜色不同
    assignAdjacentColors();
    
    // 根据相邻关系重新分配颜色
    assignAdjacentColors();
    
    // 渲染学区
    renderDistricts();
}

/**
 * 根据空间相邻关系为学区分配颜色，确保相邻多边形颜色不同
 * 使用贪心着色算法，按约束度（邻居数量）降序处理
 */
function assignAdjacentColors() {
    if (AppState.schools.length === 0) return;
    
    const format = new ol.format.GeoJSON();
    
    // 为每个学校读取 features 并计算 bbox，用于相交检测
    const schoolData = AppState.schools.map(school => {
        const features = format.readFeatures(school.geojson, {
            featureProjection: 'EPSG:3857'
        });
        return {
            school: school,
            extents: features.map(f => f.getGeometry().getExtent())
        };
    });
    
    // 构建邻接图：index -> Set(相邻学校的index)
    const adjacency = new Map();
    for (let i = 0; i < schoolData.length; i++) {
        adjacency.set(i, new Set());
    }
    
    // O(n²) 检测 bbox 相交（相邻的学区 bbox 必然相交）
    for (let i = 0; i < schoolData.length; i++) {
        for (let j = i + 1; j < schoolData.length; j++) {
            const a = schoolData[i];
            const b = schoolData[j];
            let isAdjacent = false;
            
            for (const extA of a.extents) {
                for (const extB of b.extents) {
                    if (ol.extent.intersects(extA, extB)) {
                        isAdjacent = true;
                        break;
                    }
                }
                if (isAdjacent) break;
            }
            
            if (isAdjacent) {
                adjacency.get(i).add(j);
                adjacency.get(j).add(i);
            }
        }
    }
    
    // 贪心着色：按度数（邻居数量）降序排序，约束多的先处理
    const order = Array.from({length: schoolData.length}, (_, i) => i);
    order.sort((a, b) => adjacency.get(b).size - adjacency.get(a).size);
    
    // 重置颜色映射，并统计每种颜色的全局使用次数
    AppState.colorMap = {};
    const assignedColors = new Map(); // schoolIndex -> color
    const globalColorUsage = new Map(); // color -> usage count
    for (const c of CONFIG.districtColors) {
        globalColorUsage.set(c, 0);
    }
    
    for (const idx of order) {
        const neighbors = adjacency.get(idx);
        const usedColors = new Set();
        
        for (const neighborIdx of neighbors) {
            if (assignedColors.has(neighborIdx)) {
                usedColors.add(assignedColors.get(neighborIdx));
            }
        }
        
        // 在所有不与邻居冲突的颜色中，优先选全局使用次数最少的
        // 这样可以迫使算法均匀使用所有颜色，地图看起来更丰富多彩
        let color = null;
        let minUsage = Infinity;
        for (const candidate of CONFIG.districtColors) {
            if (!usedColors.has(candidate)) {
                const usage = globalColorUsage.get(candidate);
                if (usage < minUsage) {
                    minUsage = usage;
                    color = candidate;
                }
            }
        }
        
        // 如果所有颜色都被邻居用了，选与最少邻居冲突的颜色
        if (!color) {
            const colorCounts = new Map();
            for (const c of CONFIG.districtColors) {
                colorCounts.set(c, 0);
            }
            for (const neighborIdx of neighbors) {
                if (assignedColors.has(neighborIdx)) {
                    const c = assignedColors.get(neighborIdx);
                    colorCounts.set(c, colorCounts.get(c) + 1);
                }
            }
            let minCount = Infinity;
            for (const [c, count] of colorCounts) {
                if (count < minCount) {
                    minCount = count;
                    color = c;
                }
            }
        }
        
        assignedColors.set(idx, color);
        globalColorUsage.set(color, globalColorUsage.get(color) + 1);
        schoolData[idx].school.color = color;
        AppState.colorMap[schoolData[idx].school.id] = color;
    }
    
    console.log('[颜色分配] 相邻分析完成，共', AppState.schools.length, '所学校');
}

/**
 * 处理学区数据
 */
function processDistrictData(geojson, filename) {
    // 提取属性信息
    const properties = geojson.features?.[0]?.properties || {};
    
    const school = {
        id: properties.code || filename.replace('.json', ''),
        name: properties.name || properties.school_name || '未知学校',
        district: properties.district || properties.county || '湘潭市',
        address: properties.address || '-',
        code: properties.code || '-',
        geojson: geojson,
        filename: filename,
        color: getNextColor()
    };
    
    // 保存颜色映射
    AppState.colorMap[school.id] = school.color;
    
    return school;
}

/**
 * 获取下一个颜色
 */
function getNextColor() {
    const color = CONFIG.districtColors[AppState.colorIndex % CONFIG.districtColors.length];
    AppState.colorIndex++;
    return color;
}

/**
 * 渲染学区
 */
function renderDistricts() {
    // 清空现有图层
    AppState.districtSource.clear();
    AppState.labelLayer.getSource().clear();
    
    const format = new ol.format.GeoJSON();
    
    AppState.schools.forEach(school => {
        // 读取 GeoJSON 特征
        const features = format.readFeatures(school.geojson, {
            featureProjection: 'EPSG:3857'
        });
        
        features.forEach(feature => {
            // 设置属性
            feature.set('schoolId', school.id);
            feature.set('color', school.color);
            feature.set('name', school.name);
        });
        
        // 添加到学区源
        AppState.districtSource.addFeatures(features);
        
        // 保存特征引用
        school.features = features;
        
        // 为每个面（MultiPolygon的每个子面）计算中心点并创建标签
        school.labelFeatures = [];
        features.forEach((feature, idx) => {
            const extent = feature.getGeometry().getExtent();
            const center = ol.extent.getCenter(extent);
            if (idx === 0) {
                school.center = ol.proj.toLonLat(center);
            }
            
            // 创建标签特征
            const labelFeature = new ol.Feature({
                geometry: new ol.geom.Point(center),
                name: school.name,
                color: school.color
            });
            
            AppState.labelLayer.getSource().addFeature(labelFeature);
            school.labelFeatures.push(labelFeature);
        });
        // 兼容旧代码：保留第一个标签的引用
        school.labelFeature = school.labelFeatures[0];
    });
}

// ============================================
// 搜索功能
// ============================================

/**
 * 处理搜索输入
 */
function handleSearch(keyword) {
    const dropdown = document.getElementById('search-dropdown');
    
    if (!keyword.trim()) {
        dropdown.classList.remove('active');
        return;
    }
    
    // 模糊匹配
    const results = AppState.schools.filter(school => 
        school.name.toLowerCase().includes(keyword.toLowerCase())
    ).slice(0, CONFIG.maxSearchResults);
    
    if (results.length === 0) {
        dropdown.innerHTML = '<div class="search-item"><div class="search-item-info"><div class="search-item-name" style="color:#999">未找到匹配的学校</div></div></div>';
    } else {
        dropdown.innerHTML = results.map(school => `
            <div class="search-item" onclick="flyToSchool('${school.id}')">
                <div class="search-item-icon" style="background: ${school.color}">🏫</div>
                <div class="search-item-info">
                    <div class="search-item-name">${highlightMatch(school.name, keyword)}</div>
                    <div class="search-item-district">${school.district}</div>
                </div>
            </div>
        `).join('');
    }
    
    dropdown.classList.add('active');
}

/**
 * 高亮匹配文本
 */
function highlightMatch(text, keyword) {
    const regex = new RegExp(`(${keyword})`, 'gi');
    return text.replace(regex, '<mark style="background:#ffeaa7;padding:0 2px;border-radius:2px;">$1</mark>');
}

/**
 * 飞移到指定学校
 */
function flyToSchool(schoolId) {
    const school = AppState.schools.find(s => s.id === schoolId);
    if (!school || !school.features || school.features.length === 0) return;
    
    // 关闭搜索下拉
    document.getElementById('search-dropdown').classList.remove('active');
    document.getElementById('search-input').value = school.name;
    
    // 选择学校
    selectSchool(school, school.features[0]);
}

// ============================================
// 学校选择与信息面板
// ============================================

/**
 * 选择学校（定位并显示详情）
 * 教育局查看模式下：学区默认已全局着色，点击仅用于定位和信息展示
 */
function selectSchool(school) {
    // 飞移到学区（使用第一个特征的范围）
    if (school.features && school.features.length > 0) {
        const extent = school.features[0].getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [100, 100, 200, 100],
            duration: 500
        });
    }
    
    // 显示该学校信息
    showInfoPanel([school]);
}

/**
 * 更新学校列表面板 - 教育局查看模式：显示所有学校，支持过滤
 */
function updateSelectedSchoolsPanel() {
    const panel = document.getElementById('selected-schools-panel');
    const list = document.getElementById('selected-schools-list');
    const count = document.getElementById('selected-count');
    
    // 获取过滤关键词
    const filterInput = document.getElementById('school-list-filter');
    const filterText = filterInput ? filterInput.value.trim().toLowerCase() : '';
    
    // 过滤并排序学校列表
    let displaySchools = AppState.schools.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (filterText) {
        displaySchools = displaySchools.filter(s => s.name.toLowerCase().includes(filterText));
    }
    
    // 更新数量显示：当前显示数 / 总数
    count.textContent = `${displaySchools.length}/${AppState.schools.length}`;
    
    // 更新列表
    list.innerHTML = '';
    displaySchools.forEach(school => {
        const item = document.createElement('div');
        item.className = 'selected-school-item';
        
        const colorDiv = document.createElement('div');
        colorDiv.className = 'selected-school-color';
        colorDiv.style.background = school.color;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'selected-school-name';
        nameSpan.textContent = school.name;
        
        const editBtn = document.createElement('button');
        editBtn.className = 'selected-school-edit';
        editBtn.title = '编辑学区';
        editBtn.innerHTML = '✏️';
        editBtn.onclick = function(e) {
            e.stopPropagation();
            startEditSchool(school.id);
        };
        
        item.appendChild(colorDiv);
        item.appendChild(nameSpan);
        item.appendChild(editBtn);
        
        item.onclick = function(e) {
            if (e.target.classList.contains('selected-school-edit')) return;
            flyToSchool(school.id);
        };
        list.appendChild(item);
    });
    
    panel.classList.add('visible');
}

/**
 * 从选中列表中移除学校（教育局查看模式下已弃用，保留兼容）
 */
function removeSelectedSchool(schoolId) {
    // 教育局查看模式下学区默认全局着色，不再需要移除高亮逻辑
    console.log('[兼容] removeSelectedSchool 已弃用');
}

/**
 * 显示信息面板 - 支持多所学校（重叠区域）
 * @param {Array} schools - 学校对象数组
 */
function showInfoPanel(schools) {
    if (!schools || schools.length === 0) return;
    
    // 存储当前显示的学校列表，用于切换
    AppState.currentInfoSchools = schools;
    AppState.currentInfoIndex = 0;
    
    // 渲染信息面板
    renderInfoPanel();
    
    document.getElementById('info-panel').classList.add('active');
}

/**
 * 渲染信息面板内容
 */
function renderInfoPanel() {
    const schools = AppState.currentInfoSchools;
    const index = AppState.currentInfoIndex || 0;
    const school = schools[index];
    
    if (!school) return;
    
    // 学校名称和切换指示器
    const nameEl = document.getElementById('info-name');
    if (schools.length > 1) {
        nameEl.textContent = `${school.name} (${index + 1}/${schools.length})`;
    } else {
        nameEl.textContent = school.name;
    }
    
    document.getElementById('info-district').innerHTML = `📍 ${school.district}`;
    document.getElementById('info-address').textContent = school.address || '-';
    document.getElementById('info-code').textContent = school.code || '-';
    
    // 图标颜色
    const iconEl = document.getElementById('info-icon');
    iconEl.style.background = school.color;
    
    // 多学校切换按钮显示/隐藏
    const prevBtn = document.getElementById('info-prev');
    const nextBtn = document.getElementById('info-next');
    if (prevBtn) prevBtn.style.display = schools.length > 1 ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = schools.length > 1 ? 'flex' : 'none';
}

/**
 * 切换到信息面板中的上一个/下一个学校
 */
function switchInfoSchool(direction) {
    const schools = AppState.currentInfoSchools;
    if (!schools || schools.length <= 1) return;
    
    let index = AppState.currentInfoIndex || 0;
    index += direction;
    if (index < 0) index = schools.length - 1;
    if (index >= schools.length) index = 0;
    
    AppState.currentInfoIndex = index;
    renderInfoPanel();
    
    // 飞移到对应的学校
    const school = schools[index];
    if (school.features && school.features.length > 0) {
        const extent = school.features[0].getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [100, 100, 250, 100],
            duration: 500
        });
    }
}

/**
 * 全览视图 - 教育局查看模式下：一键适配到所有学区范围
 */
function clearAllHighlights() {
    fitToBounds();
    showToast('已适配到全览视图');
}

/**
 * 重新定位到当前学校
 */
function relocateSchool() {
    if (AppState.selectedSchool && AppState.selectedFeature) {
        const extent = AppState.selectedFeature.getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [100, 100, 100, 100],
            duration: 500
        });
    }
}

// ============================================
// 视图控制
// ============================================

/**
 * 适配到所有学区范围
 */
function fitToBounds() {
    const extent = AppState.districtSource.getExtent();
    if (extent && ol.extent.isEmpty(extent)) {
        return;
    }
    
    AppState.map.getView().fit(extent, {
        padding: [50, 50, 50, 50],
        duration: 500
    });
}

// ============================================
// 工具函数
// ============================================

/**
 * 将十六进制颜色转换为 rgba
 */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================
// UI 工具函数
// ============================================

/**
 * 显示加载动画
 */
function showLoading(text) {
    document.getElementById('loading-text').textContent = text || '加载中...';
    document.getElementById('loading-overlay').classList.add('active');
}

/**
 * 隐藏加载动画
 */
function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

/**
 * 显示提示消息
 */
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('active');
    
    setTimeout(() => {
        toast.classList.remove('active');
    }, 2000);
}

// ============================================
// 模拟数据（用于测试）
// ============================================

/**
 * 加载模拟数据
 */
function loadMockData() {
    // 模拟湘潭市部分学区数据
    const mockSchools = [
        {
            id: 'school_001',
            name: '湘潭市第一中学',
            district: '雨湖区',
            address: '湘潭市雨湖区建设北路',
            code: 'XT001',
            color: getNextColor(),
            geojson: createMockPolygon([112.90, 27.87], '湘潭市第一中学')
        },
        {
            id: 'school_002',
            name: '湘潭市第二中学',
            district: '岳塘区',
            address: '湘潭市岳塘区建设南路',
            code: 'XT002',
            color: getNextColor(),
            geojson: createMockPolygon([112.95, 27.82], '湘潭市第二中学')
        },
        {
            id: 'school_003',
            name: '湘潭县第一中学',
            district: '湘潭县',
            address: '湘潭市湘潭县易俗河镇',
            code: 'XT003',
            color: getNextColor(),
            geojson: createMockPolygon([112.95, 27.78], '湘潭县第一中学')
        },
        {
            id: 'school_004',
            name: '湘乡市第一中学',
            district: '湘乡市',
            address: '湘潭市湘乡市东风路',
            code: 'XT004',
            color: getNextColor(),
            geojson: createMockPolygon([112.52, 27.73], '湘乡市第一中学')
        },
        {
            id: 'school_005',
            name: '韶山市第一中学',
            district: '韶山市',
            address: '湘潭市韶山市韶山冲',
            code: 'XT005',
            color: getNextColor(),
            geojson: createMockPolygon([112.48, 27.92], '韶山市第一中学')
        }
    ];
    
    // 模拟行政区划
    const mockBoundary = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: '湘潭市' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [112.30, 28.00],
                    [112.30, 27.60],
                    [113.10, 27.60],
                    [113.10, 28.00],
                    [112.30, 28.00]
                ]]
            }
        }]
    };
    
    // 设置学校数据
    AppState.schools = mockSchools;
    mockSchools.forEach(s => {
        AppState.colorMap[s.id] = s.color;
    });
    
    // 创建边界图层
    const format = new ol.format.GeoJSON();
    const boundaryFeatures = format.readFeatures(mockBoundary, {
        featureProjection: 'EPSG:3857'
    });
    AppState.boundarySource.clear();
    AppState.boundarySource.addFeatures(boundaryFeatures);
    
    // 渲染学区
    renderDistricts();
    
    // 适配视图
    fitToBounds();
    
    // 渲染学校列表面板
    updateSelectedSchoolsPanel();
    
    hideLoading();
    showToast('已加载模拟数据');
}

/**
 * 创建模拟多边形
 */
function createMockPolygon(center, name) {
    const [lng, lat] = center;
    const offset = 0.03;
    
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: name },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [lng - offset, lat - offset],
                    [lng + offset, lat - offset],
                    [lng + offset, lat + offset],
                    [lng - offset, lat + offset],
                    [lng - offset, lat - offset]
                ]]
            }
        }]
    };
}

// 点击页面其他地方关闭搜索下拉
document.addEventListener('click', function(e) {
    const searchContainer = document.querySelector('.search-container');
    if (!searchContainer.contains(e.target)) {
        document.getElementById('search-dropdown').classList.remove('active');
    }
});

// ============================================
// 学区编辑功能
// ============================================

/**
 * 开始编辑学区
 */
function startEditSchool(schoolId) {
    if (AppState.isEditing) {
        showToast('请先完成当前编辑');
        return;
    }
    
    const school = AppState.schools.find(s => s.id === schoolId);
    if (!school) {
        showToast('未找到该学校');
        return;
    }
    
    // 飞移到该学校位置（教育局查看模式下默认全局着色，无需额外高亮）
    if (school.features && school.features.length > 0) {
        const extent = school.features[0].getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [150, 150, 250, 150],
            duration: 500,
            maxZoom: 16
        });
    }
    
    // 获取该学校的特征
    const schoolFeatures = AppState.districtSource.getFeatures().filter(
        f => f.get('schoolId') === schoolId
    );
    
    if (schoolFeatures.length === 0) {
        showToast('未找到该学区的地理数据');
        return;
    }
    
    // 使用第一个特征进行编辑（如果是MultiPolygon，编辑第一个）
    const feature = schoolFeatures[0];
    
    // 保存原始几何用于取消
    AppState.originalGeometry = feature.getGeometry().clone();
    
    // 设置编辑状态
    AppState.isEditing = true;
    AppState.editingSchool = school;
    AppState.editingFeature = feature;
    
    // 显示编辑工具栏
    document.getElementById('edit-school-name').textContent = `编辑: ${school.name}`;
    document.getElementById('edit-toolbar').classList.add('visible');
    
    // 创建修改交互（移动端友好的大触摸点）
    createModifyInteraction(feature);
    
    // 切换到适合编辑的缩放级别
    const extent = feature.getGeometry().getExtent();
    AppState.map.getView().fit(extent, {
        padding: [150, 150, 250, 150],
        duration: 500,
        maxZoom: 16
    });
    
    // 隐藏选中学校列表面板
    document.getElementById('selected-schools-panel').classList.remove('visible');
    
    showToast('拖动蓝点调整边界形状');
}

/**
 * 创建修改交互
 */
function createModifyInteraction(feature) {
    // 创建一个新的矢量源用于编辑
    const editSource = new ol.source.Vector({
        features: [feature]
    });
    
    // 删除模式状态
    AppState.isDeleteMode = false;
    
    // 创建修改交互 - 移动端优化的样式
    AppState.modifyInteraction = new ol.interaction.Modify({
        source: editSource,
        style: function(feature) {
            // 根据是否删除模式返回不同样式
            const isDeleteMode = AppState.isDeleteMode;
            return new ol.style.Style({
                // 顶点样式 - 大圆点便于触摸
                image: new ol.style.Circle({
                    radius: isDeleteMode ? 14 : 12,
                    fill: new ol.style.Fill({
                        color: isDeleteMode ? '#ff6b6b' : '#667eea'
                    }),
                    stroke: new ol.style.Stroke({
                        color: '#ffffff',
                        width: 3
                    })
                }),
                // 线段样式
                stroke: new ol.style.Stroke({
                    color: isDeleteMode ? '#ff6b6b' : '#667eea',
                    width: isDeleteMode ? 4 : 3
                })
            });
        },
        // 插入顶点条件 - 双击添加新点（仅在非删除模式下）
        insertVertexCondition: function(event) {
            // 删除模式下不添加顶点
            if (AppState.isDeleteMode) return false;
            return ol.events.condition.doubleClick(event);
        },
        // 删除顶点条件 - 在删除模式下，单击顶点即可删除
        deleteCondition: function(event) {
            return AppState.isDeleteMode && ol.events.condition.singleClick(event);
        }
    });
    
    // 添加修改事件监听
    AppState.modifyInteraction.on('modifyend', function(evt) {
        if (AppState.isDeleteMode) {
            console.log('顶点已删除');
            showToast('顶点已删除');
        } else {
            console.log('修改完成');
            showToast('边界已修改，请记得导出保存！');
        }
    });
    
    AppState.map.addInteraction(AppState.modifyInteraction);
    
    // 更改光标样式
    AppState.map.getTargetElement().style.cursor = 'crosshair';
}

/**
 * 切换删除模式
 */
function toggleDeleteMode() {
    if (!AppState.isEditing) return;
    
    AppState.isDeleteMode = !AppState.isDeleteMode;
    
    const deleteBtn = document.getElementById('delete-mode-btn');
    const normalHint = document.getElementById('edit-hint-normal');
    const deleteHint = document.getElementById('edit-hint-delete');
    
    if (AppState.isDeleteMode) {
        // 进入删除模式
        deleteBtn.textContent = '✓ 完成删除';
        deleteBtn.classList.add('active');
        normalHint.style.display = 'none';
        deleteHint.style.display = 'block';
        showToast('删除模式：点击红点删除顶点');
    } else {
        // 退出删除模式
        deleteBtn.textContent = '🗑️ 删除顶点';
        deleteBtn.classList.remove('active');
        normalHint.style.display = 'block';
        deleteHint.style.display = 'none';
        showToast('已退出删除模式');
    }
    
    // 刷新修改交互以更新样式
    if (AppState.modifyInteraction) {
        AppState.modifyInteraction.changed();
    }
}

/**
 * 取消编辑
 */
function cancelEdit() {
    if (!AppState.isEditing || !AppState.editingFeature) {
        return;
    }
    
    // 恢复原始几何
    if (AppState.originalGeometry) {
        AppState.editingFeature.setGeometry(AppState.originalGeometry);
    }
    
    // 移除修改交互
    if (AppState.modifyInteraction) {
        AppState.map.removeInteraction(AppState.modifyInteraction);
        AppState.modifyInteraction = null;
    }
    
    // 重置编辑状态
    AppState.isEditing = false;
    AppState.editingSchool = null;
    AppState.editingFeature = null;
    AppState.originalGeometry = null;
    AppState.isDeleteMode = false;
    
    // 重置UI状态
    const deleteBtn = document.getElementById('delete-mode-btn');
    const normalHint = document.getElementById('edit-hint-normal');
    const deleteHint = document.getElementById('edit-hint-delete');
    if (deleteBtn) {
        deleteBtn.textContent = '🗑️ 删除顶点';
        deleteBtn.classList.remove('active');
    }
    if (normalHint) normalHint.style.display = 'block';
    if (deleteHint) deleteHint.style.display = 'none';
    
    // 隐藏编辑工具栏
    document.getElementById('edit-toolbar').classList.remove('visible');
    
    // 恢复光标样式
    AppState.map.getTargetElement().style.cursor = '';
    
    // 显示选中学校列表面板
    updateSelectedSchoolsPanel();
    
    showToast('已取消编辑');
}

/**
 * 导出编辑后的学区
 */
function exportEditedDistrict() {
    if (!AppState.isEditing || !AppState.editingFeature) {
        showToast('当前没有正在编辑的学区');
        return;
    }
    
    const school = AppState.editingSchool;
    const geometry = AppState.editingFeature.getGeometry();
    
    // 创建GeoJSON格式器
    const format = new ol.format.GeoJSON();
    
    // 转换为GeoJSON几何
    const geojsonGeometry = format.writeGeometry(geometry, {
        featureProjection: 'EPSG:3857',
        dataProjection: 'EPSG:4326'
    });
    
    // 构建完整的GeoJSON对象
    const geojson = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: {
                name: school.name,
                school_name: school.name,
                district: school.district,
                address: school.address,
                code: school.code,
                id: school.id,
                edit_time: new Date().toISOString()
            },
            geometry: JSON.parse(geojsonGeometry)
        }]
    };
    
    // 生成文件名
    const filename = `${school.name}_学区_${new Date().toISOString().slice(0, 10)}.geojson`;
    
    // 显示确认对话框
    showConfirmDialog(
        '确认导出',
        `即将导出 "${school.name}" 的学区边界`,
        filename,
        function() {
            // 确认导出
            downloadGeoJSON(geojson, filename);
            
            // 结束编辑模式但保留修改
            finishEditWithoutRestore();
            
            showToast('导出成功！请记得把文件交给教育局工作人员');
        }
    );
}

/**
 * 完成编辑但不恢复原始状态（导出后调用）
 */
function finishEditWithoutRestore() {
    // 移除修改交互
    if (AppState.modifyInteraction) {
        AppState.map.removeInteraction(AppState.modifyInteraction);
        AppState.modifyInteraction = null;
    }
    
    // 重置编辑状态
    AppState.isEditing = false;
    AppState.editingSchool = null;
    AppState.editingFeature = null;
    AppState.originalGeometry = null;
    AppState.isDeleteMode = false;
    
    // 重置UI状态
    const deleteBtn = document.getElementById('delete-mode-btn');
    const normalHint = document.getElementById('edit-hint-normal');
    const deleteHint = document.getElementById('edit-hint-delete');
    if (deleteBtn) {
        deleteBtn.textContent = '🗑️ 删除顶点';
        deleteBtn.classList.remove('active');
    }
    if (normalHint) normalHint.style.display = 'block';
    if (deleteHint) deleteHint.style.display = 'none';
    
    // 隐藏编辑工具栏
    document.getElementById('edit-toolbar').classList.remove('visible');
    
    // 恢复光标样式
    AppState.map.getTargetElement().style.cursor = '';
    
    // 显示选中学校列表面板
    updateSelectedSchoolsPanel();
}

/**
 * 下载GeoJSON文件
 */
function downloadGeoJSON(geojson, filename) {
    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
        type: 'application/geo+json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// 导入功能
// ============================================

/**
 * 触发文件选择
 */
function triggerImport() {
    document.getElementById('file-input').click();
}

/**
 * 处理文件导入
 */
function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    
    // 验证文件类型
    if (!file.name.endsWith('.geojson') && !file.name.endsWith('.json')) {
        showToast('请选择 .geojson 或 .json 文件');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const geojson = JSON.parse(e.target.result);
            importDistrict(geojson, file.name);
        } catch (error) {
            showToast('文件解析失败: ' + error.message);
            console.error('导入错误:', error);
        }
    };
    
    reader.onerror = function() {
        showToast('文件读取失败');
    };
    
    reader.readAsText(file);
    
    // 清空文件输入，允许重复选择同一文件
    event.target.value = '';
}

/**
 * 导入学区并高亮显示
 */
function importDistrict(geojson, filename) {
    try {
        // 验证GeoJSON格式
        if (!geojson.type || !geojson.features || !Array.isArray(geojson.features)) {
            showToast('无效的GeoJSON格式');
            return;
        }
        
        // 清除之前的导入
        clearImportedDistricts();
        
        // 读取特征
        const format = new ol.format.GeoJSON();
        const features = format.readFeatures(geojson, {
            featureProjection: 'EPSG:3857'
        });
        
        if (features.length === 0) {
            showToast('未找到有效的地理数据');
            return;
        }
        
        // 生成导入学区的颜色（醒目的橙色）
        const importColor = '#FF9500';
        
        // 设置导入特征的样式和高亮
        features.forEach((feature, index) => {
            // 从GeoJSON属性中获取学校名称
            const properties = geojson.features[index]?.properties || {};
            const schoolName = properties.name || properties.school_name || filename.replace('.geojson', '');
            
            feature.set('imported', true);
            feature.set('name', schoolName);
            feature.set('color', importColor);
            
            // 设置高亮样式
            feature.setStyle(new ol.style.Style({
                fill: new ol.style.Fill({
                    color: hexToRgba(importColor, 0.5)
                }),
                stroke: new ol.style.Stroke({
                    color: importColor,
                    width: 4,
                    lineDash: [10, 5]
                })
            }));
        });
        
        // 添加到学区源
        AppState.districtSource.addFeatures(features);
        AppState.importedFeatures = features;
        
        // 获取学校名称
        const schoolName = features[0].get('name');
        
        // 缩放到导入的学区
        const extent = features[0].getGeometry().getExtent();
        AppState.map.getView().fit(extent, {
            padding: [100, 100, 150, 100],
            duration: 500
        });
        
        // 显示清除高亮按钮
        const clearBtn = document.getElementById('clear-highlight-btn');
        if (clearBtn) {
            clearBtn.classList.add('visible');
        }
        
        showToast(`已导入并高亮: ${schoolName}`);
        
        // 显示确认对话框提示用户可以验证
        setTimeout(() => {
            showConfirmDialog(
                '导入验证',
                `"${schoolName}" 已成功导入并高亮显示`,
                null,
                function() {
                    closeConfirmDialog();
                },
                '确定',
                '取消'
            );
        }, 800);
        
    } catch (error) {
        showToast('导入失败: ' + error.message);
        console.error('导入错误:', error);
    }
}

/**
 * 清除导入的学区
 */
function clearImportedDistricts() {
    if (AppState.importedFeatures && AppState.importedFeatures.length > 0) {
        AppState.importedFeatures.forEach(feature => {
            AppState.districtSource.removeFeature(feature);
        });
        AppState.importedFeatures = [];
    }
}

// ============================================
// 确认对话框
// ============================================

/**
 * 显示确认对话框
 */
function showConfirmDialog(title, message, filename, onConfirm, confirmText, cancelText) {
    const dialog = document.getElementById('confirm-dialog');
    
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    // 设置文件名显示
    const filenameEl = document.getElementById('confirm-filename');
    if (filename) {
        filenameEl.textContent = `文件名: ${filename}`;
        filenameEl.style.display = 'block';
    } else {
        filenameEl.style.display = 'none';
    }
    
    // 设置按钮文字
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    
    okBtn.textContent = confirmText || '确认';
    cancelBtn.textContent = cancelText || '取消';
    
    // 绑定确认事件
    okBtn.onclick = function() {
        closeConfirmDialog();
        if (onConfirm) onConfirm();
    };
    
    dialog.classList.add('visible');
}

/**
 * 关闭确认对话框
 */
function closeConfirmDialog() {
    const dialog = document.getElementById('confirm-dialog');
    dialog.classList.remove('visible');
}

// 覆盖原有的 clearAllHighlights 函数，添加清除导入功能
const originalClearAllHighlights = clearAllHighlights;
clearAllHighlights = function() {
    // 先清除导入的学区
    clearImportedDistricts();
    
    // 调用原有的清除高亮函数
    originalClearAllHighlights();
};
