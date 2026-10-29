// Экран «Кочёвки»: поле из квадратных тайлов, объёмные чабаны, подсказки ходов с очками и анимации.
// Грузится до client.js и пользуется его общими помощниками (ui, game, act, ava, ICON…) только из функций.
const NM = NOMAD;
// Короткие анимации «Кочёвки»: новый тайл, очки над объектами, конец лета, буран.
const nfx = { tile: null, score: null, season: null, storm: null };
let nCache = { k: null, spots: null };

// Сравниваем новое состояние с прошлым: чей ход, что положили, кто получил очки.
function nomadNotice(old, s) {
  const me = myIndex(), now = Date.now();
  if (!old || old.code !== s.code || old.status === "lobby") return;
  if (s.fx && (!old.fx || old.fx.n !== s.fx.n)) {
    if (s.last) nfx.tile = { x: s.last.x, y: s.last.y, t: now };
    if (s.fx.ev.length) nfx.score = { ev: s.fx.ev, t: now };
    if (s.fx.season) nfx.season = { t: now };
  }
  if ((s.stormNo || 0) > (old.stormNo || 0)) { nfx.storm = { t: now }; toast("Буран! Чабаны с пастбищ ушли домой без очков"); }
  if (s.status === "play" && me >= 0 && s.cur === me && (old.cur !== me || old.turnNo !== s.turnNo)) fx.turn = { t: now };
  if (old.turnNo !== s.turnNo || s.cur !== me || s.status !== "play") ui.n = null;
}

// --- поиск ходов ---
// Клетки, куда ложится текущий тайл, с поворотами и лучшими очками для меня. Считаем раз на состояние.
function nSpots(s, me) {
  const k = `${s.code}:${s.seq}:${s.tile}:${me}`;
  if (nCache.k === k) return nCache.spots;
  const by = new Map(), canStand = NM.supplyLeft(s, me) > 0 || NM.berkutLeft(s, me);
  for (const o of NM.placements(s.tiles, s.tile)) {
    const pv = NM.preview(s, o.x, o.y, o.r);
    // Свой чабан на объект, который этот же тайл и завершает, приносит очки сразу.
    const own = canStand ? Math.max(0, ...pv.feats.filter((x) => x && x.free && x.complete).map((x) => x.full)) : 0;
    const best = (pv.gains[me] || 0) + own, id = o.x + "," + o.y;
    let sp = by.get(id);
    if (!sp) by.set(id, (sp = { x: o.x, y: o.y, rots: [], best: -1, bestR: o.r, others: 0 }));
    sp.rots.push(o.r);
    if (best > sp.best) { sp.best = best; sp.bestR = o.r; sp.others = Object.entries(pv.gains).filter(([p]) => +p !== me).reduce((a, [, v]) => a + v, 0); }
  }
  nCache = { k, spots: [...by.values()] };
  return nCache.spots;
}
const nSpotAt = (s, me, x, y) => nSpots(s, me).find((p) => p.x === x && p.y === y);
// Поворот, который показываем при наведении и берём по клику: лучший по очкам, иначе выбранный игроком.
const nStartRot = (sp) => (sp.best > 0 ? sp.bestR : sp.rots.includes(ui.nr ?? 0) ? ui.nr ?? 0 : sp.rots[0]);

// --- рисунок тайлов ---
function nSeed(n) { let x = n * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); }
const nP = (p) => `${f(p[0])},${f(p[1])}`;
const nLinePath = (ft) => {
  const a = NM.slotPt(ft.sides[0] * 3 + 1);
  if (ft.sides.length === 1) return `M${nP(a)} L.5,.5`;
  return `M${nP(a)} Q.5,.5 ${nP(NM.slotPt(ft.sides[1] * 3 + 1))}`;
};
// Аил: заливка по сторонам тайла и вогнутые стены между ними. Стены рисуем отдельно — по краю тайла стены нет.
function nAilPath(sides) {
  const C = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (sides.length === 4) return { fill: "M0,0 H1 V1 H0Z", wall: "" };
  if (sides.length === 1) {
    const s = sides[0], a = C[s], b = C[(s + 1) % 4], m = NM.slotPt(s * 3 + 1, 0.36);
    const c = [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2], curve = `Q${nP(c)} ${nP(a)}`;
    return { fill: `M${nP(a)} L${nP(b)} ${curve}Z`, wall: `M${nP(b)} ${curve}` };
  }
  const sorted = [...sides].sort((x, y) => x - y);
  const start = sorted.findIndex((s, i) => (sorted[(i - 1 + sorted.length) % sorted.length] + 1) % 4 !== s);
  const order = sorted.slice(start).concat(sorted.slice(0, start));
  let fill = `M${nP(C[order[0]])}`, wall = "";
  order.forEach((s, i) => {
    const end = C[(s + 1) % 4], next = order[(i + 1) % order.length];
    fill += ` L${nP(end)}`;
    if ((s + 1) % 4 === next) return;
    const to = C[next], mid = [(end[0] + to[0]) / 2, (end[1] + to[1]) / 2], c = [mid[0] + (0.5 - mid[0]) * 0.8, mid[1] + (0.5 - mid[1]) * 0.8];
    fill += ` Q${nP(c)} ${nP(to)}`;
    wall += `M${nP(end)} Q${nP(c)} ${nP(to)}`;
  });
  return { fill: fill + "Z", wall };
}
const nYurt = (x, y, k = 1) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(k)})"><ellipse cy=".034" rx=".08" ry=".018" fill="rgba(60,35,10,.3)"/><path d="M-.072,.032 V-.004 Q0,-.082 .072,-.004 V.032Z" fill="#fdf8ec" stroke="#6b4423" stroke-width=".011"/><path d="M-.072,.004 Q0,-.012 .072,.004" fill="none" stroke="#c0392b" stroke-width=".014"/><path d="M-.05,-.03 Q0,-.05 .05,-.03" fill="none" stroke="#c9a96b" stroke-width=".008"/><rect x="-.016" y=".004" width=".032" height=".028" rx=".004" fill="#8a4b22"/><circle cy="-.066" r=".011" fill="#c0392b"/></g>`;
const nSheep = (x, y) => `<g transform="translate(${f(x)} ${f(y)})"><path d="M-.035,.02 v.03 M-.012,.022 v.03 M.014,.022 v.03 M.034,.02 v.03" stroke="#4a4a42" stroke-width=".011"/><path d="M-.05,.0 a.022,.022 0 0 1 .02,-.03 a.024,.024 0 0 1 .04,-.006 a.022,.022 0 0 1 .03,.022 a.02,.02 0 0 1 -.006,.038 h-.07 a.02,.02 0 0 1 -.014,-.024z" fill="#fbfbf3" stroke="#7d7d70" stroke-width=".008"/><ellipse cx=".054" cy="-.006" rx=".022" ry=".016" fill="#3a3a36"/></g>`;
const nOrn = (x, y) => `<g transform="translate(${f(x)} ${f(y)})"><path d="M0,-.07 L.056,0 L0,.07 L-.056,0Z" fill="#c0392b" stroke="#f2c94c" stroke-width=".016"/><path d="M0,-.032 L.026,0 L0,.032 L-.026,0Z" fill="#f2c94c"/><path d="M-.056,0 h-.03 M.056,0 h.03" stroke="#c0392b" stroke-width=".014"/></g>`;
const nCamel = (x, y) => `<g transform="translate(${f(x)} ${f(y)})"><path d="M-.05,.0 v.042 M-.022,.0 v.042 M.022,.0 v.042 M.046,.0 v.042" stroke="#6b4423" stroke-width=".011"/><path d="M-.07,.004 Q-.066,-.042 -.036,-.032 Q-.02,-.074 .002,-.032 Q.022,-.074 .04,-.03 Q.052,-.03 .058,-.054 L.08,-.064 L.086,-.046 L.068,-.036 Q.064,.004 .05,.008 Z" fill="#c8924f" stroke="#6b4423" stroke-width=".009"/><path d="M-.03,-.03 h.07" stroke="#c0392b" stroke-width=".012"/></g>`;

function nArt(i) {
  const d = NM.TILES[i], I = NM.INST[i][0], rnd = nSeed(i + 3);
  let o = `<rect width="1" height="1" fill="url(#ng-grass)"/>`;
  for (let k = 0; k < 10; k++) {
    const x = 0.08 + rnd() * 0.84, y = 0.08 + rnd() * 0.84;
    o += `<path d="M${f(x - 0.026)},${f(y)} l.01,-.034 l.012,.026 l.01,-.04 l.012,.036 l.01,-.028" fill="none" stroke="#4f8a32" stroke-width=".009" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  for (let k = 0; k < 4; k++) o += `<circle cx="${f(0.1 + rnd() * 0.8)}" cy="${f(0.1 + rnd() * 0.8)}" r=".011" fill="${["#f6e27a", "#fbfbf3", "#e98fb3"][k % 3]}"/>`;
  for (const ft of I.feats) if (ft.type === "river") {
    const p = nLinePath(ft);
    o += `<path d="${p}" fill="none" stroke="#2a6fa8" stroke-width=".23"/><path d="${p}" fill="none" stroke="url(#ng-water)" stroke-width=".17"/><path d="${p}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".016" stroke-dasharray=".05 .07"/>`;
  }
  if (d.lake) o += `<ellipse cx=".5" cy=".55" rx=".27" ry=".21" fill="url(#ng-water)" stroke="#2a6fa8" stroke-width=".03"/><path d="M.38,.52 q.05,-.03 .1,0 M.52,.62 q.05,-.03 .1,0" fill="none" stroke="rgba(255,255,255,.6)" stroke-width=".014"/>`;
  if (d.spring) o += `<circle cx=".5" cy=".5" r=".1" fill="url(#ng-water)" stroke="#5c6168" stroke-width=".03"/><circle cx=".41" cy=".42" r=".035" fill="#9aa1aa" stroke="#5c6168" stroke-width=".01"/><circle cx=".6" cy=".44" r=".028" fill="#9aa1aa" stroke="#5c6168" stroke-width=".01"/>`;
  for (const ft of I.feats) if (ft.type === "trail") {
    const p = nLinePath(ft), cap = ft.dead ? "round" : "butt";
    o += `<path d="${p}" fill="none" stroke="#8a6234" stroke-width=".15" stroke-linecap="${cap}"/><path d="${p}" fill="none" stroke="#e8d3a0" stroke-width=".105" stroke-linecap="${cap}"/><path d="${p}" fill="none" stroke="#c9a96b" stroke-width=".014" stroke-dasharray=".03 .05"/>`;
  }
  if (d.river && d.trail) o += `<rect x=".37" y=".39" width=".26" height=".22" rx=".02" fill="#a8713a" stroke="#5d3a17" stroke-width=".016"/><path d="M.37,.45 h.26 M.37,.5 h.26 M.37,.55 h.26" stroke="#5d3a17" stroke-width=".008"/>`;
  if (d.kurgan) o += `<ellipse cx=".5" cy=".56" rx=".25" ry=".15" fill="url(#ng-mound)" stroke="#6b5a30" stroke-width=".016"/><circle cx=".36" cy=".6" r=".02" fill="#8f949b"/><circle cx=".63" cy=".62" r=".018" fill="#8f949b"/><path d="M.465,.53 V.34 Q.5,.29 .535,.34 V.53Z" fill="#b3b6bb" stroke="#55585e" stroke-width=".012"/><path d="M.485,.37 h.012 M.505,.37 h.012 M.49,.41 q.01,.008 .02,0" stroke="#55585e" stroke-width=".008" fill="none"/>`;
  for (const ft of I.feats) if (ft.type === "ail") {
    const { fill, wall } = nAilPath(ft.sides);
    o += `<path d="${fill}" fill="url(#ng-felt)"/>`;
    if (wall) o += `<path d="${wall}" fill="none" stroke="#6b4423" stroke-width=".045"/><path d="${wall}" fill="none" stroke="#d9b77c" stroke-width=".016" stroke-dasharray=".028 .02"/>`;
    const pts = ft.sides.length >= 3 ? [ft.at, ...ft.sides.map((s) => NM.slotPt(s * 3 + 1, 0.17))] : ft.sides.length === 2 ? ft.sides.map((s) => NM.slotPt(s * 3 + 1, 0.2)).concat([ft.at]) : [NM.slotPt(ft.sides[0] * 3, 0.14), NM.slotPt(ft.sides[0] * 3 + 2, 0.14)];
    pts.forEach((p, k) => (o += nYurt(p[0], p[1] + 0.01, k === 0 && ft.sides.length >= 3 ? 1.7 : 1.35)));
    if (ft.orn) o += nOrn(ft.at[0] + 0.13, ft.at[1] - 0.1);
  }
  for (const s of d.herd || []) { const p = NM.slotPt(s * 3 + 1, 0.3); o += nSheep(p[0] - 0.06, p[1]) + nSheep(p[0] + 0.07, p[1] + 0.05); }
  if (d.well) o += `<circle cx=".5" cy=".5" r=".08" fill="#9aa1aa" stroke="#4b5058" stroke-width=".02"/><circle cx=".5" cy=".5" r=".045" fill="#2d6e9e"/><path d="M.44,.43 h.12" stroke="#6b4423" stroke-width=".02"/>`;
  if (d.caravan) { const ft = I.feats.find((x) => x.type === "trail"); o += nCamel(ft.at[0] + 0.17, ft.at[1] + 0.03); }
  return o + `<rect x=".008" y=".008" width=".984" height=".984" fill="none" stroke="rgba(255,255,255,.28)" stroke-width=".014"/><rect width="1" height="1" fill="none" stroke="rgba(30,20,10,.45)" stroke-width=".012"/>`;
}
// Общие рисунки — тайлы и градиенты фигур — кладём один раз в скрытый SVG; поле и панель ссылаются на них.
function nEnsureDefs() {
  if ($("ndefs")) return;
  const box = document.createElement("div");
  box.innerHTML = `<svg id="ndefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="ng-grass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#98c962"/><stop offset="1" stop-color="#679f41"/></linearGradient>
    <radialGradient id="ng-felt" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#f7e9c6"/><stop offset="1" stop-color="#dcc08a"/></radialGradient>
    <linearGradient id="ng-water" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6cbdf0"/><stop offset="1" stop-color="#3489cc"/></linearGradient>
    <radialGradient id="ng-mound" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="#b9a76d"/><stop offset="1" stop-color="#7c6a3a"/></radialGradient>
    <linearGradient id="nf-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>
    <radialGradient id="nf-face" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#f6d2ad"/><stop offset="1" stop-color="#c98d5e"/></radialGradient>
    ${NM.TILES.map((_, i) => (NM.INST[i] ? `<g id="nt-${i}">${nArt(i)}</g>` : "")).join("")}
  </defs></svg>`;
  document.body.append(box.firstChild);
}
const nUse = (t, x, y, r, extra = "") => `<use href="#nt-${t}" transform="translate(${x} ${y}) rotate(${90 * r} .5 .5)" ${extra}/>`;
const nTileSVG = (t, r = 0, cls = "") => `<svg class="ntile-svg ${cls}" viewBox="-.04 -.04 1.08 1.08" aria-hidden="true">${nUse(t, 0, 0, r)}</svg>`;

// Чабан в ак-калпаке: тень, светлый контур, объём градиентом. Ноги — в точке (x, y).
function nFig(x, y, color, o = {}) {
  const k = (o.big ? 1.28 : 1) * (o.k || 1.38);
  const robe = "M-.085,0 C-.095,-.06 -.075,-.13 -.045,-.155 L.045,-.155 C.075,-.13 .095,-.06 .085,0 Q0,.028 -.085,0Z";
  return `<g class="nfig ${o.cls || ""}" transform="translate(${f(x)} ${f(y)}) scale(${f(k)})" ${o.attr || ""}>${o.title ? `<title>${esc(o.title)}</title>` : ""}
    <ellipse cy=".008" rx=".1" ry=".032" fill="rgba(0,0,0,.4)"/>
    ${o.staff ? `<path d="M.1,.012 L.114,-.25 q.004,-.032 -.024,-.032" fill="none" stroke="#fff" stroke-width=".032" stroke-linecap="round"/><path d="M.1,.012 L.114,-.25 q.004,-.032 -.024,-.032" fill="none" stroke="#6b4423" stroke-width=".016" stroke-linecap="round"/>` : ""}
    <path d="${robe}" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".036" stroke-linejoin="round"/>
    <path d="${robe}" fill="${color}" stroke="#12151c" stroke-width=".014" stroke-linejoin="round"/>
    <path d="${robe}" fill="url(#nf-shade)"/>
    <path d="M-.062,-.075 Q0,-.06 .062,-.075" fill="none" stroke="${o.big ? "#f2c94c" : "rgba(0,0,0,.4)"}" stroke-width="${o.big ? ".022" : ".014"}"/>
    <circle cy="-.19" r=".05" fill="none" stroke="rgba(255,255,255,.92)" stroke-width=".03"/>
    <circle cy="-.19" r=".047" fill="url(#nf-face)" stroke="#12151c" stroke-width=".012"/>
    <path d="M-.058,-.212 Q-.03,-.31 0,-.318 Q.03,-.31 .058,-.212Z" fill="#fbf7ec" stroke="#12151c" stroke-width=".012"/>
    <path d="M-.062,-.212 Q0,-.226 .062,-.212" fill="none" stroke="#1d1d1d" stroke-width=".02"/>
    <path d="M-.02,-.286 l.02,.028 l.02,-.028" fill="none" stroke="#1d1d1d" stroke-width=".008"/>
    ${o.big ? `<path d="M.035,-.152 q.05,-.07 .11,-.05 q-.02,.035 -.055,.04 q.025,.012 .035,.035 q-.055,.004 -.09,-.025z" fill="#5a3b1d" stroke="#12151c" stroke-width=".009"/><circle cx=".118" cy="-.19" r=".008" fill="#f2c94c"/>` : ""}
    <ellipse cx="-.036" cy="-.1" rx=".014" ry=".038" fill="rgba(255,255,255,.42)"/></g>`;
}
const nFigIcon = (color, o = {}) => `<svg class="nfigi ${o.cls || ""}" viewBox="-.16 -.4 .32 .44" aria-hidden="true">${nFig(0, 0, color, { ...o, k: 1 })}</svg>`;

// --- поле ---
function nBoardSVG(s, me) {
  const live = s.status === "play" && !s.paused, mine = live && me >= 0 && me === s.cur && s.tile != null;
  const spots = mine ? nSpots(s, me) : [], P = mine ? ui.n : null;
  const cells = Object.keys(s.tiles).map((k) => k.split(",").map(Number));
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  // Рамка — все тайлы и клетка вокруг: поле не прыгает, когда меняются подсказки.
  const x0 = Math.min(...xs) - 1.25, y0 = Math.min(...ys) - 1.25, w = Math.max(...xs) - Math.min(...xs) + 3.5, h = Math.max(...ys) - Math.min(...ys) + 3.5;
  const tileFx = fxOn(nfx.tile, 900) ? nfx.tile : null, scoreFx = fxOn(nfx.score, 2800) ? nfx.score : null;
  let o = `<svg class="board nboard ${zoom.k > 1 ? "zoomed" : ""}" viewBox="${zoomBox(x0, y0, w, h)}" data-base="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" role="img" aria-label="Игровое поле">`;
  o += `<g class="ntiles">`;
  for (const [x, y] of cells) {
    const T = s.tiles[x + "," + y], fresh = tileFx && tileFx.x === x && tileFx.y === y;
    o += fresh ? `<g class="ndrop" ${fxDelay(tileFx)}>${nUse(T.t, x, y, T.r)}</g><rect class="nland" x="${x}" y="${y}" width="1" height="1" ${fxDelay(tileFx)}/>` : nUse(T.t, x, y, T.r);
  }
  o += `</g>`;
  if (s.last && s.status === "play") o += `<rect class="nlast" x="${s.last.x}" y="${s.last.y}" width="1" height="1" style="--c:${s.players[s.last.p]?.color || "#fff"}"><title>Последний тайл — ${esc(nameOf(s, s.last.p))}</title></rect>`;
  if (scoreFx) {
    const lit = new Map();
    for (const e of scoreFx.ev) for (const k of e.tiles) if (!lit.has(k)) lit.set(k, s.players[e.p].color);
    for (const [k, c] of lit) { const [x, y] = k.split(",").map(Number); o += `<rect class="nglow" x="${x + 0.03}" y="${y + 0.03}" width=".94" height=".94" rx=".04" style="--c:${c}" ${fxDelay(scoreFx)}/>`; }
  }
  for (const sp of spots) {
    if (P && P.x === sp.x && P.y === sp.y) continue;
    const r0 = nStartRot(sp), tip = `Положить сюда — ${sp.best > 0 ? `лучший ход даст вам +${sp.best} очк.` : "очков сразу не принесёт"}${sp.others ? `, соперникам +${sp.others}` : ""}. Поворотов: ${sp.rots.length}`;
    o += `<g class="nspot ${sp.best > 0 ? "gain" : ""}" data-nspot="${sp.x},${sp.y}"><title>${tip}</title><rect class="nspot-bg" x="${sp.x + 0.05}" y="${sp.y + 0.05}" width=".9" height=".9" rx=".07"/>
      <g class="nprev">${nUse(s.tile, sp.x, sp.y, r0, 'opacity=".8"')}</g>
      ${sp.best > 0 ? `<g class="nbadge" transform="translate(${f(sp.x + 0.82)} ${f(sp.y + 0.18)})"><circle r=".17"/><text y=".06">+${sp.best}</text></g>` : `<text class="nplus" x="${sp.x + 0.5}" y="${sp.y + 0.6}">+</text>`}</g>`;
  }
  let pv = null;
  if (P) {
    pv = NM.preview(s, P.x, P.y, P.r);
    o += `<g class="npend" data-nrot="1"><title>Нажмите на тайл, чтобы повернуть</title>${nUse(s.tile, P.x, P.y, P.r)}<rect class="npend-ring" x="${P.x + 0.02}" y="${P.y + 0.02}" width=".96" height=".96" rx=".03"/></g>
      <g class="nrot" data-nrot="1" transform="translate(${f(P.x + 1.02)} ${f(P.y - 0.02)})"><title>Повернуть (R)</title><circle r=".17"/><path d="M-.07,.03 a.075,.075 0 1 1 .03,.055" fill="none" stroke="#fff" stroke-width=".035" stroke-linecap="round"/><path d="M-.11,.0 l.04,.05 l.045,-.035z" fill="#fff"/></g>`;
  }
  // Чабаны на поле; при выборе места свои чабаны с соседних тайлов можно перегнать на новый тайл.
  const figs = s.chabans.map((c, i) => ({ c, i, at: NM.INST[s.tiles[c.x + "," + c.y].t][s.tiles[c.x + "," + c.y].r].feats[c.f] })).sort((a, b) => a.c.y + a.at.at[1] - (b.c.y + b.at.at[1]));
  for (const { c, i, at } of figs) {
    const x = c.x + at.at[0], y = c.y + at.at[1] + 0.12, col = s.players[c.p].color;
    const movable = P && c.p === me && Math.abs(c.x - P.x) + Math.abs(c.y - P.y) === 1, sel = P && P.move === i;
    const fresh = tileFx && c.x === tileFx.x && c.y === tileFx.y;
    const title = `${nameOf(s, c.p)} — ${c.big ? "беркутчи, " : ""}${NM.KIND_RU[at.type].toLowerCase()}${movable ? ". Нажмите, чтобы перекочевать на новый тайл" : ""}`;
    if (movable) o += `<circle class="nmov ${sel ? "sel" : ""}" cx="${f(x)}" cy="${f(y - 0.14)}" r=".24" data-nmove="${i}"/>`;
    o += nFig(x, y, col, { big: c.big, staff: at.type === "pasture", cls: `${fresh ? "new" : ""} ${sel ? "ghost" : ""} ${movable ? "can" : ""}`, title, attr: movable ? `data-nmove="${i}" ${fresh ? fxDelay(tileFx) : ""}` : fresh ? fxDelay(tileFx) : "" });
  }
  if (P && pv) {
    const canStand = P.move != null || NM.supplyLeft(s, me) > 0 || NM.berkutLeft(s, me);
    for (const ft of pv.feats) {
      if (!ft || !ft.free || !canStand) continue;
      const x = P.x + ft.at[0], y = P.y + ft.at[1], sel = P.f === ft.i;
      const kind = NM.KIND_RU[ft.type], when = ft.type === "pasture" ? `${ft.full} очк. в конце лета и в конце игры тому, у кого здесь больше чабанов` : ft.type === "kurgan" ? (ft.complete ? `вокруг все 4 соседа — +${ft.full} сразу` : `когда вокруг будут все 4 соседа — ${ft.full} очк., иначе в конце ${ft.end}`) : ft.complete ? `завершится этим тайлом — +${ft.full} сразу` : `достроите — ${ft.full} очк., недостроенный в конце игры — ${ft.end}`;
      if (sel) o += nFig(x, y + 0.12, s.players[me].color, { big: P.move != null ? s.chabans[P.move]?.big : P.big, staff: ft.type === "pasture", cls: "preview" });
      o += `<g class="nch ${sel ? "sel" : ""} ${ft.complete ? "now" : ""} k-${ft.type}" data-nf="${ft.i}" transform="translate(${f(x)} ${f(y)})"><title>${kind} — ${ft.text}. ${when}</title><circle r=".15"/>${sel ? "" : `<text y=".05">${ft.complete ? "+" : ""}${ft.full}</text>`}</g>`;
    }
  }
  if (scoreFx) for (const e of scoreFx.ev) {
    const c = s.players[e.p].color;
    o += `<g class="nfloat" ${fxDelay(scoreFx)}><g transform="translate(${f(e.x)} ${f(e.y - 0.2)})"><rect x="-.26" y="-.15" width=".52" height=".3" rx=".15" fill="${c}" stroke="#fff" stroke-width=".035"/><text y=".075" fill="${inkOn(c)}">+${e.pts}</text></g></g>`;
  }
  return o + "</svg>";
}

// --- панели ---
const nTilesLeft = (s) => (s.deckCount ?? s.deck?.length ?? 0);
function nHint(s, me) {
  const cur = nameOf(s, s.cur), mine = me === s.cur;
  if (s.paused) return "Игра на паузе";
  if (!mine) return `${cur} выкладывает тайл`;
  if (!ui.n) return "Выберите клетку — она подсвечена. Цифра — сколько очков даст лучший ход сюда";
  if (ui.n.move != null && ui.n.f == null) return "Выберите объект нового тайла, куда перекочует чабан";
  return "Поставьте чабана на кружок или нажмите «Готово». Нажатие на тайл поворачивает его";
}
function nPlayerRows(s, me) {
  const target = s.target || 0, lead = Math.max(1, ...s.players.map((p) => p.score)), scoreFx = fxOn(nfx.score, 2800) ? nfx.score : null;
  return s.players.map((p, i) => {
    const got = scoreFx ? scoreFx.ev.filter((e) => e.p === i).reduce((a, e) => a + e.pts, 0) : 0;
    const left = NM.supplyLeft(s, i), pct = Math.min(100, Math.round((p.score / (target || lead)) * 100));
    const toGo = target ? Math.max(0, target - p.score) : null;
    return `<div class="pl npl ${i === s.cur && s.status === "play" ? "cur" : ""}" style="--pc:${p.color}">${ava(nameOf(s, i), p.color)}
      <div style="min-width:0"><div class="nm"><span>${esc(nameOf(s, i))}</span>${i === me ? '<span class="badge">вы</span>' : ""}${offTag(s, i)}${p.bot ? `<span class="badge" title="Бот — сложность: ${LEVEL_RU[p.level || "medium"]}">бот · ${LEVEL_RU[p.level || "medium"]}</span>` : ""}</div>
        <div class="nbar" title="${target ? `${p.score} из ${target} очков` : `${p.score} очков — полоса относительно лидера`}"><i style="width:${pct}%"></i></div>
        <div class="pstats"><span title="Свободные чабаны — ${left} из ${NM.SUPPLY}">${nFigIcon(p.color)}${left}</span>${mod(s, "berkut") ? `<span class="${NM.berkutLeft(s, i) ? "" : "used"}" title="Беркутчи — ${NM.berkutLeft(s, i) ? "дома, можно поставить" : "уже на поле"}">${nFigIcon(p.color, { big: true })}</span>` : ""}${toGo != null ? `<span class="${toGo <= 15 ? "hl" : ""}" title="Сколько осталось до цели">до цели ${toGo}</span>` : ""}</div></div>
      <span class="vp ${got ? "bump" : ""}" title="Очки" ${got ? fxDelay(scoreFx) : ""}>${p.score}<small>очк.</small>${got ? `<b class="vplus" ${fxDelay(scoreFx)}>+${got}</b>` : ""}</span></div>`;
  }).join("");
}
// --- правила: вкладки с примерами, общие для экрана партии и главной страницы ---
const nTileId = (id) => NM.TILES.findIndex((t) => t.id === id);
// Кусочек поля для примера: тайлы [id, x, y, поворот] и чабаны [номер тайла, цвет, беркутчи?] на первом объекте тайла.
function nMini(list, figs = []) {
  const xs = list.map((t) => t[1]), ys = list.map((t) => t[2]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
  let o = list.map(([id, x, y, r]) => nUse(nTileId(id), x, y, r)).join("");
  for (const [i, color, big] of figs) {
    const [id, x, y, r] = list[i], ft = NM.INST[nTileId(id)][r].feats[0];
    o += nFig(x + ft.at[0], y + ft.at[1] + 0.12, color, { big, staff: ft.type === "pasture" });
  }
  return `<svg class="nmini" viewBox="${f(x0 - 0.04)} ${f(y0 - 0.04)} ${f(w + 0.08)} ${f(h + 0.08)}" style="width:${w * 34}px" aria-hidden="true">${o}</svg>`;
}
const NR_TABS = [["turn", "Ход"], ["terms", "Термины"], ["score", "Очки"], ["share", "Делёж"], ["end", "Сезоны и конец"], ["mods", "Дополнения"], ["tips", "Экран и советы"]];
function nRulesHTML(s) {
  const tab = NR_TABS.some(([k]) => k === ui.nrTab) ? ui.nrTab : "turn", [red, blue] = NM.COLORS;
  const ex = (pic, text) => `<div class="nex">${pic || ""}<span>${text}</span></div>`;
  const term = (id, name, text) => `<div class="nterm">${id ? `<span class="nlg">${nTileSVG(nTileId(id))}</span>` : `<span class="nlg nlg-fig">${nFigIcon(red)}</span>`}<span><b>${name}</b> — ${text}</span></div>`;
  const body = {
    turn: `<p>Цель — набрать больше всех очков. Очки дают <b>объекты</b> на поле (аилы, тропы, курганы, пастбища), если на них стоят ваши <b>чабаны</b>. Игроки ходят по очереди, ход состоит из шести шагов:</p>
      <ol class="nol">
        <li><b>Тайл.</b> Из мешка сам тянется случайный тайл: он виден внизу и рядом с именем ходящего. Если тайл некуда положить, он уходит в сброс, и тянется следующий.</li>
        <li><b>Куда положить.</b> Новый тайл кладут вплотную к уже лежащим (стороной, не углом). Все соприкасающиеся края должны совпасть: аил к аилу, тропа к тропе, трава к траве, река к реке. Подходящие клетки на поле подсвечены. Цифра в кружке — сколько очков вы получите сразу при лучшем ходе туда, «+» — сразу ничего, но положить можно.</li>
        <li><b>Поворот.</b> Нажмите на положенный тайл или клавишу R (Shift+R — в обратную сторону). Повороты, при которых края не сходятся, пропускаются сами.</li>
        <li><b>Чабан.</b> Можно поставить одного чабана из запаса на любой объект <i>нового</i> тайла — это кружки с цифрой. Цифра показывает, сколько стоит объект, если его достроить. Занятый объект недоступен, даже если чабан стоит на другом его тайле. На реку чабанов не ставят.</li>
        <li><b>Или перекочевать.</b> Вместо нового чабана можно перегнать своего чабана с соседнего тайла (он обведён кругом) на объект нового тайла. Прежний объект он покидает без очков.</li>
        <li><b>Подсчёт.</b> Нажмите «Готово» (Enter). Если тайл достроил аил, тропу или курган, они сразу приносят очки, а все чабаны с них возвращаются домой. Esc — забрать тайл и выбрать другое место.</li>
      </ol>
      ${ex(nMini([["ail2o", 0, 0, 0], ["cap", 0, -1, 2], ["cap", 1, 0, 3]], [[0, red]]), `<b>Пример.</b> Красный раньше поставил чабана на аил. Аилу не хватало одной стены. Тайл с куском аила лёг справа и закрыл его: на клетке была цифра <b>+8</b>, и 8 очков пришли сразу. Чабан вернулся домой, и его снова можно ставить.`)}
      <p class="hint">Можно поставить чабана на объект, который этот же тайл и достраивает: очки придут сразу, а чабан тут же вернётся. Если создатель включил таймер и время вышло, ход за вас сделает бот.</p>`,
    terms: `<div class="nterms">
      ${term("start", "Тайл", `квадратная карточка поля. У каждого края один из четырёх типов: аил, тропа, трава или река. Партия начинается с одного тайла в центре.`)}
      ${term("", "Чабан", `ваша фигурка, всего их ${NM.SUPPLY}. Пока чабан стоит на объекте, он занят. Домой он возвращается после подсчёта очков за этот объект. Свободные чабаны показаны внизу и под вашим именем.`)}
      ${term("ail2o", "Аил", "светлые войлочные участки, обнесённые стеной. Один аил может тянуться через много тайлов.")}
      ${term("ail4", "Орнамент", "узор на войлоке аила. Делает аил дороже.")}
      ${term("straight", "Тропа", "дорога. Кончается в колодце, у аила или у кургана и может идти через много тайлов.")}
      ${term("tee", "Колодец", "точка, где обрывается тропа: на перекрёстке или в тупике. Каждый колодец на концах тропы добавляет ей 2 очка.")}
      ${term("kurgan", "Курган", "холм в центре тайла. Его занимают, как и другие объекты, а достроен он, когда вокруг заняты все 4 клетки.")}
      ${term("herd", "Пастбище и отара", "пастбище — зелёная трава. Тропы, аилы и реки делят её на отдельные пастбища. Отара — стадо овец на траве, добавляет пастбищу 2 очка.")}
      ${term("rS", "Река", "только в дополнении «Река Нарын». Не объект: делит траву, чабана на неё не ставят.")}
      <p><b>Объект</b> — то, на что ставят чабана: аил, тропа, курган или пастбище. Если куски на соседних тайлах сходятся краями, это один общий объект.</p>
      <p><b>Достроен (завершён)</b> — аил закрыт стенами со всех сторон; у тропы оба конца упёрлись в колодец, аил или курган; вокруг кургана заняты все 4 клетки. <b>Недостроен</b> — объект не завершён к концу игры и приносит меньше.</p>
      <p><b>Перекочевать</b> — перегнать своего чабана с соседнего тайла на новый. <b>Беркутчи</b> — большой чабан из дополнения, в споре считается за двоих.</p>
      <p><b>Мешок</b> — ещё не вытянутые тайлы. В обычной партии их 81, с дополнениями больше. <b>Лето и осень</b> — две половины игры, между ними считают пастбища. <b>Цель</b> — порог очков, на котором игра кончается, или «весь мешок».</p></div>`,
    score: `<div class="ntab-wrap"><table class="ntable"><thead><tr><th>Объект</th><th>Когда считается</th><th>Достроен</th><th>Недостроен в конце</th></tr></thead><tbody>
        <tr><td><b>Аил</b></td><td>сразу, как закрыт стенами</td><td>2 за тайл + 2 за орнамент</td><td>1 за тайл + 1 за орнамент</td></tr>
        <tr><td><b>Тропа</b></td><td>сразу, как оба конца упёрлись</td><td>1 за тайл + 2 за колодец, с караваном ×2</td><td>1 за тайл</td></tr>
        <tr><td><b>Курган</b></td><td>сразу, как заняты 4 соседние клетки</td><td>6</td><td>1 + 1 за соседа</td></tr>
        <tr><td><b>Пастбище</b></td><td>в конце лета и в конце игры</td><td colspan="2">1 за каждые полные 4 тайла + 2 за отару</td></tr>
      </tbody></table></div>
      <p class="hint">Тайлы считаются по одному разу: если аил или тропа заходит на тайл дважды, это всё равно 1 тайл. Соседи кургана — клетки по сторонам, диагонали не в счёт.</p>
      ${ex(nMini([["ail2o", 0, 0, 0], ["cap", 0, -1, 2], ["cap", 1, 0, 3]], [[0, red]]), `<b>Аил</b>: 3 тайла, 1 орнамент, закрыт → 2×3 + 2×1 = <b>8</b>. Если бы к концу игры не хватило правого тайла, был бы недостроенный аил из 2 тайлов: 2 + 1 = <b>3</b>.`)}
      ${ex(nMini([["dead", 0, 0, 2], ["straight", 0, -1, 0], ["dead", 0, -2, 0]], [[1, blue]]), `<b>Тропа</b>: 3 тайла, оба конца в колодцах → 3 + 2×2 = <b>7</b>. С караваном — <b>14</b>. Недостроенная в конце считается только по тайлам: <b>3</b> (колодцы и караван не в счёт).`)}
      ${ex(nMini([["kurgan", 0, 0, 0], ["cap", 0, -1, 0], ["cap", 1, 0, 1], ["cap", 0, 1, 2], ["cap", -1, 0, 3]], [[0, red]]), `<b>Курган</b>: заняты все 4 соседние клетки → <b>6</b>. Если к концу игры рядом только 2 соседа: 1 + 2 = <b>3</b>.`)}
      ${ex(nMini([["herd", 0, 0, 0], ["kurgan", 1, 0, 0], ["kurgan", 0, 1, 0], ["kurgan", 1, 1, 0]], [[0, blue]]), `<b>Пастбище</b>: 4 тайла травы, на одном 2 отары → 1 + 2×2 = <b>5</b>. Пастбище из 7 тайлов тоже дало бы за размер только 1: считаются полные четвёрки.`)}`,
    share: `<p>Поставить чабана на занятый объект нельзя. Но можно занять отдельный кусок рядом, а потом соединить их новым тайлом: тогда на одном объекте окажутся чабаны разных игроков. При подсчёте:</p>
      <ul class="nol"><li>у кого на объекте больше чабанов, тот получает <b>все</b> очки;</li><li>остальные, у кого там есть чабаны, получают <b>половину</b> с округлением вниз;</li><li>при ничьей все лидеры получают полные очки;</li><li>беркутчи считается за двоих;</li><li>после подсчёта домой уходят все чабаны с объекта, и победителя, и проигравших.</li></ul>
      ${ex("", `Аил на 10 очков. У красного 2 чабана, у синего 1 → красный <b>+10</b>, синий <b>+5</b>.`)}
      ${ex("", `Тот же аил, но по одному чабану у каждого → оба получают по <b>+10</b>.`)}
      ${ex("", `Тропа на 7 очков. У синего беркутчи, у красного 1 чабан → синий <b>+7</b>, красный <b>+3</b> (половина от 7 с округлением вниз).`)}
      ${ex("", `<b>Как отбить чужой объект.</b> Соперник строит большой аил. Поставьте чабана на отдельный кусок аила рядом и соедините их следующими тайлами: теперь вы делите очки. Если таким же способом добавите второго чабана, аил целиком ваш.`)}`,
    end: `<h4>Лето и осень</h4>
      <p>Игра делится на два сезона. Лето кончается, когда в мешке остаётся половина тайлов: сколько осталось, видно на плашке «☀ Лето · до осени». В этот момент каждое пастбище с чабанами приносит очки, и чабаны с пастбищ уходят домой. Аилы, тропы и курганы при смене сезона не трогаются.</p>
      <p>Осенью пастбища можно занимать снова, в конце игры их посчитают второй раз.</p>
      ${ex("", `Летом красный поставил чабана на пастбище: в конце лета оно было 8 тайлов с 1 отарой → 2 + 2 = <b>4</b>, чабан дома. Осенью пастбище разрослось до 12 тайлов. Красный снова ставит на него чабана с нового тайла и в конце игры получает 3 + 2 = <b>5</b>.`)}
      <h4>Конец игры</h4>
      <ul class="nol">
        <li><b>Цель 60, 100 или 150 очков.</b> Как только после хода у кого-то набралась цель, игра сразу кончается. Недостроенное и пастбища <i>не</i> досчитываются.</li>
        <li><b>Мешок опустел</b> (или выбрано «Весь мешок»). Идёт последний подсчёт: пастбища с чабанами дают полные очки, недостроенные аилы, тропы и курганы — очки по столбцу «Недостроен» на вкладке «Очки».</li>
        <li>Побеждает тот, у кого больше очков. При равенстве побеждает тот, кто раньше в порядке хода.</li>
      </ul>`,
    mods: `<p>Дополнения включает создатель комнаты до старта.${s ? " Включённые в этой партии отмечены." : ""}</p>
      ${Object.entries(NM.MODS).map(([k, m]) => {
        const more = { river: "Река выкладывается сама в начале партии, в мешке её тайлов нет. Река не объект: чабана на неё не поставить, но она делит траву на разные пастбища. Мост — это тропа поперёк реки.", berkut: "Беркутчи один на игрока. Ставится вместо обычного чабана кнопкой «Беркутчи», домой возвращается как обычный и может кочевать. Один обычный чабан против беркутчи проигрывает (1 против 2), двое обычных — ничья.", caravan: "В мешке 5 тайлов с верблюдами. Даже если на тропе несколько караванов, удвоение одно. На недостроенную в конце тропу караван не влияет.", buran: "Буран не приходит в первые 6 ходов. Когда он вытянут, все чабаны с пастбищ уходят домой без очков, и сразу тянется следующий тайл. Не держите на траве слишком много чабанов." }[k];
        const on = s && mod(s, k);
        return `<div class="nmod ${on ? "on" : ""}"><b>${m.name}</b>${on ? '<span class="badge">включено</span>' : ""}<p>${m.text}</p><p class="hint">${more}</p></div>`;
      }).join("")}`,
    tips: `<h4>Что на экране</h4>
      <ul class="nol">
        <li><b>Полоса под именем</b> — путь к цели. «До цели N» — сколько очков осталось.</li>
        <li><b>Фигурки внизу</b> — ваши свободные чабаны. Бледные — те, что сейчас стоят на поле.</li>
        <li><b>«Этот тайл даст»</b> — кто сколько очков получит, если закончить ход так, как тайл лежит сейчас.</li>
        <li><b>Подсказка на кружке</b> (наведите курсор): что это за объект, сколько в нём тайлов, сколько он даст достроенным и сколько недостроенным в конце.</li>
        <li><b>Подсветка и «+N» на поле</b> — кто и за что только что получил очки. Рамка цвета игрока отмечает последний положенный тайл.</li>
      </ul>
      <h4>Советы</h4>
      <ul class="nol">
        <li>Не ставьте всех чабанов сразу: без запаса нечем занимать выгодные объекты.</li>
        <li>Маленький аил из 2 тайлов закрывается быстро: это 4 очка, и чабан скоро снова дома.</li>
        <li>На пастбище ставьте в начале лета: такой чабан простоит до конца сезона, зато соберёт очки со всего разросшегося пастбища.</li>
        <li>Курган выгодно ставить в середине уже застроенного поля: соседи появятся быстрее.</li>
        <li>Тропы с колодцами на обоих концах стоят заметно дороже простых.</li>
        <li>Тайл, который соперник ждёт, чтобы закрыть свой аил, можно положить в другое место: так его объект останется недостроенным.</li>
      </ul>`,
  }[tab];
  return `<div class="nrules"><div class="nrtabs" role="tablist">${NR_TABS.map(([k, t]) => `<button class="${k === tab ? "on" : ""}" role="tab" aria-selected="${k === tab}" data-nrtab="${k}">${t}</button>`).join("")}</div><div class="nrbody">${body}</div></div>`;
}

function renderNomad() {
  nEnsureDefs();
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], live = s.status === "play" && !s.paused, mine = me >= 0 && me === s.cur && live && s.tile != null;
  const cur = s.players[s.cur];
  if (!mine) ui.n = null;
  const pops = [];
  if (s.status === "play" && me >= 0 && s.pauseVote) {
    const v = s.pauseVote, needN = Math.floor(s.players.filter((p) => !p.bot).length / 2) + 1, voted = v.yes.includes(me) || v.no.includes(me);
    pops.push(pop(`${esc(nameOf(s, v.by))} предлагает ${v.to ? "поставить паузу" : "продолжить игру"}`, `<p class="hint" style="margin:0">За: ${v.yes.length}, нужно ${needN}</p>${voted ? `<p class="muted" style="margin:0">Вы проголосовали, ждём остальных</p>` : `<div class="row"><button class="btn green" data-pause="1">За</button><button class="btn red" data-pause="0">Против</button></div>`}`));
  }
  if (ui.panel === "nrules") pops.push(pop("Правила «Кочёвки»", nRulesHTML(), true));

  const left = nTilesLeft(s), tileFx = fxOn(nfx.tile, 900);
  let hud;
  if (P) {
    const n = ui.n, sup = NM.supplyLeft(s, me), big = NM.berkutLeft(s, me);
    const pv = n ? NM.preview(s, n.x, n.y, n.r) : null;
    const gains = pv ? Object.entries(pv.gains).map(([p, v]) => `<span class="ngain" style="--pc:${s.players[p].color}">${esc(+p === me ? "вам" : nameOf(s, +p))} +${v}</span>`).join("") : "";
    const card = s.tile != null ? `<div class="ncard ${tileFx ? "fresh" : ""}" title="Тайл, который сейчас выкладывают">${nTileSVG(s.tile, n ? n.r : ui.nr ?? 0)}</div>` : `<div class="ncard empty">${ICON("grid")}</div>`;
    const figs = Array.from({ length: NM.SUPPLY }, (_, k) => nFigIcon(P.color, { cls: k < sup ? "" : "used" })).join("");
    const ab = (attr, icon, label, ok, cls = "", title = label) => `<button class="ab ${cls}" ${attr} ${ok ? "" : "disabled"} title="${esc(title)}">${icon}<span class="lb">${label}</span></button>`;
    const okLabel = !n ? "Готово" : n.f != null ? (n.move != null ? "Перекочевать" : "С чабаном") : "Без чабана";
    const acts = [
      ab('data-nact="rotl"', `<span class="nrot-ic">⟲</span>`, "Повернуть", mine, "", "Повернуть против часовой (Shift+R)"),
      ab('data-nact="rotr"', `<span class="nrot-ic">⟳</span>`, "Повернуть", mine, "", "Повернуть по часовой (R)"),
      mod(s, "berkut") ? ab('data-nact="big"', nFigIcon(P.color, { big: true }), "Беркутчи", mine && big && n && n.move == null, n && n.big ? "on" : "", big ? "Беркутчи — большой чабан, в споре за объект считается за двоих. Включите и выберите кружок" : "Беркутчи уже на поле") : "",
      ab('data-nact="cancel"', ICON("exit"), "Отмена", mine && !!n, "", "Убрать тайл и выбрать другое место (Esc)"),
      ab('data-nact="ok"', ICON("end"), okLabel, mine && !!n, "go", "Закончить ход (Enter)"),
    ].join("");
    hud = `<div class="panel nhand">${card}<div class="ninfo"><b>${mine ? "Ваш тайл" : s.status === "play" ? `Тайл: ${esc(nameOf(s, s.cur))}` : "Игра окончена"}</b><span class="nleft" title="Сколько тайлов осталось в мешке">${ICON("cards")}<b>${left}</b> ${plural(left, "тайл", "тайла", "тайлов")} в мешке</span>${gains ? `<span class="ngains">Этот тайл даст: ${gains}</span>` : ""}</div>
      <span class="sep"></span><div class="nsup" title="Ваши чабаны: дома ${sup} из ${NM.SUPPLY}">${figs}${mod(s, "berkut") ? `<span class="nsup-big ${big ? "" : "used"}">${nFigIcon(P.color, { big: true })}</span>` : ""}</div></div>
      <div class="panel acts">${acts}</div>`;
  } else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель. В мешке ${left} ${plural(left, "тайл", "тайла", "тайлов")}.</div>`;
  }
  const season = s.season === "summer" ? `<span class="nseason-chip summer" title="Лето кончится, когда в мешке останется ${s.autumnAt} тайлов: тогда посчитают пастбища">☀ Лето · до осени ${Math.max(0, left - s.autumnAt)}</span>` : `<span class="nseason-chip autumn" title="Осень: пастбища посчитают ещё раз в конце игры">🍂 Осень</span>`;
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="Время хода — потом ход сделает бот">${ICON("clock")}<b></b></span>` : "";
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";
  const stormFx = fxOn(nfx.storm, 2600), seasonFx = fxOn(nfx.season, 2400);

  $("view").innerHTML = `<div class="game ngame">
    <div class="stage">
      <div class="panel turn ${mine ? "mine" : ""}" style="--pc:${cur.color}">${ava(nameOf(s, s.cur), cur.color)}
        <div class="txt"><span class="who">${s.status === "over" ? "Игра окончена" : mine ? "Ваш ход!" : "Ход: " + esc(nameOf(s, s.cur))}</span><span class="hint">${s.status === "play" ? esc(nHint(s, me)) : ""}</span></div>${timer}
        ${s.tile != null && s.status === "play" ? `<span class="nturn-tile">${nTileSVG(s.tile, ui.n ? ui.n.r : 0)}</span>` : ""}</div>
      <div class="topr"><span class="chip">Код <span class="code">${esc(s.code)}</span></span>${s.status === "over" && ui.summaryHidden ? `<button class="btn green small" data-a="summary">${ICON("cards")}<span class="tl">Итоги</span></button>` : ""}<button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "nrules" ? "on" : ""}" data-panel="nrules" title="Правила — как ходить и считать очки">${ICON("help")}<span class="tl">Правила</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту — он будет играть за вас, а вы сможете смотреть и вернуть управление">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox">${nBoardSVG(s, me)}<div class="zoombar"><button data-zoom="in" aria-label="Приблизить" title="Приблизить">+</button><button data-zoom="out" aria-label="Отдалить" title="Отдалить">−</button><button data-zoom="reset" aria-label="Показать всё поле" title="Показать всё поле">${ICON("fit")}</button></div></div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры и боты стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${stormFx ? `<div class="nstorm" ${fxDelay(nfx.storm)}></div>` : ""}
      ${mine && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваш ход!</div>` : seasonFx ? `<div class="yourturn nautumn" ${fxDelay(nfx.season)}>🍂 Осень: пастбища посчитаны</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" && !ui.summaryHidden ? nSummaryHTML(s, me) : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      <div class="panel"><div class="nstat"><span class="nbig" title="Тайлов в мешке">${ICON("cards")}<b>${left}</b><small>${plural(left, "тайл", "тайла", "тайлов")}</small></span>${season}<span class="ntarget" title="${s.target ? "Кто первым наберёт столько очков, побеждает" : "Играем, пока не кончатся тайлы"}">${ICON("sword")}${s.target ? `цель ${s.target}` : "до конца мешка"}</span></div>
        <div class="ph"><h3>Игроки</h3></div><div class="players">${nPlayerRows(s, me)}</div></div>
      <div class="panel logp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div>${fmtLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
  tickTimer();
  document.title = mine ? "Ваш ход — Кочёвка" : "Кочёвка — Жайлоо";
}

function nSummaryHTML(s, me) {
  const rows = NM.results(s), W = s.players[s.winner];
  if (me < 0) me = s.players.findIndex((p) => p.was === myId);
  const nm = (i) => { const p = s.players[i]; return (p.was && s.names?.[p.was]) || nameOf(s, i); };
  const award = (title, k, unit) => {
    const max = Math.max(...rows.map((r) => r.sc[k] || 0)), top = rows.filter((r) => (r.sc[k] || 0) === max);
    return max > 0 && top.length === 1 ? `<div class="award">${ICON("sword")}<span><b>${title}</b>${esc(nm(top[0].i))} · ${max} ${unit}</span></div>` : "";
  };
  const awards = [award("Строитель аилов", "ail", "очк. за аилы"), award("Путник", "trail", "очк. за тропы"), award("Хранитель курганов", "kurgan", "очк. за курганы"), award("Чабан года", "pasture", "очк. за пастбища")].join("");
  const rating = (r) => {
    const x = s.ratings?.[r.i];
    if (!x) return `<span class="muted" title="Рейтинг считается только у игроков с аккаунтом">—</span>`;
    return `${x.before + x.delta} <b class="${x.delta >= 0 ? "up" : "down"}">${x.delta >= 0 ? "+" : ""}${x.delta}</b>`;
  };
  const table = `<div class="tablewrap"><table class="sumtable"><thead><tr><th>Место</th><th>Игрок</th><th>Очки</th><th>Аилы</th><th>Тропы</th><th>Курганы</th><th>Пастбища</th><th>Рейтинг</th></tr></thead><tbody>
    ${rows.map((r) => { const p = s.players[r.i]; return `<tr class="${r.i === me ? "mine" : ""}">
      <td class="pl-n">${r.place <= 3 ? `<span class="medal m${r.place}">${r.place}</span>` : r.place}</td>
      <td><span class="who2">${ava(nm(r.i), p.color, "sm")}<span>${esc(nm(r.i))}${p.bot && !p.was ? `<small>бот · ${LEVEL_RU[p.level || "medium"]}</small>` : p.was ? "<small>доигрывал бот</small>" : ""}</span></span></td>
      <td><b class="bigvp">${r.vp}</b></td><td class="tn">${r.sc.ail}</td><td class="tn">${r.sc.trail}</td><td class="tn">${r.sc.kurgan}</td><td class="tn">${r.sc.pasture}</td><td class="tn">${rating(r)}</td></tr>`; }).join("")}
  </tbody></table></div>`;
  const info = [`${Object.keys(s.tiles).length} тайлов на поле`, s.startedAt && s.endedAt && fmtDur(s.endedAt - s.startedAt), s.target ? `цель ${s.target}` : "до конца мешка", ...Object.keys(NM.MODS).filter((k) => mod(s, k)).map((k) => NM.MODS[k].name)].filter(Boolean).join(" · ");
  const my = me >= 0 && s.ratings?.[me];
  return `<div class="over sum"><div class="panel">
    <div class="sum-h">${ava(nm(s.winner), W.color)}<div><span class="w">${s.winner === me ? "Вы победили!" : `${esc(nm(s.winner))} побеждает!`}</span><span class="muted">${info}</span></div></div>
    ${my ? `<p class="myrate">Ваш рейтинг: <b>${my.before + my.delta}</b> <b class="${my.delta >= 0 ? "up" : "down"}">${my.delta >= 0 ? "+" : ""}${my.delta}</b></p>` : me >= 0 && !account ? `<p class="hint">Партия не попала в рейтинг: <button class="link" data-a="authopen">войдите или зарегистрируйтесь</button>, чтобы следующие считались.</p>` : ""}
    ${table}
    ${awards ? `<div class="awards">${awards}</div>` : ""}
    <div class="row"><button class="btn green" data-a="back">К списку партий</button>${rematchBtn(s)}<button class="btn" data-a="hidesummary">Посмотреть поле</button></div>
  </div></div>`;
}

// --- управление ---
function nRotate(dir) {
  const s = game, me = myIndex();
  if (!ui.n) { ui.nr = ((ui.nr ?? 0) + dir + 4) % 4; return render(); }
  const sp = nSpotAt(s, me, ui.n.x, ui.n.y);
  if (!sp) return;
  const rots = [...sp.rots].sort((a, b) => a - b), i = rots.indexOf(ui.n.r);
  ui.n.r = rots[(i + dir + rots.length) % rots.length];
  ui.nr = ui.n.r;
  if (ui.n.f != null && !NM.preview(s, ui.n.x, ui.n.y, ui.n.r).feats[ui.n.f]?.free) ui.n.f = null;
  render();
}
function nConfirm() {
  const n = ui.n;
  if (!n) return;
  const a = { type: "turn", x: n.x, y: n.y, r: n.r };
  if (n.f != null) a.f = n.f;
  if (n.move != null) a.move = n.move;
  else if (n.f != null && n.big) a.big = true;
  act(a);
}
document.addEventListener("click", (ev) => {
  if (!game || game.game !== "nomad" || game.status !== "play") return;
  const el = ev.target.closest("[data-nf],[data-nmove],[data-nrot],[data-nspot],[data-nact]");
  if (!el || el.disabled) return;
  const d = el.dataset, s = game, me = myIndex();
  if (me < 0 || me !== s.cur || s.paused || s.tile == null) return;
  if (d.nspot) {
    const [x, y] = d.nspot.split(",").map(Number), sp = nSpotAt(s, me, x, y);
    if (!sp) return;
    ui.n = { x, y, r: nStartRot(sp), f: null, big: false, move: null };
    return render();
  }
  if (d.nf !== undefined) {
    const i = +d.nf;
    if (ui.n.f === i) ui.n.f = null;
    else {
      ui.n.f = i;
      // Простых чабанов нет — ставим беркутчи.
      if (ui.n.move == null && NM.supplyLeft(s, me) <= 0) ui.n.big = true;
    }
    return render();
  }
  if (d.nmove !== undefined) {
    const i = +d.nmove;
    ui.n.move = ui.n.move === i ? null : i;
    if (ui.n.move != null) ui.n.big = false;
    return render();
  }
  if (d.nrot) return nRotate(1);
  if (d.nact === "rotl") return nRotate(-1);
  if (d.nact === "rotr") return nRotate(1);
  if (d.nact === "cancel") { ui.n = null; return render(); }
  if (d.nact === "big") { ui.n.big = !ui.n.big; return render(); }
  if (d.nact === "ok") return nConfirm();
});
document.addEventListener("keydown", (ev) => {
  if (!game || game.game !== "nomad" || game.status !== "play" || ev.target.tagName === "INPUT") return;
  if (myIndex() !== game.cur || game.paused) return;
  if (ev.key === "r" || ev.key === "R" || ev.key === "к" || ev.key === "К") { ev.preventDefault(); nRotate(ev.shiftKey ? -1 : 1); }
  else if (ev.key === "Enter" && ui.n) { ev.preventDefault(); nConfirm(); }
  else if (ev.key === "Escape" && ui.n) { ui.n = null; render(); }
});
