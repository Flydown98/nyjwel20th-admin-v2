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
  const mine=parseSeat(mySeat),byRow=new Map();(layout||[]).forEach(s=>{const r=String(s.row||'').toUpperCase();if(!byRow.has(r))byRow.set(r,[]);byRow.get(r).push(s)});
  const front='ABCDEF'.split('').map(row=>{const nums=new Set((byRow.get(row)||[]).map(s=>Number(s.displayNumber||s.number)));return `<div class="front-row"><b class="row-label">${row}</b><div class="eight">${Array.from({length:8},(_,i)=>dot(row,i+1,mine,nums.has(i+1))).join('')}</div><span class="runway"></span><div class="eight">${Array.from({length:8},(_,i)=>dot(row,i+9,mine,nums.has(i+9))).join('')}</div></div>`}).join('');
  const head=`<div class="number-head"><span></span>${Array.from({length:20},(_,i)=>`<b>${i+1}</b>`).join('')}</div>`;
  const main='GHIJKLMNOPQRST'.split('').map(row=>{const nums=new Set((byRow.get(row)||[]).map(s=>Number(s.displayNumber||s.number)));return `<div class="rear-row"><b class="row-label">${row}</b><div class="twenty">${Array.from({length:20},(_,i)=>dot(row,i+1,mine,nums.has(i+1))).join('')}</div></div>`}).join('');
  $('#seatMap').innerHTML=front+`<div class="rear-start">G~T · 20석 × 14줄 · 양끝 장애인석</div>`+head+main;
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