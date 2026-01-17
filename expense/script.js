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
            // 座標記錄
            touchStartX: 0,
            touchEndX: 0,
            touchStartY: 0,
            touchEndY: 0
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
        // --- 強化版手勢切換 ---
        handleSwipe() {
            const swipeThreshold = 70; // 水平移動至少 70px
            const diffX = this.touchStartX - this.touchEndX;
            const diffY = this.touchStartY - this.touchEndY;

            // 核心判定：水平移動必須明顯大於垂直移動 (判定為橫滑而非斜滑或捲動)
            // 我們使用兩倍比率，讓判定更嚴格
            if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                const tabs = ['list', 'chart', 'settings'];
                let currentIndex = tabs.indexOf(this.activeTab);

                if (diffX > 0 && currentIndex < tabs.length - 1) {
                    this.activeTab = tabs[currentIndex + 1];
                } else if (diffX < 0 && currentIndex > 0) {
                    this.activeTab = tabs[currentIndex - 1];
                }
            }
        },
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
        async submitAdd() {
            if (!this.form.item || !this.form.amount || !this.form.subCategory) return this.showToast("⚠️ 請填寫品項、金額與分類");
            this.loading = true;
            const action = this.form.id ? 'update' : 'add';
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action, ...this.form }) });
                this.showToast(this.form.id ? "✅ 已更新明細" : "✅ 已新增明細");
                this.showAddModal = false;
                await this.fetchLogs();
            } catch (e) { this.showToast("❌ 連線失敗"); } finally { this.loading = false; }
        },
        async deleteLog(id) {
            if (!confirm("確定要刪除這筆支出嗎？")) return;
            this.loading = true;
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
                this.showToast("🗑️ 已刪除資料");
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
        openLightbox(url) { this.lightboxUrl = url; }
    },
    mounted() {
        this.init();

        // 核心修正：同時監聽 X 與 Y
        window.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].clientX;
            this.touchEndY = e.changedTouches[0].clientY;
            this.handleSwipe();
        }, { passive: true });
    }
}).mount('#app');
