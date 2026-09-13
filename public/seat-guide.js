
const $=s=>document.querySelector(s);
const qs=new URLSearchParams(location.search);
const key=qs.get('k')||'';

function seatParts(code){
  const raw=String(code||'').toUpperCase();
  let m=raw.match(/^([A-Y])(\d{1,2})$/);
  if(m)return {row:m[1],n:Number(m[2])};
  m=raw.match(/^([A-Y])([LR])-(\d{1,2})$/);
  if(m)return {row:m[1],n:m[2]==='L'?Number(m[3]):Number(m[3])+10};
  return null;
}
function displaySeatFromLayout(s){
  const n=String(s.side).toUpperCase()==='L'?Number(s.number):Number(s.number)+10;
  return `${String(s.row).toUpperCase()}${n}`;
}
function renderMap(mySeat,layout){
  const mine=seatParts(mySeat);
  const rows=[...new Set((layout||[]).map(x=>String(x.row||'').toUpperCase()).filter(Boolean))].sort();
  const map=$('#seatMap');
  if(!rows.length){map.innerHTML='<p style="color:white;text-align:center">좌석 배치정보를 불러올 수 없습니다.</p>';return}

  const header=`<div class="public-number-header"><span></span>${Array.from({length:20},(_,i)=>`<b class="${i===10?'aisle-start':''}">${i+1}</b>`).join('')}</div>`;
  map.innerHTML=header+rows.map(row=>{
    const seats=(layout||[]).filter(x=>String(x.row).toUpperCase()===row);
    const byNo=new Map(seats.map(x=>[(String(x.side).toUpperCase()==='L'?Number(x.number):Number(x.number)+10),x]));
    return `<div class="seat-row-public twenty">
      <span class="row-label">${row}</span>
      <span class="public-twenty">${Array.from({length:20},(_,i)=>{
        const n=i+1,s=byNo.get(n);
        if(!s)return '<i class="pub-seat gap"></i>';
        const hit=mine&&mine.row===row&&mine.n===n;
        return `<i class="pub-seat${hit?' mine':''}${n===11?' aisle-start':''}" title="${row}${n}"></i>`;
      }).join('')}</span>
    </div>`;
  }).join('');
}
async function load(){
  try{
    const [r,l]=await Promise.all([
      fetch(`/api/public/seat-guide?k=${encodeURIComponent(key)}`,{cache:'no-store'}),
      fetch('/api/public/seat-layout',{cache:'no-store'})
    ]);
    const d=await r.json().catch(()=>({})),layout=await l.json().catch(()=>({rows:[]}));
    if(!r.ok||!d.ok)throw new Error(d.error||'좌석 정보를 확인할 수 없습니다.');
    $('#mySeat').textContent=d.seat||'스탠딩';
    $('#myName').textContent=d.name?`${d.name}님`:'';
    const p=seatParts(d.seat);
    $('#guideMsg').textContent=d.seat
      ? `${p?p.row+'열 · '+p.n+'번':''} 좌석을 아래 빨간 표시로 확인해주세요.`
      :'현재 지정 좌석이 없습니다. 현장 스태프 안내를 따라주세요.';
    renderMap(d.seat,layout.rows||[]);
  }catch(e){
    $('#seatCard').classList.add('error-card');$('#mySeat').textContent='안내 확인 필요';$('#myName').textContent='';$('#guideMsg').textContent=e.message;renderMap('',[]);
  }
}
load();
