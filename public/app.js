'use strict';
const FRONTEND_VERSION='0.9.34';

function displaySeat(code){
  const raw=String(code||'').toUpperCase();
  let m=raw.match(/^([A-L])([LR])-(\d{1,2})$/);if(m)return `${m[1]}${m[2]==='L'?Number(m[3]):Number(m[3])+8}`;
  m=raw.match(/^([M-T])B-(\d{1,2})$/);if(m)return `${m[1]}${Number(m[2])}`;
  const n=raw.match(/^([A-T])(\d{1,2})$/);return n?`${n[1]}${Number(n[2])}`:raw;
}

const STATION_KEY='nyj20_station_name';

window.addEventListener('error',e=>{
  try{
    const b=document.querySelector('#jsErrorBanner');
    if(b){b.classList.remove('hidden');b.textContent=`화면 오류: ${e.message||'알 수 없는 오류'} · 새로고침 후 계속되면 이 문구를 알려주세요.`}
  }catch(_){}
});
window.addEventListener('unhandledrejection',e=>{
  try{
    const b=document.querySelector('#jsErrorBanner');
    if(b){b.classList.remove('hidden');b.textContent=`요청 오류: ${e.reason?.message||e.reason||'알 수 없는 오류'}`}
  }catch(_){}
});

const TOKEN_KEY='nyj20_v2_token',ROLE_KEY='nyj20_v2_role',CHECKIN_TEST_KEY='nyj20_checkin_test_mode';let stationName=localStorage.getItem(STATION_KEY)||'미설정';let token=localStorage.getItem(TOKEN_KEY)||'',currentRole=localStorage.getItem(ROLE_KEY)||'admin',appSettings={},scanner=null,scannerOn=false,scanBusy=false,checkinTestMode=localStorage.getItem(CHECKIN_TEST_KEY)==='1';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
function toast(m,ms=3500){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(toast.tm);toast.tm=setTimeout(()=>t.classList.add('hidden'),ms)}
async function api(p,o={}){const h={...(o.headers||{})};if(o.body&&!(o.body instanceof FormData)&&!h['Content-Type'])h['Content-Type']='application/json';if(token)h.Authorization=`Bearer ${token}`;const r=await fetch(p,{...o,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);Object.assign(e,d);throw e}return d}
function modal(html){$('#modal').innerHTML=html;$('#modalWrap').classList.remove('hidden')}
function closeModal(){clearTimeout(window.__autoCheckinTimer);$('#modalWrap').classList.add('hidden');$('#modal').innerHTML=''}
$('#modalWrap').addEventListener('click',e=>{if(e.target.id==='modalWrap')closeModal()});

async function refreshDashboard(){
  const d=await api('/api/bootstrap'),s=d.summary;appSettings=d.settings||{};currentRole=d.role||currentRole||'admin';localStorage.setItem(ROLE_KEY,currentRole);
  const put=(id,v)=>{const el=$(id);if(el)el.textContent=v??0};
  put('#sParticipants',s.participants);put('#sArrived',s.arrived);put('#sGifts',s.giftsReceived);
  put('#sActualAttendance',s.actualAttendance);put('#sRecent10',s.recent10);put('#sPending',s.pending);
  put('#sExtraStanding',s.extraStanding);put('#sVipPending',s.vipPending);put('#sMobilityPending',s.mobilityPending);
  put('#sUnassigned',s.unassigned);put('#sSmsFailed',s.smsFailed);put('#sFreeSeats',s.freeSeats);
  $('#statusBadge').textContent='연결됨 · v0.9.34';$('#statusBadge').classList.add('ok');$('#roleBadge').textContent=d.roleLabel||currentRole;
  $('#stationBtn').textContent=`접수대: ${stationName}`;
  const vb=$('#versionBadge');
  if(vb){const ok=d.version===FRONTEND_VERSION;vb.textContent=ok?`최신 ${FRONTEND_VERSION}`:`버전불일치 ${FRONTEND_VERSION}/${d.version}`;vb.classList.toggle('warning',!ok);if(!ok)toast('화면/서버 버전이 다릅니다. Ctrl+Shift+R로 새로고침하세요.',7000)}
  const mb=$('#systemModeBanner');
  if(mb){
    const parts=[];
    if(d.demoMode)parts.push('🧪 시연용 시스템 · 실제 SMS/외부백업 미사용');
    if(appSettings.eventOperationMode)parts.push('🔒 행사 운영 잠금 ON');
    if(parts.length){mb.innerHTML=parts.map(x=>`<strong>${esc(x)}</strong>`).join(' · ');mb.classList.remove('hidden')}else mb.classList.add('hidden');
  }
  $('#toggleOperationMode').textContent=appSettings.eventOperationMode?'행사 운영 잠금 해제':'행사 운영 잠금';
  $('#demoResetBtn')?.classList.toggle('hidden',!d.demoMode);
  applyRoleUI();
  refreshHealthStrip();
}
async function init(){try{await refreshDashboard();$('#loginOverlay').classList.add('hidden');connectLiveEvents()}catch(e){if(/로그인/.test(e.message)){token='';localStorage.removeItem(TOKEN_KEY);$('#loginOverlay').classList.remove('hidden')}}}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});token=d.token;currentRole=d.role||'admin';localStorage.setItem(TOKEN_KEY,token);localStorage.setItem(ROLE_KEY,currentRole);await init()}catch(e){$('#loginMessage').textContent=e.message}});
$('#logoutBtn').onclick=()=>{token='';currentRole='admin';localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(ROLE_KEY);if(eventSource)eventSource.close();$('#loginOverlay').classList.remove('hidden')};$('#topRefresh').onclick=()=>refreshDashboard().then(()=>toast('갱신했습니다.'));

function applyRoleUI(){
  const allowed={
    admin:['dashboard','checkin','participants','onsite','groups','seats','raffle','sms','logs','settings','data','backup'],
    reception:['dashboard','checkin','participants','onsite','groups','sms'],
    seat:['dashboard','participants','groups','seats'],
    raffle:['dashboard','raffle']
  }[currentRole]||['dashboard'];
  document.querySelectorAll('#tabs [data-view]').forEach(b=>b.classList.toggle('hidden',!allowed.includes(b.dataset.view)));
  const active=currentViewName?.();
  if(active&&!allowed.includes(active))view('dashboard');
}

function view(n){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${n}`));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===n));if(n==='participants')loadParticipants();if(n==='groups')loadGroups();if(n==='seats')loadSeats();if(n==='raffle')loadRaffle();if(n==='sms')loadSms();if(n==='logs')loadLogs();if(n==='settings')loadSettings();if(n==='backup'){loadBackupStatus();loadLocalBackups()}}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>view(b.dataset.view));

function renderCheckinTestMode(){
  const btn=$('#toggleCheckinTestMode'),banner=$('#checkinTestBanner');
  if(btn){btn.textContent=checkinTestMode?'테스트 모드 끄기':'테스트 모드 켜기';btn.classList.toggle('danger',checkinTestMode);btn.classList.toggle('primary',!checkinTestMode)}
  banner?.classList.toggle('hidden',!checkinTestMode);
}
$('#toggleCheckinTestMode')?.addEventListener('click',()=>{
  checkinTestMode=!checkinTestMode;localStorage.setItem(CHECKIN_TEST_KEY,checkinTestMode?'1':'0');renderCheckinTestMode();
  toast(checkinTestMode?'QR 테스트 모드 ON · 문자/실제 접수 처리 없음':'QR 테스트 모드 OFF · 실제 접수 모드',5000);
});
renderCheckinTestMode();

async function processCode(code){
  if(scanBusy)return;scanBusy=true;
  try{
    const d=await api('/api/checkin/lookup',{method:'POST',body:JSON.stringify({code})});
    if(d.participant?.arrived)showAlreadyCheckedIn(d.participant,d.group,d.checkinContext);
    else if(d.group)showGroupCheckin(d.participant,d.group);
    else showIndividualCheckin(d.participant);
  }catch(e){toast(e.message,5000)}
  finally{scanBusy=false}
}
function showAlreadyCheckedIn(p,g,ctx={}){
  const groupName=ctx?.groupName||g?.name||g?.organization||'';
  const checkedBy=ctx?.checkedByName||'';
  const memberInfo=g?`<div class="notice"><strong>${esc(groupName||'단체/동반 입장')}</strong><br>${checkedBy?`접수 QR 제시자: <b>${esc(checkedBy)}</b>`:'접수 QR 제시자 기록 없음'}<br>${g.type==='companion'?'동반신청 그룹':'단체관리 그룹'} · ${g.total||g.members?.length||0}명</div>`:'';
  const remaining=g?.members?.filter(x=>!x.arrived).length||0;
  modal(`<p class="eyebrow">CHECK-IN STATUS</p><h2>접수가 완료된 참가자입니다</h2><div class="successbox"><strong>${esc(p.name)}</strong><br>좌석 ${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩':'미배정'))}<br>${p.arrivedAt?`접수시각 ${esc(new Date(p.arrivedAt).toLocaleString('ko-KR'))}`:''}</div>${memberInfo}${remaining>0&&g?`<div class="warning">같은 그룹의 미접수 인원이 ${remaining}명 남아 있습니다.</div><button id="continueGroupCheckin" class="primary wide">같은 그룹 추가 접수</button>`:''}<button id="closeAlready" class="wide">확인</button>`);
  $('#closeAlready').onclick=closeModal;
  if($('#continueGroupCheckin'))$('#continueGroupCheckin').onclick=()=>showGroupCheckin(p,g);
}
function showIndividualCheckin(p){
  const testLabel=checkinTestMode?'<div class="warning"><strong>🧪 테스트 접수</strong><br>문자 발송 · 도착처리 · 기념품처리 · 좌석변경 없이 실제 QR 연결만 검증합니다.</div>':'';
  modal(`${testLabel}<p class="eyebrow">${checkinTestMode?'TEST QR CHECK-IN':'개인 QR 접수 확인'}</p><h2>${esc(p.name)}</h2><p>${esc(p.organization||'소속 없음')} · ${esc(p.phone||'연락처 없음')}</p><div class="notice">좌석 ${esc(displaySeat(p.seat)||'자동배정 예정')} · ${checkinTestMode?'실제 데이터 변경 없음':'내용을 확인한 뒤 접수완료를 눌러주세요.'}</div><div class="actions"><button data-now class="primary">${checkinTestMode?'테스트 접수 실행':'접수완료'}</button><button data-close>취소</button></div><div id="modalProgress" class="muted">${checkinTestMode?'테스트 준비 중...':'접수대 확인 대기 중'}</div>`);
  let done=false;
  const run=async()=>{if(done)return;done=true;clearTimeout(window.__autoCheckinTimer);try{
    const endpoint=checkinTestMode?'/api/checkin/test-individual':'/api/checkin/individual';
    const r=await api(endpoint,{method:'POST',body:JSON.stringify({code:p.id,station:stationName})});
    if(checkinTestMode){
      $('#modalProgress').innerHTML=`<div class="successbox"><strong>테스트 성공 · ${esc(r.participant.name)}</strong><br>QR 인식 정상 · 참가자 조회 정상 · 좌석 ${esc(r.participant.seat||'미배정')}<br><b>문자 발송 없음 · 실제 접수 상태 변경 없음</b></div>`;
      $('#recentResult').textContent=`[테스트 성공] ${r.participant.name} · ${r.participant.seat||'미배정'} · 실제접수 미처리`;
      done=false;return;
    }
    $('#modalProgress').innerHTML=`<div class="successbox"><strong>${esc(r.participant.name)} ${r.already?'이미 접수됨':'접수 완료'}</strong><br>좌석 ${esc(displaySeat(r.participant.seat)||'스탠딩')} · ${r.already?'최초 접수 상태 유지':'기념품 지급완료 · 좌석안내 문자 발송요청'}</div><button id="checkinDoneClose" class="primary wide" style="margin-top:12px">확인 후 다음 QR</button>`;$('#recentResult').textContent=`${r.participant.name} · ${displaySeat(r.participant.seat)||'스탠딩'} · ${r.already?'이미 접수됨':'접수완료'}`;refreshDashboard();$('#checkinDoneClose').onclick=closeModal
  }catch(e){done=false;$('#modalProgress').innerHTML=`<div class="warning">${esc(e.message)}</div>`}};
  $('[data-now]').onclick=run;$('[data-close]').onclick=closeModal;
}
function showGroupCheckin(p,g){
  const remaining=g.members.filter(x=>!x.arrived).length,registered=g.total,already=g.arrived;
  const companion=g.type==='companion';
  let n=Math.max(1,remaining);
  const render=()=>{
    if(companion)return;
    const seats=Math.min(n,remaining),extra=Math.max(0,n-remaining);
    $('#stepN').textContent=n;$('#stepInfo').innerHTML=`이번 좌석 배정 <strong>${seats}석</strong>${extra?` · 추가 ${extra}명은 <strong>스탠딩</strong>`:''}`
  };
  const memberPreview=(g.members||[]).map(x=>`<span class="group-member-chip ${x.arrived?'arrived':''}"><b>${esc(x.name)}</b>${x.seat?` · ${esc(displaySeat(x.seat))}`:' · 좌석 미배정'}${x.arrived?' · 접수완료':''}</span>`).join('');
  const controls=companion
    ? `<div class="notice"><strong>동반그룹 전체 접수</strong><br>이 그룹은 구성원 누구의 QR을 찍어도 남아 있는 동반자 ${remaining}명이 모두 함께 접수됩니다.</div><div class="group-member-preview">${memberPreview}</div>`
    : `<p>기본값은 남은 등록인원 전체입니다. 먼저 온 사람이 전체를 접수하려면 그대로 진행하고, 일부만 접수할 때만 − / + 로 조절하세요.</p><div class="stepper"><button id="minus">−</button><strong id="stepN">${n}</strong><button id="plus">＋</button></div><div id="stepInfo" class="result"></div>`;
  modal(`${checkinTestMode?'<div class="warning"><strong>🧪 테스트 접수</strong><br>문자·도착·기념품·좌석 데이터는 변경하지 않습니다.</div>':''}<p class="eyebrow">${checkinTestMode?'TEST GROUP CHECK-IN':'그룹 QR 접수'} · ${esc(p.name)} QR</p><h2>${esc(g.name||g.organization||'동반')}</h2><div class="notice">사전등록 ${registered}명 · 이미도착 ${already}명 · 남은등록 ${remaining}명</div>${controls}<div class="actions" style="margin-top:16px"><button id="confirmGroup" class="primary">${checkinTestMode?(companion?'동반그룹 전체 테스트':'이 인원으로 테스트 접수'):(companion?'동반그룹 접수완료':'이 인원 접수완료')}</button><button id="cancelGroup">취소</button></div>`);
  if(!companion){$('#minus').onclick=()=>{n=Math.max(1,n-1);render()};$('#plus').onclick=()=>{n=Math.min(99,n+1);render()}}
  $('#cancelGroup').onclick=closeModal;
  $('#confirmGroup').onclick=async()=>{try{
    const endpoint=checkinTestMode?'/api/checkin/test-group':'/api/checkin/group';
    const requestedCount=companion?remaining:n;
    const r=await api(endpoint,{method:'POST',body:JSON.stringify({groupId:g.id,actualCount:requestedCount,station:stationName,scannedParticipantId:p.id})});
    if(checkinTestMode){
      $('#modal').innerHTML=`<div class="warning"><strong>🧪 단체 QR 테스트 성공</strong></div><h2>${esc(g.name||g.organization||'동반')}</h2><div class="successbox">QR·그룹 조회 정상<br>${companion?'동반그룹 전체 접수 시뮬레이션':'테스트 인원 '+r.actualCount+'명'} · 등록대상 ${r.checkedInNow}명<br><b>문자 발송 없음 · 실제 접수/기념품/좌석 변경 없음</b></div><button id="doneGroup" class="primary wide">확인</button>`;
      $('#doneGroup').onclick=closeModal;$('#recentResult').textContent=`[테스트 성공] ${g.name||g.organization||'그룹'} · ${r.checkedInNow}명`;return;
    }
    $('#modal').innerHTML=`<h2>단체 접수 완료</h2><div class="successbox">${companion?'동반그룹 남은 인원 전체 접수 완료':`실제 도착 ${r.actualCount}명`}<br>등록 참가자 접수 ${r.checkedInNow}명<br>좌석 ${r.seats.length}석${r.extraStanding?`<br>추가 ${r.extraStanding}명 스탠딩 안내`:''}<br>기념품 ${companion?r.checkedInNow:r.actualCount}명 지급완료</div><button id="doneGroup" class="primary wide">확인</button>`;
    $('#doneGroup').onclick=closeModal;refreshDashboard()
  }catch(e){toast(e.message,6000)}};
  if(!companion)render();
}
$('#manualQrForm').onsubmit=e=>{e.preventDefault();processCode($('#manualQr').value.trim());$('#manualQr').select()};
$('#toggleScanner').onclick=async()=>{
  if(scannerOn){try{await scanner.stop();await scanner.clear()}catch(_){}scannerOn=false;$('#toggleScanner').textContent='카메라 시작';$('#reader').innerHTML='카메라를 시작하거나 오른쪽에서 QR코드를 직접 입력하세요.';return}
  if(typeof Html5Qrcode==='undefined')return toast('QR 라이브러리를 불러오지 못했습니다.');
  scanner=new Html5Qrcode('reader');try{await scanner.start({facingMode:'environment'},{fps:18,qrbox:{width:260,height:260}},text=>processCode(text),()=>{});scannerOn=true;$('#toggleScanner').textContent='카메라 종료'}catch(e){toast('카메라 권한을 확인해 주세요.')}
};


async function loadParticipants(){
  const q=$('#participantSearch').value.trim(),st=$('#participantStatus').value;
  try{
    const d=await api(`/api/participants?q=${encodeURIComponent(q)}&status=${st}`);
    $('#participantCount').textContent=`${d.total}명`;
    $('#participantRows').innerHTML=d.rows.map(p=>`<tr>
      <td class="p-no">${p.receptionNo}</td>
      <td class="p-name"><strong>${esc(p.name)}</strong><small>${p.wheelchairUser?'♿ ':''}${p.usesCenter?'복지관 이용':''}</small></td>
      <td class="p-org">${esc(p.organization||'-')}</td>
      <td class="p-phone">${esc(p.phone||'-')}</td>
      <td class="p-seat"><strong>${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩석':'미배정'))}</strong></td>
      <td class="p-status">${p.arrived?'<b class="yes">도착</b>':(p.participationStatus==='미참여'||p.active===false?'<span class="no">미참여</span>':'미도착')}</td>
      <td class="p-actions"><button data-edit="${esc(p.id)}">수정</button><button data-check="${esc(p.id)}">접수</button>${p.arrived?`<button data-undo="${esc(p.id)}">취소</button>`:''}<button data-sms-history="${esc(p.id)}">문자</button><button data-delete="${esc(p.id)}" class="danger">삭제</button></td>
    </tr>`).join('')||'<tr><td colspan="7">없음</td></tr>';
  }catch(e){toast(e.message)}
}
async function openParticipantEdit(id){
  try{
    const d=await api(`/api/participant/${encodeURIComponent(id)}`),p=d.participant;
    modal(`<p class="eyebrow">PARTICIPANT EDIT</p><h2>${esc(p.name)} 참가자 수정</h2>
      <form id="participantEditForm" class="form-grid compact">
        <label>이름<input name="name" value="${esc(p.name)}"></label>
        <label>연락처<input name="phone" value="${esc(p.phone||'')}"></label>
        <label>소속기관<input name="organization" value="${esc(p.organization||'')}"></label>
        <label>참여상태<select name="participationStatus"><option ${p.participationStatus==='참여'?'selected':''}>참여</option><option ${p.participationStatus==='미참여'?'selected':''}>미참여</option><option ${p.participationStatus==='취소'?'selected':''}>취소</option><option ${p.participationStatus==='비활성'?'selected':''}>비활성</option></select></label>
        <label>좌석<input value="${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩석':'미배정'))}" disabled></label>
        <label>도착상태<select name="arrived"><option value="true" ${p.arrived?'selected':''}>도착</option><option value="false" ${!p.arrived?'selected':''}>미도착</option></select></label>
        <label class="check"><input type="checkbox" name="wheelchairUser" ${p.wheelchairUser?'checked':''}> 휠체어 이용</label>
        <label class="check"><input type="checkbox" name="disabledPerson" ${p.disabledPerson?'checked':''}> 장애인 당사자</label>
        <label class="check"><input type="checkbox" name="usesCenter" ${p.usesCenter?'checked':''}> 복지관 이용</label>
        <label>좌석 분류<select name="seatCategory"><option value="auto" ${(p.seatCategory||'auto')==='auto'?'selected':''}>자동/일반</option><option value="standing" ${p.seatCategory==='standing'?'selected':''}>스탠딩</option><option value="vip" ${p.seatCategory==='vip'?'selected':''}>VIP</option><option value="guest" ${p.seatCategory==='guest'?'selected':''}>내빈</option><option value="wheelchair" ${p.seatCategory==='wheelchair'?'selected':''}>휠체어 우선</option></select></label>
        <label class="check"><input type="checkbox" name="seatLocked" ${p.seatLocked?'checked':''}> 현재 좌석 고정(일괄배치 보호)</label>
        <label class="check"><input type="checkbox" name="active" ${p.active!==false?'checked':''}> 활성</label>
        <label class="wide-field">메모<textarea name="note" rows="3">${esc(p.note||'')}</textarea></label>
        <div class="wide-field actions"><button class="primary">저장</button><button type="button" id="participantEditClose">닫기</button></div>
      </form>`);
    $('#participantEditClose').onclick=closeModal;
    $('#participantEditForm').onsubmit=async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());
      b.wheelchairUser=f.has('wheelchairUser');b.disabledPerson=f.has('disabledPerson');b.usesCenter=f.has('usesCenter');b.seatLocked=f.has('seatLocked');b.active=f.has('active');b.arrived=b.arrived==='true';
      try{await api(`/api/participants/${encodeURIComponent(id)}/admin-update`,{method:'POST',body:JSON.stringify(b)});toast('참가자 정보를 저장했습니다.');closeModal();loadParticipants();refreshDashboard()}catch(x){toast(x.message,6000)}
    };
  }catch(e){toast(e.message)}
}
$('#reloadParticipants').onclick=loadParticipants;
$('#participantSearch').oninput=()=>{clearTimeout(loadParticipants.tm);loadParticipants.tm=setTimeout(loadParticipants,250)};
$('#participantStatus').onchange=loadParticipants;
$('#participantRows').onclick=async e=>{
  const edit=e.target.closest('[data-edit]'),c=e.target.closest('[data-check]'),u=e.target.closest('[data-undo]'),del=e.target.closest('[data-delete]');
  if(edit)return openParticipantEdit(edit.dataset.edit);
  if(c)return processCode(c.dataset.check);
  if(del){
    const id=del.dataset.delete;
    const p=participantRows?.querySelector?.(`[data-edit="${CSS.escape(id)}"]`)?.closest('tr')?.querySelector('.p-name strong')?.textContent||'이 참가자';
    if(!confirm(`${p} 참가자를 목록에서 삭제할까요?\n\n좌석 배정도 함께 사라집니다. 기존 문자/당첨 로그는 감사기록을 위해 유지됩니다.`))return;
    try{await api(`/api/participants/${encodeURIComponent(id)}/delete`,{method:'POST',body:'{}'});toast('참가자를 삭제했습니다.');loadParticipants();loadSeats();refreshDashboard()}catch(x){toast(x.message,7000)}
    return;
  }
  if(u&&confirm('접수를 취소하고 좌석·기념품 상태도 되돌릴까요?')){
    try{await api('/api/checkin/undo',{method:'POST',body:JSON.stringify({code:u.dataset.undo})});loadParticipants();refreshDashboard()}catch(x){toast(x.message)}
  }
};

$('#onsiteForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());b.wheelchairUser=f.has('wheelchairUser');b.disabledPerson=f.has('disabledPerson');try{const d=await api('/api/participants/onsite',{method:'POST',body:JSON.stringify(b)});toast(`${d.participant.name} 현장등록 완료 · 스탠딩 안내`,6000);e.currentTarget.reset();e.currentTarget.station.value='현장접수';refreshDashboard()}catch(x){toast(x.message,6000)}};



let groupManageCache=[];
async function loadGroups(){
  try{
    const [s,g,ex,excluded]=await Promise.all([api('/api/group-suggestions'),api('/api/groups/manage'),api('/api/groups/exclusions'),api('/api/groups/excluded')]);
    groupManageCache=g.rows;

    $('#groupSuggestions').innerHTML=s.rows.map(x=>`<div class="management-card">
      <div class="top"><div><strong>${esc(x.organization)}</strong><span class="group-badge">자동 기관그룹</span><small>${x.count}명 · 같은 기관 자동연결</small></div>
      <div class="actions"><button data-editgroup="${esc(x.groupId)}" class="primary">자동묶음 수정</button><button data-autoexclude="${esc(x.groupId)}">이 기관 자동묶음 제외</button></div></div>
      <div class="member-list">${x.members.map(m=>`<span class="member-chip">${esc(m.name)}${m.seat?` · ${esc(m.seat)}`:''}</span>`).join('')}</div>
    </div>`).join('')||'<p class="muted">현재 자동 기관그룹이 없습니다.</p>';

    const overrides=g.rows.filter(x=>x.manualOverride===true&&x.type==='organization');
    if(overrides.length){
      $('#groupSuggestions').insertAdjacentHTML('beforeend',`<h3 class="group-subhead">직접 수정해 고정한 자동그룹</h3>${overrides.map(groupCardHtml).join('')}`);
    }
    const reps=g.rows.filter(x=>x.type==='representative'&&!x.auto&&!x.manualOverride);
    const comps=g.rows.filter(x=>x.type==='companion');
    $('#representativeGroups').innerHTML=reps.map(groupCardHtml).join('')||'<p class="muted">대표자 그룹이 없습니다.</p>';
    $('#companionGroups').innerHTML=comps.map(groupCardHtml).join('')||'<p class="muted">기관으로 묶이지 않은 동반 그룹이 없습니다.</p>';
    const excludedRows=[
      ...(excluded.organizations||[]).map(value=>({type:'organization',value,label:`기관 · ${value}`})),
    ];
    $('#excludedGroupsList').innerHTML=excludedRows.map(x=>`<div class="backup-row"><span>${esc(x.label)}</span><button data-restoreexcluded="${esc(x.type)}" data-value="${esc(x.value)}">복원</button></div>`).join('')||'<p class="muted">직접 제외한 자동 기관그룹이 없습니다.</p>';
  }catch(e){toast(e.message)}
}
function groupCardHtml(g){
  const typeText=g.type==='companion'?'동반':(g.type==='organization'?'기관':'대표자');
  return `<div class="management-card" data-group="${esc(g.id)}">
    <div class="top"><div><strong>${esc(g.name||'동반')}</strong><span class="group-badge">${typeText}</span>
      <small>등록 ${g.total}명 · 도착 ${g.arrived}명${g.type==='companion'?' · 어느 참가자 QR이든 그룹접수 가능':` · 대표 ${esc(g.representative?.name||'-')}`}</small></div>
    <div class="actions">${
      g.type==='companion'
        ? `<button data-editgroup="${esc(g.id)}" class="primary">동반그룹 수정</button>${g.manualOverride?`<button data-resetauto="${esc(g.id)}">자동으로 되돌리기</button>`:''}`
        : (g.auto
            ? `<button data-editgroup="${esc(g.id)}" class="primary">자동묶음 수정</button><button data-delgroup="${esc(g.id)}">자동묶음 제외</button>`
            : `<button data-editgroup="${esc(g.id)}">${g.manualOverride?'수정 고정 편집':'수정'}</button>${g.manualOverride?`<button data-resetauto="${esc(g.id)}">자동으로 되돌리기</button>`:''}<button data-delgroup="${esc(g.id)}">그룹 해제</button>`)
    }</div></div>
    <div class="member-list">${g.members.map(m=>`<span class="member-chip ${m.id===g.representativeId&&g.type!=='companion'?'rep':''}">${m.arrived?'✓':'○'} ${esc(m.name)}${m.id===g.representativeId&&g.type!=='companion'?' · 대표':''}</span>`).join('')}</div>
  </div>`;
}
$('#rebuildAutoGroups')?.addEventListener('click',async()=>{
  try{
    const d=await api('/api/groups/rebuild-auto',{method:'POST',body:'{}'});
    toast(`자동그룹 재구성 완료 · 기관 ${d.organizationGroups}개 · 동반 ${d.companionGroups}개`,6500);
    loadGroups();refreshDashboard();
  }catch(e){toast(e.message,7000)}
});

async function openGroupEditor(groupId=''){
  const group=groupManageCache.find(x=>x.id===groupId)||null;
  const selected=new Set(group?.memberIds||[]);
  const searchAndRender=async()=>{
    const q=$('#groupMemberSearch').value.trim(),d=await api(`/api/participants/search?q=${encodeURIComponent(q)}`);
    $('#groupMemberList').innerHTML=d.rows.map(p=>`<label class="participant-pick"><input type="checkbox" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · ${esc(p.phone||'')} · ${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩석':'미배정'))}</small></span></label>`).join('');
    $('#groupMemberList').querySelectorAll('input').forEach(ch=>ch.onchange=()=>{ch.checked?selected.add(ch.value):selected.delete(ch.value);renderRep()});
  };
  const renderRep=()=>{
    const opts=[...selected].map(id=>{const p=stateParticipantFromCache(id);return `<option value="${esc(id)}" ${id===group?.representativeId?'selected':''}>${esc(p?.name||id)}</option>`}).join('');
    $('#groupRepresentative').innerHTML=opts||'<option value="">구성원을 선택하세요.</option>';
  };
  modal(`<p class="eyebrow">GROUP EDITOR</p><h2>${group?(group.auto?'자동묶음 수정':'그룹 수정'):'대표자 그룹 만들기'}</h2>
    ${group?.auto?'<div class="notice"><strong>자동묶음 직접 수정</strong><br>저장하면 이 그룹은 “수정 고정” 상태가 되어 자동그룹 재구성을 해도 구성원이 다시 바뀌지 않습니다. 필요하면 나중에 “자동으로 되돌리기”를 누를 수 있습니다.</div>':''}
    ${group?.manualOverride?'<div class="notice"><strong>수정 고정 상태</strong><br>자동 재구성의 영향을 받지 않습니다.</div>':''}
    <label>그룹명<input id="groupName" value="${esc(group?.name||'')}"></label>
    <label>구성원 검색<input id="groupMemberSearch" placeholder="이름 / 기관 / 연락처"></label>
    <div id="groupMemberList" class="participant-pick-list"></div>
    <label>대표자<select id="groupRepresentative"></select></label>
    <div class="actions"><button id="saveGroup" class="primary">${group?'저장':'그룹 생성'}</button><button id="closeGroupEditor">닫기</button></div>`);
  $('#closeGroupEditor').onclick=closeModal;
  $('#groupMemberSearch').oninput=()=>{clearTimeout(searchAndRender.tm);searchAndRender.tm=setTimeout(searchAndRender,220)};
  window.__participantSearchCache={};
  const originalApi=api;
  try{
    const d=await api('/api/participants/search?q=');
    d.rows.forEach(p=>window.__participantSearchCache[p.id]=p);
  }catch(_){}
  renderRep();await searchAndRender();
  $('#saveGroup').onclick=async()=>{
    const memberIds=[...selected],representativeId=$('#groupRepresentative').value,name=$('#groupName').value.trim();
    if(memberIds.length<2)return toast('2명 이상 선택해 주세요.');
    try{
      if(group)await api(`/api/groups/${encodeURIComponent(group.id)}/manage`,{method:'PUT',body:JSON.stringify({name,memberIds,representativeId})});
      else await api('/api/groups/manual',{method:'POST',body:JSON.stringify({name,memberIds,representativeId})});
      toast('그룹을 저장했습니다.');closeModal();loadGroups();refreshDashboard();
    }catch(e){toast(e.message,6500)}
  };
}
function stateParticipantFromCache(id){return window.__participantSearchCache?.[id]||null}
$('#reloadGroups').onclick=loadGroups;
document.querySelectorAll('[data-grouptab]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-grouptab]').forEach(x=>x.classList.toggle('active',x===b));
  ['Auto','Representative','Companion'].forEach(k=>$('#groupTab'+k).classList.toggle('hidden',k.toLowerCase()!==b.dataset.grouptab));
});
$('#createManualGroup').onclick=()=>openGroupEditor('');
$('#groupSuggestions').onclick=async e=>{
  const edit=e.target.closest('[data-editgroup]');
  if(edit)return openGroupEditor(edit.dataset.editgroup);

  const reset=e.target.closest('[data-resetauto]');
  if(reset){
    if(!confirm('직접 수정한 내용을 버리고 원래 자동묶음 규칙으로 되돌릴까요?'))return;
    try{
      await api(`/api/groups/${encodeURIComponent(reset.dataset.resetauto)}/reset-auto`,{method:'POST',body:'{}'});
      toast('원래 자동묶음으로 되돌렸습니다.');loadGroups();refreshDashboard();
    }catch(x){toast(x.message,6500)}
    return;
  }

  const del=e.target.closest('[data-delgroup]');
  if(del){
    if(!confirm('이 수정 고정 그룹을 해제할까요? 해당 자동묶음은 제외 목록으로 이동합니다.'))return;
    try{
      await api(`/api/groups/${encodeURIComponent(del.dataset.delgroup)}/delete`,{method:'POST',body:'{}'});
      toast('그룹을 해제했습니다.');loadGroups();refreshDashboard();
    }catch(x){toast(x.message,6500)}
    return;
  }

  const b=e.target.closest('[data-autoexclude]');if(!b)return;
  if(!confirm('이 자동 기관그룹을 제외할까요? 참가자는 삭제되지 않으며 나중에 복원할 수 있습니다.'))return;
  try{await api(`/api/groups/${encodeURIComponent(b.dataset.autoexclude)}/delete`,{method:'POST',body:'{}'});toast('자동 기관그룹에서 제외했습니다.');loadGroups();refreshDashboard()}catch(x){toast(x.message,6500)}
};
$('#excludedGroupsList')?.addEventListener('click',async e=>{
  const b=e.target.closest('[data-restoreexcluded]');if(!b)return;
  try{await api('/api/groups/restore-excluded',{method:'POST',body:JSON.stringify({type:b.dataset.restoreexcluded,value:b.dataset.value})});toast('자동그룹을 복원했습니다.');loadGroups();refreshDashboard()}catch(x){toast(x.message,6500)}
});
async function groupContainerClick(e){
  const edit=e.target.closest('[data-editgroup]'),del=e.target.closest('[data-delgroup]');
  if(edit)return openGroupEditor(edit.dataset.editgroup);
  if(del&&confirm('그룹 연결만 해제할까요? 참가자는 삭제되지 않습니다.')){
    try{await api(`/api/groups/${encodeURIComponent(del.dataset.delgroup)}/delete`,{method:'POST',body:'{}'});loadGroups();refreshDashboard()}catch(x){toast(x.message)}
  }
}
$('#representativeGroups').onclick=groupContainerClick;$('#companionGroups').onclick=groupContainerClick;


let seatCache=[];
function seatZoneClass(s){
  const row=String(s.row||'').toUpperCase();
  if(row>='A'&&row<='F')return 'guest';
  return '';
}
let selectedSeatCode='';
function seatCellHtml(s,displayNo){if(!s)return '<div class="seat-cell disabled"><strong>-</strong></div>';const z=seatZoneClass(s),selected=String(s.code).toUpperCase()===String(selectedSeatCode).toUpperCase();const cls=['seat-cell',z,!s.enabled?'disabled':'',s.arrived?'arrived':(s.occupied?'assigned':''),selected?'selected':''].filter(Boolean).join(' ');const name=s.participant?.name||'';return `<div class="${cls}" data-seat="${esc(s.code)}" title="${esc(displaySeat(s.code))}${name?' · '+esc(name):''}"><strong>${displayNo}</strong>${name?`<span class="seat-name">${esc(name)}</span>`:''}</div>`;}
function updateSeatSelection(){const box=$('#seatSelectionInfo');const s=seatCache.find(x=>String(x.code).toUpperCase()===String(selectedSeatCode).toUpperCase());if(!s){box.innerHTML='<strong>좌석을 선택하세요</strong><span>선택하면 이름 · 기관 · 도착상태를 크게 표시합니다.</span><button type="button" id="editSelectedSeat" disabled>좌석 변경</button>';return;}const p=s.participant;box.innerHTML=`<div><b class="selected-seat-label">${esc(displaySeat(s.code))}</b><strong>${p?esc(p.name):'빈좌석'}${p?.seatLocked?' <em class="seat-lock-badge">좌석확정</em>':''}</strong><span>${p?`${esc(p.organization||'기관 없음')} · ${p.phone?esc(p.phone):'연락처 없음'} · ${p.arrived?'도착완료':'미도착'}`:'현재 배정된 참가자가 없습니다.'}</span></div><button type="button" id="editSelectedSeat">좌석 변경</button>`;$('#editSelectedSeat').onclick=()=>openSeatManager(s.code);}
async function loadSeats(){
  try{
    const d=await api('/api/seats');seatCache=d.rows;
    $('#seatCount').textContent=`전체 ${d.total}석 · 배정 ${d.assigned||0}석 · 도착 ${d.arrivedAssigned||0}석 · 자동좌석 ${d.autoSeatAssignOnCheckin?'ON':'OFF'}`;
    const byRow=new Map();d.rows.forEach(s=>{const row=String(s.row||'').toUpperCase();if(!byRow.has(row))byRow.set(row,[]);byRow.get(row).push(s)});
    let html='';
    if(String(d.layoutVersion||'').startsWith('ASYM312-') || d.rows.some(x=>x.section==='rearAsym')){
      const frontRow=(row)=>{const rs=(byRow.get(row)||[]),map=new Map(rs.map(s=>[+s.displayNumber||+s.number,s]));return `<div class="front-seat-row"><div class="seat-row-label">${row}</div><div class="seat-block eight">${Array.from({length:8},(_,i)=>seatCellHtml(map.get(i+1),i+1)).join('')}</div><div class="runway-long">RUNWAY</div><div class="seat-block eight">${Array.from({length:8},(_,i)=>seatCellHtml(map.get(i+9),i+9)).join('')}</div></div>`};
      const rearRow=(row)=>{const rs=(byRow.get(row)||[]),map=new Map(rs.map(s=>[+s.displayNumber||+s.number,s]));return `<div class="front-seat-row rear-asym-row"><div class="seat-row-label">${row}</div><div class="seat-block eighteen">${Array.from({length:18},(_,i)=>seatCellHtml(map.get(i+1),i+1)).join('')}</div><div class="runway-long">RUNWAY</div><div class="seat-block eight">${Array.from({length:8},(_,i)=>seatCellHtml(map.get(i+19),i+19)).join('')}</div></div>`};
      const front='ABCDEF'.split('').map(frontRow).join('');
      const rear='GHIJKLMNO'.split('').map(rearRow).join('');
      html=`${d.layoutNeedsRepair?'<div class="seat-layout-warning"><strong>현장 좌석틀 저장 확인 필요</strong><span>새 312석 구조를 적용 버튼으로 저장해 주세요.</span></div>':''}<div class="seat-stage-label">무대 / 스테이지</div><div class="front-layout-label asym-label"><span>왼쪽 · 1~18</span><span>런웨이</span><span>오른쪽 · 19~26</span></div>${front}<div class="runway-end-cap">앞 6줄 내빈석 · A~F 기존 위치 유지</div>${rear}<div class="runway-end-cap">뒤쪽: 왼쪽 G~N 8줄×18석 + 오른쪽 G~O 9줄×8석 · 총 좌석 312석 · 나머지는 스탠딩</div>`;
    }else{
      const frontRows='ABCDEFGHIJKL'.split(''),rearRows='MNOPQRST'.split('');
      const front=frontRows.map(row=>{const rs=byRow.get(row)||[],lm=new Map(rs.filter(s=>String(s.side).toUpperCase()==='L').map(s=>[Number(s.number),s])),rm=new Map(rs.filter(s=>String(s.side).toUpperCase()==='R').map(s=>[Number(s.number),s]));return `<div class="front-seat-row"><div class="seat-row-label">${row}</div><div class="seat-block eight">${Array.from({length:8},(_,i)=>seatCellHtml(lm.get(i+1),i+1)).join('')}</div><div class="runway-long">RUNWAY</div><div class="seat-block eight">${Array.from({length:8},(_,i)=>seatCellHtml(rm.get(i+1),i+9)).join('')}</div></div>`}).join('');
      const head=`<div class="rear-number-header rear-number-header-26"><span></span>${Array.from({length:26},(_,i)=>`<b>${i+1}</b>`).join('')}</div>`;
      const rear=rearRows.map(row=>{const rs=(byRow.get(row)||[]).filter(s=>String(s.side).toUpperCase()==='B'),map=new Map(rs.map(s=>[Number(s.number),s]));return `<div class="rear-seat-row"><div class="seat-row-label">${row}</div><div class="seat-block twentysix">${Array.from({length:26},(_,i)=>seatCellHtml(map.get(i+1),i+1)).join('')}</div></div>`}).join('');
      const repair=d.layoutNeedsRepair?`<div class="seat-layout-warning"><strong>좌석 데이터가 이전 구조입니다.</strong><span>저장된 좌석 데이터는 이전 구조입니다.</span></div>`:'';
      html=`${repair}<div class="seat-stage-label">무대 / 스테이지</div><div class="front-layout-label"><span>A~L 좌측 8석</span><span>런웨이</span><span>A~L 우측 8석</span></div>${front}<div class="runway-end-cap">구 배치 · A~L 192석 / M~T 208석</div><div class="rear-layout">${head}${rear}</div>`;
    }
    $('#seatGrid').innerHTML=html;updateSeatSelection();const wrap=document.querySelector('.seat-map-wrap');if(wrap)wrap.scrollLeft=0;
  }catch(e){toast(e.message)}
}
async function openSeatManager(code){
  const s=seatCache.find(x=>x.code===code);if(!s)return;
  modal(`<p class="eyebrow">SEAT MANAGER</p><h2>${esc(displaySeat(code))}</h2>
    <div class="notice">${s.participant?`현재 배정: <strong>${esc(s.participant.name)}</strong> · ${s.arrived?'도착완료':'미도착'}`:'현재 빈좌석입니다.'}</div>
    <label>참가자 검색<input id="seatParticipantSearch" placeholder="이름 / 기관 / 연락처 / QR"></label>
    <div id="seatParticipantList" class="participant-pick-list"></div>
    ${s.participant?'':`<details class="seat-quick-add" open><summary><strong>이 좌석에 새 참가자 바로 추가</strong></summary>
      <form id="seatQuickAddForm" class="form-grid compact">
        <label>이름<input name="name" required placeholder="이름"></label>
        <label>연락처<input name="phone" placeholder="선택"></label>
        <label>기관<input name="organization" placeholder="선택"></label>
        <label class="check"><input type="checkbox" name="usesCenter"> 복지관 이용</label>
        <label class="check"><input type="checkbox" name="disabledPerson"> 장애인 당사자</label>
        <label class="check"><input type="checkbox" name="wheelchairUser"> 휠체어 이용</label>
        <button class="primary wide-field">이 좌석에 추가</button>
      </form></details>`}
    <div class="actions">${s.participant?`${s.participant.arrived?'<button id="sendSeatChangeSms" class="primary">좌석변경 문자 발송</button>':''}${s.participant.seatLocked?'<button id="unlockSeatParticipant">좌석확정 해제</button>':''}<button id="releaseSeat" class="danger">이 좌석 해제</button>`:''}<button id="closeSeatManager">닫기</button></div>`);
  $('#closeSeatManager').onclick=closeModal;
  const render=async()=>{
    const d=await api(`/api/participants/search?q=${encodeURIComponent($('#seatParticipantSearch').value.trim())}`);
    $('#seatParticipantList').innerHTML=d.rows.slice(0,60).map(p=>`<div class="participant-pick"><span style="flex:1"><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · 현재 ${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩석':'미배정'))}</small></span><button data-seatassign="${esc(p.id)}">이 좌석 지정</button></div>`).join('');
  };
  $('#seatParticipantSearch').oninput=()=>{clearTimeout(render.tm);render.tm=setTimeout(render,200)};await render();
  if($('#seatQuickAddForm'))$('#seatQuickAddForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());
    b.usesCenter=f.has('usesCenter');b.disabledPerson=f.has('disabledPerson');b.wheelchairUser=f.has('wheelchairUser');b.seatLocked=true;
    try{
      const d=await api(`/api/seats/${encodeURIComponent(code)}/add-participant`,{method:'POST',body:JSON.stringify(b)});
      toast(`${d.participant.name} 참가자를 ${displaySeat(code)}에 추가했습니다.`,6500);
      closeModal();loadSeats();loadParticipants();refreshDashboard();
    }catch(x){toast(x.message,7000)}
  };
  $('#seatParticipantList').onclick=async e=>{
    const b=e.target.closest('[data-seatassign]');if(!b)return;
    const p=(await api(`/api/participant/${encodeURIComponent(b.dataset.seatassign)}`)).participant;
    let mode='swap';
    if(s.participant&&s.participant.id!==p.id){
      mode=confirm(`${displaySeat(code)}에는 ${s.participant.name}님이 있습니다.\n${p.name}님의 기존 좌석과 교환할까요?\n\n확인=교환 / 취소=기존 참가자를 미배정으로 하고 지정`) ? 'swap':'replace';
    }
    try{const r=await api(`/api/seats/${encodeURIComponent(code)}/assign`,{method:'POST',body:JSON.stringify({participantId:p.id,mode})});toast('좌석을 지정했습니다.');closeModal();loadSeats();refreshDashboard();const changed=[r.participant,r.movedOccupant].filter(x=>x&&x.arrived&&x.phone);if(changed.length&&confirm(`접수 완료 참가자의 좌석이 변경되었습니다.\n${changed.map(x=>`${x.name}: ${displaySeat(x.seat)||'미배정'}`).join('\n')}\n\n변경 안내 문자를 지금 보낼까요?`)){for(const x of changed){try{await api('/api/sms/seat-change',{method:'POST',body:JSON.stringify({participantId:x.id})})}catch(_){}}toast('좌석변경 문자 발송을 요청했습니다.',6500)}}catch(x){toast(x.message,6000)}
  };
  if($('#sendSeatChangeSms'))$('#sendSeatChangeSms').onclick=async()=>{if(!confirm(`${s.participant.name}님에게 현재 좌석 ${displaySeat(s.participant.seat)} 기준으로 변경 안내 문자를 보낼까요?`))return;try{await api('/api/sms/seat-change',{method:'POST',body:JSON.stringify({participantId:s.participant.id})});toast('좌석변경 문자를 발송 요청했습니다.',6500)}catch(x){toast(x.message,7000)}};
  if($('#unlockSeatParticipant'))$('#unlockSeatParticipant').onclick=async()=>{if(!confirm(`${s.participant.name}님의 사전 좌석확정을 해제할까요?`))return;try{await api(`/api/seats/${encodeURIComponent(code)}/unlock-participant`,{method:'POST',body:'{}'});toast('좌석확정을 해제했습니다.');closeModal();loadSeats()}catch(x){toast(x.message,6000)}};
  if($('#releaseSeat'))$('#releaseSeat').onclick=async()=>{if(!confirm(`${s.participant.name}님의 ${code} 좌석을 해제할까요?`))return;try{await api(`/api/seats/${encodeURIComponent(code)}/release`,{method:'POST',body:'{}'});closeModal();loadSeats();refreshDashboard()}catch(x){toast(x.message)}};
}
$('#seatGrid').onclick=e=>{const cell=e.target.closest('[data-seat]');if(!cell)return;const code=cell.dataset.seat;if(selectedSeatCode===code)return openSeatManager(code);selectedSeatCode=code;loadSeats();};

$('#applyCurrentHallLayout')?.addEventListener('click',async()=>{
  if(!confirm('새 현장 좌석배치로 전환할까요?\n\n- A~F 앞 6줄 내빈석 96석은 그대로 유지\n- 뒤쪽 왼쪽: G~N 8줄 × 18석 (1~18번)\n- 뒤쪽 오른쪽: G~O 9줄 × 8석 (19~26번)\n- O열의 왼쪽 1~18번은 실제 좌석이 없어 막힘 처리\n- 실제 지정 좌석 총 312석, 나머지는 스탠딩\n\n적용 직전 좌석상태는 자동으로 기억되어 언제든 복원할 수 있습니다.'))return;
  try{const d=await api('/api/seats/apply-current-hall',{method:'POST',body:'{}'});toast(`현장배치 적용 · 계획배치 ${d.plannedMoved||0}명 · 기타변환 ${d.fallbackMoved||0}명 · 해제 ${d.cleared}명 · 자동기억 저장`,10000);selectedSeatCode='';loadSeats();refreshDashboard()}catch(e){toast(e.message,10000)}
});
$('#saveSeatMemory')?.addEventListener('click',async()=>{
  const label=prompt('이 좌석상태의 기억 이름을 입력하세요.','현장 좌석 수동기억');if(label===null)return;
  try{const d=await api('/api/seats/memories',{method:'POST',body:JSON.stringify({label})});toast(`좌석 기억 저장: ${d.memory.label}`,6000)}catch(e){toast(e.message,7000)}
});
$('#restoreSeatMemory')?.addEventListener('click',async()=>{
  try{
    const d=await api('/api/seats/memories');if(!d.rows.length)return toast('저장된 좌석 기억이 없습니다.',6000);
    modal(`<p class="eyebrow">SEAT MEMORY</p><h2>이전 좌석 기억 복원</h2><div class="notice">복원 직전 현재 상태도 자동으로 다시 기억합니다.</div><div class="participant-pick-list">${d.rows.map(x=>`<div class="participant-pick"><span style="flex:1"><strong>${esc(x.label)}</strong><small>${esc(new Date(x.createdAt).toLocaleString('ko-KR'))} · ${esc(x.layoutVersion||'구배치')} · ${x.seats}석</small></span><button data-restore-memory="${esc(x.id)}">복원</button></div>`).join('')}</div><button id="closeMemory" class="wide">닫기</button>`);
    $('#closeMemory').onclick=closeModal;document.querySelector('.modal')?.addEventListener('click',async e=>{const b=e.target.closest('[data-restore-memory]');if(!b)return;if(!confirm('선택한 좌석 기억으로 돌아갈까요? 현재 상태는 복원 직전 자동기억으로 남습니다.'))return;try{const r=await api(`/api/seats/memories/${encodeURIComponent(b.dataset.restoreMemory)}/restore`,{method:'POST',body:'{}'});toast(`좌석 기억 복원 완료 · ${r.participantsRestored}명`,8000);closeModal();loadSeats();refreshDashboard()}catch(x){toast(x.message,8000)}});
  }catch(e){toast(e.message,7000)}
});
$('#apply400Layout')?.addEventListener('click',async()=>{
  if(!confirm('400석 좌석배치를 적용할까요?\n\nA~L: 현재 좌석번호와 배정자를 그대로 유지 (16석 × 12줄 = 192석)\nM~T: 기존 1~20번을 그대로 유지하고 21~26번을 추가 (26석 × 8줄 = 208석)\n총 400석\n\n현재 배정된 좌석은 변경하지 않습니다.'))return;
  try{const d=await api('/api/seats/apply-event-400',{method:'POST',body:JSON.stringify({preserveAssignments:true})});selectedSeatCode='';toast(`400석 배치 완료 · 기존좌석 유지 ${d.preserved}명 · 변환 ${d.moved}명 · 해제 ${d.cleared}명`,9000);loadSeats();refreshDashboard()}catch(e){toast(e.message,9000)}
});
$('#reloadSeats').onclick=loadSeats;
$('#releasePendingSeats').onclick=async()=>{if(!confirm('미도착 참가자의 현재 좌석을 모두 해제할까요? 도착자 좌석은 유지됩니다.'))return;try{const d=await api('/api/seats/release-pending',{method:'POST',body:'{}'});toast(`${d.released}석 해제 완료`,5000);loadSeats();refreshDashboard()}catch(e){toast(e.message)}};
$('#showUnassigned').onclick=async()=>{
  try{const d=await api('/api/participants/unassigned');modal(`<p class="eyebrow">UNASSIGNED</p><h2>미배정 참가자 ${d.total}명</h2><div class="unassigned-list">${d.rows.map(p=>`<div class="unassigned-row"><span><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · ${p.arrived?'도착':'미도착'}</small></span><span>${p.wheelchairUser?'♿':''}</span></div>`).join('')}</div><button id="closeUnassigned" class="wide">닫기</button>`);$('#closeUnassigned').onclick=closeModal}catch(e){toast(e.message)}
};
$('#autoAssignAll').onclick=async()=>{
  if(!confirm('현재 도착 완료인데 아직 좌석이 없는 참가자만 자동배치할까요?\n미도착 일반 참가자는 사전배치하지 않습니다.'))return;
  try{const d=await api('/api/seats/auto-assign-unassigned',{method:'POST',body:JSON.stringify({onlyArrived:true})});toast(`도착자 자동배치 완료 · ${d.assigned}명`,7000);loadSeats();refreshDashboard()}catch(e){toast(e.message,7000)}
};
$('#resetGeneralSeats')?.addEventListener('click',async()=>{
  if(!confirm('G~Y 일반석만 초기화할까요?\nA~F 특수구역과 "좌석 고정" 참가자는 유지됩니다.'))return;
  try{const d=await api('/api/seats/reset-general',{method:'POST',body:'{}'});toast(`일반좌석 ${d.released}석 초기화 완료`,6500);loadSeats();refreshDashboard()}catch(e){toast(e.message,7000)}
});
$('#reassignWheelchair')?.addEventListener('click',async()=>{
  if(!confirm('휠체어 신청자 그룹만 좌석을 다시 배치할까요?\n\n휠체어 신청자 1명 + 보호자 1명은 양끝 장애인석에, 나머지 동반자는 같은 줄 안쪽 일반석에 우선 배치합니다.\n다른 참가자의 좌석은 건드리지 않습니다.'))return;
  try{const d=await api('/api/seats/reassign-wheelchair',{method:'POST',body:'{}'});toast(`휠체어 재배치 완료 · 그룹 ${d.parties} · 휠체어 ${d.wheelchair} · 보호자 ${d.guardians} · 동반자 ${d.companions}`,9000);loadSeats();refreshDashboard()}catch(e){toast(e.message,9000)}
});
$('#finalAutoAssign')?.addEventListener('click',async()=>{
  if(!confirm('내빈과 휠체어 이용자만 사전 좌석배치할까요?\n\n일반 참가자는 미리 배치하지 않고 행사 당일 접수 시 자동배정됩니다.\n관리자가 직접 지정한 확정좌석은 그대로 유지됩니다.'))return;
  try{
    const d=await api('/api/seats/final-auto-assign',{method:'POST',body:'{}'});
    toast(`사전배치 완료 · 내빈 ${d.vip+d.guest}명 · 휠체어 ${d.wheelchair}명 · 보호자 ${d.guardians||0}명 · 동반 일반석 ${d.companions||0}명 · 수동확정 ${d.manualLocked}명`,9000);
    loadSeats();refreshDashboard();
  }catch(e){toast(e.message,9000)}
});



async function loadRaffle(){
  try{
    const [p,h]=await Promise.all([api('/api/raffle/products'),api('/api/raffle/history')]);
    const current=$('#raffleProduct').value;
    const productOptions=p.rows.filter(x=>x.enabled&&x.remaining>0).map(x=>`<option value="${esc(x.number)}" data-remaining="${x.remaining}">${esc(x.name)} · 남음 ${x.remaining}개 / 총 ${x.quantity}개</option>`).join('')||'<option value="">사용 가능한 상품 없음</option>';
    $('#raffleProduct').innerHTML=productOptions;
    if($('#remoteRaffleProduct'))$('#remoteRaffleProduct').innerHTML=productOptions;
    if(current&&[...$('#raffleProduct').options].some(o=>o.value===current))$('#raffleProduct').value=current;
    syncRaffleCountToProduct($('#raffleProduct'),$('#raffleCount'));syncRaffleCountToProduct($('#remoteRaffleProduct'),$('#remoteRaffleCount'));
    $('#raffleFilter').value='usesCenter';
    renderRaffleProducts(p.rows);
    renderRaffleHistory(h.rows);
    loadRemoteRaffleStatus().catch(()=>{});
  }catch(e){toast(e.message)}
}

function syncRaffleCountToProduct(select,countInput){
  if(!select||!countInput)return;
  const opt=select.selectedOptions?.[0];
  const remaining=Math.max(1,Number(opt?.dataset?.remaining||1));
  countInput.value=String(Math.max(1,Math.min(5,remaining)));
}
function renderRaffleProducts(rows){
  $('#raffleProductList').innerHTML=rows.map(x=>`<div class="raffle-product-row" data-product="${esc(x.number)}">
    <div><strong>${esc(x.name)}</strong><div class="meta">당첨 ${x.drawn}개 · 남음 ${x.remaining}개 · ${x.enabled?'사용중':'중지'}</div></div>
    <input data-product-name="${esc(x.number)}" value="${esc(x.name)}" aria-label="상품명">
    <input data-product-qty="${esc(x.number)}" type="number" min="${Math.max(1,x.drawn)}" max="9999" value="${x.quantity}" aria-label="총 수량">
    <div class="actions">
      <button type="button" data-product-save="${esc(x.number)}">저장</button>
      <button type="button" data-product-toggle="${esc(x.number)}">${x.enabled?'중지':'사용'}</button>
      <button type="button" data-product-delete="${esc(x.number)}" class="danger">${x.drawn>0?'중지':'삭제'}</button>
    </div>
  </div>`).join('')||'<p class="muted">등록된 상품이 없습니다. 위에서 상품명과 수량을 추가하세요.</p>';
}
function renderRaffleHistory(rows){
  $('#raffleHistory').innerHTML=rows.slice(0,80).map(x=>`<div class="history-row raffle-history-row">
    <strong>${esc(x.prizeName)} · ${esc(x.participantDisplayName||`${x.participantName}${x.participantPhoneLast4?` (${x.participantPhoneLast4})`:''}`)}</strong>
    <small>${esc(x.seat||'스탠딩석')} · ${new Date(x.drawnAt).toLocaleString('ko-KR')} · ${x.enabled===false?'당첨취소':'유효'}</small>
    ${x.winnerSmsSentAt?`<small class="winner-sms-done">당첨문자 요청완료 · ${esc(x.winnerSmsTargetName||'수신자')}</small>`:''}
    <div class="actions">
      ${x.enabled===false?'':`<button data-winnersms="${esc(x.drawId)}" data-pid="${esc(x.participantId)}">${x.winnerSmsSentAt?'당첨문자 재발송':'당첨확인문자 보내기'}</button>`}
      ${x.enabled===false?'':(x.received?'<b>경품 수령완료</b>':`<button data-redeem="${esc(x.drawId)}" data-pid="${esc(x.participantId)}">경품 수령완료</button>`)}
      ${x.enabled===false?'':`<button data-cancelwin="${esc(x.drawId)}" data-pid="${esc(x.participantId)}" class="danger">당첨취소</button>`}
    </div>
  </div>`).join('')||'<p class="muted">아직 당첨 기록이 없습니다.</p>';
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
let raffleRun=null;
let raffleAudioCtx=null;
function raffleAudio(){
  try{
    if(!raffleAudioCtx)raffleAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(raffleAudioCtx.state==='suspended')raffleAudioCtx.resume();
    return raffleAudioCtx;
  }catch(_){return null}
}
function tone(freq=880,duration=.05,volume=.045,type='square',delay=0){
  const ctx=raffleAudio();if(!ctx)return;
  const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+duration);
}
function spinTone(){tone(1180,.028,.018,'square')}
function stopTick(i){tone([1040,880,720,560][Math.min(i,3)],.07,.055,'square')}
function fanfare(){
  [523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,.22,.06,'triangle',i*.11));
  tone(1318.5,.45,.07,'triangle',.48);
}
function raffleName(p){return `${p.name}${p.seat?` (${p.seat})`:''}`}
const RAFFLE_ITEM_H=126;

function createRaffleParticles(count=52){
  const box=$('#raffleParticles'); if(!box)return;
  box.innerHTML='';
  for(let i=0;i<count;i++){
    const el=document.createElement('i');
    el.className='raffle-particle';
    el.style.left=`${Math.random()*100}%`;
    el.style.setProperty('--dur',`${2.1+Math.random()*2.6}s`);
    el.style.setProperty('--drift',`${Math.round(Math.random()*260-130)}px`);
    el.style.setProperty('--rot',`${Math.round(Math.random()*900-450)}deg`);
    el.style.animationDelay=`${Math.random()*.55}s`;
    if(i%3===0){el.style.width='3px';el.style.height='12px'}
    box.appendChild(el);
  }
  setTimeout(()=>{if(box)box.innerHTML=''},5200);
}

function raffleItemHtml(p){
  return `<div class="raffle-reel-item"><span class="person">${esc(p.name||'행운의 주인공')}</span>${p.seat?`<span class="seat">(${esc(p.seat)})</span>`:''}</div>`;
}
function buildSpinTrack(samples){
  const seq=[];
  const safe=samples.length?samples:[{name:'행운의 주인공',seat:''}];
  // 같은 묶음을 4번 반복해서 Web Animations 반복 지점이 자연스럽게 이어지게 함.
  for(let r=0;r<4;r++)safe.forEach(p=>seq.push(p));
  $('#raffleReelTrack').innerHTML=seq.map(raffleItemHtml).join('');
}
function raffleBaseY(){return ($('#raffleReelViewport')?.clientHeight||390)/2-RAFFLE_ITEM_H/2}
function startPremiumReel(samples){
  const track=$('#raffleReelTrack');
  buildSpinTrack(samples);
  const oneLoop=Math.max(1,samples.length)*RAFFLE_ITEM_H;
  const base=raffleBaseY();
  track.getAnimations().forEach(x=>x.cancel());
  track.style.transform=`translateY(${base}px)`;
  const duration=Math.max(1250,Math.min(2400,samples.length*46));
  return track.animate(
    [{transform:`translateY(${base}px)`},{transform:`translateY(${base-oneLoop}px)`}],
    {duration,iterations:Infinity,easing:'linear'}
  );
}
async function stopPremiumReel(samples,winner){
  const track=$('#raffleReelTrack');
  track.getAnimations().forEach(x=>x.cancel());

  // 마지막에 실제 당첨자가 정확히 중앙에 도착하도록 정지용 트랙을 새로 구성
  const seq=[];
  const safe=samples.length?samples:[winner];
  const fillerCount=22;
  for(let i=0;i<fillerCount;i++)seq.push(safe[Math.floor(Math.random()*safe.length)]);
  seq.push(winner);
  track.innerHTML=seq.map(raffleItemHtml).join('');

  const base=raffleBaseY();
  const target=base-(seq.length-1)*RAFFLE_ITEM_H;
  track.style.transform=`translateY(${base}px)`;

  // 감속음 — 처음엔 촘촘하고 뒤로 갈수록 벌어짐
  [260,430,650,920,1260,1670,2140].forEach((ms,i)=>{
    setTimeout(()=>stopTick(Math.min(i,3)),ms);
  });

  const anim=track.animate(
    [{transform:`translateY(${base}px)`},{transform:`translateY(${target}px)`}],
    {duration:2850,easing:'cubic-bezier(.08,.68,.12,1)',fill:'forwards'}
  );
  await anim.finished.catch(()=>{});
  track.style.transform=`translateY(${target}px)`;
}

function showRaffleStage(prep){
  const stage=$('#raffleStage');
  stage.classList.remove('hidden','reveal','stopping');
  stage.classList.add('spinning');
  $('#raffleWinnerPanel').classList.add('hidden');
  $('#raffleStageClose').classList.add('hidden');
  $('#raffleSpaceHint').classList.remove('hidden');
  $('#raffleStageLabel').textContent='LUCKY DRAW';
  $('#raffleStageProduct').textContent=`${prep.product.name} · 남은 수량 ${prep.product.remaining}개`;
  $('#raffleStageSub').textContent=`복지관 이용인 ${prep.poolSize}명 중 추첨 · SPACE를 눌러 멈춰주세요`;
  $('#raffleWinnerName').textContent='';
  $('#raffleWinnerSeat').textContent='';
  $('#raffleWinnerPrize').textContent='';
  return stage;
}

async function run777Raffle(prep){const stage=showRaffleStage(prep),samples=prep.sample.length?prep.sample:[{name:'행운의 주인공',seat:''}],run={prep,stopRequested:false,finished:false,spinAnim:null};raffleRun=run;raffleAudio();const winners=[];for(let round=1;round<=prep.count;round++){run.stopRequested=false;$('#raffleWinnerPanel').classList.add('hidden');$('#raffleStageClose').classList.add('hidden');$('#raffleSpaceHint').classList.remove('hidden');$('#raffleStageSub').textContent=`${round} / ${prep.count} 번째 당첨자 · SPACE로 멈춤`;stage.classList.remove('stopping','reveal');stage.classList.add('spinning');run.spinAnim=startPremiumReel(samples);while(!run.stopRequested)await sleep(60);stage.classList.remove('spinning');stage.classList.add('stopping');$('#raffleSpaceHint').classList.add('hidden');$('#raffleStageSub').textContent=`${round}번째 당첨자를 결정하고 있습니다`;const result=await api('/api/raffle/commit-one',{method:'POST',body:JSON.stringify({token:prep.token})});const current=result.record;winners.push(current);await stopPremiumReel(samples,{name:current.participantName,seat:current.seat||''});stage.classList.remove('stopping');stage.classList.add('reveal');fanfare();createRaffleParticles(54);$('#raffleWinnerPanel').classList.remove('hidden');$('#raffleWinnerName').textContent=current.participantName;$('#raffleWinnerSeat').textContent=current.seat?`좌석 ${current.seat}`:'좌석 미배정';$('#raffleWinnerPrize').textContent=`${prep.product.name} · ${round}/${prep.count}`;if(round<prep.count){$('#raffleStageSub').textContent='다음 당첨자를 위해 SPACE를 눌러주세요';run.stopRequested=false;while(!run.stopRequested)await sleep(60)}}$('#raffleWinnerName').textContent=`최종 ${winners.length}명 당첨`;$('#raffleWinnerSeat').textContent=winners.map(w=>`${w.participantName}${w.seat?` (${w.seat})`:''}`).join(' · ');$('#raffleWinnerPrize').textContent=prep.product.name;$('#raffleStageSub').textContent='최종 당첨 결과';$('#raffleStageClose').classList.remove('hidden');run.finished=true;return {ok:true,product:prep.product,winners}}
function requestRaffleStop(){
  if(!raffleRun||raffleRun.finished||raffleRun.stopRequested)return;
  raffleRun.stopRequested=true;
  tone(1480,.10,.065,'triangle');
}
document.addEventListener('keydown',e=>{
  if(e.code==='Space'&&raffleRun&&!raffleRun.finished){
    e.preventDefault();requestRaffleStop();
  }
});
$('#raffleStageClose').onclick=()=>{
  const stage=$('#raffleStage');
  stage.classList.add('hidden');
  stage.classList.remove('spinning','stopping','reveal');
  $('#raffleReelTrack')?.getAnimations().forEach(x=>x.cancel());
  raffleRun=null;
};

$('#raffleProductAddForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const name=$('#raffleProductName').value.trim(),quantity=Number($('#raffleProductQuantity').value||1);
  if(!name)return toast('상품명을 입력해 주세요.');
  try{
    await api('/api/raffle/products',{method:'POST',body:JSON.stringify({name,quantity})});
    e.currentTarget.reset();$('#raffleProductQuantity').value=1;
    toast('추첨 상품을 추가했습니다.');loadRaffle();
  }catch(x){toast(x.message,7000)}
});
$('#raffleProductList')?.addEventListener('click',async e=>{
  const save=e.target.closest('[data-product-save]'),toggle=e.target.closest('[data-product-toggle]'),del=e.target.closest('[data-product-delete]');
  try{
    if(save){
      e.preventDefault();
      const no=save.dataset.productSave,row=save.closest('[data-product]');
      const name=row.querySelector('[data-product-name]').value.trim();
      const quantity=Number(row.querySelector('[data-product-qty]').value);
      await api(`/api/raffle/products/${encodeURIComponent(no)}/update`,{method:'POST',body:JSON.stringify({name,quantity})});
      toast('상품 정보를 저장했습니다.');loadRaffle();
    }
    if(toggle){
      e.preventDefault();
      const no=toggle.dataset.productToggle;
      const row=toggle.closest('[data-product]'),currently=toggle.textContent.trim()==='중지';
      await api(`/api/raffle/products/${encodeURIComponent(no)}/update`,{method:'POST',body:JSON.stringify({enabled:!currently})});
      loadRaffle();
    }
    if(del){
      e.preventDefault();
      const no=del.dataset.productDelete;
      if(!confirm('이 상품을 삭제/중지할까요? 이미 당첨기록이 있으면 기록 보호를 위해 사용중지 처리됩니다.'))return;
      await api(`/api/raffle/products/${encodeURIComponent(no)}/delete`,{method:'POST',body:'{}'});
      toast('처리했습니다.');loadRaffle();
    }
  }catch(x){toast(x.message,7000)}
});

$('#raffleForm').onsubmit=async e=>{
  e.preventDefault();
  if(raffleRun&&!raffleRun.finished)return toast('현재 추첨이 진행 중입니다.');
  try{
    const prep=await api('/api/raffle/prepare',{method:'POST',body:JSON.stringify({
      productNo:$('#raffleProduct').value,count:Number($('#raffleCount').value),filter:$('#raffleFilter').value
    })});
    const result=await run777Raffle(prep);
    $('#raffleWinners').innerHTML=`<div class="successbox"><h3>${esc(result.product.name)}</h3>${result.winners.map(x=>`<p><strong>${esc(x.participantName)}</strong> · ${esc(x.seat||'스탠딩석')}</p>`).join('')}</div>`;
    loadRaffle();
  }catch(x){
    $('#raffleStage')?.classList.add('hidden');
    raffleRun=null;toast(x.message,7000)
  }
};
$('#reloadRaffleHistory').onclick=loadRaffle;
$('#raffleHistory').onclick=async e=>{
  const r=e.target.closest('[data-redeem]'),c=e.target.closest('[data-cancelwin]'),sms=e.target.closest('[data-winnersms]');
  try{
    if(sms){
      if(!confirm('당첨자 또는 단체 대표 연락처로 당첨확인 문자를 보낼까요?\n경품 수령 시 이 문자를 보여달라는 안내가 포함됩니다.'))return;
      const d=await api('/api/raffle/winner-sms',{method:'POST',body:JSON.stringify({drawId:sms.dataset.winnersms,participantId:sms.dataset.pid})});
      toast(`${d.target.name}님에게 당첨확인 문자 발송을 요청했습니다.${d.target.isRepresentative?' (대표 연락처)':''}`,7500);loadRaffle();return;
    }
    if(r){await api('/api/raffle/redeem',{method:'POST',body:JSON.stringify({drawId:r.dataset.redeem,participantId:r.dataset.pid})});loadRaffle()}
    if(c&&confirm('이 당첨을 취소할까요? 취소하면 이 참가자는 다시 추첨 대상이 됩니다.')){await api('/api/raffle/cancel',{method:'POST',body:JSON.stringify({drawId:c.dataset.cancelwin,participantId:c.dataset.pid})});loadRaffle()}
  }catch(x){toast(x.message,7000)}
};


let remoteStageUrl='';
async function loadRemoteRaffleStatus(){if(!token)return;try{const d=await api('/api/raffle/remote/status');const badge=$('#raffleScreenStatus'),stateBox=$('#remoteRaffleState');if(badge){badge.textContent=d.connectedScreens>0?`무대화면 ${d.connectedScreens}대 연결`:'무대화면 미연결';badge.classList.toggle('ok',d.connectedScreens>0)}if(stateBox){if(d.status==='spinning'){stateBox.className='remote-state spinning';stateBox.innerHTML=`<strong>${d.currentIndex||1} / ${d.targetCount||d.count||1} 번째 당첨자 추첨 중</strong><br>${esc(d.product?.name||'행운상품')} · 슬롯을 멈춰주세요`}else if(d.status==='step-winner'){const last=(d.winners||[]).at(-1);stateBox.className='remote-state winner';stateBox.innerHTML=`<strong>${d.currentIndex} / ${d.targetCount} 번째 당첨자</strong><br>${last?`${esc(last.participantName)} ${last.seat?`(${esc(last.seat)})`:''}`:''}<br><small>다음 당첨자 추첨 버튼을 눌러 계속하세요.</small>`}else if(d.status==='final'){stateBox.className='remote-state winner';stateBox.innerHTML=`<strong>최종 ${d.winners?.length||0}명 추첨 완료</strong><br>${(d.winners||[]).map(w=>`${esc(w.participantName)}${w.seat?` (${esc(w.seat)})`:''}`).join(' · ')}`}else{stateBox.className='remote-state';stateBox.textContent='원격 추첨 대기 중'}}$('#remoteRaffleStart').disabled=['spinning','step-winner'].includes(d.status);$('#remoteRaffleStop').disabled=d.status!=='spinning';if($('#remoteRaffleNext'))$('#remoteRaffleNext').disabled=true}catch(_){}}
async function getRemoteStageUrl(){
  const d=await api('/api/raffle/stage-link');
  remoteStageUrl=d.url;
  return d.url;
}
$('#remoteOpenStage')?.addEventListener('click',async()=>{
  try{window.open(await getRemoteStageUrl(),'nyjwelRaffleStage','noopener,noreferrer')}catch(x){toast(x.message,7000)}
});
$('#remoteCopyStage')?.addEventListener('click',async()=>{
  try{
    const u=await getRemoteStageUrl();
    await navigator.clipboard.writeText(u);
    toast('무대 화면 링크를 복사했습니다.');
  }catch(x){toast('링크 복사가 안 되면 컴퓨터에서 관리자 → 현황 → 무대 추첨 화면 열기를 사용하세요.',7000)}
});
document.querySelectorAll('[data-stage-mode]').forEach(b=>b.addEventListener('click',async()=>{
  try{
    await api('/api/raffle/remote/screen',{method:'POST',body:JSON.stringify({mode:b.dataset.stageMode})});
    toast(`${b.textContent.trim()}으로 전환했습니다.`);loadRemoteRaffleStatus();
  }catch(x){toast(x.message,7000)}
}));

$('#raffleProduct')?.addEventListener('change',()=>syncRaffleCountToProduct($('#raffleProduct'),$('#raffleCount')));
$('#remoteRaffleProduct')?.addEventListener('change',()=>syncRaffleCountToProduct($('#remoteRaffleProduct'),$('#remoteRaffleCount')));
$('#remoteRaffleStart')?.addEventListener('click',async()=>{
  if(!$('#remoteRaffleProduct')?.value)return toast('추첨 상품을 선택해 주세요.');
  try{
    const d=await api('/api/raffle/remote/start',{method:'POST',body:JSON.stringify({
      productNo:$('#remoteRaffleProduct').value,
      count:Number($('#remoteRaffleCount').value||1),
      filter:$('#remoteRaffleFilter').value
    })});
    toast(`무대 추첨 시작 · 대상 ${d.poolSize}명`,5000);
    loadRemoteRaffleStatus();
  }catch(x){toast(x.message,7000)}
});
$('#remoteRaffleStop')?.addEventListener('click',async()=>{
  if(!confirm('지금 멈추고 당첨자를 확정할까요?'))return;
  try{
    const d=await api('/api/raffle/remote/stop',{method:'POST',body:'{}'});
    $('#raffleWinners').innerHTML=`<div class="successbox"><h3>${esc(d.product.name)}</h3>${d.winners.map(x=>`<p><strong>${esc(x.participantName)}</strong> · ${esc(x.seat||'스탠딩석')}</p>`).join('')}</div>`;
    if(navigator.vibrate)navigator.vibrate([80,50,160]);
    toast(`${d.winners.length}명 당첨자를 확정하고 무대 화면에 공개했습니다.`,6500);
    loadRaffle();
  }catch(x){toast(x.message,7000)}
});
$('#remoteRaffleNext')?.addEventListener('click',async()=>{try{const d=await api('/api/raffle/remote/next',{method:'POST',body:'{}'});toast(`${d.currentIndex} / ${d.targetCount} 번째 당첨자 추첨 시작`,4500);loadRemoteRaffleStatus()}catch(x){toast(x.message,7000)}});
$('#remoteRaffleReset')?.addEventListener('click',async()=>{
  if(!confirm('무대 화면을 대기 상태로 초기화할까요?'))return;
  try{await api('/api/raffle/remote/reset',{method:'POST',body:'{}'});toast('무대 화면을 초기화했습니다.');loadRemoteRaffleStatus()}catch(x){toast(x.message,7000)}
});
setInterval(()=>{if(token&&currentViewName?.()==='raffle'&&!document.hidden)loadRemoteRaffleStatus()},3000);

async function loadSmsGroups(){
  try{
    const d=await api('/api/groups/manage');
    $('#groupSmsSelect').innerHTML='<option value="">그룹 선택</option>'+d.rows.map(g=>`<option value="${esc(g.id)}">${esc(g.name||g.organization||'동반')} · ${g.total}명</option>`).join('');
  }catch(_){}
}

async function loadSms(){
  loadSmsGroups();
  try{
    const [d,st]=await Promise.all([api('/api/sms'),api('/api/sms/status')]);
    const box=$('#smsStatusBox');
    if(box){
      box.className=st.ready?'successbox':'warning';
      box.textContent=st.ready
        ? `문자나라 직접발송 준비됨 · 발신번호 ${st.sender||'설정됨'}`
        : '문자나라 환경변수를 확인해 주세요.';
    }
    const list=$('#smsList');
    if(list){
      list.innerHTML=d.rows.slice(0,80).map(x=>`<div class="sms-row">
        <strong>${esc(x.phone)} · ${esc(x.status)}</strong>
        <small>${esc(x.kind||'')} · ${new Date(x.requestedAt).toLocaleString('ko-KR')}</small>
        <div>${esc(x.message).slice(0,120)}${x.message.length>120?'…':''}</div>
        ${x.result?`<small>${esc(x.result).slice(0,160)}</small>`:''}
      </div>`).join('')||'<p class="muted">문자 기록 없음</p>';
    }
  }catch(e){toast(e.message,6000)}
}
$('#reloadSms')?.addEventListener('click',loadSms);
$('#smsTestBtn')?.addEventListener('click',async()=>{
  if(!confirm('MUNJANARA_TEST_RECEIVER로 테스트 문자를 발송할까요?'))return;
  try{
    const d=await api('/api/sms/test',{method:'POST',body:'{}'});
    toast(d.ok?'테스트 문자 발송 성공':'문자나라에서 실패 응답을 받았습니다.',6500);
    loadSms();
  }catch(e){toast(e.message,7000)}
});
$('#manualSmsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const b=Object.fromEntries(new FormData(e.currentTarget).entries());
  if(!confirm(`${b.phone} 번호로 문자를 발송할까요?`))return;
  try{
    const d=await api('/api/sms/send-one',{method:'POST',body:JSON.stringify(b)});
    toast(d.ok?'문자 발송 성공':'문자 발송 실패',6500);
    if(d.ok)e.currentTarget.reset();
    loadSms();
  }catch(x){toast(x.message,7000)}
});
$('#groupSmsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const groupId=$('#groupSmsSelect').value,message=$('#groupSmsMessage').value.trim(),mode=$('#groupSmsMode').value;
  if(!groupId||!message)return toast('그룹과 문자 내용을 입력해 주세요.');
  if(!confirm(`선택한 그룹에 문자를 발송할까요?\n방식: ${mode==='all'?'전체 연락처':'대표/연락 가능한 1명'}`))return;
  try{
    const d=await api('/api/sms/send-group',{method:'POST',body:JSON.stringify({groupId,message,mode})});
    toast(`${d.groupName} · ${d.queued}건 발송 요청`,7000);$('#groupSmsMessage').value='';loadSms();
  }catch(x){toast(x.message,7000)}
});



async function loadSettings(){
  try{
    const d=await api('/api/settings'),s=d.settings||{},f=$('#settingsForm');
    ['eventName','eventDate','eventVenue','eventHost','applicationCapacity','individualAutoCheckinDelayMs','checkinPopupCloseMs','externalBackupIntervalSec','externalSnapshotIntervalMin'].forEach(k=>{if(f.elements[k])f.elements[k].value=s[k]??''});
    ['checkinSmsEnabled','externalBackupEnabled','autoRestoreExternalIfEmpty'].forEach(k=>{if(f.elements[k])f.elements[k].checked=s[k]!==false});if(f.elements.autoSeatAssignOnCheckin){f.elements.autoSeatAssignOnCheckin.checked=false;f.elements.autoSeatAssignOnCheckin.disabled=true;}
    $('#rolePasswordStatus').innerHTML=[
      ['현장 접수',d.rolePasswords.reception],['좌석 담당',d.rolePasswords.seat],['추첨 담당',d.rolePasswords.raffle],['Google Drive 외부백업',d.externalBackupConfigured]
    ].map(([n,on])=>`<div class="${on?'settings-ok':'settings-off'}"><strong>${esc(n)}</strong> · ${on?'설정됨':'미설정'}</div>`).join('');
  }catch(e){toast(e.message,7000)}
}
$('#settingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());
  ['applicationCapacity','individualAutoCheckinDelayMs','checkinPopupCloseMs','externalBackupIntervalSec','externalSnapshotIntervalMin'].forEach(k=>b[k]=Number(b[k]));
  ['checkinSmsEnabled','externalBackupEnabled','autoRestoreExternalIfEmpty'].forEach(k=>b[k]=f.has(k));b.autoSeatAssignOnCheckin=false;
  try{const d=await api('/api/settings',{method:'POST',body:JSON.stringify(b)});appSettings=d.settings;toast('설정을 저장했습니다.');refreshDashboard()}catch(x){toast(x.message,7000)}
});

async function loadLocalBackups(){
  try{
    const d=await api('/api/backup/local-list');
    $('#localBackupList').innerHTML=d.rows.slice(0,30).map(x=>`<div class="backup-row"><span><strong>${esc(x.name)}</strong><small>${new Date(x.modifiedAt).toLocaleString('ko-KR')} · ${(x.size/1024).toFixed(1)}KB</small></span><button data-localrestore="${esc(x.name)}">복원</button></div>`).join('')||'<p class="muted">로컬 백업 없음</p>';
  }catch(e){toast(e.message)}
}
$('#reloadLocalBackups')?.addEventListener('click',loadLocalBackups);
$('#localBackupList')?.addEventListener('click',async e=>{
  const b=e.target.closest('[data-localrestore]');if(!b)return;
  if(!confirm(`${b.dataset.localrestore} 로컬 백업으로 복원할까요?`))return;
  try{const d=await api('/api/backup/local-restore',{method:'POST',body:JSON.stringify({name:b.dataset.localrestore})});toast(`복원 완료 · 참가자 ${d.participants}명`,7000);refreshDashboard();loadLocalBackups()}catch(x){toast(x.message,7000)}
});
async function loadBackupStatus(){
  try{
    const d=await api('/api/external-backup/status'),box=$('#externalBackupStatus');
    box.className=d.configured?(d.lastError?'warning':'successbox'):'warning';
    box.innerHTML=d.configured
      ? `<strong>Google Drive 연결 설정됨</strong><br>최근 성공: ${d.lastSuccessAt?new Date(d.lastSuccessAt).toLocaleString('ko-KR'):'아직 없음'}${d.lastError?`<br>최근 오류: ${esc(d.lastError)}`:''}`
      : '<strong>미설정</strong><br>GDRIVE_BACKUP_URL / GDRIVE_BACKUP_TOKEN 환경변수를 설정하세요.';
  }catch(e){toast(e.message)}
}
async function loadExternalBackups(){
  try{
    const d=await api('/api/external-backup/list');
    $('#externalBackupList').innerHTML=(d.rows||[]).map(x=>`<div class="backup-row"><span><strong>${esc(x.name)}</strong><small>${x.updatedAt?new Date(x.updatedAt).toLocaleString('ko-KR'):''} · ${x.size?Math.round(x.size/1024)+'KB':''}</small></span><button data-externalrestore="${esc(x.name)}">이 시점으로 복원</button></div>`).join('')||'<p class="muted">Drive 백업 없음</p>';
    loadBackupStatus();
  }catch(e){toast(e.message,7000)}
}
$('#reloadExternalBackups')?.addEventListener('click',loadExternalBackups);
$('#externalBackupNow')?.addEventListener('click',async()=>{try{await api('/api/external-backup/now',{method:'POST',body:JSON.stringify({snapshot:false})});toast('Google Drive 최신백업 완료',6500);loadBackupStatus()}catch(e){toast(e.message,8000)}});
$('#externalSnapshotNow')?.addEventListener('click',async()=>{try{await api('/api/external-backup/now',{method:'POST',body:JSON.stringify({snapshot:true})});toast('Google Drive 시점백업 완료',6500);loadExternalBackups()}catch(e){toast(e.message,8000)}});
$('#externalRestoreLatest')?.addEventListener('click',async()=>{
  if(!confirm('Google Drive의 latest.json으로 현재 서버 상태를 복원할까요? 현재 상태는 복원 직전 로컬백업됩니다.'))return;
  try{const d=await api('/api/external-backup/restore',{method:'POST',body:JSON.stringify({name:'latest.json'})});toast(`Drive 복원 완료 · 참가자 ${d.participants}명`,8000);refreshDashboard();loadBackupStatus()}catch(e){toast(e.message,9000)}
});
$('#externalBackupList')?.addEventListener('click',async e=>{
  const b=e.target.closest('[data-externalrestore]');if(!b)return;
  if(!confirm(`${b.dataset.externalrestore} 시점으로 복원할까요?`))return;
  try{const d=await api('/api/external-backup/restore',{method:'POST',body:JSON.stringify({name:b.dataset.externalrestore})});toast(`Drive 복원 완료 · 참가자 ${d.participants}명`,8000);refreshDashboard()}catch(x){toast(x.message,9000)}
});


$('#backupNow').onclick=async()=>{try{const d=await api('/api/backup',{method:'POST',body:'{}'});$('#backupOutput').textContent=JSON.stringify(d,null,2);loadLocalBackups()}catch(e){toast(e.message)}};
async function downloadAuth(url,name){const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('다운로드 실패');const blob=await r.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
$('#downloadBackup').onclick=()=>downloadAuth('/api/backup/download',`nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`).catch(e=>toast(e.message));
$('#downloadCsv').onclick=()=>downloadAuth('/api/export/participants.csv','participants.csv').catch(e=>toast(e.message));

let currentCsvMergeId='';
$('#csvMergePreview')?.addEventListener('click',async()=>{
  const file=$('#csvMergeFile')?.files?.[0];if(!file)return toast('병합할 참가자 CSV를 선택해 주세요.');
  const btn=$('#csvMergePreview');btn.disabled=true;$('#csvMergeStatus').textContent='CSV 확인 중...';
  try{
    const fd=new FormData();fd.append('file',file);
    const d=await api('/api/import/participants-csv/preview',{method:'POST',body:fd});
    currentCsvMergeId=d.importId;$('#csvMergeConfirm').disabled=false;
    const warn=(d.warnings||[]).length?` · 경고 ${d.summary.warnings}건`:'';
    $('#csvMergeStatus').textContent=`${d.fileName} · 총 ${d.summary.rows}행 · 기존 갱신 ${d.summary.update}명 · 신규 추가 ${d.summary.add}명${warn}`;
    toast(`CSV 확인 완료 · 신규 ${d.summary.add}명 / 기존 ${d.summary.update}명`,7000);
  }catch(e){currentCsvMergeId='';$('#csvMergeConfirm').disabled=true;$('#csvMergeStatus').textContent=`오류: ${e.message}`;toast(e.message,8000)}
  finally{btn.disabled=false}
});
$('#csvMergeConfirm')?.addEventListener('click',async()=>{
  if(!currentCsvMergeId)return toast('먼저 CSV 확인을 실행해 주세요.');
  if(!confirm('CSV를 현재 명단에 병합할까요?\n기존 명단은 삭제하지 않으며, 반영 전에 자동 JSON 백업을 생성합니다.'))return;
  const btn=$('#csvMergeConfirm');btn.disabled=true;
  try{
    const d=await api('/api/import/participants-csv/confirm',{method:'POST',body:JSON.stringify({importId:currentCsvMergeId})});
    currentCsvMergeId='';$('#csvMergeStatus').textContent=`병합 완료 · 신규 ${d.added}명 · 기존 갱신 ${d.updated}명 · 전체 ${d.total}명`;
    toast(`CSV 병합 완료 · 신규 ${d.added}명 · 전체 ${d.total}명`,8000);await refreshDashboard();
  }catch(e){btn.disabled=false;toast(e.message,8000)}
});


$('#restoreBackup')?.addEventListener('click',async()=>{
  const file=$('#restoreFile')?.files?.[0];
  if(!file)return toast('복원할 JSON 백업 파일을 선택해 주세요.');
  if(!confirm('현재 서버 데이터를 선택한 백업 내용으로 교체할까요?\n복원 직전 자동백업도 생성합니다.'))return;

  const out=$('#backupOutput');
  if(out)out.textContent='백업 파일 업로드 및 복원 중...';
  const btn=$('#restoreBackup');
  if(btn)btn.disabled=true;

  const fd=new FormData();
  fd.append('file',file);

  try{
    const d=await api('/api/backup/restore',{method:'POST',body:fd});
    if(out)out.textContent=JSON.stringify(d,null,2);
    toast(`복원 완료 · 참가자 ${d.participants}명 · 좌석 ${d.seats}석`,7000);
    await refreshDashboard();
  }catch(e){
    if(out)out.textContent=`복원 실패: ${e.message}`;
    toast(e.message,7000);
  }finally{
    if(btn)btn.disabled=false;
  }
});


let currentXlsxImportId='';
function renderXlsxPreview(d){
  currentXlsxImportId=d.importId;
  $('#xlsxPreviewCard').classList.remove('hidden');
  $('#xlsxPreviewFileName').textContent=`${d.fileName} · 시트: ${d.sheets.join(', ')}`;
  const s=d.summary;
  const cards=[
    ['참가자',s.participants],['좌석',s.seats],['설정',s.settings],['기존 좌석배정',s.assignedSeats],['룰렛상품',s.rouletteProducts]
  ];
  $('#xlsxPreviewSummary').innerHTML=cards.map(([k,v])=>`<article class="stat"><span>${esc(k)}</span><strong>${esc(v)}</strong></article>`).join('');
  const warnings=[];
  if(s.duplicateQr)warnings.push(`중복 QR ${s.duplicateQr}건`);
  if(s.blankPhones)warnings.push(`연락처 공란 ${s.blankPhones}명`);
  $('#xlsxPreviewWarnings').innerHTML=warnings.length?`<div class="warning"><strong>확인 필요</strong><br>${warnings.map(esc).join(' · ')}</div>`:'<div class="successbox">기본 형식 검사에서 큰 문제를 찾지 못했습니다.</div>';
  $('#xlsxPreviewParticipants').innerHTML=d.sampleParticipants.map(p=>`<tr><td>${esc(p.receptionNo)}</td><td>${esc(p.name)}</td><td>${esc(p.phone||'-')}</td><td>${esc(p.organization||'-')}</td><td>${esc(displaySeat(p.seat)||(p.seatCategory==='standing'?'스탠딩석':'미배정'))}</td><td>${esc(p.participationStatus||'참여')}</td></tr>`).join('');
  $('#xlsxPreviewSeats').innerHTML=d.sampleSeats.map(s=>`<tr><td>${esc(s.code)}</td><td>${esc(s.zone||'-')}</td><td>${s.autoAssignable?'예':'아니오'}</td><td>${s.wheelchairAssignable?'예':'아니오'}</td><td>${s.enabled?'예':'아니오'}</td></tr>`).join('');
}
$('#xlsxPreviewBtn')?.addEventListener('click',async()=>{
  const file=$('#xlsxImportFile')?.files?.[0];
  if(!file)return toast('가져올 XLSX 파일을 먼저 선택해 주세요.');
  const btn=$('#xlsxPreviewBtn');btn.disabled=true;
  $('#xlsxImportStatus').textContent='엑셀을 분석하고 있습니다...';
  try{
    const fd=new FormData();fd.append('file',file);
    const d=await api('/api/import/xlsx/preview',{method:'POST',body:fd});
    renderXlsxPreview(d);
    $('#xlsxImportStatus').textContent=`미리보기 완료 · 참가자 ${d.summary.participants}명 · 좌석 ${d.summary.seats}석`;
    toast('엑셀 미리보기가 완료되었습니다.');
  }catch(e){
    $('#xlsxImportStatus').textContent=`오류: ${e.message}`;toast(e.message,7000);
  }finally{btn.disabled=false}
});
$('#xlsxConfirmBtn')?.addEventListener('click',async()=>{
  if(!currentXlsxImportId)return toast('먼저 엑셀 미리보기를 실행해 주세요.');
  if(!confirm('현재 서버 데이터를 자동 백업한 뒤 이 XLSX 내용으로 교체할까요?'))return;
  const btn=$('#xlsxConfirmBtn');btn.disabled=true;
  try{
    const d=await api('/api/import/xlsx/confirm',{method:'POST',body:JSON.stringify({importId:currentXlsxImportId})});
    currentXlsxImportId='';
    toast(`XLSX 반영 완료 · 참가자 ${d.participants}명 · 좌석 ${d.seats}석`,8000);
    $('#xlsxImportStatus').textContent=`최종 반영 완료 · 참가자 ${d.participants}명 · 좌석 ${d.seats}석`;
    await refreshDashboard();
    $('#xlsxPreviewCard').classList.add('hidden');
  }catch(e){toast(e.message,8000)}
  finally{btn.disabled=false}
});


let eventSource=null,eventRefreshTimer=null;
function currentViewName(){
  const v=document.querySelector('.view.active');return v?.id?.replace('view-','')||'dashboard';
}
function scheduleLiveRefresh(){
  if(document.hidden||scanBusy||!$('#modalWrap')?.classList.contains('hidden')||!$('#raffleStage')?.classList.contains('hidden'))return;
  clearTimeout(eventRefreshTimer);
  eventRefreshTimer=setTimeout(async()=>{
    const v=currentViewName();
    try{
      await refreshDashboard();
      if(v==='participants')loadParticipants();
      else if(v==='groups')loadGroups();
      else if(v==='seats')loadSeats();
      else if(v==='raffle')loadRaffle();
      else if(v==='sms')loadSms();
      else if(v==='logs')loadLogs();
      else if(v==='settings')loadSettings();
      else if(v==='backup')loadBackupStatus();
    }catch(_){}
  },300);
}
function connectLiveEvents(){
  if(eventSource){try{eventSource.close()}catch(_){}}
  if(!token)return;
  eventSource=new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  eventSource.addEventListener('state',scheduleLiveRefresh);
  eventSource.addEventListener('priority-arrival',e=>{
    try{
      const d=JSON.parse(e.data),p=d.participant||{};
      const msg=`${d.priority} 도착 · ${p.name||''}${p.seat?` · ${p.seat}`:''}${d.station?` · ${d.station}`:''}`;
      toast(msg,9000);
      const b=$('#systemModeBanner');if(b){b.innerHTML=`<strong>🔔 ${esc(msg)}</strong>`;b.classList.remove('hidden');setTimeout(()=>refreshDashboard().catch(()=>{}),9000)}
    }catch(_){}
  });
  eventSource.onerror=()=>{};
}

init();setInterval(()=>{if(token&&!document.hidden)refreshDashboard().catch(()=>{})},10000);

let deferredInstallPrompt=null;
function standaloneMode(){return window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true}
function syncInstallButton(){
  const b=$('#installApp');if(!b)return;
  if(standaloneMode()){b.classList.add('hidden');return}
  b.classList.remove('hidden');
}
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredInstallPrompt=e;syncInstallButton();
});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;syncInstallButton();toast('앱 설치가 완료되었습니다.')});
$('#installApp')?.addEventListener('click',async()=>{
  if(standaloneMode())return toast('이미 앱으로 실행 중입니다.');
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;syncInstallButton();return;
  }
  const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isiOS)toast('iPhone/iPad: Safari의 공유 버튼 → 홈 화면에 추가를 눌러주세요.',7000);
  else toast('브라우저 메뉴(⋮)에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해주세요.',7000);
});
syncInstallButton();
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js?v=0.9.34',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}));
}


// v0.8.3 fallback: 정적 버튼이 캐시/DOM 차이로 직접 바인딩되지 않은 경우에도 동작하도록 보조.
document.addEventListener('click',async e=>{
  const b=e.target.closest('button'); if(!b) return;
  try{
    if(b.id==='externalBackupNow' && !b.dataset.fallbackBusy){
      b.dataset.fallbackBusy='1'; setTimeout(()=>delete b.dataset.fallbackBusy,800);
      // 기존 리스너가 없는 환경에서만 사용: 버튼 클릭 후 상태가 갱신되지 않으면 직접 요청
      setTimeout(async()=>{
        if(document.hidden)return;
        try{await loadBackupStatus()}catch(_){}
      },900);
    }
  }catch(_){}
});


$('#stationBtn')?.addEventListener('click',()=>{
  const v=prompt('이 기기의 접수대 이름을 입력하세요.\n예: 접수대 1 / 배리어프리 / VIP 데스크',stationName==='미설정'?'':stationName);
  if(v&&v.trim()){stationName=v.trim();localStorage.setItem(STATION_KEY,stationName);$('#stationBtn').textContent=`접수대: ${stationName}`;toast(`이 기기 접수대: ${stationName}`)}
});

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-sms-history]');
  if(!b)return;
  try{
    const d=await api(`/api/participant/${encodeURIComponent(b.dataset.smsHistory)}/sms-history`);
    modal(`<p class="eyebrow">SMS HISTORY</p><h2>문자 발송 이력</h2>
      <div>${d.rows.length?d.rows.map(x=>`<div class="history-row"><strong>${esc(x.status)} · ${esc(x.kind||'')}</strong><small>${new Date(x.requestedAt).toLocaleString('ko-KR')}</small><div>${esc(x.message||'').slice(0,180)}</div>${x.status==='실패'?`<button data-retry-sms="${esc(x.id)}" class="primary">이 문자 재발송</button>`:''}</div>`).join(''):'<p class="muted">문자 발송 기록이 없습니다.</p>'}</div>
      <button data-close class="wide">닫기</button>`);
    $('[data-close]').onclick=closeModal;
  }catch(x){toast(x.message,7000)}
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-retry-sms]');if(!b)return;
  if(!confirm('이 문자를 다시 발송할까요?'))return;
  try{const d=await api(`/api/sms/retry/${encodeURIComponent(b.dataset.retrySms)}`,{method:'POST',body:'{}'});toast(d.ok?'재발송 성공':'재발송 실패',6500);closeModal()}catch(x){toast(x.message,7000)}
});

$('#toggleOperationMode')?.addEventListener('click',async()=>{
  const enabled=!Boolean(appSettings.eventOperationMode);
  const password=prompt(enabled?'행사 운영 잠금을 켭니다.\n관리자 비밀번호를 입력하세요.':'운영 잠금을 해제합니다.\n관리자 비밀번호를 입력하세요.');
  if(password==null)return;
  try{const d=await api('/api/operation-mode',{method:'POST',body:JSON.stringify({enabled,password})});appSettings.eventOperationMode=d.enabled;toast(d.enabled?'행사 운영 잠금 ON':'행사 운영 잠금 OFF');refreshDashboard()}catch(x){toast(x.message,7000)}
});

async function refreshHealthStrip(){
  const set=(id,text,ok=true)=>{const el=$(id);if(!el)return;el.textContent=text;el.className=ok?'health-ok':'health-bad'};
  set('#healthBrowser',navigator.onLine?'인터넷 ✅':'인터넷 ❌',navigator.onLine);
  try{
    const [h,b]=await Promise.all([fetch('/api/health',{cache:'no-store'}).then(r=>r.json()),token?api('/api/external-backup/status').catch(()=>null):null]);
    set('#healthServer',h.ok?'서버 ✅':'서버 ❌',Boolean(h.ok));
    set('#healthSms',h.smsReady?'문자 ✅':'문자 ⚠',Boolean(h.smsReady));
    const bok=b?.lastSuccessAt||b?.configured;
    set('#healthBackup',bok?'백업 ✅':'백업 ⚠',Boolean(bok));
  }catch(_){set('#healthServer','서버 ❌',false)}
}
window.addEventListener('online',refreshHealthStrip);window.addEventListener('offline',refreshHealthStrip);
setInterval(()=>{if(token&&!document.hidden)refreshHealthStrip()},15000);

$('#openRaffleStage')?.addEventListener('click',async()=>{
  try{
    const d=await api('/api/raffle/stage-link');
    window.open(d.url,'nyjwelRaffleStage','noopener,noreferrer');
  }catch(x){toast(x.message,7000)}
});

$('#openDemo')?.addEventListener('click',()=>{
  window.open('/demo.html','nyjwelFeatureDemo','noopener,noreferrer');
});

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-resetauto]');if(!b)return;
  if(!confirm('직접 수정한 내용을 버리고 원래 자동묶음 규칙으로 되돌릴까요?'))return;
  try{
    await api(`/api/groups/${encodeURIComponent(b.dataset.resetauto)}/reset-auto`,{method:'POST',body:'{}'});
    toast('자동묶음 규칙으로 되돌렸습니다.');loadGroups();refreshDashboard();
  }catch(x){toast(x.message,7000)}
});
