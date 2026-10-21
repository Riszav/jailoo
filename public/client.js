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

function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
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
      game = m.game;
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
const delBtn = (code, small) => `<button class="btn red small" data-del="${esc(code)}" title="Удалить игру">${ICON("trash")}${small ? "" : "Удалить игру"}</button>`;
const ava = (name, color, cls = "") => `<span class="ava ${cls}" style="background:${color};color:${inkOn(color)}" title="${esc(name)}">${esc(initial(name))}</span>`;

function render() {
  const me = $("me");
  me.innerHTML = myName ? `${ava(myName, "#f2b53a", "sm")}<span>${esc(myName)}</span>` : "";
  if (!game) return renderLobby();
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
          <div class="namerow"><input id="myname" maxlength="24" value="${esc(myName)}" placeholder="Например, Айгуль"><button class="btn ghost" data-a="rename">Сохранить</button></div>
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
  document.title = `Игра ${s.code} — Жайлоо`;
  document.body.classList.remove("ingame");
  const link = `${location.origin}${location.pathname}#${s.code}`;
  const slots = [...Array(MAX_PLAYERS).keys()].map((i) => {
    const p = s.players[i];
    if (!p) return `<div class="slot free"><span class="ava ghost">+</span><span class="nm muted">Свободное место</span>${host ? `<button class="btn small" data-a="addBot">${ICON("bot")}Бот</button>` : ""}</div>`;
    return `<div class="slot">${ava(nameOf(s, i), COLORS[i])}<span class="nm">${esc(nameOf(s, i))}${p.bot ? ' <span class="badge">бот</span>' : ""}${p.id === s.host ? ' <span class="badge gold">создатель</span>' : ""}${p.id === myId ? ' <span class="badge">вы</span>' : ""}</span>${host && p.id !== myId ? `<button class="btn small red" data-kick="${i}">Убрать</button>` : ""}</div>`;
  }).join("");
  $("view").innerHTML = `<div class="roomgrid">
    <div class="panel pad"><h2>Игроки <span class="muted">${s.players.length}/${MAX_PLAYERS}</span></h2><div class="slots">${slots}</div>
      ${host ? "" : `<p class="hint">Игру начинает создатель комнаты.</p>`}</div>
    <div class="panel pad"><h3>Код комнаты</h3><span class="bigcode">${esc(s.code)}</span>
      <h3>Пригласить друзей</h3>
      <div class="linkrow"><input readonly value="${esc(link)}" aria-label="Ссылка на игру"><button class="btn" data-copy="${esc(link)}">Копировать</button></div>
      <p class="hint">До ${MAX_PLAYERS} игроков; пустые места можно отдать ботам.</p>
      <h3>Размер карты</h3>
      <div class="maps">${maps}</div>
      ${host ? "" : `<p class="hint">Карту выбирает создатель комнаты.</p>`}
      ${tooMany ? `<p class="warn">${cfg.name} карта рассчитана максимум на ${cfg.maxPlayers} игроков — выберите карту побольше или уберите лишних.</p>` : ""}
      ${me < 0 ? `<button class="btn green big" data-a="join" ${s.players.length >= MAX_PLAYERS || !myName ? "disabled" : ""}>Сесть за стол</button>` : ""}
      ${me < 0 && !myName ? `<p class="hint">Чтобы сесть за стол, укажите имя на главной.</p>` : ""}
      ${host ? `<button class="btn green big" data-a="start" ${s.players.length < 2 || tooMany ? "disabled" : ""}>Начать игру</button>` : ""}
      <div class="row">${me >= 0 && !host ? `<button class="btn red small" data-a="leave">${ICON("exit")}Выйти из комнаты</button>` : `<button class="btn small" data-a="back">К списку комнат</button>`}${host ? delBtn(s.code) : ""}</div>
    </div></div>`;
}

const f = (n) => (+n).toFixed(3);
const HEX_GRAD = { wood: ["#3f8f3a", "#1d5520"], brick: ["#e8804f", "#a4401f"], wool: ["#c4e67c", "#86bb45"], grain: ["#f8d95a", "#d9a21c"], ore: ["#b7c0cc", "#636d7c"], desert: ["#f4e6bd", "#d6bd80"] };
const HEX_FILL = { wood: "var(--wood)", brick: "var(--brick)", wool: "var(--wool)", grain: "var(--grain)", ore: "var(--ore)", desert: "var(--desert)" };

function targets(s, me) {
  const t = { v: new Set(), e: new Set(), h: new Set(), vKind: null };
  if (me < 0 || s.status !== "play" || me !== s.cur) return t;
  if (s.phase === "setup") {
    if (s.step === "settle") { settleTargets(s, me, true).forEach((v) => t.v.add(v)); t.vKind = "settle"; }
    else roadTargets(s, me).forEach((e) => t.e.add(e));
  } else if (s.phase === "robber") {
    for (let i = 0; i < gOf(s).hexes.length; i++) if (i !== s.robber) t.h.add(i);
  } else if (s.phase === "roadbuilding") roadTargets(s, me).forEach((e) => t.e.add(e));
  else if (s.phase === "main") {
    if (ui.mode === "road") roadTargets(s, me).forEach((e) => t.e.add(e));
    if (ui.mode === "settle") { settleTargets(s, me, false).forEach((v) => t.v.add(v)); t.vKind = "settle"; }
    if (ui.mode === "city") { cityTargets(s, me).forEach((v) => t.v.add(v)); t.vKind = "city"; }
  }
  return t;
}

function yurt(x, y, color, city) {
  const dome = (dx, k) => `<path transform="translate(${f(x + dx)} ${f(y)}) scale(${k})" d="M-.21,.13 L-.21,-.01 Q0,-.27 .21,-.01 L.21,.13 Z" fill="${color}" stroke="#1b2333" stroke-width=".045"/>`;
  return city
    ? `${dome(0.13, 0.8)}${dome(-0.06, 1.35)}<circle cx="${f(x - 0.06)}" cy="${f(y - 0.3)}" r=".05" fill="#1b2333"/>`
    : dome(0, 1) + `<path d="M${f(x - 0.05)},${f(y + 0.13)} v-.1 h.1 v.1" fill="#1b2333"/>`;
}

function boardSVG(s, me) {
  const T = targets(s, me), G = gOf(s);
  const xs = G.verts.map((v) => v.x), ys = G.verts.map((v) => v.y);
  const x0 = Math.min(...xs) - 1.4, y0 = Math.min(...ys) - 1.15, w = Math.max(...xs) + 1.4 - x0, h = Math.max(...ys) + 1.15 - y0;
  let o = `<svg class="board" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" style="aspect-ratio:${f(w)}/${f(h)}" role="img" aria-label="Игровое поле"><defs>${Object.entries(HEX_GRAD).map(([k, [a, b]]) => `<linearGradient id="g-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join("")}</defs>`;
  const polys = G.hexes.map((_, i) => G.hexVerts[i].map((v) => `${f(G.verts[v].x)},${f(G.verts[v].y)}`).join(" "));
  // Песчаный берег: каждый участок обведён толстой светлой линией, вместе они дают контур острова.
  o += polys.map((pts) => `<polygon points="${pts}" fill="#ecd9a4" stroke="#ecd9a4" stroke-width=".6" stroke-linejoin="round"/>`).join("");
  for (const h of s.harbors) {
    const ed = G.edges[h.e], A = G.verts[ed.a], B = G.verts[ed.b];
    // Стоянка стоит на перпендикуляре к своему берегу, всегда на одном расстоянии от поля.
    const H = G.hexes[ed.hexes[0]], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    const nx = mx - H.x, ny = my - H.y, nl = Math.hypot(nx, ny);
    const px = mx + (nx / nl) * 0.72, py = my + (ny / nl) * 0.72;
    const any = h.type === "any";
    for (const V of [A, B]) {
      const seg = `x1="${f(V.x)}" y1="${f(V.y)}" x2="${f(px)}" y2="${f(py)}"`;
      o += `<line class="pier-edge" ${seg}/><line class="pier" ${seg}/><line class="pier-seam" ${seg}/>`;
    }
    o += `<g><title>${any ? "Стоянка: любой ресурс 3:1" : "Стоянка: " + RES_RU[h.type] + " 2:1"}</title><circle cx="${f(px)}" cy="${f(py)}" r=".36" fill="${any ? "#fffaf0" : HEX_FILL[h.type]}" stroke="#fff" stroke-width=".06"/>`;
    o += any
      ? `<text x="${f(px)}" y="${f(py + 0.1)}" text-anchor="middle" font-size=".27" font-weight="900" fill="#2a2418" font-family="Nunito,sans-serif">3:1</text></g>`
      : `<use href="#i-${h.type}" x="${f(px - 0.16)}" y="${f(py - 0.32)}" width=".32" height=".32" fill="#fff"/><text x="${f(px)}" y="${f(py + 0.22)}" text-anchor="middle" font-size=".2" font-weight="900" fill="#fff" font-family="Nunito,sans-serif">2:1</text></g>`;
  }
  G.hexes.forEach((h, i) => {
    const b = s.board[i], pts = polys[i];
    o += `<polygon class="hex" points="${pts}" fill="url(#g-${b.res})"><title>${RES_RU[b.res]}</title></polygon>`;
    // Внутренняя тёмная кромка: соседние участки одного цвета не сливаются.
    o += `<polygon class="hex-in" points="${pts}" transform="translate(${f(h.x)} ${f(h.y)}) scale(.9) translate(${f(-h.x)} ${f(-h.y)})"/>`;
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
    o += `<line class="tgt-e" data-e="${e}" x1="${f(A.x + (B.x - A.x) * 0.15)}" y1="${f(A.y + (B.y - A.y) * 0.15)}" x2="${f(B.x - (B.x - A.x) * 0.15)}" y2="${f(B.y - (B.y - A.y) * 0.15)}"/>`;
  }
  for (const k in s.buildings) { const b = s.buildings[k], V = G.verts[+k]; o += yurt(V.x, V.y, s.players[b.p].color, b.city); }
  for (const v of T.v) { const V = G.verts[v]; o += `<circle class="tgt-v" data-v="${v}" cx="${f(V.x)}" cy="${f(V.y)}" r="${T.vKind === "city" ? 0.3 : 0.18}"/>`; }
  return o + "</svg>";
}

const costHTML = (c) => `<span class="cost" aria-label="${resText(c)}">${RES.flatMap((k) => Array(c[k] || 0).fill(`<i class="r-${k}" title="${RES_RU[k]}"></i>`)).join("")}</span>`;
const stepper = (key, obj, max) => `<div class="step">${RES.map((k) => `<div class="sc r-${k}" title="${RES_RU[k]}">${ICON(k)}<b>${obj[k]}</b><span class="pm"><button data-dec="${key}:${k}" aria-label="Меньше: ${RES_RU[k]}" ${obj[k] ? "" : "disabled"}>−</button><button data-inc="${key}:${k}" aria-label="Больше: ${RES_RU[k]}" ${max && obj[k] >= max[k] ? "disabled" : ""}>+</button></span></div>`).join("")}</div>`;
const picker = (key, label, counts) => `<div class="pickrow"><span class="lbl">${label}</span>${RES.map((k) => `<button class="mini r-${k} ${ui[key] === k ? "sel" : ""}" data-pick="${key}:${k}" title="${RES_RU[k]}" aria-pressed="${ui[key] === k}">${ICON(k)}${counts ? `<b>${counts[k]}</b>` : ""}</button>`).join("")}</div>`;
const fmtLog = (s, t) => esc(t).replace(/@(\d)/g, (_, i) => (s.players[+i] ? `<b class="who" style="background:${s.players[+i].color};color:${inkOn(s.players[+i].color)}">` : "<b>") + `${esc(nameOf(s, +i))}</b>`);
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const die = (n, red) => `<span class="die ${red ? "r" : ""}" aria-label="${n}">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ""}></i>`).join("")}</span>`;
const pop = (title, body, closable) => `<div class="panel pop"><div class="pop-h"><b>${title}</b>${closable ? `<button class="x" data-panel="" aria-label="Закрыть">×</button>` : ""}</div>${body}</div>`;
const devPlayable = (s, me, t) => t !== "vp" && me >= 0 && me === s.cur && s.status === "play" && canPlayDev(s, me, t) && (s.phase === "main" || (t === "knight" && s.phase === "roll"));

function phaseHint(s, me) {
  const cur = nameOf(s, s.cur), mine = me === s.cur;
  switch (s.phase) {
    case "setup": return mine ? (s.step === "settle" ? "Поставьте юрту на свободный угол — доступные места подсвечены" : "Проложите тропу от новой юрты") : `${cur} расставляет стартовые юрты`;
    case "roll": return mine ? "Бросьте кубики. «Батыра» можно сыграть до броска" : `${cur} бросает кубики`;
    case "discard": return s.toDiscard[me] ? `Буран: сбросьте ${s.toDiscard[me]} карт` : "Ждём, пока игроки сбросят карты";
    case "robber": return mine ? "Перегоните буран: нажмите на участок поля" : `${cur} перегоняет буран`;
    case "roadbuilding": return mine ? `Караван: осталось бесплатных троп — ${s.freeRoads}` : `${cur} прокладывает тропы каравана`;
    case "main":
      if (mine && ui.mode) return "Выберите место на поле. Повторное нажатие на кнопку отменяет выбор";
      return mine ? "Стройте, торгуйте и завершите ход" : `${cur} строит и торгует`;
  }
  return "";
}

function renderGame() {
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], mine = me >= 0 && me === s.cur && s.status === "play";
  const cur = s.players[s.cur];
  if (ui.panel === "trade" && !(mine && s.phase === "main" && !s.trade)) ui.panel = null;
  if (ui.panel && ui.panel.startsWith("dev:") && !(P && devPlayable(s, me, ui.panel.slice(4)))) ui.panel = null;

  const pops = [];
  if (s.status === "play" && me >= 0) {
    if (s.phase === "discard" && s.toDiscard[me]) {
      pops.push(pop(`Буран! Сбросьте ${s.toDiscard[me]} карт`, `${stepper("disc", ui.disc, P.res)}<button class="btn green" data-a="discard" ${sum(ui.disc) !== s.toDiscard[me] ? "disabled" : ""}>Сбросить (${sum(ui.disc)}/${s.toDiscard[me]})</button>`));
    }
    if (mine && s.phase === "robber" && ui.robberHex !== null) {
      const vs = victimsOf(s, ui.robberHex, me);
      pops.push(pop("У кого забрать карту?", `<div class="row">${vs.map((o) => `<button class="btn" data-victim="${o}">${ava(nameOf(s, o), s.players[o].color, "sm")}${esc(nameOf(s, o))} · ${cnt(s.players[o])} карт</button>`).join("")}<button class="btn small" data-a="unrobber">Другой участок</button></div>`));
    }
    if (mine && s.trade) {
      pops.push(pop("Ваше предложение", `<p style="margin:0">Отдаёте <b>${resText(s.trade.give)}</b> — хотите <b>${resText(s.trade.get)}</b></p>
        <div class="offer">${s.players.map((o, i) => (i === me ? "" : `<div class="pl2">${ava(nameOf(s, i), o.color, "sm")}<span class="nm">${esc(nameOf(s, i))}</span>${s.trade.resp[i] === true ? `<button class="btn small green" data-with="${i}">Обменять</button>` : `<span class="muted">${s.trade.resp[i] === false ? "отказ" : "думает…"}</span>`}</div>`)).join("")}</div>
        <button class="btn small" data-a="cancelOffer">Отменить предложение</button>`));
    }
    if (!mine && s.trade) {
      const r = s.trade.resp[me];
      pops.push(pop(`Предложение от ${esc(nameOf(s, s.cur))}`, `<p style="margin:0">Даёт <b>${resText(s.trade.give)}</b> — просит <b>${resText(s.trade.get)}</b></p>${r === undefined ? `<div class="row"><button class="btn green" data-respond="1" ${has(P.res, s.trade.get) ? "" : "disabled"}>Согласиться</button><button class="btn red" data-respond="0">Отказаться</button></div>` : `<p class="muted" style="margin:0">${r ? "Вы согласились, ждём решения" : "Вы отказались"}</p>`}`));
    }
    if (ui.panel === "trade") {
      const k = ratio(s, me, ui.bg);
      pops.push(pop("Обмен", `<h4>С запасом</h4>${picker("bg", `Отдаю ${k}`, P.res)}${picker("bt", "Получаю 1", s.bank)}
        <div class="row"><button class="btn green small" data-a="bank" ${P.res[ui.bg] >= k && s.bank[ui.bt] > 0 && ui.bg !== ui.bt ? "" : "disabled"}>Обменять ${k}:1</button></div>
        <h4>С игроками — отдаю</h4>${stepper("give", ui.give, P.res)}<h4>Хочу получить</h4>${stepper("get", ui.get)}
        <div class="row"><button class="btn blue small" data-a="offer" ${sum(ui.give) && sum(ui.get) ? "" : "disabled"}>Предложить всем</button></div>`, true));
    }
    if (ui.panel && ui.panel.startsWith("dev:")) {
      const t = ui.panel.slice(4);
      let extra = "";
      if (t === "yop") extra = picker("yopA", "Первый", null) + picker("yopB", "Второй", null);
      if (t === "mono") extra = picker("mono", "Ресурс", null);
      pops.push(pop(`«${DEV_RU[t]}»`, `<span class="hint">${DEV_HINT[t]}</span>${extra}<div class="row"><button class="btn green" data-dev="${t}">Сыграть карту</button></div>`, true));
    }
  }

  let hud;
  if (P) {
    const devCounts = {};
    for (const d of P.dev) devCounts[d.t] = (devCounts[d.t] || 0) + 1;
    const cards = RES.map((k) => `<div class="rc r-${k} ${P.res[k] ? "" : "zero"}" title="${RES_RU[k]}: ${P.res[k]}">${ICON(k)}<span class="lb">${RES_RU[k]}</span><span class="n">${P.res[k]}</span></div>`).join("");
    const devs = Object.keys(devCounts).map((t) => {
      const ok = devPlayable(s, me, t);
      return `<button class="dc ${ok ? "can" : ""} ${ui.panel === "dev:" + t ? "sel" : ""}" ${ok ? `data-panel="dev:${t}"` : 'aria-disabled="true"'} title="${DEV_RU[t]} — ${DEV_HINT[t]}">${ICON("card")}<span class="lb">${DEV_RU[t]}</span><span class="n">${devCounts[t]}</span></button>`;
    }).join("");
    const can = mine && s.phase === "main";
    const pc = countPieces(s, me);
    const ab = (attr, icon, label, ok, extra = "", cls = "") => `<button class="ab ${cls}" ${attr} ${ok ? "" : "disabled"} title="${label}">${ICON(icon)}<span class="lb">${label}</span>${extra}</button>`;
    const mode = (m, icon, label, cost, ok) => ab(`data-mode="${m}"`, icon, label, ok, costHTML(cost), ui.mode === m ? "on" : "");
    const acts = [
      ab('data-panel="trade"', "trade", "Обмен", can && !s.trade, "", ui.panel === "trade" ? "on" : ""),
      ab('data-a="buy"', "card", "Карта", can && has(P.res, COST.dev) && (s.deckCount ?? 0) > 0, costHTML(COST.dev)),
      mode("road", "road", "Тропа", COST.road, can && has(P.res, COST.road) && pc.road < 15),
      mode("settle", "yurt", "Юрта", COST.settle, can && has(P.res, COST.settle) && pc.settle < 5),
      mode("city", "ail", "Аил", COST.city, can && has(P.res, COST.city) && pc.city < 4),
      mine && s.phase === "roll"
        ? ab('data-a="roll"', "dice", "Бросить кубики", true, "", "go")
        : ab('data-a="end"', "end", "Завершить ход", can && !s.trade, "", "go"),
    ].join("");
    hud = `<div class="panel hand">${cards}${devs ? `<span class="sep"></span>${devs}` : ""}</div><div class="panel acts">${acts}</div>`;
  } else {
    hud = `<div class="panel spect muted">Вы смотрите эту партию как зритель.</div>`;
  }

  const dice = s.dice ? `<span class="dice">${die(s.dice[0])}${die(s.dice[1], true)}<span class="dsum">${s.dice[0] + s.dice[1]}</span></span>` : "";
  const turnExtra = mine && s.phase === "roadbuilding" ? `<button class="btn small" data-a="endRoads">Закончить караван</button>` : "";
  const players = s.players.map((p, i) => `<div class="pl ${i === s.cur && s.status === "play" ? "cur" : ""}" style="--pc:${p.color}">
      ${ava(nameOf(s, i), p.color)}
      <div style="min-width:0"><div class="nm"><span>${esc(nameOf(s, i))}</span>${i === me ? '<span class="badge">вы</span>' : ""}${p.bot ? '<span class="badge">бот</span>' : ""}${s.phase === "discard" && s.toDiscard[i] ? '<span class="badge gold">сбрасывает</span>' : ""}</div>
        <div class="pstats"><span title="Карт ресурсов">${ICON("cards")}${cnt(p)}</span><span title="Карт развития">${ICON("card")}${devCnt(p)}</span>
          <span class="${s.army === i ? "hl" : ""}" title="Сыграно батыров${s.army === i ? " · Сильнейшая дружина" : ""}">${ICON("sword")}${p.knights}</span>
          <span class="${s.longest === i ? "hl" : ""}" title="Длина пути${s.longest === i ? " · Великий путь" : ""}">${ICON("road")}${p.road}</span></div></div>
      <span class="vp" title="Победные очки">${vp(s, i, i === me || s.status === "over")}<small>очк.</small></span></div>`).join("");

  $("view").innerHTML = `<div class="game">
    <div class="stage">
      <div class="panel turn" style="--pc:${cur.color}">${ava(nameOf(s, s.cur), cur.color)}
        <div class="txt"><span class="who">${s.status === "over" ? "Игра окончена" : (mine ? "Ваш ход" : "Ход: " + esc(nameOf(s, s.cur)))}</span><span class="hint">${s.status === "play" ? esc(phaseHint(s, me)) : ""}</span>${turnExtra}</div>${dice}</div>
      <div class="topr"><span class="chip">Код <span class="code">${esc(s.code)}</span></span><button class="btn ghost small" data-a="back">${ICON("exit")}Выйти</button>${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox">${boardSVG(s, me)}</div>
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" ? `<div class="over"><div class="panel">${ava(nameOf(s, s.winner), s.players[s.winner].color)}<span class="w">${esc(nameOf(s, s.winner))} побеждает!</span><span class="muted">${vp(s, s.winner, true)} победных очков</span><button class="btn green" data-a="back">К списку партий</button></div></div>` : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      <div class="panel"><div class="ph"><h3>Игроки</h3></div><div class="players">${players}</div>
        <div class="bank">Запас: ${RES.map((k) => `<span title="${RES_RU[k]}"><i class="sw r-${k}"></i>${s.bank[k]}</span>`).join("")}<span title="Карт развития">${ICON("card")}${s.deckCount ?? s.deck.length}</span></div></div>
      <div class="panel logp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div>${fmtLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
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
function closeGame() {
  if (currentCode) send({ t: "close" });
  store.set("zh.game", "");
  game = null;
  currentCode = null;
  ui.panel = null;
  history.replaceState(null, "", location.pathname);
  render();
}
function saveName() {
  const v = ($("myname")?.value || "").trim().slice(0, 24);
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
    return act(s.phase === "main" && ui.mode === "city" ? { type: "city", v } : { type: "settle", v });
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
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  if (ev.target.id === "joincode") openGame(ev.target.value);
  if (ev.target.id === "myname") saveName();
});

// Сессия: без кода в адресе возвращаемся в партию, открытую в прошлый раз.
if (/^#[A-Z0-9]{4,6}$/i.test(location.hash)) currentCode = location.hash.slice(1).toUpperCase();
else if (/^[A-Z0-9]{4,6}$/.test(store.get("zh.game") || "")) currentCode = store.get("zh.game");
render();
connect();
