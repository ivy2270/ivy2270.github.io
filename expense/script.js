const { createApp } = Vue;
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzttIuCcfW6dapMYYwQ8m5Ve7C_NoMF4jLV5VkSITrwKkFD_kW8aekL5WKXLH9tgILnqw/exec';

createApp({
    data() {
        return {
            activeTab: 'list',
            showAddModal: false,
            loading: false, // 全域與按鈕的載入狀態
            lightboxUrl: null,
            logs: [],
            categoryData: [], // 格式: {main: '食', subRaw: '早餐,午餐', subs: []}
            payments: [],
            selectedMain: '',
            chartInstance: null,
            form: { 
                id: null, date: '', item: '', amount: null, 
                subCategory: '', mainCategory: '', payment: '', 
                note: '', imageData: '', imageUrl: null, deleteImage: false 
            },
            filter: { start: '', end: '' }
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
                    // 修正時差：統一轉為 YYYY-MM-DD 字串進行字串比較
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
        // 重要：監聽標籤切換，當進入「統計」分頁時才繪製圖表
        activeTab(newTab) {
            if (newTab === 'chart') {
                this.$nextTick(() => this.renderChart());
            }
        },
        // 當過濾日期或資料更新時，如果人在統計頁，就自動重畫圖表
        'filter.start'() { if(this.activeTab === 'chart') this.renderChart(); },
        'filter.end'() { if(this.activeTab === 'chart') this.renderChart(); },
        logs: {
            deep: true,
            handler() { if(this.activeTab === 'chart') this.renderChart(); }
        }
    },
    methods: {
        // --- 工具：日期處理 ---
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
    // --- 1. 啟動瞬間：立刻抓取所有快取（包含帳目） ---
    const cacheCats = localStorage.getItem('cache_categories');
    const cachePayments = localStorage.getItem('cache_payments');
    const cacheLogs = localStorage.getItem('cache_logs'); // 新增：抓帳目快取

    if (cacheCats) this.categoryData = JSON.parse(cacheCats);
    if (cachePayments) this.payments = JSON.parse(cachePayments);
    if (cacheLogs) this.logs = JSON.parse(cacheLogs); // 新增：立刻填入帳目，避免看到空白提示
    
    // --- 2. 設定預設日期 (這要放在抓 logs 後面，processedLogs 才能正確過濾) ---
    const now = new Date();
    this.filter.start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    this.filter.end = this.formatToISODate(now);

    // --- 3. 開始連網同步更新 ---
    this.loading = true;
    try {
        const res = await fetch(`${GAS_URL}?action=init`);
        const data = await res.json();
        
        this.categoryData = data.categories.map(c => ({
            main: c.main,
            subRaw: c.subs.join(','),
            subs: c.subs
        }));
        this.payments = data.payments;

        // 更新快取
        localStorage.setItem('cache_categories', JSON.stringify(this.categoryData));
        localStorage.setItem('cache_payments', JSON.stringify(this.payments));

        // 預設展開第一個分類
        if (this.categoryData.length > 0) this.selectMain(this.categoryData[0].main);

        await this.fetchLogs();
    } catch (e) {
        console.error("初始化失敗", e);
    } finally {
        this.loading = false;
    }
},

async fetchLogs() {
    // 這裡維持原本的 fetch 邏輯即可，快取已在 init 載入過，這裡負責更新
    const res = await fetch(`${GAS_URL}?action=getLogs`);
    const data = await res.json();
    this.logs = data;

    // 存入最新資料到快取
    localStorage.setItem('cache_logs', JSON.stringify(data));
},

        // --- 彈窗與表單操作 ---
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
            // 代入完整資料至表單
            this.form = {
                id: item.ID,
                date: this.formatToISODate(item.日期),
                item: item.品項,
                amount: item.金額,
                mainCategory: item.大分類,
                subCategory: item.小分類,
                payment: item.付款方式,
                note: item.備註 || '',
                imageData: '', // 新選取的圖片
                imageUrl: item.imageUrl, // 現有的圖片網址
                deleteImage: false // 初始化為不刪除
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
        closeModal() {
            this.showAddModal = false;
            this.resetForm();
        },
        removeImage() {
            this.form.imageData = ''; // 清除新選取的圖
            this.form.imageUrl = null; // 清除原本預覽
            this.form.deleteImage = true; // 標記要刪除雲端圖片
        },

        // --- 資料同步 (POST 至 GAS) ---
        async submitAdd() {
            if (!this.form.item || !this.form.amount || !this.form.subCategory) return alert("請填寫品項、金額與分類");
            this.loading = true; // 按鈕會進入 Loading 狀態
            const action = this.form.id ? 'update' : 'add';
            try {
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action, ...this.form }) });
                this.showAddModal = false;
                await this.fetchLogs();
            } catch (e) { 
                alert("連線失敗，請稍後再試"); 
            } finally {
                this.loading = false;
            }
        },
        async deleteLog(id) {
            if (!confirm("確定要刪除這筆支出嗎？")) return;
            this.loading = true;
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
            this.showAddModal = false;
            await this.fetchLogs();
            this.loading = false;
        },
        async saveSettings() {
            this.loading = true;
            try {
                // 同步付款方式
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updatePayments', data: this.payments.filter(p => p) }) });
                // 同步分類資料
                const catData = this.categoryData.map(c => ({
                    main: c.main,
                    subs: c.subRaw.split(',').map(s => s.trim()).filter(s => s)
                }));
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateCategories', data: catData }) });
                alert("設定已儲存！");
                this.init(); // 重新載入設定
            } catch (e) {
                alert("儲存設定時發生錯誤");
            } finally {
                this.loading = false;
            }
        },

        // --- 排序功能 ---
        moveItem(arr, index, step) {
            const targetIndex = index + step;
            if (targetIndex < 0 || targetIndex >= arr.length) return;
            const temp = arr[index];
            arr.splice(index, 1);
            arr.splice(targetIndex, 0, temp);
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
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } }
                    },
                    cutout: '65%'
                }
            });
        },

        // --- 圖片處理 ---
        handleFileUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            
            // 當選取新圖片時，取消刪除標記
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
    }
}).mount('#app');