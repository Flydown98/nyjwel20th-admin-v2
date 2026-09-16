const $=s=>document.querySelector(s),key=new URLSearchParams(location.search).get('k')||'';
function parseSeat(raw){
  raw=String(raw||'').toUpperCase();
  let m=raw.match(/^([A-F])(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2])};
  m=raw.match(/^([G-T])(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2])};
  m=raw.match(/^([A-F])([LR])-(\d{1,2})$/);if(m)return{row:m[1],n:m[2]==='L'?Number(m[3]):Number(m[3])+8};
  m=raw.match(/^([G-T])B-(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2])};
  return null;
}
function dot(row,n,mine,exists=true){return `<i class="seat${exists?'':' gap'}${mine?.row===row&&mine?.n===n?' mine':''}" title="${row}${n}"></i>`}
function render(mySeat,layout){
  const mineRaw=String(mySeat||'').toUpperCase(),mine=parseSeat(mySeat),byRow=new Map();
  (layout||[]).forEach(s=>{const r=String(s.row||'').toUpperCase();if(!byRow.has(r))byRow.set(r,[]);byRow.get(r).push(s)});
  const front='ABCDEF'.split('').map(row=>{const nums=new Set((byRow.get(row)||[]).map(s=>Number(s.displayNumber||s.number)));return `<div class="front-row"><b class="row-label">${row}</b><div class="eight">${Array.from({length:8},(_,i)=>dot(row,i+1,mine,nums.has(i+1))).join('')}</div><span class="runway"></span><div class="eight">${Array.from({length:8},(_,i)=>dot(row,i+9,mine,nums.has(i+9))).join('')}</div></div>`}).join('');
  const extDot=(seat,label)=>seat?`<i class="seat ext-seat${String(seat.code).toUpperCase()===mineRaw?' mine':''}" title="${seat.label||label}"><small>${label}</small></i>`:'<i class="seat gap"></i>';
  const main='GHIJKLMNOPQRST'.split('').map(row=>{
    const all=byRow.get(row)||[],core=new Map(all.filter(s=>String(s.side).toUpperCase()==='B').map(s=>[Number(s.number),s]));
    const left=all.filter(s=>String(s.side).toUpperCase()==='XL'),right=all.filter(s=>String(s.side).toUpperCase()==='XR');
    const l2=left.find(s=>Number(s.number)===2),l1=left.find(s=>Number(s.number)===1),r1=right.find(s=>Number(s.number)===1),r2=right.find(s=>Number(s.number)===2);
    return `<div class="rear-row rear-24"><b class="row-label">${row}</b><div class="rear-seat-strip">${extDot(l2,'L2')}${extDot(l1,'L1')}${Array.from({length:20},(_,i)=>dot(row,i+1,mine,core.has(i+1))).join('')}${extDot(r1,'R1')}${extDot(r2,'R2')}</div></div>`;
  }).join('');
  $('#seatMap').innerHTML=front+`<div class="rear-start">A~L 기존 좌석 · M~T 양쪽 확장 · 총 400석</div>`+main;
}
async function load(){
  try{
    const [a,b]=await Promise.all([fetch(`/api/public/seat-guide?k=${encodeURIComponent(key)}`,{cache:'no-store'}),fetch('/api/public/seat-layout',{cache:'no-store'})]);
    const d=await a.json(),l=await b.json();if(!a.ok||!d.ok)throw new Error(d.error||'좌석 정보를 확인할 수 없습니다.');
    $('#mySeat').textContent=d.hasAssignedSeat?d.seat:'스탠딩석';$('#myName').textContent=d.name?d.name+'님':'';
    const p=d.hasAssignedSeat?parseSeat(d.seat):null;
    $('#guideMsg').textContent=d.hasAssignedSeat?(p?`${p.row}열 ${p.n}번 좌석입니다.`:`${d.seat} 좌석입니다.`):'지정 좌석 없이 스탠딩석으로 안내됩니다. 현장 스태프 안내를 따라주세요.';
    render(d.hasAssignedSeat?d.seat:'',l.rows||[]);
  }catch(e){$('#mySeat').textContent='안내 확인 필요';$('#guideMsg').textContent=e.message;render('',[])}
}
load();