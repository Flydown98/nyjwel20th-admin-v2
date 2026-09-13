
const $=s=>document.querySelector(s);
const key=new URLSearchParams(location.search).get('k')||'';
const H=130;
let spinAnim=null,currentSamples=[];

function item(p){return `<div class="item"><span>${escapeHtml(p.name||'행운의 주인공')}</span>${p.seat?`<small>(${escapeHtml(p.seat)})</small>`:''}</div>`}
function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
function baseY(){return ($('#reel').clientHeight||420)/2-H/2}
function startSpin(samples,product){
  currentSamples=samples?.length?samples:[{name:'행운의 주인공',seat:''}];
  $('#stage').classList.add('running');$('#winner').classList.add('hidden');
  $('#prize').textContent=product?.name||'행운상품';$('#status').textContent='행운의 주인공을 찾고 있습니다';
  const seq=[];for(let r=0;r<5;r++)currentSamples.forEach(x=>seq.push(x));
  $('#track').innerHTML=seq.map(item).join('');
  const loop=currentSamples.length*H,base=baseY();$('#track').style.transform=`translateY(${base}px)`;
  spinAnim=$('#track').animate([{transform:`translateY(${base}px)`},{transform:`translateY(${base-loop}px)`}],{duration:Math.max(1300,currentSamples.length*45),iterations:Infinity,easing:'linear'});
}
async function stopToWinner(winners,product){
  spinAnim?.cancel();
  const winner=winners?.[0]||{participantName:'당첨자',seat:''};
  const target={name:winner.participantName,seat:winner.seat||''};
  const seq=[];for(let i=0;i<24;i++)seq.push(currentSamples[Math.floor(Math.random()*currentSamples.length)]||target);seq.push(target);
  $('#track').innerHTML=seq.map(item).join('');
  const base=baseY(),end=base-(seq.length-1)*H;$('#track').style.transform=`translateY(${base}px)`;
  const a=$('#track').animate([{transform:`translateY(${base}px)`},{transform:`translateY(${end}px)`}],{duration:3000,easing:'cubic-bezier(.08,.68,.12,1)',fill:'forwards'});
  await a.finished.catch(()=>{});$('#track').style.transform=`translateY(${end}px)`;
  $('#winnerName').textContent=winners.length===1?winner.participantName:`${winners.length}명 당첨`;
  $('#winnerSeat').textContent=winners.length===1?(winner.seat?`좌석 ${winner.seat}`:'좌석 미배정'):winners.map(w=>`${w.participantName}${w.seat?` (${w.seat})`:''}`).join(' · ');
  $('#winnerPrize').textContent=product?.name||'행운상품';
  $('#winner').classList.remove('hidden');particles();
}
function particles(){const b=$('#particles');b.innerHTML='';for(let i=0;i<90;i++){const e=document.createElement('i');e.style.left=Math.random()*100+'%';e.style.setProperty('--dur',(2.2+Math.random()*2.8)+'s');e.style.setProperty('--x',(Math.random()*320-160)+'px');e.style.setProperty('--r',(Math.random()*900-450)+'deg');e.style.animationDelay=(Math.random()*.6)+'s';b.appendChild(e)}setTimeout(()=>b.innerHTML='',5600)}
if(!key){$('#status').textContent='무대 화면 인증키가 없습니다.'}
else{
  const es=new EventSource(`/api/public/raffle-stage?k=${encodeURIComponent(key)}`);
  es.addEventListener('raffle-start',e=>{const d=JSON.parse(e.data);startSpin(d.sample,d.product)});
  es.addEventListener('raffle-winner',e=>{const d=JSON.parse(e.data);stopToWinner(d.winners,d.product)});
  es.onerror=()=>{$('#status').textContent='무대 화면 연결을 확인 중입니다...'};
}
