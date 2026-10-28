// Правила «Кочёвки»: квадратные тайлы, чабаны и сезоны. Общий модуль для сервера (require) и браузера (глобальный NOMAD).
(function (root) {
"use strict";
const COLORS=["#d8402f","#2f6fd6","#2f9a4c","#e9b31c","#30323b","#e0609d"];
const COLOR_RU=["красный","синий","зелёный","жёлтый","чёрный","розовый"];
const BOT_NAMES=["Бот Айбек","Бот Нургуль","Бот Талант","Бот Жылдыз","Бот Бакыт"];
const MAX_PLAYERS=6;
const LEVELS=["easy","medium","hard"];
const SUPPLY=7;
const TARGETS=[0,60,100,150];
const TURN_TIMES=[0,60,90,120];
const TIMER={bonus:0};
const MODS={
  river:{name:"Река Нарын",text:"Партия начинается с извилистой реки: она выкладывается сама, вдоль неё — аилы, мост и озеро."},
  berkut:{name:"Беркутчи",text:"У каждого есть большой чабан-беркутчи: в споре за объект он считается за двоих."},
  caravan:{name:"Караван",text:"В мешок добавляются тайлы с верблюдами: завершённая тропа с караваном приносит вдвое больше."},
  buran:{name:"Буран",text:"В мешке 3 карты бурана: вытянули — все чабаны с пастбищ уходят домой без очков."},
};
const KIND_RU={ail:"Аил",trail:"Тропа",kurgan:"Курган",pasture:"Пастбище",river:"Река"};
const DX=[0,1,0,-1],DY=[-1,0,1,0];
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pick=a=>a[Math.floor(Math.random()*a.length)];
const key=(x,y)=>x+","+y;

// Тайл: края по часовой с севера (A — аил, T — тропа, P — пастбище, R — река) и группы сторон,
// которые связаны одним аилом, тропой или рекой. Тропа из одной стороны упирается в центр тайла.
const T=(id,n,e,o={})=>({id,n,e,...o});
const TILES=[
  T("start",0,"ATPT",{ail:[[0]],trail:[[1,3]]}),
  T("kurgan",3,"PPPP",{kurgan:1}),
  T("kurganH",1,"PPPP",{kurgan:1,herd:[2]}),
  T("kurganT",2,"PPTP",{kurgan:1,trail:[[2]]}),
  T("ail4",1,"AAAA",{ail:[[0,1,2,3]],orn:1}),
  T("ail3",3,"AAPA",{ail:[[0,1,3]]}),
  T("ail3o",1,"AAPA",{ail:[[0,1,3]],orn:1}),
  T("ail3t",1,"AATA",{ail:[[0,1,3]],trail:[[2]]}),
  T("ail3to",2,"AATA",{ail:[[0,1,3]],trail:[[2]],orn:1}),
  T("ail2",3,"AAPP",{ail:[[0,1]],herd:[2]}),
  T("ail2o",2,"AAPP",{ail:[[0,1]],orn:1}),
  T("ail2t",3,"AATT",{ail:[[0,1]],trail:[[2,3]]}),
  T("ail2to",2,"AATT",{ail:[[0,1]],trail:[[2,3]],orn:1}),
  T("band",1,"APAP",{ail:[[0,2]]}),
  T("bando",2,"APAP",{ail:[[0,2]],orn:1}),
  T("capsOpp",3,"APAP",{ail:[[0],[2]]}),
  T("capsAdj",2,"AAPP",{ail:[[0],[1]]}),
  T("cap",3,"APPP",{ail:[[0]]}),
  T("capH",2,"APPP",{ail:[[0]],herd:[2]}),
  T("capT",4,"ATPT",{ail:[[0]],trail:[[1,3]]}),
  T("capR",3,"ATTP",{ail:[[0]],trail:[[1,2]]}),
  T("capL",3,"APTT",{ail:[[0]],trail:[[2,3]]}),
  T("capX",3,"ATTT",{ail:[[0]],trail:[[1],[2],[3]],well:1}),
  T("capD",2,"APTP",{ail:[[0]],trail:[[2]],well:1}),
  T("straight",7,"TPTP",{trail:[[0,2]]}),
  T("straightH",3,"TPTP",{trail:[[0,2]],herd:[1]}),
  T("curve",6,"PPTT",{trail:[[2,3]]}),
  T("curveH",3,"PPTT",{trail:[[2,3]],herd:[0]}),
  T("tee",4,"PTTT",{trail:[[1],[2],[3]],well:1}),
  T("cross",1,"TTTT",{trail:[[0],[1],[2],[3]],well:1}),
  T("dead",2,"PPTP",{trail:[[2]],well:1}),
  T("herd",3,"PPPP",{herd:[0,2]}),
  T("cvS",2,"TPTP",{trail:[[0,2]],caravan:1,mod:"caravan"}),
  T("cvC",2,"PPTT",{trail:[[2,3]],caravan:1,mod:"caravan"}),
  T("cvT",1,"ATPT",{ail:[[0]],trail:[[1,3]],caravan:1,mod:"caravan"}),
  T("buran",3,"",{storm:1,mod:"buran"}),
  T("rSrc",0,"PPRP",{river:[[2]],spring:1}),
  T("rS",0,"RPRP",{river:[[0,2]]}),
  T("rC",0,"PPRR",{river:[[2,3]]}),
  T("rB",0,"RTRT",{river:[[0,2]],trail:[[1,3]]}),
  T("rA",0,"ARRP",{ail:[[0]],river:[[1,2]]}),
  T("rLake",0,"RPPP",{river:[[0]],lake:1}),
];
const TID={};TILES.forEach((t,i)=>TID[t.id]=i);

// Края тайла делим на 12 мест: по три на сторону, по часовой. Середина стороны — тропа или река, края — пастбище.
const SLOT_F=[.22,.5,.78];
const NORM=[[0,1],[-1,0],[0,-1],[1,0]];
function slotPt(i,d=0){const s=Math.floor(i/3),q=SLOT_F[i%3];const p=[[q,0],[1,q],[1-q,1],[0,1-q]][s];return [p[0]+NORM[s][0]*d,p[1]+NORM[s][1]*d];}
const sideMid=s=>slotPt(s*3+1);

// Объекты тайла. Пастбища делятся линиями: аил отрезает куски между своими сторонами, тропа — между своими концами,
// несколько тупиковых троп сходятся в центре и режут поле звездой. Места по одну сторону всех линий — одно пастбище.
function build(def){
  const feats=[],slotFeat=Array(12).fill(-1),els=[],dead=[];
  const add=(f,slots)=>{f.slots=slots;f.i=feats.length;for(const x of slots)slotFeat[x]=f.i;feats.push(f);};
  (def.ail||[]).forEach((g,k)=>{
    const m=g.map(sideMid),ax=m.reduce((a,p)=>a+p[0],0)/m.length,ay=m.reduce((a,p)=>a+p[1],0)/m.length;
    const at=g.length===1?slotPt(g[0]*3+1,.2):[ax+(.5-ax)*.3,ay+(.5-ay)*.3];
    add({type:"ail",sides:g,orn:def.orn&&k===0?1:0,at},g.flatMap(s=>[s*3,s*3+1,s*3+2]));
    els.push(g.flatMap(s=>[(s*3+11.5)%12,s*3+2.5]));
  });
  let caravan=def.caravan?1:0;
  for(const type of ["trail","river"])(def[type]||[]).forEach(g=>{
    let at;
    if(g.length===1){at=slotPt(g[0]*3+1,.27);dead.push(g[0]*3+1);}
    else{const a=sideMid(g[0]),b=sideMid(g[1]);at=[.25*a[0]+.25+.25*b[0],.25*a[1]+.25+.25*b[1]];els.push(g.map(s=>s*3+1));}
    const f={type,sides:g,dead:g.length===1,at};
    if(type==="trail"){f.well=g.length===1&&def.well?1:0;f.caravan=caravan;caravan=0;}
    add(f,g.map(s=>s*3+1));
  });
  if(dead.length>=2)els.push(dead);
  if(def.kurgan)add({type:"kurgan",at:[.5,.47]},[]);
  const chords=[];
  for(const pts of els){const p=[...pts].sort((a,b)=>a-b);for(let i=0;i<p.length;i++)chords.push([p[i],p[(i+1)%p.length]].sort((a,b)=>a-b));}
  const regions=new Map();
  for(let i=0;i<12;i++){
    if(slotFeat[i]>=0)continue;
    const sig=chords.map(([a,b])=>i>a&&i<b?1:0).join("");
    if(!regions.has(sig))regions.set(sig,[]);
    regions.get(sig).push(i);
  }
  for(const slots of regions.values()){
    const herd=(def.herd||[]).filter(s=>slots.includes(s*3+1)).length;
    add({type:"pasture",herd,at:slotPt(slots[Math.floor(slots.length/2)],.15)},slots);
  }
  return {edges:def.e.split(""),feats,slotFeat};
}
const rotPt=([x,y],r)=>{for(let i=0;i<r;i++)[x,y]=[1-y,x];return [x,y];};
// INST[тайл][поворот]: края, объекты и места после поворота на r четвертей по часовой.
const INST=TILES.map(def=>{
  if(def.storm)return null;
  const b=build(def);
  return [0,1,2,3].map(r=>{
    const edges=[0,1,2,3].map(s=>b.edges[(s-r+4)%4]),slotFeat=Array(12).fill(-1);
    const feats=b.feats.map(f=>({...f,slots:f.slots.map(i=>(i+3*r)%12),at:rotPt(f.at,r)}));
    feats.forEach(f=>f.slots.forEach(i=>slotFeat[i]=f.i));
    return {edges,feats,slotFeat};
  });
});
const inst=T0=>INST[T0.t][T0.r];

function fits(tiles,x,y,I){
  if(tiles[key(x,y)])return false;
  let any=false;
  for(let s=0;s<4;s++){
    const N=tiles[key(x+DX[s],y+DY[s])];
    if(!N)continue;
    any=true;
    if(inst(N).edges[(s+2)%4]!==I.edges[s])return false;
  }
  return any;
}
function frontier(tiles){
  const out=new Map();
  for(const k in tiles){const [x,y]=k.split(",").map(Number);for(let s=0;s<4;s++){const nx=x+DX[s],ny=y+DY[s],nk=key(nx,ny);if(!tiles[nk])out.set(nk,[nx,ny]);}}
  return [...out.values()];
}
// Все места и повороты, куда ложится тайл. Повороты с одинаковыми краями не повторяем — они выглядят одинаково.
function placements(tiles,t){
  const out=[];
  for(const [x,y] of frontier(tiles)){
    const seen=new Set();
    for(let r=0;r<4;r++){const I=INST[t][r],e=I.edges.join("");if(seen.has(e))continue;if(fits(tiles,x,y,I)){seen.add(e);out.push({x,y,r});}}
  }
  return out;
}
const canPlace=(tiles,t)=>frontier(tiles).some(([x,y])=>[0,1,2,3].some(r=>fits(tiles,x,y,INST[t][r])));

// Связываем объекты соседних тайлов в общие: аил, тропу, пастбище. open — сколько мест объекта смотрит в пустоту.
function analyze(tiles){
  const id=new Map(),par=[],nodes=[];
  const find=a=>{while(par[a]!==a)a=par[a]=par[par[a]];return a;};
  for(const k in tiles){inst(tiles[k]).feats.forEach((f,i)=>{id.set(k+","+i,par.length);nodes.push({k,f});par.push(par.length);});}
  const open=new Array(par.length).fill(0);
  for(const k in tiles){
    const [x,y]=k.split(",").map(Number),I=inst(tiles[k]);
    for(let s=0;s<4;s++){
      const nk=key(x+DX[s],y+DY[s]),N=tiles[nk];
      for(let j=0;j<3;j++){
        const fa=I.slotFeat[s*3+j];
        if(fa<0)continue;
        const a=id.get(k+","+fa);
        if(!N){open[a]++;continue;}
        const fb=inst(N).slotFeat[((s+2)%4)*3+2-j];
        if(fb<0)continue;
        const ra=find(a),rb=find(id.get(nk+","+fb));
        if(ra!==rb)par[ra]=rb;
      }
    }
  }
  const groups=new Map();
  nodes.forEach((nd,n)=>{
    const r=find(n);
    let g=groups.get(r);
    if(!g)groups.set(r,g={root:r,type:nd.f.type,tiles:new Set(),orn:0,wells:0,caravan:0,herd:0,open:0,n:0});
    g.tiles.add(nd.k);g.open+=open[n];
    g.orn+=nd.f.orn||0;g.wells+=nd.f.well||0;g.caravan+=nd.f.caravan||0;g.herd+=nd.f.herd||0;
    if(nd.f.type==="kurgan"){const [x,y]=nd.k.split(",").map(Number);g.at=[x,y];g.n=[0,1,2,3].filter(s=>tiles[key(x+DX[s],y+DY[s])]).length;}
  });
  const rootOf=(x,y,f)=>find(id.get(key(x,y)+","+f));
  return {groups,rootOf,group:(x,y,f)=>groups.get(rootOf(x,y,f))};
}
const complete=g=>g.type==="kurgan"?g.n===4:(g.type==="ail"||g.type==="trail")&&g.open===0;
// Очки объекта: done — объект завершён (или пастбище в конце сезона), иначе — недостроенный в конце игры.
function value(g,done){
  switch(g.type){
    case "ail":return done?2*g.tiles.size+2*g.orn:g.tiles.size+g.orn;
    case "trail":return done?(g.tiles.size+2*g.wells)*(g.caravan?2:1):g.tiles.size;
    case "kurgan":return done?6:1+g.n;
    case "pasture":return Math.floor(g.tiles.size/4)+2*g.herd;
  }
  return 0;
}
// Кто стоит на каком объекте: корень объекта → номера чабанов.
function occupancy(A,chabans){
  const occ=new Map();
  chabans.forEach((c,i)=>{const r=A.rootOf(c.x,c.y,c.f);if(!occ.has(r))occ.set(r,[]);occ.get(r).push(i);});
  return occ;
}
// Делёж: у кого больше чабанов (беркутчи — за двоих), получает все очки; остальные участники — половину.
function shares(ids,chabans,pts){
  const cnt={};
  for(const i of ids){const c=chabans[i];cnt[c.p]=(cnt[c.p]||0)+(c.big?2:1);}
  const max=Math.max(...Object.values(cnt)),out={};
  for(const p in cnt){const v=cnt[p]===max?pts:Math.floor(pts/2);if(v>0)out[p]=v;}
  return out;
}
// Объекты, которые завершил тайл на (x, y): аилы и тропы на нём, курганы на нём и вокруг.
function completedBy(A,tiles,x,y){
  const roots=new Set(),T0=tiles[key(x,y)];
  inst(T0).feats.forEach((f,i)=>{if(f.type==="ail"||f.type==="trail"){const g=A.group(x,y,i);if(complete(g))roots.add(g.root);}});
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    const k=key(x+dx,y+dy),N=tiles[k];if(!N)continue;
    inst(N).feats.forEach((f,i)=>{if(f.type==="kurgan"){const g=A.group(x+dx,y+dy,i);if(complete(g))roots.add(g.root);}});
  }
  return [...roots].map(r=>A.groups.get(r));
}

const supplyLeft=(s,pi)=>SUPPLY-s.chabans.filter(c=>c.p===pi&&!c.big).length;
const berkutLeft=(s,pi)=>!!(s.mods&&s.mods.berkut)&&!s.chabans.some(c=>c.p===pi&&c.big);
const statsOf=()=>({ail:0,trail:0,kurgan:0,pasture:0});
function addLog(s,t){s.log.push(t);if(s.log.length>60)s.log.splice(0,s.log.length-60);}
const plural=(n,a,b,c)=>n%10===1&&n%100!==11?a:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?b:c;
const tilesRu=n=>`${n} ${plural(n,"тайл","тайла","тайлов")}`;
const describe=g=>{
  if(g.type==="ail")return tilesRu(g.tiles.size)+(g.orn?`, орнаментов: ${g.orn}`:"");
  if(g.type==="trail")return tilesRu(g.tiles.size)+(g.wells?`, колодцев: ${g.wells}`:"")+(g.caravan?", караван ×2":"");
  if(g.type==="pasture")return tilesRu(g.tiles.size)+(g.herd?`, отар: ${g.herd}`:"");
  return `соседей ${g.n} из 4`;
};

// Начисляем очки за объект и снимаем с него чабанов. Для анимации запоминаем, где всплыть цифрам.
function scoreGroup(s,g,ids,done,ev,why){
  const pts=value(g,done),got=shares(ids,s.chabans,pts),parts=[];
  for(const p in got){
    const P=s.players[p];P.score+=got[p];P.sc[g.type]+=got[p];
    const c=s.chabans[ids.find(i=>s.chabans[i].p===+p)],I=inst(s.tiles[key(c.x,c.y)]),at=I.feats[c.f].at;
    ev.push({p:+p,pts:got[p],x:c.x+at[0],y:c.y+at[1],kind:g.type,tiles:[...g.tiles]});
    parts.push(`@${p} +${got[p]}`);
  }
  if(parts.length)addLog(s,`${why||KIND_RU[g.type]} (${describe(g)}): ${parts.join(", ")}`);
  return ids;
}
function removeChabans(s,ids){const del=new Set(ids);s.chabans=s.chabans.filter((_,i)=>!del.has(i));}

// Ход: положить тайл, по желанию поставить или перегнать чабана, посчитать завершённые объекты.
// a: {x, y, r, f?: объект нового тайла, big?: беркутчи, move?: номер своего чабана с соседнего тайла}.
function placeTurn(s,pi,a){
  const need=(c,m)=>{if(!c)throw new Error(m);};
  const I=INST[s.tile]&&INST[s.tile][a.r];
  need(I&&Number.isInteger(a.x)&&Number.isInteger(a.y)&&fits(s.tiles,a.x,a.y,I),"Сюда этот тайл не ложится");
  let moved=null;
  if(a.move!=null){
    moved=s.chabans[a.move];
    need(moved&&moved.p===pi,"Это не ваш чабан");
    need(Math.abs(moved.x-a.x)+Math.abs(moved.y-a.y)===1,"Перекочевать можно только с соседнего тайла");
    need(a.f!=null,"Выберите, куда перекочует чабан");
  }
  s.tiles[key(a.x,a.y)]={t:s.tile,r:a.r};
  if(moved)s.chabans.splice(a.move,1);
  if(a.f!=null){
    const f=I.feats[a.f];
    need(f&&f.type!=="river","Сюда чабана не поставить");
    const A=analyze(s.tiles);
    need(!occupancy(A,s.chabans).has(A.rootOf(a.x,a.y,a.f)),"Здесь уже стоит чабан");
    const big=moved?moved.big:!!a.big;
    if(!moved)need(big?berkutLeft(s,pi):supplyLeft(s,pi)>0,big?"Беркутчи уже на поле":"Свободных чабанов нет");
    s.chabans.push({p:pi,x:a.x,y:a.y,f:a.f,big});
  }
  const A=analyze(s.tiles),occ=occupancy(A,s.chabans),ev=[],gone=[];
  for(const g of completedBy(A,s.tiles,a.x,a.y)){const ids=occ.get(g.root);if(ids)gone.push(...scoreGroup(s,g,ids,true,ev));}
  removeChabans(s,gone);
  return ev;
}
function seasonEnd(s,final,ev){
  const A=analyze(s.tiles),occ=occupancy(A,s.chabans),gone=[];
  for(const [r,ids] of occ){
    const g=A.groups.get(r);
    if(g.type==="pasture")gone.push(...scoreGroup(s,g,ids,true,ev));
    else if(final)gone.push(...scoreGroup(s,g,ids,false,ev,`${KIND_RU[g.type]}, недостроен`));
  }
  removeChabans(s,gone);
}
function storm(s){
  const A=analyze(s.tiles),n=s.chabans.length;
  s.chabans=s.chabans.filter(c=>A.group(c.x,c.y,c.f).type!=="pasture");
  addLog(s,`Буран! С пастбищ ушли домой чабаны: ${n-s.chabans.length}`);
  s.stormNo=(s.stormNo||0)+1;
}
// Тянем следующий тайл; тот, что никуда не ложится, уходит в сброс. false — мешок пуст.
function drawTile(s){
  while(s.deck.length){
    const t=s.deck.pop();
    if(TILES[t].storm){storm(s);continue;}
    if(!canPlace(s.tiles,t)){addLog(s,"Тайл не подошёл никуда и ушёл в сброс");continue;}
    s.tile=t;
    return true;
  }
  s.tile=null;
  return false;
}
function finish(s){
  s.status="over";s.endedAt=Date.now();s.tile=null;
  const best=Math.max(...s.players.map(p=>p.score));
  s.winner=s.players.findIndex(p=>p.score===best);
  addLog(s,`@${s.winner} побеждает с ${best} очками!`);
}

// Река: исток, 5–7 случайных изгибов, моста и аилов, в конце озеро. Собираем, пока цепочка не уложится без пересечений.
function layRiver(){
  const mid=["rS","rS","rC","rC","rC","rB","rA"].map(k=>TID[k]);
  for(let attempt=0;attempt<300;attempt++){
    const tiles={[key(0,0)]:{t:TID.rSrc,r:0}},len=5+Math.floor(Math.random()*3);
    let x=0,y=1,entry=0,ok=true;
    const put=t=>{
      for(const r of shuffle([0,1,2,3])){
        const I=INST[t][r];
        if(I.edges[entry]!=="R"||!fits(tiles,x,y,I))continue;
        tiles[key(x,y)]={t,r};
        const exit=[0,1,2,3].find(s=>s!==entry&&I.edges[s]==="R");
        if(exit!==undefined){x+=DX[exit];y+=DY[exit];entry=(exit+2)%4;}
        return true;
      }
      return false;
    };
    for(let i=0;i<len&&ok;i++)ok=shuffle([...mid]).some(put);
    if(ok&&put(TID.rLake))return tiles;
  }
  return {[key(0,0)]:{t:TID.start,r:0}};
}

function newPlayer(id,bot,name){return {id,bot,name:name||"",color:"",score:0,sc:statsOf()};}
function newGame(code,hostId){return {code,game:"nomad",status:"lobby",host:hostId,createdAt:Date.now(),players:[newPlayer(hostId,false)],seq:0,log:[],turnTime:90,target:100,mods:{}};}

function results(s){
  const rows=s.players.map((p,i)=>({i,vp:p.score,sc:p.sc||statsOf()}));
  const order=[...rows].sort((a,b)=>b.vp-a.vp||(b.i===s.winner)-(a.i===s.winner));
  order.forEach((r,k)=>r.place=k&&order[k-1].vp===r.vp?order[k-1].place:k+1);
  return order;
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
    if(t==="setTarget"){need(TARGETS.includes(a.target),"Неизвестная цель");s.target=a.target;return s;}
    if(t==="kick"){const k=s.players[a.i];need(k&&k.id!==actor,"Нельзя");s.players.splice(a.i,1);return s;}
    if(t==="start"){
      need(s.players.length>=2,"Нужно минимум 2 игрока");
      const deck=[];
      TILES.forEach((d,i)=>{if(d.n&&(!d.mod||s.mods[d.mod]))for(let k=0;k<d.n;k++)deck.push(i);});
      shuffle(deck);
      // Буран не приходит в первые ходы.
      for(let i=deck.length-1;i>=deck.length-6;i--)if(TILES[deck[i]].storm){const j=Math.floor(Math.random()*(deck.length-6));[deck[i],deck[j]]=[deck[j],deck[i]];}
      const shift=Math.floor(Math.random()*s.players.length);
      s.players=s.players.slice(shift).concat(s.players.slice(0,shift));
      s.players.forEach((p,i)=>{p.color=COLORS[i];p.score=0;p.sc=statsOf();});
      Object.assign(s,{status:"play",tiles:s.mods.river?layRiver():{[key(0,0)]:{t:TID.start,r:0}},chabans:[],deck,
        total:deck.length,autumnAt:Math.floor(deck.length/2),season:"summer",cur:0,turnNo:1,phase:"place",winner:null,
        last:null,fx:null,fxNo:0,startedAt:Date.now()});
      s.log=[];
      addLog(s,`Игра началась. Первым ходит @0${s.target?`, цель — ${s.target} очков`:""}`);
      drawTile(s);
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
  need(!s.paused,"Игра на паузе");
  need(pi===s.cur,"Сейчас не ваш ход");
  need(t==="turn"&&s.phase==="place"&&s.tile!=null,"Неизвестное действие");
  const ev=placeTurn(s,pi,a),seasonNo=s.season;
  s.last={x:a.x,y:a.y,p:pi};
  if(s.season==="summer"&&s.deck.length<=s.autumnAt){
    addLog(s,"Конец лета: пастбища приносят очки, чабаны с них возвращаются домой");
    seasonEnd(s,false,ev);
    s.season="autumn";
  }
  const reached=s.target&&s.players.some(p=>p.score>=s.target);
  if(!reached&&!drawTile(s)){addLog(s,"Тайлы закончились: считаем недостроенное и пастбища");seasonEnd(s,true,ev);}
  s.fxNo++;
  s.fx={n:s.fxNo,ev,season:seasonNo!==s.season};
  if(reached||s.tile==null)finish(s);
  else{s.cur=(s.cur+1)%s.players.length;s.turnNo++;}
  return s;
}

// --- предпросмотр хода: для подсказок на поле и для ботов ---
// Что даст тайл на (x, y, r): очки игрокам за завершённые объекты и описание каждого объекта нового тайла.
function preview(s,x,y,r){
  const tiles={...s.tiles,[key(x,y)]:{t:s.tile,r}},A=analyze(tiles),occ=occupancy(A,s.chabans),gains={};
  for(const g of completedBy(A,tiles,x,y)){const ids=occ.get(g.root);if(!ids)continue;const got=shares(ids,s.chabans,value(g,true));for(const p in got)gains[p]=(gains[p]||0)+got[p];}
  const feats=INST[s.tile][r].feats.map((f,i)=>{
    if(f.type==="river")return null;
    const g=A.group(x,y,i);
    return {i,type:f.type,at:f.at,free:!occ.has(g.root),complete:complete(g),full:value(g,true),end:value(g,false),text:describe(g)};
  });
  return {gains,feats};
}
// Сколько ещё может принести объект с чабаном: грубая оценка для ботов.
function potential(g,s){
  if(complete(g))return 0;
  switch(g.type){
    case "ail":return 1.5*g.tiles.size+2*g.orn+(g.open<=3?2:0)-.25*g.open;
    case "trail":return g.tiles.size+g.wells*1.5;
    case "kurgan":return 1+g.n*1.2;
    case "pasture":return (g.tiles.size/4+2*g.herd)*(s.season==="summer"?.9:.7);
  }
  return 0;
}
function evalMove(s,pi,m,L){
  const sim={tiles:{...s.tiles},chabans:s.chabans.map(c=>({...c})),players:s.players.map(p=>({score:p.score,sc:{...p.sc}})),mods:s.mods,tile:s.tile,log:[],season:s.season};
  try{placeTurn(sim,pi,m);}catch{return -Infinity;}
  const w=L==="hard"?.9:.5;
  let v=0;
  sim.players.forEach((p,i)=>{const d=p.score-s.players[i].score;v+=i===pi?d:-w*d;});
  const A=analyze(sim.tiles);
  for(const [r,ids] of occupancy(A,sim.chabans)){
    const g=A.groups.get(r),mine=ids.filter(i=>sim.chabans[i].p===pi).length,other=ids.length-mine;
    const pot=potential(g,s)*(L==="hard"?1:.8);
    v+=mine>=other?pot:-w*pot;
  }
  if(m.f!=null&&m.move==null)v-=supplyLeft(s,pi)<=2?3:L==="hard"?1.4:1;
  return v;
}
function botMove(s,pi,level){
  const L=level||s.players[pi].level||"medium";
  const opts=placements(s.tiles,s.tile),moves=[];
  for(const o of opts){
    moves.push({...o});
    const pv=preview(s,o.x,o.y,o.r);
    for(const f of pv.feats){
      if(!f||!f.free)continue;
      if(supplyLeft(s,pi)>0)moves.push({...o,f:f.i});
      if(berkutLeft(s,pi)&&L!=="easy")moves.push({...o,f:f.i,big:true});
    }
  }
  if(L==="easy"){const m=pick(moves.filter(m=>m.f!=null||Math.random()<.5));return m||moves[0];}
  let best=moves[0],bs=-Infinity;
  for(const m of moves){const v=evalMove(s,pi,m,L)+Math.random()*(L==="medium"?1.2:.2);if(v>bs){bs=v;best=m;}}
  return best;
}

function botPending(s){
  if(!s||s.status!=="play"||s.paused||s.phase!=="place")return -1;
  return s.players[s.cur].bot?s.cur:-1;
}
function botStep(s){
  const b=botPending(s);if(b<0)return null;
  const id=s.players[b].id;
  try{return apply(s,id,{type:"turn",...botMove(s,b)});}
  catch{const o=placements(s.tiles,s.tile)[0];return apply(s,id,{type:"turn",...o});}
}
const turnKey=s=>[s.turnNo,s.cur].join(":");
const phaseTime=s=>s.turnTime||0;
// Время вышло: ход за игрока делает средний бот.
function timeoutStep(s){return apply(s,s.players[s.cur].id,{type:"turn",...botMove(s,s.cur,"medium")});}

const api={COLORS,COLOR_RU,MAX_PLAYERS,LEVELS,SUPPLY,TARGETS,TURN_TIMES,TIMER,MODS,KIND_RU,TILES,INST,DX,DY,
  slotPt,fits,placements,analyze,complete,value,occupancy,preview,supplyLeft,berkutLeft,describe,
  newPlayer,newGame,apply,results,botPending,botStep,botMove,turnKey,phaseTime,timeoutStep};
if(typeof module!=="undefined")module.exports=api;else root.NOMAD=api;
})(this);
