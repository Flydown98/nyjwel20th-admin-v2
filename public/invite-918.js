const $=s=>document.querySelector(s);
function normalizePhoneInput(v){const d=String(v||'').replace(/\D/g,'').slice(0,11);if(d.length<4)return d;if(d.length<8)return `${d.slice(0,3)}-${d.slice(3)}`;return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`}
$('#invitePhone').addEventListener('input',e=>{e.target.value=normalizePhoneInput(e.target.value)});
$('#lookupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=$('#lookupButton'),msg=$('#lookupMessage');
  button.disabled=true;button.textContent='확인 중...';msg.textContent='';
  try{
    const r=await fetch('/api/public/invite-lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#inviteName').value.trim(),phone:$('#invitePhone').value.trim()}),cache:'no-store'});
    const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'초대장을 확인할 수 없습니다.');
    const x=d.invite;
    $('#guestName').textContent=`${x.name} 님`;
    $('#guestOrg').textContent=x.organization||'남양주시장애인복지관 초청';
    $('#guestSeat').textContent=x.seat||'현장 안내';
    if(x.qr){$('#guestQr').src=x.qr;$('#qrArea').classList.remove('hidden')}else $('#qrArea').classList.add('hidden');
    const seatLink=$('#seatGuideLink');if(x.seatGuideUrl){seatLink.href=x.seatGuideUrl;seatLink.classList.remove('hidden')}else seatLink.classList.add('hidden');
    $('#lookupPanel').classList.add('hidden');$('#inviteResult').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){msg.textContent=err.message;}
  finally{button.disabled=false;button.textContent='초대장 확인하기';}
});
$('#lookupAgain').addEventListener('click',()=>{$('#inviteResult').classList.add('hidden');$('#lookupPanel').classList.remove('hidden');$('#lookupMessage').textContent='';$('#inviteName').focus();window.scrollTo({top:document.querySelector('.lookup-card').offsetTop-20,behavior:'smooth'});});
