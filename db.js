// Хранилище «ключ → JSON» по видам записей (games, users, sessions, results).
// С DATABASE_URL всё лежит в Postgres и переживает деплой; без неё — в файлах data/<вид>.json (для локального запуска).
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function fileStore() {
  const kinds = new Map(), timers = new Map();
  const file = (kind) => path.join(DATA_DIR, `${kind}.json`);
  const flush = (kind) => {
    timers.delete(kind);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file(kind) + ".tmp";
    fs.writeFile(tmp, JSON.stringify(Object.fromEntries(kinds.get(kind))), (err) => {
      if (err) return console.error(`Не удалось сохранить ${kind}:`, err.message);
      fs.rename(tmp, file(kind), (e) => e && console.error(`Не удалось сохранить ${kind}:`, e.message));
    });
  };
  const touch = (kind) => timers.has(kind) || timers.set(kind, setTimeout(() => flush(kind), 500));
  return {
    name: "файлы data/",
    async init() {},
    async all(kind) {
      let m = new Map();
      try {
        const raw = JSON.parse(fs.readFileSync(file(kind), "utf8"));
        // Старый формат games.json — массив партий.
        m = new Map(Array.isArray(raw) ? raw.map((g) => [g.code, g]) : Object.entries(raw));
      } catch {}
      kinds.set(kind, m);
      return [...m.values()];
    },
    async put(kind, key, data) {
      if (!kinds.has(kind)) await this.all(kind);
      kinds.get(kind).set(key, data);
      touch(kind);
    },
    async del(kind, key) {
      if (!kinds.has(kind)) await this.all(kind);
      kinds.get(kind).delete(key);
      touch(kind);
    },
  };
}

function pgStore(url) {
  const { Pool } = require("pg");
  // SSL задаётся в самой строке подключения (?sslmode=require у Neon и внешнего адреса Render).
  const pool = new Pool({ connectionString: url, max: 4 });
  pool.on("error", (e) => console.error("Postgres:", e.message));
  return {
    name: "Postgres",
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS kv (
        kind text NOT NULL, key text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, key))`);
    },
    async all(kind) {
      const { rows } = await pool.query("SELECT data FROM kv WHERE kind = $1", [kind]);
      return rows.map((r) => r.data);
    },
    async put(kind, key, data) {
      await pool.query(
        `INSERT INTO kv (kind, key, data) VALUES ($1, $2, $3)
         ON CONFLICT (kind, key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [kind, key, JSON.stringify(data)],
      );
    },
    async del(kind, key) {
      await pool.query("DELETE FROM kv WHERE kind = $1 AND key = $2", [kind, key]);
    },
  };
}

module.exports = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore();
