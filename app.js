// ==========================================
// 1. 畫布初始化與效能最佳化
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// ==========================================
// 2. Supabase 雲端後端初始化
// ==========================================
// ⚠️ 必須替換為您的專案金鑰 (請保留單引號)
const SUPABASE_URL = 'https://ovsewspmytfanacoirrp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92c2V3c3BteXRmYW5hY29pcnJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDg1NjYsImV4cCI6MjA5NDc4NDU2Nn0.l9-njgTjOslN3GKZxLQuwj1-EzdhdbNtgNdatyDJs3o';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null; 

// ==========================================
// 2. 視覺資產載入器 (Asset Manager)
// ==========================================
const assets = {};
let loadedCount = 0;
// 定義需要載入的圖片 (確保檔名與您 assets 資料夾中的一致)
const requiredImages = [
    { name: 'player', src: 'assets/player.png' },
    { name: 'worker', src: 'assets/worker.png' }
];

function preloadAssets(callback) {
    if (requiredImages.length === 0) return callback();
    
    requiredImages.forEach(item => {
        const img = new Image();
        img.onload = () => {
            assets[item.name] = img;
            loadedCount++;
            if (loadedCount === requiredImages.length) {
                console.log("🎨 所有視覺圖片載入完成！");
                callback();
            }
        };
        img.onerror = () => console.error(`❌ 圖片載入失敗: ${item.src}，請檢查路徑與檔名。`);
        img.src = item.src;
    });
}

// ==========================================
// 3. 遊戲狀態與數學模型
// ==========================================
let gameState = { score: 0, workers: 0, lastSyncTime: Date.now() };
const GAME_CONFIG = { baseWorkerCost: 50, costMultiplier: 1.15, productionPerWorker: 10, clickPower: 1 };

function getNextWorkerCost() { return Math.floor(GAME_CONFIG.baseWorkerCost * Math.pow(GAME_CONFIG.costMultiplier, gameState.workers)); }
function getTotalProductionRate() { return gameState.workers * GAME_CONFIG.productionPerWorker; }

// ==========================================
// 4. 多人連線狀態管理
// ==========================================
const otherPlayers = {}; 
let localPlayer = { x: window.innerWidth/2, y: window.innerHeight/2, targetX: window.innerWidth/2, targetY: window.innerHeight/2 };
const gameChannel = supabaseClient.channel('public_site_01');

let lastBroadcastTime = 0;
function broadcastUpdate() {
    if (!currentUser) return;
    const now = Date.now();
    if (now - lastBroadcastTime > 1000) {
        gameChannel.send({
            type: 'broadcast', event: 'player_action',
            payload: { uid: currentUser.id, targetX: localPlayer.targetX, targetY: localPlayer.targetY, workers: gameState.workers }
        });
        lastBroadcastTime = now;
    }
}

gameChannel
    .on('broadcast', { event: 'player_action' }, (payload) => {
        const data = payload.payload;
        if (currentUser && data.uid === currentUser.id) return;

        if (!otherPlayers[data.uid]) {
            otherPlayers[data.uid] = { x: data.targetX, y: data.targetY, targetX: data.targetX, targetY: data.targetY, workers: data.workers };
        } else {
            otherPlayers[data.uid].targetX = data.targetX;
            otherPlayers[data.uid].targetY = data.targetY;
            otherPlayers[data.uid].workers = data.workers;
        }
    })
    .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log("🌐 成功加入多人即時連線頻道！");
            // 【修復冷啟動 Bug】：成功加入頻道後，立刻強制發送一次廣播，讓大家知道我來了
            setTimeout(broadcastUpdate, 500); 
        }
    });

// ==========================================
// 5. 雲端身分驗證與進度同步
// ==========================================
async function initCloudAuth() {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) return console.error("❌ 登入失敗:", error);
    
    currentUser = data.user;
    console.log("✅ 雲端連線成功！玩家 UUID:", currentUser.id);

    const { data: dbState } = await supabaseClient.from('game_state').select('*').eq('user_id', currentUser.id).single();

    if (dbState) {
        gameState.score = Number(dbState.total_score);
        gameState.workers = Number(dbState.workers_count);
        gameState.lastSyncTime = new Date(dbState.last_sync_time).getTime();
        const timeDiffSeconds = (Date.now() - gameState.lastSyncTime) / 1000;
        if (timeDiffSeconds > 0 && gameState.workers > 0) gameState.score += timeDiffSeconds * getTotalProductionRate();
    } else {
        await supabaseClient.from('game_state').insert([{ user_id: currentUser.id, total_score: 0, workers_count: 0 }]);
    }
    
    // 雲端驗證完成後，啟動渲染迴圈
    requestAnimationFrame(gameLoop);
}

setInterval(async () => {
    if (!currentUser) return;
    await supabaseClient.from('game_state').update({ total_score: Math.floor(gameState.score), workers_count: gameState.workers }).eq('user_id', currentUser.id);
}, 10000);

// ==========================================
// 6. 互動與數學插值
// ==========================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

canvas.addEventListener('mousedown', (e) => {
    gameState.score += GAME_CONFIG.clickPower;
    localPlayer.targetX = e.clientX;
    localPlayer.targetY = e.clientY;
    broadcastUpdate(); 
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        const cost = getNextWorkerCost();
        if (gameState.score >= cost) {
            gameState.score -= cost;
            gameState.workers += 1;
            broadcastUpdate();
        }
    }
});

function lerp(start, end, factor) { return start + (end - start) * factor; }

// ==========================================
// 7. 主渲染迴圈 (替換為圖片渲染)
// ==========================================
let lastFrameTime = performance.now();

function gameLoop(currentTime) {
    const deltaTime = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;

    if (gameState.workers > 0) gameState.score += getTotalProductionRate() * deltaTime;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 圖片繪製尺寸 (寬 50, 高 50)
    const imgSize = 50; 
    const halfSize = imgSize / 2;

    // 1. 運算並繪製其他玩家 (使用 worker.png)
    for (const uid in otherPlayers) {
        const p = otherPlayers[uid];
        p.x = lerp(p.x, p.targetX, deltaTime * 5);
        p.y = lerp(p.y, p.targetY, deltaTime * 5);

        if (assets['worker']) {
            ctx.drawImage(assets['worker'], p.x - halfSize, p.y - halfSize, imgSize, imgSize);
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.fillText(`勞工: ${p.workers}`, p.x - 20, p.y - halfSize - 10);
    }

    // 2. 運算並繪製自己 (使用 player.png)
    localPlayer.x = lerp(localPlayer.x, localPlayer.targetX, deltaTime * 5);
    localPlayer.y = lerp(localPlayer.y, localPlayer.targetY, deltaTime * 5);
    
    if (assets['player']) {
        ctx.drawImage(assets['player'], localPlayer.x - halfSize, localPlayer.y - halfSize, imgSize, imgSize);
    }
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`我 (勞工:${gameState.workers})`, localPlayer.x - 30, localPlayer.y - halfSize - 10);

    // --- UI ---
    ctx.textAlign = 'left';
    ctx.font = '24px Arial';
    ctx.fillText(`總資產 (貨幣): ${Math.floor(gameState.score)}`, 20, 40);
    ctx.fillText(`勞工數量: ${gameState.workers}`, 20, 80);
    ctx.fillText(`每秒產能: +${getTotalProductionRate()}`, 20, 120);
    
    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`[點擊畫面任一處] 移動並手動施工 (+${GAME_CONFIG.clickPower})`, 20, canvas.height - 60);
    ctx.fillText(`[按空白鍵] 招募數位勞工 (成本: ${getNextWorkerCost()})`, 20, canvas.height - 30);

    requestAnimationFrame(gameLoop);
}

// ==========================================
// 8. 啟動引擎 (保證圖片載入完畢後才連線)
// ==========================================
preloadAssets(() => {
    initCloudAuth();
});