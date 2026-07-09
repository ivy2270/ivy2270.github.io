const { createApp } = Vue;

// 💡 本地測試時用 localhost，之後部署上線再改成 Cloudflare 的正式網址
const API_BASE_URL = ' https://my-money-app.ivy2270.workers.dev'; 

// ==========================================
// 1. 動態 Manifest 處理 (PWA 設定 - 維持原樣)
// ==========================================
(function() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    const appId = "my-money-log-pwa";
    let manifestData = { 
        "id": appId, "name": "微時記帳", "short_name": "微時記帳", "start_url": "index.html", "display": "standalone", "background_color": "#fff9f9", "theme_color": "#ffb7b2", "icons": [{"src": "money-bag-money-svgrepo-com.svg", "sizes": "192x192", "type": "image/svg+xml"}] 
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

// ==========================================
// 2. Vue App 實例
// ==========================================
createApp({
    data() {
        return {
            activeTab: 'list',
            showAddModal: false,
            showFilterPanel: false, 
            loading: false,
            lightboxUrl: null,
            toastMsg: null,
            logs: [],         // 存放消費明細
            categoryData: [], // 存放大分類與小分類
            payments: [],     // 存放付款方式
            selectedMain: '',
            chartInstance: null,
            chartDrillCategory: null, 
            selectedPayments: [], 
            showPaymentFilter: false, 
            adminKey: new URLSearchParams(window.location.search).get('key') || '',
            selectedMonth: '',
            
            // 表單內容 (欄位名稱配合 D1 資料庫微調)
            form: { 
                id: null, date: '', item: '', amount: null, 
                subCategory: '', mainCategory: '', payment: '', 
                note: '', imageData: '', imageUrl: null, imageId: '', deleteImage: false 
            },
            
            // 篩選器條件
            filter: { start: '', end: '', mainCategory: '', payment: '', keyword: '' },

            // 圖片手勢變數
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
        isAdmin() {
            return this.adminKey.trim() !== '';
        },
        monthOptions() {
            const months = new Set(this.logs.map(log => String(log.date || '').slice(0, 7)).filter(Boolean));
            return [...months].sort().reverse();
        },
        // 整合篩選邏輯 (欄位從中文改成英文，如 log.date, log.main_category)
        processedLogs() {
            return this.logs
                .filter(log => {
                    const d = this.formatToISODate(log.date);
                    // 1. 日期篩選
                    const dateMatch = (!this.filter.start || d >= this.filter.start) && 
                                     (!this.filter.end || d <= this.filter.end);
                    
                    // 2. 大分類篩選
                    const logMainCat = log.main_category || log.大分類 || '';
                    const catMatch = !this.filter.mainCategory || logMainCat === this.filter.mainCategory;

                    // 3. 付款方式篩選
                    const logPayment = log.payment_method || log.付款方式 || '';
                    const payMatch = !this.filter.payment || logPayment === this.filter.payment;

                    // 4. 關鍵字篩選
                    const searchStr = ((log.item_name || log.品項 || '') + (log.note || log.備註 || '')).toLowerCase();
                    const keyMatch = !this.filter.keyword || searchStr.includes(this.filter.keyword.toLowerCase());

                    return dateMatch && catMatch && payMatch && keyMatch;
                })
                .map(log => ({
                    ...log,
                    // ✨ 核心修正：建立與 index.html 中文欄位的橋樑
                    // 如果後端是英文(如 item_name)，就複製一份給 HTML 認得的中文(如 品項)
                    品項: log.品項 || log.item_name || '',
                    金額: log.金額 || log.amount || 0,
                    大分類: log.大分類 || log.main_category || '',
                    小分類: log.小分類 || log.sub_category || '',
                    付款方式: log.付款方式 || log.payment_method || '',
                    備註: log.備註 || log.note || '',
                    
                    displayDate: this.formatToDisplayDate(log.date),
                    // 新圖走 R2，舊資料若是 Google Drive ID 則維持原本顯示方式
                    imageUrl: this.getImageUrl(log.image_id)
                })).sort((a, b) => new Date(b.date) - new Date(a.date)); 
        },
        totalExpense() { 
            return this.processedLogs.reduce((sum, i) => sum + Number(i.amount || 0), 0); 
        },
        paymentSummary() {
            if (this.selectedPayments.length === 0) return null;
            return this.processedLogs
                .filter(log => this.selectedPayments.includes(log.payment_method))
                .reduce((sum, i) => sum + Number(i.amount || 0), 0);
        },
        paymentFilteredLogs() {
            if (this.selectedPayments.length === 0) return [];
            return this.processedLogs.filter(log => this.selectedPayments.includes(log.payment_method));
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
            if (newTab === 'settings' && !this.isAdmin) {
                this.activeTab = 'list';
                this.showToast("目前是唯讀模式");
                return;
            }
            if (newTab === 'chart') {
                this.$nextTick(() => { setTimeout(() => this.renderChart(), 350); });
            }
        },
        'filter.start'() { if(this.activeTab === 'chart') this.renderChart(); },
        'filter.end'() { if(this.activeTab === 'chart') this.renderChart(); }
    },
    methods: {
        showToast(msg) { this.toastMsg = msg; setTimeout(() => { this.toastMsg = null; }, 2000); },
        formatToISODate(dateVal) { 
            const d = new Date(dateVal); 
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
        },
        formatToDisplayDate(dateVal) { 
            const d = new Date(dateVal); 
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; 
        },
        setFilterMonth(monthValue) {
            if (!monthValue) return;
            const [year, month] = monthValue.split('-').map(Number);
            const lastDay = new Date(year, month, 0).getDate();
            this.filter.start = `${year}-${String(month).padStart(2, '0')}-01`;
            this.filter.end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            if (this.activeTab === 'chart') this.$nextTick(() => this.renderChart());
        },

        // --- 初始化與資料讀取 (精簡優化版) ---
        async init() {
            // 先讀取本地快取，達到秒開效果
            const cacheCats = localStorage.getItem('cache_categories');
            const cachePayments = localStorage.getItem('cache_payments');
            const cacheLogs = localStorage.getItem('cache_logs');
            if (cacheCats) this.categoryData = JSON.parse(cacheCats);
            if (cachePayments) this.payments = JSON.parse(cachePayments);
            if (cacheLogs) this.logs = JSON.parse(cacheLogs); 
            
            // 預設日期區間：本月 1 號到今天
            const now = new Date();
            if (!this.filter.start && !this.filter.end) {
                this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                this.filter.start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                this.filter.end = this.formatToISODate(now);
            }
            
            this.loading = true;
            try {
                // 💡 一次 fetch 撈回所有資料 (明細、分類、設定)，省去多次請求時間
                const res = await fetch(`${API_BASE_URL}/api/data`);
                const data = await res.json();
                
                // 轉換分類資料結構以契合原本的前端
                const uniqueMains = [...new Set(data.categories.map(c => c.main_category))];
                this.categoryData = uniqueMains.map(main => {
                    const subs = data.categories.filter(c => c.main_category === main).map(c => c.sub_category);
                    return { main, subRaw: subs.join(','), subs };
                });

                this.payments = data.settings.map(s => s.payment_method);
                this.logs = data.expenses;

                // 更新快取
                localStorage.setItem('cache_categories', JSON.stringify(this.categoryData));
                localStorage.setItem('cache_payments', JSON.stringify(this.payments));
                localStorage.setItem('cache_logs', JSON.stringify(this.logs));
            } catch (e) { 
                this.showToast("❌ 資料讀取失敗"); 
                console.error(e);
            } finally { 
                this.loading = false; 
            }
        },

        // --- 表單與圖片處理 ---
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
                    const maxSide = 960;
                    if (width > height && width > maxSide) { height *= maxSide / width; width = maxSide; }
                    else if (height > maxSide) { width *= maxSide / height; height = maxSide; }
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    this.form.imageData = canvas.toDataURL('image/webp', 0.65);
                    if (!this.form.imageData.startsWith('data:image/webp')) {
                        this.showToast("❌ 這個瀏覽器不支援 WebP 轉檔");
                        this.form.imageData = '';
                        return;
                    }
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
            if (!this.isAdmin) return this.showToast("目前是唯讀模式");
            this.resetForm(); 
            if (this.categoryData.length > 0) this.selectMain(this.categoryData[0].main); 
            this.showAddModal = true; 
        },
        editLog(item) {
            if (!this.isAdmin) return;
            this.form = { 
                id: item.id, date: this.formatToISODate(item.date), item: item.item_name, 
                amount: item.amount, mainCategory: item.main_category, subCategory: item.sub_category, 
                payment: item.payment_method, note: item.note || '', imageData: '', 
                imageUrl: item.imageUrl, imageId: item.image_id || '', deleteImage: false 
            };
            this.selectedMain = item.main_category; 
            this.showAddModal = true;
        },
        resetForm() { 
            this.form = { id: null, date: this.formatToISODate(new Date()), item: '', amount: null, subCategory: '', mainCategory: '', payment: '', note: '', imageData: '', imageUrl: null, imageId: '', deleteImage: false }; 
        },
        closeModal() { this.showAddModal = false; this.resetForm(); },
        removeImage() { this.form.imageData = ''; this.form.imageUrl = null; this.form.imageId = ''; this.form.deleteImage = true; },
        getImageUrl(imageId) {
            if (!imageId) return null;
            if (imageId.startsWith('http')) return imageId;
            if (imageId.startsWith('r2:')) {
                return `${API_BASE_URL}/api/images/${encodeURIComponent(imageId.slice(3))}`;
            }
            return `https://drive.google.com/thumbnail?id=${imageId}&sz=s1000`;
        },
        async uploadImage(recordId) {
            if (!this.form.imageData) return this.form.imageId;

            const response = await fetch(`${API_BASE_URL}/api/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: this.adminKey,
                    id: recordId,
                    imageData: this.form.imageData
                })
            });
            const result = await response.json();
            if (result.error) throw new Error(result.error);
            return result.image_id;
        },

        // --- 新增消費紀錄到 Cloudflare ---
        async submitAdd() {
            if (!this.isAdmin) return this.showToast("目前是唯讀模式");
            if (!this.form.item || !this.form.amount || !this.form.subCategory) return this.showToast("⚠️ 欄位未填完");
            this.loading = true; 
            
            // 💡 整理傳送給 Worker 的欄位格式
            const payload = {
                id: this.form.id,
                date: this.form.date,
                item_name: this.form.item,
                amount: this.form.amount,
                main_category: this.form.mainCategory,
                sub_category: this.form.subCategory,
                payment_method: this.form.payment,
                note: this.form.note,
                image_id: this.form.imageId,
                key: this.adminKey
            };

            try {
                const isUpdate = Boolean(this.form.id);
                const recordId = this.form.id || crypto.randomUUID();
                payload.id = recordId;
                if (this.form.imageData) {
                    payload.image_id = await this.uploadImage(recordId);
                } else if (this.form.deleteImage) {
                    payload.image_id = "";
                }
                const url = isUpdate ? `${API_BASE_URL}/api/expenses/${encodeURIComponent(this.form.id)}` : `${API_BASE_URL}/api/expenses`;
                const response = await fetch(url, { 
                    method: isUpdate ? 'PUT' : 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload) 
                });
                const result = await response.json();
                if (result.error) throw new Error(result.error);
                
                this.showToast("✅ 儲存成功"); 
                this.showAddModal = false; 
                await this.init(); // 重新整理資料
            } catch (e) { 
                this.showToast("❌ " + e.message); 
            } finally { 
                this.loading = false; 
            }
        },
        
        async deleteLog(id) {
            if (!this.isAdmin) return this.showToast("目前是唯讀模式");
            if (!confirm("確定刪除？")) return;
            this.loading = true;
            try {
                const response = await fetch(`${API_BASE_URL}/api/expenses/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: this.adminKey })
                });
                const result = await response.json();
                if (result.error) throw new Error(result.error);
                this.showToast("✅ 刪除成功");
                this.closeModal();
                await this.init();
            } catch (e) {
                this.showToast("❌ " + e.message);
            } finally {
                this.loading = false;
            }
        },

        // --- 統計圖表 ---
        renderChart() {
            const ctx = document.getElementById('myChart');
            if (!ctx) return; 
            if (this.chartInstance) this.chartInstance.destroy();
            this.chartDrillCategory = null;
            const stats = {};
            this.processedLogs.forEach(log => {
                const m = log.main_category || '未分類';
                stats[m] = (stats[m] || 0) + Number(log.amount);
            });
            const labels = Object.keys(stats);
            if (labels.length === 0) return;
            const self = this;
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
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, 
                    cutout: '65%',
                    onClick(event, elements) {
                        if (elements.length > 0) {
                            const clickedLabel = labels[elements[0].index];
                            self.chartDrillCategory = self.chartDrillCategory === clickedLabel ? null : clickedLabel;
                        } else {
                            self.chartDrillCategory = null;
                        }
                    }
                }
            });
        },
        drillLogs() {
            if (!this.chartDrillCategory) return [];
            return this.processedLogs.filter(log => (log.main_category || '未分類') === this.chartDrillCategory);
        },

        // --- 設定管理 (暫留，之後可實作寫入 D1) ---
        async saveSettings() {
            if (!this.isAdmin) return this.showToast("目前是唯讀模式");
            this.loading = true;
            try {
                const categories = this.categoryData
                    .map(cat => ({
                        main: (cat.main || '').trim(),
                        subs: String(cat.subRaw || '').split(',').map(s => s.trim()).filter(Boolean)
                    }))
                    .filter(cat => cat.main && cat.subs.length > 0);

                const payments = this.payments.map(p => String(p).trim()).filter(Boolean);
                const response = await fetch(`${API_BASE_URL}/api/settings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: this.adminKey, categories, payments })
                });
                const result = await response.json();
                if (result.error) throw new Error(result.error);
                this.showToast("✅ 設定已儲存");
                await this.init();
            } catch (e) {
                this.showToast("❌ " + e.message);
            } finally {
                this.loading = false;
            }
        },
        moveItem(arr, index, step) { 
            const targetIndex = index + step; 
            if (targetIndex < 0 || targetIndex >= arr.length) return; 
            const temp = arr[index]; arr.splice(index, 1); arr.splice(targetIndex, 0, temp); 
        },

        // --- 手勢與 Lightbox ---
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
    }
}).mount('#app');
