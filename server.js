const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const L = require("./shared/logic.js");

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, "data", "games.json");
const BOT_TICK_MS = 700;
const LOBBY_TTL_MS = 6 * 60 * 60 * 1000;
const GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATIC = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/client.js": ["public/client.js", "text/javascript; charset=utf-8"],
  "/logic.js": ["shared/logic.js", "text/javascript; charset=utf-8"],
};

const games = new Map();
const clients = new Set();

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    for (const g of list) {
      // После перезапуска у всех текущий отрезок таймера начинается заново.
      const t = g.status === "play" ? L.phaseTime(g) : 0;
      if (t && !g.paused) g.deadline = Date.now() + t * 1000;
      games.set(g.code, g);
    }
    console.log(`Загружено партий: ${games.size}`);
  } catch {
    console.log("Сохранённых партий нет, начинаем с чистого листа");
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify([...games.values()]), (err) => {
      if (err) return console.error("Не удалось сохранить партии:", err.message);
      fs.rename(tmp, DATA_FILE, (e) => e && console.error("Не удалось сохранить партии:", e.message));
    });
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
    if (p.id !== viewerId) {
      p.res = L.emptyRes();
      p.dev = [];
    }
  }
  v.deckCount = v.deck.length;
  v.deck = [];
  return v;
}

function summary(g) {
  return {
    code: g.code,
    status: g.status,
    createdAt: g.createdAt,
    host: g.host,
    players: g.players.map((p, i) => ({ id: p.id, bot: p.bot, name: p.bot ? p.name : g.names?.[p.id] || `Игрок ${i + 1}` })),
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastGame(code) {
  const g = games.get(code);
  for (const c of clients) {
    if (c.code !== code) continue;
    if (g) send(c, { t: "state", game: viewFor(g, c.playerId) });
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
  const key = L.turnKey(g), full = L.phaseTime(g) * 1000, fresh = key !== g.timerKey;
  g.timerKey = key;
  if (!full) delete g.deadline;
  else if (fresh || !g.deadline) g.deadline = now + full;
  else if (bonus) g.deadline = Math.min(g.deadline + L.TIMER.bonus * 1000, now + full);
}

function changed(code, bonus) {
  const g = games.get(code);
  if (g) {
    g.updatedAt = Date.now();
    touchTimer(g, bonus);
  }
  broadcastGame(code);
  broadcastLobby();
  save();
}

function rememberName(g, ws) {
  if (!g.names) g.names = {};
  if (ws.name && g.players.some((p) => p.id === ws.playerId)) g.names[ws.playerId] = ws.name;
}

function handle(ws, msg) {
  switch (msg.t) {
    case "hello": {
      if (typeof msg.id !== "string" || !/^[a-zA-Z0-9-]{8,64}$/.test(msg.id)) return send(ws, { t: "error", message: "Неверный идентификатор игрока" });
      ws.playerId = msg.id;
      ws.name = cleanName(msg.name);
      send(ws, { t: "welcome", id: ws.playerId });
      send(ws, { t: "games", games: [...games.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map(summary) });
      return;
    }
    case "rename": {
      ws.name = cleanName(msg.name);
      for (const g of games.values()) {
        if (g.players.some((p) => p.id === ws.playerId)) {
          rememberName(g, ws);
          broadcastGame(g.code);
        }
      }
      broadcastLobby();
      save();
      return;
    }
    case "create": {
      if (!ws.playerId) return;
      const g = L.newGame(genCode(), ws.playerId);
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
      ws.code = code;
      const g = games.get(code);
      rememberName(g, ws);
      send(ws, { t: "opened", code });
      send(ws, { t: "state", game: viewFor(g, ws.playerId) });
      return;
    }
    case "close": {
      ws.code = null;
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
      save();
      return;
    }
    case "act": {
      const g = games.get(ws.code);
      if (!g || !ws.playerId) return send(ws, { t: "error", message: "Игра не открыта" });
      let next;
      try {
        next = L.apply(g, ws.playerId, msg.action || {});
      } catch (e) {
        return send(ws, { t: "error", message: e.message });
      }
      if (next === null) {
        games.delete(g.code);
        broadcastGame(g.code);
        broadcastLobby();
        save();
        return;
      }
      next.seq = (g.seq || 0) + 1;
      next.names = next.names || {};
      games.set(g.code, next);
      rememberName(next, ws);
      const actor = next.players?.findIndex((p) => p.id === ws.playerId);
      changed(g.code, next.status === "play" && actor === next.cur && msg.action?.type !== "pause");
      return;
    }
    default:
      send(ws, { t: "error", message: "Неизвестная команда" });
  }
}

function botTick() {
  const now = Date.now();
  for (const g of games.values()) {
    if (g.status !== "play" || g.paused) continue;
    const bot = L.botPending(g) >= 0;
    if (!bot && !(g.deadline && now > g.deadline)) continue;
    let next;
    try {
      next = bot ? L.botStep(g) : L.timeoutStep(g);
    } catch (e) {
      console.error(`${bot ? "Бот завис" : "Не удалось доиграть ход по таймеру"} в игре ${g.code}:`, e.message);
      if (!bot) g.deadline = now + (L.phaseTime(g) || L.TIMER.roll) * 1000;
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
    }
  }
  broadcastLobby();
  save();
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
  ws.on("close", () => clients.delete(ws));
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

load();
setInterval(botTick, BOT_TICK_MS);
setInterval(cleanup, 10 * 60 * 1000);
server.listen(PORT, () => console.log(`Жайлоо: http://localhost:${PORT}`));
