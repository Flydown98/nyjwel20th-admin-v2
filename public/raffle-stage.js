const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search),key=params.get('k')||'',preview=params.get('preview')||'';
let source=null,currentSamples=[],lastWinners=[],lastProduct={name:'행운상품'},targetCount=1;
let audioUnlocked=false,spinAudio=null,winnerAudio=null,ambientStarted=false;
let slotTimers=[],slotStates=[],revealInProgress=false,pendingFinalPayload=null;
const stage=$('#stage');

function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function person(p){return {name:String(p?.participantName??p?.name??''),seat:String(p?.seat??''),organization:String(p?.organization??'')}}
function setStatus(t){$('#status').textContent=t||''}
function setConnection(t,cls=''){$('#connection').textContent=t;$('#connection').className='connection '+cls}
function setPrize(p){lastProduct=p||lastProduct;$('#machinePrize').textContent=lastProduct?.name||'행운상품';$('#winnerPrize').textContent=lastProduct?.name||'행운상품';$('#finalPrize').textContent=lastProduct?.name||'행운상품'}
function showScene(name){document.querySelectorAll('.scene').forEach(x=>x.classList.add('hidden'));$(`#${name}Scene`)?.classList.remove('hidden')}
function randomPerson(exclude=''){const pool=currentSamples.filter(x=>x.name!==exclude);return pool[Math.floor(Math.random()*Math.max(1,pool.length))]||currentSamples[0]||{name:'행운의 주인공',seat:''}}
function createAudio(){if(spinAudio)return;spinAudio=new Audio('/stage-roulette.wav');spinAudio.loop=true;spinAudio.volume=.34;winnerAudio=new Audio('/stage-winner.wav');winnerAudio.volume=.75}
function playSpin(){if(!audioUnlocked)return;createAudio();spinAudio.currentTime=0;spinAudio.play().catch(()=>{})}
function stopSpin(){if(spinAudio){spinAudio.pause();spinAudio.currentTime=0}}
function playWinner(){if(!audioUnlocked)return;createAudio();winnerAudio.currentTime=0;winnerAudio.play().catch(()=>{})}
function clearSlots(){slotTimers.forEach(t=>clearTimeout(t));slotTimers=[];slotStates=[]}
function slotCard(i){
  return `<article class="slot-card" data-slot="${i}">
    <div class="slot-index">${i+1}</div>
    <div class="slot-ghost top">READY</div>
    <div class="slot-focus">
      <strong class="slot-main-name">행운의 주인공</strong>
      <span class="slot-main-seat">---</span>
    </div>
    <div class="slot-ghost bottom">GOOD LUCK</div>
    <div class="slot-led"></div>
  </article>`;
}
function updateSlot(card,p,ghostA=null,ghostB=null){
  card.querySelector('.slot-main-name').textContent=p?.name||'행운의 주인공';
  card.querySelector('.slot-main-seat').textContent=p?.seat||'좌석 미배정';
  card.querySelector('.slot-ghost.top').textContent=(ghostA||randomPerson(p?.name)).name||'';
  card.querySelector('.slot-ghost.bottom').textContent=(ghostB||randomPerson(p?.name)).name||'';
}
function cycleSlot(i,delay=78){
  const card=document.querySelector(`[data-slot="${i}"]`);if(!card)return;
  const p=randomPerson();updateSlot(card,p);
  slotTimers[i]=setTimeout(()=>cycleSlot(i,delay),delay);
}
function startSpin(samples,product,meta={}){
  clearSlots();stopSpin();
  currentSamples=(samples?.length?samples:[{name:'행운의 주인공',seat:''}]).map(person);
  targetCount=Math.max(1,Math.min(5,Number(meta.targetCount||meta.count||1)));
  setPrize(product||lastProduct);showScene('machine');setStatus(targetCount===1?'1명 추첨 중':'동시 '+targetCount+'명 추첨 중');
  $('#roundText').textContent=targetCount===1?'SINGLE SLOT':'MULTI SLOT · '+targetCount;
  const board=$('#slotBoard');board.dataset.count=String(targetCount);board.innerHTML=Array.from({length:targetCount},(_,i)=>slotCard(i)).join('');
  slotStates=Array.from({length:targetCount},()=>({locked:false}));
  for(let i=0;i<targetCount;i++)cycleSlot(i,68+i*7);
  playSpin();
}
async function slowAndLock(i,winner){
  const card=document.querySelector(`[data-slot="${i}"]`);if(!card)return;
  clearTimeout(slotTimers[i]);card.classList.add('slowing');
  // 눈에 보이는 감속: 빠름 -> 중간 -> 느림 -> 아주 느림 -> 당첨 고정
  const delays=[90,115,145,180,225,285,360,450];
  for(let step=0;step<delays.length;step++){
    const p=randomPerson(winner.name);updateSlot(card,p);
    if(step>=5)playSoftTick(step);
    await sleep(delays[step]);
  }
  updateSlot(card,winner,randomPerson(winner.name),randomPerson(winner.name));
  card.classList.remove('slowing');card.classList.add('locked');
  playWinner();slotStates[i].locked=true;
}
function playSoftTick(step){
  try{
    const C=window.AudioContext||window.webkitAudioContext;if(!C||!audioUnlocked)return;
    const ctx=playSoftTick.ctx||(playSoftTick.ctx=new C());if(ctx.state==='suspended')ctx.resume();
    const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime;
    o.frequency.value=620-(step*55);o.type='triangle';g.gain.setValueAtTime(.028,t);g.gain.exponentialRampToValueAtTime(.0001,t+.08);
    o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+.08);
  }catch(_){}
}
async function revealBatchWinners(winners,product,meta={}){
  revealInProgress=true;lastWinners=(winners||[]).map(person);setPrize(product||lastProduct);
  stopSpin();setStatus('슬롯이 하나씩 멈추고 있습니다…');
  // 각 슬롯은 짧은 간격으로 시작하지만 감속 애니메이션은 서로 겹쳐 전체 시간이 너무 길어지지 않게 한다.
  const jobs=lastWinners.map((w,i)=>(async()=>{await sleep(i*420);await slowAndLock(i,w)})());
  await Promise.all(jobs);
  setStatus(lastWinners.length===1?`${lastWinners[0].name}님 당첨!`:`${lastWinners.length}명 당첨 완료!`);
  particles(120);await sleep(1900);
  revealInProgress=false;showFinalWinners(lastWinners,product);
  if(pendingFinalPayload)pendingFinalPayload=null;
}
function showFinalWinners(winners,product){
  clearSlots();stopSpin();lastWinners=(winners||[]).map(person);setPrize(product||lastProduct);
  const grid=$('#finalGrid');grid.dataset.count=String(lastWinners.length);
  grid.innerHTML=lastWinners.map((w,i)=>`<article class="final-card">
    <span class="final-rank">${i+1}</span>
    <div><strong>${esc(w.name)}</strong><small>20주년 행운권 당첨</small></div>
    <b>${esc(w.seat||'좌석 미배정')}</b>
  </article>`).join('');
  showScene('final');setStatus('당첨 결과');particles(160);
}
function revealWinner(winners,product,animate=true,meta={}){return animate?revealBatchWinners(winners,product,meta):showFinalWinners(winners,product)}
function showIdle(mode='idle'){
  clearSlots();stopSpin();stage.classList.toggle('blackout',mode==='black');
  if(mode==='black')return;
  showScene('idle');setStatus('추첨 대기');$('#idleMode').textContent=mode==='title'?'20TH ANNIVERSARY':'LUCKY DRAW';
}
function particles(count=80){
  const box=$('#particles');if(!box)return;box.innerHTML='';
  for(let i=0;i<count;i++){const el=document.createElement('i');el.style.left=`${Math.random()*100}%`;el.style.setProperty('--dur',`${2+Math.random()*2.5}s`);el.style.setProperty('--drift',`${Math.random()*260-130}px`);el.style.animationDelay=`${Math.random()*.5}s`;box.appendChild(el)}
}
function initCanvas(){
  const canvas=$('#fx'),ctx=canvas.getContext('2d');let dots=[];
  function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);dots=Array.from({length:45},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:1+Math.random()*2,v:.15+Math.random()*.35,a:.05+Math.random()*.14}))}
  function draw(){ctx.clearRect(0,0,innerWidth,innerHeight);for(const d of dots){d.y-=d.v;if(d.y<0)d.y=innerHeight;ctx.fillStyle=`rgba(235,212,154,${d.a})`;ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fill()}requestAnimationFrame(draw)}
  addEventListener('resize',resize);resize();draw();
}
function connect(){
  if(!key){setConnection('NO KEY','error');return}
  source?.close();source=new EventSource(`/api/public/raffle-stage?k=${encodeURIComponent(key)}`);
  source.addEventListener('ready',()=>setConnection('LIVE · CONNECTED','connected'));
  source.addEventListener('raffle-sync',e=>{try{const r=JSON.parse(e.data).remote||{};if(r.status==='spinning')startSpin(r.sample,r.product,{count:r.targetCount||r.count});else if(r.status==='final'&&r.winners?.length)showFinalWinners(r.winners,r.product);else showIdle(r.screen||'idle')}catch(_){}});
  source.addEventListener('stage-mode',e=>{try{showIdle(JSON.parse(e.data).mode)}catch(_){}});
  source.addEventListener('raffle-start',e=>{try{const d=JSON.parse(e.data);startSpin(d.sample,d.product,d)}catch(_){}});
  source.addEventListener('raffle-batch-winners',e=>{try{const d=JSON.parse(e.data);revealBatchWinners(d.winners,d.product,d)}catch(_){}});
  source.addEventListener('raffle-step-winner',e=>{try{const d=JSON.parse(e.data);revealBatchWinners(d.winners,d.product,d)}catch(_){}});
  source.addEventListener('raffle-final',e=>{try{const d=JSON.parse(e.data);if(revealInProgress)pendingFinalPayload=d;else showFinalWinners(d.winners,d.product)}catch(_){}});
  source.onerror=()=>setConnection('RECONNECTING','error');
}
function previewMode(){
  if(!preview)return false;
  $('#launchOverlay').classList.add('hidden');audioUnlocked=false;setConnection('PREVIEW','connected');
  const sample=[
    {name:'김하늘',seat:'G7'},{name:'박서준',seat:'H12'},{name:'이유진',seat:'M4'},
    {name:'최민수',seat:'J9'},{name:'정다은',seat:'T16'},{name:'한지우',seat:'K3'},
    {name:'송은지',seat:'N11'},{name:'장민호',seat:'P6'}
  ];
  if(preview==='spin5')startSpin(sample,{name:'(주)산과들에 견과류 세트'},{count:5});
  else if(preview==='final5')showFinalWinners(sample.slice(0,5),{name:'(주)산과들에 견과류 세트'});
  else if(preview==='batch5'){startSpin(sample,{name:'(주)산과들에 견과류 세트'},{count:5});setTimeout(()=>revealBatchWinners(sample.slice(0,5),{name:'(주)산과들에 견과류 세트'}),1200)}
  else startSpin(sample,{name:'20주년 기념상품'},{count:3});
  return true;
}
$('#launchBtn')?.addEventListener('click',async()=>{
  audioUnlocked=true;createAudio();try{await document.documentElement.requestFullscreen?.()}catch(_){}
  $('#launchOverlay').classList.add('hidden');connect();
});
initCanvas();showIdle('idle');if(!previewMode())connect();
