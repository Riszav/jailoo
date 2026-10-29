// Правила «Мафии»: ночью мафия убивает, доктор лечит, шериф и дон проверяют; днём город по очереди говорит,
// выставляет подозреваемых и голосует, кого казнить. Ведущего нет: ночи, речи и голосование ведёт сервер.
// Общий модуль для сервера (require) и браузера (глобальный MAFIA).
(function (root) {
"use strict";
const COLORS=["#d8402f","#2f6fd6","#2f9a4c","#e9b31c","#8e44ad","#e0609d","#1fb5c4","#e07b2b","#6b8e23","#8d6e63","#5c6bc0","#3b3b46"];
const BOT_NAMES=["Бот Айбек","Бот Нургуль","Бот Талант","Бот Жылдыз","Бот Бакыт","Бот Айпери","Бот Эрлан","Бот Чолпон","Бот Мирлан","Бот Асель","Бот Нурлан"];
const MIN_PLAYERS=5,MAX_PLAYERS=12;
// Время на речь днём (0 — без таймера), на ночь и на голос — в секундах.
const TURN_TIMES=[0,30,60,90];
const NIGHT_TIME=45,VOTE_TIME=40;
const TIMER={bonus:0};
const MODS={
  don:{name:"Дон мафии",text:"Один из мафии — дон: каждую ночь он ищет шерифа. С 6 игроков."},
  reveal:{name:"Открывать роль убитого",text:"Когда игрока убивают ночью или казнят днём, все видят его роль."},
};
const ROLES={
  mafia:{name:"Мафия",team:"mafia",text:"Ночью вместе с другими мафиози выберите жертву в закрытом чате. Днём притворяйтесь мирным."},
  don:{name:"Дон",team:"mafia",text:"Глава мафии. Голосует за жертву вместе со всеми, а ещё каждую ночь проверяет одного игрока: не шериф ли он. При ничьей среди мафии решает его голос."},
  sheriff:{name:"Шериф",team:"town",text:"Каждую ночь проверяйте одного игрока — узнаете, мафия он или нет. Как этим поделиться, чтобы не убили, — решать вам."},
  doctor:{name:"Доктор",team:"town",text:"Каждую ночь лечите одного игрока: если мафия выбрала его, он выживет. Одного и того же — не две ночи подряд, себя — один раз за игру."},
  civ:{name:"Мирный житель",team:"town",text:"Особых умений нет. Слушайте, спорьте и голосуйте — город побеждает, когда мафии не осталось."},
};
const TEAM_RU={mafia:"Мафия",town:"Город"};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const plural=(n,a,b,c)=>n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c;
function addLog(s,t){s.log.push(t);if(s.log.length>150)s.log.splice(0,s.log.length-150);}
const mod=(s,k)=>!!(s.mods&&s.mods[k]);
const mafiaFor=n=>n<=5?1:n<=8?2:3;
const isMafia=p=>!!p&&(p.role==="mafia"||p.role==="don");
const alive=s=>s.players.map((p,i)=>i).filter(i=>!s.players[i].dead);
const aliveRole=(s,r)=>alive(s).find(i=>s.players[i].role===r)??-1;
const roleRu=r=>ROLES[r]?ROLES[r].name:"?";
function deal(s){
  const n=s.players.length,m=mafiaFor(n);
  const roles=[...Array(m).fill("mafia"),"sheriff","doctor"];
  if(mod(s,"don")&&m>=2)roles[0]="don";
  while(roles.length<n)roles.push("civ");
  return shuffle(roles);
}

function newPlayer(id,bot,name){return {id,bot,name:name||"",color:"",role:null,dead:false,checks:[],nominated:null};}
function newGame(code,hostId){return {code,game:"mafia",status:"lobby",host:hostId,createdAt:Date.now(),players:[newPlayer(hostId,false)],seq:0,log:[],turnTime:60,mods:{don:true,reveal:true}};}

function checkWin(s){
  const live=alive(s),maf=live.filter(i=>isMafia(s.players[i])).length;
  const team=!maf?"town":maf>=live.length-maf?"mafia":null;
  if(!team)return false;
  s.status="over";s.phase="over";s.cur=-1;s.endedAt=Date.now();s.winTeam=team;
  s.winners=s.players.map((p,i)=>i).filter(i=>ROLES[s.players[i].role].team===team);s.winner=s.winners[0];
  addLog(s,team==="town"?"Мафии больше нет — город победил!":"Мафии не меньше, чем мирных, — мафия захватила город!");
  addLog(s,`Роли: ${s.players.map((p,i)=>`@${i} — ${roleRu(p.role)}`).join(", ")}`);
  return true;
}
function kill(s,i,how){
  const P=s.players[i];P.dead=true;P.diedDay=s.day;P.how=how;s.deaths.push(i);
  return mod(s,"reveal")?` (${roleRu(P.role).toLowerCase()})`:"";
}

function startNight(s){
  s.phase="night";s.cur=-1;s.turnNo++;
  s.night={kill:{},heal:null,check:{}};
  addLog(s,`Ночь ${s.day}. Город засыпает, просыпается мафия`);
}
// Ночь кончается, когда все, у кого есть ночное действие, сходили (или вышло время).
function nightDone(s){
  const N=s.night;
  for(const i of alive(s)){
    const r=s.players[i].role;
    if(isMafia(s.players[i])&&N.kill[i]===undefined)return false;
    if(r==="doctor"&&N.heal==null)return false;
    if((r==="sheriff"||(r==="don"&&mod(s,"don")))&&N.check[i]===undefined)return false;
  }
  return true;
}
function resolveNight(s){
  const N=s.night,cnt={};
  for(const k in N.kill){const t=N.kill[k];if(t!=null)cnt[t]=(cnt[t]||0)+1;}
  const max=Math.max(0,...Object.values(cnt));
  let top=Object.keys(cnt).map(Number).filter(t=>cnt[t]===max),target=null;
  if(top.length===1)target=top[0];
  else if(top.length>1){const don=aliveRole(s,"don"),dv=don>=0?N.kill[don]:null;target=top.includes(dv)?dv:pick(top);}
  // Проверки шерифа и дона видят только они сами.
  for(const k in N.check){const t=N.check[k];if(t==null)continue;const C=s.players[k],T=s.players[t];
    C.checks.push(C.role==="don"?{t,day:s.day,sheriff:T.role==="sheriff"}:{t,day:s.day,mafia:isMafia(T)});}
  const doc=aliveRole(s,"doctor");
  if(doc>=0&&N.heal!=null){const D=s.players[doc];D.lastHeal=N.heal;D.lastHealDay=s.day;if(N.heal===doc)D.selfHeal=true;}
  let news;
  if(target==null){s.lastNight={day:s.day,killed:null,saved:false};news="Утро: этой ночью никто не погиб";}
  else if(target===N.heal){s.lastNight={day:s.day,killed:null,saved:true};news="Утро: мафия выходила на охоту, но доктор успел — никто не погиб";}
  else{const r=kill(s,target,"night");s.lastNight={day:s.day,killed:target,saved:false};news=`Утро: этой ночью убит @${target}${r}`;}
  s.night=null;
  addLog(s,news);
  if(checkWin(s))return;
  startDay(s);
}
function startDay(s){
  const live=alive(s),k=(s.day-1)%live.length;
  s.order=live.slice(k).concat(live.slice(0,k));
  s.phase="speech";s.cur=s.order[0];s.noms=[];s.turnNo++;
  for(const P of s.players)P.nominated=null;
  addLog(s,`День ${s.day}: каждый по очереди говорит и может выставить подозреваемого`);
}
function nextSpeaker(s){
  const k=s.order.indexOf(s.cur)+1;s.turnNo++;
  if(k<s.order.length){s.cur=s.order[k];return;}
  s.cur=-1;
  if(!s.noms.length){addLog(s,"Никого не выставили — голосования не будет");s.day++;return startNight(s);}
  startVote(s);
}
function startVote(s,cands){
  s.phase=cands?"revote":"vote";s.votes={};s.cands=cands||[...s.noms];s.turnNo++;
  addLog(s,cands?`Ничья — переголосование между ${cands.map(i=>"@"+i).join(", ")}`:`Голосование: кого казнить? Выставлены ${s.cands.map(i=>"@"+i).join(", ")}`);
}
// Ничья — переголосование, вторая ничья — никто не уходит.
function tally(s){
  const cnt={};for(const v in s.votes){const t=s.votes[v];if(t!=null)cnt[t]=(cnt[t]||0)+1;}
  const parts=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]).map(t=>`@${t} — ${cnt[t]} (${Object.keys(s.votes).filter(v=>s.votes[v]===+t).map(v=>"@"+v).join(", ")})`);
  addLog(s,parts.length?`Голоса: ${parts.join("; ")}`:"Никто не проголосовал");
  const max=Math.max(0,...Object.values(cnt)),top=s.cands.filter(i=>(cnt[i]||0)===max);
  s.votes=null;s.cands=null;
  if(max>0&&top.length===1){const r=kill(s,top[0],"vote");addLog(s,`Город казнит @${top[0]}${r}`);if(checkWin(s))return;}
  else if(max>0&&s.phase==="vote")return startVote(s,top);
  else addLog(s,"Город не договорился — сегодня никого не казнят");
  s.day++;startNight(s);
}

// Места: победившая команда делит первое место, проигравшая — второе.
function results(s){
  const win=s.winners||[];
  return s.players.map((p,i)=>({i,vp:win.includes(i)?1:0,place:win.includes(i)?1:2,role:p.role,dead:p.dead})).sort((a,b)=>a.place-b.place);
}

// Что видит игрок: свою роль, своих (если он мафия), роли убитых (если включено). Ночные ходы — только свои,
// мафия видит голоса мафии. Голоса днём скрыты до подсчёта.
function view(s,viewerId){
  const v=structuredClone(s);
  if(v.status!=="play")return v;
  const me=v.players.findIndex(p=>p.id===viewerId||p.was===viewerId),M=v.players[me],maf=isMafia(M);
  v.players.forEach((p,i)=>{
    const known=i===me||(maf&&isMafia(p))||(p.dead&&mod(s,"reveal"));
    if(!known)p.role=null;
    if(i!==me){p.checks=[];delete p.lastHeal;delete p.lastHealDay;delete p.selfHeal;}
  });
  if(v.night){
    const N=v.night,mine={kill:{},heal:null,check:{}};
    if(maf)mine.kill=N.kill;else if(N.kill[me]!==undefined)mine.kill[me]=N.kill[me];
    if(M&&M.role==="doctor")mine.heal=N.heal;
    if(N.check[me]!==undefined)mine.check[me]=N.check[me];
    // Сколько ночных ходов уже сделано — видно всем, чьи именно — нет.
    mine.done=Object.keys(N.kill).length+(N.heal!=null?1:0)+Object.keys(N.check).length;
    v.night=mine;
  }
  if(v.votes){const vs={};for(const k in v.votes)vs[k]=+k===me?v.votes[k]:true;v.votes=vs;}
  return v;
}

function apply(s0,actor,a){
  const s=structuredClone(s0);
  const pi=s.players.findIndex(p=>p.id===actor);
  const need=(c,m)=>{if(!c)throw new Error(m);};
  const t=a.type;
  if(s.status==="lobby"){
    if(t==="join"){need(pi<0,"Вы уже в игре");need(s.players.length<MAX_PLAYERS,"Мест нет");s.players.push(newPlayer(actor,false));return s;}
    if(t==="leave"){need(pi>=0,"Вы не в игре");s.players.splice(pi,1);
      if(s.host===actor){const h=s.players.find(p=>!p.bot);if(!h)return null;s.host=h.id;}return s;}
    need(s.host===actor,"Это может только создатель игры");
    if(t==="addBot"){need(s.players.length<MAX_PLAYERS,"Мест нет");const used=s.players.map(p=>p.name);
      s.players.push(newPlayer("bot-"+Math.random().toString(36).slice(2,8),true,BOT_NAMES.find(n=>!used.includes(n))||"Бот"));return s;}
    if(t==="setTimer"){need(TURN_TIMES.includes(a.seconds),"Неизвестный таймер");s.turnTime=a.seconds;return s;}
    if(t==="setMod"){need(MODS[a.mod],"Неизвестное дополнение");s.mods={...s.mods,[a.mod]:!!a.on};return s;}
    if(t==="kick"){const k=s.players[a.i];need(k&&k.id!==actor,"Нельзя");s.players.splice(a.i,1);return s;}
    if(t==="start"){
      need(s.players.length>=MIN_PLAYERS,`Нужно минимум ${MIN_PLAYERS} игроков`);
      const shift=Math.floor(Math.random()*s.players.length);
      s.players=s.players.slice(shift).concat(s.players.slice(0,shift));
      const roles=deal(s);
      s.players.forEach((p,i)=>Object.assign(p,{color:COLORS[i],role:roles[i],dead:false,checks:[],nominated:null}));
      Object.assign(s,{status:"play",day:1,turnNo:0,deaths:[],noms:[],votes:null,cands:null,night:null,lastNight:null,order:[],
        winTeam:null,winners:null,winner:null,startedAt:Date.now()});
      s.log=[];
      const m=mafiaFor(s.players.length);
      addLog(s,`В городе ${s.players.length} ${plural(s.players.length,"житель","жителя","жителей")}, среди них ${m} ${plural(m,"мафиози","мафиози","мафиози")}${roles.includes("don")?" (один из них — дон)":""}, шериф и доктор. Роли розданы втайне`);
      startNight(s);
      return s;
    }
    throw new Error("Игра ещё не началась");
  }
  need(s.status==="play","Игра окончена");
  if(t==="reclaim"){
    const bi=s.players.findIndex(p=>p.bot&&p.was===actor);need(pi<0&&bi>=0,"Нет места, которое можно вернуть");
    const B=s.players[bi];Object.assign(B,{bot:false,id:actor,name:""});delete B.was;
    addLog(s,`@${bi} возвращается в игру`);return s;
  }
  need(pi>=0,"Вы зритель");
  if(t==="pause"){
    const humans=s.players.filter(p=>!p.bot).length,needN=Math.floor(humans/2)+1;
    let v=s.pauseVote;
    if(!v){need(a.yes,"Голосования нет");v=s.pauseVote={to:!s.paused,by:pi,yes:[],no:[]};
      if(humans>1)addLog(s,`@${pi} предлагает ${v.to?"поставить паузу":"продолжить игру"}`);}
    need(!v.yes.includes(pi)&&!v.no.includes(pi),"Вы уже проголосовали");
    (a.yes?v.yes:v.no).push(pi);
    if(v.yes.length>=needN){s.paused=v.to;s.pauseVote=null;addLog(s,v.to?"Игра на паузе":"Игра продолжается");}
    else if(v.no.length>humans-needN){s.pauseVote=null;addLog(s,"Голосование за паузу не прошло");}
    return s;
  }
  if(t==="abandon"){
    const name=(s.names&&s.names[actor])||`Игрок ${pi+1}`;
    Object.assign(s.players[pi],{bot:true,name:`${name} (бот)`,id:"bot-"+Math.random().toString(36).slice(2,8),was:actor});
    if(s.pauseVote){s.pauseVote.yes=s.pauseVote.yes.filter(i=>i!==pi);s.pauseVote.no=s.pauseVote.no.filter(i=>i!==pi);}
    addLog(s,`${name} выходит из игры, за него доиграет бот @${pi}`);
    const human=s.players.find(p=>!p.bot);
    if(!human&&!s.players.some(p=>p.was))return null;
    if(human&&s.host===actor)s.host=human.id;
    return s;
  }
  need(!s.paused,"Игра на паузе");
  const P=s.players[pi];
  need(!P.dead,"Вы выбыли — теперь можно только смотреть и писать мёртвым");
  const target=a.target,T=s.players[target];
  const okTarget=x=>x!=null&&s.players[x]&&!s.players[x].dead;
  switch(t){
    case "kill":{
      need(s.phase==="night"&&isMafia(P),"Убивать может только мафия ночью");
      need(target==null||(okTarget(target)&&!isMafia(T)),"Выберите живого игрока не из мафии");
      s.night.kill[pi]=target??null;break;
    }
    case "heal":{
      need(s.phase==="night"&&P.role==="doctor","Лечить может только доктор ночью");
      need(okTarget(target),"Выберите живого игрока");
      need(!(P.lastHeal===target&&P.lastHealDay===s.day-1),"Одного и того же нельзя лечить две ночи подряд");
      need(!(target===pi&&P.selfHeal),"Себя можно лечить только один раз за игру");
      s.night.heal=target;break;
    }
    case "check":{
      need(s.phase==="night"&&(P.role==="sheriff"||(P.role==="don"&&mod(s,"don"))),"Проверять могут шериф и дон ночью");
      need(okTarget(target)&&target!==pi,"Выберите живого игрока");
      need(s.night.check[pi]===undefined,"Этой ночью вы уже проверили");
      need(!(P.role==="don"&&isMafia(T)),"Своих дон знает и так");
      s.night.check[pi]=target;break;
    }
    case "nominate":{
      need(s.phase==="speech"&&pi===s.cur,"Выставлять можно в свою речь");
      need(P.nominated==null,"Вы уже выставили игрока");
      need(okTarget(target)&&target!==pi,"Выберите живого игрока");
      need(!s.noms.includes(target),"Этот игрок уже выставлен");
      P.nominated=target;s.noms.push(target);addLog(s,`@${pi} выставляет @${target}`);return s;
    }
    case "done":{
      need(s.phase==="speech"&&pi===s.cur,"Сейчас говорит другой игрок");
      nextSpeaker(s);return s;
    }
    case "vote":{
      need(s.phase==="vote"||s.phase==="revote","Сейчас не голосуют");
      need(s.votes[pi]===undefined,"Вы уже проголосовали");
      need(target==null||(s.cands.includes(target)&&target!==pi),"За этого игрока голосовать нельзя");
      s.votes[pi]=target??null;
      if(alive(s).every(i=>s.votes[i]!==undefined))tally(s);
      return s;
    }
    default:throw new Error("Неизвестное действие");
  }
  if(nightDone(s))resolveNight(s);
  return s;
}

// --- боты ---
// Боты не говорят. Ночью мафия бьёт по тому, на кого уже показали свои, доктор лечит наугад, шериф проверяет непроверенных.
// Днём шериф выставляет и казнит найденную мафию, мафия голосует против мирных, остальные — за того, против кого больше голосов.
function botNight(s,i){
  const P=s.players[i],live=alive(s),N=s.night;
  if(isMafia(P)&&N.kill[i]===undefined){
    const mate=Object.values(N.kill).find(x=>x!=null);
    const sus=P.checks.filter(c=>c.sheriff).map(c=>c.t).find(x=>!s.players[x].dead);
    return {type:"kill",target:sus??mate??pick(live.filter(x=>!isMafia(s.players[x])))};
  }
  if(P.role==="don"&&mod(s,"don")&&N.check[i]===undefined){
    const seen=P.checks.map(c=>c.t),c=live.filter(x=>!isMafia(s.players[x])&&!seen.includes(x));
    return c.length?{type:"check",target:pick(c)}:{type:"check",target:pick(live.filter(x=>!isMafia(s.players[x])))};
  }
  if(P.role==="doctor"&&N.heal==null){
    const c=live.filter(x=>!(P.lastHeal===x&&P.lastHealDay===s.day-1)&&!(x===i&&P.selfHeal));
    return {type:"heal",target:Math.random()<.25&&c.includes(i)?i:pick(c)};
  }
  if(P.role==="sheriff"&&N.check[i]===undefined){
    const seen=P.checks.map(c=>c.t),c=live.filter(x=>x!==i&&!seen.includes(x));
    return {type:"check",target:pick(c.length?c:live.filter(x=>x!==i))};
  }
  return null;
}
const knownMafia=(s,i)=>s.players[i].role==="sheriff"?s.players[i].checks.filter(c=>c.mafia).map(c=>c.t).filter(x=>!s.players[x].dead):[];
function botPending(s){
  if(!s||s.status!=="play"||s.paused)return -1;
  if(s.phase==="night"){for(const i of alive(s))if(s.players[i].bot&&botNight(s,i))return i;return -1;}
  if(s.phase==="speech")return s.players[s.cur].bot?s.cur:-1;
  if(s.phase==="vote"||s.phase==="revote"){for(const i of alive(s))if(s.players[i].bot&&s.votes[i]===undefined)return i;}
  return -1;
}
const botWait=s=>s.phase==="speech"?2500:s.phase==="night"?2000:1500;
function botVote(s,b){
  const c=s.cands.filter(i=>i!==b);if(!c.length)return null;
  const P=s.players[b],km=knownMafia(s,b).filter(x=>c.includes(x));
  if(km.length)return km[0];
  if(isMafia(P)){const town=c.filter(x=>!isMafia(s.players[x]));if(town.length)return pick(town);return null;}
  const cnt={};for(const v in s.votes){const t=s.votes[v];if(t!=null&&t!==true)cnt[t]=(cnt[t]||0)+1;}
  const lead=c.filter(i=>cnt[i]).sort((x,y)=>cnt[y]-cnt[x])[0];
  return lead!=null&&Math.random()<.6?lead:pick(c);
}
function autoStep(s,i,silent){
  const id=s.players[i].id,P=s.players[i];
  if(s.phase==="night")return apply(s,id,botNight(s,i));
  if(s.phase==="speech"){
    if(!silent&&P.nominated==null){
      const free=alive(s).filter(x=>x!==i&&!s.noms.includes(x)),km=knownMafia(s,i).filter(x=>free.includes(x));
      const tgt=km[0]??(isMafia(P)?pick(free.filter(x=>!isMafia(s.players[x]))):Math.random()<.5?pick(free):null);
      if(tgt!=null)s=apply(s,id,{type:"nominate",target:tgt});
    }
    return apply(s,id,{type:"done"});
  }
  return apply(s,id,{type:"vote",target:botVote(s,i)});
}
function botStep(s){const b=botPending(s);return b<0?null:autoStep(s,b,false);}
const turnKey=s=>[s.day,s.phase,s.turnNo,s.cur].join(":");
const phaseTime=s=>s.phase==="speech"?s.turnTime||0:s.phase==="night"?NIGHT_TIME:s.phase==="vote"||s.phase==="revote"?VOTE_TIME:0;
// Время вышло: ночь кончается с теми ходами, что успели сделать (мафия без единого голоса никого не убивает),
// молчащий передаёт слово, не успевшие проголосовать воздерживаются.
function timeoutStep(s){
  if(s.phase==="night"){const t=structuredClone(s);resolveNight(t);return t;}
  if(s.phase==="speech")return autoStep(s,s.cur,true);
  if(s.phase==="vote"||s.phase==="revote"){const t=structuredClone(s);for(const i of alive(t))if(t.votes[i]===undefined)t.votes[i]=null;tally(t);return t;}
  return null;
}

// --- чат ---
// Общий: днём — живые, ночью город спит. Мафия: только мафиози, в любое время. Мёртвые: выбывшие, город их не слышит.
function chatChannels(s,pi){
  const P=s.players[pi];
  if(s.status!=="play"||!P)return [{id:"all",name:"Общий"}];
  if(P.dead)return [{id:"dead",name:"Мёртвые"}];
  return [{id:"all",name:"Общий"},...(isMafia(P)?[{id:"mafia",name:"Мафия"}]:[])];
}
function chatCheck(s,pi,ch){
  const P=s.players[pi];
  if(s.status==="play"&&ch==="all"&&s.phase==="night")return "Ночью город спит — пишите днём";
  if(s.status==="play"&&ch==="mafia"&&P.dead)return "Мёртвые мафиози только читают своих";
  return null;
}
function chatSees(s,pi,m){
  if(s.status!=="play"||!m.ch||m.ch==="all")return true;
  const P=s.players[pi];
  if(!P)return false;
  if(m.ch==="mafia")return isMafia(P);
  if(m.ch==="dead")return P.dead;
  return false;
}

const api={COLORS,MIN_PLAYERS,MAX_PLAYERS,TURN_TIMES,NIGHT_TIME,VOTE_TIME,TIMER,MODS,ROLES,TEAM_RU,
  mafiaFor,isMafia,alive,roleRu,newPlayer,newGame,apply,view,results,botPending,botWait,botStep,turnKey,phaseTime,timeoutStep,
  chatChannels,chatCheck,chatSees};
if(typeof module!=="undefined")module.exports=api;else root.MAFIA=api;
})(this);
