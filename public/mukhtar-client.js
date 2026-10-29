// Экран «Мухтара»: тропа-змейка от аила к развилке и ветки к пещерам, волки и пёс, рука карт,
// выбор цели и пещеры, шёпот и предпросмотр хода.
// Грузится до client.js и пользуется его общими помощниками (ui, game, act, ava, ICON…) только из функций.
const MU = MUKHTAR;
// Анимации последнего хода: кто куда сдвинулся, кого поймали.
const mfx = { ev: null, open: null };

function mukhtarNotice(old, s) {
  const me = myIndex(), now = Date.now();
  if (!old || old.code !== s.code || old.status === "lobby") return;
  if (s.fx && (!old.fx || old.fx.n !== s.fx.n)) {
    mfx.ev = { ev: s.fx.ev, t: now, ...MU.timeline(s.fx.ev) };
    for (const e of s.fx.ev) {
      if (e.k === "catch" && e.p === me) toast("Мухтар поймал вас! Теперь вы тайган — помогайте ему ловить остальных");
      else if (e.k === "catch") toast(`Мухтар поймал: ${nameOf(s, e.p)}`);
      if (e.k === "bite" && e.t === me) toast(`${nameOf(s, e.p)} отнимает у вас ягнёнка!`);
    }
  }
  if (s.status === "play") s.caves.forEach((C, c) => {
    const O = old.caves && old.caves[c];
    if (O && !O.open && C.open) { mfx.open = { c, t: now }; toast(C.full && !C.n ? `${C.name} пещера завалена наглухо!` : `${C.name} пещера: ${C.cap} ${plural(C.cap, "место", "места", "мест")}`); }
  });
  if (s.status === "play" && me >= 0 && s.cur === me && (old.cur !== me || old.turnNo !== s.turnNo)) fx.turn = { t: now };
  if (old.turnNo !== s.turnNo || s.cur !== me || s.status !== "play") { ui.mk = null; ui.mtake = null; }
}

// --- поле ---
// Общая тропа идёт змейкой по 8 клеток снизу вверх: аил внизу слева, развилка справа на третьем ряду.
// От развилки ветки уходят вверх и налево — каждая к своей пещере у левого края.
const M_COLS = 8, M_W = 9.25, M_H = 7.35, M_FX = 8.62;
const M_ROWS = [6.6, 5.2, 3.8];
const mBranchY = (k) => (k === 3 ? [0.75, 1.75, 2.75] : k === 2 ? [1.1, 2.45] : [1.8]);
function mAt(c, br, k = game?.caves?.length || 3) {
  if (br == null || c <= MU.FORK) {
    const cc = Math.min(c, MU.FORK), row = Math.floor(cc / M_COLS), col = cc % M_COLS, xi = row % 2 ? M_COLS - 1 - col : col;
    return [0.62 + xi * 1.143, M_ROWS[row]];
  }
  const y = mBranchY(k)[br], j = c - MU.FORK;
  return j >= MU.LEN - MU.FORK ? [0.62, y] : [M_FX - j * 1.143, y];
}
const mCaveAt = (c, k) => mAt(MU.LEN, c, k);
// Несколько волков на одной клетке встают кружком.
function mSpots(k) {
  if (k <= 1) return [[0, 0]];
  const r = k === 2 ? 0.2 : 0.24;
  return Array.from({ length: k }, (_, i) => { const a = (k === 2 ? 0 : -Math.PI / 2) + (i * 2 * Math.PI) / k; return [Math.cos(a) * r, Math.sin(a) * r]; });
}
const mWolfHead = () => `<path d="M-.15,-.04 L-.14,-.21 L-.05,-.11 L.05,-.11 L.14,-.21 L.15,-.04 Q.16,.06 .07,.11 L0,.17 L-.07,.11 Q-.16,.06 -.15,-.04Z" fill="#70737d" stroke="#2a2c33" stroke-width=".018" stroke-linejoin="round"/>
  <path d="M-.06,.06 Q0,.02 .06,.06 L0,.16Z" fill="#d9dbe0"/><path d="M-.11,-.15 L-.09,-.08 M.11,-.15 L.09,-.08" stroke="#c9a2a2" stroke-width=".02"/>
  <circle cx="-.06" cy="-.02" r=".018" fill="#f2c94c"/><circle cx=".06" cy="-.02" r=".018" fill="#f2c94c"/><circle cy=".14" r=".022" fill="#1d1d1d"/>`;
const mDogHead = (fur = "#c98a4b") => `<ellipse cx="-.14" cy="-.01" rx=".065" ry=".13" transform="rotate(18 -.14 -.01)" fill="#6b4423" stroke="#2a1a0c" stroke-width=".016"/>
  <ellipse cx=".14" cy="-.01" rx=".065" ry=".13" transform="rotate(-18 .14 -.01)" fill="#6b4423" stroke="#2a1a0c" stroke-width=".016"/>
  <circle r=".14" fill="${fur}" stroke="#2a1a0c" stroke-width=".018"/><ellipse cy=".06" rx=".08" ry=".06" fill="#f1d9b5"/>
  <ellipse cy=".03" rx=".035" ry=".025" fill="#1d1d1d"/><circle cx="-.055" cy="-.04" r=".019" fill="#1d1d1d"/><circle cx=".055" cy="-.04" r=".019" fill="#1d1d1d"/>
  <path d="M-.11,.12 Q0,.18 .11,.12" fill="none" stroke="#d8402f" stroke-width=".035" stroke-linecap="round"/><circle cy=".165" r=".02" fill="#f2c94c"/>`;
const mSheep = (x, y, k = 1) => `<g transform="translate(${f(x)} ${f(y)}) scale(${k})"><path d="M-.05,.02 v.05 M.04,.02 v.05" stroke="#4a4a42" stroke-width=".02"/><ellipse rx=".09" ry=".06" fill="#fbfbf3" stroke="#7d7d70" stroke-width=".016"/><circle cx=".085" cy="-.025" r=".035" fill="#3a3a36"/></g>`;
const mBush = (x, y, k = 1) => `<g transform="translate(${f(x)} ${f(y)}) scale(${k})"><circle cx="-.12" cy=".02" r=".12" fill="#3d7a2c"/><circle cx=".12" cy=".02" r=".12" fill="#3d7a2c"/><circle cy="-.07" r=".15" fill="#4f9437"/><circle cx="-.05" cy="-.1" r=".04" fill="#7cc35a" opacity=".7"/></g>`;
const mYurt = (x, y, k = 1) => `<g transform="translate(${f(x)} ${f(y)}) scale(${k})"><path d="M-.2,.08 V0 Q0,-.22 .2,0 V.08Z" fill="#fdf8ec" stroke="#6b4423" stroke-width=".025"/><path d="M-.2,.02 Q0,-.02 .2,.02" fill="none" stroke="#c0392b" stroke-width=".03"/><rect x="-.04" y=".0" width=".08" height=".08" fill="#8a4b22"/></g>`;
const mRocks = (x, y) => `<g transform="translate(${f(x)} ${f(y)})"><path d="M-.2,.12 L-.12,-.06 L.0,.0 L.06,-.12 L.2,.12Z" fill="#7d838c" stroke="#3a3d45" stroke-width=".02"/></g>`;

// Фишка волка: кружок цвета игрока, внутри морда. ghost — где волк окажется после выбранного хода.
function mWolf(s, i, x, y, o = {}) {
  const p = s.players[i];
  return `<g class="mpiece mwolf ${o.cls || ""}" transform="translate(${f(x)} ${f(y)})${o.k ? ` scale(${o.k})` : ""}" ${o.attr || ""}><g class="mbody" ${o.anim || ""}>
    <title>${esc(nameOf(s, i))}${o.title || ""}</title>
    <ellipse cy=".23" rx=".2" ry=".06" fill="rgba(0,0,0,.3)"/>
    <circle r=".25" fill="${p.color}" stroke="#fff" stroke-width=".045"/>${mWolfHead()}
    ${p.lambs ? `<g transform="translate(.2 .17)"><circle r=".11" fill="#fff" stroke="#7d7d70" stroke-width=".015"/><text class="mcnt" y=".045">${p.lambs}</text></g>` : ""}</g></g>`;
}
function mDog(x, y, anim = "") {
  return `<g class="mpiece mdog" transform="translate(${f(x)} ${f(y)})"><g class="mbody" ${anim}><title>Мухтар</title>
    <ellipse cy=".3" rx=".26" ry=".07" fill="rgba(0,0,0,.3)"/><circle r=".31" fill="#3b2a1b" stroke="#fff" stroke-width=".05"/><g transform="scale(1.45)">${mDogHead()}</g></g></g>`;
}
// Анимация хода. Точки — {t, x, y, o}: время в мс от начала хода, смещение в клетках поля от места, где фишка стоит
// в новом состоянии, и прозрачность. Играется через Web Animations после вставки HTML с поправкой на прошедшее время,
// поэтому перерисовка посреди анимации её не сбивает. k — масштаб фишки.
function mAnim(pts, e, k = 1) {
  if (!e || pts.length < 2) return "";
  const t0 = pts[0].t, span = Math.max(1, pts[pts.length - 1].t - t0);
  const kf = pts.map((p) => ({ offset: +((p.t - t0) / span).toFixed(4), translate: `${f((p.x || 0) / k)}px ${f((p.y || 0) / k)}px`, opacity: p.o ?? 1, easing: p.ease || "ease-in-out" }));
  return `data-manim='${JSON.stringify({ kf, at: t0, dur: span, t: e.t })}'`;
}
function mRunAnims() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const now = Date.now();
  for (const el of document.querySelectorAll("[data-manim]")) {
    try {
      const a = JSON.parse(el.dataset.manim);
      el.animate(a.kf, { duration: a.dur, delay: a.at, fill: "both" }).currentTime = now - a.t;
    } catch {}
  }
}
// Путь по клеткам за ход: каждая клетка — точка во времени. end — где фишка стоит в итоге.
function mPathPts(moves, fxe, end) {
  const pts = [];
  for (const { e, i } of moves) {
    const { at, dur } = fxe.T[i], r = MU.route(e.from, e.fromBr ?? null, e.to, e.br ?? null), n = r.length - 1 || 1;
    r.forEach(([c, b], j) => { const [x, y] = mAt(c, b); pts.push({ t: at + (dur * j) / n, x: x - end[0], y: y - end[1] }); });
  }
  return pts;
}
// Фишка, которая ушла с тропы (поймана или в пещере): доходит до места и тает.
function mGonePts(moves, fxe, end, at) {
  const pts = mPathPts(moves, fxe, end);
  if (!pts.length) pts.push({ t: 0, x: 0, y: 0 });
  const l = pts[pts.length - 1];
  pts.push({ t: Math.max(at, l.t), x: l.x, y: l.y }, { t: Math.max(at, l.t) + 450, x: l.x, y: l.y - 0.25, o: 0 });
  return pts;
}
// Появиться в момент at (дырка в пещере, новый тайган).
const mShowPts = (at) => [{ t: 0, o: 0 }, { t: at, o: 0 }, { t: at + 350, o: 1 }];
// Что сейчас выбирают кликом по пещере: место для «Завала», цель бега или ничего.
function mCaveClick(s, me) {
  const P = s.players[me];
  if (!P || P.role !== "wolf" || s.status !== "play") return null;
  const k = ui.mk;
  if (k && k.act === "play" && s.cur === me && mCard(P.hand[k.card])?.rock) return "rock";
  return P.br == null ? "aim" : null;
}

function mBoardSVG(s, me, pv) {
  const fxe = mfx.ev && Date.now() - mfx.ev.t < mfx.ev.total + 600 ? mfx.ev : null, K = s.caves.length, P = s.players[me];
  // Что случилось в последнем ходе: пути фишек, кто куда вошёл, кого поймали.
  const movesOf = {}, dogMoves = [], evOf = (k) => (fxe ? fxe.ev.map((e, i) => ({ e, i })).filter((x) => x.e.k === k) : []);
  if (fxe) fxe.ev.forEach((e, i) => {
    if (e.k === "move") (movesOf[e.p] = movesOf[e.p] || []).push({ e, i });
    if (e.k === "dog") dogMoves.push({ e, i });
  });
  const entered = {}, caughtAt = {};
  for (const { e, i } of evOf("cave")) entered[e.p] = fxe.T[i].at;
  for (const { e, i } of evOf("catch")) caughtAt[e.p] = fxe.T[i].at;
  const rocked = {};
  for (const { e, i } of evOf("rock")) rocked[e.c] = fxe.T[i].at;
  let o = `<svg class="mboard" viewBox="0 0 ${M_W} ${M_H}" role="img" aria-label="Тропа к пещерам">
    <defs><linearGradient id="mg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f9aa3"/><stop offset=".42" stop-color="#a9b48f"/><stop offset=".55" stop-color="#9cc068"/><stop offset="1" stop-color="#7fb04f"/></linearGradient>
    <linearGradient id="mg-rock" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d636b"/><stop offset="1" stop-color="#8d949c"/></linearGradient>
    <linearGradient id="mg-water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6cbdf0"/><stop offset="1" stop-color="#3489cc"/></linearGradient></defs>
    <rect class="mground" width="${M_W}" height="${M_H}" rx=".3" fill="url(#mg-sky)"/>
    <path d="M0,0 H1.15 L1.4,.6 L1.05,1.3 L1.45,2.1 L1.1,2.9 L1.35,3.3 L0,3.4Z" fill="url(#mg-rock)" opacity=".95"/>`;
  // Ветки: от развилки вверх по правому краю, потом налево к пещере.
  const by = mBranchY(K), [fx0, fy0] = mAt(MU.FORK, null);
  const trail = (d) => `<path d="${d}" fill="none" stroke="#8a6234" stroke-width=".56" stroke-linejoin="round" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#d9c38c" stroke-width=".44" stroke-linejoin="round" stroke-linecap="round"/>`;
  by.forEach((y, c) => (o += trail(`M${f(fx0)},${f(fy0)} L${f(M_FX)},${f(y)} L${f(0.62)},${f(y)}`)));
  // Общая тропа и реки поперёк неё.
  const line = "M" + Array.from({ length: MU.FORK + 1 }, (_, c) => mAt(c, null)).map((p) => `${f(p[0])},${f(p[1])}`).join(" L");
  o += `<path d="${line}" fill="none" stroke="#8a6234" stroke-width=".62" stroke-linejoin="round" stroke-linecap="round"/><path d="${line}" fill="none" stroke="#e8d3a0" stroke-width=".5" stroke-linejoin="round" stroke-linecap="round"/>`;
  for (let c = 0; c < MU.FORK; c++) if (s.path[c] === "river") {
    const [x, y] = mAt(c, null), d = `M${f(x - 0.12)},${f(y - 0.68)} q.14,.17 0,.34 q-.14,.17 0,.34 q.14,.17 0,.34 q-.14,.17 0,.34`;
    o += `<path d="${d}" fill="none" stroke="#2a6fa8" stroke-width=".34"/><path d="${d}" fill="none" stroke="url(#mg-water)" stroke-width=".26"/>`;
  }
  const [ax, ay] = mAt(0, null);
  o += mYurt(ax - 0.05, ay + 0.55, 1.3) + mYurt(ax + 0.42, ay + 0.61, 1);
  // Клетки общей тропы.
  for (let c = 0; c <= MU.FORK; c++) {
    const [x, y] = mAt(c, null), t = s.path[c], near = c === s.mx + 1 && s.sniff === c, fork = c === MU.FORK;
    o += `<g class="mcell k-${fork ? "fork" : t || "plain"}"><title>Клетка ${c}${fork ? " — развилка: дальше Мухтар не бежит" : t ? ` — ${MU.CELL_RU[t].toLowerCase()}` : ""}${t === "flock" ? `, ягнят: ${s.flock[c] || 0}` : ""}</title>
      <circle cx="${f(x)}" cy="${f(y)}" r=".36" class="mcell-c"/>`;
    if (t === "bush") o += mBush(x, y + 0.02, 1.25) + (near ? `<text class="msniff" x="${f(x)}" y="${f(y - 0.42)}">чует!</text>` : "");
    if (t === "flock") { const n = s.flock[c] || 0; for (let k = 0; k < Math.max(1, n); k++) o += `<g opacity="${n ? 1 : 0.3}">${mSheep(x - 0.12 + (k % 2) * 0.22, y - 0.08 + Math.floor(k / 2) * 0.17, 1.15)}</g>`; }
    if (fork) o += `<path d="M${f(x - 0.1)},${f(y + 0.06)} L${f(x)},${f(y - 0.16)} L${f(x + 0.1)},${f(y + 0.06)}" fill="none" stroke="#8a6234" stroke-width=".05" stroke-linecap="round"/>`;
    o += `<text class="mnum" x="${f(x)}" y="${f(y + 0.31)}">${c}</text></g>`;
  }
  // Клетки веток и пещеры.
  const click = mCaveClick(s, me);
  s.caves.forEach((C, c) => {
    for (let pos = MU.FORK + 1; pos < MU.LEN; pos++) { const [x, y] = mAt(pos, c); o += `<circle cx="${f(x)}" cy="${f(y)}" r=".3" class="mcell-c mbr ${C.full ? "shut" : ""}"/>`; }
    const [x, y] = mCaveAt(c, K), sel = P && P.aim === c && P.role === "wolf", can = click && !C.full, mine = P && P.whisper && P.whisper.c === c;
    const inside = s.players.map((p, i) => ({ p, i })).filter((w) => w.p.role === "cave" && w.p.cave === c);
    const capTxt = C.cap != null ? `${C.n}/${C.cap}` : `${C.n}/?`;
    o += `<g class="mcave ${sel ? "aim" : ""} ${can ? "can" : ""} ${can && click === "rock" ? "pick" : ""} ${click === "rock" && ui.mk.cave === c ? "sel" : ""} ${C.full ? "full" : ""} ${fxOn(mfx.open, 2000) && mfx.open.c === c ? "fresh" : ""}" ${can ? `data-mcave="${c}"` : ""}>
      <title>${C.name} пещера — ${C.full ? "полна" : C.cap != null ? `${C.n} из ${C.cap} мест занято` : "вместимость неизвестна"}${mine ? `. Ваш шёпот: ${P.whisper.cap}` : ""}${can ? (click === "rock" ? ". Нажмите, чтобы обрушить здесь место" : ". Нажмите, чтобы бежать сюда") : ""}</title>
      <ellipse cx="${f(x + 0.05)}" cy="${f(y + 0.05)}" rx=".4" ry=".46" class="mcave-ring"/>
      <g ${rocked[c] != null ? mAnim([{ t: 0 }, { t: rocked[c] + 380 }, { t: rocked[c] + 440, x: 0.06 }, { t: rocked[c] + 500, x: -0.06 }, { t: rocked[c] + 560, x: 0.04 }, { t: rocked[c] + 640 }], fxe) : ""}>
      <path d="M${f(x - 0.22)},${f(y + 0.22)} Q${f(x - 0.24)},${f(y - 0.27)} ${f(x + 0.05)},${f(y - 0.28)} Q${f(x + 0.34)},${f(y - 0.27)} ${f(x + 0.32)},${f(y + 0.22)}Z" fill="#1b1d22" stroke="#3a3d45" stroke-width=".04"/>
      ${!C.cap && C.cap != null ? mRocks(x + 0.05, y + 0.08) : ""}
      ${inside.map((w, k) => `<circle cx="${f(x - 0.12 + (k % 3) * 0.17)}" cy="${f(y + 0.02 + Math.floor(k / 3) * 0.14)}" r=".075" fill="${w.p.color}" stroke="#fff" stroke-width=".02" ${entered[w.i] != null ? mAnim(mShowPts(entered[w.i] + 250), fxe) : ""}/>`).join("")}</g>
      ${rocked[c] != null ? `<g ${mAnim([{ t: 0, y: -0.9, o: 0 }, { t: rocked[c], y: -0.9, o: 0 }, { t: rocked[c] + 60, y: -0.9 }, { t: rocked[c] + 420, ease: "ease-in" }, { t: rocked[c] + 900 }, { t: rocked[c] + 1300, o: 0 }], fxe)}>${mRocks(x + 0.05, y - 0.05)}</g>` : ""}
      <g class="mcave-tag" transform="translate(${f(x + 0.08)} ${f(y + 0.38)})"><rect x="-.58" y="-.11" width="1.16" height=".22" rx=".11"/><text y=".05">${esc(C.name)} ${capTxt}</text></g>
      ${sel ? `<text class="maim" x="${f(x + 0.62)}" y="${f(y + 0.08)}">◀</text>` : ""}</g>`;
  });
  // Вспышки на месте поимки — в тот миг, когда Мухтар добежал.
  for (const { e, i } of evOf("catch")) { const [x, y] = mAt(e.at, e.br); o += `<circle class="mboom" cx="${f(x)}" cy="${f(y)}" r=".4" style="animation-delay:${fxe.T[i].at - (Date.now() - fxe.t)}ms"/>`; }
  // Предпросмотр: куда встанут фигуры после выбранной карты.
  if (pv && pv.sim) {
    pv.sim.players.forEach((q, i) => {
      const was = s.players[i];
      if (MU.onPath(was) && q.role === "dog") { const [x, y] = mAt(was.pos, was.br); o += `<g class="mcaught" transform="translate(${f(x)} ${f(y)})"><title>${esc(nameOf(s, i))} будет пойман</title><circle r=".34"/><path d="M-.17,-.17 L.17,.17 M.17,-.17 L-.17,.17"/></g>`; }
      else if ((q.role === "wolf" || q.role === "cave") && (q.pos !== was.pos || q.br !== was.br)) { const [x, y] = mAt(q.pos, q.role === "cave" ? q.cave : q.br); o += mWolf(s, i, x, y, { cls: "ghost" }); }
    });
    if (pv.sim.mx !== s.mx) { const [x, y] = mAt(pv.sim.mx, null); o += `<g class="ghost">${mDog(x, y)}</g>`; }
  }
  // Мухтар и тайганы рядом с ним.
  const [dx, dy] = mAt(s.mx, null), dogs = s.players.map((p, i) => ({ p, i })).filter((x) => x.p.role === "dog");
  dogs.forEach((d, k) => {
    const x = dx - 0.36 - (k % 3) * 0.2, y = dy + 0.28 - Math.floor(k / 3) * 0.2;
    const born = caughtAt[d.i] != null ? mAnim(mShowPts(caughtAt[d.i] + 300), fxe) : "";
    o += `<g class="mpiece mtaigan" transform="translate(${f(x)} ${f(y)})"><g ${born}><title>Тайган — ${esc(nameOf(s, d.i))}</title><circle r=".15" fill="${d.p.color}" stroke="#fff" stroke-width=".03"/><g transform="scale(.8)">${mDogHead("#a9a39a")}</g></g></g>`;
  });
  o += mDog(dx, dy, dogMoves.length ? mAnim(mPathPts(dogMoves, fxe, [dx, dy]), fxe) : "");
  // Пойманные и забежавшие в пещеру: доходят до места и тают.
  for (const [i, at] of Object.entries(caughtAt)) {
    const e = fxe.ev.find((x) => x.k === "catch" && x.p === +i), end = mAt(e.at, e.br);
    o += mWolf(s, +i, end[0], end[1], { cls: "mgone", anim: mAnim(mGonePts(movesOf[i] || [], fxe, end, at), fxe) });
  }
  for (const [i, at] of Object.entries(entered)) {
    const end = mCaveAt(s.players[i].cave, K);
    o += mWolf(s, +i, end[0], end[1], { cls: "mgone", anim: mAnim(mGonePts(movesOf[i] || [], fxe, end, at), fxe) });
  }
  // Ягнёнок из отары взлетает над волком, укушенный ягнёнок перелетает к обидчику.
  for (const { e, i } of evOf("lamb")) {
    const [x, y] = mAt(e.at, null), at = fxe.T[i].at;
    o += `<g class="mfly" ${mAnim([{ t: 0, o: 0 }, { t: at, o: 0 }, { t: at + 60 }, { t: at + 800, y: -0.55, o: 0 }], fxe)}>${mSheep(x, y - 0.25, 1.6)}</g>`;
  }
  for (const { e, i } of evOf("bite")) {
    const A = s.players[e.p], B = s.players[e.t];
    if (!MU.onPath(A) || !MU.onPath(B)) continue;
    const [x, y] = mAt(A.pos, A.br), [bx, by] = mAt(B.pos, B.br), at = fxe.T[i].at;
    o += `<g class="mfly" ${mAnim([{ t: at, x: bx - x, y: by - y - 0.3 }, { t: at + 650, y: -0.3 }, { t: at + 1100, y: -0.3, o: 0 }], fxe)}>${mSheep(x, y, 1.6)}</g>`;
  }
  // Волки на тропе и ветках.
  const at = {};
  s.players.forEach((p, i) => { if (MU.onPath(p)) (at[`${p.br ?? "m"}:${p.pos}`] = at[`${p.br ?? "m"}:${p.pos}`] || []).push(i); });
  const tgt = mTargets(s, me);
  for (const key in at) {
    const ids = at[key], p0 = s.players[ids[0]], [x, y] = mAt(p0.pos, p0.br), sp = mSpots(ids.length), k = ids.length > 1 ? 0.72 : 0;
    ids.forEach((i, n) => {
      const p = s.players[i], hid = MU.hidden(s, p), can = tgt.has(i), sel = ui.mk && ui.mk.target === i;
      const where = p.br != null ? `ветка к пещере «${s.caves[p.br].name}»${s.caves[p.br].full ? " (полна — бежит назад)" : ""}` : `клетка ${p.pos}, до Мухтара ${p.pos - s.mx}`;
      o += mWolf(s, i, x + sp[n][0], y + sp[n][1], {
        k,
        cls: `${i === me ? "me" : ""} ${hid ? "hid" : ""} ${can ? "can" : ""} ${sel ? "sel" : ""} ${i === s.cur && s.status === "play" ? "cur" : ""}`,
        attr: can ? `data-mt="${i}"` : "",
        anim: movesOf[i] ? mAnim(mPathPts(movesOf[i], fxe, [x, y]), fxe, k || 1) : "",
        title: ` — ${where}, ягнят ${p.lambs}${hid ? ", прячется в кустах" : ""}${can ? ". Нажмите, чтобы выбрать целью" : ""}`,
      });
    });
  }
  return o + "</svg>";
}

// --- ход игрока ---
const mCard = (key) => MU.CARDS[key];
const mNeedsTarget = (P, key, mode) => (P.role === "dog" ? mode === "drive" : !!(mCard(key).trip || mCard(key).bite));
// Кого можно выбрать целью для выбранной карты.
function mTargets(s, me) {
  const out = new Set(), P = s.players[me], k = ui.mk;
  if (!k || !P || s.status !== "play" || s.cur !== me) return out;
  if (k.act === "give") {
    if (k.card != null) s.players.forEach((Q, j) => { if (j !== me && MU.onPath(Q) && (Q.handCount ?? Q.hand.length)) out.add(j); });
    return out;
  }
  if (k.act !== "play") return out;
  const key = P.hand[k.card];
  if (!key || !mNeedsTarget(P, key, k.mode)) return out;
  s.players.forEach((_, j) => { if (MU.canTarget(s, me, j, P.role === "dog" ? null : mCard(key))) out.add(j); });
  return out;
}
// Действие, которое уйдёт на сервер, если нажать «Сыграть»; null — ещё не всё выбрано.
function mAction(s, me) {
  const k = ui.mk, P = s.players[me], take = ui.mtake ?? undefined;
  if (!k || !P) return null;
  if (k.act === "swap") return k.cards.length ? { type: "swap", cards: k.cards, take } : null;
  if (k.act === "give") return k.card != null && k.target != null ? { type: "give", card: k.card, to: k.target } : null;
  const key = P.hand[k.card];
  if (!key) return null;
  const a = { type: "play", card: k.card, take };
  if (P.role === "dog") { if (!k.mode) return null; a.mode = k.mode; }
  if (P.role === "wolf" && mCard(key).rock) { if (k.cave == null) return null; a.cave = k.cave; }
  if (mNeedsTarget(P, key, k.mode)) {
    if (k.target != null) a.target = k.target;
    else if (mTargets(s, me).size) return null;
  }
  return a;
}
function mCardBlock(s, me, key) {
  const P = s.players[me], C = mCard(key);
  if (P.role === "wolf" && C.bait && !P.lambs) return "Нужен ягнёнок";
  if (P.role === "wolf" && C.rock && s.caves.every((R) => R.full)) return "Все пещеры полны";
  return "";
}
const mCardArt = (key) => {
  const C = mCard(key);
  if (C.all) return `<b class="mbig">+1</b><small>всем</small>`;
  if (C.trip) return `<b class="mbig neg">−2</b><small>другому</small>`;
  if (C.bite) return `<svg viewBox="-.2 -.14 .4 .28" class="mico">${mSheep(0, 0, 1.6)}</svg>`;
  if (C.scent) return `<svg viewBox="-.25 -.25 .5 .5" class="mico">${mDogHead()}</svg>`;
  if (C.rock) return `<svg viewBox="-.25 -.18 .5 .34" class="mico">${mRocks(0, 0)}</svg>`;
  if (C.hush) return `<svg viewBox="-.3 -.28 .6 .44" class="mico">${mBush(0, 0, 1)}</svg>`;
  if (C.bait) return `<b class="mbig">−4</b><small>Мухтару</small>`;
  return `<b class="mbig">+${C.move}</b>`;
};
const mNoise = (n) => `<span class="mnoise" title="Лай ${n}">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`;

function mHint(s, me) {
  if (s.paused) return "Игра на паузе";
  const P = s.players[me], mine = me === s.cur;
  if (!mine) return `${nameOf(s, s.cur)} ${s.players[s.cur].role === "dog" ? "помогает Мухтару" : "выбирает карту"}`;
  const k = ui.mk;
  if (k && k.act === "swap") return k.cards.length ? `Сбросить ${k.cards.length === 1 ? "карту" : "две карты"} и добрать новые — лай раунда +1. Нажмите «Сбросить»` : "Выберите одну или две карты, которые хотите сбросить";
  if (k && k.act === "give") return k.card == null ? "Выберите карту, которую отдадите" : k.target == null ? "Выберите волка на поле: отдадите ему карту и заберёте у него случайную" : "Нажмите «Обменять»";
  if (!k) return P.role === "dog" ? "Вы тайган: выберите карту и сыграйте её как «Лай» или «Загнать»" : P.br == null && P.aim == null ? "Выберите карту (1–3). Нажмите на пещеру, чтобы решить, куда бежать" : "Выберите карту из руки (клавиши 1–3)";
  const key = P.hand[k.card];
  if (P.role === "dog" && !k.mode) return "Лай — Мухтар в конце раунда пробежит дальше. Загнать — волк до развилки отступит на клетку";
  if (P.role === "wolf" && mCard(key).rock && k.cave == null) return "Нажмите на пещеру, где обрушить одно место";
  if (mNeedsTarget(P, key, k.mode) && k.target == null && mTargets(s, me).size) return "Выберите волка на поле — подходящие обведены";
  return "Проверьте предпросмотр на поле и нажмите «Сыграть» (Enter)";
}

// --- правила ---
const MR_TABS = [["goal", "Цель"], ["turn", "Ход"], ["cards", "Карты"], ["path", "Тропа и Мухтар"], ["cave", "Пещеры и шёпот"], ["dogs", "Тайганы"], ["score", "Очки"]];
function mRulesHTML(s) {
  const tab = MR_TABS.some(([k]) => k === ui.mrTab) ? ui.mrTab : "goal";
  const body = {
    goal: `<p>Ночью стая волков утащила ягнят из аила. Теперь волки бегут по горной тропе, а за ними гонится пёс <b>Мухтар</b>. У развилки тропа расходится к нескольким пещерам: <b>Орлиной</b>, <b>Медвежьей</b> и <b>Волчьей</b>.</p>
      <p>Пещеры тесные: почти всегда мест в них вместе меньше, чем волков, а сколько мест в каждой, <b>не знает никто</b>. Пещера спасает, только если её заполнили до отказа. Поэтому до развилки стае выгодно держаться вместе, а у пещер каждый сам за себя.</p>
      <p>Изредка, примерно в одной партии из двенадцати, мест хватает всем, и стая может спастись целиком. Но заранее этого не знает никто, а очки всё равно делят по очереди прихода и ягнятам. Довериться стае или толкнуть соседа — решать вам.</p>
      <p>Пойманный волк не выбывает: он становится <b>тайганом</b>, помогает Мухтару и получает очки за каждого следующего пойманного.</p>
      <p class="hint">Побеждает тот, у кого больше всех очков.</p>`,
    turn: `<ol class="nol">
        <li>Игроки ходят по очереди. Волк в пещере пропускает ходы.</li>
        <li>Все начинают с одинаковой рукой: <b>Шаг, Рысь и Бег</b>. Эти базовые карты не из колоды: сыграли — они уходят из игры. Дальше руку добирают из общей колоды, и у всех она разная.</li>
        <li>В свой ход сделайте одно из трёх:
          <ul>
            <li><b>Сыграть карту</b> из руки.</li>
            <li><b>♻ Сбросить</b> одну или две карты и добрать новые. Мухтар слышит возню: лай раунда +1.</li>
            <li><b>⇄ Обменять</b>: отдать свою карту другому волку на тропе и забрать у него случайную, не глядя. Так договариваются, а можно и подсунуть соседу ненужную «Приманку».</li>
          </ul></li>
        <li>После хода рука добирается до ${MU.HAND} карт. Первую можно взять из <b>открытого ряда</b> (${MU.ROW} карты лежат лицом вверх, все их видят) вместо колоды, но шорох слышен: лай раунда +1.</li>
        <li>У многих карт есть <b>лай</b> (полоски на карте). Лай раунда — это самая громкая карта, сыгранная за раунд.</li>
        <li>Раунд кончается, когда сходил последний игрок за столом. Тогда <b>Мухтар бежит</b> вперёд на столько клеток, каков лай раунда, и ловит тех, кого догнал.</li>
        <li>Под каждым игроком видны его последние карты, а красным подсвечены удары по своим. Нажмите на игрока, чтобы увидеть все его ходы. Под пещерами показано, сколько карт каждого вида ещё не вышло.</li>
        <li><b>Цель</b> (в какую пещеру бежать) и <b>шёпот</b> — не ход: их можно сделать когда угодно, нажав на пещеру на поле или кнопки в списке пещер.</li>
      </ol>`,
    cards: `<div class="ntab-wrap"><table class="ntable"><thead><tr><th>Карта</th><th>Штук</th><th>Что делает</th><th>Лай</th></tr></thead><tbody>
      ${Object.values(MU.CARDS).map((c) => `<tr><td><b>${c.name}</b></td><td class="tn">${c.n}</td><td>${c.text}</td><td>${c.noise}</td></tr>`).join("")}</tbody></table></div>
      <p class="hint">Подножку, укус и загон нельзя направить на волка в кустах. Если подходящей цели нет, «Подножка» работает как шаг на 1, а «Укус» просто сбрасывается. «Завал» может обрушить и последнее место: тогда пещера завалена наглухо.</p>`,
    path: `<ul class="nol">
        <li><b>Мухтар</b> бежит по клетке за раз и на первой клетке с волками ловит всех, кто там стоит. <b>Дальше развилки он не бежит</b>: остаётся и караулит её.</li>
        <li><b>Кусты.</b> Волк в кустах прячется от одного забега: Мухтар замирает рядом («чует!»), а в следующий раз ловит. Ещё на волка в кустах нельзя сыграть подножку, укус или загон.</li>
        <li><b>Река.</b> Тот, кто входит в реку, останавливается на ней, будь то волк или Мухтар.</li>
        <li><b>Отара.</b> Волк, который закончил движение на отаре, утаскивает ягнёнка, пока они там есть.</li>
        <li>Волка, отброшенного к Мухтару или за него, ловят.</li>
        <li><b>Сытый Мухтар.</b> Поймав волка, Мухтар в конце раунда пробегает на ${MU.FED} клетки меньше. Сдать одного — передышка всей остальной стае.</li>
        <li>Волки стартуют с форой в ${s ? MU.headFor(s) : "5"} клеток, в стае из 5–6 волков — на 1–2 клетки больше.</li>
      </ul>`,
    cave: `<ul class="nol">
        <li>Пещер 1 на двоих игроков, 2 на 3–4 и 3 на 5–6. В каждой от 1 до 3 мест. Обычно всего мест меньше, чем волков, но примерно в одной партии из двенадцати их ровно столько, сколько волков.</li>
        <li><b>Цель.</b> На развилке волк сворачивает в ту пещеру, которую выбрал целью. Цель видите только вы. Сменить её можно, пока вы не свернули на ветку.</li>
        <li><b>Шёпот.</b> Один раз за игру выберите пещеру и тайно узнайте, сколько в ней мест. Все увидят, у какой пещеры вы шептались, но ответ знаете только вы. Если пещеру потом завалят, ваш шёпот обновится. Говорить правду или врать — решать вам.</li>
        <li>Вместимость пещеры открывается всем, когда в неё забегает первый волк.</li>
        <li><b>Полная пещера.</b> В неё не войти. Волк, который бежал туда по ветке, разворачивается к развилке и потом сворачивает к своей цели. Если у развилки сидит Мухтар, волк выбегает прямо на него и попадается.</li>
        <li>Игра кончается, когда все пещеры полны или на тропе не осталось волков.</li>
      </ul>`,
    dogs: `<p>Пойманный волк становится <b>тайганом</b>. Ягнята пойманного достаются тайганам как очки. Тайган ходит в общей очереди и играет любую карту одним из двух способов:</p>
      <ul class="nol">${Object.values(MU.DOG_MODES).map((m) => `<li><b>${m.name}</b> — ${m.text}.</li>`).join("")}</ul>
      <p>В расщелины к пещерам тайганы не лезут: волков на ветках они не загоняют. За каждого волка, пойманного после вас, вы получаете ${MU.HUNT} + 1 за каждого его ягнёнка, а в конце ещё по ${MU.FEAST} за каждую незаполненную пещеру.</p>`,
    score: `<div class="ntab-wrap"><table class="ntable"><tbody>
        <tr><td><b>Волк в полной пещере</b></td><td>${MU.CAVE} + ${MU.LAMB} за ягнёнка + за очередь прихода среди всех пещер: 1-й +${MU.ORDER[0]}, 2-й +${MU.ORDER[1]}, 3-й +${MU.ORDER[2]}</td></tr>
        <tr><td><b>Волк в неполной пещере</b></td><td>0: пещеру не удержать</td></tr>
        <tr><td><b>Волк снаружи</b></td><td>0</td></tr>
        <tr><td><b>Тайган</b></td><td>${MU.HUNT} + ягнята за каждого пойманного после него + ${MU.FEAST} за каждую незаполненную пещеру</td></tr></tbody></table></div>
      <p class="hint">Волку в пещере выгодно, чтобы её заполнили, поэтому он зазывает к себе. Волку снаружи выгоднее столкнуть соседа или завалить чужую пещеру.</p>`,
  }[tab];
  return `<div class="nrules"><div class="nrtabs" role="tablist">${MR_TABS.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" role="tab" aria-selected="${k === tab}" data-mrtab="${k}">${t}</button>`).join("")}</div><div class="nrbody">${body}</div></div>`;
}

// --- экран партии ---
function mPlayerRows(s, me) {
  return s.players.map((p, i) => {
    const role = p.role === "cave" ? `<span class="mrole cave">${esc(s.caves[p.cave].name)} · ${p.caveNo}-й</span>` : p.role === "dog" ? `<span class="mrole dog">тайган</span>` : p.br != null ? `<span class="mrole wolf">к пещере «${esc(s.caves[p.br].name)}»</span>` : `<span class="mrole wolf" title="До Мухтара ${p.pos - s.mx}">клетка ${p.pos} · отрыв ${p.pos - s.mx}</span>`;
    const lambs = p.lambs ? `<span title="Ягнята">${mSheepIcon()}${p.lambs}</span>` : "";
    const cards = p.role !== "cave" ? `<span title="Карт в руке">${ICON("cards")}${p.handCount ?? p.hand.length}</span>` : "";
    const wh = p.whispered != null ? `<span class="mwh" title="Шептался у пещеры «${esc(s.caves[p.whispered].name)}»">🤫 ${esc(s.caves[p.whispered].name)}</span>` : "";
    return `<div class="pl mpl ${ui.mpl === i ? "open" : ""} ${i === s.cur && s.status === "play" ? "cur" : ""} ${p.role}" style="--pc:${p.color}" data-mpl="${i}">${ava(nameOf(s, i), p.color)}
      <div style="min-width:0"><div class="nm"><span>${esc(nameOf(s, i))}</span>${i === me ? '<span class="badge">вы</span>' : ""}${offTag(s, i)}${p.bot ? `<span class="badge" title="Бот — сложность: ${LEVEL_RU[p.level || "medium"]}">бот</span>` : ""}</div>
        <div class="pstats">${role}${lambs}${cards}${wh}</div>
        ${mPlayedStrip(s, p)}</div>
      <span class="vp" title="Очки${p.role !== "dog" ? " — волк получит их, только если его пещеру заполнят" : ""}">${p.score}<small>очк.</small></span>
      ${ui.mpl === i ? mPlayedList(s, p) : ""}</div>`;
  }).join("");
}
// Сыгранные карты. Подножка, укус, наводка и завал — удары по своим, они подсвечены красным.
const M_BETRAY = new Set(["trip", "bite", "scent", "rock"]);
function mPlayDesc(s, x) {
  if (x.x === "swap") return `сбросил ${x.n === 1 ? "карту" : "две карты"}`;
  if (x.x === "give") return `обмен вслепую с ${esc(nameOf(s, x.t))}`;
  if (x.m) return x.m === "drive" ? `загнать → ${esc(nameOf(s, x.t))}` : "лай";
  if (x.c != null) return `→ пещера «${esc(s.caves[x.c].name)}»`;
  if (x.t != null) return `→ ${esc(nameOf(s, x.t))}`;
  return "";
}
const mChip = (s, x) => {
  if (x.x) return `<span class="mpc trade" title="Раунд ${x.r}: ${mPlayDesc(s, x).replace(/<[^>]+>/g, "")}">${x.x === "swap" ? "Сброс" : "Обмен"}</span>`;
  const C = mCard(x.k), cls = x.m ? "dog" : M_BETRAY.has(x.k) ? "bad" : C.move ? "go" : "calm";
  return `<span class="mpc ${cls}" title="Раунд ${x.r}: ${C.name}${x.m ? " (тайган)" : ""} ${mPlayDesc(s, x).replace(/<[^>]+>/g, "")}">${x.m ? (x.m === "drive" ? "Загнать" : "Лай") : C.name}</span>`;
};
function mPlayedStrip(s, p) {
  const pl = p.played || [];
  if (!pl.length) return "";
  const bad = pl.filter((x) => !x.m && M_BETRAY.has(x.k)).length;
  return `<div class="mplayed" title="Последние карты — нажмите, чтобы увидеть все">${pl.slice(-3).reverse().map((x) => mChip(s, x)).join("")}${pl.length > 3 ? `<span class="mpc more">+${pl.length - 3}</span>` : ""}${bad ? `<span class="mbad" title="Ударов по своим: подножки, укусы, наводки, завалы">ударов: ${bad}</span>` : ""}</div>`;
}
function mPlayedList(s, p) {
  const pl = p.played || [];
  return `<div class="mhist">${pl.length ? pl.map((x) => `<div><span class="mr">р. ${x.r}</span>${mChip(s, x)}<span class="muted">${mPlayDesc(s, x)}</span></div>`).reverse().join("") : '<span class="muted">Ещё не ходил</span>'}
    <div class="muted">В руке: ${p.handCount ?? p.hand.length} ${plural(p.handCount ?? p.hand.length, "карта", "карты", "карт")}</div></div>`;
}
// Какие карты ещё не вышли: всё, чего нет в сбросе, лежит в колоде или на руках. Когда колода кончится, сброс перемешают обратно.
function mDeckHTML(s) {
  const left = {};
  for (const k in MU.CARDS) left[k] = MU.CARDS[k].n;
  for (const k of s.discard || []) left[k]--;
  return `<div class="mdeck" title="Сколько карт каждого вида ещё в колоде, в открытом ряду и на руках (базовые шаг, рысь и бег не в счёт). Когда колода кончится, сброс перемешают — и счёт начнётся заново">
    <span class="mdeck-h">Ещё не вышли</span>${Object.keys(MU.CARDS).map((k) => `<span class="mpc ${M_BETRAY.has(k) ? "bad" : MU.CARDS[k].move ? "go" : "calm"} ${left[k] ? "" : "zero"}">${MU.CARDS[k].name} <b>${left[k]}</b></span>`).join("")}</div>`;
}
const mSheepIcon = () => `<svg class="msheepi" viewBox="-.12 -.1 .24 .2" aria-hidden="true">${mSheep(0, 0, 1)}</svg>`;
// Пещеры в боковой панели: заполненность, ваша цель и шёпот.
function mCavesHTML(s, me) {
  const P = s.players[me], wolf = P && P.role === "wolf" && s.status === "play";
  return `<div class="mcaves">${s.caves.map((C, c) => {
    const aim = P && P.aim === c, w = P && P.whisper && P.whisper.c === c;
    return `<div class="mcv ${C.full ? "full" : ""} ${aim && wolf ? "aim" : ""}"><b>${esc(C.name)}</b>
      <span class="mcv-n" title="Занято / мест">${C.n} / ${C.cap != null ? C.cap : "?"}${C.cap === 0 ? " · завалена" : C.full ? " · полна" : ""}</span>
      ${w ? `<span class="mcv-w" title="Это знаете только вы">🤫 ${P.whisper.cap} ${plural(P.whisper.cap, "место", "места", "мест")}${P.whisper.rocks ? " (после завала)" : ""}</span>` : ""}
      ${wolf && P.br == null && !C.full ? `<button class="btn small ${aim ? "green" : ""}" data-maim="${c}" title="Бежать к этой пещере">${aim ? "Цель ✓" : "Цель"}</button>` : ""}
      ${wolf && !P.whisper && !C.full ? `<button class="btn small" data-mwhisper="${c}" title="Один раз за игру: тайно узнать, сколько здесь мест">Шепнуть</button>` : ""}</div>`;
  }).join("")}</div>`;
}

function renderMukhtar() {
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], live = s.status === "play" && !s.paused, mine = me >= 0 && me === s.cur && live;
  const cur = s.players[s.cur];
  if (!mine) ui.mk = null;
  if (ui.mk && P && ui.mk.card != null && !P.hand[ui.mk.card]) ui.mk = null;
  if (ui.mtake != null && !(s.row || [])[ui.mtake]) ui.mtake = null;
  const a = mine ? mAction(s, me) : null, pv = a && a.type === "play" ? MU.preview(s, me, a) : null;
  const pops = [];
  if (s.status === "play" && me >= 0 && s.pauseVote) {
    const v = s.pauseVote, needN = Math.floor(s.players.filter((p) => !p.bot).length / 2) + 1, voted = v.yes.includes(me) || v.no.includes(me);
    pops.push(pop(`${esc(nameOf(s, v.by))} предлагает ${v.to ? "поставить паузу" : "продолжить игру"}`, `<p class="hint" style="margin:0">За: ${v.yes.length}, нужно ${needN}</p>${voted ? `<p class="muted" style="margin:0">Вы проголосовали, ждём остальных</p>` : `<div class="row"><button class="btn green" data-pause="1">За</button><button class="btn red" data-pause="0">Против</button></div>`}`));
  }
  if (ui.panel === "mrules") pops.push(pop("Правила «Мухтара»", mRulesHTML(s), true));

  const run = MU.runReal(s);
  let hud;
  if (P && P.role !== "cave") {
    const cards = P.hand.map((key, i) => {
      const C = mCard(key), act = ui.mk?.act, block = act && act !== "play" ? "" : mCardBlock(s, me, key), sel = ui.mk && (act === "swap" ? ui.mk.cards.includes(i) : ui.mk.card === i);
      return `<button class="mcard ${sel ? "sel" : ""} ${sel && act === "swap" ? "toss" : ""}" data-mcard="${i}" ${mine && !block ? "" : "disabled"} title="${esc(C.text)}${block ? " — " + block : ""}"><span class="mk">${i + 1}</span><b class="mname">${C.name}</b><span class="mart">${mCardArt(key)}</span>${P.role === "dog" ? `<small class="mtxt">Лай или Загнать</small>` : `${mNoise(C.noise)}<small class="mtxt">${C.text}</small>`}</button>`;
    }).join("");
    const k = ui.mk, dog = P.role === "dog";
    const ab = (attr, label, ok, cls = "", title = label) => `<button class="ab ${cls}" ${attr} ${ok ? "" : "disabled"} title="${esc(title)}"><span class="lb">${label}</span></button>`;
    const wolf = P.role === "wolf", act = k?.act || "play";
    const acts = [
      wolf ? ab('data-mact="swap"', "♻ Сбросить", mine, act === "swap" ? "on" : "", "Вместо хода сбросить 1–2 карты и добрать новые. Мухтар слышит возню: лай раунда +1") : "",
      wolf ? ab('data-mact="give"', "⇄ Обменять", mine, act === "give" ? "on" : "", "Вместо хода отдать карту другому волку на тропе и забрать у него случайную, не глядя") : "",
      dog ? ab('data-mmode="bark"', "🔊 Лай", mine && !!k, k && k.mode === "bark" ? "on" : "", MU.DOG_MODES.bark.text) : "",
      dog ? ab('data-mmode="drive"', "↩ Загнать", mine && !!k, k && k.mode === "drive" ? "on" : "", MU.DOG_MODES.drive.text) : "",
      ab('data-mact="cancel"', "Отмена", mine && (!!k || ui.mtake != null), "", "Снять выбор (Esc)"),
      ab('data-mact="ok"', act === "swap" ? "Сбросить" : act === "give" ? "Обменять" : "Сыграть", mine && !!a && !(pv && pv.error), "go", "Подтвердить ход (Enter)"),
    ].join("");
    // Открытый ряд: после хода вместо верхней карты колоды можно взять одну из этих.
    const canTake = mine && act !== "give";
    const row = (s.row || []).length ? `<div class="panel mrow"><span class="mrow-h" title="После хода можно взять одну из этих карт вместо карты из колоды. Шорох: лай раунда +1">Открытый ряд</span>${s.row.map((key, i) => `<button class="mrc ${ui.mtake === i ? "sel" : ""} ${M_BETRAY.has(key) ? "bad" : mCard(key).move ? "go" : "calm"}" data-mrow="${i}" ${canTake ? "" : "disabled"} title="${esc(mCard(key).text)} — взять после хода (лай раунда +1)"><b>${mCard(key).name}</b><span class="mart">${mCardArt(key)}</span></button>`).join("")}<small class="muted">${ui.mtake != null ? "возьмёте после хода" : "или карта из колоды"}</small></div>` : "";
    const err = pv && pv.error ? `<span class="warn mwarn">${esc(pv.error)}</span>` : "";
    hud = `${row}<div class="panel mhand">${cards}${err}</div><div class="panel acts">${acts}</div>`;
  } else if (P) {
    hud = `<div class="panel spect">${mSheepIcon()} <span>Вы в пещере «${esc(s.caves[P.cave].name)}». Она спасёт, только если её заполнят, — зазывайте остальных.</span></div>`;
  } else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель.</div>`;
  }
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="Время хода — потом ход сделает бот">${ICON("clock")}<b></b></span>` : "";
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";
  const pvRun = pv && pv.sim ? MU.runReal(pv.sim) : run, atFork = s.mx >= MU.FORK;

  $("view").innerHTML = `<div class="game mgame">
    <div class="stage">
      <div class="panel turn ${mine ? "mine" : ""}" style="--pc:${cur.color}">${ava(nameOf(s, s.cur), cur.color)}
        <div class="txt"><span class="who">${s.status === "over" ? "Охота окончена" : mine ? "Ваш ход!" : "Ход: " + esc(nameOf(s, s.cur))}</span><span class="hint">${s.status === "play" ? esc(mHint(s, me)) : ""}</span></div>${timer}</div>
      <div class="topr"><span class="chip">Код <span class="code">${esc(s.code)}</span></span>${s.status === "over" && ui.summaryHidden ? `<button class="btn green small" data-a="summary">${ICON("cards")}<span class="tl">Итоги</span></button>` : ""}<button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "mrules" ? "on" : ""}" data-panel="mrules" title="Правила">${ICON("help")}<span class="tl">Правила</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox mbox">${mBoardSVG(s, me, pv)}</div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры и боты стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${mine && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваш ход!</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" && !ui.summaryHidden ? mSummaryHTML(s, me) : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      <div class="panel"><div class="nstat">
        <span class="nbig" title="Раунд">${ICON("clock")}<b>${s.round}</b><small>раунд</small></span>
        <span class="mbark ${pvRun !== run ? "pv" : ""}" title="Лай раунда: в конце раунда Мухтар пробежит столько клеток">🔊 лай ${s.noise}${pvRun !== run ? ` → ${pv.sim.noise}` : ""} · ${atFork ? "Мухтар у развилки" : `Мухтар +${pvRun}`}${s.fed && !atFork ? ` <b title="Мухтар поймал волка и сыт: в конце раунда пробежит на ${MU.FED} клетки меньше">· сыт</b>` : ""}</span></div>
        ${mCavesHTML(s, me)}
        ${s.status === "play" ? mDeckHTML(s) : ""}
        <div class="ph"><h3>Стая</h3></div><div class="players">${mPlayerRows(s, me)}</div></div>
      <div class="panel logp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div>${fmtLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
  tickTimer();
  mRunAnims();
  document.title = mine ? "Ваш ход — Мухтар" : "Мухтар — Жайлоо";
}

function mSummaryHTML(s, me) {
  const rows = MU.results(s), W = s.players[s.winner];
  if (me < 0) me = s.players.findIndex((p) => p.was === myId);
  const nm = (i) => { const p = s.players[i]; return (p.was && s.names?.[p.was]) || nameOf(s, i); };
  const rating = (r) => {
    const x = s.ratings?.[r.i];
    if (!x) return `<span class="muted" title="Рейтинг считается только у игроков с аккаунтом">—</span>`;
    return `${x.before + x.delta} <b class="${x.delta >= 0 ? "up" : "down"}">${x.delta >= 0 ? "+" : ""}${x.delta}</b>`;
  };
  const roleRu = (r) => (r.role === "cave" ? `${s.caves[r.cave].name}, ${r.caveNo}-й${s.caves[r.cave].full ? "" : " (не заполнена)"}` : r.role === "dog" ? "тайган" : "снаружи");
  const whispers = s.players.map((p, i) => (p.whisper ? `${esc(nm(i))} — «${esc(s.caves[p.whisper.c].name)}»: ${p.whisper.cap}` : "")).filter(Boolean).join(", ");
  const caves = s.caves.map((C) => `${esc(C.name)} ${C.n}/${C.cap}${!C.cap ? " — завалена" : C.full ? "" : " — не заполнена"}`).join(" · ");
  const table = `<div class="tablewrap"><table class="sumtable"><thead><tr><th>Место</th><th>Игрок</th><th>Итог</th><th>Очки</th><th>Пещера</th><th>Ягнята</th><th>Охота</th><th>Рейтинг</th></tr></thead><tbody>
    ${rows.map((r) => { const p = s.players[r.i]; return `<tr class="${r.i === me ? "mine" : ""}">
      <td class="pl-n">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</td>
      <td><span class="who2">${ava(nm(r.i), p.color, "sm")}<span>${esc(nm(r.i))}${p.bot && !p.was ? `<small>бот · ${LEVEL_RU[p.level || "medium"]}</small>` : p.was ? "<small>доигрывал бот</small>" : ""}</span></span></td>
      <td>${roleRu(r)}</td><td><b class="bigvp">${r.vp}</b></td><td class="tn">${r.sc.cave}</td><td class="tn">${r.sc.lambs}</td><td class="tn">${r.sc.hunt}</td><td class="tn">${rating(r)}</td></tr>`; }).join("")}
  </tbody></table></div>`;
  const info = [s.how === "full" ? "все пещеры заполнены" : "волков на тропе не осталось", `${s.round} ${plural(s.round, "раунд", "раунда", "раундов")}`, s.startedAt && s.endedAt && fmtDur(s.endedAt - s.startedAt), ...Object.keys(MU.MODS).filter((k) => mod(s, k)).map((k) => MU.MODS[k].name)].filter(Boolean).join(" · ");
  const my = me >= 0 && s.ratings?.[me];
  return `<div class="over sum"><div class="panel">
    <div class="sum-h">${ava(nm(s.winner), W.color)}<div><span class="w">${s.winner === me ? "Вы победили!" : `${esc(nm(s.winner))} побеждает!`}</span><span class="muted">${info}</span></div></div>
    ${my ? `<p class="myrate">Ваш рейтинг: <b>${my.before + my.delta}</b> <b class="${my.delta >= 0 ? "up" : "down"}">${my.delta >= 0 ? "+" : ""}${my.delta}</b></p>` : me >= 0 && !account ? `<p class="hint">Партия не попала в рейтинг: <button class="link" data-a="authopen">войдите или зарегистрируйтесь</button>, чтобы следующие считались.</p>` : ""}
    ${table}
    <p class="hint">Пещеры: ${caves}.${whispers ? ` Шёпоты: ${whispers}.` : ""}</p>
    <div class="row"><button class="btn green" data-a="back">К списку партий</button>${rematchBtn(s)}<button class="btn" data-a="hidesummary">Посмотреть поле</button></div>
  </div></div>`;
}

// --- управление ---
function mPlay() {
  const a = mAction(game, myIndex());
  if (!a) return;
  ui.mk = null;
  act(a);
}
function mPickCard(i) {
  const s = game, me = myIndex(), P = s.players[me], k = ui.mk;
  if (!P || !P.hand[i]) return;
  if (k && k.act === "swap") { k.cards = k.cards.includes(i) ? k.cards.filter((x) => x !== i) : [...k.cards, i].slice(-2); return render(); }
  if (k && k.act === "give") { k.card = k.card === i ? null : i; k.target = null; return render(); }
  if (mCardBlock(s, me, P.hand[i])) return;
  ui.mk = k && k.card === i ? null : { act: "play", card: i, cards: [], mode: null, target: null, cave: null };
  render();
}
document.addEventListener("click", (ev) => {
  if (!game || game.game !== "mukhtar") return;
  const el = ev.target.closest("[data-mcard],[data-mmode],[data-mt],[data-mact],[data-mrtab],[data-mcave],[data-maim],[data-mwhisper],[data-mpl],[data-mrow]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = game, me = myIndex();
  if (d.mrtab) { ui.mrTab = d.mrtab; return render(); }
  if (d.mpl !== undefined) { ui.mpl = ui.mpl === +d.mpl ? null : +d.mpl; return render(); }
  if (s.status !== "play" || me < 0) return;
  // Цель и шёпот можно и не в свой ход.
  if (d.maim !== undefined) return act({ type: "aim", cave: s.players[me].aim === +d.maim ? null : +d.maim });
  if (d.mwhisper !== undefined) {
    const C = s.caves[+d.mwhisper];
    if (confirm(`Шепнуть у пещеры «${C.name}»? Вы узнаете, сколько в ней мест. Шёпот один на всю игру, и все увидят, у какой пещеры вы шептались.`)) act({ type: "whisper", cave: +d.mwhisper });
    return;
  }
  if (d.mcave !== undefined) {
    const c = +d.mcave, how = mCaveClick(s, me);
    if (how === "rock") { ui.mk.cave = ui.mk.cave === c ? null : c; return render(); }
    if (how === "aim") return act({ type: "aim", cave: s.players[me].aim === c ? null : c });
    return;
  }
  if (me !== s.cur || s.paused) return;
  if (d.mcard !== undefined) return mPickCard(+d.mcard);
  if (d.mrow !== undefined) { ui.mtake = ui.mtake === +d.mrow ? null : +d.mrow; return render(); }
  if (d.mact === "swap" || d.mact === "give") { ui.mk = ui.mk?.act === d.mact ? null : { act: d.mact, card: null, cards: [], mode: null, target: null, cave: null }; return render(); }
  if (!ui.mk) return;
  if (d.mmode) { ui.mk.mode = ui.mk.mode === d.mmode ? null : d.mmode; ui.mk.target = null; return render(); }
  if (d.mt !== undefined) { const j = +d.mt; ui.mk.target = ui.mk.target === j ? null : j; return render(); }
  if (d.mact === "cancel") { ui.mk = null; ui.mtake = null; return render(); }
  if (d.mact === "ok") return mPlay();
});
document.addEventListener("keydown", (ev) => {
  if (!game || game.game !== "mukhtar" || game.status !== "play" || ev.target.tagName === "INPUT") return;
  if (myIndex() !== game.cur || game.paused) return;
  if (/^[1-3]$/.test(ev.key)) { ev.preventDefault(); mPickCard(+ev.key - 1); }
  else if (ev.key === "Enter" && ui.mk) { ev.preventDefault(); mPlay(); }
  else if (ev.key === "Escape" && ui.mk) { ui.mk = null; render(); }
});
