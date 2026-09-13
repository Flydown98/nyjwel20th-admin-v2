
const $=s=>document.querySelector(s);
const qs=new URLSearchParams(location.search);
const key=qs.get('k')||'';

function seatParts(code){
  const m=String(code||'').toUpperCase().match(/^([A-Y])([LR])-(\d{2})$/);
  return m?{row:m[1],side:m[2],n:Number(m[3])}:null;
}
function renderMap(mySeat,layout){
  const mine=seatParts(mySeat);
  const rows=[...new Set((layout||[]).map(x=>String(x.row||'').toUpperCase()).filter(Boolean))].sort();
  const map=$('#seatMap');
  if(!rows.length){map.innerHTML='<p style="color:white;text-align:center">좌석 배치정보를 불러올 수 없습니다.</p>';return}
  map.innerHTML=rows.map(row=>{
    const rowSeats=(layout||[]).filter(x=>String(x.row).toUpperCase()===row);
    const side=(lr)=>{
      const nums=rowSeats.filter(x=>String(x.side).toUpperCase()===lr).map(x=>Number(x.number)).sort((a,b)=>a-b);
      if(!nums.length)return '<span class="side empty-side"></span>';
      const min=Math.min(...nums),max=Math.max(...nums),set=new Set(nums);
      return `<span class="side dynamic-side" style="grid-template-columns:repeat(${max-min+1},minmax(5px,1fr))">${Array.from({length:max-min+1},(_,i)=>{
        const n=min+i;if(!set.has(n))return '<i class="pub-seat gap"></i>';
        const hit=mine&&mine.row===row&&mine.side===lr&&mine.n===n;
        return `<i class="pub-seat${hit?' mine':''}" title="${row}${lr}-${String(n).padStart(2,'0')}"></i>`;
      }).join('')}</span>`;
    };
    return `<div class="seat-row-public">
      <span class="row-label">${row}</span>
      ${side('L')}
      <span class="aisle"></span>
      ${side('R')}
      <span class="row-label">${row}</span>
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
      ? `${p?p.row+'열 · '+(p.side==='L'?'왼쪽':'오른쪽')+' 구역 · '+p.n+'번':''} 좌석을 아래 빨간 표시로 확인해주세요.`
      :'현재 지정 좌석이 없습니다. 현장 스태프 안내를 따라주세요.';
    renderMap(d.seat,layout.rows||[]);
  }catch(e){
    $('#seatCard').classList.add('error-card');$('#mySeat').textContent='안내 확인 필요';$('#myName').textContent='';$('#guideMsg').textContent=e.message;renderMap('',[]);
  }
}
load();
