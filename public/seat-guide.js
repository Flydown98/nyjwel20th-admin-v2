
const $=s=>document.querySelector(s);
const qs=new URLSearchParams(location.search);
const key=qs.get('k')||'';

function seatParts(code){
  const m=String(code||'').toUpperCase().match(/^([A-Y])([LR])-(\d{2})$/);
  return m?{row:m[1],side:m[2],n:Number(m[3])}:null;
}
function renderMap(mySeat){
  const mine=seatParts(mySeat);
  const rows='ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
  const map=$('#seatMap');
  map.innerHTML=rows.map(row=>{
    const side=(lr)=>Array.from({length:10},(_,i)=>{
      const n=i+1,hit=mine&&mine.row===row&&mine.side===lr&&mine.n===n;
      return `<i class="pub-seat${hit?' mine':''}" title="${row}${lr}-${String(n).padStart(2,'0')}"></i>`;
    }).join('');
    return `<div class="seat-row-public">
      <span class="row-label">${row}</span>
      <span class="side">${side('L')}</span>
      <span class="aisle"></span>
      <span class="side">${side('R')}</span>
      <span class="row-label">${row}</span>
    </div>`;
  }).join('');
}
async function load(){
  try{
    const r=await fetch(`/api/public/seat-guide?k=${encodeURIComponent(key)}`,{cache:'no-store'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok)throw new Error(d.error||'좌석 정보를 확인할 수 없습니다.');
    $('#mySeat').textContent=d.seat||'스탠딩';
    $('#myName').textContent=d.name?`${d.name}님`:'';
    $('#guideMsg').textContent=d.seat?'아래 배치도에서 빨간색으로 표시된 좌석을 확인해주세요.':'현재 지정 좌석이 없습니다. 현장 스태프 안내를 따라주세요.';
    renderMap(d.seat);
  }catch(e){
    $('#seatCard').classList.add('error-card');
    $('#mySeat').textContent='안내 확인 필요';
    $('#myName').textContent='';
    $('#guideMsg').textContent=e.message;
    renderMap('');
  }
}
load();
