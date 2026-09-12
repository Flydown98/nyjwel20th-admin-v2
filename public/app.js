'use strict';
const TOKEN_KEY='nyj20_v2_token';let token=localStorage.getItem(TOKEN_KEY)||'',scanner=null,scannerOn=false,scanBusy=false;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
function toast(m,ms=3500){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(toast.tm);toast.tm=setTimeout(()=>t.classList.add('hidden'),ms)}
async function api(p,o={}){const h={...(o.headers||{})};if(o.body&&!(o.body instanceof FormData)&&!h['Content-Type'])h['Content-Type']='application/json';if(token)h.Authorization=`Bearer ${token}`;const r=await fetch(p,{...o,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||`HTTP ${r.status}`);Object.assign(e,d);throw e}return d}
function modal(html){$('#modal').innerHTML=html;$('#modalWrap').classList.remove('hidden')}
function closeModal(){clearTimeout(window.__autoCheckinTimer);$('#modalWrap').classList.add('hidden');$('#modal').innerHTML=''}
$('#modalWrap').addEventListener('click',e=>{if(e.target.id==='modalWrap')closeModal()});

async function refreshDashboard(){const d=await api('/api/bootstrap'),s=d.summary;$('#sParticipants').textContent=s.participants;$('#sActive').textContent=s.active;$('#sArrived').textContent=s.arrived;$('#sOnsite').textContent=s.onsite;$('#sGroups').textContent=s.groups;$('#sSeats').textContent=s.assignedSeats;$('#sGifts').textContent=s.giftsReceived;$('#sSms').textContent=s.smsPending;$('#statusBadge').textContent='연결됨 · v0.5';$('#statusBadge').classList.add('ok')}
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


async function loadParticipants(){
  const q=$('#participantSearch').value.trim(),st=$('#participantStatus').value;
  try{
    const d=await api(`/api/participants?q=${encodeURIComponent(q)}&status=${st}`);
    $('#participantCount').textContent=`${d.total}명`;
    $('#participantRows').innerHTML=d.rows.map(p=>`<tr>
      <td>${p.receptionNo}</td>
      <td><strong>${esc(p.name)}</strong><small>${esc(p.id)}</small></td>
      <td>${esc(p.phone||'-')}</td><td>${esc(p.organization||'-')}</td>
      <td>${esc(p.seat||'미배정')}</td>
      <td>${p.wheelchairUser?'♿ ':''}${p.disabledPerson?'장애인당사자 ':''}${p.usesCenter?'복지관이용 ':''}${p.onsite?'현장접수':''}</td>
      <td>${p.arrived?'<b class="yes">도착</b>':(p.participationStatus==='미참여'||p.active===false?'<span class="no">미참여</span>':'미도착')}</td>
      <td><button data-edit="${esc(p.id)}">수정</button> <button data-check="${esc(p.id)}">접수</button>${p.arrived?` <button data-undo="${esc(p.id)}">접수취소</button>`:''}</td>
    </tr>`).join('')||'<tr><td colspan="8">없음</td></tr>';
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
        <label>좌석<input value="${esc(p.seat||'미배정')}" disabled></label>
        <label>도착상태<select name="arrived"><option value="true" ${p.arrived?'selected':''}>도착</option><option value="false" ${!p.arrived?'selected':''}>미도착</option></select></label>
        <label class="check"><input type="checkbox" name="wheelchairUser" ${p.wheelchairUser?'checked':''}> 휠체어 이용</label>
        <label class="check"><input type="checkbox" name="disabledPerson" ${p.disabledPerson?'checked':''}> 장애인 당사자</label>
        <label class="check"><input type="checkbox" name="usesCenter" ${p.usesCenter?'checked':''}> 복지관 이용</label>
        <label class="check"><input type="checkbox" name="active" ${p.active!==false?'checked':''}> 활성</label>
        <label class="wide-field">메모<textarea name="note" rows="3">${esc(p.note||'')}</textarea></label>
        <div class="wide-field actions"><button class="primary">저장</button><button type="button" id="participantEditClose">닫기</button></div>
      </form>`);
    $('#participantEditClose').onclick=closeModal;
    $('#participantEditForm').onsubmit=async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());
      b.wheelchairUser=f.has('wheelchairUser');b.disabledPerson=f.has('disabledPerson');b.usesCenter=f.has('usesCenter');b.active=f.has('active');b.arrived=b.arrived==='true';
      try{await api(`/api/participants/${encodeURIComponent(id)}/admin-update`,{method:'POST',body:JSON.stringify(b)});toast('참가자 정보를 저장했습니다.');closeModal();loadParticipants();refreshDashboard()}catch(x){toast(x.message,6000)}
    };
  }catch(e){toast(e.message)}
}
$('#reloadParticipants').onclick=loadParticipants;
$('#participantSearch').oninput=()=>{clearTimeout(loadParticipants.tm);loadParticipants.tm=setTimeout(loadParticipants,250)};
$('#participantStatus').onchange=loadParticipants;
$('#participantRows').onclick=async e=>{
  const edit=e.target.closest('[data-edit]'),c=e.target.closest('[data-check]'),u=e.target.closest('[data-undo]');
  if(edit)return openParticipantEdit(edit.dataset.edit);
  if(c)return processCode(c.dataset.check);
  if(u&&confirm('접수를 취소하고 좌석·기념품 상태도 되돌릴까요?')){
    try{await api('/api/checkin/undo',{method:'POST',body:JSON.stringify({code:u.dataset.undo})});loadParticipants();refreshDashboard()}catch(x){toast(x.message)}
  }
};

$('#onsiteForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),b=Object.fromEntries(f.entries());b.wheelchairUser=f.has('wheelchairUser');b.disabledPerson=f.has('disabledPerson');try{const d=await api('/api/participants/onsite',{method:'POST',body:JSON.stringify(b)});toast(`${d.participant.name} 현장등록 완료 · 스탠딩 안내`,6000);e.currentTarget.reset();e.currentTarget.station.value='현장접수';refreshDashboard()}catch(x){toast(x.message,6000)}};


let groupManageCache=[];
async function loadGroups(){
  try{
    const [s,g]=await Promise.all([api('/api/group-suggestions'),api('/api/groups/manage')]);
    groupManageCache=g.rows;
    $('#groupSuggestions').innerHTML=s.rows.slice(0,100).map(x=>`<div class="management-card"><div class="top"><div><strong>${esc(x.organization)}</strong><small>${x.count}명 · 미지정 ${x.ungrouped}명</small></div><button data-org="${esc(x.organization)}">기관그룹 활성화</button></div></div>`).join('')||'<p class="muted">기관 그룹 후보가 없습니다.</p>';
    const reps=g.rows.filter(x=>x.type!=='companion');
    const comps=g.rows.filter(x=>x.type==='companion');
    $('#representativeGroups').innerHTML=reps.map(groupCardHtml).join('')||'<p class="muted">대표자/기관 그룹이 없습니다.</p>';
    $('#companionGroups').innerHTML=comps.map(groupCardHtml).join('')||'<p class="muted">동반신청 그룹이 없습니다.</p>';
  }catch(e){toast(e.message)}
}
function groupCardHtml(g){
  return `<div class="management-card" data-group="${esc(g.id)}">
    <div class="top"><div><strong>${esc(g.name||g.organization||g.id)}</strong><small>${g.type==='companion'?'동반신청':'대표자/기관'} · 등록 ${g.total}명 · 도착 ${g.arrived}명 · 대표 ${esc(g.representative?.name||'-')}</small></div>
    <div class="actions"><button data-editgroup="${esc(g.id)}">수정</button><button data-delgroup="${esc(g.id)}">그룹 해제</button></div></div>
    <div class="member-list">${g.members.map(m=>`<span class="member-chip ${m.id===g.representativeId?'rep':''}">${m.arrived?'✓':'○'} ${esc(m.name)}${m.id===g.representativeId?' · 대표':''}</span>`).join('')}</div>
  </div>`;
}
async function openGroupEditor(groupId=''){
  const group=groupManageCache.find(x=>x.id===groupId)||null;
  const selected=new Set(group?.memberIds||[]);
  const searchAndRender=async()=>{
    const q=$('#groupMemberSearch').value.trim(),d=await api(`/api/participants/search?q=${encodeURIComponent(q)}`);
    $('#groupMemberList').innerHTML=d.rows.map(p=>`<label class="participant-pick"><input type="checkbox" value="${esc(p.id)}" ${selected.has(p.id)?'checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · ${esc(p.phone||'')} · ${esc(p.seat||'미배정')}</small></span></label>`).join('');
    $('#groupMemberList').querySelectorAll('input').forEach(ch=>ch.onchange=()=>{ch.checked?selected.add(ch.value):selected.delete(ch.value);renderRep()});
  };
  const renderRep=()=>{
    const opts=[...selected].map(id=>{const p=stateParticipantFromCache(id);return `<option value="${esc(id)}" ${id===group?.representativeId?'selected':''}>${esc(p?.name||id)}</option>`}).join('');
    $('#groupRepresentative').innerHTML=opts||'<option value="">구성원을 선택하세요.</option>';
  };
  modal(`<p class="eyebrow">GROUP EDITOR</p><h2>${group?'그룹 수정':'대표자 그룹 만들기'}</h2>
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
  const b=e.target.closest('[data-org]');if(!b)return;const org=b.dataset.org;
  if(!confirm(`${org} 소속 참가자를 기관 그룹으로 활성화할까요?`))return;
  try{await api('/api/groups/create-by-organization',{method:'POST',body:JSON.stringify({organization:org,name:org})});toast('기관 그룹을 활성화했습니다.');loadGroups();refreshDashboard()}catch(x){toast(x.message,6000)}
};
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
  const m=String(s.code||'').toUpperCase().match(/^([A-Y])([LR])-(\d{2})$/);if(!m)return '';
  const row=m[1],side=m[2],n=Number(m[3]);
  if(['A','B','C'].includes(row)){if(side==='L')return n<=5?'wheelchair':'vip';return n<=5?'vip':'wheelchair'}
  if(['D','E','F'].includes(row))return 'guest';return '';
}
function seatCellHtml(s){
  if(!s)return '<div class="seat-cell disabled"><strong>-</strong><span class="seat-name">미사용</span></div>';
  const z=seatZoneClass(s),cls=['seat-cell',z,!s.enabled?'disabled':'',s.arrived?'arrived':(s.occupied?'assigned':'')].filter(Boolean).join(' ');
  const name=s.participant?.name||(s.occupied?'배정':'빈좌석');
  return `<div class="${cls}" data-seat="${esc(s.code)}" title="${esc(s.participant?.name||s.note||'')}"><strong>${esc(s.code)}</strong><span class="seat-name">${esc(name)}</span></div>`;
}
async function loadSeats(){
  try{
    const d=await api('/api/seats');seatCache=d.rows;
    $('#seatCount').textContent=`전체 ${d.total}석 · 배정 ${d.assigned||0}석 · 도착 ${d.arrivedAssigned||0}석`;
    const byCode=new Map(d.rows.map(s=>[String(s.code).toUpperCase(),s])),rows='ABCDEFGHIJKLMNOPQRSTUVWXY'.split('');
    $('#seatGrid').innerHTML=rows.map(row=>{
      const left=Array.from({length:10},(_,i)=>seatCellHtml(byCode.get(`${row}L-${String(i+1).padStart(2,'0')}`))).join('');
      const right=Array.from({length:10},(_,i)=>seatCellHtml(byCode.get(`${row}R-${String(i+1).padStart(2,'0')}`))).join('');
      return `<div class="seat-row"><div class="seat-row-label">${row}</div><div class="seat-side">${left}</div><div class="runway">RUNWAY</div><div class="seat-side">${right}</div></div>`;
    }).join('');
  }catch(e){toast(e.message)}
}
async function openSeatManager(code){
  const s=seatCache.find(x=>x.code===code);if(!s)return;
  modal(`<p class="eyebrow">SEAT MANAGER</p><h2>${esc(code)}</h2>
    <div class="notice">${s.participant?`현재 배정: <strong>${esc(s.participant.name)}</strong> · ${s.arrived?'도착완료':'미도착'}`:'현재 빈좌석입니다.'}</div>
    <label>참가자 검색<input id="seatParticipantSearch" placeholder="이름 / 기관 / 연락처 / QR"></label>
    <div id="seatParticipantList" class="participant-pick-list"></div>
    <div class="actions">${s.participant?'<button id="releaseSeat" class="danger">이 좌석 해제</button>':''}<button id="closeSeatManager">닫기</button></div>`);
  $('#closeSeatManager').onclick=closeModal;
  const render=async()=>{
    const d=await api(`/api/participants/search?q=${encodeURIComponent($('#seatParticipantSearch').value.trim())}`);
    $('#seatParticipantList').innerHTML=d.rows.slice(0,60).map(p=>`<div class="participant-pick"><span style="flex:1"><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · 현재 ${esc(p.seat||'미배정')}</small></span><button data-seatassign="${esc(p.id)}">이 좌석 지정</button></div>`).join('');
  };
  $('#seatParticipantSearch').oninput=()=>{clearTimeout(render.tm);render.tm=setTimeout(render,200)};await render();
  $('#seatParticipantList').onclick=async e=>{
    const b=e.target.closest('[data-seatassign]');if(!b)return;
    const p=(await api(`/api/participant/${encodeURIComponent(b.dataset.seatassign)}`)).participant;
    let mode='swap';
    if(s.participant&&s.participant.id!==p.id){
      mode=confirm(`${code}에는 ${s.participant.name}님이 있습니다.\n${p.name}님의 기존 좌석과 교환할까요?\n\n확인=교환 / 취소=기존 참가자를 미배정으로 하고 지정`) ? 'swap':'replace';
    }
    try{await api(`/api/seats/${encodeURIComponent(code)}/assign`,{method:'POST',body:JSON.stringify({participantId:p.id,mode})});toast('좌석을 지정했습니다.');closeModal();loadSeats();refreshDashboard()}catch(x){toast(x.message,6000)}
  };
  if($('#releaseSeat'))$('#releaseSeat').onclick=async()=>{if(!confirm(`${s.participant.name}님의 ${code} 좌석을 해제할까요?`))return;try{await api(`/api/seats/${encodeURIComponent(code)}/release`,{method:'POST',body:'{}'});closeModal();loadSeats();refreshDashboard()}catch(x){toast(x.message)}};
}
$('#seatGrid').onclick=e=>{const cell=e.target.closest('[data-seat]');if(cell)openSeatManager(cell.dataset.seat)};
$('#reloadSeats').onclick=loadSeats;
$('#releasePendingSeats').onclick=async()=>{if(!confirm('미도착 참가자의 현재 좌석을 모두 해제할까요? 도착자 좌석은 유지됩니다.'))return;try{const d=await api('/api/seats/release-pending',{method:'POST',body:'{}'});toast(`${d.released}석 해제 완료`,5000);loadSeats();refreshDashboard()}catch(e){toast(e.message)}};
$('#showUnassigned').onclick=async()=>{
  try{const d=await api('/api/participants/unassigned');modal(`<p class="eyebrow">UNASSIGNED</p><h2>미배정 참가자 ${d.total}명</h2><div class="unassigned-list">${d.rows.map(p=>`<div class="unassigned-row"><span><strong>${esc(p.name)}</strong><small>${esc(p.organization||'')} · ${p.arrived?'도착':'미도착'}</small></span><span>${p.wheelchairUser?'♿':''}</span></div>`).join('')}</div><button id="closeUnassigned" class="wide">닫기</button>`);$('#closeUnassigned').onclick=closeModal}catch(e){toast(e.message)}
};
$('#autoAssignAll').onclick=async()=>{
  if(!confirm('현재 미배정 참가자를 좌석설정의 자동배정 가능 좌석에 일괄 배치할까요?\n대표자/동반 그룹은 가능한 경우 연속좌석을 우선합니다.'))return;
  try{const d=await api('/api/seats/auto-assign-unassigned',{method:'POST',body:JSON.stringify({onlyArrived:false})});toast(`일괄배치 완료 · ${d.assigned}명 · 남은 미배정 ${d.remaining}명`,7000);loadSeats();refreshDashboard()}catch(e){toast(e.message,7000)}
};

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
