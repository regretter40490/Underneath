// --- 状態管理 ---
let puzzleSets = [];
let currentSetId = null;
let currentPuzzleIndex = -1;

const STORAGE_KEY = 'underneath_cleared_puzzles';

async function saveCurrentPenpaProgress() {
    const iframe = document.getElementById('penpa-frame');
    if (!iframe || !iframe.contentWindow) return;
    
    const win = iframe.contentWindow;

    // window.PenpaProgress が存在することを確認
    if (win.PenpaProgress && win.pu) {
        try {
            // UserSettings が存在する場合は念のためフラグを true に設定
            if (win.UserSettings) {
                win.UserSettings.save_current_puzzle = true;
            }
            
            // 非同期保存の完了をしっかり待機
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
    }
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

    puzzleSets.forEach(set => {
        const isCleared = isSetCleared(set);
        const card = document.createElement('div');
        card.className = `set-card ${isCleared ? 'cleared' : ''}`;
        
        // 修正箇所: クリア済みならタイトルの前に「★ 」を付与
        const displayTitle = isCleared ? `★ ${set.setTitle}` : set.setTitle;

        card.innerHTML = `
            <img src="${set.icon}" alt="">
            <h3>${displayTitle}</h3>
            <p>${set.descriptionShort}</p>
        `;
        card.onclick = () => showViewSet(set.setId);
        container.appendChild(card);
    });
}

async function showViewSet(setId) {
    // 画面切り替え前に現在の問題の解答過程を保存
    await saveCurrentPenpaProgress();
    currentSetId = setId;
    renderSetView(setId);
    showView('set');
}

// ホームに戻る処理
async function backToHomeView() {
    await saveCurrentPenpaProgress();
    showView('home');
}

// セット画面に戻る処理
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
    
    // クリア状況に応じて表示テキストとクラスを更新
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

        // idcolorの指定がある場合に文字色を反映
        if (puzzle.idcolor) {
            btn.style.color = puzzle.idcolor;
        }

        btn.onclick = () => loadPuzzle(setId, index);
        listContainer.appendChild(btn);
    });
}

// 問題の読み込み (async化)
async function loadPuzzle(setId, index) {
    // 1. 現在開いている問題があれば、まず解答過程を待機保存
    await saveCurrentPenpaProgress();

    const set = puzzleSets.find(s => s.setId === setId);
    const puzzle = set.puzzles[index];

    if (!isPuzzleUnlocked(setId, puzzle)) return;

    currentSetId = setId;
    currentPuzzleIndex = index;

    document.getElementById('puzzle-title').innerText = `${set.setTitle} - ${puzzle.id}`;
    
    // 公式Penpa-editorへの外部リンク設定
    const externalBtn = document.getElementById('btn-external-penpa');
    if (externalBtn && puzzle.penpaUrl) {
        const officialUrl = puzzle.penpaUrl.replace(/^\.\/penpa-edit\//, 'https://swaroopg92.github.io/penpa-edit/');
        externalBtn.href = officialUrl;
    }

    // 2. iframeを一旦リセットして新しい問題を読み込む
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

// 進捗およびPenpa側の解答途中経過を完全にリセット
async function resetProgress() {
    if (confirm('クリア進捗および入力中の解答状態をすべて初期化しますか？')) {
        // 1. localStorage と sessionStorage のクリア
        localStorage.clear();
        sessionStorage.clear();
        
        // 2. iframe内の PenpaProgress クリア処理の呼出
        const iframe = document.getElementById('penpa-frame');
        if (iframe && iframe.contentWindow && iframe.contentWindow.PenpaProgress) {
            try {
                await iframe.contentWindow.PenpaProgress.clearAllPuzzles();
            } catch (e) {
                console.warn('PenpaProgressのクリアに失敗しました:', e);
            }
        }

        // 3. IndexedDB データベース (localforage) の消去
        if (window.indexedDB) {
            try {
                window.indexedDB.deleteDatabase('localforage');
            } catch (e) {
                console.warn('IndexedDBの物理削除に失敗しました:', e);
            }
        }

        // 4. iframeのリセット
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