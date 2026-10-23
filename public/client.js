const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let myId = store.get("zh.id");
if (!myId) {
  myId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9-]/g, "");
  store.set("zh.id", myId);
}
let myName = store.get("zh.name") || "";

let ws = null, connected = false, retry = 0;
let games = [], game = null, currentCode = null;
let ui = { mode: null, panel: null, robberHex: null, disc: emptyRes(), give: emptyRes(), get: emptyRes(), bg: "wood", bt: "brick", yopA: "wood", yopB: "ore", mono: "grain", quick: false, quickSent: 0 };
let toastTimer = null;
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
    ws.send(JSON.stringify({ t: "hello", id: myId, name: myName }));
    if (currentCode) ws.send(JSON.stringify({ t: "open", code: currentCode }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "games") { games = m.games; if (!game) render(); }
    else if (m.t === "opened") { currentCode = m.code; store.set("zh.game", m.code); if (location.hash !== "#" + m.code) history.replaceState(null, "", "#" + m.code); }
    else if (m.t === "state") {
      if (m.game.code !== currentCode) return;
      const old = game && game.code === m.game.code ? game : null;
      game = m.game;
      cacheGame(game);
      timerEnd = game.timeLeft != null ? Date.now() + game.timeLeft : null;
      noticeChanges(old, game);
      if (game.phase !== "discard") ui.disc = emptyRes();
      if (game.phase !== "main" || game.cur !== myIndex()) ui.mode = null;
      if (game.cur !== myIndex()) ui.panel = null;
      if (game.phase !== "robber") ui.robberHex = null;
      quickStep();
      render();
    }
    else if (m.t === "closed") { if (m.code === currentCode) { toast("Партия удалена"); closeGame(); } }
    else if (m.t === "error") {
      ui.quick = false;
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
const victimsOf = (s, h, me) => [...new Set(gOf(s).hexVerts[h].map((v) => ownerAt(s, v)).filter((o) => o >= 0 && o !== me && cnt(s.players[o]) > 0))];

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
  renderView();
  if (keep && $(keep.id)) {
    const el = $(keep.id);
    el.value = keep.v;
    el.focus();
    try { el.setSelectionRange(keep.s, keep.e); } catch {}
  }
}
function renderView() {
  const me = $("me");
  me.innerHTML = myName ? `${ava(myName, "#f2b53a", "sm")}<span>${esc(myName)}</span>` : "";
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

function renderLobby() {
  document.title = "Жайлоо";
  document.body.classList.remove("ingame");
  const isMine = (g) => g.host === myId || g.players.some((p) => p.id === myId);
  const open = games.filter((g) => g.status === "lobby" && !isMine(g));
  const playing = games.filter((g) => g.status === "play");
  const mine = games.filter(isMine);
  const row = (g, label, cls) => `<div class="room"><span class="code">${esc(g.code)}</span>
    <span class="avatars">${g.players.map((p, i) => ava(p.name, COLORS[i], "sm")).join("")}</span>
    <span class="names">${g.status === "lobby" ? '<span class="badge">ждёт игроков</span> ' : ""}${g.players.map((p) => esc(p.name)).join(", ")}</span>
    <span class="seats">${g.players.length}/${MAX_PLAYERS}</span>
    <span class="row"><button class="btn small ${cls}" data-open="${esc(g.code)}">${label}</button>${g.host === myId ? delBtn(g.code, true) : ""}</span></div>`;
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
        <h1>Юрты, тропы и буран на <em>горных пастбищах</em></h1>
        <p class="lead">Бесплатная онлайн-настолка для 2–8 игроков. Зовите друзей по ссылке или играйте против ботов прямо в браузере.</p>
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
    <section class="sec" id="sec-rules">
      <h2>Как играть</h2>
      <div class="steps">${steps.map((t, i) => `<div class="panel"><span class="num">${i + 1}</span><span>${t}</span></div>`).join("")}</div>
      <div class="costs">${costs.map(([ic, n, c]) => `<div class="panel">${ICON(ic)}<span><b>${n}</b>${costHTML(c)}</span></div>`).join("")}</div>
    </section>
    <p class="foot">Жайлоо — игра для своих. Аккаунты не нужны: вас узнают по этому браузеру.</p>`;
}

const THUMB_FILL = ["var(--wood)", "var(--grain)", "var(--wool)", "var(--brick)", "var(--ore)"];
function mapThumb(R) {
  const G = gOf({ size: R }), ext = Math.max(...G.verts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y)))) + 0.3;
  return `<svg class="thumb" viewBox="${f(-ext)} ${f(-ext)} ${f(2 * ext)} ${f(2 * ext)}" aria-hidden="true">${G.hexes.map((_, i) => `<polygon points="${G.hexVerts[i].map((v) => `${f(G.verts[v].x)},${f(G.verts[v].y)}`).join(" ")}" style="fill:${THUMB_FILL[i % 5]}" stroke="#fbf6e9" stroke-width=".18"/>`).join("")}</svg>`;
}

function renderRoom() {
  const s = game, me = myIndex(), host = s.host === myId;
  const R = mapRadius(s), cfg = BOARD[R], tooMany = s.players.length > cfg.maxPlayers;
  const autoR = mapRadius({ players: s.players });
  const maps = MAP_SIZES.map((k) => {
    const sel = (s.mapSize || "auto") === k, r = k === "auto" ? autoR : k;
    const sub = k === "auto" ? `сейчас ${BOARD[autoR].name.toLowerCase()}` : `${gOf({ size: k }).hexes.length} участков · до ${BOARD[k].maxPlayers}`;
    return `<button class="mapopt ${sel ? "on" : ""}" data-map="${k}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${mapThumb(r)}<b>${k === "auto" ? "Авто" : BOARD[k].name}</b><span>${sub}</span></button>`;
  }).join("");
  const timers = TURN_TIMES.map((t) => {
    const sel = (s.turnTime ?? 0) === t;
    return `<button class="topt ${sel ? "on" : ""}" data-timer="${t}" aria-pressed="${sel}" ${host ? "" : "disabled"}>${t ? (t < 120 ? `${t} с` : `${t / 60} мин`) : "Без таймера"}</button>`;
  }).join("");
  document.title = `Игра ${s.code} — Жайлоо`;
  document.body.classList.remove("ingame");
  const link = `${location.origin}${location.pathname}#${s.code}`;
  // Сложность бота: три кнопки-ступеньки, видны только создателю.
  const levelPick = (i, cur) => `<span class="lvl" role="group" aria-label="Сложность бота">${LEVELS.map((l) => `<button class="${l === cur ? "on" : ""}" data-lvl="${i}:${l}" aria-pressed="${l === cur}" title="Сложность — ${LEVEL_RU[l]}">${LEVEL_RU[l][0].toUpperCase()}${LEVEL_RU[l].slice(1)}</button>`).join("")}</span>`;
  const slots = [...Array(MAX_PLAYERS).keys()].map((i) => {
    const p = s.players[i];
    if (!p) return `<div class="slot free"><span class="ava ghost">+</span><span class="nm muted">Свободное место</span>${host ? `<button class="btn small" data-a="addBot">${ICON("bot")}Бот</button>` : ""}</div>`;
    return `<div class="slot">${ava(nameOf(s, i), COLORS[i])}<span class="nm">${esc(nameOf(s, i))}${p.bot && !host ? ` <span class="badge">бот · ${LEVEL_RU[p.level || "medium"]}</span>` : p.bot ? ' <span class="badge">бот</span>' : ""}${p.id === s.host ? ' <span class="badge gold">создатель</span>' : ""}${p.id === myId ? ' <span class="badge">вы</span>' : ""}</span>${host && p.bot ? levelPick(i, p.level || "medium") : ""}${host && p.id !== myId ? `<button class="btn small red" data-kick="${i}">Убрать</button>` : ""}</div>`;
  }).join("");
  $("view").innerHTML = `<div class="roomgrid">
    <div class="panel pad"><h2>Игроки <span class="muted">${s.players.length}/${MAX_PLAYERS}</span></h2><div class="slots">${slots}</div>
      ${host ? "" : `<p class="hint">Игру начинает создатель комнаты.</p>`}
      <h3><label for="myname">Ваше имя</label></h3>
      <div class="namerow"><input id="myname" maxlength="24" value="${esc(ui.nameDraft ?? myName)}" placeholder="Например, Айгуль"><button class="btn" data-a="rename">Сохранить</button></div></div>
    <div class="panel pad"><h3>Код комнаты</h3><span class="bigcode">${esc(s.code)}</span>
      <h3>Пригласить друзей</h3>
      <div class="linkrow"><input readonly value="${esc(link)}" aria-label="Ссылка на игру"><button class="btn" data-copy="${esc(link)}">Копировать</button></div>
      <p class="hint">До ${MAX_PLAYERS} игроков; пустые места можно отдать ботам.</p>
      <h3>Размер карты</h3>
      <div class="maps">${maps}</div>
      <h3>Таймер хода</h3>
      <div class="topts">${timers}</div>
      <p class="hint">${host ? "" : "Карту и таймер выбирает создатель комнаты. "}Кубики бросаются сами через ${TIMER.roll} с. С таймером на сброс карт даётся ${TIMER.discard} с, каждое действие в ход добавляет ${TIMER.bonus} с. Время вышло — ход доигрывается автоматически.</p>
      ${tooMany ? `<p class="warn">${cfg.name} карта рассчитана максимум на ${cfg.maxPlayers} игроков — выберите карту побольше или уберите лишних.</p>` : ""}
      ${me < 0 ? `<button class="btn green big" data-a="join" ${s.players.length >= MAX_PLAYERS || !myName ? "disabled" : ""}>Сесть за стол</button>` : ""}
      ${me < 0 && !myName ? `<p class="hint">Чтобы сесть за стол, укажите имя слева.</p>` : ""}
      ${host ? `<button class="btn green big" data-a="start" ${s.players.length < 2 || tooMany ? "disabled" : ""}>Начать игру</button>` : ""}
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
    for (let i = 0; i < gOf(s).hexes.length; i++) if (i !== s.robber) t.h.add(i);
  } else if (s.phase === "roadbuilding") roadTargets(s, me).forEach((e) => t.e.add(e));
  else if (s.phase === "main") {
    const P = s.players[me], pc = countPieces(s, me), m = ui.mode;
    t.soft = !m;
    if (m === "road" || (!m && has(P.res, COST.road) && pc.road < 15)) roadTargets(s, me).forEach((e) => t.e.add(e));
    if (m === "settle" || (!m && has(P.res, COST.settle) && pc.settle < 5)) addV(settleTargets(s, me, false), "settle");
    if (m === "city" || (!m && has(P.res, COST.city) && pc.city < 4)) addV(cityTargets(s, me), "city");
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
// Старые записи «бросает 8» без кубиков выделяем так же, только по сумме.
const ROLL_RE = /бросает (?:#d(\d)-(\d)|(\d+)$)/;
const logClass = (t) => {
  const m = ROLL_RE.exec(t);
  if (!m) return "";
  return ` class="roll ${(m[3] ? +m[3] : +m[1] + +m[2]) === 7 ? "seven" : ""}"`;
};
const rollHTML = (a, b, n) => `бросает ${a ? die(+a, false) + die(+b, true) : ""}<b class="rsum">${n}</b>`;
// В журнале ресурсы приходят токенами «2%wood», украденная карта — «%?id»: её видят только вор и жертва.
const fmtLog = (s, t) => esc(t)
  .replace(ROLL_RE, (_, a, b, n) => rollHTML(a, b, n || +a + +b))
  .replace(/%\?(\d+)/g, (_, id) => (s.steals?.[id]?.r ? resChip(s.steals[id].r) : `<span class="lr r-hidden" title="Карта скрыта">${ICON("card")}</span>`))
  .replace(/(\d+)?%(wood|brick|wool|grain|ore)/g, (_, n, k) => resChip(k, n === undefined ? 1 : +n))
  .replace(/@(\d)/g, (_, i) => (s.players[+i] ? `<b class="who" style="background:${s.players[+i].color};color:${inkOn(s.players[+i].color)}">` : "<b>") + `${esc(nameOf(s, +i))}</b>`);
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const die = (n, red, st = "") => `<span class="die ${red ? "r" : ""}" aria-label="${n}" ${st}>${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ""}></i>`).join("")}</span>`;
const pop = (title, body, closable) => `<div class="panel pop"><div class="pop-h"><b>${title}</b>${closable ? `<button class="x" data-panel="" aria-label="Закрыть">×</button>` : ""}</div>${body}</div>`;
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
    case "roll": return mine ? "Бросьте кубики! «Батыра» можно сыграть до броска" : `${cur} бросает кубики`;
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
    const warn = total > 7 ? `<span class="warn7" title="При броске 7 у вас сбросится половина карт">${ICON("cards")}${total} карт — на «7» сбросите ${Math.floor(total / 2)}</span>` : "";
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
      ab('data-a="buy"', "card", "Карта", can && has(P.res, COST.dev) && (s.deckCount ?? 0) > 0, costHTML(COST.dev), "", `Карта развития. Цена: ${resText(COST.dev)}. В колоде: ${s.deckCount ?? 0}`),
      mode("road", "road", "Тропа", COST.road, 15, pc.road),
      mode("settle", "yurt", "Юрта", COST.settle, 5, pc.settle, pc.settle >= 5 ? "все 5 юрт стоят: улучшите юрту до аила, и она вернётся к вам" : ""),
      mode("city", "ail", "Аил", COST.city, 4, pc.city, pc.city < 4 && !cityTargets(s, me).length ? "аил ставится на место вашей юрты, а свободных юрт на поле нет" : ""),
      mine && s.phase === "roll"
        ? ab('data-a="roll"', "dice", "Бросить кубики", true, "", "go pulse")
        : ab('data-a="end"', "end", "Завершить ход", can && !s.trade, "", "go"),
    ].join("");
    hud = `<div class="panel hand ${total > 7 ? "over7" : ""}">${warn}${cards}${devs ? `<span class="sep"></span>${devs}` : ""}</div><div class="panel acts">${acts}</div>`;
  } else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель.</div>`;
  }

  const rollFx = fxOn(fx.roll) ? fx.roll : null, dst = rollFx ? fxDelay(rollFx) : "";
  const dice = s.dice ? `<span class="dice ${rollFx ? "fresh" : ""}">${die(s.dice[0], false, dst)}${die(s.dice[1], true, dst)}<span class="dsum">${s.dice[0] + s.dice[1]}</span></span>` : "";
  const timerTitle = s.phase === "roll" ? "Кубики бросятся сами, когда время выйдет" : s.phase === "discard" ? "Время на сброс карт — потом сбросятся случайные" : `Время хода; каждое действие добавляет ${TIMER.bonus} с`;
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="${timerTitle}">${ICON("clock")}<b></b></span>` : "";
  const turnExtra = mine && s.phase === "roadbuilding" ? `<button class="btn small" data-a="endRoads">Закончить караван</button>` : "";
  const players = s.players.map((p, i) => `<div class="pl ${i === s.cur && s.status === "play" ? "cur" : ""}" style="--pc:${p.color}">
      ${ava(nameOf(s, i), p.color)}
      <div style="min-width:0"><div class="nm"><span>${esc(nameOf(s, i))}</span>${i === me ? '<span class="badge">вы</span>' : ""}${p.bot ? `<span class="badge" title="Бот — сложность: ${LEVEL_RU[p.level || "medium"]}">бот · ${LEVEL_RU[p.level || "medium"]}</span>` : ""}${s.phase === "discard" && s.toDiscard[i] ? '<span class="badge gold">сбрасывает</span>' : ""}</div>
        <div class="pstats"><span class="${cnt(p) > 7 ? "danger" : ""}" title="Карт ресурсов${cnt(p) > 7 ? " — больше 7: на «7» сбросит половину" : ""}">${ICON("cards")}${cnt(p)}</span><span title="Карт развития">${ICON("card")}${devCnt(p)}</span>
          <span class="${s.army === i ? "hl" : ""}" title="Сыграно батыров${s.army === i ? " · Сильнейшая дружина" : ""}">${ICON("sword")}${p.knights}</span>
          <span class="${s.longest === i ? "hl" : ""}" title="Длина пути${s.longest === i ? " · Великий путь" : ""}">${ICON("road")}${p.road}</span></div></div>
      <span class="vp" title="Победные очки">${vp(s, i, i === me || s.status === "over")}<small>очк.</small></span></div>`).join("");
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";

  $("view").innerHTML = `<div class="game">
    <div class="stage">
      <div class="panel turn ${mine ? "mine" : ""}" style="--pc:${cur.color}">${ava(nameOf(s, s.cur), cur.color)}
        <div class="txt"><span class="who">${s.status === "over" ? "Игра окончена" : (mine ? "Ваш ход!" : "Ход: " + esc(nameOf(s, s.cur)))}</span><span class="hint">${s.status === "play" ? esc(phaseHint(s, me)) : ""}</span>${turnExtra}</div>${timer}${dice}</div>
      <div class="topr"><span class="chip">Код <span class="code">${esc(s.code)}</span></span><button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "legend" ? "on" : ""}" data-panel="legend" title="Как читать поле — легенда">${ICON("help")}<span class="tl">Поле</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту — он будет играть за вас, а вы сможете смотреть и вернуть управление">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox">${boardSVG(s, me)}<div class="zoombar"><button data-zoom="in" aria-label="Приблизить" title="Приблизить">+</button><button data-zoom="out" aria-label="Отдалить" title="Отдалить">−</button><button data-zoom="reset" aria-label="Показать всё поле" title="Показать всё поле">${ICON("fit")}</button></div></div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры и боты стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${mine && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваш ход!</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" ? `<div class="over"><div class="panel">${ava(nameOf(s, s.winner), s.players[s.winner].color)}<span class="w">${esc(nameOf(s, s.winner))} побеждает!</span><span class="muted">${vp(s, s.winner, true)} победных очков</span><button class="btn green" data-a="back">К списку партий</button></div></div>` : ""}
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

function openGame(code) {
  code = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return toast("Код игры — 5 букв и цифр");
  currentCode = code;
  game = null;
  ui.mode = null;
  ui.panel = null;
  ui.robberHex = null;
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
  if (d.a === "theme") return setTheme(theme() === "dark" ? "light" : "dark", true);
  if (d.a === "create") { if (game || ensureName()) send({ t: "create" }); return; }
  if (d.a === "quick") {
    if (!ensureName()) return;
    ui.quick = true;
    ui.quickSent = 0;
    return send({ t: "create" });
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
document.addEventListener("input", (ev) => { if (ev.target.id === "myname") ui.nameDraft = ev.target.value; });
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
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
