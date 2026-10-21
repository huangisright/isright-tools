/*************************************************************
 * 數位密室逃脫平台 — 前端
 * v2 / 2026-09
 *
 * 前端不再持有任何答案、時間或進度的裁判權：
 * 密碼比對、15 分鐘倒數、逾時判定全部在後端。
 * 這支檔案只負責「問後端、把結果畫出來」。
 *************************************************************/

// 部署後若 Web App 網址換了，只需要改這一行（建議用「管理部署作業→編輯→新版本」避免網址變動）
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwu3to7eyY3AzHoA1Qx_zuRDEUMdHzWMfqaxk6Uk3N501H35YMjwLIfW72mNs6pE39l/exec";

const STORAGE_KEY = 'escape_room_token_v2';
const RESYNC_MS = 45000;      // 每 45 秒跟後端校正一次時間與狀態
const SCREENS = ['entry', 'ready', 'game', 'timeout', 'finish'];

const S = {
  token: null,
  status: '',
  levelId: null,
  limitMs: 0,
  deadlineAt: 0,
  hintCount: 0,
  screen: '',
  busy: false,
  cooling: false,
  timedOut: false,
  tickId: null,
  syncId: null,
  lastFocus: null
};

const el = function (id) { return document.getElementById(id); };
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// ==================== 與後端通訊 ====================

async function api(params, tries) {
  tries = tries || 3;
  const clean = {};
  Object.keys(params).forEach(function (k) {
    if (params[k] !== undefined && params[k] !== null) clean[k] = params[k];
  });
  const url = GAS_API_URL + '?' + new URLSearchParams(clean).toString();

  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await sleep(700 * (i + 1));
    }
  }
  throw lastErr || new Error('unknown');
}

// ==================== 畫面切換與訊息 ====================

function showScreen(name) {
  S.screen = name;
  SCREENS.forEach(function (n) {
    el('screen-' + n).classList.toggle('hidden', n !== name);
  });
}

function feedback(text, type, extraNode) {
  const f = el('feedback');
  f.className = 'feedback-message ' + (type || '');
  f.textContent = text || '';
  if (extraNode) f.appendChild(extraNode);
  f.classList.remove('hidden');
}

function clearFeedback() {
  const f = el('feedback');
  f.textContent = '';
  f.classList.add('hidden');
}

function loading(on, text) {
  el('loading-text').textContent = text || '與黃金城終端機連線中…';
  el('loading').classList.toggle('hidden', !on);
}

function saveToken(t) {
  S.token = t;
  try { localStorage.setItem(STORAGE_KEY, t); } catch (e) { /* 無痕模式等情況，忽略 */ }
}
function loadToken() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}
function dropToken() {
  S.token = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
}

// ==================== 狀態套用 ====================

function applyState(d) {
  S.status = d.status || '';
  S.hintCount = Number(d.hintCount || 0);

  // 頁首資訊
  if (d.teamName) {
    el('team-label').textContent = d.teamName + '（' + d.teamCode + '）';
    el('team-label').classList.remove('hidden');
  }
  if (d.levelTotal) {
    el('level-label').textContent = '第 ' + d.levelIndex + ' / ' + d.levelTotal + ' 關';
    el('level-label').classList.remove('hidden');
  }

  if (d.warning) feedback(d.warning, 'error');

  if (S.status === '全部完成') {
    stopTimer();
    renderFinish(d);
    showScreen('finish');
    return;
  }

  if (S.status === '逾時' || S.status === '結束') {
    stopTimer();
    el('timeout-level').textContent = d.levelIndex || '-';
    el('skip-btn').classList.toggle('hidden', !d.canContinue);
    el('skip-btn').textContent = d.hasNext ? '前往下一關' : '結束並看結果';
    el('timeout-note').textContent = d.canContinue
      ? (d.hasNext ? '本關記為逾時失敗，但你們還可以繼續挑戰後面的關卡。'
                   : '這是最後一關，按下按鈕看你們的總結果。')
      : '本場遊戲到此結束，請等老師宣布。';
    showScreen('timeout');
    return;
  }

  if (S.status === '待開始') {
    stopTimer();
    S.timedOut = false;
    S.levelId = d.level ? String(d.level.id) : null;
    el('ready-index').textContent = d.levelIndex || '-';
    el('ready-limit').textContent = Math.round((d.limitMs || 0) / 60000);
    showScreen('ready');
    return;
  }

  // 進行中
  const sameLevel = (S.screen === 'game' && d.level && S.levelId === String(d.level.id));
  S.levelId = d.level ? String(d.level.id) : null;
  S.timedOut = false;
  if (!sameLevel) renderLevel(d);       // 同一關就不重畫，避免清掉學生正在打的字
  updateHintBadge();
  startTimer(d.remainingMs, d.limitMs);
  showScreen('game');
}

function renderLevel(d) {
  const lv = d.level || {};

  el('story-text').textContent = lv.story || '';   // 用 textContent，老師打 < 或 & 都不會被吃掉

  const img = el('clue-image');
  const url = String(lv.imageUrl || '').trim();
  if (url) {
    img.onerror = function () { img.hidden = true; feedback('線索圖片載入失敗，請告訴老師。', 'error'); };
    img.src = url;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }

  const author = el('author-line');
  if (lv.author) {
    author.textContent = '出題：' + lv.author;
    author.classList.remove('hidden');
  } else {
    author.classList.add('hidden');
  }

  el('hint-btn').disabled = !lv.hasHint;
  el('hint-btn').title = lv.hasHint ? '' : '這一關沒有提示';

  const input = el('answer-input');
  input.disabled = false;
  input.value = '';
  el('submit-btn').disabled = false;
  el('submit-btn').textContent = '驗證';
  setTimeout(function () { input.focus(); }, 50);
}

function renderFinish(d) {
  const box = el('finish-stats');
  box.textContent = '';
  const items = [
    ['總提示次數', d.hintCount || 0],
    ['總錯誤次數', d.wrongCount || 0],
    ['逾時題數', d.timeoutCount || 0]
  ];
  items.forEach(function (it) {
    const cell = document.createElement('div');
    cell.className = 'stat';
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = String(it[1]);
    const k = document.createElement('span');
    k.className = 'stat-key';
    k.textContent = it[0];
    cell.appendChild(v);
    cell.appendChild(k);
    box.appendChild(cell);
  });
}

function updateHintBadge() {
  const b = el('hint-count');
  if (S.hintCount > 0) {
    b.textContent = '已用 ' + S.hintCount + ' 次';
    b.classList.remove('hidden');
  } else {
    b.classList.add('hidden');
  }
}

function lockInputs() {
  el('answer-input').disabled = true;
  el('submit-btn').disabled = true;
  el('hint-btn').disabled = true;
}

// ==================== 倒數計時（畫面用，裁判在後端）====================

function startTimer(remainingMs, limitMs) {
  stopTimer();
  S.limitMs = Number(limitMs || 0);
  S.deadlineAt = Date.now() + Math.max(0, Number(remainingMs || 0));
  paintTimer();
  S.tickId = setInterval(paintTimer, 250);
}

function stopTimer() {
  if (S.tickId) { clearInterval(S.tickId); S.tickId = null; }
}

function paintTimer() {
  const left = S.deadlineAt - Date.now();
  const shown = Math.max(0, left);
  const m = Math.floor(shown / 60000);
  const s = Math.floor((shown % 60000) / 1000);
  el('timer-text').textContent =
    String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

  const pct = S.limitMs > 0 ? Math.max(0, Math.min(100, shown / S.limitMs * 100)) : 0;
  el('timer-fill').style.width = pct + '%';

  const t = el('timer');
  t.classList.toggle('warn', shown <= 300000 && shown > 120000);
  t.classList.toggle('danger', shown <= 120000);

  if (left <= 0) {
    stopTimer();
    onLocalTimeout();
  }
}

async function onLocalTimeout() {
  if (S.timedOut) return;
  S.timedOut = true;
  lockInputs();
  feedback('時間到了！正在回報系統…', 'error');
  try {
    const r = await api({ action: 'state', token: S.token });
    if (r.success) { clearFeedback(); applyState(r.data); }
  } catch (e) {
    feedback('時間到了，但目前連不上系統。請告訴老師。', 'error');
  }
}

// ==================== 動作 ====================

async function doStart() {
  const team = el('team-input').value.trim().toUpperCase();
  if (!team) { feedback('請輸入組別代碼。', 'error'); return; }

  el('start-btn').disabled = true;
  loading(true, '正在確認組別…');
  clearFeedback();
  try {
    const r = await api({ action: 'start', team: team });
    if (r.success) {
      saveToken(r.data.token);
      applyState(r.data);
    } else {
      feedback(r.message, 'error');
    }
  } catch (e) {
    feedback('連不上系統。請確認網路，或請老師檢查 Web App 的存取權限設定。', 'error');
  } finally {
    loading(false);
    el('start-btn').disabled = false;
  }
}

async function doBegin() {
  el('begin-btn').disabled = true;
  loading(true, '正在開啟關卡…');
  try {
    const r = await api({ action: 'begin', token: S.token });
    if (r.success) { clearFeedback(); applyState(r.data); }
    else handleFail(r);
  } catch (e) {
    feedback('連線錯誤，請再按一次「開始本關」。', 'error');
  } finally {
    loading(false);
    el('begin-btn').disabled = false;
  }
}

async function doVerify() {
  if (S.busy || S.cooling) return;
  const answer = el('answer-input').value;
  if (!answer.trim()) { feedback('請先輸入密碼。', 'error'); return; }

  S.busy = true;
  const btn = el('submit-btn');
  btn.disabled = true;
  btn.textContent = '驗證中…';
  clearFeedback();

  try {
    const r = await api({ action: 'verify', token: S.token, answer: answer });

    if (r.success) {
      stopTimer();
      lockInputs();

      const box = document.createElement('div');
      const p = document.createElement('p');
      p.className = 'story-text';
      p.textContent = r.data.successMessage || '答對了！';
      box.appendChild(p);

      if (r.data.usedSec != null) {
        const u = document.createElement('p');
        u.className = 'note';
        u.textContent = '本關耗時 ' + Math.floor(r.data.usedSec / 60) + ' 分 ' + (r.data.usedSec % 60) + ' 秒';
        box.appendChild(u);
      }

      if (!r.data.finished && r.data.next) {
        const b = document.createElement('button');
        b.className = 'btn primary-btn wide';
        b.textContent = '前往下一關';
        b.addEventListener('click', function () {
          clearFeedback();
          applyState(r.data.next);
        });
        box.appendChild(b);
      }

      feedback('', 'success', box);

      if (r.data.finished) {
        try {
          const st = await api({ action: 'state', token: S.token });
          if (st.success) applyState(st.data);
        } catch (e) { /* 訊息已經顯示，忽略 */ }
      }
    } else {
      handleFail(r);
    }
  } catch (e) {
    feedback('驗證時連線失敗。你的答案還沒送出，請再按一次驗證。', 'error');
  } finally {
    S.busy = false;
    if (!S.cooling && !S.timedOut && S.status === '進行中' && !el('answer-input').disabled) {
      btn.disabled = false;
      btn.textContent = '驗證';
    }
  }
}

function handleFail(r) {
  const code = r.code || '';

  if (code === 'bad_token' || code === 'no_progress') {
    dropToken();
    stopTimer();
    showScreen('entry');
    feedback(r.message, 'error');
    return;
  }

  if (code === 'timeout') {
    feedback(r.message, 'error');
    if (r.data && r.data.status) applyState(r.data);
    return;
  }

  if (code === 'not_started') {
    feedback(r.message, 'error');
    if (r.data && r.data.status) applyState(r.data);
    return;
  }

  if (code === 'cooldown') {
    feedback(r.message, 'error');
    if (r.data && r.data.remainingMs != null) startTimer(r.data.remainingMs, S.limitMs);
    coolDown(Number((r.data && r.data.cooldownLeftSec) || 30));
    return;
  }

  // 一般答錯
  feedback(r.message, 'error');
  if (r.data && r.data.remainingMs != null) startTimer(r.data.remainingMs, S.limitMs);
  const input = el('answer-input');
  input.value = '';
  input.focus();
}

function coolDown(sec) {
  S.cooling = true;
  const btn = el('submit-btn');
  const input = el('answer-input');
  btn.disabled = true;
  input.disabled = true;
  let left = sec;
  btn.textContent = '等待 ' + left + ' 秒';
  const id = setInterval(function () {
    left -= 1;
    if (left > 0) {
      btn.textContent = '等待 ' + left + ' 秒';
    } else {
      clearInterval(id);
      S.cooling = false;
      btn.textContent = '驗證';
      if (S.status === '進行中' && !S.timedOut) {
        btn.disabled = false;
        input.disabled = false;
        input.value = '';
        input.focus();
      }
    }
  }, 1000);
}

async function doHint() {
  if (S.busy) return;
  const btn = el('hint-btn');
  btn.disabled = true;
  try {
    const r = await api({ action: 'hint', token: S.token });
    if (r.success) {
      S.hintCount = Number(r.data.hintCount || 0);
      updateHintBadge();
      el('hint-text').textContent = r.data.hint || '';
      const pen = el('hint-penalty');
      if (r.data.penaltySec > 0) {
        pen.textContent = '看提示已扣掉 ' + r.data.penaltySec + ' 秒。';
        pen.classList.remove('hidden');
      } else {
        pen.classList.add('hidden');
      }
      if (r.data.remainingMs != null) startTimer(r.data.remainingMs, S.limitMs);
      openHint();
    } else {
      handleFail(r);
    }
  } catch (e) {
    feedback('取得提示時連線失敗，請再試一次。', 'error');
  } finally {
    if (S.status === '進行中' && !S.timedOut) btn.disabled = false;
  }
}

async function doSkip() {
  el('skip-btn').disabled = true;
  loading(true, '正在前往下一關…');
  try {
    const r = await api({ action: 'skip', token: S.token });
    if (r.success) { clearFeedback(); applyState(r.data); }
    else handleFail(r);
  } catch (e) {
    feedback('連線錯誤，請再試一次。', 'error');
  } finally {
    loading(false);
    el('skip-btn').disabled = false;
  }
}

// ==================== 提示彈窗 ====================

function openHint() {
  S.lastFocus = document.activeElement;
  el('hint-modal').classList.remove('hidden');
  el('close-modal').focus();
}
function closeHint() {
  el('hint-modal').classList.add('hidden');
  if (S.lastFocus && S.lastFocus.focus) S.lastFocus.focus();
}
function hintOpen() {
  return !el('hint-modal').classList.contains('hidden');
}

// ==================== 定期校正 ====================

async function resync() {
  if (!S.token || S.busy || S.cooling) return;
  if (S.status !== '進行中' && S.status !== '待開始') return;
  try {
    const r = await api({ action: 'state', token: S.token }, 1);
    if (r.success) applyState(r.data);
  } catch (e) { /* 網路抖動，下一輪再試 */ }
}

// ==================== 啟動 ====================

function bindEvents() {
  el('start-btn').addEventListener('click', doStart);
  el('team-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doStart();
  });

  el('begin-btn').addEventListener('click', doBegin);
  el('submit-btn').addEventListener('click', doVerify);
  el('answer-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doVerify();
  });
  el('hint-btn').addEventListener('click', doHint);
  el('skip-btn').addEventListener('click', doSkip);

  el('close-modal').addEventListener('click', closeHint);
  el('hint-modal').addEventListener('click', function (e) {
    if (e.target === el('hint-modal')) closeHint();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && hintOpen()) closeHint();
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resync();      // 手機螢幕休眠回來立刻校正時間
  });

  S.syncId = setInterval(resync, RESYNC_MS);
}

async function boot() {
  bindEvents();

  const saved = loadToken();
  if (saved) {
    loading(true, '正在接回你們的進度…');
    try {
      const r = await api({ action: 'state', token: saved });
      if (r.success) {
        S.token = saved;
        loading(false);
        applyState(r.data);
        return;
      }
      dropToken();
    } catch (e) {
      loading(false);
      showScreen('entry');
      feedback('目前連不上系統，請確認網路後重新整理。', 'error');
      return;
    }
    loading(false);
  }

  showScreen('entry');
  setTimeout(function () { el('team-input').focus(); }, 50);
}

boot();
