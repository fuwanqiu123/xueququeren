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
            `\u7ecf\u5ea6: ${coord[0].toFixed(4)}  \u7eac\u5ea6: ${coord[1].toFixed(4)}`;
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
 * 加载演示数据
 */
function loadDemoData() {
    showLoading('\u6b63\u5728\u52a0\u8f7d\u53f0\u8d26\u6570\u636e...');
    
    // 模拟台账数据（北京市）
    const demoLedgers = [
        { id: 'T001', name: '\u5317\u4eac\u5e02\u7b2c\u4e00\u4e2d\u5b66\u6821\u4ea7', type: '\u6821\u4ea7', address: '\u4e1c\u57ce\u533a\u666f\u5c71\u524d\u88571\u53f7', linked: true, area: 12500 },
        { id: 'T002', name: '\u5317\u4eac\u5e02\u7b2c\u56db\u4e2d\u5b66\u6821\u4ea7', type: '\u6821\u4ea7', address: '\u897f\u57ce\u533a\u6587\u660e\u8def88\u53f7', linked: true, area: 9800 },
        { id: 'T003', name: '\u6d77\u6dc0\u533a\u5b9e\u9a8c\u5c0f\u5b66\u6559\u5b66\u697c', type: '\u6821\u4ea7', address: '\u6d77\u6dc0\u533a\u4e2d\u5173\u6751202\u53f7', linked: false, area: 7600 },
        { id: 'T004', name: '\u671d\u9633\u533a\u6559\u80b2\u57fa\u5730\u571f\u5730', type: '\u571f\u5730', address: '\u671d\u9633\u533a\u671d\u9633\u516c\u56ed\u8def', linked: false, area: 35000 },
        { id: 'T005', name: '\u5317\u4eac\u5e02\u6559\u80b2\u59d4\u529e\u516c\u697c', type: '\u529e\u516c', address: '\u897f\u57ce\u533a\u666f\u5c71\u524d\u8857', linked: true, area: 5400 },
        { id: 'T006', name: '\u4e30\u53f0\u533a\u7b2c\u4e8c\u4e2d\u5b66\u8fd0\u52a8\u573a', type: '\u8fd0\u52a8\u573a', address: '\u4e30\u53f0\u533a\u4e30\u53f0\u8def', linked: false, area: 8200 },
        { id: 'T007', name: '\u660c\u5e73\u533a\u7b2c\u4e00\u4e2d\u5b66\u6821\u4ea7', type: '\u6821\u4ea7', address: '\u660c\u5e73\u533a\u660c\u5e73\u9547', linked: true, area: 11000 },
        { id: 'T008', name: '\u77f3\u666f\u5c71\u533a\u5b9e\u9a8c\u5c0f\u5b66\u6821\u4ea7', type: '\u6821\u4ea7', address: '\u77f3\u666f\u5c71\u533a\u53e4\u57ce\u8def', linked: false, area: 6300 },
        { id: 'T009', name: '\u5317\u4eac\u5e08\u8303\u5927\u5b66\u9644\u5c5e\u4e2d\u5b66', type: '\u6821\u4ea7', address: '\u6d77\u6dc0\u533a\u65b0\u8857\u53e3\u5927\u8857', linked: true, area: 15800 },
        { id: 'T010', name: '\u987a\u4e49\u533a\u804c\u4e1a\u6559\u80b2\u4e2d\u5fc3\u571f\u5730', type: '\u571f\u5730', address: '\u987a\u4e49\u533a\u987a\u5e73\u5357\u5927\u8857', linked: false, area: 42000 },
    ];
    
    setTimeout(() => {
        AppState.ledgers = demoLedgers;
        renderLedgerList();
        
        hideLoading();
        showToast(`\u5df2\u52a0\u8f7d ${demoLedgers.length} \u6761\u53f0\u8d26\u6570\u636e`);
    }, 800);
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
    if (AppState.currentTab === 'linked') {
        filtered = filtered.filter(l => l.linked);
    } else if (AppState.currentTab === 'unlinked') {
        filtered = filtered.filter(l => !l.linked);
    }
    
    // 搜索过滤
    if (AppState.searchKeyword) {
        const kw = AppState.searchKeyword.toLowerCase();
        filtered = filtered.filter(l => 
            l.name.toLowerCase().includes(kw) || 
            l.id.toLowerCase().includes(kw) ||
            l.address.toLowerCase().includes(kw)
        );
    }
    
    countEl.textContent = `\u5171 ${filtered.length} \u6761`;
    
    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999;font-size:13px;">\u6682\u65e0\u53f0\u8d26\u6570\u636e</div>';
        return;
    }
    
    listEl.innerHTML = filtered.map(ledger => `
        <div class="ledger-item ${AppState.selectedLedger?.id === ledger.id ? 'active' : ''}" 
             data-id="${ledger.id}" 
             onclick="selectLedger('${ledger.id}')">
            <div class="ledger-item-header">
                <div class="ledger-item-name">${ledger.name}</div>
                <div class="ledger-item-tag ${ledger.linked ? '' : 'unlinked'}">${ledger.linked ? '\u5df2\u5173\u8054' : '\u672a\u5173\u8054'}</div>
            </div>
            <div class="ledger-item-info">
                <span>&#128205; ${ledger.address}</span>
                <span>&#128208; ${(ledger.area / 10000).toFixed(2)}\u4ea9</span>
            </div>
        </div>
    `).join('');
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

    showToast(`\u5df2\u5b9a\u4f4d\u5230\uff1a${lon.toFixed(4)}, ${lat.toFixed(4)}`);
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
 * 执行楼栋地址搜索（ArcGIS Query）
 */
async function doBuildingSearch(keyword) {
    const dropdown = document.getElementById('building-search-dropdown');
    dropdown.innerHTML = '<div class="building-search-loading">\u641c\u7d22\u4e2d...</div>';
    dropdown.classList.add('active');
    
    // 转义 SQL 中的单引号，防止注入
    const safeKeyword = keyword.replace(/'/g, "''");
    
    const params = new URLSearchParams({
        f: 'json',
        where: `ADRESS LIKE '%${safeKeyword}%' OR PFHOUSEID = '${safeKeyword}'`,
        outFields: 'ADRESS,OBJECTID,PFHOUSEID',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: '20'
    });
    
    // 尝试图层 0，如果失败则说明图层 ID 不对
    const url = `https://fwaq.zjw.beijing.gov.cn/feature/arcgis/rest/services/sde_ywzt_build_2000/MapServer/0/query?${params.toString()}`;
    
    if (buildingSearchAbort) buildingSearchAbort.abort();
    buildingSearchAbort = new AbortController();
    
    try {
        const response = await fetch(url, { 
            mode: 'cors',
            signal: buildingSearchAbort.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            renderBuildingSearchResults(data.features);
        } else {
            dropdown.innerHTML = '<div class="building-search-empty">\u672a\u627e\u5230\u5339\u914d\u7684\u697c\u680b\u5730\u5740</div>';
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.warn('[\u641c\u7d22] \u67e5\u8be2\u5931\u8d25:', error);
        dropdown.innerHTML = '<div class="building-search-empty">\u641c\u7d22\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u670d\u52a1\u8bbf\u95ee</div>';
    }
}

/**
 * 渲染搜索结果下拉列表
 */
function renderBuildingSearchResults(features) {
    const dropdown = document.getElementById('building-search-dropdown');
    
    dropdown.innerHTML = features.map((f, idx) => {
        const addr = f.attributes.ADRESS || f.attributes.address || '\u672a\u77e5\u5730\u5740';
        const houseId = f.attributes.PFHOUSEID || '';
        return `
            <div class="building-search-item" onclick="locateToBuilding('${addr.replace(/'/g, "\\'")}', ${idx})">
                <span class="building-search-item-icon">&#127968;</span>
                <div style="flex:1;min-width:0;">
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${addr}</div>
                    ${houseId ? `<div style="font-size:11px;color:#999;">房屋编码: ${houseId}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // 缓存结果供定位使用
    AppState._searchResults = features;
}

/**
 * 定位到指定楼栋
 */
function locateToBuilding(address, resultIndex) {
    const features = AppState._searchResults;
    if (!features || !features[resultIndex]) return;
    
    const feature = features[resultIndex];
    const geom = feature.geometry;
    
    let center;
    if (geom.x !== undefined && geom.y !== undefined) {
        // 点几何
        center = [geom.x, geom.y];
    } else if (geom.rings && geom.rings.length > 0) {
        // 多边形几何 - 计算第一个环的中心
        const ring = geom.rings[0];
        let sumX = 0, sumY = 0;
        ring.forEach(p => { sumX += p[0]; sumY += p[1]; });
        center = [sumX / ring.length, sumY / ring.length];
    } else if (geom.paths && geom.paths.length > 0) {
        // 线几何
        const path = geom.paths[0];
        const mid = Math.floor(path.length / 2);
        center = path[mid];
    } else {
        showToast('\u65e0\u6cd5\u83b7\u53d6\u697c\u680b\u4f4d\u7f6e');
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
    
    showToast(`\u5df2\u5b9a\u4f4d\u5230\uff1a${address}`);
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
    showToast('\u5bfc\u5165\u529f\u80fd\u5f00\u53d1\u4e2d...');
}

function exportResults() {
    const data = {
        ledgers: AppState.ledgers,
        features: AppState.vectorSource.getFeatures().map(f => ({
            ledgerId: f.get('ledgerId'),
            linked: f.get('linked'),
            geometry: new ol.format.GeoJSON().writeGeometry(f.getGeometry())
        })),
        exportTime: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `\u53f0\u8d26\u5173\u8054\u7ed3\u679c_${new Date().toLocaleDateString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('\u5bfc\u51fa\u6210\u529f');
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
