'use strict';

const TOKEN_KEY='nyj20_v2_token';
let token=localStorage.getItem(TOKEN_KEY)||'';
let currentImportId='';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const yesNo=v=>v?'<span class="yes">예</span>':'<span class="no">아니오</span>';

function toast(msg,ms=3500){
  const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add('hidden'),ms);
}
function output(v){$('#output').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);}

async function api(path,options={}){
  const headers={...(options.headers||{})};
  if(options.body && !(options.body instanceof FormData) && !headers['Content-Type'])headers['Content-Type']='application/json';
  if(token)headers.Authorization=`Bearer ${token}`;
  const res=await fetch(path,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}

async function health(){
  const d=await api('/api/health');
  $('#statusBadge').textContent=`연결됨 · v${d.version}`;
  $('#statusBadge').classList.add('ok');
  return d;
}

async function dashboard(){
  const d=await api('/api/bootstrap');
  const s=d.summary||{};
  $('#statParticipants').textContent=s.participants||0;
  $('#statActive').textContent=s.active||0;
  $('#statArrived').textContent=s.arrived||0;
  $('#statSeats').textContent=s.seats||0;
  $('#statAssignedSeats').textContent=s.assignedSeats||0;
  $('#statGroups').textContent=s.groups||0;
  $('#statGifts').textContent=s.giftsReceived||0;
  $('#statSms').textContent=s.smsPending||0;
  const m=d.meta||{};
  $('#serverInfo').innerHTML=`
    <div><span>버전</span><strong>${esc(m.version||'-')}</strong></div>
    <div><span>최근 변경</span><strong>${esc(m.updatedAt||'-')}</strong></div>
    <div><span>엑셀 가져오기</span><strong>${esc(m.importedAt||'아직 없음')}</strong></div>
    <div><span>가져온 파일</span><strong>${esc(m.importSource||'-')}</strong></div>
    <div><span>행사명</span><strong>${esc(d.settings?.eventName||'-')}</strong></div>
    <div><span>행사일시</span><strong>${esc(d.settings?.eventDate||'-')}</strong></div>`;
  return d;
}

async function refreshCore(){
  try{
    await health();await dashboard();
    $('#loginOverlay').classList.add('hidden');
  }catch(e){
    if(/로그인/.test(e.message)){token='';localStorage.removeItem(TOKEN_KEY);$('#loginOverlay').classList.remove('hidden');}
    toast(e.message,5000);
  }
}

function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  if(name==='participants')loadParticipants();
  if(name==='seats')loadSeats();
  if(name==='dashboard')dashboard().catch(e=>toast(e.message));
}

async function loadParticipants(){
  const q=$('#participantSearch').value.trim();
  const st=$('#participantStatus').value;
  try{
    const d=await api(`/api/participants?q=${encodeURIComponent(q)}&status=${encodeURIComponent(st)}&limit=300`);
    $('#participantCount').textContent=`검색 결과 ${d.total}명 · 화면 최대 300명`;
    $('#participantRows').innerHTML=d.rows.length?d.rows.map(p=>`
      <tr>
        <td>${esc(p.receptionNo)}</td>
        <td><strong>${esc(p.name||'-')}</strong><small>${esc(p.id)}</small></td>
        <td>${esc(p.phone||'-')}</td>
        <td>${esc(p.organization||'-')}</td>
        <td>${esc(p.requestedCount||1)}명</td>
        <td>${esc(p.seat||'미배정')}</td>
        <td>${p.wheelchairUser?'♿ ':''}${p.disabledPerson?'장애인 당사자 ':''}${p.usesCenter?'복지관 이용':''}</td>
        <td>${p.arrived?'<span class="yes">도착</span>':(p.participationStatus==='미참여'||!p.active?'<span class="no">미참여</span>':'미도착')}</td>
      </tr>`).join(''):'<tr><td colspan="8">표시할 참가자가 없습니다.</td></tr>';
  }catch(e){toast(e.message,5000);}
}

async function loadSeats(){
  const q=$('#seatSearch').value.trim();
  try{
    const d=await api(`/api/seats?q=${encodeURIComponent(q)}&limit=600`);
    $('#seatCount').textContent=`검색 결과 ${d.total}석`;
    $('#seatRows').innerHTML=d.rows.length?d.rows.map(s=>`
      <tr>
        <td><strong>${esc(s.code)}</strong></td><td>${esc(s.row)}</td><td>${esc(s.side)}</td><td>${esc(s.number)}</td>
        <td>${esc(s.zone)}</td><td>${yesNo(s.autoAssignable)}</td><td>${yesNo(s.wheelchairAssignable)}</td><td>${yesNo(s.enabled)}</td><td>${esc(s.note||'')}</td>
      </tr>`).join(''):'<tr><td colspan="9">표시할 좌석이 없습니다.</td></tr>';
  }catch(e){toast(e.message,5000);}
}

function renderImportPreview(d){
  currentImportId=d.importId;
  $('#importPreviewCard').classList.remove('hidden');
  $('#importFileName').textContent=`${d.fileName} · 시트: ${d.sheets.join(', ')}`;
  const s=d.summary;
  const cards=[
    ['참가자',s.participants],['좌석',s.seats],['설정',s.settings],['단체그룹',s.groups],['접수로그',s.checkins],
    ['기념품 기록',s.gifts],['문자기록',s.smsQueue],['행운추첨',s.raffles],['룰렛상품',s.rouletteProducts],['룰렛기록',s.rouletteHistory]
  ];
  $('#importSummary').innerHTML=cards.map(([k,v])=>`<article class="card stat"><span>${esc(k)}</span><strong>${esc(v)}</strong></article>`).join('');
  const warnings=[];
  if(s.duplicateQr)warnings.push(`중복 QR 고유코드 ${s.duplicateQr}건`);
  if(s.blankPhones)warnings.push(`연락처 공란 ${s.blankPhones}명`);
  if(s.suspiciousPhones)warnings.push(`앞자리 형식 확인이 필요한 연락처 ${s.suspiciousPhones}명`);
  $('#importWarnings').innerHTML=warnings.length?`<div class="warning"><strong>확인 필요</strong><br>${warnings.map(esc).join(' · ')}</div>`:'<div class="notice">기본 형식 검사에서 큰 문제를 찾지 못했습니다.</div>';

  $('#previewParticipants').innerHTML=d.sampleParticipants.map(p=>`
    <tr><td>${esc(p.receptionNo)}</td><td>${esc(p.name)}</td><td>${esc(p.phone)}</td><td>${esc(p.organization)}</td><td>${esc(p.seat||'미배정')}</td><td>${esc(p.participationStatus)}</td></tr>`).join('');
  $('#previewSeats').innerHTML=d.sampleSeats.map(s=>`
    <tr><td>${esc(s.code)}</td><td>${esc(s.zone)}</td><td>${yesNo(s.autoAssignable)}</td><td>${yesNo(s.wheelchairAssignable)}</td><td>${yesNo(s.enabled)}</td></tr>`).join('');
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('#loginMessage').textContent='';
  try{
    const d=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});
    token=d.token;localStorage.setItem(TOKEN_KEY,token);await refreshCore();
  }catch(e){$('#loginMessage').textContent=e.message;}
});
$('#logoutBtn').addEventListener('click',()=>{token='';localStorage.removeItem(TOKEN_KEY);$('#loginOverlay').classList.remove('hidden');});
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$('#refreshTopBtn').addEventListener('click',refreshCore);
$('#refreshDashboardBtn').addEventListener('click',()=>dashboard().then(()=>toast('현황을 갱신했습니다.')).catch(e=>toast(e.message)));
$('#reloadParticipantsBtn').addEventListener('click',loadParticipants);
$('#participantSearch').addEventListener('input',()=>{clearTimeout(loadParticipants.timer);loadParticipants.timer=setTimeout(loadParticipants,250);});
$('#participantStatus').addEventListener('change',loadParticipants);
$('#reloadSeatsBtn').addEventListener('click',loadSeats);
$('#seatSearch').addEventListener('input',()=>{clearTimeout(loadSeats.timer);loadSeats.timer=setTimeout(loadSeats,250);});

$('#previewImportBtn').addEventListener('click',async()=>{
  const file=$('#xlsxFile').files?.[0];
  if(!file)return toast('XLSX 파일을 먼저 선택해 주세요.');
  const btn=$('#previewImportBtn');btn.disabled=true;
  $('#importProgress').textContent='엑셀을 읽고 있습니다...';$('#importProgress').classList.remove('hidden');
  try{
    const fd=new FormData();fd.append('file',file);
    const d=await api('/api/import/xlsx/preview',{method:'POST',body:fd});
    renderImportPreview(d);
    toast(`미리보기 완료 · 참가자 ${d.summary.participants}명`);
  }catch(e){toast(e.message,6000);}
  finally{btn.disabled=false;$('#importProgress').classList.add('hidden');}
});

$('#confirmImportBtn').addEventListener('click',async()=>{
  if(!currentImportId)return toast('먼저 엑셀 미리보기를 실행해 주세요.');
  if(!confirm('현재 서버의 참가자·좌석·기존 행사 데이터를 이 엑셀 내용으로 교체할까요?\\n\\n교체 직전에 자동 백업을 생성합니다.'))return;
  const btn=$('#confirmImportBtn');btn.disabled=true;
  try{
    const d=await api('/api/import/xlsx/confirm',{method:'POST',body:JSON.stringify({importId:currentImportId})});
    currentImportId='';
    toast(`가져오기 완료 · 참가자 ${d.summary.participants}명 · 좌석 ${d.summary.seats}석`,7000);
    await dashboard();
    switchView('participants');
  }catch(e){toast(e.message,7000);}
  finally{btn.disabled=false;}
});

$('#backupBtn').addEventListener('click',async()=>{
  try{const d=await api('/api/backup',{method:'POST',body:'{}'});output(d);toast('백업을 만들었습니다.');}
  catch(e){output(`ERROR: ${e.message}`);}
});
$('#downloadBtn').addEventListener('click',async()=>{
  try{
    const res=await fetch('/api/backup/download',{headers:token?{Authorization:`Bearer ${token}`}:{}}); 
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||`HTTP ${res.status}`);}
    const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);
  }catch(e){output(`ERROR: ${e.message}`);}
});

refreshCore();
setInterval(()=>{if(token && !document.hidden)dashboard().catch(()=>{});},15000);
