/**
 * 学区地图查看工具 - 配置文件
 * 
 * 使用说明：
 * 1. 申请天地图密钥：https://console.tianditu.gov.cn/
 * 2. 修改下方配置项
 * 3. 按规范准备数据文件
 */

const CONFIG = {
    // ============================================
    // 天地图配置（必须配置）
    // ============================================
    // 天地图密钥列表 - 支持多KEY轮换
    // 申请地址：https://console.tianditu.gov.cn/
    TIANDITU_KEYS: [
        'f14e4bb40aa997803b046bcfbbd7aaa4',
        '8fd8de7a161f3164a6da3f6615ecb386',
        'a7097827e4299ac41d3d50b45da1c193',
        'f0c0b3fbe98a7dcc92661e345f17e8ff',
        'e495b48f1c8eb41d17dd7f8a5bd47c18',
        '98ef794563cdf1d71e1411fd28091b0b',
        '4c2d0fc4e36cfd9d255aa3ca61567c7b',
        '1b9f5b539a57891fa8419423adf9e010',
        '20d9014ee072f032fc7d7fee8da01e21'
    ],
    
    // ============================================
    // 数据路径配置
    // ============================================
    // 数据根目录（相对路径或绝对路径）
    dataBasePath: 'data',
    
    // 中学学区数据文件夹
    middleDataPath: 'data/middle',
    
    // 小学学区数据文件夹
    primaryDataPath: 'data/primary',
    
    // 行政区划边界文件
    boundaryFile: 'data/xiangtan_boundary.geojson',
    
    // ============================================
    // 地图初始配置
    // ============================================
    // 湘潭市默认中心点 [经度, 纬度]
    defaultCenter: [112.9441, 27.8297],
    
    // 默认缩放级别
    defaultZoom: 11,
    
    // 最小缩放级别
    minZoom: 9,
    
    // 最大缩放级别
    maxZoom: 18,
    
    // ============================================
    // 样式配置
    // ============================================
    // 学区颜色列表：12个从色轮均匀选取的高对比度颜色，确保相邻学区视觉差异明显
    districtColors: [
        '#E74C3C',  // 0°  红
        '#E67E22',  // 30° 橙
        '#F1C40F',  // 60° 黄
        '#A3CB38',  // 90° 黄绿
        '#2ECC71',  // 120° 绿
        '#1ABC9C',  // 150° 青绿
        '#00CED1',  // 180° 青
        '#3498DB',  // 210° 蓝
        '#6C5CE7',  // 240° 靛蓝
        '#9B59B6',  // 270° 紫
        '#E84393',  // 300° 品红
        '#FD79A8'   // 330° 粉红
    ],
    
    // 行政区划边界样式
    boundaryStyle: {
        color: '#333333',
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0,
        dashArray: '5, 5'
    },
    
    // 学区默认样式
    districtStyle: {
        weight: 2,
        opacity: 0.8,
        fillOpacity: 0.35
    },
    
    // 学区高亮样式
    highlightStyle: {
        weight: 4,
        opacity: 1,
        fillOpacity: 0.5
    },
    
    // ============================================
    // 功能配置
    // ============================================
    // 是否显示标签的最小缩放级别
    labelMinZoom: 10,
    
    // 搜索结果最大显示数量
    maxSearchResults: 10,
    
    // 是否启用点击地图空白处关闭信息面板
    closePanelOnMapClick: true,
    
    // ============================================
    // 调试配置
    // ============================================
    // 是否开启调试模式（控制台输出日志）
    debug: false,
    
    // 是否使用模拟数据（用于测试）
    useMockData: false
};

// ============================================
// 天地图KEY轮换管理器
// ============================================
const TiandituKeyManager = {
    keys: [...CONFIG.TIANDITU_KEYS],
    currentIndex: 0,
    failedKeys: new Set(),
    keyUsageCount: {},
    maxUsagePerKey: 4900, // 每个KEY的安全使用上限（天地图日限5000，预留100次余量）
    
    /**
     * 获取当前可用的KEY
     */
    getCurrentKey() {
        return this.keys[this.currentIndex];
    },
    
    /**
     * 获取下一个可用的KEY
     */
    getNextKey() {
        // 标记当前KEY为失败
        this.failedKeys.add(this.currentIndex);
        
        // 寻找下一个未失败的KEY
        let attempts = 0;
        while (attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            if (!this.failedKeys.has(this.currentIndex)) {
                const newKey = this.keys[this.currentIndex];
                console.log(`[KEY轮换] 切换到新KEY (索引${this.currentIndex}): ${newKey.substring(0, 8)}...`);
                return newKey;
            }
            attempts++;
        }
        
        // 所有KEY都失败了，重置并返回第一个
        console.warn('[KEY轮换] 所有KEY都已用完，重置状态');
        this.failedKeys.clear();
        this.currentIndex = 0;
        return this.keys[0];
    },
    
    /**
     * 记录KEY使用
     */
    recordUsage(key) {
        if (!this.keyUsageCount[key]) {
            this.keyUsageCount[key] = 0;
        }
        this.keyUsageCount[key]++;
        
        // 如果接近上限，自动切换到下一个
        if (this.keyUsageCount[key] >= this.maxUsagePerKey) {
            console.log(`[KEY轮换] KEY ${key.substring(0, 8)}... 已使用 ${this.keyUsageCount[key]} 次，接近上限`);
            return this.getNextKey();
        }
        return key;
    },
    
    /**
     * 获取状态信息
     */
    getStatus() {
        return {
            totalKeys: this.keys.length,
            currentIndex: this.currentIndex,
            currentKey: this.getCurrentKey().substring(0, 8) + '...',
            failedCount: this.failedKeys.size,
            usageStats: this.keyUsageCount
        };
    },
    
    /**
     * 重置所有状态
     */
    reset() {
        this.currentIndex = 0;
        this.failedKeys.clear();
        this.keyUsageCount = {};
        console.log('[KEY轮换] 状态已重置');
    }
};

// 导出配置（用于模块化环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, TiandituKeyManager };
}
