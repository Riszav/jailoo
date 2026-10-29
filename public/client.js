const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9-]/g, "");
let myId = store.get("zh.id");
if (!myId) {
  myId = newId();
  store.set("zh.id", myId);
}
let myName = store.get("zh.name") || "";
// Аккаунт: токен сессии хранится в браузере, account — профиль от сервера (логин, имя, рейтинг).
// Профиль запоминаем в браузере, чтобы после перезагрузки сразу показать его, а не мигнуть кнопкой «Войти».
let token = store.get("zh.token") || "", account = null, tops = [];
if (token) try { account = JSON.parse(store.get("zh.account")); } catch {}

let ws = null, connected = false, retry = 0, build = null;
let games = [], game = null, currentCode = null;
// gk — какую игру создаём из лобби: «Жайлоо», «Кочёвка» или «Мухтар»; n — тайл, который игрок примеряет на поле «Кочёвки»;
// mk — карта, режим и цель, которые игрок выбрал в «Мухтаре».
let ui = { gk: ["nomad", "mukhtar", "bunker", "mafia"].includes(store.get("zh.gk")) ? store.get("zh.gk") : "zhailoo", mk: null, n: null, nr: 0, auth: null, authForm: { login: "", password: "", name: "" }, summaryHidden: false, mode: null, panel: null, robberHex: null, disc: emptyRes(), give: emptyRes(), get: emptyRes(), bg: "wood", bt: "brick", yopA: "wood", yopB: "ore", mono: "grain", quick: false, quickSent: 0 };
let toastTimer = null;
// Чат открытой партии: история приходит при открытии, дальше — по одному сообщению.
let chatLog = [];
// Таймер считаем от момента получения состояния: часы клиента и сервера могут не совпадать.
let timerEnd = null;
// Короткие анимации: бросок, пришедшие ресурсы, начало вашего хода. Хранится момент события.
const fx = { roll: null, gain: null, turn: null };
const FX_MS = 2600;

function toast(m, html, ms = 3500) {
  const t = $("toast");
  if (html) t.innerHTML = m;
  else t.textContent = m;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast("Нет связи с сервером, переподключаемся…");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    connected = true;
    retry = 0;
    setConn();
    ws.send(JSON.stringify({ t: "hello", id: myId, name: myName, token }));
    if (currentCode) ws.send(JSON.stringify({ t: "open", code: currentCode }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "games") { games = m.games; if (!game) render(); }
    else if (m.t === "welcome") {
      // Сервер обновился, пока вкладка была открыта: старый код может не понять новое состояние.
      if (build && m.build && m.build !== build) return location.reload();
      build = m.build;
      if (m.id !== myId) { myId = m.id; store.set("zh.id", myId); }
      if (m.expired) { token = ""; store.set("zh.token", ""); toast("Сессия истекла — войдите снова"); }
      setAccount(m.user);
      render();
    }
    else if (m.t === "auth") {
      if (m.user) {
        token = m.token;
        store.set("zh.token", token);
        myId = m.id;
        store.set("zh.id", myId);
        setAccount(m.user);
        ui.auth = null;
        ui.authForm = { login: "", password: "", name: "" };
        toast(`Вы вошли как ${m.user.name}`);
        // Под аккаунтом другой идентификатор игрока — переоткрываем партию, чтобы видеть свои карты.
        if (currentCode) ws.send(JSON.stringify({ t: "open", code: currentCode }));
      } else {
        // Вышли из аккаунта — дальше играем новым гостем.
        token = "";
        store.set("zh.token", "");
        setAccount(null);
        myId = newId();
        store.set("zh.id", myId);
        ws.send(JSON.stringify({ t: "hello", id: myId, name: myName }));
        if (currentCode) ws.send(JSON.stringify({ t: "open", code: currentCode }));
      }
      render();
    }
    else if (m.t === "top") {
      tops = m.top;
      const mine = account && tops.find((u) => u.login === account.login);
      if (mine) setAccount({ ...account, ...mine });
      render();
    }
    else if (m.t === "opened") { currentCode = m.code; store.set("zh.game", m.code); if (location.hash !== "#" + m.code) history.replaceState(null, "", "#" + m.code); }
    else if (m.t === "state") {
      if (m.game.code !== currentCode) return;
      const old = game && game.code === m.game.code ? game : null;
      game = m.game;
      cacheGame(game);
      timerEnd = game.timeLeft != null ? Date.now() + game.timeLeft : null;
      soundNotice(old, game);
      if (game.game === "nomad") nomadNotice(old, game);
      else if (game.game === "mukhtar") mukhtarNotice(old, game);
      else if (game.game === "bunker") bunkerNotice(old, game);
      else if (game.game === "mafia") mafNotice(old, game);
      else noticeChanges(old, game);
      if (game.phase !== "discard") ui.disc = emptyRes();
      if (game.phase !== "main" || game.cur !== myIndex()) ui.mode = null;
      if (game.cur !== myIndex()) ui.panel = null;
      if (game.phase !== "robber") ui.robberHex = null;
      quickStep();
      render();
    }
    else if (m.t === "chat") {
      if (m.code !== currentCode) return;
      if (m.list) { chatLog = m.list; ui.chatSeen = Math.max(ui.chatSeen || 0, ...chatLog.map((x) => x.n)); }
      else if (!chatLog.some((x) => x.n === m.m.n)) {
        chatLog = [...chatLog, m.m].slice(-150);
        if (game && m.m.i !== mySeat(game)) sfx("chat");
        if (ui.chatOpen || game?.game === "bunker" || game?.game === "mafia") ui.chatSeen = m.m.n;
      }
      if (game) render();
    }
    else if (m.t === "emote") { if (m.code === currentCode && game) showEmote(m.i, m.e); }
    else if (m.t === "goto") openGame(m.code);
    else if (m.t === "closed") { if (m.code === currentCode) { toast("Партия удалена"); closeGame(); } }
    else if (m.t === "error") {
      ui.quick = false;
      if (ui.auth) { ui.authError = m.message; render(); }
      toast(m.message);
      if (/не найдена/.test(m.message) && !game) closeGame();
    }
  };
  ws.onclose = () => {
    connected = false;
    setConn();
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
}
function setAccount(u) {
  account = u;
  store.set("zh.account", u ? JSON.stringify(u) : "");
  if (u && u.name !== myName) { myName = u.name; store.set("zh.name", myName); }
}
function setConn() {
  const c = $("conn");
  c.textContent = connected ? "" : "Нет связи — переподключаемся";
  c.classList.toggle("bad", !connected);
}

// Сравниваем новое состояние с прошлым: что выпало, что пришло в руку, чей ход, новые стоянки, кража.
function noticeChanges(old, s) {
  if (!old || old.status !== "play" || s.status !== "play") return;
  const now = Date.now(), me = myIndex();
  if (s.dice && (!old.dice || old.turnNo !== s.turnNo)) fx.roll = { n: s.dice[0] + s.dice[1], t: now };
  if (me < 0) return;
  const P = s.players[me], O = old.players[me], d = emptyRes();
  for (const k of RES) d[k] = Math.max(0, P.res[k] - O.res[k]);
  if (sum(d)) fx.gain = { d, t: now };
  if (s.cur === me && (old.cur !== me || old.turnNo !== s.turnNo || old.setupIdx !== s.setupIdx)) fx.turn = { t: now };
  const own = (st, h) => { const ed = gOf(st).edges[h.e]; return ownerAt(st, ed.a) === me || ownerAt(st, ed.b) === me; };
  for (const [i, h] of s.harbors.entries()) {
    if (!own(s, h) || own(old, old.harbors[i])) continue;
    toast(h.type === "any" ? "Стоянка ваша: теперь любые 3 одинаковых ресурса меняются на 1 нужный (3:1)" : `Стоянка ваша: теперь 2 ${resChip(h.type, 1)} меняются на 1 любой ресурс (2:1)`, true, 6000);
  }
  for (const id in s.steals) {
    const st = s.steals[id];
    if (+id <= (old.stealNo || 0) || !st.r) continue;
    if (st.t === me) toast(`Вы забрали ${resChip(st.r, 1)} ${RES_RU[st.r]} у ${esc(nameOf(s, st.v))}`, true, 6000);
    else if (st.v === me) toast(`${esc(nameOf(s, st.t))} забирает у вас ${resChip(st.r, 1)} ${RES_RU[st.r]}`, true, 6000);
  }
}
const fxOn = (e, ms = FX_MS) => e && Date.now() - e.t < ms;
// Отрицательная задержка продолжает анимацию с того же места, когда поле перерисовывается посреди неё.
const fxDelay = (e) => `style="animation-delay:-${Date.now() - e.t}ms"`;

function tickTimer() {
  const el = $("timer");
  if (!el || timerEnd == null) return;
  const left = game?.paused ? Math.ceil((game.timeLeft || 0) / 1000) : Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  el.querySelector("b").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  el.classList.toggle("low", !game?.paused && left <= 5);
}
setInterval(tickTimer, 250);

// «Играть с ботами»: после создания партии сажаем трёх ботов по одному на каждое обновление и начинаем.
function quickStep() {
  if (!ui.quick || game.status !== "lobby" || game.host !== myId) return;
  const n = game.players.length;
  if (n < 4 && n > ui.quickSent) { ui.quickSent = n; act({ type: "addBot" }); }
  else if (n >= 4) { ui.quick = false; act({ type: "start" }); }
}

const act = (action) => send({ t: "act", action });
const myIndex = () => (game ? game.players.findIndex((p) => p.id === myId) : -1);
const cnt = (p) => (p.resCount ?? sum(p.res));
const devCnt = (p) => (p.devCount ?? p.dev.length);
const nameOf = (s, i) => {
  const p = s.players[i];
  if (!p) return "?";
  if (p.bot) return p.name;
  return (s.names && s.names[p.id]) || `Игрок ${i + 1}`;
};
const victimsOf = (s, h, me) => [...new Set(gOf(s).hexVerts[h].map((v) => ownerAt(s, v)).filter((o) => o >= 0 && o !== me && cnt(s.players[o]) > 0 && canRob(s, o)))];

const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const initial = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
const inkOn = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c || "");
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? "#2a2418" : "#fff";
};
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
const delBtn = (code, small) => `<button class="btn red small" data-del="${esc(code)}" title="Удалить игру">${ICON("trash")}${small ? "" : '<span class="tl">Удалить игру</span>'}</button>`;
const ava = (name, color, cls = "") => `<span class="ava ${cls}" style="background:${color};color:${inkOn(color)}" title="${esc(name)}">${esc(initial(name))}</span>`;

// --- тема ---
const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const themeIcon = () => {
  const dark = theme() === "dark", label = dark ? "Светлая тема" : "Тёмная тема";
  return { label, html: ICON(dark ? "sun" : "moon") };
};
function setTheme(t, remember) {
  document.documentElement.dataset.theme = t;
  if (remember) store.set("zh.theme", t);
  render();
}
// Пока игрок сам не выбрал тему, следуем за системной.
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
  if (!store.get("zh.theme")) setTheme(e.matches ? "dark" : "light", false);
});

function render() {
  const tb = $("themebtn"), ti = themeIcon();
  tb.innerHTML = ti.html;
  tb.dataset.tip = ti.label;
  tb.setAttribute("aria-label", ti.label);
  // Перерисовка убирает элемент под подсказкой — прячем её, иначе она повиснет.
  queueMicrotask(retip);
  // Пока игрок печатает, комната может обновиться (зашёл бот или игрок) — сохраняем текст и курсор в поле ввода.
  const a = document.activeElement, keep = a && a.tagName === "INPUT" && a.id ? { id: a.id, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
  // Чат держится внизу, если его не прокрутили вверх.
  const cb = $("chatbox"), chatAt = cb && cb.scrollHeight - cb.scrollTop - cb.clientHeight > 40 ? cb.scrollTop : null;
  renderView();
  renderDock();
  const cb2 = $("chatbox");
  if (cb2) cb2.scrollTop = chatAt ?? cb2.scrollHeight;
  if (keep && $(keep.id)) {
    const el = $(keep.id);
    el.value = keep.v;
    el.focus();
    try { el.setSelectionRange(keep.s, keep.e); } catch {}
  }
}
function renderView() {
  document.body.classList.toggle("nomad", !!game && game.game === "nomad" && game.status !== "lobby");
  document.body.classList.toggle("mukhtar", !!game && game.game === "mukhtar" && game.status !== "lobby");
  document.body.classList.toggle("bunker", !!game && (game.game === "bunker" || game.game === "mafia") && game.status !== "lobby");
  if (!game || game.game !== "mafia" || game.status !== "play") document.body.classList.remove("fnight");
  const me = $("me");
  me.innerHTML = account
    ? `${ava(account.name, "#f2b53a", "sm")}<span>${esc(account.name)}</span><span class="rating" title="Рейтинг — растёт за победы, падает за поражения">${account.rating}</span><button class="btn ghost small" data-a="logout" title="Выйти из аккаунта">${ICON("exit")}<span class="tl">Выйти</span></button>`
    : `${myName ? `${ava(myName, "#f2b53a", "sm")}<span class="guest">${esc(myName)}</span>` : ""}<button class="btn small" data-a="authopen">Войти</button>`;
  renderAuth();
  if (!game) return currentCode ? renderLoading() : renderLobby();
  if (game.status === "lobby") renderRoom();
  else renderGame();
}

const heroBg = () => {
  const cells = [[0, 0, "wood"], [52, 0, "grain"], [104, 0, "wood"], [0, 90, "wood"], [52, 90, "grain"], [104, 90, "wood"], [26, 45, "ore"], [78, 45, "brick"], [26, 135, "wool"], [78, 135, "desert"]];
  return `<svg class="hero-bg" aria-hidden="true"><defs><polygon id="hx" points="0,-28 24.2,-14 24.2,14 0,28 -24.2,14 -24.2,-14"/>
    <pattern id="hexpat" width="104" height="180" patternUnits="userSpaceOnUse" patternTransform="rotate(-10) scale(1.4)">
    ${cells.concat(cells.filter((c) => c[1] === 0).map(([x, , r]) => [x, 180, r])).map(([x, y, r]) => `<use href="#hx" x="${x}" y="${y}" style="fill:var(--${r})"/>`).join("")}</pattern></defs>
    <rect width="100%" height="100%" fill="url(#hexpat)"/></svg>`;
};

// --- вход и регистрация ---
function renderAuth() {
  const box = $("modal");
  if (!ui.auth) { box.hidden = true; box.innerHTML = ""; return; }
  const reg = ui.auth === "register", f = ui.authForm;
  box.hidden = false;
  box.innerHTML = `<div class="panel authbox" role="dialog" aria-modal="true" aria-labelledby="auth-h">
    <div class="pop-h"><b id="auth-h">${reg ? "Регистрация" : "Вход"}</b><button class="x" data-a="authclose" aria-label="Закрыть">×</button></div>
    <div class="tabs" role="tablist"><button role="tab" aria-selected="${!reg}" class="${reg ? "" : "on"}" data-authtab="login">Вход</button><button role="tab" aria-selected="${reg}" class="${reg ? "on" : ""}" data-authtab="register">Регистрация</button></div>
    <label for="au-login">Логин</label><input id="au-login" autocomplete="username" maxlength="20" value="${esc(f.login)}" placeholder="латиница, цифры, _">
    <label for="au-pass">Пароль</label><input id="au-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" maxlength="200" value="${esc(f.password)}" placeholder="${reg ? "не короче 6 символов" : ""}">
    ${reg ? `<label for="au-name">Имя в игре</label><input id="au-name" maxlength="24" value="${esc(f.name || myName)}" placeholder="Например, Айгуль">` : ""}
    ${ui.authError ? `<p class="warn">${esc(ui.authError)}</p>` : ""}
    <button class="btn green big" data-a="authsubmit">${reg ? "Создать аккаунт" : "Войти"}</button>
    <p class="hint">${reg ? "Партии, которые вы играете сейчас, останутся за вами. Рейтинг считается только у игроков с аккаунтом." : "Аккаунт хранит ваше имя, рейтинг и партии на любом устройстве."}</p></div>`;
}
function submitAuth() {
  const f = ui.authForm;
  ui.authError = null;
  if (!f.login.trim() || !f.password) { ui.authError = "Введите логин и пароль"; return render(); }
  send({ t: ui.auth, login: f.login.trim(), password: f.password, name: (f.name || myName).trim() });
}

// --- рейтинг ---
function topHTML() {
  if (!tops.length) return `<p class="empty">Пока пусто: доиграйте партию с аккаунтом — и вы первым попадёте в таблицу.</p>`;
  return `<div class="tablewrap"><table class="toptable"><thead><tr><th>#</th><th>Игрок</th><th title="Рейтинг Эло: старт 1000">Рейтинг</th><th>Партий</th><th>Побед</th><th title="Среднее число очков за партию">Ср. очки</th></tr></thead><tbody>
    ${tops.map((u, i) => `<tr class="${account && u.login === account.login ? "mine" : ""}"><td class="pl-n">${i < 3 ? `<span class="medal m${i + 1}">${i + 1}</span>` : i + 1}</td><td><span class="who2">${ava(u.name, COLORS[i % COLORS.length], "sm")}<span>${esc(u.name)}<small>@${esc(u.login)}</small></span></span></td><td class="tn"><b>${u.rating}</b></td><td class="tn">${u.games}</td><td class="tn">${u.wins} <small>${Math.round((u.wins / u.games) * 100)}%</small></td><td class="tn">${u.avgVp}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// --- чат партии ---
// Сейчас он есть в «Бункере»: в комнате ожидания и в самой игре. Писать могут игроки за столом, зрители только читают.
// В «Мафии» у чата несколько каналов: общий, закрытый чат мафии и чат мёртвых — вкладки выбирают, куда писать.
const CH_RU = { mafia: "мафия", dead: "мёртвые" };
function chatHTML(s, me) {
  const K = (GKIND[s.game] || GKIND.zhailoo).rules(), colors = K.COLORS;
  const seat = me >= 0 ? me : s.players.findIndex((p) => p.was === myId);
  const chans = seat >= 0 && K.chatChannels ? K.chatChannels(s, seat) : [{ id: "all", name: "Общий" }];
  const blocked = (ch) => (seat >= 0 && K.chatCheck ? K.chatCheck(s, seat, ch) : null);
  // Канал закрыт (ночью общий) — переключаемся на тот, куда писать можно.
  if (!chans.some((c) => c.id === ui.chatCh) || (blocked(ui.chatCh) && chans.some((c) => !blocked(c.id)))) ui.chatCh = (chans.find((c) => !blocked(c.id)) || chans[0]).id;
  const why = blocked(ui.chatCh);
  const msgs = chatLog.map((m) => {
    const p = s.players[m.i], color = p?.color || colors[m.i] || "#888", out = p?.out || p?.dead;
    return `<div class="cm ${m.i === seat ? "own" : ""} ${m.ch && m.ch !== "all" ? "ch-" + m.ch : ""}"><b style="color:${color}">${esc(m.name)}${m.ch && CH_RU[m.ch] ? ` <i class="chtag">${CH_RU[m.ch]}</i>` : ""}${out ? ` <small class="muted">${p?.dead ? "выбыл" : "за дверью"}</small>` : ""}</b><span>${esc(m.text)}</span></div>`;
  }).join("");
  const tabs = chans.length > 1 ? `<div class="chtabs" role="tablist">${chans.map((c) => `<button role="tab" class="${c.id === ui.chatCh ? "on" : ""} ch-${c.id}" aria-selected="${c.id === ui.chatCh}" data-chatch="${c.id}">${c.name}</button>`).join("")}</div>` : "";
  return `<div class="panel chatp"><div class="ph"><h3>Чат</h3></div>
    <div class="chatbox" id="chatbox" aria-live="polite">${msgs || '<p class="muted cm-empty">Здесь игроки спорят и убеждают друг друга. Голосом удобнее — созвонитесь в Discord или Telegram, а ходы делайте здесь.</p>'}</div>
    ${seat < 0 ? '<p class="hint cm-ro">Писать могут только игроки за столом.</p>' : why ? `${tabs}<p class="hint cm-ro">${esc(why)}</p>` : `${tabs}<div class="chatin"><input id="chatin" maxlength="300" placeholder="${ui.chatCh === "mafia" ? "Только для мафии…" : ui.chatCh === "dead" ? "Видят только выбывшие…" : "Сообщение…"}" autocomplete="off" aria-label="Сообщение в чат"><button class="btn small blue" data-a="chatsend">Отправить</button></div>`}
  </div>`;
}
// Место игрока за столом — и тогда, когда за него сейчас играет бот.
const mySeat = (s) => (s ? s.players.findIndex((p) => p.id === myId || p.was === myId) : -1);
// Игрок не в сети: вкладка с партией у него закрыта. Ботов не отмечаем.
const offTag = (s, i) => (s.online && !s.online[i] && !s.players[i]?.bot ? '<span class="badge off" title="Не в сети — закрыл вкладку с игрой. Через минуту его заменит бот">не в сети</span>' : "");
// Кнопка реванша в итогах: первый нажавший создаёт комнату с теми же настройками, остальные к ней присоединяются.
function rematchBtn(s) {
  if (mySeat(s) < 0) return "";
  const by = s.rematch && s.rematchBy != null ? nameOf(s, s.rematchBy) : "";
  return `<button class="btn blue" data-a="rematch" title="${s.rematch ? `${esc(by)} собирает реванш — та же игра и настройки` : "Новая партия с теми же настройками и ботами"}">${ICON("play")}${!s.rematch ? "Реванш" : s.rematchBy === mySeat(s) ? "К реваншу" : "Присоединиться к реваншу"}</button>`;
}

// --- звуки ---
// Синтезируются на лету через Web Audio, файлов нет. Выключаются кнопкой в углу экрана, выбор запоминается.
let actx = null;
const soundOn = () => store.get("zh.sound") !== "off";
function tone(freq, at, len, type = "sine", vol = 0.12, to = null) {
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}
function noise(at, len, vol = 0.08) {
  const n = Math.floor(actx.sampleRate * len), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(f).connect(g).connect(actx.destination);
  src.start(actx.currentTime + at);
}
const SOUNDS = {
  turn: () => { tone(660, 0, 0.16); tone(880, 0.13, 0.28); },
  chat: () => tone(1250, 0, 0.07, "triangle", 0.05),
  pop: () => tone(420, 0, 0.12, "sine", 0.1, 900),
  dice: () => { for (let k = 0; k < 4; k++) noise(k * 0.07, 0.05, 0.12); },
  vote: () => { tone(520, 0, 0.12, "square", 0.05); tone(520, 0.18, 0.12, "square", 0.05); },
  win: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.12, 0.3, "triangle", 0.1)),
  lose: () => [392, 330, 262].forEach((f, k) => tone(f, k * 0.16, 0.34, "sine", 0.1)),
  night: () => { tone(220, 0, 0.5, "sine", 0.09); tone(165, 0.3, 0.7, "sine", 0.08); },
};
function sfx(name) {
  if (!soundOn() || !SOUNDS[name]) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    SOUNDS[name]();
  } catch {}
}
// Браузер разрешает звук только после действия пользователя — будим звук первым кликом.
document.addEventListener("pointerdown", () => { if (soundOn() && !actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }, { once: true });
// Что прозвучит при новом состоянии: ваш ход, бросок, голосование в «Бункере», конец партии.
function soundNotice(old, s) {
  if (!old || old.code !== s.code) return;
  const me = myIndex(), seat = mySeat(s);
  const myTurn = (x) => x.status === "play" && me >= 0 && x.cur === me && (x.game !== "bunker" || x.phase === "speech");
  if (s.game === "mafia" && s.status === "play" && s.phase !== old.phase) sfx(s.phase === "night" ? "night" : s.phase === "vote" || s.phase === "revote" ? "vote" : old.phase === "night" ? "turn" : null);
  if (myTurn(s) && (!myTurn(old) || old.turnNo !== s.turnNo)) sfx("turn");
  if ((!s.game || s.game === "zhailoo") && s.dice && (!old.dice || old.turnNo !== s.turnNo)) sfx("dice");
  if (s.game === "bunker" && (s.phase === "vote" || s.phase === "revote") && old.phase !== s.phase) sfx("vote");
  if (s.game === "mafia" && s.players[me]?.dead && !old.players[me]?.dead) sfx("lose");
  if (old.status === "play" && s.status === "over") sfx(seat >= 0 && (s.winners ? s.winners.includes(seat) : s.winner === seat) ? "win" : "lose");
  if (!old.rematch && s.rematch && s.rematchBy !== seat) toast(`${nameOf(s, s.rematchBy)} зовёт на реванш — кнопка в итогах`, false, 6000);
}

// --- эмоции ---
const EMOTES = ["👍", "😂", "😮", "😡", "😭", "🔥", "👏", "🤔", "🙏", "💀", "Кой!", "Жакшы!", "Ой-бой!", "Рахмат!", "Реванш?", "Быстрее!"];
function showEmote(i, e) {
  const s = game, p = s.players[i];
  if (!p) return;
  sfx("pop");
  const el = document.createElement("div"), pic = /^\p{Extended_Pictographic}/u.test(e);
  el.className = `emote ${pic ? "big" : "word"}`;
  el.style.setProperty("--pc", p.color || "var(--gold)");
  el.style.left = `${12 + Math.random() * 60}%`;
  el.innerHTML = `<b>${esc(e)}</b><span>${esc(nameOf(s, i))}</span>`;
  $("emotes").append(el);
  setTimeout(() => el.remove(), 3200);
}

// --- угловая панель: чат, эмоции, звук ---
// Есть в комнате и в партии. В «Бункере» чат и так сбоку, поэтому там у панели только эмоции и звук.
function renderDock() {
  const d = $("dock"), s = game;
  if (!s || !currentCode) { d.hidden = true; d.innerHTML = ""; return; }
  const seat = mySeat(s), sideChat = s.game === "bunker" || s.game === "mafia" || s.status === "lobby";
  const unread = sideChat || ui.chatOpen ? 0 : chatLog.filter((m) => m.n > (ui.chatSeen || 0) && m.i !== seat).length;
  d.hidden = false;
  d.innerHTML = `${ui.chatOpen && !sideChat ? `<div class="dock-chat">${chatHTML(s, myIndex())}</div>` : ""}
    ${ui.emoteOpen ? `<div class="panel emopick" role="menu" aria-label="Эмоции">${EMOTES.map((e) => `<button data-emote="${esc(e)}" role="menuitem" ${seat >= 0 ? "" : "disabled"}>${esc(e)}</button>`).join("")}${seat < 0 ? '<p class="hint">Эмоции — только для игроков за столом</p>' : ""}</div>` : ""}
    <div class="dock-btns">
      <button class="dbtn" data-a="sound" title="${soundOn() ? "Выключить звук" : "Включить звук"}" aria-label="${soundOn() ? "Выключить звук" : "Включить звук"}">${soundOn() ? "🔊" : "🔇"}</button>
      <button class="dbtn ${ui.emoteOpen ? "on" : ""}" data-a="emotes" title="Эмоции и стикеры" aria-label="Эмоции и стикеры" aria-expanded="${!!ui.emoteOpen}">😊</button>
      ${sideChat ? "" : `<button class="dbtn ${ui.chatOpen ? "on" : ""}" data-a="chattoggle" title="Чат" aria-label="Чат" aria-expanded="${!!ui.chatOpen}">💬${unread ? `<b class="dnum">${unread > 9 ? "9+" : unread}</b>` : ""}</button>`}
    </div>`;
}

function sendChat() {
  const el = $("chatin"), text = (el?.value || "").trim();
  if (!text) return;
  el.value = "";
  send({ t: "chat", text, ch: ui.chatCh || "all" });
}

// Игры сайта: название, подпись в комнате и модуль правил (цвета, дополнения, число мест).
const GKIND = {
  zhailoo: { name: "Жайлоо", sub: "кубики и ресурсы, 2–8", rules: () => ({ COLORS, MODS, MAX_PLAYERS }) },
  nomad: { name: "Кочёвка", sub: "тайлы и чабаны, 2–6", rules: () => NOMAD },
  mukhtar: { name: "Мухтар", sub: "погоня и предательство, 2–6", rules: () => MUKHTAR },
  bunker: { name: "Бункер", sub: "спор и голосование, 4–12", rules: () => BUNKER },
  mafia: { name: "Мафия", sub: "роли, ночь и голосование, 5–12", rules: () => MAFIA },
};
const MSTEPS = [
  "Вы — волк из стаи, которая утащила ягнят из аила. Стая бежит по горной тропе к развилке, за ней гонится пёс Мухтар. От развилки тропы ведут к нескольким пещерам.",
  "Все начинают с шагом, рысью и бегом, дальше карты приходят из колоды. В свой ход сыграйте карту, сбросьте ненужные или обменяйтесь картой с другим волком вслепую. После хода можно взять карту из открытого ряда.",
  "Громкие карты быстрее, но шумят. В конце раунда Мухтар пробегает столько клеток, каков лай раунда, и ловит тех, кого догнал. Дальше развилки он не бежит, а караулит её.",
  "В каждой пещере своё число мест, и его не знает никто. Нажмите на пещеру, чтобы выбрать, куда бежать. Один раз за игру можно шепнуть у пещеры и тайно узнать её вместимость, а потом сказать правду или соврать.",
  "Пойманный волк становится тайганом и помогает Мухтару. А сытый Мухтар следующий раунд бежит медленнее — сдать соседа выгодно всем остальным.",
  "Спасает только полная пещера. Неполная не спасёт никого. Волк в пещере зазывает к себе, а волк снаружи может обрушить «Завалом» место в чужой. Выигрывает тот, у кого больше очков.",
];

function renderLobby() {
  document.title = "Жайлоо";
  document.body.classList.remove("ingame");
  const isMine = (g) => g.host === myId || g.players.some((p) => p.id === myId);
  const open = games.filter((g) => g.status === "lobby" && !isMine(g));
  const playing = games.filter((g) => g.status === "play");
  const mine = games.filter(isMine);
  const row = (g, label, cls) => { const k = GKIND[g.game] ? g.game : "zhailoo", K = GKIND[k]; return `<div class="room"><span class="code">${esc(g.code)}</span>
    <span class="avatars">${g.players.map((p, i) => ava(p.name, K.rules().COLORS[i], "sm")).join("")}</span>
    <span class="names"><span class="badge game-${k}">${K.name}</span> ${g.status === "lobby" ? '<span class="badge">ждёт игроков</span> ' : ""}${(g.mods || []).map((m) => `<span class="badge" title="${esc(K.rules().MODS[m]?.text || "")}">${esc(K.rules().MODS[m]?.name || m)}</span> `).join("")}${g.players.map((p) => esc(p.name)).join(", ")}</span>
    <span class="seats">${g.players.length}/${K.rules().MAX_PLAYERS}</span>
    <span class="row"><button class="btn small ${cls}" data-open="${esc(g.code)}">${label}</button>${g.host === myId ? delBtn(g.code, true) : ""}</span></div>`; };
  const nomad = ui.gk === "nomad";
  if (nomad) nEnsureDefs();
  const nsteps = [
    "Каждый ход тянется квадратный тайл с аилами, тропами, пастбищами и курганами. Положите его к уже лежащим так, чтобы края совпали.",
    "Подходящие клетки подсвечены, а цифра на клетке подсказывает, сколько очков принесёт лучший ход туда.",
    "На объект нового тайла можно поставить чабана, если там ещё никого нет. Или перекочевать: перегнать своего чабана с соседнего тайла.",
    "Достроили аил, тропу или курган — очки получает тот, у кого там больше чабанов, остальные — половину. Чабаны идут домой.",
    "Пастбища считаются дважды: в конце лета, на половине мешка, и в конце игры. Очки дают отары и размер пастбища.",
    "Побеждает тот, кто первым набрал цель, или у кого больше очков, когда тайлы кончились.",
  ];
  const tileOf = (id) => NOMAD.TILES.findIndex((t) => t.id === id);
  const gopt = (k, title, sub, art) => `<button class="gopt ${ui.gk === k ? "on" : ""}" data-gk="${k}" role="radio" aria-checked="${ui.gk === k}">${art}<span><b>${title}</b>${sub}</span></button>`;
  const gpick = `<div class="gpick" role="radiogroup" aria-label="Во что играем">
    ${gopt("zhailoo", "Жайлоо", "кубики, ресурсы, торговля", `<span class="gart hex">${ICON("logo")}</span>`)}
    ${gopt("nomad", "Кочёвка", "тайлы, чабаны, сезоны", `<span class="gart tiles">${nomad ? ["capT", "ail2o", "kurgan", "curveH"].map((id, i) => nTileSVG(tileOf(id), i % 4)).join("") : ICON("grid")}</span>`)}
    ${gopt("mukhtar", "Мухтар", "погоня и предательство", `<span class="gart mart-dog"><svg viewBox="-.3 -.3 .6 .6" aria-hidden="true"><circle r=".29" fill="#3b2a1b"/><g transform="scale(1.35)">${mDogHead()}</g></svg></span>`)}
    ${gopt("bunker", "Бункер", "спор, тайные карты, голосование", `<span class="gart bart">${ICON("users")}</span>`)}
    ${gopt("mafia", "Мафия", "роли, ночь, голосование", `<span class="gart fart" aria-hidden="true">🎩</span>`)}</div>`;
  const mukhtar = ui.gk === "mukhtar", bunker = ui.gk === "bunker", mafia = ui.gk === "mafia";
  const steps = [
    "Поле — 19, 37 или 61 участок пастбищ: размер карты выбирает создатель комнаты. Каждый даёт свой ресурс: лес, глину, шерсть, зерно или руду; степь не даёт ничего.",
    "В начале каждый ставит по две юрты с тропой. Вторая юрта сразу приносит ресурсы соседних участков.",
    "В свой ход бросьте два кубика: участки с выпавшим числом приносят ресурс всем, чьи юрты (1) и аилы (2) стоят на их углах.",
    "Выпало 7 — буран: у кого больше 7 карт, сбрасывает половину, а бросивший перегоняет буран и забирает карту у соседа.",
    "Стройте тропы, юрты и аилы, покупайте карты развития, меняйтесь с игроками, с запасом 4:1 или в стоянках 3:1 и 2:1.",
    "Юрта — 1 очко, аил — 2, «Великий путь» и «Сильнейшая дружина» — по 2, «Летопись» — 1. Побеждает первый, кто набрал 10.",
  ];
  const costs = [["road", "Тропа", COST.road], ["yurt", "Юрта", COST.settle], ["ail", "Аил", COST.city], ["card", "Карта развития", COST.dev]];
  $("view").innerHTML = `
    <section class="hero" id="sec-play">${heroBg()}
      <div class="hero-in">
        ${mafia ? `<h1>Город засыпает, <em>просыпается мафия</em></h1>
        <p class="lead">Мафия, шериф, доктор и мирные жители. Ведущего не нужно — ночи, речи и голосование ведёт сайт. 5–12 игроков, лучше с друзьями по ссылке.</p>` : bunker ? `<h1>Мест в бункере хватит <em>только половине</em></h1>
        <p class="lead">Открывайте карты персонажа, спорьте в чате и голосуйте, кого не пустить. 4–12 игроков, лучше всего с друзьями по ссылке и голосом в Discord.</p>` : mukhtar ? `<h1>Волки, ягнята и пёс <em>Мухтар</em> на горной тропе</h1>
        <p class="lead">Бегите к пещерам вместе со стаей, но помните: мест в них на всех не хватит. 2–6 игроков, друзья по ссылке или боты.</p>` : nomad ? `<h1>Аилы, тропы и чабаны на <em>летних пастбищах</em></h1>
        <p class="lead">Выкладывайте тайлы, стройте аилы и делите пастбища. 2–6 игроков, друзья по ссылке или боты прямо в браузере.</p>` : `<h1>Юрты, тропы и буран на <em>горных пастбищах</em></h1>
        <p class="lead">Бесплатная онлайн-настолка для 2–8 игроков. Зовите друзей по ссылке или играйте против ботов прямо в браузере.</p>`}
        ${gpick}
        <div class="playbox">
          <label for="myname">Ваше имя</label>
          <div class="namerow"><input id="myname" maxlength="24" value="${esc(ui.nameDraft ?? myName)}" placeholder="Например, Айгуль"><button class="btn ghost" data-a="rename">Сохранить</button></div>
          <div class="bigbtns">
            <button class="btn green big" data-a="quick">${ICON("bot")}Играть с ботами</button>
            <button class="btn blue big" data-a="create">${ICON("users")}Играть с друзьями</button>
          </div>
          <div class="row join"><input id="joincode" placeholder="Код игры" maxlength="6" aria-label="Код игры"><button class="btn ghost" data-a="joincode">Войти по коду</button></div>
        </div>
        <div class="stats"><span><b>${games.filter((g) => g.status === "lobby").length}</b>ждут игроков</span><span><b>${playing.length}</b>${plural(playing.length, "партия идёт", "партии идут", "партий идёт")}</span></div>
      </div>
    </section>
    <section class="sec" id="sec-rooms">
      <h2>Комнаты</h2>
      ${mine.length ? `<div class="panel rooms"><div class="rooms-h"><h3>Ваши игры</h3></div>${mine.map((g) => row(g, "Продолжить", "green")).join("")}</div>` : ""}
      <div class="panel rooms"><div class="rooms-h"><h3>Ждут игроков</h3><button class="btn small blue" data-a="create">Создать комнату</button></div>
        ${open.length ? open.map((g) => row(g, "Войти", "blue")).join("") : `<p class="empty">Открытых комнат нет. Создайте свою и позовите друзей или сыграйте с ботами.</p>`}</div>
    </section>
    <section class="sec" id="sec-top">
      <h2>Рейтинг</h2>
      <div class="panel rooms"><div class="rooms-h"><h3>Лучшие игроки</h3>${account ? `<span class="hint">Ваш рейтинг: <b>${account.rating}</b></span>` : `<button class="btn small blue" data-a="authopen">Войти, чтобы попасть в рейтинг</button>`}</div>${topHTML()}</div>
    </section>
    <section class="sec" id="sec-rules">
      <h2>Как играть ${mafia ? "в «Мафию»" : bunker ? "в «Бункер»" : mukhtar ? "в «Мухтара»" : nomad ? "в «Кочёвку»" : "в «Жайлоо»"}</h2>
      <div class="steps">${(mafia ? MAFSTEPS : bunker ? BSTEPS : mukhtar ? MSTEPS : nomad ? nsteps : steps).map((t, i) => `<div class="panel"><span class="tn">${i + 1}</span><span>${t}</span></div>`).join("")}</div>
      ${mafia ? `<h3 class="nrules-h">Подробные правила</h3><div class="panel nrules-page">${mafRulesHTML()}</div>` : bunker ? `<h3 class="nrules-h">Подробные правила</h3><div class="panel nrules-page">${bRulesHTML()}</div>` : mukhtar ? `<h3 class="nrules-h">Подробные правила</h3><div class="panel nrules-page">${mRulesHTML()}</div>` : nomad ? `<h3 class="nrules-h">Подробные правила</h3><div class="panel nrules-page">${nRulesHTML()}</div>` : `<div class="costs">${costs.map(([ic, n, c]) => `<div class="panel">${ICON(ic)}<span><b>${n}</b>${costHTML(c)}</span></div>`).join("")}</div>`}
    </section>
    <p class="foot">Жайлоо — игра для своих. Играть можно и без аккаунта: гостя узнают по этому браузеру. Аккаунт нужен для рейтинга.</p>`;
}

const THUMB_FILL = ["var(--wood)", "var(--grain)", "var(--wool)", "var(--brick)", "var(--ore)"];
function mapThumb(R) {
  const G = gOf({ size: R }), ext = Math.max(...G.verts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y)))) + 0.3;
  return `<svg class="thumb" viewBox="${f(-ext)} ${f(-ext)} ${f(2 * ext)} ${f(2 * ext)}" aria-hidden="true">${G.hexes.map((_, i) => `<polygon points="${G.hexVerts[i].map((v) => `${f(G.verts[v].x)},${f(G.verts[v].y)}`).join(" ")}" style="fill:${THUMB_FILL[i % 5]}" stroke="#fbf6e9" stroke-width=".18"/>`).join("")}</svg>`;
}

function renderRoom() {
  const s = game, me = myIndex(), host = s.host === myId, nomad = s.game === "nomad", mukhtar = s.game === "mukhtar", bunker = s.game === "bunker", mafia = s.game === "mafia";
  const K = (GKIND[s.game] || GKIND.zhailoo).rules(), maxP = K.MAX_PLAYERS, colors = K.COLORS, gmods = K.MODS;
  const R = mapRadius(s), cfg = BOARD[R], tooMany = !nomad && !mukhtar && !bunker && !mafia && s.players.length > cfg.maxPlayers;
  const autoR = mapRadius({ players: s.players });
  const maps = MAP_SIZES.map((k) => {
    const sel = (s.mapSize || "auto") === k, r = k === "auto" ? autoR : k;
    const sub = k === "auto" ? `сейчас ${BOARD[autoR].name.toLowerCase()}` : `${gOf({ size: k }).hexes.length} участков · до ${BOARD[k].maxPlayers}`;
    return `<button class="mapopt ${sel ? "on" : ""}" data-map="${k}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${mapThumb(r)}<b>${k === "auto" ? "Авто" : BOARD[k].name}</b><span>${sub}</span></button>`;
  }).join("");
  const timers = (mafia ? MAFIA.TURN_TIMES : bunker ? BUNKER.TURN_TIMES : mukhtar ? MUKHTAR.TURN_TIMES : TURN_TIMES).map((t) => {
    const sel = (s.turnTime ?? 0) === t;
    return `<button class="topt ${sel ? "on" : ""}" data-timer="${t}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${t ? (t < 120 ? `${t} с` : `${t / 60} мин`) : "Без таймера"}</button>`;
  }).join("");
  const targets = NOMAD.TARGETS.map((t) => {
    const sel = (s.target ?? 0) === t;
    return `<button class="topt ${sel ? "on" : ""}" data-target="${t}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${t ? `${t} очков` : "Весь мешок"}</button>`;
  }).join("");
  const kinds = Object.entries(GKIND).map(([k, { name, sub }]) => {
    const sel = (s.game || "zhailoo") === k;
    return `<button class="mapopt gk ${sel ? "on" : ""}" data-setgame="${k}" aria-pressed="${sel}" ${host ? "" : "disabled"}><b>${name}</b><span>${sub}</span></button>`;
  }).join("");
  const talks = BUNKER.TALK_TIMES.map((t) => {
    const sel = (s.talk ?? 120) === t;
    return `<button class="topt ${sel ? "on" : ""}" data-btalk="${t}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${t < 120 ? `${t} с` : `${t / 60} мин`}</button>`;
  }).join("");
  const minP = K.MIN_PLAYERS || 2;
  const heads = MUKHTAR.HEADS.map((h) => {
    const sel = (s.head ?? 5) === h;
    return `<button class="topt ${sel ? "on" : ""}" data-mhead="${h}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${h} ${plural(h, "клетка", "клетки", "клеток")}${h === 3 ? " · трудно" : h === 7 ? " · легко" : ""}</button>`;
  }).join("");
  const mods = Object.entries(gmods).map(([k, m]) => {
    const on = mod(s, k);
    return `<button class="modopt ${on ? "on" : ""}" data-mod="${k}" aria-pressed="${on}" ${host ? "" : "disabled"}><span class="tick" aria-hidden="true">${on ? "✓" : ""}</span><span><b>${m.name}</b>${m.text}</span></button>`;
  }).join("");
  const helperList = !nomad && mod(s, "helpers") ? `<details class="hlist"><summary>Какие бывают помощники</summary>${Object.values(HELPERS).map((h) => `<p><b>${h.name}</b> — ${h.text}</p>`).join("")}</details>` : "";
  document.title = `${mafia ? "Мафия" : bunker ? "Бункер" : mukhtar ? "Мухтар" : nomad ? "Кочёвка" : "Игра"} ${s.code} — Жайлоо`;
  document.body.classList.remove("ingame");
  const link = `${location.origin}${location.pathname}#${s.code}`;
  // Сложность бота: три кнопки-ступеньки, видны только создателю.
  const levelPick = (i, cur) => `<span class="lvl" role="group" aria-label="Сложность бота">${LEVELS.map((l) => `<button class="${l === cur ? "on" : ""}" data-lvl="${i}:${l}" aria-pressed="${l === cur}" title="Сложность — ${LEVEL_RU[l]}">${LEVEL_RU[l][0].toUpperCase()}${LEVEL_RU[l].slice(1)}</button>`).join("")}</span>`;
  const slots = [...Array(maxP).keys()].map((i) => {
    const p = s.players[i];
    if (!p) return `<div class="slot free"><span class="ava ghost">+</span><span class="nm muted">Свободное место</span>${host ? `<button class="btn small" data-a="addBot">${ICON("bot")}Бот</button>` : ""}</div>`;
    return `<div class="slot">${ava(nameOf(s, i), colors[i])}<span class="nm">${esc(nameOf(s, i))}${p.bot && !host ? ` <span class="badge">бот · ${LEVEL_RU[p.level || "medium"]}</span>` : p.bot ? ' <span class="badge">бот</span>' : ""}${p.id === s.host ? ' <span class="badge gold">создатель</span>' : ""} ${p.id === myId ? ' <span class="badge">вы</span>' : ""}${offTag(s, i)}</span>${host && p.bot && K.LEVELS ? levelPick(i, p.level || "medium") : ""}${host && p.id !== myId ? `<button class="btn small red" data-kick="${i}">Убрать</button>` : ""}</div>`;
  }).join("");
  $("view").innerHTML = `<div class="roomgrid">
    <div class="panel pad"><h2>Игроки <span class="muted">${s.players.length}/${maxP}</span></h2><div class="slots">${slots}</div>
      ${host ? "" : `<p class="hint">Игру начинает создатель комнаты.</p>`}
      ${mafia ? `<p class="hint">Боты в «Мафии» не говорят: ночью делают ход своей роли, днём выставляют и голосуют. Играть интереснее с людьми.</p>` : ""}
      ${bunker ? `<p class="hint">Боты в «Бункере» не спорят: они открывают случайную карту и голосуют за того, против кого уже больше голосов. Играть интереснее с людьми.</p>` : ""}
      <h3><label for="myname">Ваше имя</label></h3>
      <div class="namerow"><input id="myname" maxlength="24" value="${esc(ui.nameDraft ?? myName)}" placeholder="Например, Айгуль"><button class="btn" data-a="rename">Сохранить</button></div></div>
    <div class="panel pad"><h3>Код комнаты</h3><span class="bigcode">${esc(s.code)}</span>
      <h3>Пригласить друзей</h3>
      <div class="linkrow"><input readonly value="${esc(link)}" aria-label="Ссылка на игру"><button class="btn" data-copy="${esc(link)}">Копировать</button></div>
      <p class="hint">До ${maxP} игроков; пустые места можно отдать ботам.${nomad || mukhtar ? " Цвета фигурок раздаются по порядку хода." : ""}${mukhtar ? " Интереснее всего вчетвером и больше." : ""}</p>
      <h3>Игра</h3>
      <div class="maps kinds">${kinds}</div>
      ${bunker || mafia ? "" : mukhtar ? `<h3>Фора волков</h3><div class="topts">${heads}</div>` : nomad ? `<h3>Цель</h3><div class="topts">${targets}</div>` : `<h3>Размер карты</h3>
      <div class="maps">${maps}</div>`}
      <h3>${bunker || mafia ? "Время на речь" : "Таймер хода"}</h3>
      <div class="topts">${timers}</div>
      ${bunker ? `<h3>Обсуждение перед голосованием</h3><div class="topts">${talks}</div>` : ""}
      ${mods ? `<h3>Дополнения</h3>
      <div class="mods">${mods}</div>${helperList}` : ""}
      ${mafia ? `<p class="hint">${host ? "" : "Игру, время и дополнения выбирает создатель комнаты. "}Мафиози: 1 при 5 игроках, 2 при 6–8, 3 при 9–12; всегда есть шериф и доктор. На ночь даётся ${MAFIA.NIGHT_TIME} с, на голос — ${MAFIA.VOTE_TIME} с.</p>` : ""}
      ${bunker ? `<p class="hint">${host ? "" : "Игру и время выбирает создатель комнаты. "}Мест в бункере — половина от числа игроков. Без таймера речи игрок сам передаёт слово. На голос даётся ${BUNKER.VOTE_TIME} с.</p>` : mukhtar ? `<p class="hint">${host ? "" : "Игру, фору, таймер и дополнения выбирает создатель комнаты. "}Фора — на сколько клеток волки опережают Мухтара на старте. Время хода вышло — карту за игрока сыграет бот.</p>` : nomad ? `<p class="hint">${host ? "" : "Игру, цель, таймер и дополнения выбирает создатель комнаты. "}Время хода вышло — тайл за игрока положит бот. Дополнения можно сочетать.</p>` : `<p class="hint">${host ? "" : "Карту, таймер и дополнения выбирает создатель комнаты. "}Кубики бросаются сами через ${TIMER.roll} с. С таймером на сброс карт даётся ${TIMER.discard} с, каждое действие в ход добавляет ${TIMER.bonus} с. Время вышло — ход доигрывается автоматически.</p>`}
      ${tooMany ? `<p class="warn">${cfg.name} карта рассчитана максимум на ${cfg.maxPlayers} игроков — выберите карту побольше или уберите лишних.</p>` : ""}
      ${me < 0 ? `<button class="btn green big" data-a="join" ${s.players.length >= maxP || !myName ? "disabled" : ""}>Сесть за стол</button>` : ""}
      ${me < 0 && !myName ? `<p class="hint">Чтобы сесть за стол, укажите имя слева.</p>` : ""}
      ${host ? `<button class="btn green big" data-a="start" ${s.players.length < minP || tooMany ? "disabled" : ""}>Начать игру</button>` : ""}
      ${host && s.players.length < minP ? `<p class="hint">Нужно минимум ${minP} ${plural(minP, "игрок", "игрока", "игроков")}.</p>` : ""}
      ${chatHTML(s, me)}
      <div class="row">${me >= 0 && !host ? `<button class="btn red small" data-a="leave">${ICON("exit")}Выйти из комнаты</button>` : `<button class="btn small" data-a="back">К списку комнат</button>`}${host ? delBtn(s.code) : ""}</div>
    </div></div>`;
}

const f = (n) => (+n).toFixed(3);
const HEX_GRAD = { wood: ["#3f8f3a", "#1d5520"], brick: ["#e8804f", "#a4401f"], wool: ["#c4e67c", "#86bb45"], grain: ["#f8d95a", "#d9a21c"], ore: ["#b7c0cc", "#636d7c"], desert: ["#f4e6bd", "#d6bd80"] };
const HEX_FILL = { wood: "var(--wood)", brick: "var(--brick)", wool: "var(--wool)", grain: "var(--grain)", ore: "var(--ore)", desert: "var(--desert)" };

// Куда можно кликнуть на поле. В основной фазе без выбранной кнопки подсвечиваем всё, на что хватает ресурсов,
// но едва заметно (soft): строить можно прямо кликом по полю.
function targets(s, me) {
  const t = { v: new Map(), e: new Set(), h: new Set(), soft: false };
  if (me < 0 || s.status !== "play" || me !== s.cur || s.paused) return t;
  const addV = (vs, kind) => vs.forEach((v) => t.v.set(v, kind));
  if (s.phase === "setup") {
    if (s.step === "settle") addV(settleTargets(s, me, true), "settle");
    else roadTargets(s, me).forEach((e) => t.e.add(e));
  } else if (s.phase === "robber") {
    robberHexes(s, me).forEach((i) => t.h.add(i));
  } else if (s.phase === "roadbuilding") roadTargets(s, me).forEach((e) => t.e.add(e));
  else if (s.phase === "main") {
    const P = s.players[me], pc = countPieces(s, me), m = ui.mode;
    t.soft = !m;
    if (m === "road" || (!m && has(P.res, costOf(s, me, "road")) && pc.road < 15)) roadTargets(s, me).forEach((e) => t.e.add(e));
    if (m === "settle" || (!m && has(P.res, costOf(s, me, "settle")) && pc.settle < 5)) addV(settleTargets(s, me, false), "settle");
    if (m === "city" || (!m && has(P.res, costOf(s, me, "city")) && pc.city < 4)) addV(cityTargets(s, me), "city");
  }
  return t;
}

const YURT_SCALE = 1.55;
function yurt(x, y, color, city) {
  const dome = (dx, k) => `<path transform="translate(${dx} 0) scale(${k})" d="M-.21,.13 L-.21,-.01 Q0,-.27 .21,-.01 L.21,.13 Z" fill="${color}" stroke="#1b2333" stroke-width=".04"/>`;
  // Аил: большая юрта с орнаментом и флажком, за ней малая юрта.
  const st = `stroke="#1b2333" stroke-width=".035" stroke-linejoin="round"`;
  const ail = `<g transform="translate(.29 .04) scale(.7)">${dome(0, 1)}</g>
    <path d="M-.26,.15 V0 H.26 V.15 Z" fill="${color}" ${st}/>
    <path d="M-.29,.01 Q-.2,-.17 0,-.27 Q.2,-.17 .29,.01 Z" fill="${color}" ${st}/>
    <path d="M-.2,-.07 Q0,-.19 .2,-.07" fill="none" stroke="rgba(255,255,255,.65)" stroke-width=".025"/>
    <path d="M-.26,.055 l.065,-.035 l.065,.035 l.065,-.035 l.065,.035 l.065,-.035 l.065,.035 l.065,-.035 l.065,.035" fill="none" stroke="#fff" stroke-width=".03"/>
    <rect x="-.05" y=".045" width=".1" height=".105" rx=".02" fill="#1b2333"/>
    <line x1="0" y1="-.27" x2="0" y2="-.48" stroke="#1b2333" stroke-width=".03"/><path d="M0,-.48 L.16,-.43 L0,-.38 Z" fill="#f2b53a" stroke="#1b2333" stroke-width=".02"/>`;
  const body = city ? ail : dome(0, 1) + `<path d="M-.05,.13 v-.1 h.1 v.1" fill="#1b2333"/>`;
  return `<g class="bld" transform="translate(${f(x)} ${f(y)}) scale(${YURT_SCALE})">${body}</g>`;
}

function boardSVG(s, me) {
  const T = targets(s, me), G = gOf(s);
  const xs = G.verts.map((v) => v.x), ys = G.verts.map((v) => v.y);
  const x0 = Math.min(...xs) - 1.4, y0 = Math.min(...ys) - 1.15, w = Math.max(...xs) + 1.4 - x0, h = Math.max(...ys) + 1.15 - y0;
  let o = `<svg class="board ${zoom.k > 1 ? "zoomed" : ""}" viewBox="${zoomBox(x0, y0, w, h)}" data-base="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" style="aspect-ratio:${f(w)}/${f(h)}" role="img" aria-label="Игровое поле"><defs>${Object.entries(HEX_GRAD).map(([k, [a, b]]) => `<linearGradient id="g-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join("")}</defs>`;
  const polys = G.hexes.map((_, i) => G.hexVerts[i].map((v) => `${f(G.verts[v].x)},${f(G.verts[v].y)}`).join(" "));
  // Песчаный берег: каждый участок обведён толстой светлой линией, вместе они дают контур острова.
  o += polys.map((pts) => `<polygon points="${pts}" fill="#ecd9a4" stroke="#ecd9a4" stroke-width=".6" stroke-linejoin="round"/>`).join("");
  for (const h of s.harbors) {
    const ed = G.edges[h.e], A = G.verts[ed.a], B = G.verts[ed.b];
    // Стоянка стоит на перпендикуляре к своему берегу, всегда на одном расстоянии от поля.
    const H = G.hexes[ed.hexes[0]], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const nx = mx - H.x, ny = my - H.y, nl = Math.hypot(nx, ny);
    const px = mx + (nx / nl) * 0.72, py = my + (ny / nl) * 0.72;
    const any = h.type === "any", mineH = me >= 0 && (ownerAt(s, ed.a) === me || ownerAt(s, ed.b) === me);
    for (const V of [A, B]) {
      const seg = `x1="${f(V.x)}" y1="${f(V.y)}" x2="${f(px)}" y2="${f(py)}"`;
      o += `<line class="pier-edge" ${seg}/><line class="pier" ${seg}/><line class="pier-seam" ${seg}/>`;
    }
    o += `<g><title>${any ? "Стоянка 3:1: три одинаковых ресурса на один любой" : `Стоянка 2:1: два ресурса «${RES_RU[h.type]}» на один любой`}${mineH ? " — доступна вам" : ""}</title>${mineH ? `<circle class="port-mine" cx="${f(px)}" cy="${f(py)}" r=".47"/>` : ""}<circle cx="${f(px)}" cy="${f(py)}" r=".36" fill="${any ? "#fffaf0" : HEX_FILL[h.type]}" stroke="#fff" stroke-width=".06"/>`;
    o += any
      ? `<text x="${f(px)}" y="${f(py + 0.1)}" text-anchor="middle" font-size=".27" font-weight="900" fill="#2a2418" font-family="Nunito,sans-serif">3:1</text></g>`
      : `<use href="#i-${h.type}" x="${f(px - 0.16)}" y="${f(py - 0.32)}" width=".32" height=".32" fill="#fff"/><text x="${f(px)}" y="${f(py + 0.22)}" text-anchor="middle" font-size=".2" font-weight="900" fill="#fff" font-family="Nunito,sans-serif">2:1</text></g>`;
  }
  // Выпавшие участки вспыхивают, над ними всплывает ресурс; участок под бураном вспыхивает серым — он ничего не даёт.
  const roll = fxOn(fx.roll) ? fx.roll : null;
  let floats = "";
  G.hexes.forEach((h, i) => {
    const b = s.board[i], pts = polys[i];
    o += `<polygon class="hex" points="${pts}" fill="url(#g-${b.res})"><title>${RES_RU[b.res]}${b.num ? ` · выпадает на ${b.num}` : " · ничего не даёт"}</title></polygon>`;
    // Внутренняя тёмная кромка: соседние участки одного цвета не сливаются.
    o += `<polygon class="hex-in" points="${pts}" transform="translate(${f(h.x)} ${f(h.y)}) scale(.9) translate(${f(-h.x)} ${f(-h.y)})"/>`;
    if (roll && b.num === roll.n) {
      o += `<polygon class="hit ${i === s.robber ? "blocked" : ""}" points="${pts}" ${fxDelay(roll)}/>`;
      if (i !== s.robber) floats += `<g class="hit-ic" ${fxDelay(roll)}><g transform="translate(${f(h.x)} ${f(h.y - 0.45)})"><circle r=".32" fill="${HEX_FILL[b.res]}" stroke="#fff" stroke-width=".06"/><use href="#i-${b.res}" x="-.2" y="-.2" width=".4" height=".4" fill="#fff"/></g></g>`;
    }
    if (b.res !== "desert") o += `<use class="hex-ic" href="#i-${b.res}" x="${f(h.x - 0.28)}" y="${f(h.y - 0.84)}" width=".56" height=".56"/>`;
    if (b.num) {
      const red = b.num === 6 || b.num === 8, col = red ? "#c62f22" : "#2a2418", cy = h.y + 0.14;
      o += `<circle cx="${f(h.x)}" cy="${f(cy + 0.04)}" r=".36" fill="rgba(0,0,0,.25)"/><circle cx="${f(h.x)}" cy="${f(cy)}" r=".36" fill="#fbf1d6" stroke="#e2cf9d" stroke-width=".03"/><text x="${f(h.x)}" y="${f(cy + 0.08)}" text-anchor="middle" font-size="${red ? ".34" : ".3"}" font-weight="900" fill="${col}" font-family="Nunito,sans-serif">${b.num}</text>`;
      const n = pips(b.num);
      for (let k = 0; k < n; k++) o += `<circle cx="${f(h.x + (k - (n - 1) / 2) * 0.075)}" cy="${f(cy + 0.2)}" r=".026" fill="${col}"/>`;
    }
    if (i === s.robber) {
      const rx = b.num ? h.x + 0.5 : h.x, ry = b.num ? h.y + 0.4 : h.y;
      o += `<g transform="translate(${f(rx)} ${f(ry)})"><title>Буран</title><circle r=".3" fill="#3a4656" stroke="#fff" stroke-width=".05"/>` +
        [0, 60, 120].map((a) => `<line x1="0" y1="-.19" x2="0" y2=".19" stroke="#fff" stroke-width=".05" stroke-linecap="round" transform="rotate(${a})"/>`).join("") + `</g>`;
    }
    if (T.h.has(i)) o += `<polygon class="tgt-h" data-h="${i}" points="${pts}"/>`;
  });
  for (const k in s.roads) {
    const ed = G.edges[+k], A = G.verts[ed.a], B = G.verts[ed.b], c = s.players[s.roads[k]].color;
    o += `<line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="rgba(0,0,0,.35)" stroke-width=".3" stroke-linecap="round"/><line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="#fff" stroke-width=".24" stroke-linecap="round"/><line x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}" stroke="${c}" stroke-width=".14" stroke-linecap="round"/>`;
  }
  for (const e of T.e) {
    const ed = G.edges[e], A = G.verts[ed.a], B = G.verts[ed.b];
    o += `<line class="tgt-e ${T.soft ? "soft" : ""}" data-e="${e}" x1="${f(A.x + (B.x - A.x) * 0.15)}" y1="${f(A.y + (B.y - A.y) * 0.15)}" x2="${f(B.x - (B.x - A.x) * 0.15)}" y2="${f(B.y - (B.y - A.y) * 0.15)}"/>`;
  }
  for (const k in s.buildings) { const b = s.buildings[k], V = G.verts[+k]; o += yurt(V.x, V.y, s.players[b.p].color, b.city); }
  for (const [v, kind] of T.v) { const V = G.verts[v]; o += `<circle class="tgt-v ${kind} ${T.soft ? "soft" : ""}" data-v="${v}" data-k="${kind}" cx="${f(V.x)}" cy="${f(V.y)}" r="${kind === "city" ? 0.45 : 0.2}"><title>${kind === "city" ? "Улучшить до аила" : "Поставить юрту"}</title></circle>`; }
  return o + floats + "</svg>";
}

const costHTML = (c) => `<span class="cost" aria-label="${resText(c)}">${RES.flatMap((k) => Array(c[k] || 0).fill(`<i class="r-${k}" title="${RES_RU[k]}"></i>`)).join("")}</span>`;
const stepper = (key, obj, max) => `<div class="step">${RES.map((k) => `<div class="sc r-${k}" title="${RES_RU[k]}">${ICON(k)}<b>${obj[k]}</b><span class="pm"><button data-dec="${key}:${k}" aria-label="Меньше: ${RES_RU[k]}" ${obj[k] ? "" : "disabled"}>−</button><button data-inc="${key}:${k}" aria-label="Больше: ${RES_RU[k]}" ${max && obj[k] >= max[k] ? "disabled" : ""}>+</button></span></div>`).join("")}</div>`;
const picker = (key, label, counts, sub) => `<div class="pickrow"><span class="lbl">${label}</span>${RES.map((k) => `<button class="mini r-${k} ${ui[key] === k ? "sel" : ""}" data-pick="${key}:${k}" title="${RES_RU[k]}" aria-pressed="${ui[key] === k}">${ICON(k)}${counts ? `<b>${counts[k]}</b>` : ""}${sub ? sub(k) : ""}</button>`).join("")}</div>`;
const resChip = (k, n = 1) => `<span class="lr r-${k}" title="${RES_RU[k]}${n > 1 ? " × " + n : ""}">${ICON(k)}${n !== 1 ? `<b>${n}</b>` : ""}</span>`;
const resChips = (r) => RES.filter((k) => r[k]).map((k) => resChip(k, r[k])).join("") || '<span class="muted">ничего</span>';
const deal = (l1, give, l2, get) => `<div class="deal"><div><span class="lbl">${l1}</span><span class="chips">${resChips(give)}</span></div><span class="arr" aria-hidden="true">→</span><div><span class="lbl">${l2}</span><span class="chips">${resChips(get)}</span></div></div>`;
// Бросок в журнале — токен «#d3-4»: рисуем два кубика и сумму, строку выделяем; семёрка — красным, это буран.
// Старые записи «бросает 8» без кубиков выделяем так же, только по сумме. С колодой судьбы — «тянет карту #d3-4».
const ROLL_RE = /(бросает|тянет карту) (?:#d(\d)-(\d)|(\d+)$)/;
const logClass = (t) => {
  const m = ROLL_RE.exec(t);
  if (!m) return "";
  return ` class="roll ${(m[4] ? +m[4] : +m[2] + +m[3]) === 7 ? "seven" : ""}"`;
};
const rollHTML = (verb, a, b, n) => verb === "бросает"
  ? `бросает ${a ? die(+a, false) + die(+b, true) : ""}<b class="rsum">${n}</b>`
  : `тянет карту ${fateCard(+a, +b, "mini")}`;
// Карта колоды судьбы: крупная сумма, под ней — какие кубики она заменяет.
// В журнале карта маленькая — только сумма, без кубиков.
const fateCard = (a, b, cls = "", st = "") => `<span class="fcard ${cls} ${a + b === 7 ? "seven" : ""}" ${st} title="Карта судьбы: ${a} + ${b}"><b>${a + b}</b>${cls === "mini" ? "" : `<span class="fd">${die(a, false)}${die(b, true)}</span>`}</span>`;
// В журнале ресурсы приходят токенами «2%wood», украденная карта — «%?id»: её видят только вор и жертва.
const fmtLog = (s, t) => esc(t)
  .replace(ROLL_RE, (_, verb, a, b, n) => rollHTML(verb, a, b, n || +a + +b))
  .replace(/%\?(\d+)/g, (_, id) => (s.steals?.[id]?.r ? resChip(s.steals[id].r) : `<span class="lr r-hidden" title="Карта скрыта">${ICON("card")}</span>`))
  .replace(/(\d+)?%(wood|brick|wool|grain|ore)/g, (_, n, k) => resChip(k, n === undefined ? 1 : +n))
  .replace(/@(\d)/g, (_, i) => (s.players[+i] ? `<b class="who" style="background:${s.players[+i].color};color:${inkOn(s.players[+i].color)}">` : "<b>") + `${esc(nameOf(s, +i))}</b>`);
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const die = (n, red, st = "") => `<span class="die ${red ? "r" : ""}" aria-label="${n}" ${st}>${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ""}></i>`).join("")}</span>`;
const pop = (title, body, closable) => `<div class="panel pop"><div class="pop-h"><b>${title}</b>${closable ? `<button class="x" data-panel="" aria-label="Закрыть">×</button>` : ""}</div>${body}</div>`;
const canSwap = (s, me) => me >= 0 && me === s.cur && s.status === "play" && !s.paused && s.phase === "main" && !s.helperSwapped && swapReady(s, me) && (s.helperPool || []).length > 0;
const devPlayable = (s, me, t) => t !== "vp" && me >= 0 && me === s.cur && s.status === "play" && !s.paused && canPlayDev(s, me, t) && (s.phase === "main" || (t === "knight" && s.phase === "roll"));
const DEV_DESC = {
  knight: "Перегоните буран на любой участок и заберите случайную карту у игрока, чья юрта или аил стоит на его углу. Три сыгранных батыра дают «Сильнейшую дружину» — 2 очка. Можно сыграть и до броска кубиков.",
  vp: "Одно победное очко. Разыгрывать её не нужно: очко засчитывается само, соперники увидят его в конце игры.",
  road: "Проложите две тропы бесплатно, без ресурсов.",
  yop: "Возьмите из запаса два любых ресурса — можно два одинаковых.",
  mono: "Назовите ресурс: все соперники отдают вам все свои карты этого вида.",
};
// Почему карту развития сейчас нельзя сыграть — показываем в описании карты.
function devBlock(s, me, t) {
  if (t === "vp" || me < 0 || s.status !== "play") return "";
  if (s.paused) return "Игра на паузе.";
  if (me !== s.cur) return "Сыграть можно только в свой ход.";
  if (s.devPlayed) return "В этот ход карта развития уже сыграна — можно одну за ход.";
  if (!s.players[me].dev.some((d) => d.t === t && d.turn < s.turnNo)) return "Купленную в этот ход карту можно сыграть со следующего хода.";
  return t === "knight" ? "Сейчас её не сыграть — дождитесь конца текущего действия." : "Сыграть можно после броска кубиков.";
}
function legendHTML() {
  const hex = (r, txt) => `<div class="lg-row"><i class="lg-hex" style="background:${HEX_FILL[r]}"></i><span><b>${RES_RU[r]}</b> — ${txt}</span></div>`;
  const build = (label, cost, txt) => `<div class="lg-row"><span class="chips">${resChips(cost)}</span><span><b>${label}</b> — ${txt}</span></div>`;
  return `<div class="legend">
    <h4>Участки</h4>${RES.map((k) => hex(k, `даёт ${RES_RU[k].toLowerCase()}`)).join("")}${hex("desert", "ничего не даёт, в начале игры здесь стоит буран")}
    <h4>Числа</h4><p>Число на участке — сумма кубиков, при которой он приносит ресурс юртам (1) и аилам (2) на своих углах. Точки под числом — как часто оно выпадает: чем больше точек, тем чаще. Красные 6 и 8 выпадают чаще всего, 2 и 12 — реже всего.</p>
    <h4>Стоянки</h4><p>Причалы на берегу. Если ваша юрта или аил стоит на одном из двух углов у причала, вы меняетесь с запасом выгоднее: <b>3:1</b> — три одинаковых ресурса на один любой, <b>2:1</b> с иконкой — два таких ресурса на один любой. Ваши стоянки обведены золотом, курс виден на картах в руке.</p>
    <h4>Буран</h4><p>Тёмный знак на участке: пока он там, участок ничего не приносит. При броске 7 все, у кого больше 7 карт, сбрасывают половину, а бросивший перегоняет буран и забирает карту у соседа.</p>
    <h4>Постройки</h4>${build("Тропа", COST.road, "всего 15")}${build("Юрта", COST.settle, "1 очко, всего 5")}${build("Аил", COST.city, "2 очка, ставится на место своей юрты (юрта возвращается к вам), всего 4")}${build("Карта развития", COST.dev, "случайная карта из колоды")}
    <h4>Очки</h4><p>Юрта — 1, аил — 2, «Великий путь» (5+ троп подряд) — 2, «Сильнейшая дружина» (3+ батыра) — 2, «Летопись» — 1. Побеждает первый, кто набрал 10 очков в свой ход.</p></div>`;
}

function phaseHint(s, me) {
  const cur = nameOf(s, s.cur), mine = me === s.cur;
  if (s.paused) return "Игра на паузе";
  switch (s.phase) {
    case "setup": return mine ? (s.step === "settle" ? "Поставьте юрту на свободный угол — доступные места подсвечены" : "Проложите тропу от новой юрты") : `${cur} расставляет стартовые юрты`;
    case "roll":
      if (mod(s, "fate")) return mine ? "Тяните карту судьбы! «Батыра» можно сыграть до этого" : `${cur} тянет карту судьбы`;
      return mine ? "Бросьте кубики! «Батыра» можно сыграть до броска" : `${cur} бросает кубики`;
    case "discard": return s.toDiscard[me] ? `Буран: сбросьте ${s.toDiscard[me]} карт` : "Ждём, пока игроки сбросят карты";
    case "robber": return mine ? "Перегоните буран: нажмите на участок поля" : `${cur} перегоняет буран`;
    case "roadbuilding": return mine ? `Караван: осталось бесплатных троп — ${s.freeRoads}` : `${cur} прокладывает тропы каравана`;
    case "main":
      if (mine && ui.mode) return "Выберите место на поле. Повторное нажатие на кнопку отменяет выбор";
      return mine ? "Стройте прямо кликом по полю, меняйтесь и завершите ход" : `${cur} строит и торгует`;
  }
  return "";
}

function renderGame() {
  if (game.game === "nomad") return renderNomad();
  if (game.game === "mukhtar") return renderMukhtar();
  if (game.game === "bunker") return renderBunker();
  if (game.game === "mafia") return renderMafia();
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], live = s.status === "play" && !s.paused, mine = me >= 0 && me === s.cur && live;
  const cur = s.players[s.cur];
  if (ui.panel === "trade" && !(mine && s.phase === "main" && !s.trade)) ui.panel = null;
  if (ui.panel && ui.panel.startsWith("dev:") && !(P && devPlayable(s, me, ui.panel.slice(4)))) ui.panel = null;

  const pops = [];
  if (s.status === "play" && me >= 0 && s.pauseVote) {
    const v = s.pauseVote, needN = Math.floor(s.players.filter((p) => !p.bot).length / 2) + 1, voted = v.yes.includes(me) || v.no.includes(me);
    pops.push(pop(`${esc(nameOf(s, v.by))} предлагает ${v.to ? "поставить паузу" : "продолжить игру"}`, `<p class="hint" style="margin:0">За: ${v.yes.length}, нужно ${needN}</p>${voted ? `<p class="muted" style="margin:0">Вы проголосовали, ждём остальных</p>` : `<div class="row"><button class="btn green" data-pause="1">За</button><button class="btn red" data-pause="0">Против</button></div>`}`));
  }
  if (live && me >= 0) {
    if (s.phase === "discard" && s.toDiscard[me]) {
      pops.push(pop(`Буран! Сбросьте ${s.toDiscard[me]} карт`, `${stepper("disc", ui.disc, P.res)}<button class="btn green" data-a="discard" ${sum(ui.disc) !== s.toDiscard[me] ? "disabled" : ""}>Сбросить (${sum(ui.disc)}/${s.toDiscard[me]})</button>${timerEnd != null ? `<span class="hint">Не успеете — сбросятся случайные карты.</span>` : ""}`));
    }
    if (mine && s.phase === "robber" && ui.robberHex !== null) {
      const vs = victimsOf(s, ui.robberHex, me);
      pops.push(pop("У кого забрать карту?", `<div class="row">${vs.map((o) => `<button class="btn" data-victim="${o}">${ava(nameOf(s, o), s.players[o].color, "sm")}${esc(nameOf(s, o))} · ${cnt(s.players[o])} карт</button>`).join("")}<button class="btn small" data-a="unrobber">Другой участок</button></div>`));
    }
    if (mine && s.trade) {
      pops.push(pop("Ваше предложение", `${deal("Отдаёте", s.trade.give, "Получаете", s.trade.get)}
        <div class="offer">${s.players.map((o, i) => (i === me ? "" : `<div class="pl2">${ava(nameOf(s, i), o.color, "sm")}<span class="nm">${esc(nameOf(s, i))}</span>${s.trade.resp[i] === true ? `<button class="btn small green" data-with="${i}">Обменять</button>` : `<span class="muted">${s.trade.resp[i] === false ? "отказ" : "думает…"}</span>`}</div>`)).join("")}</div>
        <button class="btn small" data-a="cancelOffer">Отменить предложение</button>`));
    }
    if (!mine && s.trade) {
      const r = s.trade.resp[me], can = has(P.res, s.trade.get);
      pops.push(pop(`Предложение от ${esc(nameOf(s, s.cur))}`, `${deal("Вы получаете", s.trade.give, "Вы отдаёте", s.trade.get)}${r === undefined ? `<div class="row"><button class="btn green" data-respond="1" ${can ? "" : "disabled"}>Согласиться</button><button class="btn red" data-respond="0">Отказаться</button>${can ? "" : '<span class="hint">Не хватает ресурсов</span>'}</div>` : `<p class="muted" style="margin:0">${r ? "Вы согласились, ждём решения" : "Вы отказались"}</p>`}`));
    }
    if (ui.panel === "trade") {
      const k = ratio(s, me, ui.bg), bGive = emptyRes(), bGet = emptyRes();
      bGive[ui.bg] = k;
      bGet[ui.bt] = 1;
      const okBank = P.res[ui.bg] >= k && s.bank[ui.bt] > 0 && ui.bg !== ui.bt;
      pops.push(pop("Обмен", `<h4>С запасом</h4>${picker("bg", "Отдаю", P.res, (r) => `<i class="rt">${ratio(s, me, r)}:1</i>`)}${picker("bt", "Получаю", s.bank)}
        <div class="row">${deal("Отдаёте", bGive, "Получаете", bGet)}<button class="btn green small" data-a="bank" ${okBank ? "" : "disabled"}>Обменять</button></div>
        <h4>С игроками — отдаю</h4>${stepper("give", ui.give, P.res)}<h4>Хочу получить</h4>${stepper("get", ui.get)}
        <div class="row">${deal("Отдаёте", ui.give, "Получаете", ui.get)}<button class="btn blue small" data-a="offer" ${sum(ui.give) && sum(ui.get) ? "" : "disabled"}>Предложить всем</button></div>`, true));
    }
    if (ui.panel && ui.panel.startsWith("dev:")) {
      const t = ui.panel.slice(4);
      let extra = "";
      if (t === "yop") extra = picker("yopA", "Первый", null) + picker("yopB", "Второй", null);
      if (t === "mono") extra = picker("mono", "Ресурс", null);
      pops.push(pop(`«${DEV_RU[t]}»`, `<p class="desc">${DEV_DESC[t]}</p>${extra}<div class="row"><button class="btn green" data-dev="${t}">Сыграть карту</button></div>`, true));
    }
  }
  if (ui.panel && ui.panel.startsWith("info:")) {
    const t = ui.panel.slice(5), why = devBlock(s, me, t);
    pops.push(pop(`«${DEV_RU[t]}»`, `<p class="desc">${DEV_DESC[t]}</p>${why ? `<p class="hint" style="margin:0">${why}</p>` : ""}`, true));
  }
  if (ui.panel === "helper" && P && P.helper) {
    const H = HELPERS[P.helper], pool = s.helperPool || [], ok = canSwap(s, me);
    const why = !pool.length ? "Свободных помощников нет — все разобраны." : me !== s.cur ? "Сменить помощника можно в свой ход." : s.phase !== "main" ? "Сменить можно после броска кубиков." : s.helperSwapped ? "В этот ход помощник уже сменён." : !swapReady(s, me) ? "Нового помощника можно взять со следующего своего хода." : "";
    pops.push(pop(`Помощник: ${esc(H.name)}`, `<p class="desc">${esc(H.text)}</p>${pool.length ? `<h4>Свободные помощники</h4><div class="helpers">${pool.map((h) => `<div class="hp"><span><b>${esc(HELPERS[h].name)}</b>${esc(HELPERS[h].text)}</span><button class="btn small green" data-swap="${h}" ${ok ? "" : "disabled"}>Взять</button></div>`).join("")}</div>` : ""}${why ? `<p class="hint" style="margin:0">${why}</p>` : ""}`, true));
  }
  if (ui.panel === "legend") pops.push(pop("Как читать поле", legendHTML(), true));

  let hud;
  if (P) {
    const devCounts = {};
    for (const d of P.dev) devCounts[d.t] = (devCounts[d.t] || 0) + 1;
    const total = sum(P.res), tradeOk = mine && s.phase === "main" && !s.trade, gain = fxOn(fx.gain) ? fx.gain : null;
    const cards = RES.map((k) => {
      const r = ratio(s, me, k), g = gain && gain.d[k];
      const inner = `${ICON(k)}<span class="lb">${RES_RU[k]}</span><span class="n">${P.res[k]}</span>${r < 4 ? `<span class="rt">${r}:1</span>` : ""}${g ? `<span class="plus" ${fxDelay(gain)}>+${g}</span>` : ""}`;
      const cls = `rc r-${k} ${P.res[k] ? "" : "zero"} ${g ? "gain" : ""}`, title = `${RES_RU[k]}: ${P.res[k]} · обмен с запасом ${r}:1${r < 4 ? " (ваша стоянка)" : ""}`;
      return tradeOk && P.res[k]
        ? `<button class="${cls} can" data-tr="${k}" title="${title} — нажмите, чтобы обменять" ${g ? fxDelay(gain) : ""}>${inner}</button>`
        : `<div class="${cls}" title="${title}" ${g ? fxDelay(gain) : ""}>${inner}</div>`;
    }).join("");
    const devs = Object.keys(devCounts).map((t) => {
      const ok = devPlayable(s, me, t), key = (ok ? "dev:" : "info:") + t;
      return `<button class="dc ${ok ? "can" : ""} ${ui.panel === key ? "sel" : ""}" data-panel="${key}" title="${DEV_RU[t]} — ${DEV_HINT[t]}">${ICON("card")}<span class="lb">${DEV_RU[t]}</span><span class="n">${devCounts[t]}</span></button>`;
    }).join("");
    const lim = discardLimit(s, me), over = total > lim;
    const warn = over ? `<span class="warn7" title="При броске 7 у вас сбросится половина карт">${ICON("cards")}${total} карт — на «7» сбросите ${Math.floor(total / 2)}</span>` : "";
    const can = mine && s.phase === "main";
    const pc = countPieces(s, me);
    const ab = (attr, icon, label, ok, extra = "", cls = "", title = label) => `<button class="ab ${cls}" ${attr} ${ok ? "" : "disabled"} title="${esc(title)}">${ICON(icon)}<span class="lb">${label}</span>${extra}</button>`;
    // На кнопках построек — сколько фигур осталось, в подсказке — лимит, цена и почему кнопка недоступна.
    const mode = (m, icon, label, cost, max, used, why) => {
      const n = max - used, ok = can && has(P.res, cost) && n > 0 && !why;
      const reason = n <= 0 ? why || "фигуры закончились" : why || (has(P.res, cost) ? "" : "не хватает ресурсов");
      return ab(`data-mode="${m}"`, icon, label, ok, costHTML(cost) + `<span class="left ${n > 0 ? "" : "none"}">${n}</span>`, ui.mode === m ? "on" : "", `${label}: осталось ${n} из ${max}. Цена: ${resText(cost)}${reason ? `. Сейчас нельзя — ${reason}` : ""}`);
    };
    const acts = [
      ab('data-panel="trade"', "trade", "Обмен", can && !s.trade, "", ui.panel === "trade" ? "on" : ""),
      ab('data-a="buy"', "card", "Карта", can && has(P.res, costOf(s, me, "dev")) && (s.deckCount ?? 0) > 0, costHTML(costOf(s, me, "dev")), "", `Карта развития. Цена: ${resText(costOf(s, me, "dev"))}. В колоде: ${s.deckCount ?? 0}`),
      mode("road", "road", "Тропа", costOf(s, me, "road"), 15, pc.road),
      mode("settle", "yurt", "Юрта", costOf(s, me, "settle"), 5, pc.settle, pc.settle >= 5 ? "все 5 юрт стоят: улучшите юрту до аила, и она вернётся к вам" : ""),
      mode("city", "ail", "Аил", costOf(s, me, "city"), 4, pc.city, pc.city < 4 && !cityTargets(s, me).length ? "аил ставится на место вашей юрты, а свободных юрт на поле нет" : ""),
      mine && s.phase === "roll"
        ? mod(s, "fate") ? ab('data-a="roll"', "fate", "Тянуть карту", true, "", "go pulse", "Тянуть карту из колоды судьбы") : ab('data-a="roll"', "dice", "Бросить кубики", true, "", "go pulse")
        : ab('data-a="end"', "end", "Завершить ход", can && !s.trade, "", "go"),
    ].join("");
    const helper = P.helper && HELPERS[P.helper] ? `<span class="sep"></span><button class="dc helper ${ui.panel === "helper" ? "sel" : ""} ${canSwap(s, me) ? "can" : ""}" data-panel="helper" title="${esc(HELPERS[P.helper].name)} — ${esc(HELPERS[P.helper].text)}">${ICON("users")}<span class="lb">${esc(HELPERS[P.helper].name)}</span></button>` : "";
    hud = `<div class="panel hand ${over ? "over7" : ""}">${warn}${cards}${devs ? `<span class="sep"></span>${devs}` : ""}${helper}</div><div class="panel acts">${acts}</div>`;
  } else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель.</div>`;
  }

  const rollFx = fxOn(fx.roll) ? fx.roll : null, dst = rollFx ? fxDelay(rollFx) : "";
  // С колодой судьбы вместо кубиков — стопка рубашкой вверх (сколько карт осталось) и последняя вытянутая карта.
  const left = s.fateCount ?? s.fate?.length ?? 36;
  const dice = mod(s, "fate")
    ? `<span class="fate ${rollFx ? "fresh" : ""}"><span class="fdeck" title="Колода судьбы — осталось ${left} ${plural(left, "карта", "карты", "карт")}, перетасуется, когда останется 5">${ICON("fate")}<b>${left}</b></span>${s.dice ? fateCard(s.dice[0], s.dice[1], "", dst) : ""}</span>`
    : s.dice ? `<span class="dice ${rollFx ? "fresh" : ""}">${die(s.dice[0], false, dst)}${die(s.dice[1], true, dst)}<span class="dsum">${s.dice[0] + s.dice[1]}</span></span>` : "";
  const timerTitle = s.phase === "roll" ? (mod(s, "fate") ? "Карта вытянется сама, когда время выйдет" : "Кубики бросятся сами, когда время выйдет") : s.phase === "discard" ? "Время на сброс карт — потом сбросятся случайные" : `Время хода; каждое действие добавляет ${TIMER.bonus} с`;
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="${timerTitle}">${ICON("clock")}<b></b></span>` : "";
  const turnExtra = mine && s.phase === "roadbuilding" ? `<button class="btn small" data-a="endRoads">Закончить караван</button>` : "";
  const players = s.players.map((p, i) => `<div class="pl ${i === s.cur && s.status === "play" ? "cur" : ""}" style="--pc:${p.color}">
      ${ava(nameOf(s, i), p.color)}
      <div style="min-width:0"><div class="nm"><span>${esc(nameOf(s, i))}</span>${i === me ? '<span class="badge">вы</span>' : ""}${offTag(s, i)}${p.bot ? `<span class="badge" title="Бот — сложность: ${LEVEL_RU[p.level || "medium"]}">бот · ${LEVEL_RU[p.level || "medium"]}</span>` : ""}${s.phase === "discard" && s.toDiscard[i] ? '<span class="badge gold">сбрасывает</span>' : ""}</div>
        ${p.helper && HELPERS[p.helper] ? `<div class="helperline" title="${esc(HELPERS[p.helper].name)} — ${esc(HELPERS[p.helper].text)}">${ICON("users")}${esc(HELPERS[p.helper].name)}</div>` : ""}
        <div class="pstats"><span class="${cnt(p) > discardLimit(s, i) ? "danger" : ""}" title="Карт ресурсов${cnt(p) > discardLimit(s, i) ? ` — больше ${discardLimit(s, i)}: на «7» сбросит половину` : ""}">${ICON("cards")}${cnt(p)}</span><span title="Карт развития">${ICON("card")}${devCnt(p)}</span>
          <span class="${s.army === i ? "hl" : ""}" title="Сыграно батыров${s.army === i ? " · Сильнейшая дружина" : ""}">${ICON("sword")}${p.knights}</span>
          <span class="${s.longest === i ? "hl" : ""}" title="Длина пути${s.longest === i ? " · Великий путь" : ""}">${ICON("road")}${p.road}</span></div></div>
      <span class="vp" title="Победные очки">${vp(s, i, i === me || s.status === "over")}<small>очк.</small></span></div>`).join("");
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";

  $("view").innerHTML = `<div class="game">
    <div class="stage">
      <div class="panel turn ${mine ? "mine" : ""}" style="--pc:${cur.color}">${ava(nameOf(s, s.cur), cur.color)}
        <div class="txt"><span class="who">${s.status === "over" ? "Игра окончена" : (mine ? "Ваш ход!" : "Ход: " + esc(nameOf(s, s.cur)))}</span><span class="hint">${s.status === "play" ? esc(phaseHint(s, me)) : ""}</span>${turnExtra}</div>${timer}${dice}</div>
      <div class="topr"><span class="chip">Код <span class="code">${esc(s.code)}</span></span>${s.status === "over" && ui.summaryHidden ? `<button class="btn green small" data-a="summary">${ICON("cards")}<span class="tl">Итоги</span></button>` : ""}<button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "legend" ? "on" : ""}" data-panel="legend" title="Как читать поле — легенда">${ICON("help")}<span class="tl">Поле</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту — он будет играть за вас, а вы сможете смотреть и вернуть управление">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox">${boardSVG(s, me)}<div class="zoombar"><button data-zoom="in" aria-label="Приблизить" title="Приблизить">+</button><button data-zoom="out" aria-label="Отдалить" title="Отдалить">−</button><button data-zoom="reset" aria-label="Показать всё поле" title="Показать всё поле">${ICON("fit")}</button></div></div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры и боты стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${mine && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваш ход!</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" && !ui.summaryHidden ? summaryHTML(s, me) : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      <div class="panel"><div class="ph"><h3>Игроки</h3></div><div class="players">${players}</div>
        <div class="bank">Запас: ${RES.map((k) => `<span title="${RES_RU[k]}"><i class="sw r-${k}"></i>${s.bank[k]}</span>`).join("")}<span title="Карт развития">${ICON("card")}${s.deckCount ?? s.deck.length}</span></div></div>
      <div class="panel logp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div${logClass(t)}>${fmtLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
  tickTimer();
  document.title = mine ? "Ваш ход — Жайлоо" : "Жайлоо";
}

// --- итоги партии ---
const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };
function summaryHTML(s, me) {
  const rows = results(s), W = s.players[s.winner];
  // Место, отданное боту, всё равно ваше: подсвечиваем его и показываем изменение рейтинга.
  if (me < 0) me = s.players.findIndex((p) => p.was === myId);
  const nm = (i) => { const p = s.players[i]; return (p.was && s.names?.[p.was]) || nameOf(s, i); };
  const st = (r) => r.st || {};
  const prodSum = (r) => sum(st(r).prod || emptyRes());
  // Номинации: у кого больше всего — показываем, только если это число больше нуля и лидер один.
  const award = (title, icon, val, unit) => {
    const max = Math.max(...rows.map(val));
    const top = rows.filter((r) => val(r) === max);
    return max > 0 && top.length === 1 ? `<div class="award">${ICON(icon)}<span><b>${title}</b>${esc(nm(top[0].i))} · ${max} ${unit}</span></div>` : "";
  };
  const awards = [
    award("Богатый урожай", "grain", prodSum, "карт с кубиков"),
    award("Купец", "trade", (r) => (st(r).trades || 0) + (st(r).bank || 0), "обменов"),
    award("Барымта", "sword", (r) => st(r).steal || 0, "карт отнял"),
    award("Не повезло", "cards", (r) => (st(r).robbed || 0) + (st(r).disc || 0), "карт потерял"),
  ].join("");
  const vpParts = (r) => [
    r.settle && `${ICON("yurt")}${r.settle}`, r.city && `${ICON("ail")}${r.city}×2`,
    r.longest && `<span title="Великий путь">${ICON("road")}+2</span>`, r.army && `<span title="Сильнейшая дружина">${ICON("sword")}+2</span>`,
    r.chron && `<span title="Летопись">${ICON("book")}${r.chron}</span>`,
  ].filter(Boolean).map((x) => `<span class="vpp">${x}</span>`).join("");
  const rating = (r) => {
    const x = s.ratings?.[r.i];
    if (!x) return `<span class="muted" title="Рейтинг считается только у игроков с аккаунтом">—</span>`;
    return `${x.before + x.delta} <b class="${x.delta >= 0 ? "up" : "down"}">${x.delta >= 0 ? "+" : ""}${x.delta}</b>`;
  };
  const table = `<div class="tablewrap"><table class="sumtable"><thead><tr><th>Место</th><th>Игрок</th><th>Очки</th><th title="Ресурсы, пришедшие с кубиков">Урожай</th><th title="С игроками / с запасом">Обмены</th><th title="Куплено / сыграно карт развития">Развитие</th><th title="Отнял / потерял / сбросил на буране">Буран</th><th>Рейтинг</th></tr></thead><tbody>
    ${rows.map((r) => { const p = s.players[r.i], t = st(r); return `<tr class="${r.i === me ? "mine" : ""}">
      <td class="pl-n">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</td>
      <td><span class="who2">${ava(nm(r.i), p.color, "sm")}<span>${esc(nm(r.i))}${p.bot && !p.was ? `<small>бот · ${LEVEL_RU[p.level || "medium"]}</small>` : p.was ? "<small>доигрывал бот</small>" : ""}${p.helper && HELPERS[p.helper] ? `<small title="${esc(HELPERS[p.helper].text)}">помощник: ${esc(HELPERS[p.helper].name)}</small>` : ""}</span></span></td>
      <td><b class="bigvp">${r.vp}</b><span class="vps">${vpParts(r)}</span></td>
      <td><b>${prodSum(r)}</b>${t.prod ? `<span class="chips">${resChips(t.prod)}</span>` : ""}</td>
      <td class="tn">${t.trades ?? "—"} / ${t.bank ?? "—"}</td>
      <td class="tn">${t.bought ?? "—"} / ${t.played ?? "—"}</td>
      <td class="tn">${t.steal ?? "—"} / ${t.robbed ?? "—"} / ${t.disc ?? "—"}</td>
      <td class="tn">${rating(r)}</td></tr>`; }).join("")}
  </tbody></table></div>`;
  let dice = "";
  if (s.rolls) {
    const max = Math.max(1, ...s.rolls.slice(2)), total = s.rolls.reduce((a, b) => a + b, 0);
    dice = `<h4>${mod(s, "fate") ? `Колода судьбы · ${total} ${plural(total, "карта", "карты", "карт")}` : `Кубики · ${total} ${plural(total, "бросок", "броска", "бросков")}`}</h4><div class="dicebars" role="img" aria-label="Сколько раз выпало каждое число">${s.rolls.slice(2).map((c, k) => `<div class="db ${k + 2 === 7 ? "seven" : ""}" title="${k + 2} — выпало ${c} раз"><span class="c">${c}</span><i style="height:${Math.round((c / max) * 100)}%"></i><span class="n">${k + 2}</span></div>`).join("")}</div>`;
  }
  const info = [s.turnNo && `${s.turnNo} ${plural(s.turnNo, "ход", "хода", "ходов")}`, s.startedAt && s.endedAt && fmtDur(s.endedAt - s.startedAt), BOARD[s.size]?.name && `${BOARD[s.size].name.toLowerCase()} карта`, ...Object.keys(MODS).filter((k) => mod(s, k)).map((k) => MODS[k].name)].filter(Boolean).join(" · ");
  const my = me >= 0 && s.ratings?.[me];
  return `<div class="over sum"><div class="panel">
    <div class="sum-h">${ava(nm(s.winner), W.color)}<div><span class="w">${s.winner === me ? "Вы победили!" : `${esc(nm(s.winner))} побеждает!`}</span><span class="muted">${info}</span></div></div>
    ${my ? `<p class="myrate">Ваш рейтинг: <b>${my.before + my.delta}</b> <b class="${my.delta >= 0 ? "up" : "down"}">${my.delta >= 0 ? "+" : ""}${my.delta}</b></p>` : me >= 0 && !account ? `<p class="hint">Партия не попала в рейтинг: <button class="link" data-a="authopen">войдите или зарегистрируйтесь</button>, чтобы следующие считались.</p>` : ""}
    ${table}
    ${awards ? `<div class="awards">${awards}</div>` : ""}
    ${dice}
    <div class="row"><button class="btn green" data-a="back">К списку партий</button>${rematchBtn(s)}<button class="btn" data-a="hidesummary">Посмотреть поле</button></div>
  </div></div>`;
}

function openGame(code) {
  code = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return toast("Код игры — 5 букв и цифр");
  currentCode = code;
  game = null;
  ui.mode = null;
  ui.panel = null;
  ui.robberHex = null;
  ui.summaryHidden = false;
  ui.chatOpen = false;
  ui.chatSeen = 0;
  chatLog = [];
  send({ t: "open", code });
}
// Последнее состояние партии держим в sessionStorage вкладки: после перезагрузки сразу рисуем игру,
// не дожидаясь сервера, а живое состояние приходит следом и заменяет его.
function cacheGame(g) { try { sessionStorage.setItem("zh.cache", JSON.stringify(g)); } catch {} }
function cachedGame(code) {
  try { const g = JSON.parse(sessionStorage.getItem("zh.cache")); return g && g.code === code ? g : null; } catch { return null; }
}
// Кэша нет (новая вкладка) — вместо главной показываем заглушку, пока сервер не ответит.
function renderLoading() {
  document.body.classList.add("ingame");
  $("view").innerHTML = `<div class="loading"><div class="panel">${ICON("logo")}<span>Открываем партию <b class="code">${esc(currentCode)}</b>…</span></div></div>`;
}
function closeGame() {
  if (currentCode) send({ t: "close" });
  store.set("zh.game", "");
  cacheGame(null);
  game = null;
  currentCode = null;
  ui.panel = null;
  chatLog = [];
  history.replaceState(null, "", location.pathname);
  render();
}
function saveName() {
  const v = ($("myname")?.value || "").trim().slice(0, 24);
  if (!v) return toast("Имя не может быть пустым");
  ui.nameDraft = null;
  if (v !== myName && game) toast("Имя сохранено");
  myName = v;
  store.set("zh.name", v);
  send({ t: "rename", name: v });
  render();
}
// Перед созданием партии берём имя из поля: без имени играть нельзя.
function ensureName() {
  const input = $("myname");
  const v = (input?.value || "").trim();
  if (!v) { toast("Сначала укажите имя — его увидят другие игроки"); input?.focus(); return false; }
  if (v !== myName) saveName();
  return true;
}

// --- подсказки ---
// Вместо системных title — своя подсказка в стиле игры. Текст «Заголовок — описание» делится на жирный заголовок и текст.
// title переносим в data-tip, чтобы браузер не показывал свою; у SVG берём дочерний <title>.
let tipEl = null, tipSrc = null;
function tipSource(node) {
  for (let n = node; n && n !== document.body; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    if (n.dataset?.tip) return n;
    if (n.getAttribute("title")) { n.dataset.tip = n.getAttribute("title"); n.removeAttribute("title"); return n; }
    const t = n.namespaceURI === "http://www.w3.org/2000/svg" && [...n.children].find((c) => c.tagName === "title");
    if (t) { n.dataset.tip = t.textContent; t.remove(); return n; }
  }
  return null;
}
function hideTip() { if (tipEl) tipEl.hidden = true; tipSrc = null; }
function showTip(src) {
  if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.setAttribute("role", "tooltip"); document.body.append(tipEl); }
  const text = src.dataset.tip, i = text.indexOf(" — ");
  tipEl.innerHTML = i > 0 && i < 40 ? `<b>${esc(text.slice(0, i))}</b>${esc(text.slice(i + 3))}` : esc(text);
  tipEl.hidden = false;
  tipSrc = src;
  const r = src.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  const above = r.top - t.height - 10 > 0;
  tipEl.classList.toggle("below", !above);
  const x = Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${above ? r.top - t.height - 10 : r.bottom + 10}px`;
  tipEl.style.setProperty("--ax", `${r.left + r.width / 2 - x}px`);
}
// Игра перерисовывает экран на каждое обновление, и элемент под подсказкой заменяется новым.
// Тогда переносим подсказку на то, что теперь под курсором, — она держится, пока курсор не уйдёт.
let mouseAt = null;
function retip() {
  if (!tipSrc || tipSrc.isConnected) return;
  const el = mouseAt && document.elementFromPoint(mouseAt.x, mouseAt.y), src = el && tipSource(el);
  if (src) showTip(src);
  else hideTip();
}
document.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse") mouseAt = { x: ev.clientX, y: ev.clientY }; });
document.addEventListener("pointerover", (ev) => {
  if (ev.pointerType !== "mouse" || drag) return;
  mouseAt = { x: ev.clientX, y: ev.clientY };
  const src = tipSource(ev.target);
  if (!src) return hideTip();
  if (src !== tipSrc) showTip(src);
});
document.addEventListener("pointerout", (ev) => {
  // Уход на другой элемент разберёт pointerover; здесь прячем только при уходе из окна или в пустоту без подсказки.
  if (ev.pointerType !== "mouse" || !tipSrc) return;
  if (!ev.relatedTarget) { if (ev.target.isConnected) hideTip(); return; }
  if (!tipSource(ev.relatedTarget)) hideTip();
});
document.addEventListener("pointerdown", hideTip);
document.addEventListener("scroll", hideTip, true);

// --- масштаб и перетаскивание поля ---
// Масштаб хранится как множитель k и сдвиг центра (cx, cy) в единицах поля; меняем только viewBox, поэтому всё остаётся чётким.
const ZOOM_MAX = 3.5;
const zoom = (() => { try { const z = JSON.parse(store.get("zh.zoom")); if (z && z.k >= 1) return z; } catch {} return { k: 1, cx: 0, cy: 0 }; })();
function zoomBox(x0, y0, w, h) {
  const vw = w / zoom.k, vh = h / zoom.k;
  return `${f(x0 + w / 2 + zoom.cx - vw / 2)} ${f(y0 + h / 2 + zoom.cy - vh / 2)} ${f(vw)} ${f(vh)}`;
}
function applyZoom(save = true) {
  const svg = document.querySelector("svg.board");
  if (!svg) return;
  const [x0, y0, w, h] = svg.dataset.base.split(" ").map(Number);
  zoom.k = Math.min(ZOOM_MAX, Math.max(1, zoom.k));
  // Центр не уходит дальше края поля: хоть кусок карты всегда на экране.
  const mx = (w / 2) * (1 - 1 / zoom.k), my = (h / 2) * (1 - 1 / zoom.k);
  zoom.cx = Math.min(mx, Math.max(-mx, zoom.cx));
  zoom.cy = Math.min(my, Math.max(-my, zoom.cy));
  svg.setAttribute("viewBox", zoomBox(x0, y0, w, h));
  svg.classList.toggle("zoomed", zoom.k > 1);
  if (save) store.set("zh.zoom", JSON.stringify(zoom));
}
// Точка p (в единицах поля) остаётся под курсором: c' = p + (c − p)·k/k'.
function zoomAt(svg, k2, px, py) {
  const [x0, y0, w, h] = svg.dataset.base.split(" ").map(Number);
  const r = svg.getBoundingClientRect(), vw = w / zoom.k, vh = h / zoom.k, u = Math.max(vw / r.width, vh / r.height);
  const cx = x0 + w / 2 + zoom.cx, cy = y0 + h / 2 + zoom.cy;
  const p = px == null ? [cx, cy] : [cx + (px - r.left - r.width / 2) * u, cy + (py - r.top - r.height / 2) * u];
  k2 = Math.min(ZOOM_MAX, Math.max(1, k2));
  const q = zoom.k / k2;
  zoom.cx = p[0] + (cx - p[0]) * q - x0 - w / 2;
  zoom.cy = p[1] + (cy - p[1]) * q - y0 - h / 2;
  zoom.k = k2;
  applyZoom();
}
document.addEventListener("wheel", (ev) => {
  const svg = ev.target.closest?.("svg.board");
  if (!svg) return;
  ev.preventDefault();
  zoomAt(svg, zoom.k * Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY);
}, { passive: false });
// Перетаскивание одним пальцем или мышью, щипок двумя пальцами. После перетаскивания клик по полю не срабатывает.
const ptrs = new Map();
let drag = null, dragged = false;
document.addEventListener("pointerdown", (ev) => {
  const svg = ev.target.closest?.("svg.board");
  if (!svg || (ev.pointerType === "mouse" && ev.button !== 0)) return;
  ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  dragged = false;
  drag = { svg, x: ev.clientX, y: ev.clientY, cx: zoom.cx, cy: zoom.cy, k: zoom.k, dist: null };
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag.dist = Math.hypot(a.x - b.x, a.y - b.y); drag.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
});
document.addEventListener("pointermove", (ev) => {
  if (!drag || !ptrs.has(ev.pointerId)) return;
  ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (ptrs.size === 2 && drag.dist) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    dragged = true;
    zoomAt(drag.svg, drag.k * (d / drag.dist), drag.mid[0], drag.mid[1]);
    drag.k = zoom.k;
    drag.dist = d;
    return;
  }
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) < 6) return;
  if (zoom.k <= 1) return;
  dragged = true;
  const [, , w, h] = drag.svg.dataset.base.split(" ").map(Number), r = drag.svg.getBoundingClientRect();
  const u = Math.max(w / zoom.k / r.width, h / zoom.k / r.height);
  zoom.cx = drag.cx - dx * u;
  zoom.cy = drag.cy - dy * u;
  applyZoom(false);
});
const endPtr = (ev) => {
  ptrs.delete(ev.pointerId);
  if (!ptrs.size && drag) { drag = null; applyZoom(); }
};
document.addEventListener("pointerup", endPtr);
document.addEventListener("pointercancel", endPtr);
document.addEventListener("click", (ev) => {
  if (dragged && ev.target.closest?.("svg.board")) { ev.stopImmediatePropagation(); ev.preventDefault(); dragged = false; }
}, true);

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button,[data-v],[data-e],[data-h]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = game;
  if (d.a === "home") { if (game) closeGame(); return window.scrollTo({ top: 0, behavior: "smooth" }); }
  if (d.scroll) {
    if (game) closeGame();
    return $("sec-" + d.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (d.a === "rename") return saveName();
  if (d.a === "authopen") { ui.auth = "login"; ui.authError = null; render(); return $("au-login")?.focus(); }
  if (d.a === "authclose") { ui.auth = null; return render(); }
  if (d.authtab) { ui.auth = d.authtab; ui.authError = null; return render(); }
  if (d.a === "authsubmit") return submitAuth();
  if (d.a === "logout") {
    if (!confirm("Выйти из аккаунта? В этом браузере вы снова станете гостем.")) return;
    return send({ t: "logout", token });
  }
  if (d.a === "summary") { ui.summaryHidden = false; return render(); }
  if (d.a === "hidesummary") { ui.summaryHidden = true; return render(); }
  if (d.a === "theme") return setTheme(theme() === "dark" ? "light" : "dark", true);
  if (d.gk) { ui.gk = d.gk; store.set("zh.gk", d.gk); return render(); }
  if (d.setgame) return act({ type: "setGame", game: d.setgame });
  if (d.btalk !== undefined) return act({ type: "setTalk", seconds: +d.btalk });
  if (d.a === "chatsend") return sendChat();
  if (d.chatch) { ui.chatCh = d.chatch; render(); return $("chatin")?.focus(); }
  if (d.a === "sound") { store.set("zh.sound", soundOn() ? "off" : "on"); if (soundOn()) sfx("pop"); return render(); }
  if (d.a === "emotes") { ui.emoteOpen = !ui.emoteOpen; return render(); }
  if (d.emote) { ui.emoteOpen = false; send({ t: "emote", e: d.emote }); return render(); }
  if (d.a === "chattoggle") {
    ui.chatOpen = !ui.chatOpen;
    ui.chatSeen = Math.max(ui.chatSeen || 0, ...chatLog.map((m) => m.n));
    render();
    return ui.chatOpen && $("chatin")?.focus();
  }
  if (d.a === "rematch") return send({ t: "rematch" });
  if (d.target !== undefined) return act({ type: "setTarget", target: +d.target });
  if (d.mhead !== undefined) return act({ type: "setHead", head: +d.mhead });
  if (d.a === "create") { if (game || ensureName()) send({ t: "create", game: ui.gk }); return; }
  if (d.a === "quick") {
    if (!ensureName()) return;
    ui.quick = true;
    ui.quickSent = 0;
    return send({ t: "create", game: ui.gk });
  }
  if (d.a === "joincode") return openGame($("joincode").value || "");
  if (d.open) return openGame(d.open);
  if (d.a === "back") return closeGame();
  if (d.copy) {
    try { await navigator.clipboard.writeText(d.copy); toast("Ссылка скопирована"); }
    catch { el.previousElementSibling?.select(); }
    return;
  }
  if (d.kick !== undefined) return act({ type: "kick", i: +d.kick });
  if (d.del) {
    if (confirm(`Удалить игру ${d.del}? Партия исчезнет у всех игроков, вернуть её нельзя.`)) send({ t: "delete", code: d.del });
    return;
  }
  if (d.mod) return act({ type: "setMod", mod: d.mod, on: !mod(s, d.mod) });
  if (d.swap) { ui.panel = null; return act({ type: "swapHelper", h: d.swap }); }
  if (d.map) return act({ type: "setMap", size: d.map === "auto" ? "auto" : +d.map });
  if (d.zoom) {
    const svg = document.querySelector("svg.board");
    if (d.zoom === "reset") { zoom.k = 1; zoom.cx = 0; zoom.cy = 0; return applyZoom(); }
    return svg && zoomAt(svg, zoom.k * (d.zoom === "in" ? 1.4 : 1 / 1.4));
  }
  if (d.lvl) { const [i, level] = d.lvl.split(":"); return act({ type: "setBotLevel", i: +i, level }); }
  if (d.a === "abandon") {
    if (!confirm("Отдать место боту? Он продолжит игру вашими картами и постройками, а вы сможете смотреть партию и в любой момент вернуть управление.")) return;
    return act({ type: "abandon" });
  }
  if (d.a === "reclaim") return act({ type: "reclaim" });
  if (d.timer !== undefined) return act({ type: "setTimer", seconds: +d.timer });
  if (d.pause !== undefined) return act({ type: "pause", yes: d.pause === "1" });
  if (d.tr) {
    // Клик по своей карте ресурса — сразу обмен этим ресурсом.
    ui.panel = "trade";
    ui.bg = d.tr;
    if (ui.bt === d.tr) ui.bt = RES.find((k) => k !== d.tr);
    ui.give = emptyRes();
    ui.give[d.tr] = 1;
    return render();
  }
  if (d.inc || d.dec) {
    const [key, k] = (d.inc || d.dec).split(":");
    ui[key][k] = Math.max(0, ui[key][k] + (d.inc ? 1 : -1));
    return render();
  }
  if (d.pick) { const [key, k] = d.pick.split(":"); ui[key] = k; return render(); }
  if (d.nrtab) { ui.nrTab = d.nrtab; return render(); }
  if (d.panel !== undefined) { ui.panel = d.panel && ui.panel !== d.panel ? d.panel : null; return render(); }
  if (d.mode) { ui.mode = ui.mode === d.mode ? null : d.mode; return render(); }
  if (d.v !== undefined) {
    const v = +d.v;
    return act({ type: d.k === "city" ? "city" : "settle", v });
  }
  if (d.e !== undefined) return act({ type: "road", e: +d.e });
  if (d.h !== undefined) {
    const h = +d.h, vs = victimsOf(s, h, myIndex());
    if (vs.length > 1) { ui.robberHex = h; return render(); }
    return act({ type: "robber", hex: h, victim: vs[0] });
  }
  if (d.victim !== undefined) return act({ type: "robber", hex: ui.robberHex, victim: +d.victim });
  if (d.a === "unrobber") { ui.robberHex = null; return render(); }
  if (d.dev) {
    const a = { type: "dev", card: d.dev };
    if (d.dev === "yop") { a.a = ui.yopA; a.b = ui.yopB; }
    if (d.dev === "mono") a.res = ui.mono;
    ui.panel = null;
    return act(a);
  }
  if (d.respond !== undefined) return act({ type: "respond", accept: d.respond === "1" });
  if (d.with !== undefined) return act({ type: "accept", with: +d.with });
  if (d.a === "discard") { const sel = { ...ui.disc }; ui.disc = emptyRes(); return act({ type: "discard", sel }); }
  if (d.a === "offer") { const a = { type: "offer", give: { ...ui.give }, get: { ...ui.get } }; ui.give = emptyRes(); ui.get = emptyRes(); return act(a); }
  if (d.a === "bank") return act({ type: "bank", give: ui.bg, get: ui.bt });
  if (d.a === "leave") { act({ type: "leave" }); return closeGame(); }
  if (d.a) return act({ type: d.a });
});
// Несохранённое имя переживает перерисовку, даже если фокус ушёл на другую кнопку.
// Клик по затемнению вокруг окна входа закрывает его.
document.addEventListener("click", (ev) => { if (ev.target.id === "modal") { ui.auth = null; render(); } });
const AUTH_FIELDS = { "au-login": "login", "au-pass": "password", "au-name": "name" };
document.addEventListener("input", (ev) => {
  if (ev.target.id === "myname") ui.nameDraft = ev.target.value;
  if (AUTH_FIELDS[ev.target.id]) ui.authForm[AUTH_FIELDS[ev.target.id]] = ev.target.value;
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && ui.auth) { ui.auth = null; return render(); }
  if (ev.key === "Escape" && (ui.emoteOpen || ui.chatOpen)) { ui.emoteOpen = false; ui.chatOpen = false; return render(); }
  if (ev.key !== "Enter") return;
  if (AUTH_FIELDS[ev.target.id]) return submitAuth();
  if (ev.target.id === "chatin") return sendChat();
  if (ev.target.id === "joincode") openGame(ev.target.value);
  if (ev.target.id === "myname") saveName();
});

// Ссылку на партию вставили в уже открытую вкладку — меняется только #КОД, страница не перезагружается.
window.addEventListener("hashchange", () => {
  const code = location.hash.slice(1).toUpperCase();
  if (/^[A-Z0-9]{4,6}$/.test(code) && code !== currentCode) openGame(code);
});

// Сессия: без кода в адресе возвращаемся в партию, открытую в прошлый раз.
if (/^#[A-Z0-9]{4,6}$/i.test(location.hash)) currentCode = location.hash.slice(1).toUpperCase();
else if (/^[A-Z0-9]{4,6}$/.test(store.get("zh.game") || "")) currentCode = store.get("zh.game");
if (currentCode) {
  game = cachedGame(currentCode);
  // Время в кэше устарело — таймер покажем, когда придёт живое состояние.
  if (game) game.timeLeft = null;
}
render();
connect();
