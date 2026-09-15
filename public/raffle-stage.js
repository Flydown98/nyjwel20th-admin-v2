const $ = s => document.querySelector(s);
const key = new URLSearchParams(location.search).get('k') || '';
const preview = new URLSearchParams(location.search).get('preview') || '';
let spinAnim = null;
let currentSamples = [];
let lastProduct = null;
let lastWinners = [];
let targetCount = 1;
let currentIndex = 1;
let audioUnlocked = false;
let spinFadeTimer = null;

const spinAudio = $('#spinAudio');
const winnerAudio = $('#winnerAudio');
const scenes = { idle:$('#idleScene'), machine:$('#machineScene'), winner:$('#winnerScene'), final:$('#finalScene') };

function escapeHtml(v){return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function normalizePerson(p={}){return {name:String(p.name ?? p.participantName ?? '행운의 주인공'),seat:String(p.seat ?? ''),organization:String(p.organization ?? '')}}
function winnerPerson(p={}){return normalizePerson(p)}
function reelItem(p){p=normalizePerson(p);return `<div class="slot-item"><span class="slot-name">${escapeHtml(p.name)}</span><span class="slot-seat">${p.seat?escapeHtml(p.seat):'&nbsp;'}</span></div>`}
function itemHeight(){const reel=$('#reel');return reel ? reel.clientHeight/3 : 160}
function baseY(){return itemHeight()}
function setConnection(text,state=''){const b=$('#connectionBadge');b.classList.remove('connected','error');if(state)b.classList.add(state);b.querySelector('span').textContent=text;$('#footerStatus').textContent=text}
function showScene(name){Object.entries(scenes).forEach(([k,v])=>v.classList.toggle('hidden',k!==name));$('#stage').classList.toggle('running',name==='machine')}
function setPrize(p){const name=p?.name||p||'행운상품';lastProduct=typeof p==='object'?p:{name};$('#prize').textContent=name;$('#winnerPrize').textContent=name;$('#finalPrize').textContent=name}
function setRound(index,total){currentIndex=Math.max(1,Number(index)||1);targetCount=Math.max(1,Number(total)||1);$('#roundText').textContent=`${currentIndex} / ${targetCount} 번째 당첨자`;renderProgress()}
function renderProgress(){const box=$('#progressDots');box.innerHTML=Array.from({length:Math.min(targetCount,20)},(_,i)=>`<i class="progress-dot ${i<lastWinners.length?'done':''} ${i+1===currentIndex?'current':''}"></i>`).join('')}
function setStatus(text){$('#status').textContent=text||''}

async function unlockAudio(){
  if(audioUnlocked)return true;
  try{
    for(const a of [spinAudio,winnerAudio]){a.volume=0;a.currentTime=0;await a.play();a.pause();a.currentTime=0}
    spinAudio.volume=.30;winnerAudio.volume=.62;audioUnlocked=true;return true;
  }catch(_){return false}
}
function playSpin(){if(!audioUnlocked)return;clearInterval(spinFadeTimer);spinAudio.pause();spinAudio.currentTime=0;spinAudio.volume=.30;spinAudio.play().catch(()=>{})}
function stopSpin(fadeMs=700){if(!audioUnlocked){spinAudio.pause();return}clearInterval(spinFadeTimer);const steps=14,start=spinAudio.volume||.3;let i=0;spinFadeTimer=setInterval(()=>{i++;spinAudio.volume=Math.max(0,start*(1-i/steps));if(i>=steps){clearInterval(spinFadeTimer);spinAudio.pause();spinAudio.currentTime=0;spinAudio.volume=.30}},Math.max(25,fadeMs/steps))}
function playWinner(){if(!audioUnlocked)return;winnerAudio.pause();winnerAudio.currentTime=0;winnerAudio.volume=.62;winnerAudio.play().catch(()=>{})}

function showIdle(mode='idle'){
  spinAnim?.cancel();spinAnim=null;stopSpin(120);$('#stage').classList.toggle('blackout',mode==='black');
  if(mode==='black')return;
  showScene('idle');setPrize('행운권 추첨');lastWinners=[];targetCount=1;currentIndex=1;
}

function startSpin(samples, product, meta={}){
  $('#stage').classList.remove('blackout');
  currentSamples=(samples?.length?samples:[{name:'행운의 주인공',seat:''}]).map(normalizePerson);
  if(meta.previousWinners)lastWinners=meta.previousWinners.map(winnerPerson);
  setPrize(product||lastProduct||{name:'행운상품'});
  setRound(meta.currentIndex||lastWinners.length+1,meta.targetCount||meta.count||targetCount||1);
  showScene('machine');setStatus('슬롯이 돌아가고 있습니다 · 진행자 화면에서 멈춰주세요');
  renderProgress();
  const rounds=Math.max(5,Math.ceil(90/currentSamples.length));
  const seq=[];for(let r=0;r<rounds;r++)currentSamples.forEach(x=>seq.push(x));
  $('#track').innerHTML=seq.map(reelItem).join('');
  const h=itemHeight(), loop=currentSamples.length*h, start=baseY();
  $('#track').style.transform=`translateY(${start}px)`;
  spinAnim?.cancel();
  spinAnim=$('#track').animate([{transform:`translateY(${start}px)`},{transform:`translateY(${start-loop}px)`}],{duration:Math.max(1250,currentSamples.length*42),iterations:Infinity,easing:'linear'});
  playSpin();
}

async function revealWinner(winners,product,animate=true,meta={}){
  lastWinners=(winners||[]).map(winnerPerson);setPrize(product||lastProduct||{name:'행운상품'});
  const w=lastWinners.at(-1)||{name:'당첨자',seat:''};
  targetCount=Math.max(1,Number(meta.targetCount)||targetCount||lastWinners.length||1);currentIndex=Math.max(1,Number(meta.currentIndex)||lastWinners.length||1);
  if(animate){
    spinAnim?.cancel();spinAnim=null;
    const h=itemHeight(),seq=[];
    for(let i=0;i<30;i++)seq.push(currentSamples[Math.floor(Math.random()*Math.max(1,currentSamples.length))]||w);
    seq.push(w);$('#track').innerHTML=seq.map(reelItem).join('');
    const start=baseY(),end=start-(seq.length-1)*h;$('#track').style.transform=`translateY(${start}px)`;
    stopSpin(1900);
    const anim=$('#track').animate([{transform:`translateY(${start}px)`},{transform:`translateY(${end-h*4}px)`,offset:.72},{transform:`translateY(${end+h*.18}px)`,offset:.94},{transform:`translateY(${end}px)`,offset:1}],{duration:2850,easing:'cubic-bezier(.08,.62,.13,1)',fill:'forwards'});
    await anim.finished.catch(()=>{});$('#track').style.transform=`translateY(${end}px)`;
  } else {stopSpin(100)}
  $('#winnerProgress').textContent=`${currentIndex} / ${targetCount} 번째 당첨자`;
  $('#winnerName').textContent=w.name;fitWinnerName(w.name);
  $('#winnerSeat').textContent=w.seat?`좌석  ${w.seat}`:'좌석 미배정';
  $('#winnerGuide').textContent=currentIndex<targetCount?'다음 당첨자 추첨을 준비해주세요':'마지막 당첨자입니다';
  showScene('winner');playWinner();particles(90);
}

function fitWinnerName(name){const el=$('#winnerName'),n=[...String(name||'')].length;el.style.fontSize=n>=12?'clamp(60px,6.5vw,150px)':n>=8?'clamp(72px,8vw,180px)':'clamp(92px,10vw,230px)'}
function showFinalWinners(winners,product){
  spinAnim?.cancel();spinAnim=null;stopSpin(120);lastWinners=(winners||[]).map(winnerPerson);setPrize(product||lastProduct||{name:'행운상품'});
  const list=$('#finalWinnerList'),count=lastWinners.length,cols=count<=2?count:count<=6?3:4;list.style.setProperty('--cols',Math.max(1,cols));
  list.innerHTML=lastWinners.map((w,i)=>`<article class="final-card"><b class="final-rank">${i+1}</b><div class="final-person"><strong title="${escapeHtml(w.name)}">${escapeHtml(w.name)}</strong><small>${escapeHtml(w.organization||'20주년 행운권 당첨')}</small></div><span class="final-seat">${escapeHtml(w.seat||'좌석 미배정')}</span></article>`).join('');
  showScene('final');playWinner();particles(150);
}

function particles(count=100){const box=$('#particles');box.innerHTML='';for(let i=0;i<count;i++){const e=document.createElement('i');e.style.left=Math.random()*100+'%';e.style.setProperty('--dur',(2.2+Math.random()*3.2)+'s');e.style.setProperty('--x',(Math.random()*420-210)+'px');e.style.setProperty('--r',(Math.random()*1080-540)+'deg');e.style.animationDelay=(Math.random()*.8)+'s';if(i%3===1)e.style.background='linear-gradient(180deg,#e0c9ff,#8e63c6)';if(i%3===2)e.style.background='linear-gradient(180deg,#fff,#e8e3f0)';box.appendChild(e)}setTimeout(()=>box.innerHTML='',6500)}

function initCanvas(){const canvas=$('#fxCanvas');if(!canvas)return;const ctx=canvas.getContext('2d');let w=0,h=0,dpr=1;const dots=Array.from({length:70},()=>({}));function reset(d,initial=false){d.x=Math.random()*w;d.y=initial?Math.random()*h:h+30;d.r=.7+Math.random()*2.6;d.s=.12+Math.random()*.42;d.a=.05+Math.random()*.16;d.rgb=Math.random()>.68?'234,208,148':'154,108,221'}function resize(){w=innerWidth;h=innerHeight;dpr=Math.max(1,Math.min(2,devicePixelRatio||1));canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);dots.forEach(d=>reset(d,true))}function draw(){ctx.clearRect(0,0,w,h);const now=performance.now()/1000;for(const d of dots){d.y-=d.s;d.x+=Math.sin(now+d.y*.009)*.08;if(d.y<-15)reset(d);const g=ctx.createRadialGradient(d.x,d.y,0,d.x,d.y,d.r*6);g.addColorStop(0,`rgba(${d.rgb},${d.a})`);g.addColorStop(1,`rgba(${d.rgb},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(d.x,d.y,d.r*6,0,Math.PI*2);ctx.fill()}requestAnimationFrame(draw)}addEventListener('resize',resize);resize();draw()}

async function requestFullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen()}catch(_){}}
$('#launchStage').addEventListener('click',async()=>{await unlockAudio();await requestFullscreen();$('#launchOverlay').classList.add('hidden');localStorage.setItem('nyjwel-stage-launched','1')});
$('#fullscreenButton').addEventListener('click',requestFullscreen);

function connect(){
  if(!key){setConnection('NO STAGE KEY','error');$('#footerStatus').textContent='무대 링크 인증키가 없습니다';return}
  const es=new EventSource(`/api/public/raffle-stage?k=${encodeURIComponent(key)}`);
  es.addEventListener('ready',()=>setConnection('LIVE CONNECTED','connected'));
  es.addEventListener('raffle-sync',e=>{try{const d=JSON.parse(e.data),r=d.remote||{};lastProduct=r.product||lastProduct;lastWinners=(r.winners||[]).map(winnerPerson);targetCount=r.targetCount||r.count||1;currentIndex=r.currentIndex||Math.max(1,lastWinners.length+1);if(r.status==='spinning')startSpin(r.sample,r.product,{currentIndex,targetCount,previousWinners:lastWinners});else if(r.status==='step-winner'&&lastWinners.length)revealWinner(r.winners,r.product,false,{currentIndex:r.currentIndex,targetCount:r.targetCount});else if(r.status==='final'&&lastWinners.length)showFinalWinners(r.winners,r.product);else showIdle(r.screen==='black'?'black':'idle')}catch(_){}});
  es.addEventListener('stage-mode',e=>{try{const d=JSON.parse(e.data);showIdle(d.mode==='black'?'black':'idle')}catch(_){}});
  es.addEventListener('raffle-start',e=>{try{const d=JSON.parse(e.data);startSpin(d.sample,d.product,d)}catch(_){}});
  es.addEventListener('raffle-step-winner',e=>{try{const d=JSON.parse(e.data);revealWinner(d.winners,d.product,true,d)}catch(_){}});
  es.addEventListener('raffle-final',e=>{try{const d=JSON.parse(e.data);showFinalWinners(d.winners,d.product)}catch(_){}});
  es.addEventListener('raffle-winner',e=>{try{const d=JSON.parse(e.data);if((d.winners||[]).length>1)showFinalWinners(d.winners,d.product);else revealWinner(d.winners,d.product,true,{currentIndex:1,targetCount:1})}catch(_){}});
  es.onerror=()=>setConnection('RECONNECTING','error');
}

function previewMode(){
  if(!preview)return false;
  $('#launchOverlay').classList.add('hidden');audioUnlocked=false;setConnection('PREVIEW MODE','connected');
  const sample=[{name:'김하늘',seat:'G7'},{name:'박서준',seat:'H12'},{name:'이유진',seat:'M4'},{name:'최민수',seat:'J9'},{name:'정다은',seat:'T16'},{name:'한지우',seat:'K3'}];
  if(preview==='winner'){lastWinners=[sample[0]];revealWinner([{participantName:'김하늘',seat:'G7'}],{name:'20주년 기념 선물'},false,{currentIndex:1,targetCount:3})}
  else if(preview==='final')showFinalWinners(sample.slice(0,3).map(x=>({participantName:x.name,seat:x.seat,organization:'남양주시장애인복지관'})),{name:'20주년 기념 선물'});
  else if(preview==='spin')startSpin(sample,{name:'20주년 기념 선물'},{currentIndex:2,targetCount:3,previousWinners:[{participantName:'김하늘',seat:'G7'}]});
  else showIdle('idle');return true;
}

initCanvas();showIdle('idle');if(!previewMode())connect();
