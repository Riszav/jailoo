const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { WebSocketServer } = require("ws");
const L = require("./shared/logic.js");
const N = require("./shared/nomad.js");
const M = require("./shared/mukhtar.js");
const B = require("./shared/bunker.js");
const F = require("./shared/mafia.js");
const db = require("./db.js");

const PORT = Number(process.env.PORT) || 3000;
// Временный общий пароль, которым можно войти в любой аккаунт. Пустая MASTER_PASSWORD отключает его.
const MASTER_PASSWORD = process.env.MASTER_PASSWORD ?? "testtest";
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const START_RATING = 1000;
const BOT_RATING = { easy: 800, medium: 1000, hard: 1200 };
const ELO_K = 32;
const BOT_TICK_MS = Number(process.env.BOT_TICK_MS) || 700;
const LOBBY_TTL_MS = 6 * 60 * 60 * 1000;
const GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATIC = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/client.js": ["public/client.js", "text/javascript; charset=utf-8"],
  "/logic.js": ["shared/logic.js", "text/javascript; charset=utf-8"],
  "/nomad.js": ["shared/nomad.js", "text/javascript; charset=utf-8"],
  "/nomad-client.js": ["public/nomad-client.js", "text/javascript; charset=utf-8"],
  "/mukhtar.js": ["shared/mukhtar.js", "text/javascript; charset=utf-8"],
  "/mukhtar-client.js": ["public/mukhtar-client.js", "text/javascript; charset=utf-8"],
  "/bunker.js": ["shared/bunker.js", "text/javascript; charset=utf-8"],
  "/bunker-client.js": ["public/bunker-client.js", "text/javascript; charset=utf-8"],
  "/mafia.js": ["shared/mafia.js", "text/javascript; charset=utf-8"],
  "/mafia-client.js": ["public/mafia-client.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["public/favicon.svg", "image/svg+xml"],
};
// Версия клиента — хеш статики на момент запуска. Вкладка, открытая до обновления, увидит другую версию и перезагрузится.
const BUILD = crypto.createHash("sha256").update(Object.values(STATIC).map(([f]) => fs.readFileSync(path.join(__dirname, f))).join("\0")).digest("hex").slice(0, 12);

// У каждой игры свой модуль правил: «Жайлоо» (кубики), «Кочёвка» (тайлы), «Мухтар» (погоня) или «Бункер» (спор и голосование).
const GAMES = { zhailoo: L, nomad: N, mukhtar: M, bunker: B, mafia: F };
const CHAT_MAX = 150, CHAT_LEN = 300, CHAT_GAP_MS = 700;
// Игрок, у которого нет открытой вкладки с партией дольше этого, заменяется ботом — если в партии остался кто-то из людей.
// Вернётся — место отдаётся ему само.
const OFFLINE_MS = Number(process.env.OFFLINE_MS) || 60 * 1000;
const EMOTES = ["👍", "😂", "😮", "😡", "😭", "🔥", "👏", "🤔", "🙏", "💀", "Кой!", "Жакшы!", "Ой-бой!", "Рахмат!", "Реванш?", "Быстрее!"];
const EMOTE_GAP_MS = 1200;
// Настройки комнаты, которые переезжают в реванш.
const KEEP_SETTINGS = ["turnTime", "mods", "mapSize", "target", "head", "talk"];
const R = (g) => (g && GAMES[g.game]) || L;

const games = new Map();
const clients = new Set();
// Аккаунты: users по id, индексы по логину и по идентификатору игрока (pid), sessions — по sha256 токена.
const users = new Map(), byLogin = new Map(), byPid = new Map(), sessions = new Map();

async function load() {
  await db.init();
  for (const g of await db.all("games")) {
    // После перезапуска у всех текущий отрезок таймера начинается заново.
    const t = g.status === "play" ? R(g).phaseTime(g) : 0;
    if (t && !g.paused) g.deadline = Date.now() + t * 1000;
    games.set(g.code, g);
  }
  for (const u of await db.all("users")) indexUser(u);
  const now = Date.now();
  for (const se of await db.all("sessions")) {
    if (now - se.createdAt < SESSION_TTL_MS && users.has(se.uid)) sessions.set(se.key, se);
    else persist("sessions", se.key, null);
  }
  console.log(`Хранилище: ${db.name}. Партий: ${games.size}, аккаунтов: ${users.size}`);
}

// Запись в хранилище не ждём: ошибка только пишется в лог, состояние в памяти остаётся верным.
function persist(kind, key, data) {
  (data == null ? db.del(kind, key) : db.put(kind, key, data)).catch((e) => console.error(`Не удалось сохранить ${kind}/${key}:`, e.message));
}

// Партии меняются часто — копим изменённые коды и пишем раз в секунду.
const dirty = new Set();
let saveTimer = null;
function save(code) {
  if (code) dirty.add(code);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    for (const c of dirty) persist("games", c, games.get(c));
    dirty.clear();
  }, 1000);
}

function genCode() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do code = Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join("");
  while (games.has(code));
  return code;
}

const cleanName = (n) => String(n || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);

function viewFor(game, viewerId) {
  if (game.status !== "play") return game;
  if (game.game === "nomad") return nomadView(game);
  if (game.game === "mukhtar") return mukhtarView(game, viewerId);
  if (game.game === "bunker") return withTimer(B.view(game, viewerId), game);
  if (game.game === "mafia") return withTimer(F.view(game, viewerId), game);
  const v = structuredClone(game);
  const me = v.players.findIndex((p) => p.id === viewerId);
  for (const k in v.steals) if (me !== v.steals[k].t && me !== v.steals[k].v) delete v.steals[k].r;
  v.timeLeft = game.paused ? game.pausedLeft ?? null : game.deadline ? Math.max(0, game.deadline - Date.now()) : null;
  delete v.deadline;
  delete v.pausedLeft;
  delete v.timerKey;
  for (const p of v.players) {
    p.resCount = L.sum(p.res);
    p.devCount = p.dev.length;
    // Отдавший место боту продолжает видеть карты своего места.
    if (p.id !== viewerId && p.was !== viewerId) {
      p.res = L.emptyRes();
      p.dev = [];
    }
  }
  v.deckCount = v.deck.length;
  v.deck = [];
  // Порядок колоды судьбы — секрет, игрокам видно только, сколько карт осталось.
  if (v.fate) {
    v.fateCount = v.fate.length;
    delete v.fate;
  }
  return v;
}

function withTimer(v, game) {
  v.timeLeft = game.paused ? game.pausedLeft ?? null : game.deadline ? Math.max(0, game.deadline - Date.now()) : null;
  delete v.deadline;
  delete v.pausedLeft;
  delete v.timerKey;
  return v;
}

// Чат лежит в партии, но приходит отдельными сообщениями, а не с каждым состоянием.
function stateFor(g, viewerId) {
  const { chat, ...v } = viewFor(g, viewerId);
  // Кто сейчас смотрит партию: у бота, занявшего чужое место, — его хозяин.
  const here = watching(g.code);
  v.online = g.players.map((p) => (p.bot ? !!p.was && here.has(p.was) : here.has(p.id)));
  return v;
}
function watching(code) {
  const set = new Set();
  for (const c of clients) if (c.code === code && c.playerId) set.add(c.playerId);
  return set;
}
// Когда кто-то открыл или закрыл партию, остальные видят, кто в сети; ушедшим запоминаем, с какого момента их нет.
const awaySince = new Map();
function presence(code) {
  const g = code && games.get(code);
  if (!g) return;
  const here = watching(code), now = Date.now();
  for (const p of g.players) {
    if (p.bot) continue;
    const key = `${code}:${p.id}`;
    if (here.has(p.id)) awaySince.delete(key);
    else if (!awaySince.has(key)) awaySince.set(key, now);
  }
  broadcastGame(code);
}
// Отключившихся дольше OFFLINE_MS заменяем ботом. Если людей в сети не осталось вовсе, ждём: ходы и так доиграет таймер.
function replaceOffline() {
  const now = Date.now();
  for (const g of [...games.values()]) {
    if (g.status !== "play" || g.paused) continue;
    const here = watching(g.code);
    if (!g.players.some((p) => !p.bot && here.has(p.id))) continue;
    for (const p of g.players) {
      if (p.bot || here.has(p.id)) continue;
      const since = awaySince.get(`${g.code}:${p.id}`);
      if (since == null) { awaySince.set(`${g.code}:${p.id}`, now); continue; }
      if (now - since < OFFLINE_MS) continue;
      const cur = games.get(g.code), pi = cur.players.findIndex((q) => q.id === p.id);
      let next;
      try {
        next = R(cur).apply(cur, p.id, { type: "abandon" });
      } catch (e) {
        console.error(`Не удалось заменить ботом игрока в ${g.code}:`, e.message);
        continue;
      }
      if (!next) continue;
      next.players[pi].auto = true;
      next.log[next.log.length - 1] = `@${pi} не в сети — пока за него играет бот`;
      next.seq = (cur.seq || 0) + 1;
      awaySince.delete(`${g.code}:${p.id}`);
      games.set(g.code, next);
      changed(g.code);
    }
  }
}
// Игрок, которого заменили автоматически, вернулся в партию — отдаём ему место.
function autoReclaim(g, pid) {
  if (g.status !== "play" || !g.players.some((p) => p.bot && p.was === pid && p.auto)) return;
  try {
    const next = R(g).apply(g, pid, { type: "reclaim" });
    for (const p of next.players) if (p.id === pid) delete p.auto;
    next.seq = (g.seq || 0) + 1;
    games.set(g.code, next);
    changed(g.code);
  } catch (e) {
    console.error(`Не удалось вернуть место в ${g.code}:`, e.message);
  }
}

// Реванш: новая комната той же игры с теми же настройками и ботами. Первый нажавший создаёт её, остальные присоединяются.
function rematch(ws) {
  const g = games.get(ws.code);
  if (!g || !ws.playerId) return send(ws, { t: "error", message: "Игра не открыта" });
  if (g.status !== "over") return send(ws, { t: "error", message: "Реванш — после конца партии" });
  if (seatOf(g, ws.playerId) < 0) return send(ws, { t: "error", message: "Реванш могут начать только игроки" });
  let n = g.rematch && games.get(g.rematch);
  if (n && n.status === "lobby") {
    if (!n.players.some((p) => p.id === ws.playerId)) {
      try {
        n = R(n).apply(n, ws.playerId, { type: "join" });
      } catch (e) {
        return send(ws, { t: "error", message: e.message });
      }
      games.set(n.code, n);
    }
  } else {
    const M = R(g);
    n = M.newGame(genCode(), ws.playerId);
    n.game = g.game || "zhailoo";
    for (const k of KEEP_SETTINGS) if (g[k] !== undefined) n[k] = structuredClone(g[k]);
    for (const p of g.players) {
      if (!p.bot || p.was) continue;
      try {
        n = M.apply(n, ws.playerId, { type: "addBot", level: p.level });
      } catch {}
    }
    n.names = {};
    games.set(n.code, n);
    g.rematch = n.code;
    g.rematchBy = seatOf(g, ws.playerId);
    changed(g.code);
  }
  rememberName(n, ws);
  changed(n.code);
  send(ws, { t: "goto", code: n.code });
}
const seatOf = (g, pid) => g.players.findIndex((p) => p.id === pid || p.was === pid);
// Каналы чата: у большинства игр один общий, в «Мафии» есть закрытый чат мафии и чат мёртвых.
const chatChannels = (g, pi) => R(g).chatChannels?.(g, pi) || [{ id: "all", name: "Общий" }];
const chatFor = (g, pid) => {
  const pi = seatOf(g, pid), sees = R(g).chatSees;
  return (g.chat || []).filter((m) => !sees || sees(g, pi, m));
};

// В «Кочёвке» скрыт только порядок тайлов в мешке.
function nomadView(game) {
  const v = { ...game, deck: [], deckCount: game.deck.length };
  v.timeLeft = game.paused ? game.pausedLeft ?? null : game.deadline ? Math.max(0, game.deadline - Date.now()) : null;
  delete v.deadline;
  delete v.pausedLeft;
  delete v.timerKey;
  return v;
}

// В «Мухтаре» скрыты колода, чужие карты, чужой шёпот и цель, вместимость пещер, пока их не открыли. Что пещера полна — видно всем.
function mukhtarView(game, viewerId) {
  const v = structuredClone(game);
  v.timeLeft = game.paused ? game.pausedLeft ?? null : game.deadline ? Math.max(0, game.deadline - Date.now()) : null;
  delete v.deadline;
  delete v.pausedLeft;
  delete v.timerKey;
  v.deckCount = v.deck.length;
  v.deck = [];
  for (const c of v.caves) {
    c.full = M.full(c);
    if (!c.open && !c.full) c.cap = null;
  }
  for (const p of v.players) {
    p.handCount = p.hand.length;
    p.whispered = p.whisper ? p.whisper.c : null;
    if (p.id !== viewerId && p.was !== viewerId) {
      p.hand = [];
      p.whisper = null;
      p.aim = null;
    }
  }
  return v;
}

function summary(g) {
  return {
    code: g.code,
    game: g.game || "zhailoo",
    status: g.status,
    createdAt: g.createdAt,
    host: g.host,
    players: g.players.map((p, i) => ({ id: p.id, bot: p.bot, name: p.bot ? p.name : g.names?.[p.id] || `Игрок ${i + 1}` })),
    mods: Object.keys(g.mods || {}).filter((k) => g.mods[k]),
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastGame(code) {
  const g = games.get(code);
  for (const c of clients) {
    if (c.code !== code) continue;
    if (g) send(c, { t: "state", game: stateFor(g, c.playerId) });
    else send(c, { t: "closed", code });
  }
}

let lobbyTimer = null;
function broadcastLobby() {
  clearTimeout(lobbyTimer);
  lobbyTimer = setTimeout(() => {
    const list = [...games.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map(summary);
    for (const c of clients) send(c, { t: "games", games: list });
  }, 50);
}

// Таймер: новый отрезок, когда сменился ключ хода (игрок, бросок, сброс); действие текущего игрока добавляет бонус.
function touchTimer(g, bonus) {
  if (g.status !== "play") {
    delete g.deadline;
    delete g.timerKey;
    delete g.pausedLeft;
    return;
  }
  const now = Date.now();
  if (g.paused) {
    if (g.pausedLeft == null && g.deadline) g.pausedLeft = Math.max(0, g.deadline - now);
    return;
  }
  if (g.pausedLeft != null) {
    g.deadline = now + g.pausedLeft;
    delete g.pausedLeft;
  }
  const key = R(g).turnKey(g), full = R(g).phaseTime(g) * 1000, fresh = key !== g.timerKey;
  g.timerKey = key;
  if (!full) delete g.deadline;
  else if (fresh || !g.deadline) g.deadline = now + full;
  else if (bonus && R(g).TIMER.bonus) g.deadline = Math.min(g.deadline + R(g).TIMER.bonus * 1000, now + full);
}

function changed(code, bonus) {
  const g = games.get(code);
  if (g) {
    g.updatedAt = Date.now();
    touchTimer(g, bonus);
  }
  if (g && g.status === "over" && !g.rated) rate(g);
  broadcastGame(code);
  // Кто какие каналы чата видит, меняется со смертью игрока и в конце партии — тогда рассылаем историю заново.
  if (g && R(g).chatSees) {
    const sig = `${g.status}:${(g.deaths || []).length}`;
    if (g.chatSig !== sig) {
      g.chatSig = sig;
      for (const c of clients) if (c.code === code) send(c, { t: "chat", code, list: chatFor(g, c.playerId) });
    }
  }
  broadcastLobby();
  save(code);
}

function rememberName(g, ws) {
  if (!g.names) g.names = {};
  if (ws.name && g.players.some((p) => p.id === ws.playerId)) g.names[ws.playerId] = ws.name;
}

function handle(ws, msg) {
  switch (msg.t) {
    case "hello": {
      if (typeof msg.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(msg.id)) return send(ws, { t: "error", message: "Неверный идентификатор игрока" });
      const u = userByToken(msg.token);
      if (u) signIn(ws, u);
      else {
        // Идентификатор аккаунта без токена не принимаем — выдаём гостю новый.
        ws.userId = null;
        ws.playerId = byPid.has(msg.id) ? crypto.randomUUID() : msg.id;
        ws.name = cleanName(msg.name);
      }
      send(ws, { t: "welcome", id: ws.playerId, user: u ? pub(u) : null, expired: !!msg.token && !u, build: BUILD });
      send(ws, { t: "top", top: top() });
      send(ws, { t: "games", games: [...games.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map(summary) });
      return;
    }
    case "rename": {
      ws.name = cleanName(msg.name);
      for (const g of games.values()) {
        if (g.players.some((p) => p.id === ws.playerId)) {
          rememberName(g, ws);
          broadcastGame(g.code);
          save(g.code);
        }
      }
      if (ws.userId) {
        const u = users.get(ws.userId);
        u.name = ws.name || u.name;
        persist("users", u.id, u);
        broadcastTop();
      }
      broadcastLobby();
      return;
    }
    case "register":
    case "login":
    case "logout":
      return auth(ws, msg).catch((e) => {
        console.error("Ошибка входа:", e);
        send(ws, { t: "error", message: "Не удалось войти, попробуйте ещё раз" });
      });
    case "top":
      return send(ws, { t: "top", top: top() });
    case "create": {
      if (!ws.playerId) return;
      const g = (GAMES[msg.game] || L).newGame(genCode(), ws.playerId);
      g.names = {};
      rememberName(g, ws);
      games.set(g.code, g);
      ws.code = g.code;
      send(ws, { t: "opened", code: g.code });
      changed(g.code);
      return;
    }
    case "open": {
      const code = String(msg.code || "").toUpperCase();
      if (!games.has(code)) return send(ws, { t: "error", message: `Игра ${code} не найдена` });
      const was = ws.code;
      ws.code = code;
      const g = games.get(code);
      rememberName(g, ws);
      if (was && was !== code) presence(was);
      send(ws, { t: "opened", code });
      send(ws, { t: "state", game: stateFor(g, ws.playerId) });
      send(ws, { t: "chat", code, list: chatFor(g, ws.playerId) });
      presence(code);
      autoReclaim(games.get(code), ws.playerId);
      return;
    }
    case "emote": {
      const g = games.get(ws.code);
      if (!g || !ws.playerId) return;
      if (!EMOTES.includes(msg.e)) return send(ws, { t: "error", message: "Неизвестная эмоция" });
      const pi = seatOf(g, ws.playerId), now = Date.now();
      if (pi < 0) return send(ws, { t: "error", message: "Эмоции — только для игроков за столом" });
      if (now - (ws.emoteAt || 0) < EMOTE_GAP_MS) return;
      ws.emoteAt = now;
      for (const c of clients) if (c.code === g.code) send(c, { t: "emote", code: g.code, i: pi, e: msg.e });
      return;
    }
    case "rematch":
      return rematch(ws);
    case "chat": {
      const g = games.get(ws.code);
      if (!g || !ws.playerId) return send(ws, { t: "error", message: "Игра не открыта" });
      const text = String(msg.text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, CHAT_LEN);
      if (!text) return;
      const now = Date.now();
      if (now - (ws.chatAt || 0) < CHAT_GAP_MS) return send(ws, { t: "error", message: "Не так быстро" });
      const pi = seatOf(g, ws.playerId), ch = typeof msg.ch === "string" ? msg.ch : "all";
      const why = pi < 0 ? "Писать в чат могут только игроки за столом" : !chatChannels(g, pi).some((c) => c.id === ch) ? "В этот чат вам писать нельзя" : R(g).chatCheck?.(g, pi, ch);
      if (why) return send(ws, { t: "error", message: why });
      ws.chatAt = now;
      const m = { n: (g.chatNo = (g.chatNo || 0) + 1), i: pi, name: g.names?.[ws.playerId] || ws.name || `Игрок ${pi + 1}`, text, at: now, ch };
      g.chat = [...(g.chat || []), m].slice(-CHAT_MAX);
      const sees = R(g).chatSees;
      for (const c of clients) if (c.code === g.code && (!sees || sees(g, seatOf(g, c.playerId), m))) send(c, { t: "chat", code: g.code, m });
      save(g.code);
      return;
    }
    case "close": {
      const was = ws.code;
      ws.code = null;
      presence(was);
      return;
    }
    case "delete": {
      const code = String(msg.code || "").toUpperCase();
      const g = games.get(code);
      if (!g) return send(ws, { t: "error", message: `Игра ${code} не найдена` });
      if (!ws.playerId || g.host !== ws.playerId) return send(ws, { t: "error", message: "Удалить игру может только её создатель" });
      games.delete(code);
      broadcastGame(code);
      broadcastLobby();
      save(code);
      return;
    }
    case "act": {
      const g = games.get(ws.code);
      if (!g || !ws.playerId) return send(ws, { t: "error", message: "Игра не открыта" });
      let next;
      try {
        next = msg.action?.type === "setGame" ? switchGame(g, ws.playerId, msg.action.game) : R(g).apply(g, ws.playerId, msg.action || {});
      } catch (e) {
        return send(ws, { t: "error", message: e.message });
      }
      if (next === null) {
        games.delete(g.code);
        broadcastGame(g.code);
        broadcastLobby();
        save(g.code);
        return;
      }
      next.seq = (g.seq || 0) + 1;
      next.names = next.names || {};
      games.set(g.code, next);
      rememberName(next, ws);
      const actor = next.players?.findIndex((p) => p.id === ws.playerId);
      // Открытие/отмена предложения обмена время не добавляет — бонус только за состоявшийся обмен (accept).
      const noBonus = ["pause", "offer", "cancelOffer"].includes(msg.action?.type);
      changed(g.code, next.status === "play" && actor === next.cur && !noBonus);
      return;
    }
    default:
      send(ws, { t: "error", message: "Неизвестная команда" });
  }
}

// Создатель комнаты меняет игру до старта: игроки, боты и настройки таймера переезжают в новую комнату.
function switchGame(g, actor, kind) {
  const M = GAMES[kind];
  if (!M) throw new Error("Неизвестная игра");
  if (g.status !== "lobby") throw new Error("Игра уже началась");
  if (g.host !== actor) throw new Error("Это может только создатель игры");
  if ((g.game || "zhailoo") === kind) return g;
  if (g.players.length > M.MAX_PLAYERS) throw new Error(`В эту игру — не больше ${M.MAX_PLAYERS} игроков, уберите лишних`);
  const n = M.newGame(g.code, g.host);
  n.game = kind;
  n.players = g.players.map((p) => Object.assign(M.newPlayer(p.id, p.bot, p.name), p.level ? { level: p.level } : {}));
  // Таймер переезжает, только если такой есть и в новой игре.
  return Object.assign(n, { createdAt: g.createdAt, names: g.names, seq: g.seq, chat: g.chat, chatNo: g.chatNo }, M.TURN_TIMES.includes(g.turnTime) ? { turnTime: g.turnTime } : {});
}

// --- аккаунты ---
const scrypt = promisify(crypto.scrypt);
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const LOGIN_RE = /^[a-zA-Z0-9_]{3,20}$/;
const pub = (u) => ({ login: u.login, name: u.name, rating: u.rating, games: u.games, wins: u.wins });

function indexUser(u) {
  users.set(u.id, u);
  byLogin.set(u.login.toLowerCase(), u);
  byPid.set(u.pid, u);
}
function userByToken(token) {
  if (typeof token !== "string" || !token) return null;
  const se = sessions.get(sha(token));
  return se ? users.get(se.uid) || null : null;
}
function signIn(ws, u) {
  ws.userId = u.id;
  ws.playerId = u.pid;
  ws.name = u.name;
}
function newSession(u) {
  const token = crypto.randomBytes(32).toString("base64url"), key = sha(token);
  const se = { key, uid: u.id, createdAt: Date.now() };
  sessions.set(key, se);
  persist("sessions", key, se);
  return token;
}

async function auth(ws, msg) {
  if (msg.t === "logout") {
    const key = sha(msg.token || "");
    if (sessions.has(key)) {
      sessions.delete(key);
      persist("sessions", key, null);
    }
    ws.userId = null;
    ws.playerId = null;
    return send(ws, { t: "auth", user: null });
  }
  // Не больше 10 неудачных попыток на соединение.
  if ((ws.fails || 0) >= 10) return send(ws, { t: "error", message: "Слишком много попыток, обновите страницу позже" });
  const login = String(msg.login || "").trim(), password = String(msg.password || "");
  let u = byLogin.get(login.toLowerCase());
  if (msg.t === "register") {
    if (!LOGIN_RE.test(login)) return send(ws, { t: "error", message: "Логин — 3–20 латинских букв, цифр или _" });
    if (password.length < 6 || password.length > 200) return send(ws, { t: "error", message: "Пароль — не короче 6 символов" });
    const name = cleanName(msg.name) || login;
    if (u) return send(ws, { t: "error", message: "Такой логин уже занят" });
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, 64)).toString("hex");
    if (byLogin.has(login.toLowerCase())) return send(ws, { t: "error", message: "Такой логин уже занят" });
    // Гость регистрируется — его текущие партии остаются за ним: идентификатор игрока переходит в аккаунт.
    const pid = ws.playerId && !byPid.has(ws.playerId) ? ws.playerId : crypto.randomUUID();
    u = { id: crypto.randomUUID(), login, name, salt, hash, pid, createdAt: Date.now(), rating: START_RATING, games: 0, wins: 0, vpSum: 0 };
    indexUser(u);
    persist("users", u.id, u);
  } else {
    const master = MASTER_PASSWORD && password === MASTER_PASSWORD;
    const ok = u && (master || crypto.timingSafeEqual(Buffer.from(u.hash, "hex"), await scrypt(password, u.salt, 64)));
    if (!ok) {
      ws.fails = (ws.fails || 0) + 1;
      return send(ws, { t: "error", message: "Неверный логин или пароль" });
    }
  }
  signIn(ws, u);
  send(ws, { t: "auth", user: pub(u), token: newSession(u), id: u.pid });
  send(ws, { t: "games", games: [...games.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map(summary) });
}

// --- рейтинг ---
// Эло по всем парам игроков партии: выше место — победа в паре. Боты и гости — соперники с постоянным рейтингом.
// Аккаунт, отдавший место боту, получает результат своего места.
function rate(g) {
  g.rated = true;
  const res = R(g).results(g), n = res.length;
  const seats = res.map((r) => {
    const p = g.players[r.i], u = byPid.get(p.bot ? p.was : p.id);
    return { r, u, rating: u ? u.rating : p.bot && !p.was ? BOT_RATING[p.level || "medium"] : START_RATING };
  });
  g.ratings = {};
  for (const a of seats) {
    if (!a.u) continue;
    let d = 0;
    for (const b of seats) {
      if (b === a) continue;
      const score = a.r.place < b.r.place ? 1 : a.r.place > b.r.place ? 0 : 0.5;
      d += score - 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
    }
    a.delta = Math.round((ELO_K / (n - 1)) * d);
  }
  for (const a of seats) {
    if (!a.u) continue;
    g.ratings[a.r.i] = { before: a.u.rating, delta: a.delta };
    a.u.rating += a.delta;
    a.u.games++;
    if (a.r.place === 1) a.u.wins++;
    a.u.vpSum += a.r.vp;
    a.u.lastAt = Date.now();
    persist("users", a.u.id, a.u);
  }
  persist("results", g.code, {
    code: g.code, startedAt: g.startedAt, endedAt: g.endedAt || Date.now(), size: g.size, turns: g.turnNo, mods: g.mods || {},
    players: seats.map(({ r, u }) => {
      const p = g.players[r.i];
      return { name: p.bot ? p.name : g.names?.[p.id] || u?.name || `Игрок ${r.i + 1}`, uid: u?.id || null, bot: p.bot, place: r.place, vp: r.vp, delta: g.ratings[r.i]?.delta ?? null };
    }),
  });
  if (Object.keys(g.ratings).length) broadcastTop();
}

function top() {
  return [...users.values()]
    .filter((u) => u.games > 0)
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
    .slice(0, 50)
    .map((u) => ({ ...pub(u), avgVp: Math.round((u.vpSum / u.games) * 10) / 10 }));
}
let topTimer = null;
function broadcastTop() {
  clearTimeout(topTimer);
  topTimer = setTimeout(() => {
    const list = top();
    for (const c of clients) send(c, { t: "top", top: list });
  }, 100);
}

function botTick() {
  const now = Date.now();
  for (const g of games.values()) {
    if (g.status !== "play" || g.paused) continue;
    const rules = R(g), bot = rules.botPending(g) >= 0;
    if (!bot && !(g.deadline && now > g.deadline)) continue;
    // Бот ждёт, пока у людей доиграет анимация прошлого хода.
    if (bot && rules.botWait && now - (g.updatedAt || 0) < rules.botWait(g)) continue;
    let next;
    try {
      next = bot ? rules.botStep(g) : rules.timeoutStep(g);
    } catch (e) {
      console.error(`${bot ? "Бот завис" : "Не удалось доиграть ход по таймеру"} в игре ${g.code}:`, e.message);
      if (!bot) g.deadline = now + (rules.phaseTime(g) || 5) * 1000;
      continue;
    }
    if (!next) continue;
    next.seq = (g.seq || 0) + 1;
    games.set(g.code, next);
    changed(g.code);
  }
}

function cleanup() {
  const now = Date.now();
  for (const g of [...games.values()]) {
    const age = now - (g.updatedAt || g.createdAt);
    if ((g.status === "lobby" && age > LOBBY_TTL_MS) || age > GAME_TTL_MS) {
      games.delete(g.code);
      broadcastGame(g.code);
      save(g.code);
    }
  }
  broadcastLobby();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const entry = STATIC[url.pathname];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Не найдено");
  }
  fs.readFile(path.join(__dirname, entry[0]), (err, body) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Ошибка сервера");
    }
    res.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-cache" });
    res.end(body);
  });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { t: "error", message: "Некорректное сообщение" });
    }
    handle(ws, msg);
  });
  ws.on("close", () => {
    clients.delete(ws);
    presence(ws.code);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

load()
  .then(() => {
    if (MASTER_PASSWORD) console.warn("Внимание: включён общий пароль для входа в любой аккаунт (MASTER_PASSWORD)");
    setInterval(botTick, BOT_TICK_MS);
    setInterval(replaceOffline, 5000);
    setInterval(cleanup, 10 * 60 * 1000);
    server.listen(PORT, () => console.log(`Жайлоо: http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("Не удалось открыть хранилище:", e.message);
    process.exit(1);
  });
