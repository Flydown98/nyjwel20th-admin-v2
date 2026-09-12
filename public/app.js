'use strict';
const TOKEN_KEY='nyj20_v2_token';let token=localStorage.getItem(TOKEN_KEY)||'',scanner=null,scannerOn=false,scanBusy=false;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
function toast(m,ms=3500){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(toast.tm);toast.tm=setTimeout(()=>t.classList.add('hidden'),ms)}
async function api(p,o={}){const h={...(o.headers||{})};if(o.body&&!(o.body instanceof FormData)&&!h['Content-Type'])h['Content-Type']='application/json';if(token)h.Authorization=`Bearer ${token}`;const r=await fetch(p,{...o,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);Object.assign(e,d);throw e}return d}
function modal(html){$('#modal').innerHTML=html;$('#modalWrap').classList.remove('hidden')}
function closeModal(){clearTimeout(window.__autoCheckinTimer);$('#modalWrap').classList.add('hidden');$('#modal').innerHTML=''}
$('#modalWrap').addEventListener('click',e=>{if(e.target.id==='modalWrap')closeModal()});

async function refreshDashboard(){const d=await api('/api/bootstrap'),s=d.summary;$('#sParticipants').textContent=s.participants;$('#sActive').textContent=s.active;$('#sArrived').textContent=s.arrived;$('#sOnsite').textContent=s.onsite;$('#sGroups').textContent=s.groups;$('#sSeats').textContent=s.assignedSeats;$('#sGifts').textContent=s.giftsReceived;$('#sSms').textContent=s.smsPending;$('#statusBadge').textContent='연결됨 · v0.4.2';$('#statusBadge').classList.add('ok')}
async function init(){try{await refreshDashboard();$('#loginOverlay').classList.add('hidden')}catch(e){if(/로그인/.test(e.message)){token='';localStorage.removeItem(TOKEN_KEY);$('#loginOverlay').classList.remove('hidden')}}}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});token=d.token;localStorage.setItem(TOKEN_KEY,token);await init()}catch(e){$('#loginMessage').textContent=e.message}});
$('#logoutBtn').onclick=()=>{token='';localStorage.removeItem(TOKEN_KEY);$('#loginOverlay').classList.remove('hidden')};$('#topRefresh').onclick=()=>refreshDashboard().then(()=>toast('갱신했습니다.'));
function view(n){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${n}`));document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x.dataset.view===n));if(n==='participants')loadParticipants();if(n==='groups')loadGroups();if(n==='seats')loadSeats();if(n==='raffle')loadRaffle();if(n==='sms')loadSms()}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>view(b.dataset.view));

async function processCode(code){
  if(scanBusy)return;scanBusy=true;
  try{
    const d=await api('/api/checkin/lookup',{method:'POST',body:JSON.stringify({code})});
    if(d.group)showGroupCheckin(d.participant,d.group);
    else showIndividualCheckin(d.participant);
  }catch(e){toast(e.message,5000)}
  finally{scanBusy=false}
}
function showIndividualCheckin(p){
  modal(`<p class="eyebrow">개인 QR 접수</p><h2>${esc(p.name)}</h2><p>${esc(p.organization||'소속 없음')} · ${esc(p.phone||'연락처 없음')}</p><div class="notice">좌석 ${esc(p.seat||'자동배정 예정')} · 기념품 지급완료 처리</div><p class="muted">개인 접수는 잠시 후 자동으로 진행됩니다. 아래 버튼을 누르면 즉시 처리합니다.</p><div class="actions"><button data-now class="primary">바로 접수</button><button data-close>닫기</button></div><div id="modalProgress" class="muted">자동 접수 준비 중...</div>`);
  let done=false;
  const run=async()=>{if(done)return;done=true;clearTimeout(window.__autoCheckinTimer);try{const r=await api('/api/checkin/individual',{method:'POST',body:JSON.stringify({code:p.id,station:'QR접수'})});$('#modalProgress').innerHTML=`<div class="successbox"><strong>${esc(r.participant.name)} ${r.already?'이미 접수됨':'접수 완료'}</strong><br>좌석 ${esc(r.participant.seat||'스탠딩')} · ${r.already?'최초 접수 상태 유지':'기념품 지급완료 · 좌석안내 문자 발송요청'}</div>`;$('#recentResult').textContent=`${r.participant.name} · ${r.participant.seat||'스탠딩'} · ${r.already?'이미 접수됨':'접수완료'}`;refreshDashboard();setTimeout(closeModal,850)}catch(e){$('#modalProgress').innerHTML=`<div class="warning">${esc(e.message)}</div>`}};
  $('[data-now]').onclick=run;$('[data-close]').onclick=closeModal;window.__autoCheckinTimer=setTimeout(run,1400);
}
function showGroupCheckin(p,g){
  const remaining=g.members.filter(x=>!x.arrived).length,registered=g.total,already=g.arrived;
  let n=Math.max(1,remaining);
  const render=()=>{const seats=Math.min(n,remaining),extra=Math.max(0,n-remaining);$('#stepN').textContent=n;$('#stepInfo').innerHTML=`이번 좌석 배정 <strong>${seats}석</strong>${extra?` · 추가 ${extra}명은 <strong>스탠딩</strong>`:''}`};
  modal(`<p class="eyebrow">단체 QR 접수</p><h2>${esc(g.name||g.organization||p.organization)}</h2><div class="notice">사전등록 ${registered}명 · 이미도착 ${already}명 · 남은등록 ${remaining}명</div><p>이번에 실제로 함께 도착한 인원을 − / + 로 조절하세요.</p><div class="stepper"><button id="minus">−</button><strong id="stepN">${n}</strong><button id="plus">＋</button></div><div id="stepInfo" class="result"></div><div class="actions" style="margin-top:16px"><button id="confirmGroup" class="primary">이 인원으로 접수</button><button id="cancelGroup">취소</button></div>`);
  $('#minus').onclick=()=>{n=Math.max(1,n-1);render()};$('#plus').onclick=()=>{n=Math.min(99,n+1);render()};$('#cancelGroup').onclick=closeModal;
  $('#confirmGroup').onclick=async()=>{try{const r=await api('/api/checkin/group',{method:'POST',body:JSON.stringify({groupId:g.id,actualCount:n,station:'QR접수'})});$('#modal').innerHTML=`<h2>단체 접수 완료</h2><div class="successbox">실제 도착 ${r.actualCount}명<br>등록 참가자 접수 ${r.checkedInNow}명<br>좌석 ${r.seats.length}석${r.extraStanding?`<br>추가 ${r.extraStanding}명 스탠딩 안내`:''}<br>기념품 ${r.actualCount}명 지급완료</div><button id="doneGroup" class="primary wide">확인</button>`;$('#doneGroup').onclick=closeModal;refreshDashboard();setTimeout(closeModal,1600)}catch(e){toast(e.message,6000)}};
  render();
}
$('#manualQrForm').onsubmit=e=>{e.preventDefault();processCode($('#manualQr').value.trim());$('#manualQr').select()};
$('#toggleScanner').onclick=async()=>{
  if(scannerOn){try{await scanner.stop();await scanner.clear()}catch(_){}scannerOn=false;$('#toggleScanner').textContent='카메라 시작';$('#reader').innerHTML='카메라를 시작하거나 오른쪽에서 QR코드를 직접 입력하세요.';return}
  if(typeof Html5Qrcode==='undefined')return toast('QR 라이브러리를 불러오지 못했습니다.');
  scanner=new Html5Qrcode('reader');try{await scanner.start({facingMode:'environment'},{fps:18,qrbox:{width:260,height:260}},text=>processCode(text),()=>{});scannerOn=true;$('#toggleScanner').textContent='카메라 종료'}catch(e){toast('카메라 권한을 확인해 주세요.')}
};

async function loadParticipants(){const q=$('#participantSearch').value.trim(),st=$('#participantStatus').value;try{const d=await api(`/api/participants?q=${encodeURIComponent(q)}&status=${st}`);$('#participantCount').textContent=`${d.total}명`;$('#participantRows').innerHTML=d.rows.map(p=>`<tr><td>${p.receptionNo}</td><td><strong>${esc(p.name)}</strong><small>${esc(p.id)}</small></td><td>${esc(p.phone||'-')}</td><td>${esc(p.organization||'-')}</td><td>${esc(p.seat||'미배정')}</td><td>${p.wheelchairUser?'♿ ':''}${p.onsite?'현장':''}</td><td>${p.arrived?'<b>도착</b>':'미도착'}</td><td><button data-check="${esc(p.id)}">접수</button>${p.arrived?` <button data-undo="${esc(p.id)}">취소</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8">없음</td></tr>'}catch(e){toast(e.message)}}
$('#reloadParticipants').onclick=loadParticipants;$('#participantSearch').oninput=()=>{clearTimeout(loadParticipants.tm);loadParticipants.tm=setTimeout(loadParticipants,250)};$('#participantStatus').onchange=loadParticipants;
$('#participantRows').onclick=async e=>{const c=e.target.closest('[data-check]'),u=e.target.closest('[data-undo]');if(c)processCode(c.dataset.check);if(u&&confirm('접수를 취소하고 좌석·기념품 상태도 되돌릴까요?')){try{await api('/api/checkin/undo',{method:'POST',body:JSON.stringify({code:u.dataset.undo})});loadParticipants();refreshDashboard()}catch(x){toast(x.message)}}};

$('#onsiteForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());b.wheelchairUser=f.has('wheelchairUser');b.disabledPerson=f.has('disabledPerson');try{const d=await api('/api/participants/onsite',{method:'POST',body:JSON.stringify(b)});toast(`${d.participant.name} 현장등록 완료 · 스탠딩 안내`,6000);e.currentTarget.reset();e.currentTarget.station.value='현장접수';refreshDashboard()}catch(x){toast(x.message,6000)}};

async function loadGroups(){try{const [s,g]=await Promise.all([api('/api/group-suggestions'),api('/api/groups')]);$('#groupSuggestions').innerHTML=s.rows.slice(0,80).map(x=>`<div class="suggestion"><strong>${esc(x.organization)}</strong><small>${x.count}명 · 미지정 ${x.ungrouped}명</small><button data-org="${esc(x.organization)}">이 기관을 단체로 지정</button></div>`).join('')||'<p class="muted">후보 없음</p>';$('#groupList').innerHTML=g.rows.map(x=>`<div class="group-card"><strong>${esc(x.name||x.organization)}</strong><small>등록 ${x.total}명 · 도착 ${x.arrived}명 · 추가 스탠딩 ${x.extraStanding||0}명</small><div class="group-members">${x.members.map(m=>`<span>${m.arrived?'✓':'○'} ${esc(m.name)}</span>`).join('')}</div><button data-delgroup="${x.id}">단체 해제</button></div>`).join('')||'<p class="muted">지정된 단체 없음</p>'}catch(e){toast(e.message)}}
$('#reloadGroups').onclick=loadGroups;$('#groupSuggestions').onclick=async e=>{const b=e.target.closest('[data-org]');if(!b)return;const org=b.dataset.org;if(!confirm(`${org} 소속 참가자들을 하나의 단체로 지정할까요?\n연락처가 있는 첫 참가자를 대표자로 사용합니다.`))return;try{await api('/api/groups/create-by-organization',{method:'POST',body:JSON.stringify({organization:org})});toast('단체로 지정했습니다.');loadGroups();refreshDashboard()}catch(x){toast(x.message,6000)}};
$('#groupList').onclick=async e=>{const b=e.target.closest('[data-delgroup]');if(!b||!confirm('이 단체 지정을 해제할까요?'))return;try{await api(`/api/groups/${b.dataset.delgroup}/delete`,{method:'POST',body:'{}'});loadGroups();refreshDashboard()}catch(x){toast(x.message)}};

function seatZoneClass(s){
  const m=String(s.code||'').toUpperCase().match(/^([A-Y])([LR])-(\d{2})$/);
  if(!m)return '';
  const row=m[1],side=m[2],n=Number(m[3]);
  if(['A','B','C'].includes(row)){
    if(side==='L') return n<=5 ? 'wheelchair' : 'vip';
    return n<=5 ? 'vip' : 'wheelchair';
  }
  if(['D','E','F'].includes(row)) return 'guest';
  return '';
}
function seatCellHtml(s){
  if(!s)return '<div class="seat-cell disabled"><strong>-</strong><span class="seat-name">미사용</span></div>';
  const z=seatZoneClass(s);
  const cls=['seat-cell',z,!s.enabled?'disabled':'',s.arrived?'arrived':(s.occupied?'assigned':'')].filter(Boolean).join(' ');
  const name=s.participant?.name || (s.occupied?'배정':'빈좌석');
  return `<div class="${cls}" title="${esc(s.participant?.name||s.note||'')}"><strong>${esc(s.code)}</strong><span class="seat-name">${esc(name)}</span></div>`;
}
async function loadSeats(){
  try{
    const d=await api('/api/seats');
    $('#seatCount').textContent=`전체 ${d.total}석 · 배정 ${d.assigned||0}석 · 도착 ${d.arrivedAssigned||0}석`;
    const byCode=new Map(d.rows.map(s=>[String(s.code).toUpperCase(),s]));
    const rows='ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
    $('#seatGrid').innerHTML=rows.map(row=>{
      const left=Array.from({length:10},(_,i)=>seatCellHtml(byCode.get(`${row}L-${String(i+1).padStart(2,'0')}`))).join('');
      const right=Array.from({length:10},(_,i)=>seatCellHtml(byCode.get(`${row}R-${String(i+1).padStart(2,'0')}`))).join('');
      return `<div class="seat-row">
        <div class="seat-row-label">${row}</div>
        <div class="seat-side">${left}</div>
        <div class="runway">RUNWAY</div>
        <div class="seat-side">${right}</div>
      </div>`;
    }).join('');
  }catch(e){toast(e.message)}
}
$('#reloadSeats').onclick=loadSeats;
$('#releasePendingSeats').onclick=async()=>{if(!confirm('미도착 참가자에게 현재 배정된 좌석을 모두 해제할까요?\n도착자 좌석은 유지됩니다.'))return;try{const d=await api('/api/seats/release-pending',{method:'POST',body:'{}'});toast(`${d.released}석 해제 완료`,5000);loadSeats();refreshDashboard()}catch(e){toast(e.message)}};

async function loadRaffle(){try{const [p,h]=await Promise.all([api('/api/raffle/products'),api('/api/raffle/history')]);$('#raffleProduct').innerHTML=p.rows.filter(x=>x.enabled).map(x=>`<option value="${esc(x.number)}">${esc(x.name)} · ${x.quantity}개</option>`).join('')||'<option value="custom">행운상품</option>';$('#raffleHistory').innerHTML=h.rows.slice(0,30).map(x=>`<div class="history-row"><strong>${esc(x.prizeName)} · ${esc(x.participantName)}</strong><small>${esc(x.seat||'좌석없음')} · ${new Date(x.drawnAt).toLocaleString('ko-KR')}</small>${x.received?'<b>수령완료</b>':`<button data-redeem="${x.drawId}" data-pid="${x.participantId}">수령완료</button>`}</div>`).join('')||'<p class="muted">아직 당첨 기록이 없습니다.</p>'}catch(e){toast(e.message)}}
$('#raffleForm').onsubmit=async e=>{e.preventDefault();if(!confirm('현재 도착 완료 참가자 중에서 추첨할까요?'))return;try{const d=await api('/api/raffle/draw',{method:'POST',body:JSON.stringify({productNo:$('#raffleProduct').value,count:Number($('#raffleCount').value)})});$('#raffleWinners').innerHTML=`<div class="successbox"><h3>${esc(d.product.name)}</h3>${d.winners.map(x=>`<p><strong>${esc(x.participantName)}</strong> · ${esc(x.seat||'좌석없음')}</p>`).join('')}</div>`;loadRaffle()}catch(x){toast(x.message,6000)}};
$('#raffleHistory').onclick=async e=>{const b=e.target.closest('[data-redeem]');if(!b)return;try{await api('/api/raffle/redeem',{method:'POST',body:JSON.stringify({drawId:b.dataset.redeem,participantId:b.dataset.pid})});loadRaffle()}catch(x){toast(x.message)}};

async function loadSms(){
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

$('#backupNow').onclick=async()=>{try{const d=await api('/api/backup',{method:'POST',body:'{}'});$('#backupOutput').textContent=JSON.stringify(d,null,2)}catch(e){toast(e.message)}};
async function downloadAuth(url,name){const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('다운로드 실패');const blob=await r.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
$('#downloadBackup').onclick=()=>downloadAuth('/api/backup/download',`nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`).catch(e=>toast(e.message));
$('#downloadCsv').onclick=()=>downloadAuth('/api/export/participants.csv','participants.csv').catch(e=>toast(e.message));


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

init();setInterval(()=>{if(token&&!document.hidden)refreshDashboard().catch(()=>{})},10000);

let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredInstallPrompt=e;
  $('#installApp')?.classList.remove('hidden');
});
$('#installApp')?.addEventListener('click',async()=>{
  if(!deferredInstallPrompt){toast('이 브라우저에서는 홈 화면 추가 메뉴를 이용해 주세요.');return}
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  $('#installApp')?.classList.add('hidden');
});
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
