// Экран «Мафии»: новости утра, своя роль, карточки жителей с ночными и дневными кнопками, чат с каналами и журнал.
// Ночью стол темнеет. Грузится до client.js и пользуется его общими помощниками (ui, game, act, ava, ICON…) только из функций.
const MF = MAFIA;

function mafNotice(old, s) {
  if (!old || old.status !== "play" || s.status !== "play") return;
  const me = myIndex();
  if (s.phase === "night" && old.phase !== "night") toast(`Ночь ${s.day}. Город засыпает`);
  // Днём мафия тоже говорит в общем чате — возвращаем вкладку туда.
  if (old.phase === "night" && s.phase !== "night") ui.chatCh = "all";
  if (s.phase === "speech" && old.phase === "night" && s.lastNight) toast(s.lastNight.killed != null ? `Утро: убит ${nameOf(s, s.lastNight.killed)}` : "Утро: этой ночью никто не погиб", false, 5000);
  if (me >= 0 && s.phase === "speech" && s.cur === me && (old.cur !== me || old.phase !== "speech")) fx.turn = { t: Date.now() };
  if (me >= 0 && s.players[me].dead && !old.players[me].dead) toast("Вас убили. Смотрите дальше и пишите в чат мёртвых", false, 6000);
  // Новая проверка шерифа или дона — сразу говорим результат.
  const P = s.players[me], O = old.players[me];
  if (P && O && P.checks.length > O.checks.length) {
    const c = P.checks[P.checks.length - 1];
    toast(P.role === "don" ? `${nameOf(s, c.t)} — ${c.sheriff ? "шериф!" : "не шериф"}` : `${nameOf(s, c.t)} — ${c.mafia ? "мафия!" : "мирный"}`, false, 6000);
  }
}

// Что я могу сделать с игроком i прямо сейчас: [действие, подпись] или null.
function mafAction(s, me, i) {
  const P = s.players[me], T = s.players[i];
  if (!P || P.dead || T.dead || s.status !== "play" || s.paused) return null;
  if (s.phase === "night") {
    const N = s.night || {};
    // Дон сначала голосует за жертву, потом ищет шерифа.
    if (P.role === "don" && mod(s, "don") && N.kill?.[me] !== undefined && N.check?.[me] === undefined) return MF.isMafia(T) ? null : ["check", "Проверить"];
    if (MF.isMafia(P) && !MF.isMafia(T)) return ["kill", N.kill?.[me] === i ? "Цель ✓" : "Убить"];
    if (P.role === "doctor") {
      if ((P.lastHeal === i && P.lastHealDay === s.day - 1) || (i === me && P.selfHeal)) return null;
      return ["heal", N.heal === i ? "Лечу ✓" : "Лечить"];
    }
    if ((P.role === "sheriff" || (P.role === "don" && mod(s, "don"))) && i !== me && N.check?.[me] === undefined && !(P.role === "don" && MF.isMafia(T))) return ["check", "Проверить"];
    return null;
  }
  if (s.phase === "speech" && s.cur === me && P.nominated == null && i !== me && !s.noms.includes(i)) return ["nominate", "Выставить"];
  if ((s.phase === "vote" || s.phase === "revote") && s.votes?.[me] === undefined && i !== me && (s.cands || []).includes(i)) return ["vote", "Против"];
  return null;
}

function mafHint(s, me) {
  if (s.paused) return "Игра на паузе";
  const P = s.players[me];
  if (P?.dead) return "Вы выбыли: смотрите и пишите в чат мёртвых";
  if (s.phase === "night") {
    if (!P) return "Город спит";
    const N = s.night || {};
    if (MF.isMafia(P)) return N.kill?.[me] !== undefined ? (P.role === "don" && mod(s, "don") && N.check?.[me] === undefined ? "Теперь проверьте, кто шериф" : "Ждём остальных — цель можно сменить") : "Выберите жертву вместе со своими — чат «Мафия»";
    if (P.role === "doctor") return N.heal != null ? "Ждём утра — можно передумать" : "Кого лечите этой ночью?";
    if (P.role === "sheriff") return N.check?.[me] !== undefined ? "Проверка сделана, ждём утра" : "Кого проверяете этой ночью?";
    return "Город спит. Ждите утра";
  }
  if (s.phase === "speech") {
    if (s.cur !== me) return `Говорит ${nameOf(s, s.cur)}`;
    return P.nominated == null ? "Говорите в чат. Можно выставить одного игрока" : "Закончите речь, когда скажете всё";
  }
  if (s.phase === "vote") return "Голосуйте против одного из выставленных";
  if (s.phase === "revote") return "Переголосование между теми, у кого поровну голосов";
  return "";
}

function mafNewsHTML(s, me) {
  const L = s.lastNight, P = s.players[me];
  const news = s.phase === "night" ? `<b>Ночь ${s.day}</b><span>Город спит${s.night?.done ? ` · ночных ходов: ${s.night.done}` : ""}</span>`
    : L ? `<b>Утро дня ${L.day}</b><span>${L.killed != null ? `Убит ${esc(nameOf(s, L.killed))}${s.players[L.killed].role ? ` — ${MF.roleRu(s.players[L.killed].role).toLowerCase()}` : ""}` : L.saved ? "Мафия выходила на охоту, но доктор успел" : "Этой ночью никто не погиб"}</span>` : "";
  const noms = (s.noms || []).length && s.status === "play" && s.phase !== "night" ? `<div class="fnoms"><span class="blbl">Выставлены</span>${s.noms.map((i) => `<span class="who2">${ava(nameOf(s, i), s.players[i].color, "sm")}${esc(nameOf(s, i))}</span>`).join("")}</div>` : "";
  let role = "";
  if (P && P.role) {
    const R = MF.ROLES[P.role], mates = MF.isMafia(P) ? s.players.map((p, i) => i).filter((i) => i !== me && MF.isMafia(s.players[i])) : [];
    const checks = (P.checks || []).map((c) => `<li>${esc(nameOf(s, c.t))} — <b class="${(P.role === "don" ? c.sheriff : c.mafia) ? "down" : "up"}">${P.role === "don" ? (c.sheriff ? "шериф" : "не шериф") : c.mafia ? "мафия" : "мирный"}</b> <small class="muted">ночь ${c.day}</small></li>`).join("");
    role = `<div class="frole ${R.team}"><span class="blbl">Ваша роль</span><b>${R.name}</b><span>${R.text}</span>
      ${mates.length ? `<p class="fmates">Ваши: ${mates.map((i) => esc(nameOf(s, i))).join(", ")}</p>` : ""}
      ${checks ? `<ul class="fchecks">${checks}</ul>` : ""}</div>`;
  }
  return `<div class="panel fnews"><div class="fday">${news}${noms}</div>${role}</div>`;
}

function mafTile(s, i, me) {
  const p = s.players[i], A = mafAction(s, me, i), voting = (s.phase === "vote" || s.phase === "revote") && s.status === "play";
  const N = s.night || {}, mafVotes = s.phase === "night" && me >= 0 && MF.isMafia(s.players[me]) ? Object.keys(N.kill || {}).filter((k) => N.kill[k] === i) : [];
  const chosen = (s.phase === "night" && ((N.kill?.[me] === i) || (N.heal === i && s.players[me]?.role === "doctor"))) || (voting && s.votes?.[me] === i);
  const badges = [
    i === me ? '<span class="badge">вы</span>' : "",
    p.bot ? '<span class="badge">бот</span>' : "",
    offTag(s, i),
    p.role ? `<span class="badge frb ${MF.ROLES[p.role].team}">${MF.roleRu(p.role)}</span>` : "",
    p.dead ? `<span class="badge red">${p.how === "vote" ? "казнён" : "убит"}${p.diedDay ? ` · день ${p.diedDay}` : ""}</span>` : "",
    s.status === "play" && (s.noms || []).includes(i) && s.phase !== "night" ? '<span class="badge gold">выставлен</span>' : "",
    voting && s.votes?.[i] !== undefined ? '<span class="badge">проголосовал</span>' : "",
  ].join("");
  const by = s.status === "play" && s.phase !== "night" ? s.players.map((q, j) => (q.nominated === i ? nameOf(s, j) : null)).filter(Boolean) : [];
  return `<div class="panel ftile ${p.dead ? "out" : ""} ${i === s.cur && s.phase === "speech" ? "cur" : ""} ${chosen ? "target" : ""}" style="--pc:${p.color}">
    <div class="bth">${ava(nameOf(s, i), p.color)}<div class="bt-n"><b>${esc(nameOf(s, i))}</b><span>${badges}</span></div></div>
    ${by.length ? `<small class="muted">выставил${by.length > 1 ? "и" : ""}: ${by.map(esc).join(", ")}</small>` : ""}
    ${mafVotes.length ? `<small class="fmv">цель мафии: ${mafVotes.map((k) => esc(nameOf(s, +k))).join(", ")}</small>` : ""}
    ${A ? `<button class="btn small ${A[0] === "vote" || A[0] === "kill" ? "red" : A[0] === "heal" ? "green" : "blue"}" data-fa="${A[0]}" data-ft="${i}">${A[1]}</button>` : ""}
  </div>`;
}

function mafRulesHTML() {
  return `<div class="nrules">
    <p>В городе завелась мафия. Роли раздаются втайне: <b>мафия</b> (1 мафиози на 5 игроков, 2 — на 6–8, 3 — на 9–12; с дополнением один из них — <b>дон</b>), <b>шериф</b>, <b>доктор</b> и <b>мирные жители</b>. Мафиози знают друг друга.</p>
    <p><b>Ночь.</b> Мафия выбирает жертву в своём закрытом чате и кнопкой «Убить»; при ничьей решает голос дона, иначе жребий. Доктор лечит одного игрока — если мафия выбрала его, он выживет (одного и того же — не две ночи подряд, себя — один раз за игру). Шериф проверяет, мафия ли игрок; дон ищет шерифа. Ответ видит только проверявший. Ночью общий чат закрыт.</p>
    <p><b>День.</b> Утром объявляют, кто погиб. Потом каждый живой по очереди говорит в чате и может выставить одного подозреваемого. После речей — голосование против одного из выставленных. У кого больше голосов, того казнят. Ничья — переголосование, снова ничья — сегодня никого не казнят. Никого не выставили — сразу ночь.</p>
    <p><b>Победа.</b> Город побеждает, когда мафии не осталось. Мафия — когда мафиози не меньше, чем остальных живых.</p>
    <p>Выбывшие смотрят игру и пишут в чат мёртвых — живые его не видят. С дополнением «Открывать роль убитого» роль выбывшего видна всем. Боты не говорят: ночью делают ход своей роли, днём выставляют и голосуют — шериф против найденной мафии, мафия против мирных.</p>
  </div>`;
}
const MAFSTEPS = [
  "Роли раздаются втайне: мафия, шериф, доктор и мирные жители. Мафиози знают друг друга, остальные — нет.",
  "Ночью мафия выбирает жертву в закрытом чате. Доктор лечит одного игрока, шериф проверяет, мафия ли он.",
  "Утром город узнаёт, кто погиб. Каждый по очереди говорит в чате и может выставить подозреваемого.",
  "После речей — голосование против одного из выставленных. У кого больше голосов, того казнят.",
  "Выбывшие смотрят и пишут в чат мёртвых. Живые их не слышат.",
  "Город побеждает, когда мафии не осталось. Мафия — когда её не меньше, чем мирных.",
];

function mafSummaryHTML(s, me) {
  if (me < 0) me = s.players.findIndex((p) => p.was === myId);
  const town = s.winTeam === "town", won = me >= 0 && (s.winners || []).includes(me), my = me >= 0 && s.ratings?.[me];
  const info = [`${s.day} ${plural(s.day, "день", "дня", "дней")}`, s.startedAt && s.endedAt && fmtDur(s.endedAt - s.startedAt), ...Object.keys(MF.MODS).filter((k) => mod(s, k)).map((k) => MF.MODS[k].name)].filter(Boolean).join(" · ");
  const rows = s.players.map((p, i) => i).sort((a, b) => (s.winners.includes(b) - s.winners.includes(a))).map((i) => {
    const p = s.players[i], x = s.ratings?.[i];
    return `<tr class="${i === me ? "mine" : ""}"><td><span class="who2">${ava(nameOf(s, i), p.color, "sm")}<span>${esc(nameOf(s, i))}</span></span></td>
      <td><span class="badge frb ${MF.ROLES[p.role].team}">${MF.roleRu(p.role)}</span></td>
      <td>${p.dead ? `${p.how === "vote" ? "казнён" : "убит"} в ${p.diedDay}-й ${p.how === "vote" ? "день" : "ночь"}` : "жив"}</td>
      <td class="tn">${x ? `${x.before + x.delta} <b class="${x.delta >= 0 ? "up" : "down"}">${x.delta >= 0 ? "+" : ""}${x.delta}</b>` : '<span class="muted">—</span>'}</td></tr>`;
  }).join("");
  return `<div class="over sum"><div class="panel">
    <div class="sum-h"><span class="fbig ${town ? "town" : "mafia"}" aria-hidden="true">${town ? "🌅" : "🎩"}</span><div><span class="w">${town ? "Город победил!" : "Мафия захватила город!"}${me >= 0 ? (won ? " Вы в победителях" : " Вы проиграли") : ""}</span><span class="muted">${esc(info)}</span></div></div>
    ${my ? `<p class="myrate">Ваш рейтинг: <b>${my.before + my.delta}</b> <b class="${my.delta >= 0 ? "up" : "down"}">${my.delta >= 0 ? "+" : ""}${my.delta}</b></p>` : me >= 0 && !account ? `<p class="hint">Партия не попала в рейтинг: <button class="link" data-a="authopen">войдите или зарегистрируйтесь</button>, чтобы следующие считались.</p>` : ""}
    <div class="tablewrap"><table class="sumtable"><thead><tr><th>Игрок</th><th>Роль</th><th>Итог</th><th>Рейтинг</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin:0">Чат мафии и чат мёртвых теперь открыты всем — загляните, кто что задумывал.</p>
    <div class="row"><button class="btn green" data-a="back">К списку партий</button>${rematchBtn(s)}<button class="btn" data-a="hidesummary">Посмотреть стол</button></div>
  </div></div>`;
}

function renderMafia() {
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], live = s.status === "play" && !s.paused;
  document.body.classList.toggle("fnight", s.status === "play" && s.phase === "night");
  const pops = [];
  if (s.status === "play" && me >= 0 && s.pauseVote) {
    const v = s.pauseVote, needN = Math.floor(s.players.filter((p) => !p.bot).length / 2) + 1, voted = v.yes.includes(me) || v.no.includes(me);
    pops.push(pop(`${esc(nameOf(s, v.by))} предлагает ${v.to ? "поставить паузу" : "продолжить игру"}`, `<p class="hint" style="margin:0">За: ${v.yes.length}, нужно ${needN}</p>${voted ? `<p class="muted" style="margin:0">Вы проголосовали, ждём остальных</p>` : `<div class="row"><button class="btn green" data-pause="1">За</button><button class="btn red" data-pause="0">Против</button></div>`}`));
  }
  if (ui.panel === "frules") pops.push(pop("Правила «Мафии»", mafRulesHTML(), true));

  let hud;
  if (P) {
    const ab = (attr, label, ok, cls = "", title = label) => `<button class="ab wide ${cls}" ${attr} ${ok ? "" : "disabled"} title="${esc(title)}"><span class="lb">${label}</span></button>`;
    const voting = s.phase === "vote" || s.phase === "revote", alive = live && !P.dead;
    const acts = [
      alive && s.phase === "speech" && s.cur === me ? ab('data-fa="done"', "Закончить речь", true, "go", "Передать слово следующему") : "",
      alive && voting && s.votes?.[me] === undefined ? ab('data-fa="abstain"', "Воздержаться", true, "", "Не голосовать ни за кого") : "",
      alive && s.phase === "night" && MF.isMafia(P) && s.night?.kill?.[me] === undefined ? ab('data-fa="spare"', "Никого не убивать", true, "", "Этой ночью — без жертвы") : "",
    ].join("");
    hud = acts ? `<div class="panel acts">${acts}</div>` : P.dead ? `<div class="panel spect muted">Вы выбыли. Чат мёртвых живые не видят.</div>` : "";
  } else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель. Роли от вас скрыты.</div>`;
  }
  const speaking = s.phase === "speech" && s.cur >= 0, cur = speaking ? s.players[s.cur] : null;
  const head = s.status === "over" ? "Игра окончена" : s.phase === "night" ? `Ночь ${s.day}` : speaking ? (s.cur === me ? "Ваша речь!" : `Говорит ${esc(nameOf(s, s.cur))}`) : s.phase === "revote" ? "Переголосование" : "Голосование";
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="${s.phase === "night" ? "Время ночи — потом утро" : s.phase === "speech" ? "Время речи — потом слово перейдёт дальше" : "Время на голос — кто не успел, воздерживается"}">${ICON("clock")}<b></b></span>` : "";
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";
  const votedN = s.votes ? Object.keys(s.votes).length : 0, liveN = MF.alive(s).length;
  const order = s.status === "play" && speaking ? s.order || [] : [];
  const tiles = s.players.map((_, i) => i).sort((a, b) => s.players[a].dead - s.players[b].dead || (b === me) - (a === me)).map((i) => mafTile(s, i, me)).join("");

  $("view").innerHTML = `<div class="game bgame fgame">
    <div class="stage">
      <div class="panel turn ${speaking && s.cur === me && live ? "mine" : ""}" style="--pc:${cur ? cur.color : s.phase === "night" ? "#5c6bc0" : "var(--gold)"}">${cur ? ava(nameOf(s, s.cur), cur.color) : `<span class="ava fmoon">${s.phase === "night" ? "🌙" : "☀"}</span>`}
        <div class="txt"><span class="who">${head}</span><span class="hint">${s.status === "play" ? esc(mafHint(s, me)) : ""}${s.status === "play" && (s.phase === "vote" || s.phase === "revote") ? ` · голосов ${votedN}/${liveN}` : ""}</span></div>${timer}</div>
      <div class="topr"><span class="chip">${s.phase === "night" ? "Ночь" : "День"} <b>${s.day}</b></span><span class="chip">Код <span class="code">${esc(s.code)}</span></span>${s.status === "over" && ui.summaryHidden ? `<button class="btn green small" data-a="summary">${ICON("cards")}<span class="tl">Итоги</span></button>` : ""}<button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "frules" ? "on" : ""}" data-panel="frules" title="Правила">${ICON("help")}<span class="tl">Правила</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox bbox">
        ${mafNewsHTML(s, me)}
        ${order.length ? `<div class="border">${order.map((i) => `<span class="${i === s.cur ? "now" : order.indexOf(i) < order.indexOf(s.cur) ? "done" : ""}" title="${esc(nameOf(s, i))}">${ava(nameOf(s, i), s.players[i].color, "sm")}</span>`).join("")}</div>` : ""}
        <div class="btiles">${tiles}</div>
      </div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${speaking && s.cur === me && live && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваша речь!</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" && !ui.summaryHidden ? mafSummaryHTML(s, me) : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      ${chatHTML(s, me)}
      <div class="panel logp blogp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div>${bLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
  tickTimer();
  document.title = speaking && s.cur === me ? "Ваша речь — Мафия" : s.phase === "night" ? "Ночь — Мафия" : "Мафия — Жайлоо";
}

document.addEventListener("click", (ev) => {
  if (!game || game.game !== "mafia") return;
  const el = ev.target.closest("[data-fa]");
  if (!el || el.disabled) return;
  const d = el.dataset, t = d.ft !== undefined ? +d.ft : null;
  if (d.fa === "done") return act({ type: "done" });
  if (d.fa === "abstain") { if (confirm("Воздержаться и не голосовать ни за кого?")) act({ type: "vote", target: null }); return; }
  if (d.fa === "spare") { if (confirm("Этой ночью никого не убивать?")) act({ type: "kill", target: null }); return; }
  if (d.fa === "nominate") { if (confirm(`Выставить ${nameOf(game, t)}? Выставить можно только одного.`)) act({ type: "nominate", target: t }); return; }
  if (d.fa === "check") { if (confirm(`Проверить ${nameOf(game, t)}? Проверка одна за ночь.`)) act({ type: "check", target: t }); return; }
  act({ type: d.fa, target: t });
});
