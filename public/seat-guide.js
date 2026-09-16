const $=s=>document.querySelector(s),key=new URLSearchParams(location.search).get('k')||'';
function parseSeat(raw){
  raw=String(raw||'').toUpperCase();
  let m=raw.match(/^([A-L])(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2]),side:''};
  m=raw.match(/^([A-L])([LR])-(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[3]),side:m[2],display:m[2]==='L'?Number(m[3]):Number(m[3])+8};
  m=raw.match(/^([M-T])B-(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2]),side:'B',display:Number(m[2])};
  m=raw.match(/^([M-T])(\d{1,2})$/);if(m)return{row:m[1],n:Number(m[2]),side:'B',display:Number(m[2])};
  return null;
}
function mineFor(mines,seat){return mines.find(x=>x?.rawSeat===seat?.code || (x?.row===seat?.row&&x?.side===seat?.side&&x?.n===Number(seat?.number)))}
function dotSeat(seat,mines,label){
  const mine=seat?mineFor(mines,seat):null;
  const title=mine?.name?`${mine.name} · ${seat?.label||label}`:(seat?.label||label||'');
  return `<i class="seat${seat?'':' gap'}${mine?' mine':''}" title="${String(title).replace(/"/g,'&quot;')}"></i>`;
}
function render(mySeats,layout){
  const mines=(Array.isArray(mySeats)?mySeats:[mySeats]).map(x=>{
    if(typeof x==='string'){const p=parseSeat(x);return p?{...p,rawSeat:String(x).toUpperCase(),name:''}:null}
    const raw=String(x?.rawSeat||x?.seat||'').toUpperCase(),p=parseSeat(raw);return p?{...p,rawSeat:raw,name:String(x?.name||'')}:null;
  }).filter(Boolean);
  const rows=Array.isArray(layout)?layout:[],byRow=new Map();rows.forEach(s=>{const r=String(s.row||'').toUpperCase();if(!byRow.has(r))byRow.set(r,[]);byRow.get(r).push(s)});
  const hall=rows.some(s=>s.staffOnly)||rows.some(s=>s.row==='STAFF');
  if(hall){
    const mapSide=(row,side,count)=>{const m=new Map((byRow.get(row)||[]).filter(s=>s.side===side).map(s=>[Number(s.number),s]));return Array.from({length:count},(_,i)=>dotSeat(m.get(i+1),mines,i+1)).join('')};
    const af='ABCDEF'.split('').map(row=>`<div class="front-row"><b class="row-label">${row}</b><div class="eight">${mapSide(row,'L',8)}</div><span class="runway"></span><div class="eight">${mapSide(row,'R',8)}</div></div>`).join('');
    const gl='GHIJKL'.split('').map(row=>`<div class="front-row hall-wide-row"><b class="row-label">${row}</b><div class="fifteen">${mapSide(row,'L',15)}</div><span class="runway"></span><div class="fifteen">${mapSide(row,'R',15)}</div></div>`).join('');
    const mn='MN'.split('').map(row=>{const m=new Map((byRow.get(row)||[]).filter(s=>s.side==='B').map(s=>[Number(s.number),s]));return `<div class="front-row hall-wide-row"><b class="row-label">${row}</b><div class="fifteen">${Array.from({length:15},(_,i)=>dotSeat(m.get(i+1),mines,i+1)).join('')}</div><span class="runway"></span><div class="fifteen">${Array.from({length:15},(_,i)=>dotSeat(m.get(i+16),mines,i+16)).join('')}</div></div>`}).join('');
    $('#seatMap').innerHTML=af+`<div class="rear-start">A~F 기존 좌석 유지</div>`+gl+mn+`<div class="rear-start">G~N 참가자석 · 실제 배정 336석 / 외곽 스태프 자유석 64석은 참가자 안내에서 제외</div>`;
    return;
  }
  const front='ABCDEFGHIJKL'.split('').map(row=>{const nums=new Map((byRow.get(row)||[]).map(s=>[Number(s.displayNumber||s.number),s]));return `<div class="front-row"><b class="row-label">${row}</b><div class="eight">${Array.from({length:8},(_,i)=>dotSeat(nums.get(i+1),mines,i+1)).join('')}</div><span class="runway"></span><div class="eight">${Array.from({length:8},(_,i)=>dotSeat(nums.get(i+9),mines,i+9)).join('')}</div></div>`}).join('');
  const head=`<div class="number-head number-head-26"><span></span>${Array.from({length:26},(_,i)=>`<b>${i+1}</b>`).join('')}</div>`;
  const main='MNOPQRST'.split('').map(row=>{const m=new Map((byRow.get(row)||[]).map(s=>[Number(s.displayNumber||s.number),s]));return `<div class="rear-row"><b class="row-label">${row}</b><div class="twentysix">${Array.from({length:26},(_,i)=>dotSeat(m.get(i+1),mines,i+1)).join('')}</div></div>`}).join('');
  $('#seatMap').innerHTML=front+`<div class="rear-start">구 좌석배치</div>`+head+main;
}
async function load(){
  try{
    const [a,b]=await Promise.all([fetch(`/api/public/seat-guide?k=${encodeURIComponent(key)}`,{cache:'no-store'}),fetch('/api/public/seat-layout',{cache:'no-store'})]);
    const d=await a.json(),l=await b.json();if(!a.ok||!d.ok)throw new Error(d.error||'좌석 정보를 확인할 수 없습니다.');
    const groupSeats=Array.isArray(d.seats)?d.seats.filter(x=>x.rawSeat):[];
    if(d.group&&groupSeats.length){$('#mySeat').textContent=`${groupSeats.length}석`;$('#myName').textContent=d.groupName?`${d.groupName} · ${d.name}님`:d.name?d.name+'님':'';$('#guideMsg').textContent=`함께 접수된 좌석 ${groupSeats.length}자리를 이름과 함께 표시했습니다.`;const list=$('#groupSeatNames');list.classList.remove('hidden');list.innerHTML=`<div class="group-seat-title">이름별 좌석</div><div class="group-seat-chips">${groupSeats.map(x=>`<span><b>${String(x.name||'')}</b><em>${String(x.seat||'')}</em></span>`).join('')}</div>`;render(groupSeats,l.rows||[])}
    else{$('#groupSeatNames')?.classList.add('hidden');$('#mySeat').textContent=d.hasAssignedSeat?d.seat:'스탠딩석';$('#myName').textContent=d.name?d.name+'님':'';$('#guideMsg').textContent=d.hasAssignedSeat?`${d.seat} 좌석입니다.`:'지정 좌석 없이 스탠딩석으로 안내됩니다.';render(d.hasAssignedSeat?[{rawSeat:d.rawSeat||d.seat,name:d.name}]:[],l.rows||[])}
  }catch(e){$('#mySeat').textContent='안내 확인 필요';$('#guideMsg').textContent=e.message;render([],[])}
}
load();
