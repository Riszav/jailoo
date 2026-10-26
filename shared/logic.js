// Правила «Жайлоо»: общий модуль для сервера (require) и браузера (обычный <script>).
const RES=["wood","brick","wool","grain","ore"];
const RES_RU={wood:"Лес",brick:"Глина",wool:"Шерсть",grain:"Зерно",ore:"Руда",desert:"Степь"};
const COST={road:{wood:1,brick:1},settle:{wood:1,brick:1,wool:1,grain:1},city:{grain:2,ore:3},dev:{wool:1,grain:1,ore:1}};
const DEV_RU={knight:"Батыр",vp:"Летопись",road:"Караван",yop:"Той",mono:"Ярмарка"};
const DEV_HINT={knight:"Перегоните буран и заберите карту соседа",vp:"+1 победное очко (скрыто до победы)",road:"Две тропы бесплатно",yop:"Два любых ресурса из запаса",mono:"Все соседи отдают вам ресурс одного вида"};
const COLORS=["#e0533d","#3d7be0","#1fb5c4","#e09a2b","#3faa4f","#8e5bd0","#e85fa3","#3b3b46"];
const BOT_NAMES=["Бот Айбек","Бот Нургуль","Бот Талант","Бот Жылдыз","Бот Бакыт","Бот Айпери","Бот Эрлан"];
const MAX_PLAYERS=8;
const LEVELS=["easy","medium","hard"];
const LEVEL_RU={easy:"лёгкий",medium:"средний",hard:"сложный"};
const emptyRes=()=>({wood:0,brick:0,wool:0,grain:0,ore:0});
const sum=r=>RES.reduce((a,k)=>a+(r[k]||0),0);
const has=(r,c)=>RES.every(k=>(r[k]||0)>=(c[k]||0));
const pips=n=>n?6-Math.abs(7-n):0;
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

// Поле — шестиугольник радиуса R: 2 (19 участков) до 4 игроков, 3 (37 участков) для 5–8.
function buildGeom(R){
  const S3=Math.sqrt(3),hexes=[];
  for(let q=-R;q<=R;q++)for(let r=Math.max(-R,-q-R);r<=Math.min(R,-q+R);r++)hexes.push({q,r});
  hexes.sort((a,b)=>a.r-b.r||a.q-b.q);
  const vmap=new Map(),verts=[],hexVerts=[];
  hexes.forEach((h,hi)=>{
    h.x=S3*(h.q+h.r/2);h.y=1.5*h.r;const vs=[];
    for(let i=0;i<6;i++){const a=Math.PI/180*(60*i-30),x=h.x+Math.cos(a),y=h.y+Math.sin(a);
      const k=Math.round(x*100)+","+Math.round(y*100);let id=vmap.get(k);
      if(id===undefined){id=verts.length;vmap.set(k,id);verts.push({x,y,hexes:[]});}
      verts[id].hexes.push(hi);vs.push(id);}
    hexVerts.push(vs);
  });
  const emap=new Map(),edges=[],vertEdges=verts.map(()=>[]),vertAdj=verts.map(()=>[]);
  hexVerts.forEach((vs,hi)=>{for(let i=0;i<6;i++){const a=Math.min(vs[i],vs[(i+1)%6]),b=Math.max(vs[i],vs[(i+1)%6]),k=a+"-"+b;
    let id=emap.get(k);if(id===undefined){id=edges.length;emap.set(k,id);edges.push({a,b,hexes:[]});vertEdges[a].push(id);vertEdges[b].push(id);vertAdj[a].push(b);vertAdj[b].push(a);}
    edges[id].hexes.push(hi);}});
  const hexAdj=hexes.map(h=>hexes.map((o,j)=>{const dq=o.q-h.q,dr=o.r-h.r;return(Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))===2?j:-1;}).filter(j=>j>=0));
  const coast=edges.map((e,i)=>i).filter(i=>edges[i].hexes.length===1).sort((i,j)=>{
    const m=k=>{const e=edges[k];return Math.atan2((verts[e.a].y+verts[e.b].y)/2,(verts[e.a].x+verts[e.b].x)/2);};return m(i)-m(j);});
  return {hexes,verts,hexVerts,edges,vertEdges,vertAdj,hexAdj,coast};
}
const GEOM={};
const geom=R=>GEOM[R]||(GEOM[R]=buildGeom(R));
const gOf=s=>geom((s&&s.size)||2);
const boardSize=n=>n>4?3:2;

const BOARD={
  2:{name:"Маленькая",maxPlayers:4,bank:19,deck:{knight:14,vp:5,prog:2},res:{wood:4,wool:4,grain:4,brick:3,ore:3,desert:1},nums:[2,12,...[3,4,5,6,8,9,10,11].flatMap(n=>[n,n])],harbors:["any","any","any","any","wood","brick","wool","grain","ore"]},
  3:{name:"Большая",maxPlayers:8,bank:30,deck:{knight:24,vp:7,prog:3},res:{wood:8,wool:7,grain:8,brick:6,ore:6,desert:2},nums:[2,12,12,...[3,4,5,6,8,9,10,11].flatMap(n=>[n,n,n,n])],harbors:["any","any","any","any","any","any","any","wood","brick","wool","grain","ore","grain"]},
  4:{name:"Огромная",maxPlayers:8,bank:40,deck:{knight:30,vp:9,prog:4},res:{wood:13,wool:12,grain:13,brick:10,ore:10,desert:3},nums:[2,2,12,12,...[3,4,5,9,10,11].flatMap(n=>Array(7).fill(n)),...[6,8].flatMap(n=>Array(6).fill(n))],harbors:[...Array(8).fill("any"),...["wood","brick","wool","grain","ore"].flatMap(r=>[r,r])]},
};
// Размер карты выбирает создатель в лобби: "auto" — по числу игроков, иначе радиус 2, 3 или 4.
const MAP_SIZES=["auto",2,3,4];
// Таймер хода в секундах, 0 — без таймера. Когда время выходит, сервер доигрывает ход за игрока.
// На бросок кубиков и сброс карт свои короткие таймеры, каждое действие в ход добавляет немного времени.
const TURN_TIMES=[0,60,90,120];
// Кубики бросаются сами через TIMER.roll секунд в любой комнате, даже без таймера хода.
const TIMER={roll:5,discard:20,bonus:10};
// Дополнения: создатель комнаты включает их в лобби, в партии они лежат в s.mods.
const MODS={
  fate:{name:"Колода судьбы",text:"Вместо кубиков — колода из 36 карт со всеми сочетаниями. Числа выпадают ровнее, удачи меньше. Когда остаётся 5 карт, колода тасуется заново."},
  friendly:{name:"Добрый буран",text:"Буран нельзя пригнать к юртам игрока, у которого 2 очка или меньше: новичков не грабят."},
  helpers:{name:"Помощники",text:"Каждый получает помощника с особым свойством. Со второго своего хода его можно раз за ход сменить на свободного."},
};
const mod=(s,k)=>!!(s&&s.mods&&s.mods[k]);
// Помощники: свойства постоянные, решений от игрока не требуют — поэтому с ними справляются и боты.
const HELPERS={
  chaban:{name:"Чабан",text:"На буране сбрасываете карты, только если их больше 9, а не 7."},
  kupets:{name:"Купец",text:"Любой ресурс меняете с запасом 3:1, даже без стоянки."},
  temirchi:{name:"Темирчи",text:"Аил стоит на 1 зерно меньше: 1 зерно и 3 руды."},
  usta:{name:"Уста",text:"Юрта строится без шерсти: лес, глина и зерно."},
  aksakal:{name:"Аксакал",text:"Карта развития стоит без шерсти: зерно и руда."},
  berkutchi:{name:"Беркутчи",text:"Буран вам не помеха: участок под бураном всё равно приносит вам ресурс."},
  jylkychy:{name:"Жылкычы",text:"Если ваш бросок (кроме 7) ничего вам не принёс, берёте 1 ресурс, которого у вас меньше всего."},
  karool:{name:"Кароол",text:"Бураном и «Батыром» у вас нельзя забрать карту."},
};
const hasHelper=(s,pi,h)=>mod(s,"helpers")&&!!s.players[pi]&&s.players[pi].helper===h;
// Цена постройки с учётом помощника.
function costOf(s,pi,k){
  if(k==="city"&&hasHelper(s,pi,"temirchi"))return {grain:1,ore:3};
  if(k==="settle"&&hasHelper(s,pi,"usta"))return {wood:1,brick:1,grain:1};
  if(k==="dev"&&hasHelper(s,pi,"aksakal"))return {grain:1,ore:1};
  return COST[k];
}
// Больше скольких карт на руке приходится сбрасывать на «7».
const discardLimit=(s,pi)=>hasHelper(s,pi,"chaban")?9:7;
const canRob=(s,o)=>!hasHelper(s,o,"karool");
const fateDeck=()=>shuffle([1,2,3,4,5,6].flatMap(a=>[1,2,3,4,5,6].map(b=>[a,b])));
const swapReady=(s,pi)=>{const P=s.players[pi];return mod(s,"helpers")&&!!P&&P.helperTurn+s.players.length<=s.turnNo;};
const mapRadius=s=>s.mapSize&&s.mapSize!=="auto"?s.mapSize:boardSize(s.players.length);
function makeBoard(R){
  const g=geom(R),cfg=BOARD[R];
  const res=shuffle(Object.entries(cfg.res).flatMap(([k,n])=>Array(n).fill(k)));
  let board;
  for(let t=0;t<2000;t++){
    const nums=shuffle([...cfg.nums]);let k=0;
    board=res.map(r=>({res:r,num:r==="desert"?0:nums[k++]}));
    const hot=i=>board[i].num===6||board[i].num===8;
    if(!board.some((b,i)=>hot(i)&&g.hexAdj[i].some(hot)))break;
  }
  const types=shuffle([...cfg.harbors]);
  const off=Math.floor(Math.random()*3),n=g.coast.length,m=types.length;
  const harbors=types.map((type,i)=>({e:g.coast[(Math.floor(i*n/m)+off)%n],type}));
  return {board,harbors,robber:board.findIndex(b=>b.res==="desert")};
}

// Статистика игрока для итогов партии: prod — ресурсы с кубиков, disc — сброшено на буране, steal/robbed — карт забрал/потерял
// (буран, батыр, «Ярмарка»), trades — обмены с игроками, bank — с запасом, bought/played — карты развития, sevens — выброшено «7».
const newStats=()=>({prod:emptyRes(),disc:0,steal:0,robbed:0,trades:0,bank:0,bought:0,played:0,sevens:0});
const stat=P=>P.st||(P.st=newStats());
function newPlayer(id,bot,name){return {id,bot,name:name||"",color:"",res:emptyRes(),dev:[],knights:0,road:0};}
function newGame(code,hostId){return {code,status:"lobby",host:hostId,createdAt:Date.now(),players:[newPlayer(hostId,false)],seq:0,log:[],turnTime:90};}

const ownerAt=(s,v)=>{const b=s.buildings[v];return b?b.p:-1;};
const countPieces=(s,pi)=>{let settle=0,city=0;for(const k in s.buildings){const b=s.buildings[k];if(b.p===pi)b.city?city++:settle++;}
  let road=0;for(const k in s.roads)if(s.roads[k]===pi)road++;return {settle,city,road};};
function canSettle(s,v,pi,setup){
  if(s.buildings[v])return false;
  if(gOf(s).vertAdj[v].some(u=>s.buildings[u]))return false;
  if(!setup&&!gOf(s).vertEdges[v].some(e=>s.roads[e]===pi))return false;
  return true;
}
function canRoad(s,e,pi){
  if(s.roads[e]!==undefined)return false;
  const ed=gOf(s).edges[e];
  if(s.phase==="setup")return ed.a===s.last||ed.b===s.last;
  for(const v of [ed.a,ed.b]){
    const o=ownerAt(s,v);
    if(o===pi)return true;
    if(o>=0)continue;
    if(gOf(s).vertEdges[v].some(x=>x!==e&&s.roads[x]===pi))return true;
  }
  return false;
}
const settleTargets=(s,pi,setup)=>gOf(s).verts.map((_,v)=>v).filter(v=>canSettle(s,v,pi,setup));
const roadTargets=(s,pi)=>gOf(s).edges.map((_,e)=>e).filter(e=>canRoad(s,e,pi));
const cityTargets=(s,pi)=>Object.keys(s.buildings).map(Number).filter(v=>s.buildings[v].p===pi&&!s.buildings[v].city);
function ratio(s,pi,r){
  let best=4;
  for(const h of s.harbors){const ed=gOf(s).edges[h.e];if(ownerAt(s,ed.a)===pi||ownerAt(s,ed.b)===pi){if(h.type==="any")best=Math.min(best,3);else if(h.type===r)best=2;}}
  if(hasHelper(s,pi,"kupets"))best=Math.min(best,3);
  return best;
}
function roadLen(s,pi){
  let best=0;
  const blocked=v=>{const o=ownerAt(s,v);return o>=0&&o!==pi;};
  const dfs=(v,used,len)=>{
    if(len>best)best=len;
    if(len>0&&blocked(v))return;
    for(const e of gOf(s).vertEdges[v]){
      if(s.roads[e]!==pi||used.has(e))continue;
      used.add(e);const ed=gOf(s).edges[e];dfs(ed.a===v?ed.b:ed.a,used,len+1);used.delete(e);
    }
  };
  for(const k in s.roads){if(s.roads[k]!==pi)continue;const ed=gOf(s).edges[+k];dfs(ed.a,new Set(),0);dfs(ed.b,new Set(),0);}
  return best;
}
function updateLongest(s){
  const lens=s.players.map((_,i)=>roadLen(s,i));
  s.players.forEach((p,i)=>p.road=lens[i]);
  const h=s.longest,max=Math.max(...lens);
  if(h!==null&&lens[h]>=5&&lens[h]===max)return;
  const prev=h;
  if(max<5)s.longest=null;
  else{const tops=lens.map((l,i)=>l===max?i:-1).filter(i=>i>=0);s.longest=tops.length===1?tops[0]:null;}
  if(s.longest!==prev&&s.longest!==null)addLog(s,`@${s.longest} получает «Великий путь» (${max} троп)`);
}
function vp(s,pi,hidden){
  let n=0;for(const k in s.buildings){const b=s.buildings[k];if(b.p===pi)n+=b.city?2:1;}
  if(s.longest===pi)n+=2;if(s.army===pi)n+=2;
  if(hidden)n+=s.players[pi].dev.filter(d=>d.t==="vp").length;
  return n;
}
function addLog(s,t){s.log.push(t);if(s.log.length>60)s.log.splice(0,s.log.length-60);}
const resText=r=>RES.filter(k=>r[k]).map(k=>`${r[k]} ${RES_RU[k].toLowerCase()}`).join(", ")||"ничего";
// В журнале ресурсы пишутся токенами «2%wood» — клиент рисует их иконками.
const resLog=r=>RES.filter(k=>r[k]).map(k=>`${r[k]}%${k}`).join(" ")||"ничего";
function harborLog(s,pi,v){
  for(const h of s.harbors){const ed=gOf(s).edges[h.e];
    if(ed.a===v||ed.b===v)addLog(s,`@${pi} занимает стоянку: ${h.type==="any"?"любой ресурс 3:1":`%${h.type} 2:1`}`);}
}
function pay(s,pi,c){const P=s.players[pi];for(const k of RES){P.res[k]-=(c[k]||0);s.bank[k]+=(c[k]||0);}}
function produce(s,roll){
  const gain=s.players.map(()=>emptyRes());
  s.board.forEach((h,hi)=>{if(h.num!==roll)return;
    for(const v of gOf(s).hexVerts[hi]){const b=s.buildings[v];if(b&&(hi!==s.robber||hasHelper(s,b.p,"berkutchi")))gain[b.p][h.res]+=b.city?2:1;}});
  for(const r of RES){
    const total=gain.reduce((a,g)=>a+g[r],0);if(!total)continue;
    if(total>s.bank[r]){
      const recv=gain.filter(g=>g[r]>0).length;
      if(recv>1){addLog(s,`В запасе мало %${r} — никто его не получает`);gain.forEach(g=>g[r]=0);continue;}
      gain.forEach(g=>{if(g[r])g[r]=s.bank[r];});
    }
    gain.forEach((g,i)=>{s.players[i].res[r]+=g[r];s.bank[r]-=g[r];stat(s.players[i]).prod[r]+=g[r];});
  }
  gain.forEach((g,i)=>{if(sum(g))addLog(s,`@${i} получает ${resLog(g)}`);});
  const P=s.players[s.cur];
  if(hasHelper(s,s.cur,"jylkychy")&&!sum(gain[s.cur])){
    const r=best(RES.filter(k=>s.bank[k]>0),k=>-P.res[k]-Math.random()*0.1);
    if(r){P.res[r]++;s.bank[r]--;stat(P).prod[r]++;addLog(s,`Жылкычы приводит @${s.cur} %${r}`);}
  }
}
// Куда можно перегнать буран: «Добрый буран» не пускает к игрокам с 2 очками и меньше, если есть другие участки.
function robberHexes(s,pi){
  const G=gOf(s),all=[...G.hexes.keys()].filter(i=>i!==s.robber);
  if(!mod(s,"friendly"))return all;
  const ok=all.filter(i=>!G.hexVerts[i].some(v=>{const o=ownerAt(s,v);return o>=0&&o!==pi&&vp(s,o)<=2;}));
  return ok.length?ok:all;
}
function checkWin(s){
  if(s.status!=="play")return;
  if(vp(s,s.cur,true)>=10){s.status="over";s.winner=s.cur;s.endedAt=Date.now();addLog(s,`@${s.cur} побеждает с ${vp(s,s.cur,true)} очками!`);}
}
// Итоги партии: места по очкам (с «Летописями»), разбивка очков и статистика каждого игрока.
function results(s){
  const rows=s.players.map((p,i)=>{const pc=countPieces(s,i),chron=p.dev.filter(d=>d.t==="vp").length;
    return {i,vp:vp(s,i,true),settle:pc.settle,city:pc.city,road:pc.road,longest:s.longest===i,army:s.army===i,chron,knights:p.knights,roadLen:p.road,st:stat(p)};});
  const order=[...rows].sort((a,b)=>(b.i===s.winner)-(a.i===s.winner)||b.vp-a.vp);
  order.forEach((r,k)=>r.place=k&&order[k-1].vp===r.vp&&r.i!==s.winner&&order[k-1].i!==s.winner?order[k-1].place:k+1);
  return order;
}
const canPlayDev=(s,pi,t)=>!s.devPlayed&&s.players[pi].dev.some(d=>d.t===t&&d.turn<s.turnNo);

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
    if(t==="addBot"){need(s.players.length<MAX_PLAYERS,"Мест нет");const used=s.players.map(p=>p.name);const name=BOT_NAMES.find(n=>!used.includes(n))||"Бот";
      const b=newPlayer("bot-"+Math.random().toString(36).slice(2,8),true,name);b.level=LEVELS.includes(a.level)?a.level:"medium";s.players.push(b);return s;}
    if(t==="setBotLevel"){const b=s.players[a.i];need(b&&b.bot,"Это не бот");need(LEVELS.includes(a.level),"Неизвестная сложность");b.level=a.level;return s;}
    if(t==="setTimer"){need(TURN_TIMES.includes(a.seconds),"Неизвестный таймер");s.turnTime=a.seconds;return s;}
    if(t==="setMod"){need(MODS[a.mod],"Неизвестное дополнение");s.mods={...s.mods,[a.mod]:!!a.on};return s;}
    if(t==="setMap"){need(MAP_SIZES.includes(a.size),"Неизвестный размер карты");s.mapSize=a.size;return s;}
    if(t==="kick"){const k=s.players[a.i];need(k&&k.id!==actor,"Нельзя");s.players.splice(a.i,1);return s;}
    if(t==="start"){
      need(s.players.length>=2,"Нужно минимум 2 игрока");
      const R=mapRadius(s),cfg=BOARD[R];
      need(s.players.length<=cfg.maxPlayers,`${cfg.name} карта — не больше ${cfg.maxPlayers} игроков`);
      const b=makeBoard(R),bank=cfg.bank,dk=cfg.deck;
      Object.assign(s,b,{size:R,status:"play",buildings:{},roads:{},bank:{wood:bank,brick:bank,wool:bank,grain:bank,ore:bank},
        deck:shuffle([...Array(dk.knight).fill("knight"),...Array(dk.vp).fill("vp"),...["road","yop","mono"].flatMap(c=>Array(dk.prog).fill(c))]),
        turnNo:1,devPlayed:false,trade:null,longest:null,army:null,dice:null,toDiscard:{},last:null,winner:null,turnTrades:0,
        rolls:Array(13).fill(0),startedAt:Date.now()});
      s.players.forEach(p=>p.st=newStats());
      if(mod(s,"fate"))s.fate=fateDeck();
      if(mod(s,"helpers")){const hs=shuffle(Object.keys(HELPERS));s.players.forEach(p=>{p.helper=hs.pop()||null;p.helperTurn=1;});s.helperPool=hs;}
      const shift=Math.floor(Math.random()*s.players.length);
      s.players=s.players.slice(shift).concat(s.players.slice(0,shift));
      s.players.forEach((p,i)=>p.color=COLORS[i]);
      const n=s.players.length;s.setupList=[...Array(n).keys(),...[...Array(n).keys()].reverse()];
      s.setupIdx=0;s.cur=s.setupList[0];s.phase="setup";s.step="settle";
      s.log=[];addLog(s,`Игра началась. Первым ходит @${s.cur}`);return s;
    }
    throw new Error("Игра ещё не началась");
  }
  need(s.status==="play","Игра окончена");
  if(t==="reclaim"){
    // Ушедший игрок забирает своё место у бота обратно — со всем, что бот успел накопить.
    const bi=s.players.findIndex(p=>p.bot&&p.was===actor);need(pi<0&&bi>=0,"Нет места, которое можно вернуть");
    const B=s.players[bi];Object.assign(B,{bot:false,id:actor,name:""});delete B.was;delete B.level;
    addLog(s,`@${bi} возвращается в игру`);return s;
  }
  need(pi>=0,"Вы зритель");
  if(t==="pause"){
    // Пауза ставится и снимается голосованием: нужно больше половины живых игроков.
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
    // Место со всеми картами и постройками занимает бот средней сложности; was — кто может забрать его обратно.
    const name=(s.names&&s.names[actor])||`Игрок ${pi+1}`;
    Object.assign(s.players[pi],{bot:true,level:"medium",name:`${name} (бот)`,id:"bot-"+Math.random().toString(36).slice(2,8),was:actor});
    if(s.pauseVote){s.pauseVote.yes=s.pauseVote.yes.filter(i=>i!==pi);s.pauseVote.no=s.pauseVote.no.filter(i=>i!==pi);}
    addLog(s,`${name} выходит из игры, место занимает бот @${pi}`);
    // Партию удаляем, только если в ней не осталось ни людей, ни ушедших, которые могут вернуться.
    const human=s.players.find(p=>!p.bot);
    if(!human&&!s.players.some(p=>p.was))return null;
    if(human&&s.host===actor)s.host=human.id;
    return s;
  }
  need(!s.paused,"Игра на паузе");
  const P=s.players[pi],isCur=pi===s.cur;

  if(t==="discard"){
    need(s.phase==="discard"&&s.toDiscard[pi],"Сбрасывать не нужно");
    need(sum(a.sel)===s.toDiscard[pi]&&has(P.res,a.sel)&&RES.every(k=>(a.sel[k]||0)>=0),`Выберите ровно ${s.toDiscard[pi]} карт`);
    pay(s,pi,a.sel);stat(P).disc+=sum(a.sel);delete s.toDiscard[pi];addLog(s,`@${pi} сбрасывает ${sum(a.sel)} карт`);
    if(!Object.keys(s.toDiscard).length)s.phase="robber";
    return s;
  }
  if(t==="respond"){
    need(s.trade&&!isCur,"Нет предложения");
    if(a.accept)need(has(P.res,s.trade.get),"Не хватает ресурсов для обмена");
    s.trade.resp[pi]=!!a.accept;return s;
  }
  need(isCur,"Сейчас не ваш ход");

  switch(t){
    case "settle":{
      const v=a.v;
      if(s.phase==="setup"){
        need(s.step==="settle"&&canSettle(s,v,pi,true),"Здесь нельзя ставить юрту");
        s.buildings[v]={p:pi,city:false};s.last=v;s.step="road";
        if(s.setupIdx>=s.players.length){const g=emptyRes();
          for(const hi of gOf(s).verts[v].hexes){const r=s.board[hi].res;if(r!=="desert"&&s.bank[r]>0){g[r]++;s.bank[r]--;P.res[r]++;stat(P).prod[r]++;}}
          addLog(s,`@${pi} ставит вторую юрту и получает ${resLog(g)}`);}
        else addLog(s,`@${pi} ставит юрту`);
        harborLog(s,pi,v);updateLongest(s);return s;
      }
      need(s.phase==="main","Сначала бросьте кубики");
      need(has(P.res,costOf(s,pi,"settle")),"Не хватает ресурсов");
      need(countPieces(s,pi).settle<5,"Юрт больше нет");
      need(canSettle(s,v,pi,false),"Здесь нельзя ставить юрту");
      pay(s,pi,costOf(s,pi,"settle"));s.buildings[v]={p:pi,city:false};addLog(s,`@${pi} ставит юрту`);harborLog(s,pi,v);updateLongest(s);break;
    }
    case "road":{
      const e=a.e;
      if(s.phase==="setup"){
        need(s.step==="road"&&canRoad(s,e,pi),"Тропа должна идти от новой юрты");
        s.roads[e]=pi;s.setupIdx++;updateLongest(s);
        if(s.setupIdx>=s.setupList.length){s.phase="roll";s.cur=s.setupList[0];s.step=null;s.last=null;addLog(s,`Расстановка окончена. Ходит @${s.cur}`);}
        else{s.cur=s.setupList[s.setupIdx];s.step="settle";}
        return s;
      }
      need(countPieces(s,pi).road<15,"Троп больше нет");
      need(canRoad(s,e,pi),"Тропа должна продолжать вашу сеть");
      if(s.phase==="roadbuilding"){s.roads[e]=pi;s.freeRoads--;addLog(s,`@${pi} прокладывает тропу каравана`);
        if(s.freeRoads<=0||countPieces(s,pi).road>=15)s.phase="main";updateLongest(s);break;}
      need(s.phase==="main","Сначала бросьте кубики");
      need(has(P.res,COST.road),"Не хватает ресурсов");
      pay(s,pi,COST.road);s.roads[e]=pi;addLog(s,`@${pi} прокладывает тропу`);updateLongest(s);break;
    }
    case "endRoads":need(s.phase==="roadbuilding","Нечего завершать");s.phase="main";break;
    case "city":{
      need(s.phase==="main","Сначала бросьте кубики");
      need(has(P.res,costOf(s,pi,"city")),"Не хватает ресурсов");
      need(countPieces(s,pi).city<4,"Аилов больше нет");
      const b=s.buildings[a.v];need(b&&b.p===pi&&!b.city,"Аил строится на месте своей юрты");
      pay(s,pi,costOf(s,pi,"city"));b.city=true;addLog(s,`@${pi} строит аил`);break;
    }
    case "roll":{
      need(s.phase==="roll","Кубики уже брошены");
      let d;
      if(mod(s,"fate")){
        if(!s.fate||s.fate.length<=5){if(s.fate)addLog(s,"Колода судьбы перетасована");s.fate=fateDeck();}
        d=s.fate.pop();
      }else d=[1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6)];
      const n=d[0]+d[1];
      s.dice=d;addLog(s,`@${pi} ${mod(s,"fate")?"тянет карту":"бросает"} #d${d[0]}-${d[1]}`);
      if(s.rolls)s.rolls[n]++;if(n===7)stat(P).sevens++;
      if(n===7){
        s.toDiscard={};s.players.forEach((p,i)=>{const c=sum(p.res);if(c>discardLimit(s,i))s.toDiscard[i]=Math.floor(c/2);});
        s.robberReturn="main";s.phase=Object.keys(s.toDiscard).length?"discard":"robber";
        addLog(s,"Буран! Игроки с 8+ картами сбрасывают половину");
      }else{produce(s,n);s.phase="main";}
      break;
    }
    case "robber":{
      need(s.phase==="robber","Сейчас не время для бурана");
      need(a.hex>=0&&a.hex<gOf(s).hexes.length&&a.hex!==s.robber,"Буран нужно перегнать на другой участок");
      need(robberHexes(s,pi).includes(a.hex),"Добрый буран: сюда нельзя — у этого игрока 2 очка или меньше");
      s.robber=a.hex;
      const victims=[...new Set(gOf(s).hexVerts[a.hex].map(v=>ownerAt(s,v)).filter(o=>o>=0&&o!==pi&&sum(s.players[o].res)>0&&canRob(s,o)))];
      let msg=`@${pi} перегоняет буран`;
      if(victims.length){
        const vi=victims.length===1?victims[0]:a.victim;need(victims.includes(vi),"Выберите, у кого забрать карту");
        const V=s.players[vi],pool=RES.flatMap(k=>Array(V.res[k]).fill(k)),r=pool[Math.floor(Math.random()*pool.length)];
        V.res[r]--;P.res[r]++;stat(P).steal++;stat(V).robbed++;
        // Что украдено, знают только вор и жертва: сервер вырезает ресурс из steals для остальных.
        const id=(s.stealNo||0)+1;s.stealNo=id;s.steals={...s.steals,[id]:{t:pi,v:vi,r}};delete s.steals[id-20];
        msg+=` и забирает %?${id} у @${vi}`;
      }
      addLog(s,msg);s.phase=s.robberReturn||"main";break;
    }
    case "buy":{
      need(s.phase==="main","Сначала бросьте кубики");need(s.deck.length,"Карты развития закончились");
      need(has(P.res,costOf(s,pi,"dev")),"Не хватает ресурсов");
      pay(s,pi,costOf(s,pi,"dev"));P.dev.push({t:s.deck.pop(),turn:s.turnNo});stat(P).bought++;addLog(s,`@${pi} покупает карту развития`);break;
    }
    case "dev":{
      const c=a.card;need(c!=="vp","Летопись не разыгрывается");
      need(s.phase==="main"||(c==="knight"&&s.phase==="roll"),"Сейчас эту карту не сыграть");
      need(canPlayDev(s,pi,c),s.devPlayed?"Одна карта развития за ход":"Купленную в этот ход карту сыграть нельзя");
      if(c==="yop"){need(RES.includes(a.a)&&RES.includes(a.b),"Выберите два ресурса");const want=emptyRes();want[a.a]++;want[a.b]++;need(has(s.bank,want),"В запасе нет таких ресурсов");}
      if(c==="mono")need(RES.includes(a.res),"Выберите ресурс");
      P.dev.splice(P.dev.findIndex(d=>d.t===c&&d.turn<s.turnNo),1);s.devPlayed=true;stat(P).played++;
      if(c==="knight"){
        P.knights++;s.robberReturn=s.phase;s.phase="robber";addLog(s,`@${pi} играет «Батыра»`);
        if(P.knights>=3&&s.army!==pi&&(s.army===null||P.knights>s.players[s.army].knights)){s.army=pi;addLog(s,`@${pi} получает «Сильнейшую дружину»`);}
      }else if(c==="road"){
        const left=15-countPieces(s,pi).road;s.freeRoads=Math.min(2,left);addLog(s,`@${pi} играет «Караван»`);
        if(s.freeRoads>0&&roadTargets(s,pi).length)s.phase="roadbuilding";
      }else if(c==="yop"){
        for(const r of [a.a,a.b]){s.bank[r]--;P.res[r]++;}addLog(s,`@${pi} играет «Той»: %${a.a} %${a.b}`);
      }else if(c==="mono"){
        let got=0;s.players.forEach((o,i)=>{if(i!==pi){got+=o.res[a.res];stat(o).robbed+=o.res[a.res];P.res[a.res]+=o.res[a.res];o.res[a.res]=0;}});
        stat(P).steal+=got;addLog(s,`@${pi} играет «Ярмарку» и собирает ${got}%${a.res}`);
      }
      break;
    }
    case "bank":{
      need(s.phase==="main","Сначала бросьте кубики");
      need(RES.includes(a.give)&&RES.includes(a.get)&&a.give!==a.get,"Выберите разные ресурсы");
      const k=ratio(s,pi,a.give);need(P.res[a.give]>=k,`Нужно ${k} × ${RES_RU[a.give].toLowerCase()}`);need(s.bank[a.get]>0,"В запасе нет этого ресурса");
      P.res[a.give]-=k;s.bank[a.give]+=k;P.res[a.get]++;s.bank[a.get]--;s.turnTrades=(s.turnTrades||0)+1;stat(P).bank++;
      addLog(s,`@${pi} меняет ${k}%${a.give} на %${a.get} в запасе`);break;
    }
    case "offer":{
      need(s.phase==="main","Сначала бросьте кубики");
      need(sum(a.give)>0&&sum(a.get)>0,"Укажите, что отдаёте и что хотите");
      need(RES.every(k=>!(a.give[k]&&a.get[k])),"Один ресурс не может быть и в «отдаю», и в «хочу»");
      need(has(P.res,a.give),"У вас нет этих ресурсов");
      s.trade={give:a.give,get:a.get,resp:{}};addLog(s,`@${pi} предлагает ${resLog(a.give)} за ${resLog(a.get)}`);break;
    }
    case "accept":{
      need(s.trade&&s.trade.resp[a.with]===true,"Этот игрок не принял предложение");
      const O=s.players[a.with];need(has(P.res,s.trade.give)&&has(O.res,s.trade.get),"У кого-то уже не хватает ресурсов");
      for(const k of RES){P.res[k]+=-(s.trade.give[k]||0)+(s.trade.get[k]||0);O.res[k]+=(s.trade.give[k]||0)-(s.trade.get[k]||0);}
      stat(P).trades++;stat(O).trades++;addLog(s,`@${pi} и @${a.with} обменялись: ${resLog(s.trade.give)} ⇄ ${resLog(s.trade.get)}`);s.trade=null;break;
    }
    case "cancelOffer":s.trade=null;break;
    case "swapHelper":{
      need(mod(s,"helpers"),"Помощников в этой партии нет");
      need(s.phase==="main","Сначала бросьте кубики");
      need(!s.helperSwapped,"Помощника можно сменить один раз за ход");
      need(swapReady(s,pi),"Нового помощника можно взять со следующего своего хода");
      const k=(s.helperPool||[]).indexOf(a.h);need(k>=0,"Этот помощник занят");
      s.helperPool.splice(k,1,P.helper);const old=P.helper;P.helper=a.h;P.helperTurn=s.turnNo;s.helperSwapped=true;
      addLog(s,`@${pi} меняет помощника: ${HELPERS[old].name} → ${HELPERS[a.h].name}`);break;
    }
    case "end":{
      need(s.phase==="main","Ход ещё не закончен");
      s.trade=null;s.cur=(s.cur+1)%s.players.length;s.phase="roll";s.turnNo++;s.devPlayed=false;s.dice=null;s.turnTrades=0;s.helperSwapped=false;
      addLog(s,`Ходит @${s.cur}`);return s;
    }
    default:throw new Error("Неизвестное действие");
  }
  checkWin(s);
  return s;
}

// --- bots ---
// Сложность: лёгкий ставит почти наугад, ленится строить и охотно меняется; средний — прежняя логика;
// сложный учитывает свою добычу и редкие ресурсы, копит на аилы, не даёт лидеру выгодных обменов и избегает сброса на «7».
const lvl=(s,pi)=>s.players[pi].level||"medium";
const RES_W={wood:1,brick:1,wool:.8,grain:1.15,ore:1.15};
function production(s,pi){
  const pr=emptyRes();
  for(const k in s.buildings){const b=s.buildings[k];if(b.p!==pi)continue;
    for(const hi of gOf(s).verts[+k].hexes){const h=s.board[hi];if(h.res!=="desert")pr[h.res]+=pips(h.num)*(b.city?2:1);}}
  return pr;
}
function vertexScore(s,v,pi){
  const L=lvl(s,pi),hs=gOf(s).verts[v].hexes.map(h=>s.board[h]).filter(h=>h.res!=="desert");
  if(L==="easy")return hs.reduce((a,h)=>a+pips(h.num),0)*0.5+Math.random()*6;
  let sc;
  if(L==="hard"){
    const pr=production(s,pi);
    sc=hs.reduce((a,h)=>a+pips(h.num)*RES_W[h.res]*(pr[h.res]?1:1.35),0)+new Set(hs.map(h=>h.res)).size*1.2;
    for(const h of s.harbors){const ed=gOf(s).edges[h.e];if(ed.a===v||ed.b===v)sc+=h.type==="any"?1.2:Math.min(3,(pr[h.type]||0)/3);}
  }else{
    sc=hs.reduce((a,h)=>a+pips(h.num),0)+new Set(hs.map(h=>h.res)).size*0.8;
    for(const h of s.harbors){const ed=gOf(s).edges[h.e];if(ed.a===v||ed.b===v)sc+=1;}
  }
  return sc+Math.random()*0.3;
}
const best=(arr,f)=>{let b=null,bs=-Infinity;for(const x of arr){const v=f(x);if(v>bs){bs=v;b=x;}}return b;};
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
function bestRoad(s,pi){
  const es=roadTargets(s,pi);if(!es.length)return null;
  return best(es,e=>{const ed=gOf(s).edges[e];return Math.max(...[ed.a,ed.b].map(v=>canSettle(s,v,pi,true)?vertexScore(s,v,pi):Math.random()));});
}
function botPending(s){
  if(!s||s.status!=="play"||s.paused)return -1;
  if(s.phase==="discard"){for(const k in s.toDiscard)if(s.players[k].bot)return +k;return -1;}
  if(s.trade){for(let i=0;i<s.players.length;i++)if(i!==s.cur&&s.players[i].bot&&s.trade.resp[i]===undefined)return i;}
  if(s.players[s.cur].bot&&!(s.trade&&Object.keys(s.trade.resp).length<s.players.length-1))return s.cur;
  return -1;
}
function autoDiscard(res,n){const r={...res},out=emptyRes();for(let i=0;i<n;i++){const k=best(RES,x=>r[x]+Math.random()*0.1);r[k]--;out[k]++;}return out;}
function robberMove(s,pi){
  const L=lvl(s,pi),G=gOf(s),hexes=robberHexes(s,pi);
  const victimsAt=h=>[...new Set(G.hexVerts[h].map(v=>ownerAt(s,v)).filter(o=>o>=0&&o!==pi&&sum(s.players[o].res)>0&&canRob(s,o)))];
  if(L==="easy"){
    const h=pick(hexes.filter(i=>!G.hexVerts[i].some(v=>ownerAt(s,v)===pi)))??pick(hexes);
    return {type:"robber",hex:h,victim:pick(victimsAt(h))};
  }
  const lead=L==="hard"?2:1;
  const h=best(hexes,i=>{let sc=0;
    for(const v of G.hexVerts[i]){const b=s.buildings[v];if(!b)continue;sc+=(b.p===pi?-8:(b.city?2:1)*(1+(vp(s,b.p)/4)**lead))*pips(s.board[i].num);}return sc+Math.random();});
  return {type:"robber",hex:h,victim:best(victimsAt(h),o=>sum(s.players[o].res)+(L==="hard"?vp(s,o):0))};
}
function botMain(s,pi){
  const P=s.players[pi],r=P.res,pc=countPieces(s,pi),L=lvl(s,pi);
  const COST={road:costOf(s,pi,"road"),settle:costOf(s,pi,"settle"),city:costOf(s,pi,"city"),dev:costOf(s,pi,"dev")};
  if(L==="easy"&&Math.random()<0.3)return {type:"end"};
  if(!s.devPlayed&&!(L==="easy"&&Math.random()<0.5)){
    if(canPlayDev(s,pi,"knight")&&(gOf(s).hexVerts[s.robber].some(v=>ownerAt(s,v)===pi)||(L==="hard"&&P.knights>=2&&s.army!==pi)))return {type:"dev",card:"knight"};
    if(canPlayDev(s,pi,"road")&&pc.road<14&&roadTargets(s,pi).length)return {type:"dev",card:"road"};
    if(canPlayDev(s,pi,"mono")){const k=best(RES,x=>s.players.reduce((a,o,i)=>a+(i===pi?0:o.res[x]),0));return {type:"dev",card:"mono",res:k};}
    if(canPlayDev(s,pi,"yop")){const goal=pc.settle?COST.city:COST.settle;const miss=RES.filter(k=>(goal[k]||0)>r[k]&&s.bank[k]>0);
      const a=miss[0]||"ore",b=miss[1]||miss[0]||"grain";const want=emptyRes();want[a]++;want[b]++;if(has(s.bank,want))return {type:"dev",card:"yop",a,b};}
  }
  if(has(r,COST.city)&&pc.city<4){const cs=cityTargets(s,pi);if(cs.length)return {type:"city",v:best(cs,v=>vertexScore(s,v,pi))};}
  const sv=settleTargets(s,pi,false);
  if(has(r,COST.settle)&&sv.length&&pc.settle<5)return {type:"settle",v:best(sv,v=>vertexScore(s,v,pi))};
  if(has(r,COST.road)&&pc.road<15&&(!sv.length||(L==="hard"&&sv.length<2&&!has(r,{...COST.road,wool:1,grain:1})))){const e=bestRoad(s,pi);if(e!==null)return {type:"road",e};}
  const saving=pc.settle&&cityTargets(s,pi).length&&r.ore>=2;
  const buyP=L==="easy"?0.25:L==="hard"?(saving&&sum(r)<=7?0:1):0.5;
  if(has(r,COST.dev)&&s.deck.length&&Math.random()<buyP&&!(L==="medium"&&pc.settle&&r.ore>=2))return {type:"buy"};
  const maxTrades=L==="hard"?5:L==="easy"?1:3;
  if((s.turnTrades||0)<maxTrades){
    const goal=pc.settle&&cityTargets(s,pi).length?COST.city:(sv.length?COST.settle:COST.road);
    const miss=RES.find(k=>(goal[k]||0)>r[k]&&s.bank[k]>0);
    if(miss){const give=RES.find(k=>k!==miss&&r[k]-(goal[k]||0)>=ratio(s,pi,k));if(give)return {type:"bank",give,get:miss};}
    // Сложный не держит больше 7 карт к концу хода: лишнее меняет на то, чего меньше всего.
    if(L==="hard"&&sum(r)>discardLimit(s,pi)){
      const give=best(RES.filter(k=>r[k]>=ratio(s,pi,k)),k=>r[k]-(goal[k]||0)),get=give&&best(RES.filter(k=>k!==give&&s.bank[k]>0),k=>-r[k]);
      if(give&&get)return {type:"bank",give,get};
    }
  }
  return {type:"end"};
}
function botRespond(s,b){
  const P=s.players[b],t=s.trade,L=lvl(s,b);
  if(!has(P.res,t.get))return false;
  if(L==="easy")return Math.random()<0.8;
  if(L==="medium")return sum(t.give)>=sum(t.get)&&Math.random()<0.6;
  // Сложный соглашается, только если обмен приближает его к цели и предлагающий не на пороге победы.
  if(vp(s,s.cur)>=8)return false;
  const pc=countPieces(s,b),goal=costOf(s,b,pc.settle&&cityTargets(s,b).length?"city":"settle");
  const after={...P.res};for(const k of RES)after[k]+=(t.give[k]||0)-(t.get[k]||0);
  const lack=x=>RES.reduce((a,k)=>a+Math.max(0,(goal[k]||0)-x[k]),0);
  return lack(after)<lack(P.res)&&sum(t.give)>=sum(t.get);
}
function botAction(s,b){
  const P=s.players[b];
  if(s.phase==="discard"&&s.toDiscard[b])return {type:"discard",sel:lvl(s,b)==="easy"?randomPick(P.res,s.toDiscard[b]):autoDiscard(P.res,s.toDiscard[b])};
  if(s.trade&&b!==s.cur&&s.trade.resp[b]===undefined)return {type:"respond",accept:botRespond(s,b)};
  switch(s.phase){
    case "setup":return s.step==="settle"?{type:"settle",v:best(settleTargets(s,b,true),v=>vertexScore(s,v,b))}:{type:"road",e:bestRoad(s,b)};
    case "roll":return canPlayDev(s,b,"knight")&&gOf(s).hexVerts[s.robber].some(v=>ownerAt(s,v)===b)&&lvl(s,b)!=="easy"?{type:"dev",card:"knight"}:{type:"roll"};
    case "robber":return robberMove(s,b);
    case "roadbuilding":{const e=bestRoad(s,b);return e===null?{type:"endRoads"}:{type:"road",e};}
    default:return botMain(s,b);
  }
}
function botStep(s){
  const b=botPending(s);if(b<0)return null;
  const id=s.players[b].id;
  try{return apply(s,id,botAction(s,b));}
  catch(e){
    const fb=s.phase==="main"&&b===s.cur?{type:"end"}:s.phase==="robber"?robberMove(s,b):s.trade&&b!==s.cur?{type:"respond",accept:false}:s.phase==="roadbuilding"?{type:"endRoads"}:{type:"roll"};
    return apply(s,id,fb);
  }
}

// --- таймер хода ---
// Ключ меняется, когда ход переходит к другому игроку или начинается сброс на буране, — тогда таймер стартует заново.
const timerPhase=s=>s.phase==="roll"||s.phase==="discard"?s.phase:"";
const turnKey=s=>[s.turnNo,s.setupIdx,s.cur,timerPhase(s)].join(":");
const phaseTime=s=>s.phase==="roll"?TIMER.roll:s.turnTime?TIMER[timerPhase(s)]||s.turnTime:0;
// Время вышло: сбрасываем случайные карты за всех, кто тянет, или делаем за текущего игрока самый безобидный шаг.
// Сервер вызывает это, пока ключ не сменится, так что ход доигрывается до конца.
const randomPick=(res,n)=>{const out=emptyRes();shuffle(RES.flatMap(k=>Array(res[k]).fill(k))).slice(0,n).forEach(k=>out[k]++);return out;};
function timeoutStep(s){
  if(s.phase==="discard"){let t=s;for(const k in s.toDiscard)t=apply(t,t.players[k].id,{type:"discard",sel:randomPick(t.players[k].res,t.toDiscard[k])});return t;}
  const pi=s.cur,id=s.players[pi].id;
  switch(s.phase){
    case "setup":case "robber":return apply(s,id,botAction(s,pi));
    case "roll":return apply(s,id,{type:"roll"});
    case "roadbuilding":return apply(s,id,{type:"endRoads"});
    default:return apply(s,id,{type:"end"});
  }
}

if(typeof module!=="undefined")module.exports={RES,RES_RU,COST,DEV_RU,DEV_HINT,COLORS,MAX_PLAYERS,LEVELS,LEVEL_RU,BOARD,MAP_SIZES,TURN_TIMES,TIMER,turnKey,phaseTime,timeoutStep,mapRadius,gOf,emptyRes,sum,has,pips,newPlayer,newGame,ownerAt,countPieces,canSettle,canRoad,settleTargets,roadTargets,cityTargets,ratio,vp,resText,canPlayDev,apply,results,MODS,HELPERS,mod,hasHelper,costOf,discardLimit,canRob,robberHexes,swapReady,botPending,botStep};
