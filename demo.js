
const $=s=>document.querySelector(s);
document.querySelectorAll('[data-demo-tab]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-demo-tab]').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('.demo-view').forEach(v=>v.classList.toggle('active',v.id===`demo-${b.dataset.demoTab}`));
});

$('#demoIndividual').onclick=()=>{
  const r=$('#demoIndividualResult');r.className='result success';r.innerHTML='<strong>접수 완료</strong><br>좌석 GL-07 · 기념품 지급완료 · 좌석안내 문자 발송요청';
  $('#dActual').textContent='125';$('#dArrived').textContent='122';
};

let gc=6;
function grender(){$('#gCount').textContent=gc}
$('#gMinus').onclick=()=>{gc=Math.max(1,gc-1);grender()};
$('#gPlus').onclick=()=>{gc=Math.min(8,gc+1);grender()};
$('#demoGroupCheck').onclick=()=>{
  const extra=Math.max(0,gc-6),regular=Math.min(gc,6);
  const r=$('#demoGroupResult');r.className='result success';
  r.innerHTML=`<strong>행복나눔센터 접수 완료</strong><br>등록자 ${regular}명 좌석배정${extra?` · 추가 ${extra}명 스탠딩`:''}<br>기념품 ${gc}명 지급완료`;
};

function seatMap(){
  const rows='ABCDEFGHIJKLMNO'.split('');
  $('#demoSeatMap').innerHTML=rows.map(row=>{
    const side=lr=>Array.from({length:10},(_,i)=>`<i class="seat${row==='G'&&lr==='L'&&i===6?' mine':''}"></i>`).join('');
    return `<div class="seatrow"><b>${row}</b><span class="side">${side('L')}</span><span class="aisle"></span><span class="side">${side('R')}</span><b>${row}</b></div>`;
  }).join('');
}
seatMap();

$('#demoRetry').onclick=()=>{
  const s=$('#demoSmsStatus');s.className='result success';s.innerHTML='<strong>재발송 성공</strong><br>참가자 상세에서 바로 재발송 결과를 확인할 수 있습니다.';
};

const names=['김하늘 (G-07)','박서준 (H-03)','이유진 (J-11)','최민수 (K-04)','정다은 (L-09)'];
let running=false,stop=false,idx=0;
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function startRaffle(){
  if(running)return;running=true;stop=false;$('#demoRaffleStatus').textContent='이름이 돌아가는 중입니다... SPACE로 멈추세요.';
  while(!stop){$('#demoRaffleName').textContent=names[idx++%names.length];await sleep(65)}
  const winner=names[Math.floor(Math.random()*names.length)];
  for(const ms of [120,210,360,560]){$('#demoRaffleName').textContent=names[idx++%names.length];await sleep(ms)}
  $('#demoRaffleName').textContent=winner;$('#demoRaffleStatus').textContent='🎉 당첨!';running=false;
}
function stopRaffle(){if(running)stop=true}
$('#demoRaffleStart').onclick=startRaffle;$('#demoRaffleStop').onclick=stopRaffle;
document.addEventListener('keydown',e=>{if(e.code==='Space'&&running){e.preventDefault();stopRaffle()}});
