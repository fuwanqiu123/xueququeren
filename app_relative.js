/**
 * 台账关联系统 - 主应用
 * 基于 OpenLayers 8.2.0 + 天地图
 */

// ============================================
// 全局状态
// ============================================
const AppState = {
    // 地图实例
    map: null,
    
    // 底图图层
    baseLayers: {},
    
    // 当前显示的底图类型
    currentMapType: 'vec',
    
    // 矢量数据源
    vectorSource: null,
    
    // 矢量图层
    vectorLayer: null,
    
    // 绘制交互
    drawInteraction: null,
    
    // 修改交互
    modifyInteraction: null,
    
    // 选中要素
    selectedFeature: null,
    
    // 台账数据
    ledgers: [],
    
    // 当前选中的台账
    selectedLedger: null,
    
    // 当前标签页
    currentTab: 'all',
    
    // 是否正在绘制
    isDrawing: false,
    
    // 搜索关键词
    searchKeyword: '',
    
    // ArcGIS 楼栋图层
    arcgisLayer: null,
    
    // 搜索高亮源
    highlightSource: null,
    
    // 搜索高亮图层
    highlightLayer: null
};

// 北京范围（经纬度）：严格限制天地图搜索结果
const BEIJING_BOUNDS = {
    minLon: 115.7,
    minLat: 39.4,
    maxLon: 117.4,
    maxLat: 41.6,
    toMapBound: function() {
        return `${this.minLon},${this.minLat},${this.maxLon},${this.maxLat}`;
    }
};

/**
 * 判断坐标是否在北京范围内
 */
function isInBeijing(lon, lat) {
    return lon >= BEIJING_BOUNDS.minLon && lon <= BEIJING_BOUNDS.maxLon &&
           lat >= BEIJING_BOUNDS.minLat && lat <= BEIJING_BOUNDS.maxLat;
}

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    initMap();
    loadDemoData();
    setupMapEvents();
});

// ============================================
// 天地图源创建（参考 app.js）
// ============================================

/**
 * 创建天地图瓦片源（支持KEY轮询）
 */
function createTiandituSource(layerType) {
    const layerMap = {
        'vec': 'vec_w',
        'cva': 'cva_w',
        'img': 'img_w',
        'cia': 'cia_w'
    };
    
    const layerName = layerMap[layerType] || layerType;
    let key = TiandituKeyManager.getCurrentKey();
    key = TiandituKeyManager.recordUsage(key);
    
    const urls = [];
    for (let i = 0; i <= 7; i++) {
        urls.push(`https://t${i}.tianditu.gov.cn/${layerName}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerType}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`);
    }
    
    const source = new ol.source.XYZ({
        urls: urls,
        maxZoom: CONFIG.maxZoom,
        attributions: '\u00a9 \u5929\u5730\u56fe'
    });
    
    let errorCount = 0;
    const MAX_ERRORS = 5;
    
    source.on('tileloaderror', function(event) {
        errorCount++;
        console.warn(`[\u5929\u5730\u56fe] \u74e6\u7247\u52a0\u8f7d\u9519\u8bef (${errorCount}/${MAX_ERRORS}):`, event.tile.getKey());
        
        if (errorCount >= MAX_ERRORS) {
            console.warn('[\u5929\u5730\u56fe] \u8fde\u7eed\u591a\u6b21\u52a0\u8f7d\u5931\u8d25\uff0c\u89e6\u53d1Key\u8f6e\u6362');
            errorCount = 0;
            const newKey = TiandituKeyManager.getNextKey();
            if (newKey) {
                showToast('\u5929\u5730\u56feKey\u5df2\u81ea\u52a8\u8f6e\u6362\uff0c\u7ee7\u7eed\u52a0\u8f7d...');
                setTimeout(() => {
                    refreshTiandituSources();
                }, 1000);
            }
        }
    });
    
    source.on('tileloadend', function() {
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
    // 矢量底图
    AppState.baseLayers.vec = new ol.layer.Tile({
        source: createTiandituSource('vec'),
        visible: true
    });
    
    // 矢量注记
    AppState.baseLayers.vecLabel = new ol.layer.Tile({
        source: createTiandituSource('cva'),
        visible: true
    });
    
    // 影像底图
    AppState.baseLayers.img = new ol.layer.Tile({
        source: createTiandituSource('img'),
        visible: false
    });
    
    // 影像注记
    AppState.baseLayers.imgLabel = new ol.layer.Tile({
        source: createTiandituSource('cia'),
        visible: false
    });
    
    // 矢量数据源
    AppState.vectorSource = new ol.source.Vector();
    
    // 矢量图层
    AppState.vectorLayer = new ol.layer.Vector({
        source: AppState.vectorSource,
        style: function(feature) {
            const isLinked = feature.get('linked');
            const isSelected = feature.get('selected');
            
            let fillColor = isLinked ? 'rgba(102, 126, 234, 0.3)' : 'rgba(255, 107, 107, 0.2)';
            let strokeColor = isLinked ? '#667eea' : '#ff6b6b';
            let strokeWidth = isSelected ? 4 : 2;
            
            if (isSelected) {
                fillColor = 'rgba(102, 126, 234, 0.5)';
            }
            
            return new ol.style.Style({
                fill: new ol.style.Fill({
                    color: fillColor
                }),
                stroke: new ol.style.Stroke({
                    color: strokeColor,
                    width: strokeWidth
                })
            });
        },
        zIndex: 10
    });
    
    // ============================================
    // ArcGIS 楼栋图层（北京市）
    // ============================================
    AppState.arcgisLayer = new ol.layer.Tile({
        source: new ol.source.TileArcGISRest({
            url: 'https://fwaq.zjw.beijing.gov.cn/feature/arcgis/rest/services/sde_ywzt_build_2000/MapServer',
            params: {
                TRANSPARENT: true,
                FORMAT: 'PNG32'
            }
        }),
        opacity: 1,
        visible: false,
        zIndex: 6
    });
    
    // ============================================
    // 搜索高亮标记图层
    // ============================================
    AppState.highlightSource = new ol.source.Vector();
    
    AppState.highlightLayer = new ol.layer.Vector({
        source: AppState.highlightSource,
        style: new ol.style.Style({
            image: new ol.style.Circle({
                radius: 14,
                fill: new ol.style.Fill({ color: 'rgba(255, 59, 48, 0.35)' }),
                stroke: new ol.style.Stroke({ color: '#ff3b30', width: 3 })
            })
        }),
        zIndex: 50
    });
    
    // 创建视图（默认北京）
    const view = new ol.View({
        center: ol.proj.fromLonLat([116.4074, 39.9042]),
        zoom: 12,
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
            AppState.arcgisLayer,
            AppState.vectorLayer,
            AppState.highlightLayer
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
    
    console.log('[\u5730\u56fe] \u521d\u59cb\u5316\u5b8c\u6210');
}

/**
 * 刷新天地图源
 */
function refreshTiandituSources() {
    AppState.baseLayers.vec.setSource(createTiandituSource('vec'));
    AppState.baseLayers.vecLabel.setSource(createTiandituSource('cva'));
    AppState.baseLayers.img.setSource(createTiandituSource('img'));
    AppState.baseLayers.imgLabel.setSource(createTiandituSource('cia'));
    console.log('[\u5730\u56fe\u6e90] \u5df2\u5237\u65b0\u5929\u5730\u56fe\u74e6\u7247\u6e90');
}

/**
 * 切换地图类型
 */
function switchMapType(type) {
    AppState.currentMapType = type;
    
    document.getElementById('btn-vec').classList.toggle('active', type === 'vec');
    document.getElementById('btn-img').classList.toggle('active', type === 'img');
    
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
// 地图事件
// ============================================

function setupMapEvents() {
    // 点击事件
    AppState.map.on('click', function(event) {
        // 坐标复制到剪贴板模式
        if (isCopyPickMode) {
            const coord = ol.proj.toLonLat(event.coordinate);
            finishCopyPickMode(coord[0], coord[1]);
            return;
        }
        
        // 地图拾取模式优先
        if (currentPickLedgerId) {
            const coord = ol.proj.toLonLat(event.coordinate);
            finishMapPick(coord[0], coord[1]);
            return;
        }
        
        const feature = AppState.map.forEachFeatureAtPixel(event.pixel, function(f) {
            return f;
        }, {
            layerFilter: function(layer) {
                return layer === AppState.vectorLayer;
            }
        });
        
        if (feature) {
            selectFeature(feature);
            return;
        }
        
        // 如果楼栋图层开启且未点击到矢量要素，尝试 Identify 查询楼栋
        if (AppState.arcgisLayer && AppState.arcgisLayer.getVisible()) {
            identifyBuilding(event.pixel);
        } else {
            clearSelection();
            hideBuildingPanel();
            AppState.highlightSource.clear();
        }
    });
    
    // 鼠标移动事件
    AppState.map.on('pointermove', function(event) {
        if (isCopyPickMode || currentPickLedgerId) {
            AppState.map.getTargetElement().style.cursor = 'crosshair';
            return;
        }
        
        const feature = AppState.map.forEachFeatureAtPixel(event.pixel, function(f) {
            return f;
        }, {
            layerFilter: function(layer) {
                return layer === AppState.vectorLayer;
            }
        });
        
        AppState.map.getTargetElement().style.cursor = feature ? 'pointer' : '';
        
        // 更新坐标显示
        const coord = ol.proj.toLonLat(event.coordinate);
        document.getElementById('mouse-coords').textContent = 
            `\u7ecf\u5ea6: ${coord[0].toFixed(5)}  \u7eac\u5ea6: ${coord[1].toFixed(5)}`;
    });
    
    // 比例尺更新
    AppState.map.on('moveend', function() {
        const view = AppState.map.getView();
        const resolution = view.getResolution();
        const units = view.getProjection().getUnits();
        let scale = Math.round(resolution * 1000);
        document.getElementById('map-scale').textContent = `\u6bd4\u4f8b\u5c3a: 1:${scale.toLocaleString()}`;
    });
}

// ============================================
// 台账数据管理
// ============================================

/**
 * 初始化台账数据（默认空，需用户导入）
 */
function loadDemoData() {
    AppState.ledgers = [];
    renderLedgerList();
}

/**
 * 添加演示要素到地图（北京坐标）
 */
function addDemoFeatures() {
    const center = [116.4074, 39.9042];
    
    // 创建一些演示多边形
    const demoGeometries = [
        [[center[0]-0.03, center[1]-0.02], [center[0]-0.01, center[1]-0.02], [center[0]-0.01, center[1]], [center[0]-0.03, center[1]], [center[0]-0.03, center[1]-0.02]],
        [[center[0]+0.01, center[1]-0.01], [center[0]+0.03, center[1]-0.01], [center[0]+0.03, center[1]+0.01], [center[0]+0.01, center[1]+0.01], [center[0]+0.01, center[1]-0.01]],
        [[center[0]-0.02, center[1]+0.01], [center[0], center[1]+0.01], [center[0], center[1]+0.03], [center[0]-0.02, center[1]+0.03], [center[0]-0.02, center[1]+0.01]],
        [[center[0]+0.02, center[1]+0.02], [center[0]+0.04, center[1]+0.02], [center[0]+0.04, center[1]+0.04], [center[0]+0.02, center[1]+0.04], [center[0]+0.02, center[1]+0.02]],
    ];
    
    const linkedLedgers = AppState.ledgers.filter(l => l.linked);
    
    demoGeometries.forEach((coords, index) => {
        if (linkedLedgers[index]) {
            const polygon = new ol.geom.Polygon([coords.map(c => ol.proj.fromLonLat(c))]);
            const feature = new ol.Feature({
                geometry: polygon,
                linked: true,
                selected: false,
                ledgerId: linkedLedgers[index].id
            });
            AppState.vectorSource.addFeature(feature);
        }
    });
}

// ============================================
// 台账列表渲染
// ============================================

function renderLedgerList() {
    const listEl = document.getElementById('ledger-list');
    const countEl = document.getElementById('ledger-count');
    
    let filtered = AppState.ledgers;
    
    // 标签过滤
    if (AppState.currentTab === 'mapped') {
        filtered = filtered.filter(l => !!l.fwbm);
    } else if (AppState.currentTab === 'located') {
        filtered = filtered.filter(l => !l.fwbm && !!l.kjwz && l.lon !== null && l.lat !== null);
    } else if (AppState.currentTab === 'unmapped') {
        filtered = filtered.filter(l => !l.fwbm && (!l.kjwz || l.lon === null || l.lat === null));
    }
    
    // 搜索过滤
    if (AppState.searchKeyword) {
        const kw = AppState.searchKeyword.toLowerCase();
        filtered = filtered.filter(l => 
            (l.name || '').toLowerCase().includes(kw) || 
            (l.id || '').toLowerCase().includes(kw) ||
            (l.address || '').toLowerCase().includes(kw) ||
            (l.fwbm || '').toLowerCase().includes(kw)
        );
    }
    
    countEl.textContent = `共 ${filtered.length} 条`;
    
    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999;font-size:13px;">暂无台账数据</div>';
        return;
    }
    
    listEl.innerHTML = filtered.map(ledger => {
        const hasFwbm = !!ledger.fwbm;
        const hasKjwz = !!ledger.kjwz && ledger.lon !== null && ledger.lat !== null;
        
        let tagClass = 'unlinked';
        let tagText = '未上图';
        let subInfo = '';
        
        if (hasFwbm) {
            tagClass = '';
            tagText = '已上图';
            subInfo = `<span>房屋编码: ${ledger.fwbm}</span>`;
        } else if (hasKjwz) {
            tagClass = 'location-linked';
            tagText = '有位置';
            subInfo = `<span>坐标: ${ledger.lon.toFixed(5)}, ${ledger.lat.toFixed(5)}</span>`;
        } else {
            tagClass = 'unlinked';
            tagText = '未上图';
            subInfo = `<button class="ledger-link-btn" onclick="event.stopPropagation(); startLinkLedger('${ledger.id}')">关联</button>`;
        }
        
        return `
            <div class="ledger-item ${AppState.selectedLedger?.id === ledger.id ? 'active' : ''}" 
                 data-id="${ledger.id}" 
                 onclick="selectLedger('${ledger.id}')">
                <div class="ledger-item-header">
                    <div class="ledger-item-name">${ledger.name || '未命名台账'}</div>
                    <div class="ledger-item-tag ${tagClass}">${tagText}</div>
                </div>
                <div class="ledger-item-info">
                    <span>&#128205; ${ledger.address || '-'}</span>
                    ${subInfo}
                </div>
            </div>
        `;
    }).join('');
}

function switchTab(tab) {
    AppState.currentTab = tab;
    document.querySelectorAll('.panel-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    renderLedgerList();
}

function handleSearch(keyword) {
    AppState.searchKeyword = keyword;
    renderLedgerList();
}

function selectLedger(id) {
    const ledger = AppState.ledgers.find(l => l.id === id);
    if (!ledger) return;
    
    AppState.selectedLedger = ledger;
    renderLedgerList();
    
    // 查找并选中对应的地图要素
    const features = AppState.vectorSource.getFeatures();
    const targetFeature = features.find(f => f.get('ledgerId') === id);
    
    if (targetFeature) {
        selectFeature(targetFeature);
    } else {
        clearSelection();
    }
    
    showToast(`\u5df2\u9009\u4e2d: ${ledger.name}`);
}

// ============================================
// 要素选择
// ============================================

function selectFeature(feature) {
    // 清除之前的选中状态
    clearSelection(false);
    
    feature.set('selected', true);
    AppState.selectedFeature = feature;
    
    // 更新台账选中状态
    const ledgerId = feature.get('ledgerId');
    if (ledgerId) {
        AppState.selectedLedger = AppState.ledgers.find(l => l.id === ledgerId);
        renderLedgerList();
    }
    
    // 高亮样式更新
    feature.changed();
}

function clearSelection(updateUI = true) {
    if (AppState.selectedFeature) {
        AppState.selectedFeature.set('selected', false);
        AppState.selectedFeature.changed();
        AppState.selectedFeature = null;
    }
    
    if (updateUI) {
        AppState.selectedLedger = null;
        renderLedgerList();
    }
}

// ============================================
// 绘制与关联
// ============================================

function startDraw() {
    if (!AppState.selectedLedger) {
        showToast('\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u9700\u8981\u5173\u8054\u7684\u53f0\u8d26');
        return;
    }
    
    if (AppState.isDrawing) {
        stopDraw();
        return;
    }
    
    AppState.isDrawing = true;
    
    AppState.drawInteraction = new ol.interaction.Draw({
        source: AppState.vectorSource,
        type: 'Polygon'
    });
    
    AppState.drawInteraction.on('drawend', function(event) {
        const feature = event.feature;
        feature.set('linked', false);
        feature.set('selected', false);
        feature.set('ledgerId', null);
        
        stopDraw();
        
        // 显示关联确认弹窗
        showLinkModal(feature);
    });
    
    AppState.map.addInteraction(AppState.drawInteraction);
    showToast('\u8bf7\u5728\u5730\u56fe\u4e0a\u7ed8\u5236\u5173\u8054\u533a\u57df\uff0c\u53cc\u51fb\u7ed3\u675f\u7ed8\u5236');
}

function stopDraw() {
    AppState.isDrawing = false;
    if (AppState.drawInteraction) {
        AppState.map.removeInteraction(AppState.drawInteraction);
        AppState.drawInteraction = null;
    }
}

let pendingFeature = null;

function showLinkModal(feature) {
    pendingFeature = feature;
    document.getElementById('link-modal-body').innerHTML = `
        \u5c06\u533a\u57df\u4e0e\u53f0\u8d26 <strong>${AppState.selectedLedger.name}</strong> (\u7f16\u53f7: ${AppState.selectedLedger.id}) \u8fdb\u884c\u5173\u8054\uff1f
        <br><br>
        <span style="color:#999;font-size:12px;">\u7ed8\u5236\u5b8c\u6210\u540e\uff0c\u60a8\u4ecd\u53ef\u4ee5\u7ee7\u7eed\u8c03\u6574\u8fb9\u754c\u3002</span>
    `;
    document.getElementById('link-modal').classList.add('visible');
}

function closeLinkModal() {
    document.getElementById('link-modal').classList.remove('visible');
    if (pendingFeature) {
        AppState.vectorSource.removeFeature(pendingFeature);
        pendingFeature = null;
    }
}

function confirmLink() {
    if (pendingFeature && AppState.selectedLedger) {
        pendingFeature.set('linked', true);
        pendingFeature.set('ledgerId', AppState.selectedLedger.id);
        pendingFeature.changed();
        
        // 更新台账关联状态
        const ledger = AppState.ledgers.find(l => l.id === AppState.selectedLedger.id);
        if (ledger) {
            ledger.linked = true;
        }
        
        renderLedgerList();
        showToast(`\u5df2\u5c06\u533a\u57df\u4e0e ${AppState.selectedLedger.name} \u5173\u8054`);
    }
    
    document.getElementById('link-modal').classList.remove('visible');
    pendingFeature = null;
}

// ============================================
// 工具函数
// ============================================

function togglePanel() {
    const panel = document.getElementById('ledger-panel');
    const toggle = document.getElementById('panel-toggle');
    panel.classList.toggle('collapsed');
    toggle.innerHTML = panel.classList.contains('collapsed') ? '&#9654;' : '&#9664;';
}

function locatePosition() {
    const input = prompt('\u8bf7\u8f93\u5165\u7ecf\u7eac\u5ea6\u5750\u6807\uff08\u683c\u5f0f\uff1a113.1231,32.122 \u6216 113.1231 32.122\uff09\uff1a');
    if (!input || !input.trim()) return;

    const trimmed = input.trim();
    const parts = trimmed.split(/,|\s+/).filter(s => s.length > 0);

    let lon = NaN, lat = NaN;
    if (parts.length >= 2) {
        lon = parseFloat(parts[0]);
        lat = parseFloat(parts[1]);
    }

    if (isNaN(lon) || isNaN(lat)) {
        showToast('\u5750\u6807\u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u6309\u6b63\u786e\u683c\u5f0f\u8f93\u5165');
        return;
    }

    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        showToast('\u5750\u6807\u6570\u503c\u8d85\u51fa\u6709\u6548\u8303\u56f4');
        return;
    }

    // \u6e05\u9664\u65e7\u9ad8\u4eae\uff0c\u6dfb\u52a0\u65b0\u9ad8\u4eae
    AppState.highlightSource.clear();
    const highlightFeature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat]))
    });
    AppState.highlightSource.addFeature(highlightFeature);

    AppState.map.getView().animate({
        center: ol.proj.fromLonLat([lon, lat]),
        zoom: 18,
        duration: 1000
    });

    showToast(`\u5df2\u5b9a\u4f4d\u5230\uff1a${lon.toFixed(5)}, ${lat.toFixed(5)}`);
}

function fitToExtent() {
    const extent = AppState.vectorSource.getExtent();
    if (extent && extent[0] !== Infinity) {
        AppState.map.getView().fit(extent, {
            padding: [50, 50, 50, 50],
            duration: 800
        });
    } else {
        AppState.map.getView().animate({
            center: ol.proj.fromLonLat(CONFIG.defaultCenter),
            zoom: CONFIG.defaultZoom,
            duration: 800
        });
    }
}

// ============================================
// ArcGIS 楼栋图层控制
// ============================================

/**
 * 切换楼栋图层显示
 */
function toggleBuildingsLayer() {
    if (!AppState.arcgisLayer) return;
    
    const visible = !AppState.arcgisLayer.getVisible();
    AppState.arcgisLayer.setVisible(visible);
    
    // 更新按钮样式
    const btn = document.getElementById('btn-buildings');
    if (btn) {
        btn.style.background = visible ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'white';
        btn.style.color = visible ? 'white' : '#333';
    }
    
    showToast(visible ? '\u5df2\u663e\u793a\u5317\u4eac\u5e02\u697c\u680b\u56fe\u5c42' : '\u5df2\u9690\u85cf\u5317\u4eac\u5e02\u697c\u680b\u56fe\u5c42');
    
    // 如果开启且当前不在北京附近，提示用户跳转
    if (visible) {
        const center = ol.proj.toLonLat(AppState.map.getView().getCenter());
        const beijing = [116.4074, 39.9042];
        const distance = Math.sqrt(
            Math.pow(center[0] - beijing[0], 2) + 
            Math.pow(center[1] - beijing[1], 2)
        );
        if (distance > 2) {
            showToast('\u6b63\u5728\u8df3\u8f6c\u5230\u5317\u4eac\u5e02...');
            goToBeijing();
        }
    }
}

// ============================================
// ArcGIS 楼栋地址搜索（Query）
// ============================================

let buildingSearchTimer = null;
let buildingSearchAbort = null;

/**
 * 处理楼栋地址搜索输入（防抖）
 */
function handleBuildingSearch(keyword) {
    const clearBtn = document.getElementById('building-search-clear');
    clearBtn.classList.toggle('visible', !!keyword);
    
    if (buildingSearchTimer) clearTimeout(buildingSearchTimer);
    
    if (!keyword.trim()) {
        document.getElementById('building-search-dropdown').classList.remove('active');
        return;
    }
    
    buildingSearchTimer = setTimeout(() => {
        doBuildingSearch(keyword.trim());
    }, 400);
}

/**
 * 执行兴趣点搜索（天地图 POI 搜索）
 */
async function doBuildingSearch(keyword) {
    const dropdown = document.getElementById('building-search-dropdown');
    dropdown.innerHTML = '<div class="building-search-loading">搜索中...</div>';
    dropdown.classList.add('active');
    
    if (buildingSearchAbort) buildingSearchAbort.abort();
    buildingSearchAbort = new AbortController();
    
    try {
        // 限制在北京范围内搜索
        const mapBound = BEIJING_BOUNDS.toMapBound();
        
        // 使用 TiandituKeyManager 获取当前 KEY（参考 app.js）
        let key = TiandituKeyManager.getCurrentKey();
        key = TiandituKeyManager.recordUsage(key);
        
        const postStr = JSON.stringify({
            keyWord: keyword,
            level: 12,
            mapBound: mapBound,
            queryType: 1,
            start: 0,
            count: 20
        });
        
        const url = `https://api.tianditu.gov.cn/v2/search?postStr=${encodeURIComponent(postStr)}&type=query&tk=${key}`;
        
        const response = await fetch(url, { 
            mode: 'cors',
            signal: buildingSearchAbort.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        // 严格过滤：只保留北京范围内的结果
        const filteredPois = (data.pois || []).filter(poi => {
            const center = parseTiandituPoint(poi.point || poi.lonlat);
            if (!center) return false;
            return isInBeijing(center[0], center[1]);
        });
        
        if (filteredPois.length > 0) {
            renderBuildingSearchResults(filteredPois);
        } else {
            dropdown.innerHTML = '<div class="building-search-empty">未在北京范围内找到匹配的兴趣点</div>';
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.warn('[搜索] 天地图 POI 查询失败:', error);
        dropdown.innerHTML = '<div class="building-search-empty">搜索失败，请检查网络或服务访问</div>';
    }
}

/**
 * 渲染搜索结果下拉列表
 */
function renderBuildingSearchResults(pois) {
    const dropdown = document.getElementById('building-search-dropdown');
    
    dropdown.innerHTML = pois.map((poi, idx) => {
        const name = poi.name || '未知兴趣点';
        const addr = poi.address || '';
        return `
            <div class="building-search-item" onclick="locateToBuilding(${idx})">
                <span class="building-search-item-icon">&#128205;</span>
                <div style="flex:1;min-width:0;">
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;">${name}</div>
                    ${addr ? `<div style="font-size:11px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${addr}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // 缓存结果供定位使用
    AppState._searchResults = pois;
}

/**
 * 定位到指定兴趣点
 */
function locateToBuilding(resultIndex) {
    const pois = AppState._searchResults;
    if (!pois || !pois[resultIndex]) return;
    
    const poi = pois[resultIndex];
    let center = parseTiandituPoint(poi.point || poi.lonlat);
    
    if (!center) {
        showToast('无法获取兴趣点位置');
        return;
    }
    
    // 关闭下拉
    document.getElementById('building-search-dropdown').classList.remove('active');
    
    // 清除旧高亮，添加新高亮
    AppState.highlightSource.clear();
    const highlightFeature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat(center))
    });
    AppState.highlightSource.addFeature(highlightFeature);
    
    // 定位
    AppState.map.getView().animate({
        center: ol.proj.fromLonLat(center),
        zoom: 18,
        duration: 800
    });
    
    const name = poi.name || '选定位置';
    showToast(`已定位到：${name}`);
}

/**
 * 解析天地图返回的坐标字符串
 */
function parseTiandituPoint(pointValue) {
    if (!pointValue) return null;
    
    // 处理 "lon,lat" 字符串
    if (typeof pointValue === 'string') {
        const parts = pointValue.split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return [parts[0], parts[1]];
        }
    }
    
    // 处理 { lon: ..., lat: ... } 对象
    if (typeof pointValue === 'object') {
        const lon = parseFloat(pointValue.lon);
        const lat = parseFloat(pointValue.lat);
        if (!isNaN(lon) && !isNaN(lat)) {
            return [lon, lat];
        }
    }
    
    return null;
}

/**
 * 清空楼栋搜索
 */
function clearBuildingSearch() {
    const input = document.getElementById('building-search-input');
    input.value = '';
    document.getElementById('building-search-dropdown').classList.remove('active');
    document.getElementById('building-search-clear').classList.remove('visible');
    if (buildingSearchAbort) buildingSearchAbort.abort();
    AppState.highlightSource.clear();
}

// ============================================
// ArcGIS Identify 楼栋属性查询
// ============================================

/**
 * 根据像素坐标查询楼栋属性
 */
async function identifyBuilding(pixel) {
    const coordinate = AppState.map.getCoordinateFromPixel(pixel);
    const lonlat = ol.proj.toLonLat(coordinate);
    
    const view = AppState.map.getView();
    const extent = view.calculateExtent(AppState.map.getSize());
    const mapExtent = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
    const size = AppState.map.getSize();
    
    const params = new URLSearchParams({
        f: 'json',
        geometry: `${lonlat[0]},${lonlat[1]}`,
        geometryType: 'esriGeometryPoint',
        sr: '4326',
        layers: 'all',
        mapExtent: `${mapExtent[0]},${mapExtent[1]},${mapExtent[2]},${mapExtent[3]}`,
        tolerance: '5',
        imageDisplay: `${size[0]},${size[1]},96`,
        returnGeometry: 'false'
    });
    
    const url = `https://fwaq.zjw.beijing.gov.cn/feature/arcgis/rest/services/sde_ywzt_build_2000/MapServer/identify?${params.toString()}`;
    
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            // 取第一个结果
            const result = data.results[0];
            showBuildingPanel(result.attributes || {});
        } else {
            hideBuildingPanel();
        }
    } catch (error) {
        console.warn('[Identify] \u67e5\u8be2\u5931\u8d25:', error);
        hideBuildingPanel();
    }
}

/**
 * 显示楼栋属性面板
 */
function showBuildingPanel(attributes) {
    const panel = document.getElementById('building-panel');
    const content = document.getElementById('building-panel-content');
    if (!panel || !content) return;
    
    // 过滤空值并排序
    const entries = Object.entries(attributes)
        .filter(([k, v]) => v !== null && v !== undefined && v !== '')
        .sort((a, b) => a[0].localeCompare(b[0]));
    
    if (entries.length === 0) {
        content.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">\u6682\u65e0\u5c5e\u6027\u4fe1\u606f</div>';
    } else {
        content.innerHTML = entries.map(([key, value]) => `
            <div class="building-attr-row">
                <div class="building-attr-key">${key}</div>
                <div class="building-attr-value">${value}</div>
            </div>
        `).join('');
    }
    
    panel.classList.add('active');
}

/**
 * 隐藏楼栋属性面板
 */
function hideBuildingPanel() {
    const panel = document.getElementById('building-panel');
    if (panel) panel.classList.remove('active');
}

/**
 * 跳转北京视图
 */
function goToBeijing() {
    AppState.map.getView().animate({
        center: ol.proj.fromLonLat([116.4074, 39.9042]),
        zoom: 14,
        duration: 1200
    });
}

function importLedger() {
    document.getElementById('ledger-file-input').click();
}

// 当前待导入的 EXCEL 数据缓存
let pendingExcelData = null;

/**
 * 处理台账文件选择
 */
function handleLedgerFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // 重置 input，允许重复选择同一文件
    event.target.value = '';
    
    showLoading('正在读取 EXCEL...');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const { headers, rows } = parseExcel(e.target.result);
            validateExcelColumns(headers);
            
            if (rows.length === 0) {
                throw new Error('EXCEL 没有数据行');
            }
            
            pendingExcelData = { headers, rows };
            showImportMapModal(headers);
            hideLoading();
        } catch (error) {
            hideLoading();
            console.error('[导入] 失败:', error);
            showToast(error.message || 'EXCEL 解析失败');
        }
    };
    reader.onerror = function() {
        hideLoading();
        showToast('文件读取失败');
    };
    reader.readAsArrayBuffer(file);
}

/**
 * 解析 EXCEL 文件
 */
function parseExcel(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    if (json.length < 1) {
        throw new Error('EXCEL 工作表为空');
    }
    
    const headers = json[0].map(h => String(h).trim());
    const rows = json.slice(1)
        .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
        .map(row => {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h] = row[idx] !== undefined ? row[idx] : '';
            });
            return obj;
        });
    
    return { headers, rows };
}

/**
 * 校验必填字段
 */
function validateExcelColumns(headers) {
    const lowerHeaders = headers.map(h => String(h).toLowerCase());
    const missing = [];
    if (!lowerHeaders.includes('fwbm')) missing.push('fwbm');
    if (!lowerHeaders.includes('kjwz')) missing.push('kjwz');
    if (missing.length > 0) {
        throw new Error(`EXCEL 缺少必填字段：${missing.join('、')}`);
    }
}

/**
 * 显示字段映射弹窗
 */
function showImportMapModal(headers) {
    const addressSelect = document.getElementById('import-address-field');
    const nameSelect = document.getElementById('import-name-field');
    addressSelect.innerHTML = '';
    nameSelect.innerHTML = '';
    
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- 不指定 --';
    nameSelect.appendChild(emptyOption);
    
    headers.forEach(h => {
        const optAddr = document.createElement('option');
        optAddr.value = h;
        optAddr.textContent = h;
        addressSelect.appendChild(optAddr);
        
        const optName = document.createElement('option');
        optName.value = h;
        optName.textContent = h;
        nameSelect.appendChild(optName);
    });
    
    // 自动匹配常见字段名
    const lowerHeaders = headers.map(h => String(h).toLowerCase());
    const addressIdx = lowerHeaders.findIndex(h => h.includes('地址') || h.includes('位置'));
    const nameIdx = lowerHeaders.findIndex(h => h.includes('名称') || h.includes('名字') || h.includes('姓名'));
    
    if (addressIdx >= 0) addressSelect.value = headers[addressIdx];
    if (nameIdx >= 0) nameSelect.value = headers[nameIdx];
    
    document.getElementById('import-map-modal').classList.add('visible');
}

/**
 * 关闭字段映射弹窗
 */
function closeImportMapModal() {
    document.getElementById('import-map-modal').classList.remove('visible');
    pendingExcelData = null;
}

/**
 * 解析空间位置字符串
 */
function parseKjwz(kjwz) {
    if (!kjwz) return null;
    const parts = String(kjwz).split(/[,，]/).map(s => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return [parts[0], parts[1]];
    }
    return null;
}

/**
 * 确认字段映射并导入
 */
function confirmImportMap() {
    if (!pendingExcelData) return;
    
    const addressField = document.getElementById('import-address-field').value;
    if (!addressField) {
        showToast('请选择房屋地址字段');
        return;
    }
    
    const nameField = document.getElementById('import-name-field').value;
    const { headers, rows } = pendingExcelData;
    
    const fwbmIdx = headers.findIndex(h => String(h).toLowerCase() === 'fwbm');
    const kjwzIdx = headers.findIndex(h => String(h).toLowerCase() === 'kjwz');
    const fwbmKey = headers[fwbmIdx];
    const kjwzKey = headers[kjwzIdx];
    
    AppState.ledgers = rows.map((row, idx) => {
        const fwbm = String(row[fwbmKey] || '').trim();
        const kjwz = String(row[kjwzKey] || '').trim();
        const coords = parseKjwz(kjwz);
        
        return {
            id: `IMP${String(idx + 1).padStart(4, '0')}`,
            fwbm: fwbm || undefined,
            kjwz: kjwz || undefined,
            lon: coords ? coords[0] : null,
            lat: coords ? coords[1] : null,
            address: String(row[addressField] || '').trim() || '-',
            name: nameField ? String(row[nameField] || '').trim() : `台账${idx + 1}`,
            linked: !!(fwbm || coords),
            raw: row  // 保留原始 EXCEL 行，用于导出保持表结构
        };
    });
    
    pendingExcelData = null;
    closeImportMapModal();
    renderLedgerList();
    showToast(`已导入 ${AppState.ledgers.length} 条台账数据`);
}

// ============================================
// 自动匹配房屋编码（调用 Python 后端）
// ============================================

const API_BASE_URL = 'http://127.0.0.1:5000/api';

let matchPollTimer = null;
let currentMatchResults = [];
let lastMatchProgress = null;
let matchCurrentPage = 1;
const MATCH_PAGE_SIZE = 100;

/**
 * 启动自动匹配
 */
async function startAutoMatch() {
    if (AppState.ledgers.length === 0) {
        showToast('请先导入台账数据');
        return;
    }
    
    // 只匹配没有 fwbm 的台账
    const targets = AppState.ledgers
        .filter(l => !l.fwbm)
        .map(l => ({ id: l.id, address: l.address || '' }));
    
    if (targets.length === 0) {
        showToast('所有台账已匹配房屋编码');
        return;
    }
    
    if (!confirm(`将对 ${targets.length} 条未上图台账进行地址匹配，是否继续？`)) {
        return;
    }
    
    openMatchModal();
    currentMatchResults = [];
    lastMatchProgress = null;
    matchCurrentPage = 1;
    updateMatchProgress({ status: 'pending', total: targets.length, processed: 0, matched: 0, unmatched: 0, progress: 0, results: [] });
    
    try {
        const response = await fetch(`${API_BASE_URL}/match`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: targets })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `HTTP ${response.status}`);
        }
        
        const { task_id, total } = await response.json();
        pollMatchProgress(task_id);
    } catch (error) {
        console.error('[自动匹配] 启动失败:', error);
        updateMatchProgress({ status: 'error', error: error.message, results: [] });
        document.getElementById('match-close-btn').disabled = false;
    }
}

/**
 * 轮询匹配进度
 */
function pollMatchProgress(taskId) {
    if (matchPollTimer) clearInterval(matchPollTimer);
    
    matchPollTimer = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/match/${taskId}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            updateMatchProgress(data);
            
            if (data.status === 'completed' || data.status === 'error') {
                clearInterval(matchPollTimer);
                matchPollTimer = null;
                document.getElementById('match-close-btn').disabled = false;
                
                if (data.status === 'completed') {
                    showToast(`匹配完成：命中 ${data.matched} 条，未命中 ${data.unmatched} 条，请采纳结果`);
                }
            }
        } catch (error) {
            console.error('[自动匹配] 轮询失败:', error);
            clearInterval(matchPollTimer);
            matchPollTimer = null;
            updateMatchProgress({ status: 'error', error: error.message });
            document.getElementById('match-close-btn').disabled = false;
        }
    }, 500);
}

/**
 * 更新匹配弹窗进度
 */
function updateMatchProgress(data) {
    lastMatchProgress = data;
    const total = data.total || 0;
    const processed = data.processed || 0;
    const matched = data.matched || 0;
    const unmatched = data.unmatched || 0;
    const progress = data.progress || 0;
    const results = data.results || [];
    
    // 合并新结果并保留采纳状态
    currentMatchResults = results.map(r => {
        const existing = currentMatchResults.find(x => x.id === r.id);
        return { ...r, adopted: existing ? existing.adopted : false };
    });
    
    // 按相似度降序排序（命中的在前，未命中的在后）
    currentMatchResults.sort((a, b) => {
        const simA = a.matched ? (a.similarity || 0) : -1;
        const simB = b.matched ? (b.similarity || 0) : -1;
        return simB - simA;
    });
    

    document.getElementById('match-progress-fill').style.width = `${progress}%`;
    document.getElementById('match-stats').innerHTML = `
        <span>总台账: ${total}</span>
        <span>已处理: ${processed}</span>
        <span>命中: ${matched}</span>
        <span>未命中: ${unmatched}</span>
    `;
    
    const listEl = document.getElementById('match-result-list');
    if (currentMatchResults.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#999;font-size:13px;">等待匹配结果...</div>';
    } else {
        const pageResults = getMatchPageResults();
        
        listEl.innerHTML = pageResults.map((r) => {
            if (!r.matched) {
                return `
                    <div class="match-result-item">
                        <div class="match-result-status unmatched"></div>
                        <div class="match-result-main">
                            <div class="match-result-address">${r.address || '-'}</div>
                            <div class="match-result-detail">未命中</div>
                        </div>
                    </div>
                `;
            }
            
            const attrs = r.attributes || {};
            const attrRows = Object.entries(attrs)
                .filter(([k, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
                .join('');
            
            return `
                <div class="match-result-item">
                    <div class="match-result-status matched"></div>
                    <div class="match-result-main" onclick="toggleMatchDetails('${r.id}')">
                        <div class="match-result-address">${r.address || '-'}</div>
                        <div class="match-result-detail">
                            命中编码: ${r.pfhouseid || '-'} | 相似度: ${(r.similarity * 100).toFixed(1)}%
                            ${r.matched_address ? ` | 匹配地址: ${r.matched_address}` : ''}
                        </div>
                        <div class="match-details" id="match-details-${r.id}">
                            <div class="match-details-title">房屋底账属性（点击收起）</div>
                            <table class="match-attr-table">${attrRows}</table>
                        </div>
                    </div>
                    <div class="match-result-actions">
                        <button class="match-adopt-btn ${r.adopted ? 'adopted' : ''}" 
                                onclick="event.stopPropagation(); adoptMatchResult('${r.id}')"
                                ${r.adopted ? 'disabled' : ''}>
                            ${r.adopted ? '已采纳' : '采纳'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    if (data.status === 'error') {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#c62828;font-size:13px;">匹配失败：${data.error || '未知错误'}</div>`;
    }
    
    // 更新本页采纳按钮状态
    const pageResults = getMatchPageResults();
    const hasAdoptable = pageResults.some(r => r.matched && !r.adopted);
    const adoptAllBtn = document.getElementById('match-adopt-all-btn');
    adoptAllBtn.disabled = !hasAdoptable || data.status === 'running' || data.status === 'pending';
    
    renderMatchPagination();
}

/**
 * 渲染房屋编码匹配分页
 */
function renderMatchPagination() {
    const total = currentMatchResults.length;
    const totalPages = Math.max(1, Math.ceil(total / MATCH_PAGE_SIZE));
    const paginationEl = document.getElementById('match-pagination');
    if (!paginationEl) return;
    
    if (total <= MATCH_PAGE_SIZE) {
        paginationEl.innerHTML = '';
        return;
    }
    
    paginationEl.innerHTML = `
        <button onclick="changeMatchPage(-1)" ${matchCurrentPage <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${matchCurrentPage}/${totalPages} 页，共 ${total} 条</span>
        <button onclick="changeMatchPage(1)" ${matchCurrentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
}

/**
 * 切换房屋编码匹配页码
 */
function changeMatchPage(delta) {
    const totalPages = Math.max(1, Math.ceil(currentMatchResults.length / MATCH_PAGE_SIZE));
    const newPage = matchCurrentPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    matchCurrentPage = newPage;
    updateMatchProgress(lastMatchProgress);
}

/**
 * 批量采纳当前页命中结果
 */
function adoptAllMatchResults() {
    const pageResults = getMatchPageResults();
    let count = 0;
    pageResults.forEach(r => {
        if (!r.matched || r.adopted) return;
        const ledger = AppState.ledgers.find(l => l.id === r.id);
        if (!ledger) return;
        ledger.fwbm = r.pfhouseid;
        ledger.linked = true;
        r.adopted = true;
        count++;
    });
    
    if (count > 0) {
        renderLedgerList();
        updateMatchProgress(lastMatchProgress);
        showToast(`本页采纳 ${count} 条房屋编码`);
    }
}

/**
 * 获取房屋编码匹配当前页结果
 */
function getMatchPageResults() {
    const start = (matchCurrentPage - 1) * MATCH_PAGE_SIZE;
    const end = Math.min(start + MATCH_PAGE_SIZE, currentMatchResults.length);
    return currentMatchResults.slice(start, end);
}

/**
 * 展开/收起匹配详情
 */
function toggleMatchDetails(id) {
    const el = document.getElementById(`match-details-${id}`);
    if (el) el.classList.toggle('visible');
}

/**
 * 采纳单条匹配结果
 */
function adoptMatchResult(id) {
    const result = currentMatchResults.find(r => r.id === id);
    if (!result || !result.matched || result.adopted) return;
    
    const ledger = AppState.ledgers.find(l => l.id === id);
    if (!ledger) return;
    
    ledger.fwbm = result.pfhouseid;
    ledger.linked = true;
    result.adopted = true;
    
    renderLedgerList();
    updateMatchProgress(lastMatchProgress);
    showToast(`已采纳房屋编码：${result.pfhouseid}`);
}

/**
 * 打开匹配弹窗
 */
function openMatchModal() {
    document.getElementById('match-modal').classList.add('visible');
    document.getElementById('match-close-btn').disabled = true;
    document.getElementById('match-adopt-all-btn').disabled = true;
}

/**
 * 关闭匹配弹窗
 */
function closeMatchModal() {
    document.getElementById('match-modal').classList.remove('visible');
    if (matchPollTimer) {
        clearInterval(matchPollTimer);
        matchPollTimer = null;
    }
}

// ============================================
// 坐标匹配（天地图 POI 搜索 + 地图拾取）
// ============================================

let coordMatchItems = [];
let currentPickLedgerId = null;
let isCopyPickMode = false;
let coordCurrentPage = 1;
const COORD_PAGE_SIZE = 100;

/**
 * 启动坐标匹配
 */
function startCoordMatch() {
    if (AppState.ledgers.length === 0) {
        showToast('请先导入台账数据');
        return;
    }
    
    // 未上图台账：无 fwbm 且无 kjwz
    const targets = AppState.ledgers.filter(l => !l.fwbm && !l.kjwz);
    if (targets.length === 0) {
        showToast('没有需要匹配坐标的未上图台账');
        return;
    }
    
    coordMatchItems = targets.map(ledger => ({
        ledgerId: ledger.id,
        query: ledger.address || '',
        candidates: [],
        selectedIndex: -1,
        searching: false,
        resolved: false
    }));
    
    coordCurrentPage = 1;
    openCoordMatchPanel();
    renderCoordMatchPanel();
}

function openCoordMatchPanel() {
    document.getElementById('coord-match-panel').classList.add('visible');
}

function closeCoordMatchPanel() {
    document.getElementById('coord-match-panel').classList.remove('visible');
    if (!currentPickLedgerId) {
        coordMatchItems = [];
    }
}

/**
 * 渲染坐标匹配侧栏
 */
function renderCoordMatchPanel() {
    const listEl = document.getElementById('coord-match-list');
    
    if (coordMatchItems.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999;">暂无未上图台账</div>';
        return;
    }
    
    const start = (coordCurrentPage - 1) * COORD_PAGE_SIZE;
    const pageItems = getCoordPageItems();
    
    listEl.innerHTML = pageItems.map((item, pageIdx) => {
        const idx = start + pageIdx;
        const ledger = AppState.ledgers.find(l => l.id === item.ledgerId);
        if (!ledger) return '';
        
        const resolvedClass = item.resolved ? 'resolved' : '';
        const statusText = item.resolved ? `已匹配坐标：${ledger.lon?.toFixed(5)}, ${ledger.lat?.toFixed(5)}` : '';
        
        let candidatesHtml = '';
        if (item.searching) {
            candidatesHtml = '<div style="padding:10px;color:#667eea;font-size:12px;">搜索中...</div>';
        } else if (item.candidates.length > 0) {
            candidatesHtml = `
                <div class="coord-candidates">
                    ${item.candidates.map((c, cidx) => `
                        <div class="coord-candidate ${item.selectedIndex === cidx ? 'selected' : ''}" 
                             onclick="selectCoordCandidate(${idx}, ${cidx})">
                            <input type="radio" class="coord-candidate-radio" 
                                   ${item.selectedIndex === cidx ? 'checked' : ''} 
                                   onclick="event.stopPropagation(); selectCoordCandidate(${idx}, ${cidx})">
                            <div class="coord-candidate-info">
                                <div class="coord-candidate-name">${c.name || '未知地点'}</div>
                                <div class="coord-candidate-address">${c.address || '-'}</div>
                                <div class="coord-candidate-coord">坐标: ${c.lon.toFixed(5)}, ${c.lat.toFixed(5)}</div>
                            </div>
                            <button class="coord-locate-btn" onclick="event.stopPropagation(); flyToCoord(${c.lon}, ${c.lat})" title="定位到地图">&#128205;</button>
                        </div>
                    `).join('')}
                </div>
                <button class="coord-match-adopt-btn" 
                        onclick="adoptCoordCandidate(${idx})"
                        ${item.selectedIndex < 0 || item.resolved ? 'disabled' : ''}>
                    ${item.resolved ? '已采纳' : '采纳坐标'}
                </button>
            `;
        } else if (!item.searching && item.query && !item.resolved) {
            candidatesHtml = '<div style="padding:10px;color:#999;font-size:12px;">未搜索到候选坐标，可尝试修改关键词或点击“地图拾取”</div>';
        }
        
        return `
            <div class="coord-match-item ${resolvedClass}" id="coord-item-${idx}">
                <div class="coord-match-item-header">
                    <input type="text" class="coord-match-input" 
                           id="coord-query-${idx}" 
                           value="${escapeHtml(item.query)}" 
                           placeholder="输入地址关键词..."
                           oninput="updateCoordQuery(${idx}, this.value)"
                           ${item.resolved ? 'disabled' : ''}>
                    <div class="coord-match-item-actions">
                        <button class="coord-match-small-btn search" 
                                onclick="searchCoordForItem(${idx})"
                                ${item.searching || item.resolved ? 'disabled' : ''}>搜索</button>
                        <button class="coord-match-small-btn pick" 
                                onclick="startMapPick('${item.ledgerId}')"
                                ${item.resolved ? 'disabled' : ''}>地图拾取</button>
                    </div>
                </div>
                ${statusText ? `<div class="coord-match-status" onclick="flyToCoord(${ledger.lon}, ${ledger.lat})" style="cursor:pointer;" title="点击定位到地图">${statusText}</div>` : ''}
                ${candidatesHtml}
            </div>
        `;
    }).join('');
    
    // 更新本页采纳按钮状态
    const pageItemsForAdopt = getCoordPageItems();
    const hasAdoptableCoord = pageItemsForAdopt.some(i => !i.resolved && i.selectedIndex >= 0);
    document.getElementById('coord-batch-adopt-btn').disabled = !hasAdoptableCoord;
    
    renderCoordPagination();
}

/**
 * 渲染坐标匹配分页
 */
function renderCoordPagination() {
    const total = coordMatchItems.length;
    const totalPages = Math.max(1, Math.ceil(total / COORD_PAGE_SIZE));
    const paginationEl = document.getElementById('coord-pagination');
    if (!paginationEl) return;
    
    if (total <= COORD_PAGE_SIZE) {
        paginationEl.innerHTML = '';
        return;
    }
    
    paginationEl.innerHTML = `
        <button onclick="changeCoordPage(-1)" ${coordCurrentPage <= 1 ? 'disabled' : ''}>上一页</button>
        <span>第 ${coordCurrentPage}/${totalPages} 页，共 ${total} 条</span>
        <button onclick="changeCoordPage(1)" ${coordCurrentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
}

/**
 * 切换坐标匹配页码
 */
function changeCoordPage(delta) {
    const totalPages = Math.max(1, Math.ceil(coordMatchItems.length / COORD_PAGE_SIZE));
    const newPage = coordCurrentPage + delta;
    if (newPage < 1 || newPage > totalPages) return;
    coordCurrentPage = newPage;
    renderCoordMatchPanel();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 飞行定位到指定坐标
 */
function flyToCoord(lon, lat) {
    if (!AppState.map || isNaN(lon) || isNaN(lat)) return;
    AppState.highlightSource.clear();
    AppState.highlightSource.addFeature(new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat]))
    }));
    AppState.map.getView().animate({
        center: ol.proj.fromLonLat([lon, lat]),
        zoom: 18,
        duration: 800
    });
}

/**
 * 同步输入框内容到状态
 */
function updateCoordQuery(idx, value) {
    const item = coordMatchItems[idx];
    if (item) item.query = value;
}

/**
 * 单条搜索天地图坐标
 */
async function searchCoordForItem(idx) {
    const item = coordMatchItems[idx];
    const input = document.getElementById(`coord-query-${idx}`);
    const query = input.value.trim();
    if (!query) {
        showToast('请输入地址关键词');
        return;
    }
    
    item.query = query;
    item.searching = true;
    item.candidates = [];
    item.selectedIndex = -1;
    renderCoordMatchPanel();
    
    try {
        const candidates = await searchTiandituCoord(query);
        item.candidates = candidates;
        if (candidates.length > 0) {
            item.selectedIndex = 0;
        }
    } catch (error) {
        console.error('[坐标匹配] 搜索失败:', error);
        showToast('搜索失败：' + error.message);
    } finally {
        item.searching = false;
        renderCoordMatchPanel();
    }
}

/**
 * 批量搜索当前页未上图台账坐标
 */
async function batchSearchCoords() {
    const pageItems = getCoordPageItems();
    const pending = pageItems.filter(i => !i.resolved && !i.searching);
    if (pending.length === 0) {
        showToast('当前页没有待搜索的台账');
        return;
    }
    
    document.getElementById('coord-batch-search-btn').disabled = true;
    
    for (let i = 0; i < pending.length; i++) {
        const idx = coordMatchItems.indexOf(pending[i]);
        await searchCoordForItem(idx);
        // 避免触发天地图频率限制
        if (i < pending.length - 1) await sleep(150);
    }
    
    document.getElementById('coord-batch-search-btn').disabled = false;
    showToast('本页坐标搜索完成');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调用天地图 POI 搜索接口
 */
async function searchTiandituCoord(keyword) {
    // 限制在北京范围内搜索
    const mapBound = BEIJING_BOUNDS.toMapBound();
    
    let key = TiandituKeyManager.getCurrentKey();
    key = TiandituKeyManager.recordUsage(key);
    
    const postStr = JSON.stringify({
        keyWord: keyword,
        level: 12,
        mapBound: mapBound,
        queryType: 1,
        start: 0,
        count: 3
    });
    
    const url = `https://api.tianditu.gov.cn/v2/search?postStr=${encodeURIComponent(postStr)}&type=query&tk=${key}`;
    
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const pois = data.pois || [];
    
    return pois.map(poi => {
        const center = parseTiandituPoint(poi.point || poi.lonlat);
        return {
            name: poi.name || '未知地点',
            address: poi.address || '',
            lon: center ? center[0] : null,
            lat: center ? center[1] : null
        };
    }).filter(c => c.lon !== null && c.lat !== null && isInBeijing(c.lon, c.lat)).slice(0, 3);
}

/**
 * 选择候选坐标
 */
function selectCoordCandidate(itemIdx, candidateIdx) {
    const item = coordMatchItems[itemIdx];
    if (!item || item.resolved) return;
    item.selectedIndex = candidateIdx;
    renderCoordMatchPanel();
}

/**
 * 采纳选中的候选坐标
 */
function adoptCoordCandidate(itemIdx) {
    const item = coordMatchItems[itemIdx];
    if (!item || item.resolved || item.selectedIndex < 0) return;
    
    const candidate = item.candidates[item.selectedIndex];
    const ledger = AppState.ledgers.find(l => l.id === item.ledgerId);
    if (!ledger || !candidate) return;
    
    const lon = parseFloat(candidate.lon.toFixed(5));
    const lat = parseFloat(candidate.lat.toFixed(5));
    ledger.kjwz = `${lon},${lat}`;
    ledger.lon = lon;
    ledger.lat = lat;
    ledger.linked = true;
    item.resolved = true;
    
    renderLedgerList();
    renderCoordMatchPanel();
    showToast(`已采纳坐标：${candidate.lon.toFixed(5)}, ${candidate.lat.toFixed(5)}`);
}

/**
 * 批量采纳当前页已选中的坐标
 */
function adoptAllCoords() {
    const pageItems = getCoordPageItems();
    let count = 0;
    pageItems.forEach(item => {
        if (item.resolved || item.selectedIndex < 0) return;
        const candidate = item.candidates[item.selectedIndex];
        const ledger = AppState.ledgers.find(l => l.id === item.ledgerId);
        if (!ledger || !candidate) return;
        
        const lon = parseFloat(candidate.lon.toFixed(5));
        const lat = parseFloat(candidate.lat.toFixed(5));
        ledger.kjwz = `${lon},${lat}`;
        ledger.lon = lon;
        ledger.lat = lat;
        ledger.linked = true;
        item.resolved = true;
        count++;
    });
    
    if (count > 0) {
        renderLedgerList();
        renderCoordMatchPanel();
        showToast(`本页采纳 ${count} 条坐标`);
    }
}

/**
 * 获取坐标匹配当前页条目
 */
function getCoordPageItems() {
    const start = (coordCurrentPage - 1) * COORD_PAGE_SIZE;
    const end = Math.min(start + COORD_PAGE_SIZE, coordMatchItems.length);
    return coordMatchItems.slice(start, end);
}

/**
 * 开始地图拾取
 */
function startMapPick(ledgerId) {
    currentPickLedgerId = ledgerId;
    document.getElementById('map-pick-overlay').classList.add('visible');
    showToast('请在地图上点击选择坐标，按 ESC 取消');
}

/**
 * 完成地图拾取
 */
function finishMapPick(lon, lat) {
    const ledger = AppState.ledgers.find(l => l.id === currentPickLedgerId);
    if (ledger) {
        const roundedLon = parseFloat(lon.toFixed(5));
        const roundedLat = parseFloat(lat.toFixed(5));
        ledger.kjwz = `${roundedLon},${roundedLat}`;
        ledger.lon = roundedLon;
        ledger.lat = roundedLat;
        ledger.linked = true;
        
        const item = coordMatchItems.find(i => i.ledgerId === currentPickLedgerId);
        if (item) {
            item.resolved = true;
            item.candidates = [{
                name: '地图拾取',
                address: ledger.address || '',
                lon: roundedLon,
                lat: roundedLat
            }];
            item.selectedIndex = 0;
        }
        
        renderLedgerList();
        showToast(`已拾取坐标：${roundedLon.toFixed(5)}, ${roundedLat.toFixed(5)}`);
    }
    
    cancelMapPick();
    openCoordMatchPanel();
    renderCoordMatchPanel();
}

/**
 * 取消地图拾取
 */
function cancelMapPick() {
    currentPickLedgerId = null;
    document.getElementById('map-pick-overlay').classList.remove('visible');
}

/**
 * 切换坐标复制到剪贴板模式
 */
function toggleCopyPickMode() {
    if (isCopyPickMode) {
        cancelCopyPickMode();
        return;
    }
    // 如果正在执行台账地图拾取，先取消
    if (currentPickLedgerId) {
        cancelMapPick();
        openCoordMatchPanel();
        renderCoordMatchPanel();
    }
    startCopyPickMode();
}

/**
 * 开始坐标复制到剪贴板模式
 */
function startCopyPickMode() {
    isCopyPickMode = true;
    const overlay = document.getElementById('map-pick-overlay');
    overlay.querySelector('.map-pick-tip').textContent = '坐标复制模式：点击地图拾取坐标并自动复制到剪贴板，按 ESC 取消';
    overlay.classList.add('visible');
    document.getElementById('btn-copy-coord').classList.add('active');
    showToast('点击地图任意位置，坐标将自动复制到剪贴板');
}

/**
 * 完成坐标复制到剪贴板
 */
async function finishCopyPickMode(lon, lat) {
    const roundedLon = parseFloat(lon.toFixed(5));
    const roundedLat = parseFloat(lat.toFixed(5));
    const coordText = `${roundedLon},${roundedLat}`;
    
    try {
        await copyToClipboard(coordText);
        // 高亮显示拾取点
        AppState.highlightSource.clear();
        AppState.highlightSource.addFeature(new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([roundedLon, roundedLat]))
        }));
        showToast(`已复制到剪贴板：${coordText}`);
    } catch (error) {
        console.error('[坐标复制] 复制失败:', error);
        showToast('复制失败，请手动复制');
    } finally {
        cancelCopyPickMode();
    }
}

/**
 * 取消坐标复制到剪贴板模式
 */
function cancelCopyPickMode() {
    isCopyPickMode = false;
    const overlay = document.getElementById('map-pick-overlay');
    overlay.classList.remove('visible');
    overlay.querySelector('.map-pick-tip').textContent = '地图拾取模式：点击地图任意位置选择坐标，按 ESC 取消';
    document.getElementById('btn-copy-coord').classList.remove('active');
    if (AppState.map) {
        AppState.map.getTargetElement().style.cursor = '';
    }
}

/**
 * 复制文本到剪贴板（兼容方案）
 */
async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!successful) throw new Error('execCommand copy failed');
    } catch (error) {
        document.body.removeChild(textarea);
        throw error;
    }
}

// ESC 取消地图拾取或坐标复制模式
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (isCopyPickMode) {
            cancelCopyPickMode();
            showToast('已取消坐标复制');
        } else if (currentPickLedgerId) {
            cancelMapPick();
            openCoordMatchPanel();
            renderCoordMatchPanel();
            showToast('已取消地图拾取');
        }
    }
});

/**
 * 未关联台账的【关联】按钮占位逻辑
 */
function startLinkLedger(id) {
    const ledger = AppState.ledgers.find(l => l.id === id);
    if (!ledger) return;
    AppState.selectedLedger = ledger;
    renderLedgerList();
    showToast(`已选中台账：${ledger.name || ledger.id}，关联逻辑待补充`);
}

function exportResults() {
    if (AppState.ledgers.length === 0) {
        showToast('暂无台账可导出');
        return;
    }
    
    // 优先使用导入时的原始表结构，只更新 fwbm 和 kjwz 两列
    const exportData = AppState.ledgers.map(l => {
        if (l.raw && typeof l.raw === 'object') {
            return {
                ...l.raw,
                fwbm: l.fwbm || '',
                kjwz: l.kjwz || ''
            };
        }
        //  fallback：无原始数据时使用通用结构
        return {
            '台账ID': l.id || '',
            '房屋名称': l.name || '',
            '房屋地址': l.address || '',
            'fwbm': l.fwbm || '',
            'kjwz': l.kjwz || ''
        };
    });
    
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '台账数据');
    
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `台账导出_${dateStr}.xlsx`);
    
    showToast('导出成功');
}

// ============================================
// UI 辅助函数
// ============================================

function showLoading(text) {
    document.getElementById('loading-text').textContent = text || '\u52a0\u8f7d\u4e2d...';
    document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
}

let toastTimer = null;
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('active');
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('active');
    }, 2500);
}
