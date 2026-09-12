'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const http = require('http');
const iconv = require('iconv-lite');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'change-me-now');
const SMS_RELAY_TOKEN = String(process.env.SMS_RELAY_TOKEN || '');
const MUNJANARA_ID = String(process.env.MUNJANARA_ID || '');
const MUNJANARA_PW = String(process.env.MUNJANARA_PW || '');
const MUNJANARA_SENDER = String(process.env.MUNJANARA_SENDER || '');
const MUNJANARA_TEST_RECEIVER = String(process.env.MUNJANARA_TEST_RECEIVER || '');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BACKUP_INTERVAL_MS = 60 * 1000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(BACKUP_DIR, {recursive:true});
const nowIso = () => new Date().toISOString();
const uuid = (p='id') => `${p}_${crypto.randomUUID()}`;
const str = v => v == null ? '' : String(v).trim();
const num = (v,d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const bool = v => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ['true','1','y','yes','예','사용','참','o','○'].includes(str(v).toLowerCase());
};
const digits = v => str(v).replace(/\D/g,'');

function defaultState() {
  return {
    meta:{app:'nyjwel20th-admin-v2',version:'0.4.1',createdAt:nowIso(),updatedAt:nowIso(),importedAt:null,importSource:null},
    settings:{
      eventName:'남양주시장애인복지관 개관 20주년 기념행사',
      eventDate:'2026. 9. 17.(목) 13:30',
      eventVenue:'남양주금곡실내체육관',
      checkinSmsEnabled:true
    },
    participants:[], groups:[], seats:[], checkins:[], gifts:[],
    raffles:[], rouletteHistory:[], rouletteProducts:[], smsQueue:[], logs:[]
  };
}
function normalizeState(s) {
  const d=defaultState();
  return {
    ...d,...(s||{}),
    meta:{...d.meta,...(s?.meta||{}),version:'0.4.1'},
    settings:{...d.settings,...(s?.settings||{})},
    participants:Array.isArray(s?.participants)?s.participants:[],
    groups:Array.isArray(s?.groups)?s.groups:[],
    seats:Array.isArray(s?.seats)?s.seats:[],
    checkins:Array.isArray(s?.checkins)?s.checkins:[],
    gifts:Array.isArray(s?.gifts)?s.gifts:[],
    raffles:Array.isArray(s?.raffles)?s.raffles:[],
    rouletteHistory:Array.isArray(s?.rouletteHistory)?s.rouletteHistory:[],
    rouletteProducts:Array.isArray(s?.rouletteProducts)?s.rouletteProducts:[],
    smsQueue:Array.isArray(s?.smsQueue)?s.smsQueue:[],
    logs:Array.isArray(s?.logs)?s.logs:[]
  };
}
function loadState(){
  try{
    if(!fs.existsSync(STATE_FILE)){
      const x=defaultState(); fs.writeFileSync(STATE_FILE,JSON.stringify(x,null,2)); return x;
    }
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE,'utf8')));
  }catch(e){
    console.error('[STATE LOAD]',e);
    return defaultState();
  }
}
let state=loadState();

function saveState(){
  state.meta.updatedAt=nowIso();
  const tmp=STATE_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');
  fs.renameSync(tmp,STATE_FILE);
}
function backupNow(label='auto'){
  try{
    saveState();
    const stamp=nowIso().replace(/[:.]/g,'-');
    const name=`${label}_${stamp}.json`;
    fs.copyFileSync(STATE_FILE,path.join(BACKUP_DIR,name));
    fs.copyFileSync(STATE_FILE,path.join(BACKUP_DIR,'latest.json'));
    const autos=fs.readdirSync(BACKUP_DIR).filter(f=>/^auto_/.test(f))
      .map(f=>({f,t:fs.statSync(path.join(BACKUP_DIR,f)).mtimeMs})).sort((a,b)=>b.t-a.t);
    autos.slice(240).forEach(x=>{try{fs.unlinkSync(path.join(BACKUP_DIR,x.f))}catch(_){}});
    return name;
  }catch(e){console.error('[BACKUP]',e);return null}
}
setInterval(()=>backupNow('auto'),BACKUP_INTERVAL_MS).unref();

const sessions=new Map();
setInterval(()=>{
  const n=Date.now();
  for(const [k,v] of sessions) if(v.expiresAt<=n) sessions.delete(k);
},300000).unref();

function auth(req,res,next){
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  const s=sessions.get(token);
  if(!s||s.expiresAt<=Date.now()) return res.status(401).json({ok:false,error:'로그인이 필요합니다.'});
  next();
}

function participantActive(p){return p.active!==false && str(p.participationStatus||'참여')!=='미참여'}
function occupiedSeatSet(excludeIds=[]){
  const ex=new Set(excludeIds);
  return new Set(state.participants.filter(p=>participantActive(p)&&p.seat&&!ex.has(p.id)).map(p=>str(p.seat).toUpperCase()));
}
function seatByCode(code){return state.seats.find(s=>str(s.code).toUpperCase()===str(code).toUpperCase())}
function assignableSeats(wheelchair=false, excludeIds=[]){
  const occ=occupiedSeatSet(excludeIds);
  return state.seats.filter(s=>{
    if(!s.enabled||!s.autoAssignable||occ.has(str(s.code).toUpperCase()))return false;
    if(wheelchair && !s.wheelchairAssignable)return false;
    if(!wheelchair && s.wheelchairOnly)return false;
    return true;
  }).sort((a,b)=>(num(a.sortOrder)-num(b.sortOrder)) || str(a.code).localeCompare(str(b.code),'ko'));
}
function assignOne(p, excludeIds=[]){
  if(p.seat && seatByCode(p.seat)) return p.seat;
  const pool=assignableSeats(Boolean(p.wheelchairUser),excludeIds);
  if(!pool.length)return '';
  p.seat=pool[0].code;
  return p.seat;
}
function assignContiguous(people){
  const need=people.filter(p=>!p.seat);
  if(!need.length)return people.map(p=>p.seat).filter(Boolean);
  const wheelchair=need.some(p=>p.wheelchairUser);
  const pool=assignableSeats(wheelchair,people.map(p=>p.id));
  const groups=new Map();
  pool.forEach(s=>{
    const key=`${s.row}|${s.side}|${s.zone}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(s);
  });
  for(const seats of groups.values()){
    seats.sort((a,b)=>num(a.number)-num(b.number));
    for(let i=0;i<=seats.length-need.length;i++){
      const slice=seats.slice(i,i+need.length);
      let continuous=true;
      for(let j=1;j<slice.length;j++) if(num(slice[j].number)!==num(slice[j-1].number)+1) continuous=false;
      if(continuous){
        need.forEach((p,j)=>p.seat=slice[j].code);
        return people.map(p=>p.seat).filter(Boolean);
      }
    }
  }
  need.forEach(p=>assignOne(p,people.map(x=>x.id)));
  return people.map(p=>p.seat).filter(Boolean);
}
function releaseSeat(p){const old=p.seat||'';p.seat='';return old}

function addLog(action,p,note='',station='관리자 웹'){
  state.checkins.unshift({at:nowIso(),action,participantId:p?.id||'',receptionNo:p?.receptionNo||0,name:p?.name||'',seat:p?.seat||'',station,note});
  state.checkins=state.checkins.slice(0,5000);
}

function pctAscii(v){ return encodeURIComponent(String(v ?? '')); }
function pctEucKr(v){
  const buf = iconv.encode(String(v ?? ''), 'euc-kr');
  let out = '';
  for (const b of buf) {
    const ch = String.fromCharCode(b);
    if ((b>=0x30&&b<=0x39)||(b>=0x41&&b<=0x5A)||(b>=0x61&&b<=0x7A)||'-_.~'.includes(ch)) out += ch;
    else out += '%' + b.toString(16).toUpperCase().padStart(2,'0');
  }
  return out;
}
function munjanaraConfigured(){
  return Boolean(MUNJANARA_ID && MUNJANARA_PW && MUNJANARA_SENDER);
}
function sendMunjanaraSms(receiver, message){
  return new Promise((resolve,reject)=>{
    if(!munjanaraConfigured()) return reject(new Error('문자나라 환경변수가 설정되지 않았습니다.'));
    const recv = digits(receiver);
    if(recv.length < 9) return reject(new Error('수신번호 형식이 올바르지 않습니다.'));
    const params = [
      'userid=' + pctAscii(MUNJANARA_ID),
      'passwd=' + pctAscii(MUNJANARA_PW),
      'sender=' + pctAscii(digits(MUNJANARA_SENDER)),
      'receiver=' + pctAscii(recv),
      'encode=1',
      'end_alert=0',
      'allow_mms=1',
      'message=' + pctEucKr(message)
    ].join('&');
    const req = http.request({
      hostname:'munjanara.co.kr',
      port:80,
      path:'/send.sys?' + params,
      method:'GET',
      timeout:20000,
      headers:{'User-Agent':'NYJWEL-Cloudtype-SMS/1.0','Connection':'close'}
    }, res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const raw=Buffer.concat(chunks);
        let body='';
        try{body=iconv.decode(raw,'euc-kr')}catch(_){body=raw.toString('utf8')}
        const code=String(body).trim().split('|')[0].trim();
        resolve({httpStatus:res.statusCode,body,code,success:res.statusCode===200&&code==='9'});
      });
    });
    req.on('timeout',()=>req.destroy(new Error('문자나라 연결 시간 초과')));
    req.on('error',reject);
    req.end();
  });
}
async function sendQueuedSmsItem(item){
  if(!item || item.status==='성공') return item;
  item.status='발송중';
  item.startedAt=nowIso();
  saveState();
  try{
    const r=await sendMunjanaraSms(item.phone,item.message);
    item.status=r.success?'성공':'실패';
    item.result=`HTTP ${r.httpStatus} / ${String(r.body).trim()}`;
    item.sentAt=nowIso();
  }catch(e){
    item.status='실패';
    item.result=`${e.name||'Error'}: ${e.message}`;
    item.sentAt=nowIso();
  }
  saveState();
  return item;
}
function queueAndSendSms(phone,message,kind='checkin',participantId=''){
  const item=queueSms(phone,message,kind,participantId);
  if(item && munjanaraConfigured()){
    setImmediate(()=>sendQueuedSmsItem(item).catch(err=>console.error('[SMS]',err)));
  }
  return item;
}

function queueSms(phone,message,kind='checkin',participantId=''){
  const d=digits(phone);
  if(d.length<9)return null;
  const normalized=d.startsWith('82')?'0'+d.slice(2):(d.startsWith('0')?d:'0'+d);
  const item={id:uuid('sms'),phone:normalized,message,status:'대기',result:'',requestedAt:nowIso(),sentAt:null,kind,participantId};
  state.smsQueue.push(item);
  return item;
}
function checkinMessage(p,extra=''){
  const seat=p.seat||'스탠딩/현장안내';
  return `[남양주시장애인복지관]\n${p.name}님 현장 접수가 완료되었습니다.\n좌석: ${seat}\n기념품: 지급완료${extra?`\n${extra}`:''}\n개관 20주년 기념행사에 함께해 주셔서 감사합니다.`;
}
function findParticipant(code){
  const raw=str(code).replace(/^NYJ20[|:]/i,'').toUpperCase();
  return state.participants.find(p=>str(p.id).toUpperCase()===raw || str(p.receptionNo)===raw);
}
function groupForParticipant(p){
  if(!p)return null;
  return state.groups.find(g=>g.memberIds?.includes(p.id));
}
function markArrived(p,{station='관리자 웹',sendSms=true}={}){
  const already=Boolean(p.arrived);
  if(!already){
    p.arrived=true;p.arrivedAt=nowIso();p.giftReceived=true;p.giftReceivedAt=nowIso();p.modifiedAt=nowIso();
    if(!p.seat)assignOne(p);
    addLog('QR접수',p,'기념품 지급완료',station);
    if(sendSms && state.settings.checkinSmsEnabled!==false) queueAndSendSms(p.phone,checkinMessage(p),'checkin',p.id);
  }
  return {already,participant:p};
}

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024}});
function excelSerial(v){
  if(v==null||v==='')return null;
  if(typeof v==='number'){
    const d=XLSX.SSF.parse_date_code(v);
    if(d?.y)return new Date(Date.UTC(d.y,d.m-1,d.d,d.H||0,d.M||0,Math.floor(d.S||0))).toISOString();
  }
  const d=new Date(v);return Number.isNaN(d.getTime())?str(v):d.toISOString();
}
function sheetRows(wb,n){const ws=wb.Sheets[n];return ws?XLSX.utils.sheet_to_json(ws,{defval:null,raw:true}):[]}
function phone(v){
  const raw=str(v),d=digits(raw); if(!d)return '';
  if(d.length===11&&d.startsWith('010'))return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if(d.length===10&&d.startsWith('0'))return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return raw;
}
function buildImport(buf,name){
  const wb=XLSX.read(buf,{type:'buffer'});
  const ps=sheetRows(wb,'참가자').filter(r=>str(r['QR고유코드'])||str(r['이름'])).map((r,i)=>({
    id:str(r['QR고유코드'])||`IMPORTED-${i+1}`,receptionNo:num(r['접수번호'],i+1),name:str(r['이름']),phone:phone(r['연락처']),
    seat:str(r['좌석번호']),applicationType:str(r['신청유형']),note:str(r['비고']),arrived:bool(r['도착여부']),arrivedAt:excelSerial(r['도착시각']),
    registeredAt:excelSerial(r['등록시각']),modifiedAt:excelSerial(r['수정시각']),active:r['사용여부']==null?true:bool(r['사용여부']),
    organization:str(r['소속기관']),requestedCount:Math.max(1,num(r['신청인원(개인=1)'],1)),wheelchairUser:bool(r['휠체어이용여부']),
    wheelchairCount:Math.max(0,num(r['휠체어이용인원(개인신청 0·1)'],0)),usesCenter:bool(r['복지관이용여부']),
    disabledPerson:bool(r['장애인당사자여부']),companionGroup:str(r['동반그룹']),
    participationStatus:str(r['참여상태'])||'참여',giftReceived:false,onsite:false
  }));
  const seats=sheetRows(wb,'좌석설정').filter(r=>str(r['좌석코드'])).map(r=>({
    code:str(r['좌석코드']).toUpperCase(),row:str(r['행']).toUpperCase(),side:str(r['측면']).toUpperCase(),number:num(r['번호']),
    zone:str(r['구역'])||'일반',autoAssignable:bool(r['일반자동배정']),enabled:r['사용여부']==null?true:bool(r['사용여부']),
    wheelchairAssignable:bool(r['휠체어자동배정']),note:str(r['메모']),sortOrder:num(r['정렬순서'])
  }));
  const settings={}; sheetRows(wb,'설정').forEach(r=>{const k=str(r['설정키']);if(k)settings[k]=r['값']});
  const gifts=sheetRows(wb,'기념품지급').filter(r=>str(r['QR코드'])).map(r=>({participantId:str(r['QR코드']),received:bool(r['지급여부']),receivedAt:excelSerial(r['지급시각'])}));
  const gm=new Map(gifts.map(x=>[x.participantId,x]));ps.forEach(p=>{const g=gm.get(p.id);if(g)p.giftReceived=g.received});
  const rouletteProducts=sheetRows(wb,'룰렛상품').filter(r=>str(r['상품명'])).map(r=>({number:str(r['상품번호']),name:str(r['상품명']),quantity:num(r['총수량']),enabled:r['사용여부']==null?true:bool(r['사용여부']),note:str(r['비고'])}));
  return {name,participants:ps,seats,settings,rouletteProducts,sheets:wb.SheetNames};
}
const previews=new Map();

app.disable('x-powered-by');
app.use(express.json({limit:'3mb'}));
app.use(express.static(path.join(ROOT,'public'),{maxAge:0,etag:false}));

app.get('/api/health',(req,res)=>res.json({ok:true,version:'0.4.1',serverTime:nowIso(),uptimeSeconds:Math.round(process.uptime()),participants:state.participants.length,smsReady:munjanaraConfigured()}));
app.post('/api/login',(req,res)=>{
  if(str(req.body?.password)!==ADMIN_PASSWORD)return res.status(401).json({ok:false,error:'비밀번호가 올바르지 않습니다.'});
  const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+SESSION_TTL_MS;sessions.set(token,{expiresAt});
  res.json({ok:true,token,expiresAt:new Date(expiresAt).toISOString()});
});
app.get('/api/bootstrap',auth,(req,res)=>{
  const active=state.participants.filter(participantActive);
  const extraGifts=state.groups.reduce((n,g)=>n+num(g.extraGiftCount,0),0);
  res.json({ok:true,serverTime:nowIso(),summary:{
    participants:state.participants.length,active:active.length,arrived:active.filter(p=>p.arrived).length,
    groups:state.groups.length,seats:state.seats.length,assignedSeats:active.filter(p=>p.seat).length,
    giftsReceived:state.participants.filter(p=>p.giftReceived).length+extraGifts,
    smsPending:state.smsQueue.filter(x=>x.status==='대기'||x.status==='pending').length,
    onsite:state.participants.filter(p=>p.onsite).length
  },settings:state.settings,meta:state.meta});
});
app.get('/api/participants',auth,(req,res)=>{
  const q=str(req.query.q).toLowerCase(),status=str(req.query.status||'all');
  let rows=state.participants;
  if(q){const qd=digits(q);rows=rows.filter(p=>`${p.name} ${p.phone} ${p.organization} ${p.id} ${p.seat}`.toLowerCase().includes(q)||(qd.length>=3&&digits(p.phone).includes(qd)))}
  if(status==='arrived')rows=rows.filter(p=>p.arrived);
  if(status==='pending')rows=rows.filter(p=>!p.arrived&&participantActive(p));
  if(status==='inactive')rows=rows.filter(p=>!participantActive(p));
  res.json({ok:true,total:rows.length,rows:rows.slice(0,500)});
});
app.get('/api/participant/:id',auth,(req,res)=>{
  const p=findParticipant(req.params.id);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  res.json({ok:true,participant:p,group:groupForParticipant(p)});
});
app.post('/api/participants/onsite',auth,(req,res)=>{
  const b=req.body||{};if(!str(b.name))return res.status(400).json({ok:false,error:'이름을 입력해 주세요.'});
  const maxNo=Math.max(0,...state.participants.map(p=>num(p.receptionNo,0)));
  const p={id:`ONSITE-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,receptionNo:maxNo+1,name:str(b.name),phone:phone(b.phone),organization:str(b.organization),
    seat:'',applicationType:'현장접수',note:str(b.note),arrived:true,arrivedAt:nowIso(),registeredAt:nowIso(),modifiedAt:nowIso(),active:true,
    requestedCount:1,wheelchairUser:bool(b.wheelchairUser),usesCenter:false,disabledPerson:bool(b.disabledPerson),participationStatus:'참여',
    giftReceived:true,giftReceivedAt:nowIso(),onsite:true,standing:true};
  // 사용자의 운영 규칙: 현장 추가 접수자는 자동 좌석을 만들지 않고 스탠딩으로 안내.
  state.participants.push(p);addLog('현장신규등록',p,'좌석 미배정 · 스탠딩 안내',str(b.station)||'현장접수');
  if(p.phone&&state.settings.checkinSmsEnabled!==false)queueAndSendSms(p.phone,checkinMessage(p,'현장 추가 참여로 좌석은 별도 배정되지 않습니다.'),'onsite',p.id);
  saveState();res.json({ok:true,participant:p});
});
app.post('/api/participant/:id/update',auth,(req,res)=>{
  const p=findParticipant(req.params.id);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const b=req.body||{};
  ['name','organization','note','seat'].forEach(k=>{if(k in b)p[k]=str(b[k])});
  if('phone'in b)p.phone=phone(b.phone);
  ['wheelchairUser','disabledPerson','active'].forEach(k=>{if(k in b)p[k]=bool(b[k])});
  p.modifiedAt=nowIso();saveState();res.json({ok:true,participant:p});
});
app.post('/api/checkin/individual',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'QR 참가자를 찾을 수 없습니다.'});
  const g=groupForParticipant(p);if(g)return res.status(409).json({ok:false,error:'단체 참가자입니다.',groupRequired:true,group:g,participant:p});
  const r=markArrived(p,{station:str(req.body?.station)||'QR접수'});
  saveState();res.json({ok:true,...r});
});
app.post('/api/checkin/lookup',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'QR 참가자를 찾을 수 없습니다.'});
  const g=groupForParticipant(p);
  let group=null;
  if(g){
    const members=g.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    group={...g,members,total:members.length,arrived:members.filter(p=>p.arrived).length};
  }
  res.json({ok:true,participant:p,group});
});
app.post('/api/checkin/group',auth,(req,res)=>{
  const group=state.groups.find(g=>g.id===str(req.body?.groupId));if(!group)return res.status(404).json({ok:false,error:'단체를 찾을 수 없습니다.'});
  const members=group.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean).filter(participantActive);
  const pending=members.filter(p=>!p.arrived);
  const actual=Math.max(0,num(req.body?.actualCount,0));
  const registeredRemaining=pending.length;
  const checkCount=Math.min(actual,registeredRemaining);
  const extras=Math.max(0,actual-registeredRemaining);
  const selected=pending.slice(0,checkCount);
  // 그룹 좌석은 실제 도착 등록인원만 유지. 이번에 안 온 미도착 멤버 좌석은 비움.
  pending.slice(checkCount).forEach(p=>releaseSeat(p));
  selected.forEach(p=>{p.arrived=true;p.arrivedAt=nowIso();p.giftReceived=true;p.giftReceivedAt=nowIso();p.modifiedAt=nowIso()});
  assignContiguous(selected);
  selected.forEach(p=>addLog('단체QR접수',p,`단체 ${group.name||group.organization||group.id}`,str(req.body?.station)||'QR접수'));
  group.extraStanding=num(group.extraStanding,0)+extras;
  group.extraGiftCount=num(group.extraGiftCount,0)+extras;
  group.lastCheckinAt=nowIso();
  group.lastActualCount=actual;
  const rep=state.participants.find(p=>p.id===group.representativeId)||selected[0]||members[0];
  let sms=null;
  if(rep?.phone&&state.settings.checkinSmsEnabled!==false){
    const seats=selected.map(p=>p.seat).filter(Boolean);
    const extraText=extras?`추가 ${extras}명은 좌석 미배정(스탠딩 안내)입니다.`:'';
    sms=queueAndSendSms(rep.phone,`[남양주시장애인복지관]\n${group.name||rep.organization||rep.name} 단체 현장 접수가 완료되었습니다.\n이번 접수 ${actual}명 / 좌석 ${checkCount}석\n${seats.length?'좌석: '+seats.join(', ')+'\n':''}${extraText}\n기념품: ${actual}명 지급완료\n감사합니다.`,'group-checkin',rep.id);
  }
  saveState();res.json({ok:true,total:members.length,checkedInNow:checkCount,actualCount:actual,extraStanding:extras,seats:selected.map(p=>p.seat).filter(Boolean),smsQueued:Boolean(sms)});
});
app.post('/api/checkin/undo',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  p.arrived=false;p.arrivedAt=null;p.giftReceived=false;p.giftReceivedAt=null;releaseSeat(p);p.modifiedAt=nowIso();
  addLog('접수취소',p,'도착·기념품·좌석 취소',str(req.body?.station)||'관리자');
  saveState();res.json({ok:true,participant:p});
});


const INTERNAL_ORG_KEYWORDS = [
  '남양주시장애인복지관','사회서비스','활동지원','활동지원사','활동지원팀',
  '이용인','낮활동','낮활동팀','주간활동','주간활동팀','직업재활팀',
  '기획협력지원팀','지역융합서비스팀','운영지원팀','복지관직원','직원'
];
function isInternalOrganization(name){
  const n=str(name).replace(/\s+/g,'').toLowerCase();
  if(!n)return false;
  return INTERNAL_ORG_KEYWORDS.some(k=>n.includes(k.replace(/\s+/g,'').toLowerCase()));
}

app.get('/api/groups',auth,(req,res)=>{
  const rows=state.groups.map(g=>{
    const members=g.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    return {...g,total:members.length,arrived:members.filter(p=>p.arrived).length,members};
  });
  res.json({ok:true,rows});
});
app.get('/api/group-suggestions',auth,(req,res)=>{
  const map=new Map();
  state.participants.filter(participantActive).forEach(p=>{
    const o=str(p.organization);if(!o||isInternalOrganization(o))return;
    if(!map.has(o))map.set(o,[]);
    map.get(o).push(p);
  });
  const groupedIds=new Set(state.groups.flatMap(g=>g.memberIds||[]));
  const rows=[...map.entries()].filter(([o,ps])=>ps.length>=2 && ps.some(p=>!groupedIds.has(p.id)))
    .map(([organization,ps])=>({organization,count:ps.length,ungrouped:ps.filter(p=>!groupedIds.has(p.id)).length,members:ps.map(p=>({id:p.id,name:p.name,phone:p.phone,seat:p.seat}))}))
    .sort((a,b)=>b.count-a.count);
  res.json({ok:true,rows});
});
app.post('/api/groups/create-by-organization',auth,(req,res)=>{
  const organization=str(req.body?.organization);
  if(!organization)return res.status(400).json({ok:false,error:'소속기관을 선택해 주세요.'});
  const used=new Set(state.groups.flatMap(g=>g.memberIds||[]));
  const members=state.participants.filter(p=>participantActive(p)&&str(p.organization)===organization&&!used.has(p.id));
  if(members.length<2)return res.status(400).json({ok:false,error:'묶을 수 있는 미지정 참가자가 2명 이상 필요합니다.'});
  let rep=members.find(p=>p.id===str(req.body?.representativeId))||members.find(p=>p.phone)||members[0];
  const g={id:uuid('grp'),name:str(req.body?.name)||organization,organization,representativeId:rep.id,memberIds:members.map(p=>p.id),createdAt:nowIso(),extraStanding:0,extraGiftCount:0};
  state.groups.push(g);saveState();res.json({ok:true,group:g});
});
app.post('/api/groups/:id/delete',auth,(req,res)=>{
  const i=state.groups.findIndex(g=>g.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:'단체를 찾을 수 없습니다.'});
  const [g]=state.groups.splice(i,1);saveState();res.json({ok:true,group:g});
});

app.get('/api/seats',auth,(req,res)=>{
  const occ=occupiedSeatSet();
  const rows=state.seats.map(s=>({...s,occupied:occ.has(str(s.code).toUpperCase()),participant:state.participants.find(p=>str(p.seat).toUpperCase()===str(s.code).toUpperCase())||null}));
  res.json({ok:true,total:rows.length,rows});
});
app.post('/api/seats/release-pending',auth,(req,res)=>{
  let count=0;
  state.participants.filter(p=>!p.arrived&&participantActive(p)&&p.seat).forEach(p=>{releaseSeat(p);count++});
  saveState();res.json({ok:true,released:count});
});

app.get('/api/raffle/products',auth,(req,res)=>res.json({ok:true,rows:state.rouletteProducts}));
app.post('/api/raffle/draw',auth,(req,res)=>{
  const productNo=str(req.body?.productNo),count=Math.max(1,Math.min(20,num(req.body?.count,1)));
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:str(req.body?.productName)||'행운상품',quantity:999,enabled:true};
  if(!product.enabled)return res.status(400).json({ok:false,error:'사용 중지된 상품입니다.'});
  const wonIds=new Set(state.rouletteHistory.filter(x=>x.enabled!==false).map(x=>x.participantId));
  const pool=state.participants.filter(p=>p.arrived&&participantActive(p)&&!wonIds.has(p.id));
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const shuffled=[...pool].sort(()=>Math.random()-.5).slice(0,count);
  const drawId=uuid('draw');
  const records=shuffled.map((p,i)=>({drawId,drawnAt:nowIso(),prizeNo:product.number,prizeName:product.name,method:'랜덤',participantId:p.id,participantName:p.name,seat:p.seat,rank:i+1,enabled:true,received:false}));
  state.rouletteHistory.push(...records);saveState();res.json({ok:true,drawId,product,winners:records,poolSize:pool.length});
});
app.get('/api/raffle/history',auth,(req,res)=>res.json({ok:true,rows:[...state.rouletteHistory].reverse().slice(0,300)}));
app.post('/api/raffle/redeem',auth,(req,res)=>{
  const r=state.rouletteHistory.find(x=>x.drawId===str(req.body?.drawId)&&x.participantId===str(req.body?.participantId));
  if(!r)return res.status(404).json({ok:false,error:'당첨 기록을 찾을 수 없습니다.'});
  r.received=true;r.receivedAt=nowIso();saveState();res.json({ok:true,record:r});
});


app.get('/api/sms/status',auth,(req,res)=>res.json({
  ok:true,
  ready:munjanaraConfigured(),
  sender: MUNJANARA_SENDER ? digits(MUNJANARA_SENDER).replace(/(\d{2,3})\d+(\d{4})/,'$1****$2') : '',
  testReceiverConfigured:Boolean(MUNJANARA_TEST_RECEIVER)
}));
app.post('/api/sms/test',auth,async(req,res)=>{
  const receiver=digits(req.body?.receiver||MUNJANARA_TEST_RECEIVER);
  if(!receiver)return res.status(400).json({ok:false,error:'테스트 수신번호가 설정되지 않았습니다.'});
  const item=queueSms(receiver,'[남양주시장애인복지관] Cloudtype 문자 발송 테스트입니다.','test','');
  await sendQueuedSmsItem(item);
  res.json({ok:item.status==='성공',item});
});
app.post('/api/sms/send-one',auth,async(req,res)=>{
  const phone=digits(req.body?.phone), message=str(req.body?.message);
  if(!phone||!message)return res.status(400).json({ok:false,error:'수신번호와 메시지를 입력해 주세요.'});
  const item=queueSms(phone,message,'manual','');
  await sendQueuedSmsItem(item);
  res.json({ok:item.status==='성공',item});
});

app.get('/api/sms',auth,(req,res)=>res.json({ok:true,rows:[...state.smsQueue].reverse().slice(0,300)}));
app.post('/api/sms/pre-event',auth,(req,res)=>{
  const target=str(req.body?.target||'all');
  const reps=new Set(state.groups.map(g=>g.representativeId));
  const groupMembers=new Set(state.groups.flatMap(g=>g.memberIds||[]));
  let people=state.participants.filter(p=>participantActive(p)&&p.phone);
  if(target==='representatives')people=people.filter(p=>reps.has(p.id));
  else if(target==='all')people=people.filter(p=>!groupMembers.has(p.id)||reps.has(p.id));
  else if(target==='pending')people=people.filter(p=>!p.arrived&&(!groupMembers.has(p.id)||reps.has(p.id)));
  let queued=0;
  people.forEach(p=>{
    const g=state.groups.find(g=>g.representativeId===p.id);
    const countText=g?`\n사전 등록 인원: ${g.memberIds.length}명`:'';
    const msg=`[남양주시장애인복지관]\n${p.name}님, 내일 개관 20주년 기념행사가 진행됩니다.\n일시: 2026. 9. 17.(목) 13:30\n장소: 남양주금곡실내체육관${countText}\n\n사전 신청 인원에 변동이 있거나 참석이 어려운 분이 있을 경우 복지관으로 연락 부탁드립니다.\n추가 인원은 현장 참여가 가능하나 좌석은 배정받지 못할 수 있습니다.\n행사 당일 QR 입장권을 준비해 주세요. 감사합니다.`;
    if(queueSms(p.phone,msg,'pre-event',p.id))queued++;
  });
  saveState();res.json({ok:true,queued});
});

app.post('/api/import/xlsx/preview',auth,upload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({ok:false,error:'엑셀 파일을 선택해 주세요.'});
    const parsed=buildImport(req.file.buffer,req.file.originalname),importId=uuid('import');previews.set(importId,{createdAt:Date.now(),parsed});
    res.json({ok:true,importId,fileName:parsed.name,sheets:parsed.sheets,summary:{participants:parsed.participants.length,seats:parsed.seats.length,settings:Object.keys(parsed.settings).length,rouletteProducts:parsed.rouletteProducts.length},
      sampleParticipants:parsed.participants.slice(0,8),sampleSeats:parsed.seats.slice(0,8)});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});
app.post('/api/import/xlsx/confirm',auth,(req,res)=>{
  const h=previews.get(str(req.body?.importId));if(!h)return res.status(400).json({ok:false,error:'미리보기가 만료되었습니다.'});
  backupNow('before-import');
  state.participants=h.parsed.participants;state.seats=h.parsed.seats;state.settings={...state.settings,...h.parsed.settings};state.rouletteProducts=h.parsed.rouletteProducts;
  state.groups=[];state.checkins=[];state.smsQueue=[];state.raffles=[];state.rouletteHistory=[];
  state.meta.importedAt=nowIso();state.meta.importSource=h.parsed.name;saveState();backupNow('after-import');previews.delete(str(req.body?.importId));
  res.json({ok:true,participants:state.participants.length,seats:state.seats.length});
});

app.post('/api/backup/restore',auth,upload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({ok:false,error:'JSON 백업 파일을 선택해 주세요.'});
    const parsed=JSON.parse(req.file.buffer.toString('utf8'));
    if(!parsed||!parsed.meta||!Array.isArray(parsed.participants))return res.status(400).json({ok:false,error:'올바른 관리자 백업 JSON이 아닙니다.'});
    const before=backupNow('before-restore');
    state=normalizeState(parsed);
    state.meta.version='0.4.1';
    state.meta.restoredAt=nowIso();
    state.meta.restoredFrom=req.file.originalname;
    saveState();
    const after=backupNow('after-restore');
    res.json({ok:true,beforeBackup:before,afterBackup:after,participants:state.participants.length,seats:state.seats.length,groups:state.groups.length});
  }catch(e){res.status(400).json({ok:false,error:'백업 복원 실패: '+e.message})}
});

app.post('/api/backup',auth,(req,res)=>res.json({ok:true,filename:backupNow('manual')}));
app.get('/api/backup/download',auth,(req,res)=>{backupNow('download');res.download(STATE_FILE,`nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`)});
app.get('/api/export/participants.csv',auth,(req,res)=>{
  const headers=['접수번호','QR고유코드','이름','연락처','소속기관','좌석','도착여부','도착시각','기념품','현장접수'];
  const rows=state.participants.map(p=>[p.receptionNo,p.id,p.name,p.phone,p.organization,p.seat,p.arrived?'Y':'N',p.arrivedAt||'',p.giftReceived?'Y':'N',p.onsite?'Y':'N']);
  const csv='\ufeff'+[headers,...rows].map(r=>r.map(v=>`"${str(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="participants.csv"');res.send(csv);
});

// Python 문자나라 relay용. 환경변수 SMS_RELAY_TOKEN 필요.
app.get('/relay/pending',(req,res)=>{
  if(!SMS_RELAY_TOKEN||str(req.query.token)!==SMS_RELAY_TOKEN)return res.status(401).json({ok:false,error:'unauthorized'});
  const limit=Math.max(1,Math.min(50,num(req.query.limit,20)));
  const jobs=state.smsQueue.filter(x=>x.status==='대기'||x.status==='pending').slice(0,limit);
  res.json({ok:true,jobs});
});
app.post('/relay/result',(req,res)=>{
  if(!SMS_RELAY_TOKEN||str(req.body?.token)!==SMS_RELAY_TOKEN)return res.status(401).json({ok:false,error:'unauthorized'});
  const job=state.smsQueue.find(x=>x.id===str(req.body?.id));if(!job)return res.status(404).json({ok:false,error:'job not found'});
  job.status=req.body?.success?'성공':'실패';job.result=str(req.body?.result||req.body?.error);job.sentAt=nowIso();saveState();res.json({ok:true});
});

app.use((req,res)=>{if(req.path.startsWith('/api/')||req.path.startsWith('/relay/'))return res.status(404).json({ok:false,error:'API를 찾을 수 없습니다.'});res.sendFile(path.join(ROOT,'public','index.html'))});
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({ok:false,error:err?.message||'서버 오류'})});
app.listen(PORT,'0.0.0.0',()=>console.log(`NYJWEL Admin v0.4.1 · :${PORT}`));
