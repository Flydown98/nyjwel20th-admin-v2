'use strict';
const $=s=>document.querySelector(s);
const form=$('#lookupForm'),button=$('#lookupButton'),message=$('#message'),lookupCard=$('#lookupCard'),inviteCard=$('#inviteCard');
function formatPhone(v){const d=String(v||'').replace(/\D/g,'').slice(0,11);if(d.length<=3)return d;if(d.length<=7)return `${d.slice(0,3)}-${d.slice(3)}`;return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`}
$('#lookupPhone').addEventListener('input',e=>{e.target.value=formatPhone(e.target.value)});
form.addEventListener('submit',async e=>{
  e.preventDefault();message.textContent='';button.disabled=true;button.textContent='확인 중...';
  try{
    const r=await fetch('/api/public/invite-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#lookupName').value,phone:$('#lookupPhone').value})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.ok)throw new Error(data.error||'초대장을 확인하지 못했습니다.');
    renderInvite(data.invite);
  }catch(err){message.textContent=err.message||'조회 중 오류가 발생했습니다.'}
  finally{button.disabled=false;button.textContent='초대장 확인하기'}
});
function renderInvite(x){
  $('#guestName').textContent=x.name||'';$('#guestOrg').textContent=x.organization||'남양주시장애인복지관과 함께하는 소중한 손님';
  $('#eventDate').textContent=x.eventDate||'';$('#eventVenue').textContent=x.eventVenue||'';$('#guestSeat').textContent=x.seat||'현장 안내';$('#guestCount').textContent=`${x.requestedCount||1}명`;
  const img=$('#guestQr');if(x.qrDataUrl){img.src=x.qrDataUrl;img.classList.remove('hidden')}else img.classList.add('hidden');
  const seat=$('#seatGuideLink');if(x.seatGuideUrl){seat.href=x.seatGuideUrl;seat.classList.remove('hidden')}else seat.classList.add('hidden');
  $('#arrivalBadge').classList.toggle('hidden',!x.arrived);
  lookupCard.classList.add('hidden');inviteCard.classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});
}
$('#lookupAgain').addEventListener('click',()=>{inviteCard.classList.add('hidden');lookupCard.classList.remove('hidden');form.reset();message.textContent='';$('#lookupName').focus();window.scrollTo({top:0,behavior:'smooth'})});
