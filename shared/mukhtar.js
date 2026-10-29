// Правила «Мухтара»: волки уносят ягнят из аила к горным пещерам, пёс Мухтар гонится за ними,
// пойманные волки становятся тайганами и помогают ему. У развилки тропа расходится к нескольким пещерам,
// мест в них меньше, чем волков, и сколько в каждой — тайна. Общий модуль для сервера (require) и браузера (глобальный MUKHTAR).
(function (root) {
"use strict";
const COLORS=["#d8402f","#2f6fd6","#2f9a4c","#e9b31c","#8e44ad","#e0609d"];
const BOT_NAMES=["Бот Айбек","Бот Нургуль","Бот Талант","Бот Жылдыз","Бот Бакыт"];
const MAX_PLAYERS=6;
const LEVELS=["easy","medium","hard"];
const TURN_TIMES=[0,30,60,90];
const TIMER={bonus:0};
// Общая тропа — клетки 0…FORK, на FORK развилка. Дальше у каждой пещеры своя ветка FORK+1…LEN-1, пещера — на LEN.
// Мухтар стартует в аиле (0) и дальше развилки не бежит. Волки стартуют с форой.
const LEN=30,FORK=23;
const HEADS=[3,5,7];
// В большой стае лай громче — с пятого игрока каждый добавляет волкам клетку форы.
const headFor=s=>(s.head||5)+Math.max(0,s.players.length-4);
const HAND=3;
// Стартовая рука у всех одна: шаг, рысь и бег. Эти три карты не из колоды: сыграли — они уходят из игры.
const BASE=["step","trot","run"];
// Открытый ряд: после хода вместо карты из колоды можно взять одну из этих.
const ROW=3;
// Тайган загоняет волка назад на DOG_MAX клеток.
const DOG_MAX=1;
// Очки в конце: волку в полной пещере — CAVE + бонус за очередь прихода + LAMB за ягнёнка; в неполной — ничего.
// Тайгану — HUNT + 1 за каждого ягнёнка пойманного волка и FEAST за каждую незаполненную пещеру.
const CAVE=8,LAMB=3,HUNT=2,FEAST=4,ORDER=[3,2,1];
const CAVE_NAMES=["Орлиная","Медвежья","Волчья"];
// «Забегает в Орлиную пещеру»: название в винительном падеже.
const acc=name=>name.replace(/ая$/,"ую").replace(/ья$/,"ью");
const MODS={
  tireless:{name:"Неутомимый",text:"Мухтар в конце раунда бежит хотя бы на 1 клетку, даже если стая шла тихо."},
  flock:{name:"Большая отара",text:"На тропе три отары по 3 ягнёнка вместо двух по 2."},
};
// Карты стаи. move — шаги вперёд, noise — лай. Тайган играет любую карту как «Лай» или «Загнать».
const CARDS={
  step:{name:"Шаг",n:7,move:1,noise:0,text:"Вперёд на 1. Тихо."},
  trot:{name:"Рысь",n:8,move:2,noise:1,text:"Вперёд на 2. Лай 1."},
  run:{name:"Бег",n:7,move:3,noise:2,text:"Вперёд на 3. Лай 2."},
  dash:{name:"Рывок",n:3,move:5,noise:3,text:"Вперёд на 5. Лай 3."},
  howl:{name:"Вой",n:2,move:1,noise:2,all:1,text:"Вся стая на тропе — вперёд на 1, первыми идут передние. Лай 2."},
  trip:{name:"Подножка",n:4,move:1,noise:1,trip:2,text:"Другой волк — назад на 2, вы — вперёд на 1. Лай 1."},
  bite:{name:"Укус",n:3,move:0,noise:1,bite:1,text:"Отнимите ягнёнка у волка на вашей или соседней клетке. Лай 1."},
  scent:{name:"Наводка",n:2,move:0,noise:0,scent:2,text:"Мухтар сразу бежит вперёд на 2 и ловит, кого догонит. Тихо."},
  rock:{name:"Завал",n:2,move:0,noise:0,rock:1,text:"Обрушьте камни: в выбранной пещере на одно место меньше. Тихо."},
  hide:{name:"Затаиться",n:2,move:0,noise:0,hush:2,text:"Лай раунда −2."},
  bait:{name:"Приманка",n:1,move:0,noise:0,bait:4,text:"Бросьте ягнёнка: Мухтар — назад на 4."},
};
const DOG_MODES={
  bark:{name:"Лай",text:"Лай раунда +1 (не больше 4): в конце раунда Мухтар пробежит дальше"},
  drive:{name:"Загнать",text:"Волк до развилки — назад на 1. Окажется у Мухтара — пойман"},
};
const CELL_RU={bush:"Кусты",river:"Река",flock:"Отара"};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const plural=(n,a,b,c)=>n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c;
const cellsRu=n=>`${n} ${plural(n,"клетку","клетки","клеток")}`;
const placesRu=n=>`${n} ${plural(n,"место","места","мест")}`;
function addLog(s,t){s.log.push(t);if(s.log.length>80)s.log.splice(0,s.log.length-80);}

// Тропа до развилки: реки, кусты и отары в своих отрезках, не вплотную друг к другу.
function layPath(big){
  const path=Array(LEN+1).fill(""),flock={};
  const want=[["river",8,12],["river",16,20],["bush",5,8],["bush",12,15],["bush",19,22],["flock",6,11],["flock",13,18]];
  if(big)want.push(["flock",17,21]);
  for(const [type,a,b] of want){
    const free=[];
    for(let c=a;c<=b;c++)if(!path[c]&&!path[c-1]&&!path[c+1])free.push(c);
    const c=free.length?pick(free):a;
    path[c]=type;
    if(type==="flock")flock[c]=big?3:2;
  }
  return {path,flock};
}
// Пещеры: 1 на двоих, 2 на 3–4 игроков, 3 на 5–6. В каждой 1–3 места, вместе — от половины стаи до числа волков без одного.
// Обычно мест меньше, чем волков. Изредка (FRIENDLY) их ровно столько, сколько волков: стая может спастись вся,
// но об этом никто не знает, пока не пошепчется или не добежит.
const FRIENDLY=.08;
function layCaves(n){
  const k=n<=2?1:n<=4?2:3,friendly=Math.random()<FRIENDLY,lo=friendly?n:Math.ceil(n/2),hi=friendly?n:Math.max(lo,n-1);
  const names=k===3?CAVE_NAMES:k===2?[CAVE_NAMES[0],CAVE_NAMES[2]]:[CAVE_NAMES[2]];
  for(;;){
    const caps=names.map(()=>1+Math.floor(Math.random()*3)),t=caps.reduce((a,b)=>a+b,0);
    if(t>=lo&&t<=hi)return names.map((name,i)=>({name,cap:caps[i],n:0,open:false}));
  }
}
function newDeck(){const d=[];for(const k in CARDS)for(let i=0;i<CARDS[k].n;i++)d.push(k);return shuffle(d);}
// Верхняя карта колоды; кончилась — перемешиваем сброс.
function pull(s){
  if(!s.deck.length){if(!s.discard||!s.discard.length)return null;s.deck=shuffle(s.discard);s.discard=[];}
  return s.deck.pop();
}
function refillRow(s){if(!s.row)return;while(s.row.length<ROW){const k=pull(s);if(!k)break;s.row.push(k);}}
// Сыгранная карта: базовая уходит из игры, остальные — в сброс.
function toss(s,P,key){if(P.base&&P.base[key]>0)P.base[key]--;else s.discard.push(key);}
// Добор до HAND карт. take — номер карты открытого ряда, которую игрок берёт первой.
function draw(s,P,take){
  if(take!=null&&s.row&&s.row[take]&&P.hand.length<HAND){P.hand.push(s.row.splice(take,1)[0]);refillRow(s);}
  while(P.hand.length<HAND){
    if(!s.deck.length){if(!s.discard||!s.discard.length)return;s.deck=shuffle(s.discard);s.discard=[];}
    P.hand.push(s.deck.pop());
  }
}

const onPath=P=>P.role==="wolf";
const active=P=>P.role==="wolf"||P.role==="dog";
const full=C=>C.n>=C.cap;
const wolvesLeft=s=>s.players.some(onPath);
// Сколько Мухтар пробежит в конце раунда при текущем лае.
const runLen=s=>s.mods&&s.mods.tireless?Math.max(1,s.noise):s.noise;
// Сытый Мухтар: поймав волка, в конце раунда он бежит на FED клетки меньше. Сдать одного — передышка всем остальным.
const FED=2;
// Сколько Мухтар пробежит на деле — с поправкой на сытость.
const runReal=s=>s.fed?Math.max(0,runLen(s)-FED):runLen(s);
// Волк в кустах в безопасности от подножек, укусов и загона.
const hidden=(s,P)=>onPath(P)&&P.br==null&&s.path[P.pos]==="bush";
// Соседи по тропе: на одной ветке (или оба до развилки) не дальше клетки, либо один на развилке, другой — на первой клетке ветки.
const near=(P,Q)=>P.br===Q.br?Math.abs(P.pos-Q.pos)<=1:(P.br==null&&P.pos===FORK&&Q.pos===FORK+1)||(Q.br==null&&Q.pos===FORK&&P.pos===FORK+1);
// Куда волк свернёт на развилке: в свою цель, а если она полна — в первую неполную пещеру.
function pickCave(s,P){
  if(P.aim!=null&&s.caves[P.aim]&&!full(s.caves[P.aim]))return P.aim;
  return s.caves.findIndex(C=>!full(C));
}

function catchWolf(s,i,ev){
  const P=s.players[i],lambs=P.lambs;
  for(const D of s.players)if(D.role==="dog"){const pts=HUNT+lambs;D.score+=pts;D.sc.hunt+=pts;}
  ev.push({k:"catch",p:i,at:P.pos,br:P.br,lambs});
  addLog(s,`Мухтар поймал @${i}${lambs?` с ${lambs} ${plural(lambs,"ягнёнком","ягнятами","ягнятами")}`:""}! Теперь это тайган`);
  Object.assign(P,{role:"dog",pos:null,br:null,back:false,lambs:0,caughtAt:s.round});
  s.fed=true;
}
function enterCave(s,i,ev){
  const P=s.players[i],C=s.caves[P.br];
  C.n++;s.caveN++;
  Object.assign(P,{role:"cave",pos:LEN,cave:P.br,caveNo:s.caveN});
  ev.push({k:"cave",p:i,c:P.cave});
  if(!C.open){C.open=true;addLog(s,`@${i} первым забегает в ${acc(C.name)} пещеру и видит: в ней ${placesRu(C.cap)}`);}
  else addLog(s,`@${i} забегает в ${acc(C.name)} пещеру (${C.n} из ${C.cap})`);
  if(full(C))addLog(s,`${C.name} пещера полна!`);
}
// Волк идёт вперёд по клетке. На развилке сворачивает к своей пещере. Река останавливает.
// Если его пещера полна, «вперёд» значит назад к развилке, а там караулит Мухтар.
function moveWolf(s,i,k,ev){
  const P=s.players[i];
  if(!onPath(P)||k<=0)return;
  const from=P.pos,fromBr=P.br;
  const done=()=>ev.push({k:"move",p:i,from,to:P.pos,fromBr,br:P.br});
  for(let st=0;st<k;st++){
    if(P.br==null&&P.pos<FORK){P.pos++;if(s.path[P.pos]==="river")break;continue;}
    if(P.br==null){const b=pickCave(s,P);if(b<0)break;P.br=b;P.back=false;P.pos++;addLog(s,`@${i} сворачивает к пещере «${s.caves[b].name}»`);continue;}
    if(full(s.caves[P.br])){
      if(!P.back){P.back=true;addLog(s,`@${i} упирается в полную пещеру «${s.caves[P.br].name}» и бежит назад к развилке`);}
      P.pos--;
      if(P.pos===FORK){P.br=null;P.back=false;if(s.mx>=FORK){done();return catchWolf(s,i,ev);}}
      continue;
    }
    if(P.pos+1>=LEN){P.pos=LEN;done();return enterCave(s,i,ev);}
    P.pos++;
  }
  done();
  if(P.br==null&&s.path[P.pos]==="flock"&&s.flock[P.pos]>0){s.flock[P.pos]--;P.lambs++;ev.push({k:"lamb",p:i,at:P.pos});addLog(s,`@${i} утаскивает ягнёнка из отары`);}
}
// Назад: с ветки можно скатиться обратно к развилке. Оказался у Мухтара или позади — пойман.
function pushBack(s,i,k,ev){
  const P=s.players[i],from=P.pos,fromBr=P.br;
  P.pos=Math.max(0,P.pos-k);
  if(P.br!=null&&P.pos<=FORK){P.br=null;P.back=false;}
  ev.push({k:"move",p:i,from,to:P.pos,fromBr,br:P.br});
  if(P.pos<=s.mx)catchWolf(s,i,ev);
}
// Мухтар бежит по клетке и ловит всех волков на клетке, где остановился. Кусты прячут волка от одного забега:
// Мухтар замирает перед ними, а в следующий раз уже вынюхивает. Река останавливает и его. Дальше развилки он не бежит.
function runDog(s,k,ev){
  const from=s.mx;
  for(let st=0;st<k&&s.mx<FORK;st++){
    const c=s.mx+1,here=s.players.map((P,i)=>i).filter(i=>onPath(s.players[i])&&s.players[i].br==null&&s.players[i].pos===c);
    if(here.length&&s.path[c]==="bush"&&s.sniff!==c){s.sniff=c;addLog(s,"Мухтар чует волка в кустах и замирает рядом");break;}
    s.mx=c;
    if(here.length){here.forEach(i=>catchWolf(s,i,ev));break;}
    if(s.path[c]==="river")break;
  }
  if(s.mx!==from)ev.push({k:"dog",from,to:s.mx});
  if(s.mx===FORK&&from!==FORK)addLog(s,"Мухтар добежал до развилки и караулит её");
  // Чутьё держится, только пока Мухтар стоит прямо у кустов.
  if(s.sniff!=null&&s.sniff!==s.mx+1)s.sniff=null;
}

// Кого можно выбрать целью: волк на тропе не в кустах; для укуса — с ягнёнком и рядом.
// Тайган загоняет только до развилки: в узкую расщелину к пещере ему не протиснуться.
function canTarget(s,pi,j,C){
  const Q=s.players[j],P=s.players[pi];
  if(j===pi||!Q||!onPath(Q)||hidden(s,Q))return false;
  if(C&&C.bite)return Q.lambs>0&&near(P,Q);
  if(P.role==="dog")return Q.br==null;
  return true;
}
// Сыграть карту без перехода хода: для apply и для оценки ходов ботами.
function play(s,pi,a,ev){
  const need=(c,m)=>{if(!c)throw new Error(m);};
  const P=s.players[pi],ci=a.card,key=P.hand[ci],C=CARDS[key];
  need(Number.isInteger(ci)&&C,"Такой карты нет в руке");
  const tgt=a.target;
  need(a.take==null||(s.row&&s.row[a.take]),"В открытом ряду нет такой карты");
  if(P.role==="wolf"){
    // Цель можно сменить вместе с ходом, пока волк не свернул на ветку.
    if(a.aim!=null&&P.br==null){need(s.caves[a.aim],"Нет такой пещеры");P.aim=a.aim;}
    if(C.trip||C.bite){
      const any=s.players.some((_,j)=>canTarget(s,pi,j,C));
      need(tgt==null?!any:canTarget(s,pi,tgt,C),!any?"Цели для этой карты нет":C.bite?"Укусить можно волка с ягнёнком рядом с вами, не в кустах":"Выберите волка для подножки (не в кустах)");
    }
    if(C.rock)need(s.caves[a.cave]&&!full(s.caves[a.cave]),"Выберите пещеру, где ещё есть место");
    if(C.bait)need(P.lambs>0,"Для приманки нужен ягнёнок");
    P.hand.splice(ci,1);toss(s,P,key);
    P.played.push({k:key,r:s.round,t:tgt??null,c:C.rock?a.cave:null});
    const say=t=>addLog(s,`@${pi} — «${C.name}»${t?": "+t:""}`);
    if(C.all){
      const order=s.players.map((Q,j)=>j).filter(j=>onPath(s.players[j])).sort((x,y)=>s.players[y].pos-s.players[x].pos);
      say("стая вперёд на 1");order.forEach(j=>moveWolf(s,j,1,ev));
    }else if(C.trip){
      say(tgt!=null?`@${tgt} назад на ${C.trip}`:"подставить некого");
      if(tgt!=null)pushBack(s,tgt,C.trip,ev);
      moveWolf(s,pi,C.move,ev);
    }else if(C.bite){
      if(tgt!=null){s.players[tgt].lambs--;P.lambs++;ev.push({k:"bite",p:pi,t:tgt});say(`отнимает ягнёнка у @${tgt}`);}
      else say("кусать некого");
    }else if(C.rock){
      const R=s.caves[a.cave];R.cap--;ev.push({k:"rock",c:a.cave});
      // Кто шептался у этой пещеры, узнаёт и новую вместимость: шёпот — это знание, а не старая цифра.
      for(const Q of s.players)if(Q.whisper&&Q.whisper.c===a.cave){Q.whisper.cap=R.cap;Q.whisper.rocks=(Q.whisper.rocks||0)+1;}
      say(`камни завалили одно место в пещере «${R.name}»`);
      if(full(R)){R.open=true;addLog(s,R.n?`${R.name} пещера теперь полна (${placesRu(R.n)})`:`${R.name} пещера завалена наглухо`);}
    }
    else if(C.scent){say("наводит Мухтара на след");runDog(s,C.scent,ev);}
    else if(C.hush){s.noise=Math.max(0,s.noise-C.hush);say("лай стихает");}
    else if(C.bait){P.lambs--;const was=s.mx;s.mx=Math.max(0,s.mx-C.bait);s.sniff=null;ev.push({k:"dog",from:was,to:s.mx});say("Мухтар отвлёкся на ягнёнка");}
    else{say("");moveWolf(s,pi,C.move,ev);}
    s.noise=Math.max(s.noise,C.noise);
  }else{
    need(P.role==="dog","Вы уже в пещере");
    const m=a.mode;
    need(DOG_MODES[m],"Выберите, как сыграть карту тайганом");
    if(m==="drive")need(canTarget(s,pi,tgt),"Выберите волка на тропе (не в кустах)");
    P.hand.splice(ci,1);toss(s,P,key);
    P.played.push({k:key,r:s.round,m,t:m==="drive"?tgt:null});
    if(m==="bark"){s.noise=Math.min(4,s.noise+1);addLog(s,`Тайган @${pi} лает: лай раунда ${s.noise}`);}
    else{addLog(s,`Тайган @${pi} загоняет @${tgt} назад на ${cellsRu(DOG_MAX)}`);pushBack(s,tgt,DOG_MAX,ev);}
  }
  takeLog(s,pi,a.take);
  draw(s,P,a.take);
}
const takeLog=(s,pi,i)=>{if(i!=null&&s.row&&s.row[i]){s.noise=Math.min(4,s.noise+1);addLog(s,`@${pi} берёт из открытого ряда «${CARDS[s.row[i]].name}» — шорох: лай раунда ${s.noise}`);}};
// Сброс вместо хода: 1–2 карты в сброс, добор новых. Шум: лай раунда +1.
function swap(s,pi,a){
  const P=s.players[pi],idx=[...new Set(a.cards||[])].sort((x,y)=>y-x);
  if(P.role!=="wolf")throw new Error("Сбрасывать карты могут только волки на тропе");
  if(!idx.length||idx.length>2||idx.some(i=>!Number.isInteger(i)||!P.hand[i]))throw new Error("Выберите одну или две карты для сброса");
  if(a.take!=null&&!(s.row&&s.row[a.take]))throw new Error("В открытом ряду нет такой карты");
  for(const i of idx)toss(s,P,P.hand.splice(i,1)[0]);
  s.noise=Math.min(4,s.noise+1);
  P.played.push({x:"swap",n:idx.length,r:s.round});
  addLog(s,`@${pi} сбрасывает ${idx.length===1?"карту":"две карты"} и добирает новые — Мухтар слышит возню: лай раунда ${s.noise}`);
  takeLog(s,pi,a.take);
  draw(s,P,a.take);
}
// Обмен вслепую вместо хода: отдать свою карту другому волку на тропе и взять у него случайную.
function give(s,pi,a){
  const P=s.players[pi],Q=s.players[a.to],i=a.card;
  if(P.role!=="wolf")throw new Error("Меняться картами могут только волки на тропе");
  if(!Number.isInteger(i)||!P.hand[i])throw new Error("Выберите карту, которую отдаёте");
  if(!Q||a.to===pi||!onPath(Q))throw new Error("Меняться можно только с другим волком на тропе");
  if(!Q.hand.length)throw new Error("У этого волка нет карт");
  const key=P.hand.splice(i,1)[0],got=Q.hand.splice(Math.floor(Math.random()*Q.hand.length),1)[0];
  Q.hand.push(key);P.hand.push(got);
  moveBase(P,Q,key);moveBase(Q,P,got);
  P.played.push({x:"give",t:a.to,r:s.round});
  addLog(s,`@${pi} меняется картой с @${a.to} вслепую: отдаёт свою, забирает случайную`);
}
// Базовая карта, переданная другому, остаётся базовой.
function moveBase(A,B,key){
  if(!A.base)return;
  const left=A.hand.filter(k=>k===key).length;
  if((A.base[key]||0)>left){A.base[key]--;B.base=B.base||{};B.base[key]=(B.base[key]||0)+1;}
}
// Конец: все пещеры полны или на тропе не осталось волков.
const decided=s=>s.caves.every(full)?"full":!wolvesLeft(s)?"done":null;
function endRound(s,ev){
  const k=runReal(s),fed=s.fed&&runLen(s)>0,why=fed?` (сыт после добычи: −${FED})`:"";
  s.fed=false;
  if(k>0&&s.mx<FORK){addLog(s,`Конец раунда: лай ${s.noise}, Мухтар бежит на ${cellsRu(k)}${why}`);runDog(s,k,ev);}
  else if(k>0||fed&&s.mx>=FORK)addLog(s,`Конец раунда: лай ${s.noise}, Мухтар рычит у развилки`);
  else if(fed)addLog(s,`Конец раунда: лай ${s.noise}, но Мухтар сыт после добычи и не бежит`);
  else addLog(s,"Конец раунда: стая шла тихо, Мухтар не бежит");
  ev.push({k:"round"});
  s.noise=0;s.round++;
}
// Следующий ход. Волки в пещере пропускают ходы. Перешли через последнего за столом — конец раунда, Мухтар бежит.
function advance(s,ev){
  const n=s.players.length;
  let i=s.cur;
  for(let guard=0;guard<3*n+2;guard++){
    if(decided(s))return finish(s);
    i++;
    if(i>=n){i=0;endRound(s,ev);if(decided(s))return finish(s);}
    if(active(s.players[i])){s.cur=i;s.turnNo++;return;}
  }
  finish(s);
}
function finish(s){
  s.status="over";s.endedAt=Date.now();s.how=decided(s)||"done";
  for(const C of s.caves)C.open=true;
  for(const P of s.players)if(P.role==="cave"){
    const C=s.caves[P.cave];
    if(!full(C))continue;
    const bonus=ORDER[P.caveNo-1]||0;
    P.score+=CAVE+bonus+LAMB*P.lambs;P.sc.cave+=CAVE+bonus;P.sc.lambs+=LAMB*P.lambs;
  }
  const empty=s.caves.filter(C=>!full(C));
  for(const P of s.players)if(P.role==="dog"&&empty.length){P.score+=FEAST*empty.length;P.sc.hunt+=FEAST*empty.length;}
  addLog(s,s.caves.map(C=>`${C.name}: ${C.n} из ${C.cap}${!C.cap?" — завалена наглухо":full(C)?" — удержали":" — не заполнена"}`).join("; "));
  if(s.players.every(P=>P.role==="cave"&&full(s.caves[P.cave])))addLog(s,"Вся стая спаслась: мест хватило всем! Теперь всё решают очередь и ягнята");
  if(empty.length)addLog(s,`Незаполненных пещер: ${empty.length} — тайганы получают по ${FEAST*empty.length}`);
  const best=Math.max(...s.players.map(p=>p.score));
  s.winner=s.players.findIndex(p=>p.score===best);
  addLog(s,`Охота окончена. @${s.winner} побеждает с ${best} очками!`);
}

function newPlayer(id,bot,name){return {id,bot,name:name||"",color:"",role:"wolf",pos:0,br:null,aim:null,lambs:0,hand:[],played:[],whisper:null,score:0,sc:{cave:0,lambs:0,hunt:0}};}
function newGame(code,hostId){return {code,game:"mukhtar",status:"lobby",host:hostId,createdAt:Date.now(),players:[newPlayer(hostId,false)],seq:0,log:[],turnTime:60,head:5,mods:{}};}

function results(s){
  const rows=s.players.map((p,i)=>({i,vp:p.score,sc:p.sc,role:p.role,cave:p.cave,caveNo:p.caveNo||0}));
  const order=[...rows].sort((a,b)=>b.vp-a.vp||(b.i===s.winner)-(a.i===s.winner));
  order.forEach((r,k)=>r.place=k&&order[k-1].vp===r.vp?order[k-1].place:k+1);
  return order;
}

// Шёпот: раз за игру волк выбирает пещеру и тайно узнаёт, сколько в ней мест сейчас. Все видят, у какой пещеры он шептался.
function whisper(s,pi,c){
  const P=s.players[pi],C=s.caves[c];
  if(P.role!=="wolf")throw new Error("Шептаться могут только волки на тропе");
  if(P.whisper)throw new Error("Шёпот уже использован");
  if(!C)throw new Error("Нет такой пещеры");
  P.whisper={c,cap:C.cap,rocks:0};
  addLog(s,`@${pi} шепчется у пещеры «${C.name}»`);
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
      const b=newPlayer("bot-"+Math.random().toString(36).slice(2,8),true,BOT_NAMES.find(n=>!used.includes(n))||"Бот");
      b.level=LEVELS.includes(a.level)?a.level:"medium";s.players.push(b);return s;}
    if(t==="setBotLevel"){const b=s.players[a.i];need(b&&b.bot,"Это не бот");need(LEVELS.includes(a.level),"Неизвестная сложность");b.level=a.level;return s;}
    if(t==="setTimer"){need(TURN_TIMES.includes(a.seconds),"Неизвестный таймер");s.turnTime=a.seconds;return s;}
    if(t==="setMod"){need(MODS[a.mod],"Неизвестное дополнение");s.mods={...s.mods,[a.mod]:!!a.on};return s;}
    if(t==="setHead"){need(HEADS.includes(a.head),"Неизвестная фора");s.head=a.head;return s;}
    if(t==="kick"){const k=s.players[a.i];need(k&&k.id!==actor,"Нельзя");s.players.splice(a.i,1);return s;}
    if(t==="start"){
      need(s.players.length>=2,"Нужно минимум 2 игрока");
      const shift=Math.floor(Math.random()*s.players.length);
      s.players=s.players.slice(shift).concat(s.players.slice(0,shift));
      const {path,flock}=layPath(!!s.mods.flock),caves=layCaves(s.players.length);
      Object.assign(s,{status:"play",path,flock,caves,deck:newDeck(),discard:[],row:[],mx:0,sniff:null,fed:false,noise:0,round:1,caveN:0,
        cur:0,turnNo:1,winner:null,how:null,fx:null,fxNo:0,startedAt:Date.now()});
      s.players.forEach((p,i)=>{
        Object.assign(p,{color:COLORS[i],role:"wolf",pos:headFor(s),br:null,back:false,aim:null,lambs:1,hand:[],played:[],whisper:null,score:0,sc:{cave:0,lambs:0,hunt:0}});
        delete p.cave;delete p.caveNo;delete p.caughtAt;
        p.hand=[...BASE];p.base={};for(const k of BASE)p.base[k]=(p.base[k]||0)+1;
      });
      refillRow(s);
      s.log=[];
      addLog(s,`Волки утащили ягнят и бегут к ${s.caves.length>1?`${s.caves.length} пещерам`:"пещере"}! Мест почти наверняка не хватит на всех — сколько где, не знает никто. Мухтар отстаёт на ${cellsRu(headFor(s))}. Первым ходит @0`);
      return s;
    }
    throw new Error("Игра ещё не началась");
  }
  need(s.status==="play","Игра окончена");
  if(t==="reclaim"){
    const bi=s.players.findIndex(p=>p.bot&&p.was===actor);need(pi<0&&bi>=0,"Нет места, которое можно вернуть");
    const B=s.players[bi];Object.assign(B,{bot:false,id:actor,name:""});delete B.was;delete B.level;
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
    Object.assign(s.players[pi],{bot:true,level:"medium",name:`${name} (бот)`,id:"bot-"+Math.random().toString(36).slice(2,8),was:actor});
    if(s.pauseVote){s.pauseVote.yes=s.pauseVote.yes.filter(i=>i!==pi);s.pauseVote.no=s.pauseVote.no.filter(i=>i!==pi);}
    addLog(s,`${name} выходит из игры, место занимает бот @${pi}`);
    const human=s.players.find(p=>!p.bot);
    if(!human&&!s.players.some(p=>p.was))return null;
    if(human&&s.host===actor)s.host=human.id;
    return s;
  }
  // Цель и шёпот — не ход: их можно менять и в чужой ход.
  if(t==="aim"){
    const P=s.players[pi];
    need(P.role==="wolf"&&P.br==null,"Цель меняют до того, как свернули на ветку");
    need(a.cave==null||s.caves[a.cave],"Нет такой пещеры");
    P.aim=a.cave??null;return s;
  }
  if(t==="whisper"){whisper(s,pi,a.cave);return s;}
  need(!s.paused,"Игра на паузе");
  need(pi===s.cur,"Сейчас не ваш ход");
  need(t==="play"||t==="swap"||t==="give","Неизвестное действие");
  const ev=[],card=s.players[pi].hand[a.card];
  if(t==="swap")swap(s,pi,a);else if(t==="give")give(s,pi,a);else play(s,pi,a,ev);
  s.last={p:pi,card:t==="play"?card:null,act:t,mode:a.mode||null,target:a.target??a.to??null};
  advance(s,ev);
  s.fxNo++;
  s.fx={n:s.fxNo,ev};
  return s;
}

// --- анимация хода ---
// Маршрут фишки по клеткам: по тропе, через развилку на ветку, с ветки назад к развилке. Каждый пункт — [клетка, ветка].
function route(from,fb,to,tb){
  const pts=[[from,fb]];let p=from,b=fb;
  for(let g=0;(p!==to||b!==tb)&&g<80;g++){
    if(b!=null&&b!==tb){p--;if(p<=FORK){p=FORK;b=null;}}
    else if(b==null&&tb!=null&&p>=FORK){b=tb;p=FORK+1;}
    else if(b==null&&tb!=null)p++;
    else p+=to>p?1:-1;
    pts.push([p,b]);
  }
  return pts;
}
// Когда что происходит в анимации: волки идут вместе, Мухтар бежит после них. Поимка — когда Мухтар добежал
// (или когда волка отбросили к нему), вход в пещеру и ягнёнок из отары — в конце хода волка. Время в мс.
const STEP_MS=170;
function timeline(ev){
  const T=ev.map(()=>({at:0,dur:0}));let start=0,end=0,cat=null;
  ev.forEach((e,i)=>{
    const c=e.k==="move"?"m":e.k==="dog"?"d":null;if(!c)return;
    if(cat&&cat!==c)start=end;cat=c;
    const n=c==="d"?Math.abs(e.to-e.from):route(e.from,e.fromBr,e.to,e.br).length-1;
    T[i]={at:start,dur:Math.min(1600,200+n*STEP_MS)};end=Math.max(end,start+T[i].dur);
  });
  ev.forEach((e,i)=>{
    if(!["catch","cave","lamb"].includes(e.k))return;
    const prev=ev[i-1];let at;
    if(prev&&prev.k==="move"&&prev.p===e.p)at=T[i-1].at+T[i-1].dur;
    else{const j=ev.findIndex((x,k)=>k>i&&x.k==="dog");at=j>=0?T[j].at+T[j].dur:end;}
    T[i]={at,dur:e.k==="catch"?900:500};
  });
  let total=0;T.forEach((x,i)=>{const extra=ev[i].k==="bite"||ev[i].k==="rock"?1200:0;total=Math.max(total,x.at+x.dur+extra);});
  return {T,total};
}
const botWait=s=>s.fx&&s.fx.ev.length?Math.max(700,timeline(s.fx.ev).total+400):700;

// Предпросмотр хода для подсказок на поле. Вместимость закрытых пещер игроку не видна — считаем, что место есть.
function preview(s,pi,a){
  const sim=structuredClone({...s,deck:[],discard:[],log:[]});
  for(const C of sim.caves)if(C.cap==null)C.cap=C.full?C.n:LEN;
  const ev=[];
  try{play(sim,pi,a,ev);}catch(e){return {error:e.message};}
  return {sim,ev};
}

// --- боты ---
// Все допустимые ходы игрока: карта × режим тайгана × цель. Одинаковые карты не повторяем.
function moves(s,pi){
  const P=s.players[pi],out=[],seen=new Set();
  const all=s.players.map((_,j)=>j).filter(j=>canTarget(s,pi,j));
  P.hand.forEach((key,ci)=>{
    const C=CARDS[key];
    if(seen.has(key))return;
    seen.add(key);
    if(P.role==="wolf"){
      if(C.bait&&!P.lambs)return;
      if(C.rock){s.caves.forEach((R,c)=>{if(!full(R))out.push({card:ci,cave:c});});return;}
      const ts=C.trip||C.bite?all.filter(j=>canTarget(s,pi,j,C)):[];
      if(ts.length)ts.forEach(j=>out.push({card:ci,target:j}));
      else out.push({card:ci});
    }else{
      out.push({card:ci,mode:"bark"});
      all.forEach(j=>out.push({card:ci,mode:"drive",target:j}));
    }
  });
  return out;
}
// Сколько ещё ходов в этом раунде сделают тайганы и волки после игрока pi.
function restOfRound(s,pi){
  let dogs=0,wolves=0;
  for(let j=pi+1;j<s.players.length;j++){const Q=s.players[j];if(Q.role==="dog")dogs++;else if(onPath(Q))wolves++;}
  return {dogs,wolves};
}
// Что бот pi думает о вместимости пещеры: открытую и полную видят все, свой шёпот он помнит, иначе — в среднем 2.
function capEst(s,pi,c){
  const C=s.caves[c],w=s.players[pi].whisper;
  if(C.open||full(C))return C.cap;
  return w&&w.c===c?w.cap:2;
}
// Сколько мест, по мнению бота pi, останется волку j в пещере c: вместимость минус занятые и минус те, кто бежит туда впереди.
function freeFor(s,pi,j,c){
  const Q=s.players[j],C=s.caves[c];
  let ahead=0;
  s.players.forEach((P,k)=>{if(k!==j&&onPath(P)&&P.br===c&&P.pos>Q.pos)ahead++;});
  return capEst(s,pi,c)-C.n-ahead;
}
function bestAim(s,pi){
  let best=-1,bv=-Infinity;
  s.caves.forEach((C,c)=>{if(full(C))return;const v=freeFor(s,pi,pi,c)+Math.random()*.3;if(v>bv){bv=v;best=c;}});
  return best<0?null:best;
}
// Оценка волка глазами бота pi: в пещере — очки, если она наберётся; на тропе — с поправкой на риск и тесноту.
function wolfWorth(s,j,R,pi){
  const Q=s.players[j],prize=CAVE+1+LAMB*Q.lambs;
  if(Q.role==="cave")return full(s.caves[Q.cave])?prize:prize*.6;
  if(Q.role==="dog")return 3;
  let risk,room;
  if(Q.br!=null){
    const C=s.caves[Q.br];
    if(full(C)){risk=s.mx>=FORK-2?.8:.3;room=.5;}
    else{risk=.04;room=freeFor(s,pi,j,Q.br)>0?1:.35;}
  }else{
    const d=Q.pos-s.mx,bush=s.path[Q.pos]==="bush"&&s.sniff!==Q.pos;
    risk=d<=R?.85:d<=R+2?.35:d<=R+4?.12:.03;
    if(bush)risk*=.3;
    const free=Math.max(...s.caves.map((C,c)=>full(C)?-9:freeFor(s,pi,j,c)));
    room=free>0?1:free>-1?.6:.35;
  }
  return (1-risk)*(prize*room+Q.pos*.25)+risk*3;
}
function evalMove(s,pi,m,L){
  const sim=structuredClone({path:s.path,flock:s.flock,mx:s.mx,sniff:s.sniff,fed:s.fed,noise:s.noise,mods:s.mods,caveN:s.caveN,round:s.round,
    caves:s.caves,players:s.players.map(p=>({role:p.role,pos:p.pos,br:p.br,back:p.back,played:[],aim:p.aim,lambs:p.lambs,cave:p.cave,hand:[...p.hand],whisper:p.whisper,score:p.score,sc:{...p.sc}})),deck:[],discard:[],log:[]});
  // Бот не должен знать закрытую вместимость: в симуляции она — его догадка (но не меньше занятых мест + 1).
  sim.caves.forEach((C,c)=>{if(!C.open&&!full(s.caves[c]))C.cap=Math.max(C.n+1,capEst(s,pi,c));});
  // Чужие цели боту не видны: в симуляции чужой волк сворачивает туда, где, по мнению бота, свободнее.
  sim.players.forEach((P,j)=>{if(j!==pi)P.aim=null;});
  const ev=[];
  try{play(sim,pi,m,ev);}catch{return -Infinity;}
  const rest=restOfRound(s,pi),me=s.players[pi];
  // Ожидаемый забег в конце раунда: текущий лай, ещё не сходившие волки обычно добавляют шума, тайганы подгоняют.
  const R=Math.max(runReal(sim),rest.wolves?Math.min(3,sim.noise+1):0)+rest.dogs*1.3;
  if(me.role==="dog"){
    let v=3*(sim.players[pi].score-me.score);
    sim.players.forEach(Q=>{if(onPath(Q))v+=.5*Math.max(0,R+4-(Q.pos-sim.mx))-(Q.br==null&&sim.path[Q.pos]==="bush"?.5:0);});
    return v;
  }
  let v=wolfWorth(sim,pi,R,pi);
  // Предательство: чем хуже соперникам по тесным пещерам, тем лучше. Сложный бот ещё и помнит, что пойманный станет тайганом.
  const w=L==="hard"?.15:.05;
  sim.players.forEach((Q,j)=>{
    if(j===pi||!onPath(s.players[j]))return;
    v-=w*(wolfWorth(sim,j,R,pi)-wolfWorth(s,j,R,pi));
    if(L==="hard"&&Q.role==="dog")v-=1.5;
  });
  const d=me.pos-s.mx;
  if(CARDS[me.hand[m.card]].bait&&d>R+2)v-=4;
  return v;
}
// Ценность карты для добора из открытого ряда.
const WORTH={dash:5,run:4,howl:3,trip:3,trot:3,scent:2,rock:2,bite:2,hide:2,step:1,bait:1};
function botTake(s,pi){
  if(!s.row||!s.row.length)return null;
  let best=null,bv=2.5;
  s.row.forEach((k,i)=>{const v=WORTH[k]+Math.random()*.5;if(v>bv){bv=v;best=i;}});
  return best;
}
function botMove(s,pi,level){
  const L=level||s.players[pi].level||"medium",P=s.players[pi],opts=moves(s,pi);
  const aim=P.role==="wolf"&&P.br==null?bestAim(s,pi):null,withAim=m=>aim!=null?{...m,aim}:m;
  if(!opts.length)return withAim({card:0});
  if(L==="easy"&&Math.random()<.6)return withAim(pick(opts));
  const t=aim!=null?structuredClone(s):s;
  if(aim!=null)t.players[pi].aim=aim;
  let best=opts[0],bs=-Infinity;
  for(const m of opts){const v=evalMove(t,pi,m,L)+Math.random()*(L==="hard"?.15:.8);if(v>bs){bs=v;best=m;}}
  return withAim(best);
}
// Бот шепчется в свой первый ход у случайной закрытой пещеры.
function botWhisper(s,pi){
  const P=s.players[pi];
  if(P.role!=="wolf"||P.whisper)return null;
  const closed=s.caves.map((C,c)=>c).filter(c=>!s.caves[c].open&&!full(s.caves[c]));
  if(!closed.length)return null;
  return pick(closed);
}
function botPending(s){
  if(!s||s.status!=="play"||s.paused)return -1;
  return s.players[s.cur].bot?s.cur:-1;
}
function botStep(s){
  const b=botPending(s);if(b<0)return null;
  const id=s.players[b].id,c=botWhisper(s,b);
  if(c!=null)s=apply(s,id,{type:"whisper",cave:c});
  const take=botTake(s,b),P=s.players[b],L=P.level||"medium";
  // Ненужную «Приманку» (ягнят нет) бот подсовывает волку впереди, слабую руку — сбрасывает.
  if(P.role==="wolf"&&L!=="easy"&&Math.random()<.5){
    const bi=P.hand.indexOf("bait"),lead=s.players.map((Q,j)=>j).filter(j=>j!==b&&onPath(s.players[j])&&s.players[j].hand.length).sort((x,y)=>s.players[y].pos-s.players[x].pos)[0];
    if(bi>=0&&!P.lambs&&lead!=null)return apply(s,id,{type:"give",card:bi,to:lead});
    const w=P.hand.map((k,i)=>({i,v:WORTH[k]})).sort((x,y)=>x.v-y.v);
    if(w.reduce((a,x)=>a+x.v,0)<=4)return apply(s,id,{type:"swap",cards:[w[0].i,w[1].i],take});
  }
  try{return apply(s,id,{type:"play",...botMove(s,b),take});}
  catch{return apply(s,id,{type:"play",...moves(s,b)[0]});}
}
const turnKey=s=>[s.turnNo,s.cur].join(":");
const phaseTime=s=>s.turnTime||0;
// Время вышло: ход за игрока делает средний бот.
function timeoutStep(s){return apply(s,s.players[s.cur].id,{type:"play",...botMove(s,s.cur,"medium")});}

const api={COLORS,MAX_PLAYERS,LEVELS,TURN_TIMES,TIMER,MODS,CARDS,DOG_MODES,CELL_RU,LEN,FORK,HEADS,HAND,BASE,ROW,CAVE,LAMB,HUNT,FEAST,ORDER,CAVE_NAMES,
  headFor,onPath,hidden,full,runLen,runReal,FED,canTarget,moves,preview,route,timeline,botWait,newPlayer,newGame,apply,results,botPending,botStep,botMove,turnKey,phaseTime,timeoutStep};
if(typeof module!=="undefined")module.exports=api;else root.MUKHTAR=api;
})(this);
