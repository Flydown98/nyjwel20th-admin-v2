
const $ = s => document.querySelector(s);
const key = new URLSearchParams(location.search).get('k') || '';
const ITEM_HEIGHT = 140;
let spinAnim = null, currentSamples = [], lastProduct = null, lastWinners = [];

function item(p){
  return `<div class="item"><span>${escapeHtml(p.name || '행운의 주인공')}</span>${p.seat ? `<small>(${escapeHtml(p.seat)})</small>` : ''}</div>`;
}
function escapeHtml(v){return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function baseY(){ return (($('#reel')?.clientHeight || 420) / 2) - ITEM_HEIGHT / 2; }

function setStatus(text=''){ const el = $('#status'); if(el) el.textContent = text; }
function setPrize(text='행운권 추첨'){ const el = $('#prize'); if(el) el.textContent = text; }

function showMode(mode='idle', payload={}){
  const stage = $('#stage');
  const winner = $('#winner');
  stage.classList.remove('blackout','title-mode','running');
  winner.classList.add('hidden');

  if(mode === 'black'){
    spinAnim?.cancel();
    stage.classList.add('blackout');
    setStatus('');
    return;
  }
  if(mode === 'title'){
    spinAnim?.cancel();
    stage.classList.add('title-mode');
    setPrize('행운권 추첨');
    setStatus('남양주시장애인복지관 개관 20주년');
    return;
  }
  if(mode === 'winner' && lastWinners.length){
    revealWinner(lastWinners, lastProduct || payload.product || {name:'행운상품'}, false);
    return;
  }
  spinAnim?.cancel();
  setPrize('행운권 추첨');
  setStatus('진행자 화면에서 추첨을 시작해주세요');
}

function startSpin(samples, product){
  lastProduct = product || lastProduct;
  currentSamples = samples?.length ? samples : [{name:'행운의 주인공', seat:''}];

  const stage = $('#stage');
  stage.classList.remove('blackout','title-mode');
  stage.classList.add('running');
  $('#winner').classList.add('hidden');
  setPrize(product?.name || '행운상품');
  setStatus('행운의 주인공을 찾고 있습니다');

  const seq = [];
  for(let r=0;r<5;r++) currentSamples.forEach(x => seq.push(x));
  $('#track').innerHTML = seq.map(item).join('');

  const loop = currentSamples.length * ITEM_HEIGHT;
  const start = baseY();
  $('#track').style.transform = `translateY(${start}px)`;
  spinAnim?.cancel();
  spinAnim = $('#track').animate(
    [{ transform:`translateY(${start}px)` }, { transform:`translateY(${start - loop}px)` }],
    { duration:Math.max(1500, currentSamples.length * 48), iterations:Infinity, easing:'linear' }
  );
}

async function revealWinner(winners,product,animate=true,meta={}){lastWinners=winners||[];lastProduct=product||lastProduct;spinAnim?.cancel();const winner=winners?.at(-1)||winners?.[0]||{participantName:'당첨자',seat:''},target={name:winner.participantName,seat:winner.seat||''};$('#finalWinnerList')?.classList.add('hidden');if(animate){const seq=[];for(let i=0;i<24;i++)seq.push(currentSamples[Math.floor(Math.random()*Math.max(1,currentSamples.length))]||target);seq.push(target);$('#track').innerHTML=seq.map(item).join('');const base=baseY(),end=base-(seq.length-1)*ITEM_HEIGHT;$('#track').style.transform=`translateY(${base}px)`;const anim=$('#track').animate([{transform:`translateY(${base}px)`},{transform:`translateY(${end}px)`}],{duration:3200,easing:'cubic-bezier(.08,.68,.12,1)',fill:'forwards'});await anim.finished.catch(()=>{});$('#track').style.transform=`translateY(${end}px)`}$('#winnerName').textContent=winner.participantName;$('#winnerSeat').textContent=winner.seat?`좌석 ${winner.seat}`:'좌석 미배정';$('#winnerPrize').textContent=product?.name||'행운상품';$('#winnerProgress').textContent=meta.targetCount?`${meta.currentIndex||winners.length} / ${meta.targetCount} 번째 당첨자`:'';$('#winner').classList.remove('hidden');particles()}
function showFinalWinners(winners,product){lastWinners=winners||[];lastProduct=product||lastProduct;spinAnim?.cancel();$('#winnerName').textContent=`최종 ${winners.length}명 당첨`;$('#winnerSeat').textContent='';$('#winnerPrize').textContent=product?.name||'행운상품';$('#winnerProgress').textContent='FINAL WINNERS';const list=$('#finalWinnerList');list.innerHTML=winners.map((w,i)=>`<div class="final-winner-item"><b>${i+1}</b><strong>${escapeHtml(w.participantName)}</strong><span>${escapeHtml(w.seat||'좌석 미배정')}</span></div>`).join('');list.classList.remove('hidden');$('#winner').classList.remove('hidden');particles()}

function particles(){
  const box = $('#particles');
  box.innerHTML = '';
  for(let i=0;i<110;i++){
    const e = document.createElement('i');
    e.style.left = Math.random()*100 + '%';
    e.style.setProperty('--dur', (2.3 + Math.random()*3.2) + 's');
    e.style.setProperty('--x', (Math.random()*360 - 180) + 'px');
    e.style.setProperty('--r', (Math.random()*1080 - 540) + 'deg');
    e.style.animationDelay = (Math.random()*.8) + 's';
    box.appendChild(e);
  }
  setTimeout(()=> box.innerHTML = '', 6200);
}

function initCanvas(){
  const canvas = $('#fxCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  let w=0,h=0,dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const dots = Array.from({length:55}, ()=>( {x:0,y:0,r:0,s:0,a:0,hue:0} ));

  function resize(){
    w = canvas.clientWidth = window.innerWidth;
    h = canvas.clientHeight = window.innerHeight;
    canvas.width = Math.floor(w*dpr);
    canvas.height = Math.floor(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    dots.forEach(d=>resetDot(d,true));
  }
  function resetDot(d,initial=false){
    d.x = Math.random()*w;
    d.y = initial ? Math.random()*h : h + Math.random()*60;
    d.r = 1 + Math.random()*3.5;
    d.s = .18 + Math.random()*.52;
    d.a = .08 + Math.random()*.18;
    d.hue = Math.random()>.72 ? '233,212,162' : '151,108,255';
  }
  function draw(){
    ctx.clearRect(0,0,w,h);
    for(const d of dots){
      d.y -= d.s;
      d.x += Math.sin((performance.now()/1000)+d.y*0.01)*0.09;
      if(d.y < -20) resetDot(d,false);
      const g = ctx.createRadialGradient(d.x,d.y,0,d.x,d.y,d.r*8);
      g.addColorStop(0,`rgba(${d.hue},${d.a})`);
      g.addColorStop(.45,`rgba(${d.hue},${d.a*.45})`);
      g.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.x,d.y,d.r*8,0,Math.PI*2);
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize', resize);
  resize();
  draw();
}

initCanvas();

if(!key){
  setStatus('무대 화면 인증키가 없습니다.');
}else{
  const es = new EventSource(`/api/public/raffle-stage?k=${encodeURIComponent(key)}`);
  es.addEventListener('ready', ()=> setStatus('무대 화면 연결 완료 · 추첨 대기 중'));
  es.addEventListener('raffle-sync', e=>{
    try{
      const d = JSON.parse(e.data), r = d.remote || {};
      lastProduct = r.product || null;
      lastWinners = r.winners || [];
      if(r.status === 'spinning') startSpin(r.sample, r.product);
      else if(r.status === 'step-winner' && r.winners?.length) revealWinner(r.winners, r.product, false,{currentIndex:r.currentIndex,targetCount:r.targetCount});
      else if(r.status === 'final' && r.winners?.length) showFinalWinners(r.winners, r.product);
      else showMode(r.screen || 'idle', r);
    }catch(_){ }
  });
  es.addEventListener('stage-mode', e=>{ try{ const d = JSON.parse(e.data); showMode(d.mode, d); }catch(_){ } });
  es.addEventListener('raffle-start', e=>{ const d = JSON.parse(e.data); startSpin(d.sample, d.product); });
  es.addEventListener('raffle-winner', e=>{ const d = JSON.parse(e.data); revealWinner(d.winners, d.product, true); });
  es.addEventListener('raffle-step-winner', e=>{ const d=JSON.parse(e.data); revealWinner(d.winners,d.product,true,{currentIndex:d.currentIndex,targetCount:d.targetCount}); });
  es.addEventListener('raffle-final', e=>{ const d=JSON.parse(e.data); showFinalWinners(d.winners,d.product); });
  es.onerror = ()=> setStatus('연결이 잠시 끊겼습니다 · 자동 재연결 중');
}
