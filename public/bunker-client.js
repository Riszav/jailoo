// Экран «Бункера»: катастрофа и бункер сверху, карточки игроков с открытыми картами, своя рука внизу,
// голосование прямо на карточках, чат и журнал сбоку.
// Грузится до client.js и пользуется его общими помощниками (ui, game, act, ava, ICON…) только из функций.
const BU = BUNKER;

function bunkerNotice(old, s) {
  if (!old || old.status !== "play" || s.status !== "play") return;
  const me = myIndex();
  if (me < 0) return;
  const now = Date.now();
  if (s.phase === "speech" && s.cur === me && (old.cur !== me || old.phase !== "speech" || old.round !== s.round)) fx.turn = { t: now };
  if ((s.phase === "vote" || s.phase === "revote") && old.phase !== s.phase) toast(s.phase === "revote" ? "Ничья — переголосование!" : "Голосование: кого не пускаем в бункер?");
  if (s.players[me].out && !old.players[me].out) toast("Вас не пустили в бункер. Можно смотреть дальше и писать в чат", false, 6000);
}

// В журнале игроки — «@3»; в «Бункере» мест до 12, поэтому номер может быть двузначным.
const bLog = (s, t) => esc(t).replace(/@(\d+)/g, (_, i) => { const p = s.players[+i]; return p ? `<b class="who" style="background:${p.color};color:${inkOn(p.color)}">${esc(nameOf(s, +i))}</b>` : "<b>?</b>"; });
const bName = (s, i) => { const p = s.players[i]; return (p.was && s.names?.[p.was]) || nameOf(s, i); };

function bHint(s, me) {
  if (s.paused) return "Игра на паузе";
  const cur = s.cur >= 0 ? nameOf(s, s.cur) : "";
  if (me >= 0 && s.players[me].out) return "Вы за дверью: смотрите и пишите в чат";
  switch (s.phase) {
    case "speech":
      if (s.cur !== me) return `Говорит ${cur}${s.revealed ? "" : " — сейчас откроет карту"}`;
      if (!s.revealed) return s.round === 1 ? "Откройте профессию и представьтесь" : "Выберите карту внизу и откройте её";
      return "Расскажите в чате, зачем вы нужны в бункере, и завершите речь";
    case "talk": return "Решите в чате, кого не пускать, и нажмите «Готов голосовать»";
    case "vote": return "Нажмите «Против» на карточке игрока или воздержитесь";
    case "revote": return "Переголосование между теми, у кого поровну голосов";
  }
  return "";
}

function bScenarioHTML(s) {
  if (!s.cat) return "";
  const live = BU.alive(s).length;
  return `<div class="panel bscen">
    <div class="bcat"><span class="blbl">Катастрофа</span><b>${esc(s.cat.name)}</b><span>${esc(s.cat.text)}</span></div>
    <div class="bbunker"><span class="blbl">Бункер</span>
      <span class="bseats"><b>${s.seats}</b> ${plural(s.seats, "место", "места", "мест")} · ${live} ${plural(live, "претендент", "претендента", "претендентов")} · сидеть ${s.cat.years} ${plural(s.cat.years, "год", "года", "лет")}</span>
      <ul>${(s.features || []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
  </div>`;
}

function bPlayerTile(s, i, me) {
  const p = s.players[i], cards = p.cards || {}, voting = (s.phase === "vote" || s.phase === "revote") && s.status === "play";
  const canVote = voting && me >= 0 && !s.players[me].out && s.votes?.[me] === undefined && i !== me && (s.cands || []).includes(i) && !s.paused;
  const myVote = s.votes?.[me], voted = voting && s.votes?.[i] !== undefined;
  const rows = BU.TRAITS.map(([k, label]) => cards[k] != null
    ? `<li class="${p.open.includes(k) ? "op" : "mine"}"><span>${label}</span><b>${esc(cards[k])}</b></li>`
    : `<li class="cl"><span>${label}</span><b>закрыто</b></li>`).join("");
  const badges = [
    i === me ? '<span class="badge">вы</span>' : "",
    offTag(s, i),
    p.bot ? '<span class="badge">бот</span>' : "",
    p.out ? `<span class="badge red">за дверью${p.outRound ? ` · ${p.outRound} раунд` : ""}</span>` : s.status === "over" ? '<span class="badge green">в бункере</span>' : "",
    voted ? '<span class="badge gold">проголосовал</span>' : "",
    voting && !p.out && !(s.cands || []).includes(i) ? '<span class="badge">вне переголосования</span>' : "",
  ].join("");
  return `<div class="panel btile ${p.out ? "out" : ""} ${i === s.cur && s.phase === "speech" ? "cur" : ""} ${voting && myVote === i ? "target" : ""}" style="--pc:${p.color}">
    <div class="bth">${ava(bName(s, i), p.color)}<div class="bt-n"><b>${esc(bName(s, i))}</b><span>${badges}</span></div></div>
    <ul class="btraits">${rows}</ul>
    ${canVote ? `<button class="btn red small" data-bvote="${i}">Против</button>` : voting && myVote === i ? `<span class="bvoted">Ваш голос — против</span>` : ""}
  </div>`;
}

function bHandHTML(s, me) {
  const P = s.players[me], mine = s.status === "play" && !s.paused && s.phase === "speech" && s.cur === me && !P.out;
  const pickable = (k) => mine && !s.revealed && !P.open.includes(k) && (s.round > 1 || k === "prof");
  const cards = BU.TRAITS.map(([k, label]) => {
    const open = P.open.includes(k), can = pickable(k), sel = ui.bk === k;
    return `<button class="bcard ${open ? "open" : ""} ${sel ? "sel" : ""} ${can ? "can" : ""}" data-bk="${k}" ${can ? "" : "disabled"} title="${open ? "Открыта — все её видят" : "Закрыта — видите только вы"}"><span class="blbl">${label}</span><b>${esc(P.cards[k])}</b><small>${open ? "открыта" : "закрыта"}</small></button>`;
  }).join("");
  const ab = (attr, label, ok, cls = "", title = label) => `<button class="ab wide ${cls}" ${attr} ${ok ? "" : "disabled"} title="${esc(title)}"><span class="lb">${label}</span></button>`;
  const voting = s.phase === "vote" || s.phase === "revote", live = s.status === "play" && !s.paused && !P.out;
  const acts = [
    mine && !s.revealed ? ab('data-ba="reveal"', "Открыть карту", !!ui.bk, "go", "Открыть выбранную карту всем") : "",
    mine && s.revealed ? ab('data-ba="done"', "Закончить речь", true, "go", "Передать слово следующему") : "",
    live && s.phase === "talk" ? ab('data-ba="ready"', s.ready?.includes(me) ? "Ждём остальных" : "Готов голосовать", !s.ready?.includes(me), "go", "Голосование начнётся, когда готовы все") : "",
    live && voting && s.votes?.[me] === undefined ? ab('data-ba="abstain"', "Воздержаться", true, "", "Не голосовать ни за кого") : "",
  ].join("");
  return `<div class="panel bhand">${cards}</div>${acts ? `<div class="panel acts">${acts}</div>` : ""}`;
}

function bRulesHTML() {
  return `<div class="nrules">
    <p>После катастрофы уцелел один бункер, и мест в нём хватит только половине из вас. У каждого — восемь тайных карт персонажа: профессия, пол и возраст, здоровье, хобби, фобия, характер, багаж и особый факт.</p>
    <p><b>Раунд 1.</b> Все по очереди открывают профессию и представляются. В первом раунде никого не выгоняют.</p>
    <p><b>Следующие раунды.</b> Каждый в свой черёд открывает одну карту на выбор и объясняет в чате, чем он полезен. Потом общее обсуждение — и голосование: каждый голосует против одного игрока или воздерживается. У кого больше голосов, тот остаётся за дверью, и все его карты открываются.</p>
    <p><b>Ничья</b> — переголосование между лидерами. Снова ничья — решает жребий.</p>
    <p><b>Конец.</b> Когда в бункере остаётся столько людей, сколько в нём мест, двери закрываются. Все, кто внутри, побеждают.</p>
    <p>Выбывшие остаются за столом: смотрят, пишут в чат, но не голосуют. Боты не спорят — они открывают случайную карту и голосуют за того, против кого уже больше голосов.</p>
  </div>`;
}
const BSTEPS = [
  "Мир погиб. Уцелел один бункер, и мест в нём хватит только половине. Катастрофа и то, что есть в бункере, известны всем.",
  "У каждого восемь тайных карт персонажа: профессия, здоровье, хобби, фобия, багаж и другие. Видите их только вы.",
  "В первом раунде все открывают профессию. Дальше каждый в свой черёд открывает ещё одну карту и убеждает остальных в чате.",
  "После речей — обсуждение и голосование. У кого больше голосов, тот остаётся за дверью, и все его карты открываются.",
  "Ничья — переголосование, снова ничья — жребий. Выбывшие смотрят и пишут в чат, но не голосуют.",
  "Когда в бункере осталось столько людей, сколько мест, двери закрываются: все, кто внутри, побеждают.",
];

function bSummaryHTML(s, me) {
  if (me < 0) me = s.players.findIndex((p) => p.was === myId);
  const inside = s.winners || [], my = me >= 0 && s.ratings?.[me];
  const outs = (s.outs || []).map((i, k) => `${esc(bName(s, i))} <small class="muted">(${k + 1}-й)</small>`).join(", ");
  const info = [s.cat?.name, `${s.round} ${plural(s.round, "раунд", "раунда", "раундов")}`, s.startedAt && s.endedAt && fmtDur(s.endedAt - s.startedAt)].filter(Boolean).join(" · ");
  return `<div class="over sum"><div class="panel">
    <div class="sum-h"><span class="bdoor" aria-hidden="true">${ICON("logo")}</span><div><span class="w">${me >= 0 && inside.includes(me) ? "Вы в бункере!" : "Двери бункера закрылись"}</span><span class="muted">${esc(info)}</span></div></div>
    ${my ? `<p class="myrate">Ваш рейтинг: <b>${my.before + my.delta}</b> <b class="${my.delta >= 0 ? "up" : "down"}">${my.delta >= 0 ? "+" : ""}${my.delta}</b></p>` : me >= 0 && !account ? `<p class="hint">Партия не попала в рейтинг: <button class="link" data-a="authopen">войдите или зарегистрируйтесь</button>, чтобы следующие считались.</p>` : ""}
    <h4>В бункере</h4><div class="binside">${inside.map((i) => `<span class="who2">${ava(bName(s, i), s.players[i].color, "sm")}<span>${esc(bName(s, i))}<small>${esc(s.players[i].cards?.prof || "")}</small></span>${s.ratings?.[i] ? `<b class="${s.ratings[i].delta >= 0 ? "up" : "down"}">${s.ratings[i].delta >= 0 ? "+" : ""}${s.ratings[i].delta}</b>` : ""}</span>`).join("")}</div>
    ${outs ? `<h4>За дверью, по порядку</h4><p class="hint" style="margin:0">${outs}</p>` : ""}
    <div class="row"><button class="btn green" data-a="back">К списку партий</button>${rematchBtn(s)}<button class="btn" data-a="hidesummary">Посмотреть карты всех</button></div>
  </div></div>`;
}

function renderBunker() {
  document.body.classList.add("ingame");
  const s = game, me = myIndex(), P = s.players[me], live = s.status === "play" && !s.paused;
  if (!(P && s.phase === "speech" && s.cur === me && !s.revealed)) ui.bk = null;
  const pops = [];
  if (s.status === "play" && me >= 0 && s.pauseVote) {
    const v = s.pauseVote, needN = Math.floor(s.players.filter((p) => !p.bot).length / 2) + 1, voted = v.yes.includes(me) || v.no.includes(me);
    pops.push(pop(`${esc(nameOf(s, v.by))} предлагает ${v.to ? "поставить паузу" : "продолжить игру"}`, `<p class="hint" style="margin:0">За: ${v.yes.length}, нужно ${needN}</p>${voted ? `<p class="muted" style="margin:0">Вы проголосовали, ждём остальных</p>` : `<div class="row"><button class="btn green" data-pause="1">За</button><button class="btn red" data-pause="0">Против</button></div>`}`));
  }
  if (ui.panel === "brules") pops.push(pop("Правила «Бункера»", bRulesHTML(), true));

  let hud;
  if (P) hud = bHandHTML(s, me);
  else {
    const mySeat = s.status === "play" ? s.players.findIndex((p) => p.bot && p.was === myId) : -1;
    hud = mySeat >= 0
      ? `<div class="panel spect"><span class="muted">За вас играет бот — вы смотрите партию.</span><button class="btn green small" data-a="reclaim">${ICON("play")}Вернуть управление</button></div>`
      : `<div class="panel spect muted">Вы смотрите эту партию как зритель.</div>`;
  }
  const speaking = s.phase === "speech" && s.cur >= 0, cur = speaking ? s.players[s.cur] : null;
  const head = s.status === "over" ? "Бункер закрыт" : speaking ? (s.cur === me ? "Ваша речь!" : `Говорит ${esc(nameOf(s, s.cur))}`) : s.phase === "talk" ? "Обсуждение" : s.phase === "revote" ? "Переголосование" : "Голосование";
  const timer = timerEnd != null && s.status === "play" ? `<span class="timer ${s.paused ? "paused" : ""}" id="timer" title="${s.phase === "speech" ? "Время речи — потом карта откроется сама" : s.phase === "talk" ? "Время обсуждения — потом голосование" : "Время на голос — кто не успел, воздерживается"}">${ICON("clock")}<b></b></span>` : "";
  const pauseBtn = me >= 0 && s.status === "play" && !s.pauseVote ? `<button class="btn ghost small" data-pause="1" title="${s.paused ? "Продолжить — снять паузу голосованием" : "Пауза — ставится голосованием игроков"}">${ICON(s.paused ? "play" : "pause")}<span class="tl">${s.paused ? "Продолжить" : "Пауза"}</span></button>` : "";
  const votedN = s.votes ? Object.keys(s.votes).length : 0, liveN = BU.alive(s).length;
  const order = s.status === "play" ? s.order || [] : [];
  // Своя карточка первой, выбывшие — в конце.
  const tiles = s.players.map((_, i) => i).sort((a, b) => s.players[a].out - s.players[b].out || (b === me) - (a === me)).map((i) => bPlayerTile(s, i, me)).join("");

  $("view").innerHTML = `<div class="game bgame">
    <div class="stage">
      <div class="panel turn ${speaking && s.cur === me && live ? "mine" : ""}" style="--pc:${cur ? cur.color : "var(--gold)"}">${cur ? ava(nameOf(s, s.cur), cur.color) : `<span class="ava" style="background:var(--gold);color:#3a2a06">${s.round || ""}</span>`}
        <div class="txt"><span class="who">${head}</span><span class="hint">${s.status === "play" ? esc(bHint(s, me)) : ""}${s.status === "play" && (s.phase === "vote" || s.phase === "revote") ? ` · голосов ${votedN}/${liveN}` : ""}</span></div>${timer}</div>
      <div class="topr"><span class="chip">Раунд <b>${s.round}</b></span><span class="chip">Код <span class="code">${esc(s.code)}</span></span>${s.status === "over" && ui.summaryHidden ? `<button class="btn green small" data-a="summary">${ICON("cards")}<span class="tl">Итоги</span></button>` : ""}<button class="btn ghost small" data-a="theme" title="${themeIcon().label}" aria-label="${themeIcon().label}">${themeIcon().html}</button><button class="btn ghost small ${ui.panel === "brules" ? "on" : ""}" data-panel="brules" title="Правила">${ICON("help")}<span class="tl">Правила</span></button>${pauseBtn}<button class="btn ghost small" data-a="back" title="К списку партий — ваше место остаётся за вами">${ICON("exit")}<span class="tl">Выйти</span></button>${me >= 0 && s.status === "play" ? `<button class="btn ghost small" data-a="abandon" title="Отдать место боту">${ICON("bot")}<span class="tl">Отдать боту</span></button>` : ""}${s.host === myId ? delBtn(s.code) : ""}</div>
      <div class="boardbox bbox">
        ${bScenarioHTML(s)}
        ${order.length && s.phase === "speech" ? `<div class="border">${order.map((i) => `<span class="${i === s.cur ? "now" : order.indexOf(i) < order.indexOf(s.cur) ? "done" : ""}" title="${esc(nameOf(s, i))}">${ava(nameOf(s, i), s.players[i].color, "sm")}</span>`).join("")}</div>` : ""}
        <div class="btiles">${tiles}</div>
      </div>
      ${s.paused ? `<div class="over paused"><div class="panel">${ICON("pause")}<span class="w">Пауза</span><span class="muted">Таймеры стоят. Снять паузу — голосованием игроков.</span></div></div>` : ""}
      ${speaking && s.cur === me && live && fxOn(fx.turn, 1800) ? `<div class="yourturn" ${fxDelay(fx.turn)}>Ваша речь!</div>` : ""}
      ${pops.length ? `<div class="pops">${pops.join("")}</div>` : ""}
      ${s.status === "over" && !ui.summaryHidden ? bSummaryHTML(s, me) : ""}
    </div>
    <div class="hud">${hud}</div>
    <aside class="side">
      ${chatHTML(s, me)}
      <div class="panel logp blogp"><div class="ph"><h3>Журнал</h3></div><div class="log" id="log">${s.log.map((t) => `<div>${bLog(s, t)}</div>`).join("")}</div></div>
    </aside></div>`;
  const lg = $("log");
  if (lg) lg.scrollTop = lg.scrollHeight;
  tickTimer();
  document.title = speaking && s.cur === me ? "Ваша речь — Бункер" : "Бункер — Жайлоо";
}

document.addEventListener("click", (ev) => {
  if (!game || game.game !== "bunker") return;
  const el = ev.target.closest("[data-bk],[data-ba],[data-bvote]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.bk) { ui.bk = ui.bk === d.bk ? null : d.bk; return render(); }
  if (d.bvote !== undefined) return act({ type: "vote", target: +d.bvote });
  if (d.ba === "reveal" && ui.bk) { const key = ui.bk; ui.bk = null; return act({ type: "reveal", key }); }
  if (d.ba === "done") return act({ type: "done" });
  if (d.ba === "ready") return act({ type: "ready" });
  if (d.ba === "abstain") { if (confirm("Воздержаться и не голосовать ни за кого?")) act({ type: "vote", target: null }); }
});
