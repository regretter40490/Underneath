// --- 状態管理 ---
let puzzleSets = [];
let achievements = [];
let currentSetId = null;
let currentPuzzleIndex = -1;

const STORAGE_KEY = 'underneath_cleared_puzzles';
const ACHIEVEMENT_STORAGE_KEY = 'underneath_unlocked_achievements';

async function saveCurrentPenpaProgress() {
    const iframe = document.getElementById('penpa-frame');
    if (!iframe || !iframe.contentWindow) return;
    
    const win = iframe.contentWindow;

    if (win.PenpaProgress && win.pu) {
        try {
            if (win.UserSettings) {
                win.UserSettings.save_current_puzzle = true;
            }
            await win.PenpaProgress.save();
        } catch (e) {
            console.warn('PenpaProgressの保存中にエラーが発生しました:', e);
        }
    }
}

// --- データ読み込み処理 ---
async function loadAllPuzzleSets() {
    try {
        const manifestResponse = await fetch('data/manifest.json');
        if (!manifestResponse.ok) {
            throw new Error('manifest.json の読み込みに失敗しました');
        }
        const setFiles = await manifestResponse.json();

        const fetchPromises = setFiles.map(filePath => 
            fetch(filePath).then(res => {
                if (!res.ok) throw new Error(`${filePath} の読み込みに失敗しました`);
                return res.json();
            })
        );

        puzzleSets = await Promise.all(fetchPromises);

        // アチーブメントデータの読み込み
        try {
            const achRes = await fetch('data/achievements.json');
            if (achRes.ok) {
                achievements = await achRes.json();
            }
        } catch (e) {
            console.warn('achievements.json の読み込みに失敗または存在しません');
        }

        showView('home');
    } catch (error) {
        console.error('データロードエラー:', error);
        alert('パズルデータの読み込みに失敗しました。');
    }
}

// クリア状況を取得
function getClearedPuzzles() {
    const data = localStorage.getItem(STORAGE_KEY);
    return new Set(data ? JSON.parse(data) : []);
}

// 獲得済み実績を取得
function getUnlockedAchievements() {
    const data = localStorage.getItem(ACHIEVEMENT_STORAGE_KEY);
    return new Set(data ? JSON.parse(data) : []);
}

// クリア状態の保存
function markAsCleared(setId, puzzleId) {
    const cleared = getClearedPuzzles();
    const key = `${setId}_${puzzleId}`;
    if (!cleared.has(key)) {
        cleared.add(key);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(cleared)));
        
        if (currentSetId === setId) {
            renderSetView(setId);
        }

        // 実績チェックの呼び出し
        checkAchievements();
    }
}

// 実績条件チェック＆付与処理
function checkAchievements() {
    if (!achievements || achievements.length === 0) return;

    const clearedPuzzles = getClearedPuzzles();
    const unlocked = getUnlockedAchievements();
    let newlyUnlocked = [];

    achievements.forEach(ach => {
        if (unlocked.has(String(ach.id))) return;

        let isAchieved = false;

        if (ach.type === 'total_count') {
            // 全体での正解数
            if (clearedPuzzles.size >= ach.count) {
                isAchieved = true;
            }
        } else if (ach.type === 'set_all') {
            // 特定セットの全クリア
            const set = puzzleSets.find(s => s.setId === ach.setId);
            if (set && isSetCleared(set)) {
                isAchieved = true;
            }
        } else if (ach.type === 'set_count') {
            // 特定セット内の指定正解数
            const set = puzzleSets.find(s => s.setId === ach.setId);
            if (set) {
                const count = set.puzzles.filter(p => clearedPuzzles.has(`${set.setId}_${p.id}`)).length;
                if (count >= ach.count) {
                    isAchieved = true;
                }
            }
        } else if (ach.type === 'set_puzzles') {
            // 特定セット内の指定パズルID群をすべて正解
            if (ach.setId && Array.isArray(ach.puzzleIds)) {
                const allCleared = ach.puzzleIds.every(pId => clearedPuzzles.has(`${ach.setId}_${pId}`));
                if (allCleared) {
                    isAchieved = true;
                }
            }
        }

        if (isAchieved) {
            unlocked.add(String(ach.id));
            newlyUnlocked.push(ach);
        }
    });

    if (newlyUnlocked.length > 0) {
        localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(Array.from(unlocked)));
        newlyUnlocked.forEach(ach => showAchievementToast(ach));
    }
}

// 実績獲得通知バナー表示
function showAchievementToast(ach) {
    const container = document.getElementById('achievement-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
        <div class="toast-header">実績を獲得しました！</div>
        <div class="toast-title">${ach.title}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 5000);
}

// モーダル表示制御（idの数値順にソートして表示）
function openAchievementsModal() {
    const unlocked = getUnlockedAchievements();
    const listContainer = document.getElementById('achievement-list');
    listContainer.innerHTML = '';

    // 獲得済み実績のみ抽出し、idの番号順（昇順）にソート
    const unlockedList = achievements
        .filter(ach => unlocked.has(String(ach.id)))
        .sort((a, b) => Number(a.id) - Number(b.id));

    if (unlockedList.length === 0) {
        listContainer.innerHTML = '<div class="empty-achievements">獲得済みの実績はありません。</div>';
    } else {
        unlockedList.forEach(ach => {
            const card = document.createElement('div');
            card.className = 'achievement-card';
            
            // ach.color が指定されている場合、CSS変数 --ach-color に色をセット
            if (ach.color) {
                card.style.setProperty('--ach-color', ach.color);
            }

            card.innerHTML = `
                <div class="achievement-card-title">★ ${ach.title}</div>
                <div class="achievement-card-desc">${ach.description}</div>
            `;
            listContainer.appendChild(card);
        });
    }

    document.getElementById('modal-achievements').classList.remove('hidden');
}

function closeAchievementsModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modal-achievements').classList.add('hidden');
}

// 解放判定ロジック
function isPuzzleUnlocked(setId, puzzle) {
    if (!puzzle.prereqs || puzzle.prereqs.length === 0) return true;
    const cleared = getClearedPuzzles();
    return puzzle.prereqs.every(prereqId => cleared.has(`${setId}_${prereqId}`));
}

// セット全体のクリア判定
function isSetCleared(set) {
    const cleared = getClearedPuzzles();
    return set.puzzles.every(p => cleared.has(`${set.setId}_${p.id}`));
}

// --- 画面切り替え ---
function showView(viewName) {
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewName}`).classList.remove('hidden');

    if (viewName === 'home') renderHomeView();
}

function renderHomeView() {
    const container = document.getElementById('set-list');
    container.innerHTML = '';
    const clearedPuzzles = getClearedPuzzles();

    puzzleSets.forEach(set => {
        const isCleared = isSetCleared(set);
        const totalCount = set.puzzles ? set.puzzles.length : 0;
        const clearedCount = set.puzzles ? set.puzzles.filter(p => clearedPuzzles.has(`${set.setId}_${p.id}`)).length : 0;
        const percent = totalCount > 0 ? (clearedCount / totalCount) * 100 : 0;

        const card = document.createElement('div');
        card.className = `set-card ${isCleared ? 'cleared' : ''}`;
        
        const displayTitle = isCleared ? `★ ${set.setTitle}` : set.setTitle;

        card.innerHTML = `
            <img src="${set.icon}" alt="">
            <h3>${displayTitle}</h3>
            <p>${set.descriptionShort}</p>
            <div class="progress-container">
                <span class="progress-text">${clearedCount}/${totalCount}</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
        card.onclick = () => showViewSet(set.setId);
        container.appendChild(card);
    });
}

async function showViewSet(setId) {
    await saveCurrentPenpaProgress();
    currentSetId = setId;
    renderSetView(setId);
    showView('set');
}

async function backToHomeView() {
    await saveCurrentPenpaProgress();
    showView('home');
}

async function backToSetView() {
    await saveCurrentPenpaProgress();
    if (currentSetId) {
        showViewSet(currentSetId);
    } else {
        showView('home');
    }
}

function renderSetView(setId) {
    const set = puzzleSets.find(s => s.setId === setId);
    if (!set) return;

    const isCleared = isSetCleared(set);
    const descElement = document.getElementById('set-description');

    document.getElementById('set-title').innerText = set.setTitle;
    
    if (isCleared) {
        descElement.textContent = set.descriptionFullCleared || set.descriptionFull;
        descElement.classList.add('cleared');
    } else {
        descElement.textContent = set.descriptionFull;
        descElement.classList.remove('cleared');
    }

    document.getElementById('set-icon').src = set.icon;
    document.getElementById('link-pdf-download').href = set.pdfUrl;

    const listContainer = document.getElementById('puzzle-list');
    listContainer.innerHTML = '';

    set.puzzles.forEach((puzzle, index) => {
        const cleared = getClearedPuzzles();
        const isClearedPuzzle = cleared.has(`${setId}_${puzzle.id}`);
        const isUnlocked = isPuzzleUnlocked(setId, puzzle);

        const btn = document.createElement('button');
        btn.innerText = `${puzzle.id} ${isClearedPuzzle ? '✓' : ''}`;
        btn.className = `puzzle-btn ${isClearedPuzzle ? 'cleared' : ''}`;
        btn.disabled = !isUnlocked;

        if (puzzle.idcolor) {
            btn.style.color = puzzle.idcolor;
        }

        btn.onclick = () => loadPuzzle(setId, index);
        listContainer.appendChild(btn);
    });
}

async function loadPuzzle(setId, index) {
    await saveCurrentPenpaProgress();

    const set = puzzleSets.find(s => s.setId === setId);
    const puzzle = set.puzzles[index];

    if (!isPuzzleUnlocked(setId, puzzle)) return;

    currentSetId = setId;
    currentPuzzleIndex = index;

    document.getElementById('puzzle-title').innerText = `${set.setTitle} - ${puzzle.id}`;
    
    const externalBtn = document.getElementById('btn-external-penpa');
    if (externalBtn && puzzle.penpaUrl) {
        const officialUrl = puzzle.penpaUrl.replace(/^\.\/penpa-edit\//, 'https://swaroopg92.github.io/penpa-edit/');
        externalBtn.href = officialUrl;
    }

    const iframe = document.getElementById('penpa-frame');
    iframe.src = 'about:blank';
    setTimeout(() => {
        iframe.src = puzzle.penpaUrl;
    }, 10);

    updateNavButtons(set);
    showView('puzzle');
}

function updateNavButtons(set) {
    const prevBtn = document.getElementById('btn-prev-puzzle');
    const nextBtn = document.getElementById('btn-next-puzzle');

    const prevPuzzle = set.puzzles[currentPuzzleIndex - 1];
    const nextPuzzle = set.puzzles[currentPuzzleIndex + 1];

    prevBtn.disabled = !prevPuzzle || !isPuzzleUnlocked(set.setId, prevPuzzle);
    nextBtn.disabled = !nextPuzzle || !isPuzzleUnlocked(set.setId, nextPuzzle);
}

async function navigatePuzzle(direction) {
    const set = puzzleSets.find(s => s.setId === currentSetId);
    const newIndex = currentPuzzleIndex + direction;
    if (newIndex >= 0 && newIndex < set.puzzles.length) {
        await loadPuzzle(currentSetId, newIndex);
    }
}

async function playSequence() {
    const set = puzzleSets.find(s => s.setId === currentSetId);
    const cleared = getClearedPuzzles();
    let targetIndex = set.puzzles.findIndex(p => !cleared.has(`${set.setId}_${p.id}`) && isPuzzleUnlocked(set.setId, p));
    if (targetIndex === -1) targetIndex = 0;
    await loadPuzzle(currentSetId, targetIndex);
}

// --- iframe（Penpa-editor）からの正解メッセージ受信 ---
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'UNDERNEATH_PUZZLE_CLEARED') {
        if (currentSetId && currentPuzzleIndex !== -1) {
            const set = puzzleSets.find(s => s.setId === currentSetId);
            const puzzle = set.puzzles[currentPuzzleIndex];
            markAsCleared(currentSetId, puzzle.id);
            updateNavButtons(set);
        }
    }
});

// 進捗およびPenpa側の解答途中経過を完全にリセット（獲得済み実績は保護される）
async function resetProgress() {
    if (confirm('クリア進捗および入力中の解答状態をすべて初期化しますか？\n※獲得した実績は削除されません。')) {
        // 実績情報は退避保護
        const savedAchievements = localStorage.getItem(ACHIEVEMENT_STORAGE_KEY);

        localStorage.clear();
        sessionStorage.clear();
        
        // 実績情報を再保存
        if (savedAchievements) {
            localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, savedAchievements);
        }

        const iframe = document.getElementById('penpa-frame');
        if (iframe && iframe.contentWindow && iframe.contentWindow.PenpaProgress) {
            try {
                await iframe.contentWindow.PenpaProgress.clearAllPuzzles();
            } catch (e) {
                console.warn('PenpaProgressのクリアに失敗しました:', e);
            }
        }

        if (window.indexedDB) {
            try {
                window.indexedDB.deleteDatabase('localforage');
            } catch (e) {
                console.warn('IndexedDBの物理削除に失敗しました:', e);
            }
        }

        if (iframe) {
            iframe.src = 'about:blank';
        }

        showView('home');
    }
}

// 初期化
window.onload = () => {
    loadAllPuzzleSets();
};