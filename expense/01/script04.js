const { createApp } = Vue;
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzttIuCcfW6dapMYYwQ8m5Ve7C_NoMF4jLV5VkSITrwKkFD_kW8aekL5WKXLH9tgILnqw/exec';

createApp({
    data() {
        return {
            activeTab: 'list',
            showAddModal: false,
            loading: false,
            lightboxUrl: null,
            toastMsg: null,
            logs: [],
            categoryData: [],
            payments: [],
            selectedMain: '',
            chartInstance: null,
            form: { 
                id: null, date: '', item: '', amount: null, 
                subCategory: '', mainCategory: '', payment: '', 
                note: '', imageData: '', imageUrl: null, deleteImage: false 
            },
            filter: { start: '', end: '' },
            // 分頁切換手勢座標
            touchStartX: 0,
            touchEndX: 0,
            touchStartY: 0,
            touchEndY: 0,
            // 燈箱圖片縮放與平移狀態
            zoomScale: 1,
            lastScale: 1,
            offsetX: 0,
            offsetY: 0,
            touchStartDist: 0,
            touchStartPoint: { x: 0, y: 0 },
            isDragging: false
        }
    },
    computed: {
        currentTabTitle() {
            const map = { 'list': '收支明細', 'chart': '消費分析', 'settings': '系統設定' };
            return map[this.activeTab];
        },
        processedLogs() {
            return this.logs
                .filter(log => {
                    const d = this.formatToISODate(log.日期);
                    return d >= this.filter.start && d <= this.filter.end;
                })
                .map(log => ({
                    ...log,
                    displayDate: this.formatToDisplayDate(log.日期),
                    imageUrl: log.圖片ID ? `https://drive.google.com/thumbnail?id=${log.圖片ID}&sz=s1000` : null
                })).reverse();
        },
        totalExpense() { 
            return this.processedLogs.reduce((sum, i) => sum + Number(i.金額 || 0), 0); 
        },
        // 燈箱圖片動態樣式
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
                this.$nextTick(() => {
                    setTimeout(() => this.renderChart(), 350);
                });
            }
        },
        'filter.start'() { if(this.activeTab === 'chart') this.renderChart(); },
        'filter.end'() { if(this.activeTab === 'chart') this.renderChart(); },
        logs: {
            deep: true,
            handler() { if(this.activeTab === 'chart') this.renderChart(); }
        }
    },
    methods: {
        // --- 核心手勢判定：分頁切換 ---
        handleSwipe() {
            const swipeThreshold = 75;
            const verticalLimit = 35;
            const diffX = this.touchStartX - this.touchEndX;
            const diffY = this.touchStartY - this.touchEndY;

            if (Math.abs(diffX) > swipeThreshold && 
                Math.abs(diffY) < verticalLimit && 
                Math.abs(diffX) > Math.abs(diffY) * 3) {
                
                const tabs = ['list', 'chart', 'settings'];
                let currentIndex = tabs.indexOf(this.activeTab);

                if (diffX > 0 && currentIndex < tabs.length - 1) {
                    this.activeTab = tabs[currentIndex + 1];
                } else if (diffX < 0 && currentIndex > 0) {
                    this.activeTab = tabs[currentIndex - 1];
                }
            }
        },

        // --- 燈箱圖片：雙指縮放與單指平移 ---
        handleTouchStartImg(e) {
            if (e.touches.length === 2) {
                // 雙指啟動：計算初始距離
                this.touchStartDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
            } else if (e.touches.length === 1 && this.zoomScale > 1) {
                // 已放大狀態下的單指平移啟動
                this.isDragging = true;
                this.touchStartPoint = {
                    x: e.touches[0].pageX - this.offsetX,
                    y: e.touches[0].pageY - this.offsetY
                };
            }
        },
        handleTouchMoveImg(e) {
            if (e.touches.length === 2) {
                // 雙指縮放中
                const currentDist = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const scale = (currentDist / this.touchStartDist) * this.lastScale;
                this.zoomScale = Math.min(Math.max(scale, 1), 4);
            } else if (e.touches.length === 1 && this.isDragging) {
                // 單指平移中
                this.offsetX = e.touches[0].pageX - this.touchStartPoint.x;
                this.offsetY = e.touches[0].pageY - this.touchStartPoint.y;
            }
        },
        handleTouchEndImg() {
            this.isDragging = false;
            this.lastScale = this.zoomScale;
            // 縮回原大小時重置位置
            if (this.zoomScale <= 1.05) {
                this.zoomScale = 1;
                this.lastScale = 1;
                this.offsetX = 0;
                this.offsetY = 0;
            }
        },
        
        // --- 基礎工具 ---
        showToast(msg) {
            this.toastMsg = msg;
            setTimeout(() => { this.toastMsg = null; }, 2000);
        },
        formatToISODate(dateVal) {
            const d = new Date(dateVal);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },
        formatToDisplayDate(dateVal) {
            const d = new Date(dateVal);
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
        },

        // --- 資料讀取與初始化 ---
        async init() {
            const cacheCats = localStorage.getItem('cache_categories');
            const cachePayments = localStorage.getItem('cache_payments');
            const cacheLogs = localStorage.getItem('cache_logs');
            if (cacheCats) this.categoryData = JSON.parse(cacheCats);
            if (cachePayments) this.payments = JSON.parse(cachePayments);
            if (cacheLogs) this.logs = JSON.parse(cacheLogs); 
            
            const now = new Date();
            this.filter.start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            this.filter.end = this.formatToISODate(now);
            
            this.loading = true;
            try {
                const res = await fetch(`${GAS_URL}?action=init`);
                const data = await res.json();
                this.categoryData = data.categories.map(c => ({
                    main: c.main, subRaw: c.subs.join(','), subs: c.subs
                }));
                this.payments = data.payments;
                localStorage.setItem('cache_categories', JSON.stringify(this.categoryData));
                localStorage.setItem('cache_payments', JSON.stringify(this.payments));
                if (this.categoryData.length > 0) this.selectMain(this.categoryData[0].main);
                await this.fetchLogs();
            } catch (e) {
                this.showToast("❌ 初始化連線失敗");
            } finally {
                this.loading = false;
            }
        },
        async fetchLogs() {
            const res = await fetch(`${GAS_URL}?action=getLogs`);
            const data = await res.json();
            this.logs = data;
            localStorage.setItem('cache_logs', JSON.stringify(data));
        },

        // --- 表單邏輯 ---
        selectMain(mainName) {
            this.selectedMain = mainName;
            this.form.mainCategory = mainName;
        },
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
            this.form = { 
                id: null, date: this.formatToISODate(new Date()), item: '', amount: null, 
                subCategory: '', mainCategory: '', payment: '', note: '', 
                imageData: '', imageUrl: null, deleteImage: false 
            };
        },
        closeModal() { this.showAddModal = false; this.resetForm(); },
        removeImage() { this.form.imageData = ''; this.form.imageUrl = null; this.form.deleteImage = true; },

        // --- 資料連線 ---
        async submitAdd() {
            if (!this.form.item || !this.form.amount || !this.form.subCategory) return this.showToast("⚠️ 填寫品項、金額與分類");
            this.loading = true;
            const action = this.form.id ? 'update' : 'add';
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action, ...this.form }) });
                this.showToast(this.form.id ? "✅ 已更新" : "✅ 已新增");
                this.showAddModal = false;
                await this.fetchLogs();
            } catch (e) { this.showToast("❌ 連線失敗"); } finally { this.loading = false; }
        },
        async deleteLog(id) {
            if (!confirm("確定要刪除嗎？")) return;
            this.loading = true;
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
                this.showToast("🗑️ 已刪除");
                this.showAddModal = false;
                await this.fetchLogs();
            } catch (e) { this.showToast("❌ 刪除失敗"); } finally { this.loading = false; }
        },
        async saveSettings() {
            this.loading = true;
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updatePayments', data: this.payments.filter(p => p) }) });
                const catData = this.categoryData.map(c => ({
                    main: c.main, subs: c.subRaw.split(',').map(s => s.trim()).filter(s => s)
                }));
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateCategories', data: catData }) });
                this.showToast("✨ 設定已儲存");
                await this.init(); 
            } catch (e) { this.showToast("❌ 儲存失敗"); } finally { this.loading = false; }
        },
        moveItem(arr, index, step) {
            const targetIndex = index + step;
            if (targetIndex < 0 || targetIndex >= arr.length) return;
            const temp = arr[index]; arr.splice(index, 1); arr.splice(targetIndex, 0, temp);
        },

        // --- 圖表繪製 ---
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
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } } },
                    cutout: '65%'
                }
            });
        },

        // --- 圖片處理 ---
        handleFileUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            this.form.deleteImage = false;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const max = 800;
                    let w = img.width, h = img.height;
                    if (w > h && w > max) { h *= max/w; w = max; }
                    else if (h > max) { w *= max/h; h = max; }
                    canvas.width = w; canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);
                    this.form.imageData = canvas.toDataURL('image/webp', 0.8);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        },
        openLightbox(url) { 
            this.lightboxUrl = url;
            // 開啟時重置縮放座標
            this.zoomScale = 1;
            this.lastScale = 1;
            this.offsetX = 0;
            this.offsetY = 0;
        },
        closeLightbox() {
            this.lightboxUrl = null;
            this.zoomScale = 1;
            this.offsetX = 0;
            this.offsetY = 0;
        }
    },
    mounted() {
        this.init();

        // 監聽全局手勢 - 座標記錄（用於分頁切換）
        window.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].clientX;
            this.touchEndY = e.changedTouches[0].clientY;
            this.handleSwipe();
        }, { passive: true });

        // PWA 自動更新偵測
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg) {
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                alert("發現新版本！請點擊確定以更新。");
                                location.reload(true);
                            }
                        };
                    };
                }
            });
        }
    }
}).mount('#app');