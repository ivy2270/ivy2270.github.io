const { createApp } = Vue;
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyU47_P83rasDWhTeMfGUcAT6Bzkei3q4bRqY00tIkSTtpzoHryiV5wcK_0KNnoFYJ4qQ/exec';

// ==========================================
// 1. 動態 Manifest 處理 (PWA 設定)
// ==========================================
(function() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    const appId = "my-money-log-pwa";
    let manifestData = { 
        "id": appId, 
        "name": "微時記帳", 
        "short_name": "微時記帳", 
        "start_url": "index.html", 
        "display": "standalone", 
        "background_color": "#fff9f9", 
        "theme_color": "#ffb7b2", 
        "icons": [{"src": "money-bag-money-svgrepo-com.svg", "sizes": "192x192", "type": "image/svg+xml"}] 
    };
    if (key && key.trim() !== "") { 
        manifestData.name = "微時記帳 (管理版)"; 
        manifestData.start_url = "index.html?key=" + key; 
    }
    const stringManifest = JSON.stringify(manifestData);
    const blob = new Blob([stringManifest], {type: 'application/json'});
    const manifestURL = URL.createObjectURL(blob);
    const linkEl = document.getElementById('manifest-link');
    if (linkEl) { linkEl.setAttribute('href', manifestURL); }
})();

const USER_KEY = (function() {
    const key = new URLSearchParams(window.location.search).get('key');
    return (key && key.trim() !== "") ? key : null;
})();

// ==========================================
// 2. Vue App 實例
// ==========================================
createApp({
    data() {
        return {
            activeTab: 'list',
            showAddModal: false,
            showFilterPanel: false, // 收納式篩選器開關
            loading: false,
            lightboxUrl: null,
            toastMsg: null,
            logs: [],
            categoryData: [],
            payments: [],
            selectedMain: '',
            chartInstance: null,
            
            // 表單內容
            form: { 
                id: null, date: '', item: '', amount: null, 
                subCategory: '', mainCategory: '', payment: '', 
                note: '', imageData: '', imageUrl: null, deleteImage: false 
            },
            
            // 篩選器條件
            filter: { 
                start: '', 
                end: '',
                mainCategory: '',
                payment: '',
                keyword: ''
            },

            // 圖片縮放與手勢變數
            touchStartX: 0, touchEndX: 0, touchStartY: 0, touchEndY: 0,
            zoomScale: 1, lastScale: 1, offsetX: 0, offsetY: 0,
            touchStartDist: 0, touchStartPoint: { x: 0, y: 0 }, isDragging: false
        }
    },
    computed: {
        currentTabTitle() {
            const map = { 'list': '收支明細', 'chart': '消費分析', 'settings': '系統設定' };
            return map[this.activeTab];
        },
        // 核心：整合篩選邏輯
        processedLogs() {
            return this.logs
                .filter(log => {
                    const d = this.formatToISODate(log.日期);
                    // 1. 日期篩選
                    const dateMatch = (!this.filter.start || d >= this.filter.start) && 
                                     (!this.filter.end || d <= this.filter.end);
                    
                    // 2. 大分類篩選
                    let logMainCat = log.大分類;
                    if(!logMainCat) { // 若舊資料無大分類，則從小分類反查
                        const found = this.categoryData.find(c => c.subRaw.includes(log.小分類));
                        logMainCat = found ? found.main : '';
                    }
                    const catMatch = !this.filter.mainCategory || logMainCat === this.filter.mainCategory;

                    // 3. 付款方式篩選
                    const payMatch = !this.filter.payment || log.付款方式 === this.filter.payment;

                    // 4. 關鍵字篩選 (搜尋品項名稱或備註)
                    const searchStr = ((log.品項 || '') + (log.備註 || '')).toLowerCase();
                    const keyMatch = !this.filter.keyword || searchStr.includes(this.filter.keyword.toLowerCase());

                    return dateMatch && catMatch && payMatch && keyMatch;
                })
                .map(log => ({
                    ...log,
                    displayDate: this.formatToDisplayDate(log.日期),
                    imageUrl: log.圖片ID ? `https://drive.google.com/thumbnail?id=${log.圖片ID}&sz=s1000` : null
                })).reverse(); // 最新日期在最前
        },
        totalExpense() { 
            return this.processedLogs.reduce((sum, i) => sum + Number(i.金額 || 0), 0); 
        },
        zoomStyle() {
            return { 
                transform: `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.zoomScale})`, 
                transition: this.isDragging ? 'none' : 'transform 0.15s ease-out' 
            };
        }
    },
    watch: {
        activeTab(newTab) {
            if (newTab === 'chart') {
                this.$nextTick(() => { setTimeout(() => this.renderChart(), 350); });
            }
        },
        // 當日期篩選改變，自動重繪圖表
        'filter.start'() { if(this.activeTab === 'chart') this.renderChart(); },
        'filter.end'() { if(this.activeTab === 'chart') this.renderChart(); }
    },
    methods: {
        // --- 通用工具 ---
        showToast(msg) { this.toastMsg = msg; setTimeout(() => { this.toastMsg = null; }, 2000); },
        formatToISODate(dateVal) { 
            const d = new Date(dateVal); 
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
        },
        formatToDisplayDate(dateVal) { 
            const d = new Date(dateVal); 
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; 
        },

        // --- 初始化與資料讀取 ---
        async init() {
            // 讀取快取
            const cacheCats = localStorage.getItem('cache_categories');
            const cachePayments = localStorage.getItem('cache_payments');
            const cacheLogs = localStorage.getItem('cache_logs');
            if (cacheCats) this.categoryData = JSON.parse(cacheCats);
            if (cachePayments) this.payments = JSON.parse(cachePayments);
            if (cacheLogs) this.logs = JSON.parse(cacheLogs); 
            
            // 預設日期區間：本月 1 號到今天
            const now = new Date();
            this.filter.start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            this.filter.end = this.formatToISODate(now);
            
            this.loading = true;
            try {
                const res = await fetch(`${GAS_URL}?action=init`);
                const data = await res.json();
                this.categoryData = data.categories.map(c => ({ main: c.main, subRaw: c.subs.join(','), subs: c.subs }));
                this.payments = data.payments;
                localStorage.setItem('cache_categories', JSON.stringify(this.categoryData));
                localStorage.setItem('cache_payments', JSON.stringify(this.payments));
                await this.fetchLogs();
            } catch (e) { this.showToast("❌ 初始化失敗"); } finally { this.loading = false; }
        },
        async fetchLogs() {
            const res = await fetch(`${GAS_URL}?action=getLogs`);
            const data = await res.json();
            this.logs = data;
            localStorage.setItem('cache_logs', JSON.stringify(data));
        },

        // --- 表單與圖片處理 (補回遺漏部分) ---
        handleFileUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            this.showToast("圖片處理中...");
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width; let height = img.height;
                    const maxSide = 1024;
                    if (width > height && width > maxSide) { height *= maxSide / width; width = maxSide; }
                    else if (height > maxSide) { width *= maxSide / height; height = maxSide; }
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    this.form.imageData = canvas.toDataURL('image/jpeg', 0.7);
                    this.showToast("📷 圖片讀取成功");
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        },
        selectMain(mainName) { this.selectedMain = mainName; this.form.mainCategory = mainName; },
        getSubCategories(mainName) { 
            const cat = this.categoryData.find(c => c.main === mainName); 
            return cat ? cat.subRaw.split(',').map(s => s.trim()).filter(s => s) : []; 
        },
        openAddModal() { 
            this.resetForm(); 
            if (this.categoryData.length > 0) this.selectMain(this.categoryData[0].main); 
            this.showAddModal = true; 
        },
        editLog(item) {
            this.form = { 
                id: item.ID, date: this.formatToISODate(item.日期), item: item.品項, 
                amount: item.金額, mainCategory: item.大分類, subCategory: item.小分類, 
                payment: item.付款方式, note: item.備註 || '', imageData: '', 
                imageUrl: item.imageUrl, deleteImage: false 
            };
            this.selectedMain = item.大分類; 
            this.showAddModal = true;
        },
        resetForm() { 
            this.form = { id: null, date: this.formatToISODate(new Date()), item: '', amount: null, subCategory: '', mainCategory: '', payment: '', note: '', imageData: '', imageUrl: null, deleteImage: false }; 
        },
        closeModal() { this.showAddModal = false; this.resetForm(); },
        removeImage() { this.form.imageData = ''; this.form.imageUrl = null; this.form.deleteImage = true; },

        async submitAdd() {
            if (!this.form.item || !this.form.amount || !this.form.subCategory) return this.showToast("⚠️ 欄位未填完");
            this.loading = true; 
            const action = this.form.id ? 'update' : 'add';
            try {
                const response = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action, key: USER_KEY, ...this.form }) });
                const result = await response.json();
                if (result.status === 'error') throw new Error(result.message);
                this.showToast("✅ 儲存成功"); this.showAddModal = false; await this.fetchLogs();
            } catch (e) { this.showToast("❌ " + e.message); } finally { this.loading = false; }
        },
        async deleteLog(id) {
            if (!confirm("確定刪除？")) return;
            this.loading = true;
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'delete', key: USER_KEY, id }) });
                this.showToast("🗑️ 已刪除"); this.showAddModal = false; await this.fetchLogs();
            } catch (e) { this.showToast("❌ 刪除失敗"); } finally { this.loading = false; }
        },

        // --- 統計圖表 ---
        renderChart() {
            const ctx = document.getElementById('myChart');
            if (!ctx) return; 
            if (this.chartInstance) this.chartInstance.destroy();
            const stats = {};
            this.processedLogs.forEach(log => {
                const m = log.大分類 || '未分類';
                stats[m] = (stats[m] || 0) + Number(log.金額);
            });
            const labels = Object.keys(stats);
            if (labels.length === 0) return;
            this.chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: { 
                    labels: labels, 
                    datasets: [{ 
                        data: Object.values(stats), 
                        backgroundColor: ['#FFB7B2', '#B2E2F2', '#B2F2BB', '#FFFFD1', '#DAC1FF', '#FFDAC1'], 
                        borderWidth: 2, borderColor: '#ffffff' 
                    }] 
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, cutout: '65%' }
            });
        },

        // --- 設定管理 ---
        async saveSettings() {
            this.loading = true;
            try {
                const catData = this.categoryData.map(c => ({ main: c.main, subs: c.subRaw.split(',').map(s => s.trim()).filter(s => s) }));
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updatePayments', key: USER_KEY, data: this.payments.filter(p => p) }) });
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateCategories', key: USER_KEY, data: catData }) });
                this.showToast("✨ 設定已同步"); await this.init(); 
            } catch (e) { this.showToast("❌ 儲存失敗"); } finally { this.loading = false; }
        },
        moveItem(arr, index, step) { 
            const targetIndex = index + step; 
            if (targetIndex < 0 || targetIndex >= arr.length) return; 
            const temp = arr[index]; arr.splice(index, 1); arr.splice(targetIndex, 0, temp); 
        },

        // --- 手勢與 Lightbox (補回遺漏部分) ---
        handleSwipe() {
            const diffX = this.touchStartX - this.touchEndX;
            const diffY = this.touchStartY - this.touchEndY;
            if (Math.abs(diffX) > 75 && Math.abs(diffY) < 40) {
                const tabs = ['list', 'chart', 'settings'];
                let idx = tabs.indexOf(this.activeTab);
                if (diffX > 0 && idx < 2) this.activeTab = tabs[idx + 1];
                else if (diffX < 0 && idx > 0) this.activeTab = tabs[idx - 1];
            }
        },
        openLightbox(url) { 
            this.lightboxUrl = url; 
            this.zoomScale = 1; this.offsetX = 0; this.offsetY = 0; 
        },
        closeLightbox() { this.lightboxUrl = null; },
        
        // 圖片縮放邏輯
        handleTouchStartImg(e) {
            if (e.touches.length === 2) {
                this.touchStartDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                this.lastScale = this.zoomScale;
            } else if (e.touches.length === 1) {
                this.isDragging = true;
                this.touchStartPoint = { x: e.touches[0].pageX - this.offsetX, y: e.touches[0].pageY - this.offsetY };
            }
        },
        handleTouchMoveImg(e) {
            if (e.touches.length === 2) {
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                this.zoomScale = Math.min(Math.max(this.lastScale * (dist / this.touchStartDist), 1), 4);
            } else if (e.touches.length === 1 && this.isDragging) {
                this.offsetX = e.touches[0].pageX - this.touchStartPoint.x;
                this.offsetY = e.touches[0].pageY - this.touchStartPoint.y;
            }
        },
        handleTouchEndImg() { this.isDragging = false; if (this.zoomScale === 1) { this.offsetX = 0; this.offsetY = 0; } }
    },
    mounted() {
        this.init();
        window.addEventListener('touchstart', (e) => { this.touchStartX = e.touches[0].clientX; this.touchStartY = e.touches[0].clientY; }, { passive: true });
        window.addEventListener('touchend', (e) => { this.touchEndX = e.changedTouches[0].clientX; this.touchEndY = e.changedTouches[0].clientY; this.handleSwipe(); }, { passive: true });
        
        // PWA 更新偵測 (從原始腳本補回)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg) {
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                if(confirm("發現新版本！是否更新？")) location.reload(true);
                            }
                        };
                    };
                }
            });
        }
    }
}).mount('#app');
