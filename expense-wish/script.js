const { createApp } = Vue;
const GAS_URL = 'https://script.google.com/macros/s/AKfycbztlKj_qRV_hkjnFgJIIZBwvbKL2Xf_KfHlhdQKTdjmBHpquq2MDOcZQImx7xvKfYKE/exec';
// 1. 取得網址上的 KEY
const urlParams = new URLSearchParams(window.location.search);
const keyFromUrl = urlParams.get('key');

// 2. 判斷邏輯：
// 如果網址有帶 key，不論內容為何都更新暫存並使用
if (urlParams.has('key')) {
    if (keyFromUrl) {
        localStorage.setItem('user_access_key', keyFromUrl);
    } else {
        // 如果是 ?key= 這種空的，視為登出
        localStorage.removeItem('user_access_key');
    }
} else {
    // 網址完全沒帶 key 參數，視為登出，強制清空暫存
    localStorage.removeItem('user_access_key');
}

// 最終使用的 KEY 來源（此時 localStorage 已根據上述邏輯同步）
const FINAL_KEY = localStorage.getItem('user_access_key') || '';

createApp({
    data() {
        return {
            isEditMode: !!FINAL_KEY, 
            userKey: FINAL_KEY,
            activeTab: 'list',
            logs: [],
            wishes: [],
            categoryData: [],
            payments: [],
            showAddModal: false,
            showWishModal: false,
            showDepositModal: false,
            showAchievementModal: false,
            showFilterPanel: false,
            chartType: '支出',
            chartInstance: null,
            toastMsg: null,
            lightboxUrl: null,
            expandedAchievement: null, // 當前展開的成就館願望ID
            
            // 表單
            form: { id: null, type: '支出', date: '', item: '', amount: null, mainCategory: '', subCategory: '', payment: '', note: '', imageData: '', imageUrl: null },
            wishForm: { wishId: null, name: '', target: null, status: '進行中', note: '', imageData: '', imageUrl: null, imgId: '', createdTime: '' },
            
            selectedWish: null,
            depositType: 'money',
            depositAmount: null,
            depositNote: '',
            filter: { start: '', end: '', mainCategory: '', keyword: '' },
            
            // 手勢與縮放
            touchStartX: 0, touchStartY: 0, touchEndX: 0, touchEndY: 0,
            zoomScale: 1, lastScale: 1, offsetX: 0, offsetY: 0, isDragging: false, touchStartDist: 0, touchStartPoint: {x:0, y:0}
        }
    },
    computed: {
        totalBalance() {
            const inc = this.logs.filter(l => l.類型 === '收入').reduce((s, i) => s + Number(i.金額), 0);
            const exp = this.logs.filter(l => l.類型 === '支出').reduce((s, i) => s + Number(i.金額), 0);
            return inc - exp;
        },
        currentTabTitle() {
            return { list:'支出明細', income:'收入明細', chart:'分析圖表', wish:'夢想願望', settings:'系統設定' }[this.activeTab];
        },
        processedLogs() {
            const type = this.activeTab === 'income' ? '收入' : '支出';
            return this.logs.filter(l => {
                if (l.類型 !== type) return false;
                const d = this.getISODate(l.日期);
                return (!this.filter.start || d >= this.filter.start) && 
                       (!this.filter.end || d <= this.filter.end) &&
                       (!this.filter.mainCategory || l.大分類 === this.filter.mainCategory) &&
                       (!this.filter.keyword || (l.品項+l.備註).includes(this.filter.keyword));
            }).reverse();
        },
        filteredCategories() { return this.categoryData.filter(c => c.type === (this.activeTab === 'income' ? '收入' : '支出')); },
        filteredCategoriesForForm() { return this.categoryData.filter(c => c.type === this.form.type); },
        chartTotal() {
            return this.logs.filter(l => {
                const d = this.getISODate(l.日期);
                return l.類型 === this.chartType && 
                       (!this.filter.start || d >= this.filter.start) && 
                       (!this.filter.end || d <= this.filter.end);
            }).reduce((acc, curr) => acc + Number(curr.金額), 0);
        },
        // 排序願望：進行中在前（依建立時間倒序），成就館在後（依達成日期倒序）
        sortedWishes() {
            return [...this.wishes].sort((a, b) => {
                if (a.狀態 === '進行中' && b.狀態 !== '進行中') return -1;
                if (a.狀態 !== '進行中' && b.狀態 === '進行中') return 1;
                
                // 同為進行中，依建立時間倒序（新的在前）
                if (a.狀態 === '進行中' && b.狀態 === '進行中') {
                    const timeA = a.建立時間 || '';
                    const timeB = b.建立時間 || '';
                    return timeB.localeCompare(timeA);
                }
                
                // 同為成就館，依達成日期倒序（新的在前）
                const dateA = a.達成日期 || '';
                const dateB = b.達成日期 || '';
                return dateB.localeCompare(dateA);
            });
        },
        // 成就館願望列表
        achievementWishes() {
            return this.wishes.filter(w => w.狀態 === '成就館').sort((a, b) => {
                const dateA = a.達成日期 || '';
                const dateB = b.達成日期 || '';
                return dateB.localeCompare(dateA); // 最新達成的在前
            });
        },
        // 成就館數量
        achievementCount() {
            return this.wishes.filter(w => w.狀態 === '成就館').length;
        },
        zoomStyle() {
            return { transform: `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.zoomScale})`, transition: this.isDragging ? 'none' : 'transform 0.1s' };
        }
    },
    watch: {
        activeTab(newTab) {
            if (newTab === 'chart') {
                this.$nextTick(() => { setTimeout(() => this.renderChart(), 200); });
            }
        },
        chartType() { this.renderChart(); },
        'filter.start'() { if(this.activeTab==='chart') this.renderChart(); },
        'filter.end'() { if(this.activeTab==='chart') this.renderChart(); }
    },
    methods: {
        async init() {
            const res = await fetch(`${GAS_URL}?action=init`);
            const data = await res.json();
            this.categoryData = data.categories.map(c => ({...c, subRaw: Array.isArray(c.subs)?c.subs.join(','):c.subs}));
            this.payments = data.payments;
            this.wishes = data.wishList.map(w => {
                const d = w.達成日期 ? new Date(w.達成日期) : null;
                return {
                    ...w,
                    達成日期: d ? `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}` : ''
                };
            });
            
            const now = new Date();
            this.filter.start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            this.filter.end = this.getISODate(now);
            await this.fetchLogs();
        },
        async fetchLogs() {
            const res = await fetch(`${GAS_URL}?action=getLogs`);
            const data = await res.json();
            this.logs = data.map(l => {
                const d = new Date(l.日期);
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const date = d.getDate();
                
                return {
                    ...l,
                    imageUrl: l.圖片ID ? `https://drive.google.com/thumbnail?id=${l.圖片ID}&sz=s800` : null,
                    displayDate: `${y}/${m}/${date}`,
                    relWishId: (l['關聯願望ID'] || l.願望ID || l.wishId || "").toString().trim()
                };
            });
        },
        getISODate(d) { const date = new Date(d); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; },
        getTabIcon(tab) { return { list:'fa-solid fa-database', income:'fa-solid fa-piggy-bank', chart:'fa-solid fa-chart-pie', wish:'fa-solid fa-star', settings:'fa-solid fa-gear' }[tab]; },
        getTabName(tab) { return { list:'支出', income:'收入', chart:'統計', wish:'許願', settings:'設定' }[tab]; },
        
        getSubCategories(main) {
            const cat = this.categoryData.find(c => c.main === main);
            if(!cat || !cat.subRaw) return [];
            return cat.subRaw.split(',').map(s=>s.trim()).filter(s=>s);
        },
        selectMainCategory(main) {
            this.form.mainCategory = main;
            this.form.subCategory = '';
        },

        // 彈窗與表單
        openAddModal() {
            if (!this.isEditMode) return;
            const lockedType = this.activeTab === 'income' ? '收入' : '支出';
            this.form = { 
                id: null, 
                type: lockedType, 
                date: this.getISODate(new Date()), 
                item:'', 
                amount:null, 
                mainCategory:'', 
                subCategory:'', 
                payment: this.payments[0] || '', 
                note:'', 
                imageData:'', 
                imageUrl: null 
            };
            const cats = this.filteredCategoriesForForm;
            if(cats.length > 0) this.selectMainCategory(cats[0].main);
            this.showAddModal = true;
        },
        editLog(log) {
            if (!this.isEditMode) return;
            const d = new Date(log.日期);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            
            this.form = { 
                id: log.ID,
                type: log.類型,
                date: dateStr, 
                item: log.品項,
                amount: log.金額,
                mainCategory: log.大分類,
                subCategory: log.小分類,
                payment: log.付款方式 || '',
                note: log.備註 || '',
                imageData: '',
                imageUrl: log.imageUrl
            };
            this.showAddModal = true;
        },
        async submitLog() {
            if(!this.form.amount || !this.form.mainCategory) return this.showToast("⚠️ 金額與分類必填");
            this.showToast("儲存中...");
            
            const payload = {
                action: this.form.id ? 'updateLog' : 'addLog',
                key: USER_KEY,
                id: this.form.id,
                date: this.form.date,
                type: this.form.type,
                mainCategory: this.form.mainCategory,
                subCategory: this.form.subCategory,
                amount: this.form.amount,
                payment: this.form.payment,
                item: this.form.item,
                note: this.form.note,
                imageData: this.form.imageData,
                deleteImage: !this.form.imageData && !this.form.imageUrl
            };
            
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
            this.showAddModal = false;
            await this.init();
            this.showToast("✅ 完成");
        },
        async deleteLog(id) {
            if(!confirm("確定刪除？無法復原")) return;
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteLog', key: USER_KEY, id }) });
            this.showAddModal = false;
            await this.init();
            this.showToast("✅ 已刪除");
        },
        
        // 圖片壓縮核心函式 (WebP)
        async compressToWebP(file, maxWidth = 800) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        if (width > maxWidth) {
                            height = (maxWidth / width) * height;
                            width = maxWidth;
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // 轉為 WebP 格式，品質設為 0.8
                        const webpBase64 = canvas.toDataURL('image/webp', 0.8);
                        resolve(webpBase64);
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        },

        // 圖片處理 - 收支明細
        async handleFileUpload(e) {
            const file = e.target.files[0];
            if(!file) return;
            this.showToast("處理圖片中...");
            try {
                const webpData = await this.compressToWebP(file);
                this.form.imageData = webpData;
                this.form.imageUrl = webpData; 
                this.showToast("圖片已壓縮");
            } catch (err) {
                this.showToast("圖片處理失敗");
            }
        },
        clearImage() { 
            this.form.imageData = ''; 
            this.form.imageUrl = null; 
            document.getElementById('modalFile').value = '';
        },

        // 許願相關
        getWishTotal(w) { return Number(w['目前金額 (錢)']) + Number(w['目前點數 (點)']); },
        getWishPercent(w) { return Math.min(100, Math.round((this.getWishTotal(w) / w.目標金額) * 100)); },
        getWishMoneyBar(w) { return (w['目前金額 (錢)'] / w.目標金額) * 100; },
        getWishPointBar(w) { return (w['目前點數 (點)'] / w.目標金額) * 100; },
        
        openWishModal() {
            if (!this.isEditMode) return;
            this.wishForm = { wishId: null, name: '', target: null, status: '進行中', note: '', imageData: '', imageUrl: null, imgId: '', createdTime: '' };
            this.showWishModal = true;
        },
        editWish(w) {
            if (!this.isEditMode) return;
            this.wishForm = { 
                wishId: w.願望ID, 
                name: w.願望名稱, 
                target: w.目標金額, 
                status: w.狀態, 
                note: w.備註, 
                imageData: '', 
                imageUrl: w.圖片ID ? `https://drive.google.com/thumbnail?id=${w.圖片ID}&sz=s500` : null,
                imgId: w.圖片ID || '',
                createdTime: w.建立時間 || ''
            };
            this.showWishModal = true;
        },
        // 圖片處理 - 許願清單
        async handleWishFileUpload(e) {
            const file = e.target.files[0];
            if(!file) return;
            this.showToast("處理圖片中...");
            try {
                const webpData = await this.compressToWebP(file);
                this.wishForm.imageData = webpData;
                this.wishForm.imageUrl = webpData;
                this.showToast("圖片已壓縮");
            } catch (err) {
                this.showToast("圖片處理失敗");
            }
        },
        clearWishImage() {
            this.wishForm.imageData = '';
            this.wishForm.imageUrl = null;
            this.wishForm.imgId = '';
            document.getElementById('wishFile').value = '';
        },
        async submitWish() {
            if(!this.wishForm.name || !this.wishForm.target) return this.showToast("⚠️ 名稱與金額必填");
            this.showToast("儲存中...");
            
            const payload = {
                action: 'saveWish',
                key: USER_KEY,
                wishId: this.wishForm.wishId,
                name: this.wishForm.name,
                target: this.wishForm.target,
                status: this.wishForm.status,
                note: this.wishForm.note,
                imageData: this.wishForm.imageData,
                imgId: this.wishForm.imgId,
                createdTime: this.wishForm.createdTime, 
                currentMoney: this.wishForm.wishId ? this.wishes.find(w => w.願望ID === this.wishForm.wishId)?.['目前金額 (錢)'] : 0,
                currentPoints: this.wishForm.wishId ? this.wishes.find(w => w.願望ID === this.wishForm.wishId)?.['目前點數 (點)'] : 0
            };
            
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
            this.showWishModal = false;
            await this.init();
            this.showToast("✅ 願望已儲存");
        },
        async deleteWish(id) {
            if(!confirm("確定刪除此願望？刪除後無法復原")) return;
            this.showToast("刪除中...");
            
            await fetch(GAS_URL, { 
                method: 'POST', 
                body: JSON.stringify({ 
                    action: 'deleteWish',
                    key: USER_KEY, 
                    wishId: id 
                }) 
            });
            
            this.showWishModal = false;
            await this.init();
            this.showToast("✅ 願望已刪除");
        },
        async completeWish(wish) {
            if(!confirm("太棒了！確定要完成這個願望嗎？")) return;
            const now = new Date();
            const achievedDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
            
            this.showToast("慶祝中...");
            await fetch(GAS_URL, { 
                method: 'POST', 
                body: JSON.stringify({ 
                    action: 'saveWish', 
                    key: USER_KEY, 
                    wishId: wish.願望ID, 
                    name: wish.願望名稱, 
                    target: wish.目標金額, 
                    currentMoney: wish['目前金額 (錢)'],
                    currentPoints: wish['目前點數 (點)'],
                    status: '成就館',  
                    note: wish.備註,
                    achievedDate: achievedDate,
                    imgId: wish.圖片ID,
                    createdTime: wish.建立時間 || ''
                }) 
            });
            await this.init();
            this.showToast("🎉 恭喜達成！");
        },

        openDepositModal(wish, type) {
            if (!this.isEditMode) return;
            this.selectedWish = wish;
            this.depositType = type;
            this.depositAmount = null;
            this.depositNote = '';
            this.showDepositModal = true;
        },
        async submitDeposit() {
            if(!this.depositAmount) return alert("請輸入數值");
            const logData = {
                date: this.getISODate(new Date()),
                type: this.depositType === 'money' ? '支出' : '點數獎勵',
                mainCategory: this.depositType === 'money' ? '許願儲蓄' : '行為表現',
                subCategory: this.selectedWish.願望名稱,
                amount: this.depositAmount,
                item: (this.depositType === 'money' ? '存錢：' : '獎勵：') + this.selectedWish.願望名稱,
                payment: '夢想銀行',
                wishId: this.selectedWish.願望ID,
                note: this.depositNote
            };
            this.showToast("處理中...");
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'addLog', key: USER_KEY, ...logData }) });
            this.showDepositModal = false;
            await this.init();
            this.showToast("✅ 存入成功");
        },

        // 成就館相關
        toggleAchievementDetail(wishId) {
            this.expandedAchievement = this.expandedAchievement === wishId ? null : wishId;
        },
        getWishLogs(wishId) {
            if (!wishId) return [];
            const searchId = wishId.toString().trim();
            
            return this.logs.filter(l => {
                const logWishId = (l.relWishId || "").toString().trim();
                return logWishId === searchId;
            }).reverse();
        },

        // 設定與分類
        async saveSettings() {
            this.showToast("儲存設定...");
            const cats = this.categoryData.map(c => ({...c, subs: c.subRaw.split(',').map(s=>s.trim()).filter(s=>s)}));
            await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateSettings', key: USER_KEY, categories: cats, payments: this.payments }) });
            await this.init();
            this.showToast("✅ 設定已更新");
        },
        moveItem(arr, idx, step) {
            const target = idx + step;
            if(target >= 0 && target < arr.length) {
                const temp = arr[idx]; arr[idx] = arr[target]; arr[target] = temp;
            }
        },

        // 統計圖表
        renderChart() {
            const ctx = document.getElementById('myChart');
            if(!ctx) return;
            if(this.chartInstance) this.chartInstance.destroy();
            
            const targetData = this.logs.filter(l => {
                const d = this.getISODate(l.日期);
                return l.類型 === this.chartType && 
                       (!this.filter.start || d >= this.filter.start) && 
                       (!this.filter.end || d <= this.filter.end);
            });

            const stats = {};
            targetData.forEach(l => {
                const m = l.大分類 || '未分類';
                stats[m] = (stats[m] || 0) + Number(l.金額);
            });

            const labels = Object.keys(stats);
            const data = Object.values(stats);

            if(labels.length === 0) { ctx.style.display = 'none'; return; }
            ctx.style.display = 'block';

            this.chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: ['#bae3f9', '#ffb7b2', '#ffffd1', '#d1eefc', '#e2d1fc', '#ffdac1'],
                        borderWidth: 2,
                        borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
                    }
                }
            });
        },

        // 手勢切換
        handleSwipe() {
            const diffX = this.touchStartX - this.touchEndX;
            const diffY = this.touchStartY - this.touchEndY;
            if (Math.abs(diffX) > 80 && Math.abs(diffY) < 50) {
                const tabs = ['list', 'income', 'chart', 'wish', 'settings'];
                let idx = tabs.indexOf(this.activeTab);
                if (diffX > 0 && idx < tabs.length - 1) this.activeTab = tabs[idx+1];
                else if (diffX < 0 && idx > 0) this.activeTab = tabs[idx-1];
            }
        },
        showToast(msg) { this.toastMsg = msg; setTimeout(() => this.toastMsg = null, 2000); },

        // 燈箱
        openLightbox(url) { 
            if (!url) return;
            this.lightboxUrl = url; 
            this.zoomScale = 1; 
            this.offsetX = 0; 
            this.offsetY = 0; 
        },
        handleTouchStartImg(e) {
            if(e.touches.length === 2) {
                this.touchStartDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                this.lastScale = this.zoomScale;
            } else {
                this.isDragging = true;
                this.touchStartPoint = { x: e.touches[0].pageX - this.offsetX, y: e.touches[0].pageY - this.offsetY };
            }
        },
        handleTouchMoveImg(e) {
            if(e.touches.length === 2) {
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                this.zoomScale = Math.min(Math.max(this.lastScale * (dist / this.touchStartDist), 1), 4);
            } else if(this.isDragging) {
                this.offsetX = e.touches[0].pageX - this.touchStartPoint.x;
                this.offsetY = e.touches[0].pageY - this.touchStartPoint.y;
            }
        },
        handleTouchEndImg() { this.isDragging = false; if(this.zoomScale < 1) this.zoomScale = 1; }
    },
    mounted() {
        this.init();
        window.addEventListener('touchstart', e => { this.touchStartX = e.touches[0].clientX; this.touchStartY = e.touches[0].clientY; }, {passive:true});
        window.addEventListener('touchend', e => { this.touchEndX = e.changedTouches[0].clientX; this.touchEndY = e.changedTouches[0].clientY; this.handleSwipe(); }, {passive:true});
    }
}).mount('#app');
