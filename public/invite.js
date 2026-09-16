'use strict';
const $=s=>document.querySelector(s);
let currentInvite=null;
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
  currentInvite=x;
  $('#guestName').textContent=x.name||'';$('#guestOrg').textContent=x.organization||'남양주시장애인복지관과 함께하는 소중한 손님';
  $('#eventDate').textContent=x.eventDate||'';$('#eventVenue').textContent=x.eventVenue||'';$('#guestSeat').textContent=x.seat||'현장 안내';$('#guestCount').textContent=`${x.requestedCount||1}명`;
  const img=$('#guestQr');if(x.qrDataUrl){img.src=x.qrDataUrl;img.classList.remove('hidden')}else img.classList.add('hidden');
  const seat=$('#seatGuideLink');if(x.seatGuideUrl){seat.href=x.seatGuideUrl;seat.classList.remove('hidden')}else seat.classList.add('hidden');
  $('#arrivalBadge').classList.toggle('hidden',!x.arrived);
  lookupCard.classList.add('hidden');inviteCard.classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});
}
$('#lookupAgain').addEventListener('click',()=>{inviteCard.classList.add('hidden');lookupCard.classList.remove('hidden');form.reset();message.textContent='';$('#lookupName').focus();window.scrollTo({top:0,behavior:'smooth'})});


function roundedRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}
function drawCentered(ctx,text,x,y,maxWidth){
  const t=String(text||'');ctx.fillText(t,x,y,maxWidth);
}
function loadCanvasImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src})}
async function downloadInviteImage(){
  const x=currentInvite;if(!x)return;
  const btn=$('#downloadInvite');const old=btn.textContent;btn.disabled=true;btn.textContent='이미지 만드는 중...';
  try{
    const W=1200,H=1600,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#f7f1fb');grad.addColorStop(1,'#eee5f5');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#5e338c';ctx.beginPath();ctx.arc(1020,150,260,0,Math.PI*2);ctx.globalAlpha=.09;ctx.fill();ctx.globalAlpha=1;
    ctx.textAlign='center';ctx.fillStyle='#5e338c';ctx.font='900 190px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'20',W/2,250,900);
    ctx.fillStyle='#4d3b58';ctx.font='800 34px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'남양주시장애인복지관',W/2,325,1000);
    ctx.fillStyle='#21182b';ctx.font='900 56px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'개관 20주년 기념행사',W/2,400,1050);
    ctx.fillStyle='#76568f';ctx.font='700 30px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'스무번의 계절, 스물한 번째 약속',W/2,455,1000);
    ctx.fillStyle='white';roundedRect(ctx,90,525,1020,940,42);ctx.fill();ctx.strokeStyle='#dfd3e7';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#7954a0';ctx.font='900 22px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'YOU ARE INVITED',W/2,600,900);
    ctx.fillStyle='#21182b';ctx.font='900 50px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,`${x.name||''}님을 초대합니다`,W/2,675,900);
    ctx.fillStyle='#746c7b';ctx.font='700 27px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,x.organization||'남양주시장애인복지관과 함께하는 소중한 손님',W/2,725,900);
    const boxes=[['일시',x.eventDate||''],['장소',x.eventVenue||''],['좌석',x.seat||'현장 안내'],['신청인원',`${x.requestedCount||1}명`]];
    boxes.forEach((b,i)=>{const col=i%2,row=Math.floor(i/2),bx=150+col*465,by=785+row*135;ctx.fillStyle='#f7f3fa';roundedRect(ctx,bx,by,405,105,22);ctx.fill();ctx.textAlign='left';ctx.fillStyle='#88778f';ctx.font='800 19px Pretendard, Noto Sans KR, sans-serif';ctx.fillText(b[0],bx+26,by+34);ctx.fillStyle='#2a2030';ctx.font='800 27px Pretendard, Noto Sans KR, sans-serif';ctx.fillText(String(b[1]),bx+26,by+76,350);ctx.textAlign='center'});
    if(x.qrDataUrl){const qr=await loadCanvasImage(x.qrDataUrl);ctx.drawImage(qr,430,1060,340,340)}
    ctx.fillStyle='#756b7d';ctx.font='700 23px Pretendard, Noto Sans KR, sans-serif';drawCentered(ctx,'행사 당일 접수대에서 QR을 보여주세요.',W/2,1430,900);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png',1));if(!blob)throw new Error('이미지를 만들지 못했습니다.');
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`남양주시장애인복지관_20주년_초대장_${String(x.name||'초대장').replace(/[\\/:*?"<>|]/g,'_')}.png`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }catch(err){alert(err?.message||'초대장 이미지를 저장하지 못했습니다.');}
  finally{btn.disabled=false;btn.textContent=old}
}
$('#downloadInvite')?.addEventListener('click',downloadInviteImage);
