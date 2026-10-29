// Правила «Бункера»: после катастрофы мест в бункере хватит только половине. У каждого — тайные карты персонажа,
// в каждом раунде игрок открывает одну и убеждает остальных, что он нужен, потом все голосуют, кого не пустить.
// Ведущего нет: раунды, речи и голосование ведёт сервер. Общий модуль для сервера (require) и браузера (глобальный BUNKER).
(function (root) {
"use strict";
const COLORS=["#d8402f","#2f6fd6","#2f9a4c","#e9b31c","#8e44ad","#e0609d","#1fb5c4","#e07b2b","#6b8e23","#8d6e63","#5c6bc0","#3b3b46"];
const BOT_NAMES=["Бот Айбек","Бот Нургуль","Бот Талант","Бот Жылдыз","Бот Бакыт","Бот Айпери","Бот Эрлан","Бот Чолпон","Бот Мирлан","Бот Асель","Бот Нурлан"];
const MIN_PLAYERS=4,MAX_PLAYERS=12;
// Время на речь (0 — без таймера: игрок сам завершает речь), на общее обсуждение и на голосование, в секундах.
const TURN_TIMES=[0,30,60,90];
const TALK_TIMES=[60,120,180];
const VOTE_TIME=45;
const TIMER={bonus:0};
const MODS={};
// Карты персонажа в том порядке, в каком они лежат перед игроком. В первом раунде все открывают профессию.
const TRAITS=[
  ["prof","Профессия"],["bio","Пол и возраст"],["health","Здоровье"],["hobby","Хобби"],
  ["phobia","Фобия"],["trait","Характер"],["bag","Багаж"],["fact","Факт"],
];
const TRAIT_RU=Object.fromEntries(TRAITS);
const DECKS={
  prof:["Врач-хирург","Инженер-электрик","Учитель","Повар","Фермер","Программист","Военный","Психолог","Сантехник","Химик",
    "Строитель","Пилот","Юрист","Блогер","Стоматолог","Ветеринар","Автомеханик","Биолог","Медсестра","Пожарный",
    "Охотник","Актёр","Музыкант","Бухгалтер","Полицейский","Таксист","Геолог","Агроном","Плотник","Парикмахер",
    "Фармацевт","Космонавт","Шахтёр","Чабан","Кузнец","Пасечник","Детский врач","Физик-ядерщик","Сварщик","Кондитер"],
  health:["Идеально здоров","Астма","Диабет","Аллергия на пыль","Сильная близорукость","Гипертония","Бесплодие","Хроническая мигрень",
    "Плоскостопие","Бессонница","Эпилепсия","Не слышит на одно ухо","Железный иммунитет","Анемия","Грыжа","Депрессия",
    "Протез ноги","Дальтонизм","Псориаз","Сколиоз","Здоров как бык","Ожирение","Больное сердце","Отличное зрение и слух"],
  hobby:["Шахматы","Рыбалка","Садоводство","Вязание","Стрельба из лука","Кулинария","Йога","Паркур","Игра на комузе","Готовит плов на сотню человек",
    "Охота с беркутом","Оригами","Бег","Фотография","Шитьё","Радиолюбитель","Выживание в дикой природе","Пение","Танцы","Резьба по дереву",
    "Видеоигры","Альпинизм","Пчеловодство","Чтение","Астрономия","Валяние войлока","Борьба","Конные скачки"],
  phobia:["Клаустрофобия","Боязнь темноты","Боязнь пауков","Боязнь крови","Боязнь высоты","Боязнь тишины","Боязнь микробов",
    "Боязнь одиночества","Боязнь толпы","Боязнь собак","Боязнь огня","Боязнь воды","Боязнь врачей","Нет фобий",
    "Боязнь змей","Боязнь насекомых","Боязнь громких звуков","Боязнь смерти","Боязнь детей","Боязнь стариков"],
  trait:["Прирождённый лидер","Трус","Добряк","Вспыльчивый","Хитрый","Честный до неприличия","Ленивый","Трудоголик","Паникёр","Оптимист",
    "Пессимист","Болтун","Молчун","Конфликтный","Заботливый","Эгоист","Шутник","Зануда","Мечтатель","Хладнокровный"],
  bag:["Аптечка","Мешок семян","Ружьё и 20 патронов","Палатка","Ящик консервов","Набор инструментов","Ноутбук без зарядки","Гитара","Рация",
    "Канистра бензина","Семейный альбом","Котёнок","Овчарка","Запас антибиотиков","Солнечная панель","Комуз","Удочка","Швейная машинка",
    "Книга «Как выжить»","Ящик водки","Войлочный ковёр","Фильтр для воды","Компас и карты","Мешок картошки","Пачка денег","Охотничий нож"],
  fact:["Сидел в тюрьме","Знает пять языков","Был на войне","Водит грузовик","Чемпион по борьбе","Знает первую помощь","Окончил школу выживания",
    "Громко храпит","Ворует еду по ночам","Читает по губам","Был дублёром космонавта","Снаружи остался его ребёнок","Лунатик",
    "Знает код от склада оружия","Бывший депутат","Умеет доить коров и кобыл","Делает кумыс","Не умеет плавать","Был хакером",
    "Может не спать двое суток","Заядлый игроман","Умеет принимать роды","Разбирается в ядах","Выжил в лавине"],
};
const CATS=[
  {name:"Ядерная зима",text:"Обмен ядерными ударами. Наверху −50 °C, радиация и пепел вместо неба.",years:3},
  {name:"Пандемия",text:"Неизвестный вирус выкосил большую часть людей. Снаружи — заражённые и пустые города.",years:1},
  {name:"Падение астероида",text:"Астероид упал в океан. Цунами, землетрясения и пыль, закрывшая солнце.",years:2},
  {name:"Извержение супервулкана",text:"Пепел накрыл полмира, урожая не будет несколько лет.",years:2},
  {name:"Восстание машин",text:"Искусственный интеллект решил, что люди лишние. Дроны охотятся за всеми, кто снаружи.",years:5},
  {name:"Всемирный потоп",text:"Ледники растаяли за месяц. Сухими остались только горы.",years:1},
  {name:"Нашествие пришельцев",text:"Корабли зависли над столицами. Пришельцы забирают людей.",years:4},
  {name:"Зомби-апокалипсис",text:"Мёртвые встают. Укус — и человек обращается за час.",years:3},
];
const FEATURES=["Огород и запас семян","Генератор с топливом на два года","Медпункт с операционным столом","Мастерская с инструментами","Библиотека",
  "Оружейная комната","Запас воды на пять лет","Радиостанция","Спортзал","Курятник на 10 кур","Фильтры воздуха","Детская комната",
  "Теплица","Лаборатория","Кладовая консервов на год","Скважина с чистой водой","Баня","Кошара на 5 овец"];
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const plural=(n,a,b,c)=>n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c;
function addLog(s,t){s.log.push(t);if(s.log.length>120)s.log.splice(0,s.log.length-120);}
const seatsFor=n=>Math.floor(n/2);
const alive=s=>s.players.map((p,i)=>i).filter(i=>!s.players[i].out);
// Пол и возраст собираются из кусочков, остальные карты тянутся из колод без повторов.
const bio=()=>{const age=18+Math.floor(Math.random()*63);return `${Math.random()<.5?"Мужчина":"Женщина"}, ${age} ${plural(age,"год","года","лет")}`;};
function deal(n){
  const decks={};for(const k in DECKS)decks[k]=shuffle([...DECKS[k]]);
  return Array.from({length:n},()=>{const c={bio:bio()};for(const k in DECKS)c[k]=decks[k].pop();return c;});
}

function newPlayer(id,bot,name){return {id,bot,name:name||"",color:"",cards:null,open:[],out:false};}
function newGame(code,hostId){return {code,game:"bunker",status:"lobby",host:hostId,createdAt:Date.now(),players:[newPlayer(hostId,false)],seq:0,log:[],turnTime:60,talk:120,mods:{}};}

// Порядок речей в раунде: живые по кругу, каждый раунд начинает следующий.
function startRound(s){
  const live=alive(s),k=(s.round-1)%live.length;
  s.order=live.slice(k).concat(live.slice(0,k));
  s.phase="speech";s.cur=s.order[0];s.revealed=false;s.turnNo++;
  addLog(s,s.round===1?"Раунд 1: все по очереди открывают профессию":`Раунд ${s.round}: каждый открывает одну карту и объясняет, зачем он нужен в бункере`);
}
function nextSpeaker(s){
  const k=s.order.indexOf(s.cur)+1;s.turnNo++;
  if(k<s.order.length){s.cur=s.order[k];s.revealed=false;return;}
  // В первом раунде не голосуют — только знакомятся.
  if(s.round===1){s.round++;return startRound(s);}
  s.phase="talk";s.ready=[];s.cur=-1;
  addLog(s,"Общее обсуждение: решите, кого не пускать");
}
function startVote(s,cands){
  s.phase=cands?"revote":"vote";s.votes={};s.cands=cands||alive(s);s.turnNo++;
  addLog(s,cands?`Ничья — переголосование между ${cands.map(i=>"@"+i).join(", ")}`:"Голосование: кого не пускаем в бункер?");
}
function reveal(s,pi,key){
  const P=s.players[pi];
  if(!P.open.includes(key))P.open.push(key);
}
function expel(s,pi,how){
  const P=s.players[pi];
  P.out=true;P.outRound=s.round;s.outs.push(pi);
  for(const [k] of TRAITS)reveal(s,pi,k);
  addLog(s,`@${pi} не попадает в бункер${how}`);
  if(alive(s).length<=s.seats){finish(s);return;}
  s.round++;startRound(s);
}
// Итог голосования: у кого больше голосов, тот выбывает. Ничья — переголосование между лидерами, вторая ничья — жребий.
function tally(s){
  const cnt={};for(const v in s.votes){const t=s.votes[v];if(t!=null)cnt[t]=(cnt[t]||0)+1;}
  const parts=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]).map(t=>`@${t} — ${cnt[t]} (${Object.keys(s.votes).filter(v=>s.votes[v]===+t).map(v=>"@"+v).join(", ")})`);
  addLog(s,parts.length?`Голоса: ${parts.join("; ")}`:"Никто не проголосовал");
  const max=Math.max(0,...Object.values(cnt));
  let top=s.cands.filter(i=>(cnt[i]||0)===max);
  if(top.length===1)return expel(s,top[0],` — ${max} ${plural(max,"голос","голоса","голосов")}`);
  if(s.phase==="vote")return startVote(s,top);
  expel(s,pick(top)," — по жребию после второй ничьей");
}
function finish(s){
  s.status="over";s.phase="over";s.cur=-1;s.endedAt=Date.now();
  for(const P of s.players)P.open=TRAITS.map(([k])=>k);
  const live=alive(s);
  s.winners=live;s.winner=live[0];
  addLog(s,`Двери бункера закрываются. Внутри: ${live.map(i=>"@"+i).join(", ")}`);
}

// Места: все, кто в бункере, — первые; выбывшие — тем выше, чем позже выбыли.
function results(s){
  const n=s.players.length,outs=s.outs||[];
  return s.players.map((p,i)=>{const k=outs.indexOf(i);
    return {i,vp:k<0?1:0,place:k<0?1:n-k,inside:k<0,outRound:p.outRound||null};}).sort((a,b)=>a.place-b.place);
}

// Что видит игрок: свои карты целиком, у остальных — только открытые. Голоса скрыты до подсчёта.
function view(s,viewerId){
  const v=structuredClone(s),me=v.players.findIndex(p=>p.id===viewerId||p.was===viewerId);
  if(v.status!=="play")return v;
  v.players.forEach((p,i)=>{
    if(p.cards&&i!==me){const c={};for(const k of p.open)c[k]=p.cards[k];p.cards=c;}
  });
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
    if(t==="setTalk"){need(TALK_TIMES.includes(a.seconds),"Неизвестное время обсуждения");s.talk=a.seconds;return s;}
    if(t==="kick"){const k=s.players[a.i];need(k&&k.id!==actor,"Нельзя");s.players.splice(a.i,1);return s;}
    if(t==="start"){
      need(s.players.length>=MIN_PLAYERS,`Нужно минимум ${MIN_PLAYERS} игрока`);
      const shift=Math.floor(Math.random()*s.players.length);
      s.players=s.players.slice(shift).concat(s.players.slice(0,shift));
      const cards=deal(s.players.length);
      s.players.forEach((p,i)=>Object.assign(p,{color:COLORS[i],cards:cards[i],open:[],out:false,outRound:null}));
      Object.assign(s,{status:"play",cat:pick(CATS),features:shuffle([...FEATURES]).slice(0,3),seats:seatsFor(s.players.length),
        round:1,turnNo:0,outs:[],votes:null,cands:null,ready:[],winners:null,winner:null,startedAt:Date.now()});
      s.log=[];
      addLog(s,`Катастрофа: ${s.cat.name}. Сидеть в бункере — ${s.cat.years} ${plural(s.cat.years,"год","года","лет")}. Мест — ${s.seats} из ${s.players.length}`);
      startRound(s);
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
  need(!P.out,"Вы не попали в бункер — теперь можно только смотреть и писать в чат");
  switch(t){
    case "reveal":{
      need(s.phase==="speech"&&pi===s.cur,"Сейчас говорит другой игрок");
      need(!s.revealed,"Карту в этом раунде вы уже открыли");
      need(TRAIT_RU[a.key],"Нет такой карты");need(!P.open.includes(a.key),"Эта карта уже открыта");
      need(s.round>1||a.key==="prof","В первом раунде все открывают профессию");
      reveal(s,pi,a.key);s.revealed=true;
      addLog(s,`@${pi} открывает «${TRAIT_RU[a.key]}»: ${P.cards[a.key]}`);
      return s;
    }
    case "done":{
      need(s.phase==="speech"&&pi===s.cur,"Сейчас говорит другой игрок");
      need(s.revealed,"Сначала откройте карту");
      nextSpeaker(s);return s;
    }
    case "ready":{
      need(s.phase==="talk","Сейчас не обсуждение");
      if(!s.ready.includes(pi))s.ready.push(pi);
      // Голосование начинается, когда готовы все живые люди; боты не задерживают.
      if(alive(s).every(i=>s.players[i].bot||s.ready.includes(i)))startVote(s);
      return s;
    }
    case "vote":{
      need(s.phase==="vote"||s.phase==="revote","Сейчас не голосуют");
      need(s.votes[pi]===undefined,"Вы уже проголосовали");
      need(a.target==null||(s.cands.includes(a.target)&&a.target!==pi),"За этого игрока голосовать нельзя");
      s.votes[pi]=a.target??null;
      if(alive(s).every(i=>s.votes[i]!==undefined))tally(s);
      return s;
    }
  }
  throw new Error("Неизвестное действие");
}

// --- боты и таймер ---
// Боты не спорят: открывают случайную карту, сразу заканчивают речь и голосуют, чаще всего — за того, против кого уже больше голосов.
function botPending(s){
  if(!s||s.status!=="play"||s.paused)return -1;
  if(s.phase==="speech")return s.players[s.cur].bot?s.cur:-1;
  if(s.phase==="vote"||s.phase==="revote"){for(const i of alive(s))if(s.players[i].bot&&s.votes[i]===undefined)return i;}
  return -1;
}
// Пауза перед ходом бота, чтобы люди успели прочитать, что произошло.
const botWait=s=>s.phase==="speech"?2500:1500;
function botVote(s,b){
  const c=s.cands.filter(i=>i!==b);if(!c.length)return null;
  const cnt={};for(const v in s.votes){const t=s.votes[v];if(t!=null)cnt[t]=(cnt[t]||0)+1;}
  const lead=c.filter(i=>cnt[i]).sort((x,y)=>cnt[y]-cnt[x])[0];
  return lead!=null&&Math.random()<.6?lead:pick(c);
}
function autoStep(s,i){
  const id=s.players[i].id;
  if(s.phase==="speech"){
    if(!s.revealed){const P=s.players[i],keys=s.round===1?["prof"]:TRAITS.map(([k])=>k).filter(k=>!P.open.includes(k));
      s=apply(s,id,{type:"reveal",key:pick(keys)});}
    return apply(s,id,{type:"done"});
  }
  return apply(s,id,{type:"vote",target:botVote(s,i)});
}
function botStep(s){const b=botPending(s);return b<0?null:autoStep(s,b);}
const turnKey=s=>[s.round,s.phase,s.turnNo,s.cur].join(":");
const phaseTime=s=>s.phase==="speech"?s.turnTime||0:s.phase==="talk"?s.talk||0:s.phase==="vote"||s.phase==="revote"?VOTE_TIME:0;
// Время вышло: за молчащего открывается случайная карта, обсуждение переходит в голосование, не проголосовавшие воздерживаются.
function timeoutStep(s){
  if(s.phase==="speech")return autoStep(s,s.cur);
  if(s.phase==="talk"){const t=structuredClone(s);startVote(t);return t;}
  if(s.phase==="vote"||s.phase==="revote"){const t=structuredClone(s);for(const i of alive(t))if(t.votes[i]===undefined)t.votes[i]=null;tally(t);return t;}
  return null;
}
// Чат: писать могут все, кто сидит за столом, — и выбывшие тоже. Зрители только читают.
const chatCheck=(s,pi)=>pi<0?"Писать в чат могут только игроки за столом":null;

const api={COLORS,MIN_PLAYERS,MAX_PLAYERS,TURN_TIMES,TALK_TIMES,VOTE_TIME,TIMER,MODS,TRAITS,TRAIT_RU,DECKS,CATS,FEATURES,
  seatsFor,alive,newPlayer,newGame,apply,view,results,botPending,botWait,botStep,turnKey,phaseTime,timeoutStep,chatCheck};
if(typeof module!=="undefined")module.exports=api;else root.BUNKER=api;
})(this);
