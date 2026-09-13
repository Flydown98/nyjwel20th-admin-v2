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

const GDRIVE_BACKUP_URL = String(process.env.GDRIVE_BACKUP_URL || '');
const GDRIVE_BACKUP_TOKEN = String(process.env.GDRIVE_BACKUP_TOKEN || '');
const RECEPTION_PASSWORD = String(process.env.RECEPTION_PASSWORD || '');
const SEAT_PASSWORD = String(process.env.SEAT_PASSWORD || '');
const RAFFLE_PASSWORD = String(process.env.RAFFLE_PASSWORD || '');

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
    meta:{app:'nyjwel20th-admin-v2',version:'0.8.0',createdAt:nowIso(),updatedAt:nowIso(),importedAt:null,importSource:null},
    settings:{
      eventName:'남양주시장애인복지관 개관 20주년 기념행사',
      eventDate:'2026. 9. 17.(목) 13:30',
      eventVenue:'남양주금곡실내체육관',
      eventHost:'남양주시장애인복지관',
      applicationCapacity:450,
      checkinSmsEnabled:true,
      autoSeatAssignOnCheckin:true,
      individualAutoCheckinDelayMs:1400,
      checkinPopupCloseMs:850,
      externalBackupEnabled:true,
      externalBackupIntervalSec:60,
      externalSnapshotIntervalMin:10,
      autoRestoreExternalIfEmpty:true,
      groupExclusionKeywords:[],
      excludedOrganizations:[],
      excludedCompanionGroups:[]
    },
    participants:[], groups:[], seats:[], checkins:[], gifts:[],
    raffles:[], rouletteHistory:[], rouletteProducts:[], smsQueue:[], logs:[]
  };
}
function normalizeState(s) {
  const d=defaultState();
  return {
    ...d,...(s||{}),
    meta:{...d.meta,...(s?.meta||{}),version:'0.8.0'},
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

const sseClients=new Set();
function broadcastEvent(type='state',payload={}){
  const data=`event: ${type}\ndata: ${JSON.stringify({type,at:nowIso(),...payload})}\n\n`;
  for(const res of [...sseClients]){
    try{res.write(data)}catch(_){sseClients.delete(res)}
  }
}


function saveState(){
  state.meta.updatedAt=nowIso();
  const tmp=STATE_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');
  fs.renameSync(tmp,STATE_FILE);
  broadcastEvent('state',{updatedAt:state.meta.updatedAt});
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
  const session=sessions.get(token);
  if(!session||session.expiresAt<=Date.now()) return res.status(401).json({ok:false,error:'로그인이 필요합니다.'});
  req.adminRole=session.role||'admin';
  req.sessionToken=token;
  next();
}
function passwordRole(password){
  const p=str(password);
  if(p===ADMIN_PASSWORD)return 'admin';
  if(RECEPTION_PASSWORD && p===RECEPTION_PASSWORD)return 'reception';
  if(SEAT_PASSWORD && p===SEAT_PASSWORD)return 'seat';
  if(RAFFLE_PASSWORD && p===RAFFLE_PASSWORD)return 'raffle';
  return '';
}
function roleLabel(role){
  return ({admin:'메인 관리자',reception:'현장 접수',seat:'좌석 담당',raffle:'추첨 담당'})[role]||role;
}
function roleGate(req,res,next){
  if(req.method==='OPTIONS')return next();
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  const session=sessions.get(token);
  if(!session||session.expiresAt<=Date.now())return next();
  const role=session.role||'admin';
  if(role==='admin')return next();
  const p=req.path, m=req.method;
  const readOK =
    p==='/bootstrap' ||
    p.startsWith('/participants') || p.startsWith('/participant/') ||
    p.startsWith('/groups') || p.startsWith('/group-suggestions') ||
    p.startsWith('/seats') ||
    (role==='raffle' && p.startsWith('/raffle')) ||
    (role==='reception' && p.startsWith('/sms/status')) ||
    (role==='reception' && p.startsWith('/sms'));
  if(m==='GET' && readOK)return next();

  if(role==='reception'){
    if(p.startsWith('/checkin/') || p==='/participants/onsite' || /\/participants\/[^/]+\/admin-update$/.test(p) ||
       p.startsWith('/groups/') || p==='/groups/manual' || p==='/groups/rebuild-auto' ||
       p==='/sms/send-one' || p==='/sms/send-group') return next();
  }
  if(role==='seat' && p.startsWith('/seats/'))return next();
  if(role==='raffle' && p.startsWith('/raffle/'))return next();
  return res.status(403).json({ok:false,error:`${roleLabel(role)} 권한으로는 이 기능을 사용할 수 없습니다.`});
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

function seatCodeCategory(code){
  const m=str(code).toUpperCase().match(/^([A-Y])([LR])-(\d{2})$/);
  if(!m)return 'general';
  const row=m[1], side=m[2], n=num(m[3]);
  if(['A','B','C'].includes(row)){
    const inner=(side==='L'&&n>=6)||(side==='R'&&n<=5);
    return inner?'vip':'wheelchair';
  }
  if(['D','E','F'].includes(row))return 'guest';
  return 'general';
}
function seatsForCategory(category,excludeIds=[]){
  const occ=occupiedSeatSet(excludeIds);
  return state.seats.filter(x=>x.enabled!==false&&!occ.has(str(x.code).toUpperCase())&&seatCodeCategory(x.code)===category)
    .sort((a,b)=>(num(a.sortOrder)-num(b.sortOrder))||str(a.code).localeCompare(str(b.code)));
}
function assignOneCategory(p,category,excludeIds=[]){
  if(p.seat&&seatByCode(p.seat))return p.seat;
  const pool=seatsForCategory(category,excludeIds);
  if(!pool.length)return '';
  p.seat=pool[0].code;return p.seat;
}
function assignContiguousCategory(people,category){
  const need=people.filter(p=>!p.seat);
  if(!need.length)return people.map(p=>p.seat).filter(Boolean);
  const pool=seatsForCategory(category,people.map(p=>p.id));
  const groups=new Map();
  pool.forEach(seat=>{
    const key=`${seat.row}|${seat.side}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(seat);
  });
  for(const seats of groups.values()){
    seats.sort((a,b)=>num(a.number)-num(b.number));
    for(let i=0;i<=seats.length-need.length;i++){
      const slice=seats.slice(i,i+need.length);
      if(slice.every((x,j)=>j===0||num(x.number)===num(slice[j-1].number)+1)){
        need.forEach((p,j)=>p.seat=slice[j].code);
        return people.map(p=>p.seat).filter(Boolean);
      }
    }
  }
  need.forEach(p=>assignOneCategory(p,category,people.map(x=>x.id)));
  return people.map(p=>p.seat).filter(Boolean);
}


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
    adminAudit('문자발송',{id:item.participantId||item.id,name:item.phone},null,{status:item.status,kind:item.kind},item.result);
  }catch(e){
    item.status='실패';
    item.result=`${e.name||'Error'}: ${e.message}`;
    item.sentAt=nowIso();
    adminAudit('문자발송',{id:item.participantId||item.id,name:item.phone},null,{status:item.status,kind:item.kind},item.result);
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

const DEFAULT_GROUP_EXCLUSION_KEYWORDS = [
  '남양주시','남양주시장애인복지관','사회서비스','활동지원','활동지원사','활동지원팀',
  '이용인','낮활동','낮활동팀','주간활동','주간활동팀','직업재활팀',
  '기획협력지원팀','지역융합서비스팀','운영지원팀','복지관직원','직원'
];
function getGroupExclusionKeywords(){
  const v=state.settings?.groupExclusionKeywords;
  if(Array.isArray(v)&&v.length)return v.map(str).filter(Boolean);
  if(typeof v==='string'&&v.trim())return v.split(/\r?\n|,/).map(str).filter(Boolean);
  return [...DEFAULT_GROUP_EXCLUSION_KEYWORDS];
}
function normalizeOrg(v){return str(v).replace(/\s+/g,' ').trim()}
function isInternalOrganization(name){
  const n=normalizeOrg(name).replace(/\s+/g,'').toLowerCase();
  if(!n)return false;
  return getGroupExclusionKeywords().some(k=>n.includes(normalizeOrg(k).replace(/\s+/g,'').toLowerCase()));
}
function sameExternalOrganization(members){
  const orgs=[...new Set(members.map(p=>normalizeOrg(p.organization)).filter(Boolean))];
  if(orgs.length!==1)return '';
  return isInternalOrganization(orgs[0])?'':orgs[0];
}
function groupDisplayName(g){
  if(!g)return '';
  const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
  if(g.type==='companion'){
    const org=sameExternalOrganization(members);
    return org||'동반';
  }
  return str(g.name)||str(g.organization)||'그룹';
}
function manualGroupMemberIds(){
  return new Set(state.groups.filter(g=>g.type==='representative'&&!g.auto).flatMap(g=>g.memberIds||[]));
}

function excludedOrganizationSet(){
  return new Set((state.settings.excludedOrganizations||[]).map(normalizeOrg).filter(Boolean));
}
function excludedCompanionSet(){
  return new Set((state.settings.excludedCompanionGroups||[]).map(str).filter(Boolean));
}

function rebuildAutomaticGroups({persist=false}={}){
  const manualGroups=state.groups.filter(g=>!(g.auto===true || g.type==='organization' || g.type==='companion'));
  const manualUsed=new Set(manualGroups.flatMap(g=>g.memberIds||[]));
  const autoGroups=[];
  const autoUsed=new Set();

  // 1) 같은 외부기관은 무조건 하나의 운영 그룹으로 묶음.
  const byOrg=new Map();
  state.participants.filter(participantActive).forEach(p=>{
    if(manualUsed.has(p.id))return;
    const org=normalizeOrg(p.organization);
    if(!org||isInternalOrganization(org)||excludedOrganizationSet().has(org))return;
    if(!byOrg.has(org))byOrg.set(org,[]);
    byOrg.get(org).push(p);
  });
  for(const [org,members] of byOrg.entries()){
    if(members.length<2)continue;
    const old=state.groups.find(g=>g.type==='organization'&&normalizeOrg(g.organization)===org);
    const ids=members.map(p=>p.id);
    const rep=(old&&ids.includes(old.representativeId)?old.representativeId:'') || members.find(p=>p.phone)?.id || members[0].id;
    autoGroups.push({
      id:old?.id||`org:${crypto.createHash('sha1').update(org).digest('hex').slice(0,12)}`,
      type:'organization',auto:true,name:org,organization:org,
      representativeId:rep,memberIds:ids,createdAt:old?.createdAt||nowIso(),
      extraStanding:num(old?.extraStanding,0),extraGiftCount:num(old?.extraGiftCount,0)
    });
    ids.forEach(id=>autoUsed.add(id));
  }

  // 2) 기관 그룹으로 묶이지 않은 동반신청자는 companionGroup 값 기준으로 묶음.
  const byCompanion=new Map();
  state.participants.filter(participantActive).forEach(p=>{
    if(manualUsed.has(p.id)||autoUsed.has(p.id))return;
    const key=str(p.companionGroup);
    if(!key||excludedCompanionSet().has(key))return;
    if(!byCompanion.has(key))byCompanion.set(key,[]);
    byCompanion.get(key).push(p);
  });
  for(const [key,members] of byCompanion.entries()){
    if(members.length<2)continue;
    const old=state.groups.find(g=>g.type==='companion'&&g.companionGroup===key);
    const ids=members.map(p=>p.id);
    const sharedOrg=sameExternalOrganization(members);
    const rep=(old&&ids.includes(old.representativeId)?old.representativeId:'') || members.find(p=>p.phone)?.id || members[0].id;
    autoGroups.push({
      id:old?.id||`comp:${key}`,type:'companion',auto:true,
      name:sharedOrg||'동반',organization:sharedOrg||'',companionGroup:key,
      representativeId:rep,memberIds:ids,createdAt:old?.createdAt||nowIso(),
      extraStanding:num(old?.extraStanding,0),extraGiftCount:num(old?.extraGiftCount,0)
    });
    ids.forEach(id=>autoUsed.add(id));
  }

  const before=JSON.stringify(state.groups.map(g=>({id:g.id,type:g.type,name:g.name,memberIds:g.memberIds,representativeId:g.representativeId})));
  state.groups=[...manualGroups,...autoGroups];
  const after=JSON.stringify(state.groups.map(g=>({id:g.id,type:g.type,name:g.name,memberIds:g.memberIds,representativeId:g.representativeId})));
  const changed=before!==after;
  if(changed&&persist)saveState();
  return {changed,organizationGroups:autoGroups.filter(g=>g.type==='organization').length,companionGroups:autoGroups.filter(g=>g.type==='companion').length};
}
function groupForParticipant(p){
  if(!p)return null;
  // 명시적인 수동 대표자 그룹 → 기관 그룹 → 동반 그룹 순.
  return state.groups.find(g=>g.type==='representative'&&!g.auto&&g.memberIds?.includes(p.id))
    || state.groups.find(g=>g.type==='organization'&&g.memberIds?.includes(p.id))
    || state.groups.find(g=>g.type==='companion'&&g.memberIds?.includes(p.id))
    || state.groups.find(g=>g.memberIds?.includes(p.id));
}
function markArrived(p,{station='관리자 웹',sendSms=true}={}){
  const already=Boolean(p.arrived);
  if(!already){
    p.arrived=true;p.arrivedAt=nowIso();p.giftReceived=true;p.giftReceivedAt=nowIso();p.modifiedAt=nowIso();
    if(!p.seat && state.settings.autoSeatAssignOnCheckin!==false)assignOne(p);
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
    participationStatus:str(r['참여상태'])||'참여',seatCategory:str(r['좌석구분']||r['좌석유형'])||'auto',seatLocked:bool(r['좌석고정']),giftReceived:false,onsite:false
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

app.get('/api/health',(req,res)=>{
  let disk=null;try{const d=fs.statfsSync(DATA_DIR);disk={totalBytes:d.blocks*d.bsize,freeBytes:d.bavail*d.bsize}}catch(_){}
  res.json({ok:true,version:'0.8.0',serverTime:nowIso(),uptimeSeconds:Math.round(process.uptime()),participants:state.participants.length,
    smsReady:munjanaraConfigured(),externalBackupConfigured:Boolean(GDRIVE_BACKUP_URL&&GDRIVE_BACKUP_TOKEN),
    disk,memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}});
});
app.post('/api/login',(req,res)=>{
  const role=passwordRole(req.body?.password);
  if(!role)return res.status(401).json({ok:false,error:'비밀번호가 올바르지 않습니다.'});
  const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+SESSION_TTL_MS;
  sessions.set(token,{expiresAt,role});
  res.json({ok:true,token,role,roleLabel:roleLabel(role),expiresAt:new Date(expiresAt).toISOString()});
});

app.get('/api/events',(req,res)=>{
  const token=str(req.query.token),session=sessions.get(token);
  if(!session||session.expiresAt<=Date.now())return res.status(401).end();
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ok:true,at:nowIso()})}\n\n`);
  sseClients.add(res);
  const keepalive=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},25000);
  req.on('close',()=>{clearInterval(keepalive);sseClients.delete(res)});
});

app.use('/api',roleGate);

app.get('/api/bootstrap',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:true});
  const active=state.participants.filter(participantActive);
  const extraGifts=state.groups.reduce((n,g)=>n+num(g.extraGiftCount,0),0);
  res.json({ok:true,serverTime:nowIso(),role:req.adminRole,roleLabel:roleLabel(req.adminRole),summary:{
    participants:state.participants.length,active:active.length,arrived:active.filter(p=>p.arrived).length,
    groups:state.groups.length,seats:state.seats.length,assignedSeats:active.filter(p=>p.seat).length,
    giftsReceived:state.participants.filter(p=>p.giftReceived).length+extraGifts,
    smsPending:state.smsQueue.filter(x=>x.status==='대기'||x.status==='pending').length,
    onsite:state.participants.filter(p=>p.onsite).length
  },settings:state.settings,meta:state.meta});
});

function adminAudit(type, target, beforeValue, afterValue, note=''){
  state.logs.unshift({
    id:uuid('audit'), at:nowIso(), type,
    targetId:target?.id||'', targetName:target?.name||'',
    before:beforeValue||null, after:afterValue||null, note
  });
  state.logs=state.logs.slice(0,10000);
}
function participantPublic(p){
  if(!p)return null;
  return {...p, group:groupForParticipant(p)?.id||''};
}

function availableParticipantIds(excludeGroupId=''){
  const used=new Set(state.groups.filter(g=>g.id!==excludeGroupId && g.type!=='companion').flatMap(g=>g.memberIds||[]));
  return state.participants.filter(participantActive).filter(p=>!used.has(p.id));
}
function findSeatOccupant(code){
  const c=str(code).toUpperCase();
  return state.participants.find(p=>participantActive(p)&&str(p.seat).toUpperCase()===c)||null;
}

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

app.post('/api/participants/:id/admin-update',auth,(req,res)=>{
  const p=state.participants.find(x=>x.id===req.params.id);
  if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const before={...p};
  const b=req.body||{};
  if('name'in b)p.name=str(b.name);
  if('phone'in b)p.phone=phone(b.phone);
  if('organization'in b)p.organization=str(b.organization);
  if('note'in b)p.note=str(b.note);
  if('participationStatus'in b)p.participationStatus=str(b.participationStatus)||'참여';
  if('active'in b)p.active=bool(b.active);
  if('wheelchairUser'in b)p.wheelchairUser=bool(b.wheelchairUser);
  if('disabledPerson'in b)p.disabledPerson=bool(b.disabledPerson);
  if('usesCenter'in b)p.usesCenter=bool(b.usesCenter);
  if('seatCategory'in b)p.seatCategory=str(b.seatCategory)||'auto';
  if('seatLocked'in b)p.seatLocked=bool(b.seatLocked);
  if('arrived'in b){
    const newArrived=bool(b.arrived);
    if(newArrived&&!p.arrived){p.arrived=true;p.arrivedAt=nowIso();}
    if(!newArrived&&p.arrived){p.arrived=false;p.arrivedAt=null;}
  }
  p.modifiedAt=nowIso();
  adminAudit('참가자수정',p,before,{...p},str(b.auditNote));
  saveState();
  res.json({ok:true,participant:p});
});
app.get('/api/participants/unassigned',auth,(req,res)=>{
  const rows=state.participants.filter(p=>participantActive(p)&&!p.seat)
    .sort((a,b)=>num(a.receptionNo)-num(b.receptionNo));
  res.json({ok:true,total:rows.length,rows:rows.slice(0,1000)});
});
app.get('/api/participants/search',auth,(req,res)=>{
  const q=str(req.query.q).toLowerCase();
  const qd=digits(q);
  let rows=state.participants.filter(participantActive);
  if(q)rows=rows.filter(p=>`${p.name} ${p.phone} ${p.organization} ${p.id} ${p.seat}`.toLowerCase().includes(q)||(qd.length>=3&&digits(p.phone).includes(qd)));
  res.json({ok:true,rows:rows.slice(0,80)});
});

app.post('/api/checkin/individual',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'QR 참가자를 찾을 수 없습니다.'});
  const g=groupForParticipant(p);if(g)return res.status(409).json({ok:false,error:'단체 참가자입니다.',groupRequired:true,group:g,participant:p});
  const r=markArrived(p,{station:str(req.body?.station)||'QR접수'});
  saveState();res.json({ok:true,...r});
});
app.post('/api/checkin/lookup',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'QR 참가자를 찾을 수 없습니다.'});
  const g=groupForParticipant(p);
  let group=null;
  if(g){
    const members=g.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    group={...g,name:groupDisplayName(g),members,total:members.length,arrived:members.filter(p=>p.arrived).length};
  }
  res.json({ok:true,participant:p,group});
});
app.post('/api/checkin/group',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const group=state.groups.find(g=>g.id===str(req.body?.groupId));if(!group)return res.status(404).json({ok:false,error:'단체를 찾을 수 없습니다.'});
  const members=group.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean).filter(participantActive);
  const pending=members.filter(p=>!p.arrived);
  const scannedId=str(req.body?.scannedParticipantId);
  const scanned=members.find(p=>p.id===scannedId)||null;
  const actual=Math.max(0,num(req.body?.actualCount,0));
  const registeredRemaining=pending.length;
  const checkCount=Math.min(actual,registeredRemaining);
  const extras=Math.max(0,actual-registeredRemaining);

  // QR을 찍은 사람이 미도착이면 그 사람을 가장 먼저 이번 접수 대상에 포함.
  const orderedPending=[...pending].sort((a,b)=>{
    if(a.id===scannedId)return -1;if(b.id===scannedId)return 1;
    return num(a.receptionNo)-num(b.receptionNo);
  });
  const selected=orderedPending.slice(0,checkCount);

  // 이번에 안 온 미도착 멤버 좌석은 비움.
  orderedPending.slice(checkCount).forEach(p=>releaseSeat(p));
  selected.forEach(p=>{p.arrived=true;p.arrivedAt=nowIso();p.giftReceived=true;p.giftReceivedAt=nowIso();p.modifiedAt=nowIso()});
  assignContiguous(selected);
  const displayName=groupDisplayName(group);
  selected.forEach(p=>addLog('단체QR접수',p,`단체 ${displayName}`,str(req.body?.station)||'QR접수'));
  group.extraStanding=num(group.extraStanding,0)+extras;
  group.extraGiftCount=num(group.extraGiftCount,0)+extras;
  group.lastCheckinAt=nowIso();
  group.lastActualCount=actual;

  // 동반/기관 그룹 모두 'QR을 실제로 제시한 사람'에게 우선 문자 발송.
  const smsTarget=(scanned?.phone?scanned:null)
    || state.participants.find(p=>p.id===group.representativeId&&p.phone)
    || selected.find(p=>p.phone)
    || members.find(p=>p.phone);
  let sms=null;
  if(smsTarget?.phone&&state.settings.checkinSmsEnabled!==false){
    const seats=selected.map(p=>p.seat).filter(Boolean);
    const extraText=extras?`추가 ${extras}명은 좌석 미배정(스탠딩 안내)입니다.`:'';
    sms=queueAndSendSms(smsTarget.phone,`[남양주시장애인복지관]\n${displayName} 현장 접수가 완료되었습니다.\n이번 접수 ${actual}명 / 좌석 ${checkCount}석\n${seats.length?'좌석: '+seats.join(', ')+'\n':''}${extraText}\n기념품: ${actual}명 지급완료\n감사합니다.`,'group-checkin',smsTarget.id);
  }
  saveState();res.json({ok:true,groupName:displayName,total:members.length,checkedInNow:checkCount,actualCount:actual,extraStanding:extras,seats:selected.map(p=>p.seat).filter(Boolean),smsQueued:Boolean(sms),smsTargetName:smsTarget?.name||''});
});
app.post('/api/checkin/undo',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  p.arrived=false;p.arrivedAt=null;p.giftReceived=false;p.giftReceivedAt=null;releaseSeat(p);p.modifiedAt=nowIso();
  addLog('접수취소',p,'도착·기념품·좌석 취소',str(req.body?.station)||'관리자');
  saveState();res.json({ok:true,participant:p});
});


app.get('/api/groups',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const rows=state.groups.map(g=>{
    const members=g.memberIds.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    return {...g,name:groupDisplayName(g),total:members.length,arrived:members.filter(p=>p.arrived).length,members};
  });
  res.json({ok:true,rows});
});

app.get('/api/group-suggestions',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const rows=state.groups.filter(g=>g.type==='organization').map(g=>{
    const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    return {organization:g.organization,count:members.length,ungrouped:0,groupId:g.id,
      members:members.map(p=>({id:p.id,name:p.name,phone:p.phone,seat:p.seat}))};
  }).sort((a,b)=>b.count-a.count);
  res.json({ok:true,rows});
});
app.get('/api/groups/exclusions',auth,(req,res)=>{
  res.json({ok:true,keywords:getGroupExclusionKeywords(),defaults:DEFAULT_GROUP_EXCLUSION_KEYWORDS});
});
app.post('/api/groups/exclusions',auth,(req,res)=>{
  const keywords=(Array.isArray(req.body?.keywords)?req.body.keywords:[]).map(str).filter(Boolean);
  state.settings.groupExclusionKeywords=keywords;
  const result=rebuildAutomaticGroups({persist:false});
  adminAudit('그룹제외어수정',{id:'group-exclusions',name:'자동 기관묶음 제외어'},null,{keywords});
  saveState();
  res.json({ok:true,keywords,result});
});
app.post('/api/groups/rebuild-auto',auth,(req,res)=>{
  const result=rebuildAutomaticGroups({persist:false});
  adminAudit('자동그룹재구성',{id:'auto-groups',name:'자동 그룹'},null,result);
  saveState();
  res.json({ok:true,...result,totalGroups:state.groups.length});
});
app.post('/api/groups/create-by-organization',auth,(req,res)=>{
  const organization=normalizeOrg(req.body?.organization);
  if(!organization)return res.status(400).json({ok:false,error:'소속기관을 선택해 주세요.'});
  if(isInternalOrganization(organization))return res.status(400).json({ok:false,error:'자동 그룹 제외기관입니다. 제외어 설정을 확인해 주세요.'});
  rebuildAutomaticGroups({persist:false});
  const g=state.groups.find(g=>g.type==='organization'&&normalizeOrg(g.organization)===organization);
  if(!g)return res.status(404).json({ok:false,error:'해당 기관은 2명 이상이 아니거나 자동그룹 대상이 아닙니다.'});
  saveState();res.json({ok:true,group:{...g,name:groupDisplayName(g)}});
});
app.post('/api/groups/:id/delete',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const i=state.groups.findIndex(g=>g.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:'단체를 찾을 수 없습니다.'});
  const g=state.groups[i];
  if(g.type==='organization'&&g.auto){
    const arr=new Set(state.settings.excludedOrganizations||[]);arr.add(normalizeOrg(g.organization));state.settings.excludedOrganizations=[...arr];
  }else if(g.type==='companion'&&g.auto){
    const arr=new Set(state.settings.excludedCompanionGroups||[]);arr.add(str(g.companionGroup));state.settings.excludedCompanionGroups=[...arr];
  }else{
    state.groups.splice(i,1);
  }
  rebuildAutomaticGroups({persist:false});
  adminAudit('그룹자동제외',g,null,{type:g.type,name:groupDisplayName(g)});
  saveState();res.json({ok:true,group:g});
});
app.get('/api/groups/excluded',auth,(req,res)=>{
  res.json({ok:true,organizations:state.settings.excludedOrganizations||[],companions:state.settings.excludedCompanionGroups||[]});
});
app.post('/api/groups/restore-excluded',auth,(req,res)=>{
  const type=str(req.body?.type),value=str(req.body?.value);
  if(type==='organization')state.settings.excludedOrganizations=(state.settings.excludedOrganizations||[]).filter(x=>normalizeOrg(x)!==normalizeOrg(value));
  else if(type==='companion')state.settings.excludedCompanionGroups=(state.settings.excludedCompanionGroups||[]).filter(x=>str(x)!==value);
  else return res.status(400).json({ok:false,error:'복원 유형이 올바르지 않습니다.'});
  const result=rebuildAutomaticGroups({persist:false});
  adminAudit('자동그룹복원',{id:value,name:value},null,{type,value});
  saveState();res.json({ok:true,result});
});


app.get('/api/groups/manage',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const groups=state.groups.map(g=>{
    const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    const rep=state.participants.find(p=>p.id===g.representativeId)||null;
    return {...g,name:groupDisplayName(g),members,representative:rep,total:members.length,arrived:members.filter(p=>p.arrived).length};
  });
  res.json({ok:true,rows:groups});
});
app.post('/api/groups/manual',auth,(req,res)=>{
  const b=req.body||{},ids=[...new Set((b.memberIds||[]).map(str).filter(Boolean))];
  if(ids.length<2)return res.status(400).json({ok:false,error:'구성원은 2명 이상이어야 합니다.'});
  const allowed=new Set(availableParticipantIds().map(p=>p.id));
  const members=ids.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
  if(members.length!==ids.length)return res.status(400).json({ok:false,error:'일부 참가자를 찾을 수 없습니다.'});
  if(ids.some(id=>!allowed.has(id)))return res.status(409).json({ok:false,error:'이미 다른 대표자/기관 그룹에 포함된 참가자가 있습니다.'});
  const rep=members.find(p=>p.id===str(b.representativeId))||members.find(p=>p.phone)||members[0];
  const g={id:uuid('grp'),type:'representative',name:str(b.name)||`${rep.name} 대표그룹`,organization:str(b.organization),representativeId:rep.id,memberIds:ids,createdAt:nowIso(),extraStanding:0,extraGiftCount:0};
  state.groups.push(g);adminAudit('대표자그룹생성',g,null,g);saveState();res.json({ok:true,group:g});
});
app.put('/api/groups/:id/manage',auth,(req,res)=>{
  const g=state.groups.find(x=>x.id===req.params.id);if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const before=JSON.parse(JSON.stringify(g)),b=req.body||{};
  if('name'in b)g.name=str(b.name);
  if(Array.isArray(b.memberIds)){
    const ids=[...new Set(b.memberIds.map(str).filter(Boolean))];
    if(ids.length<2)return res.status(400).json({ok:false,error:'구성원은 2명 이상이어야 합니다.'});
    const allowed=new Set(availableParticipantIds(g.id).map(p=>p.id));
    if(ids.some(id=>!allowed.has(id)&&!(g.memberIds||[]).includes(id)))return res.status(409).json({ok:false,error:'다른 그룹에 포함된 참가자가 있습니다.'});
    g.memberIds=ids;
  }
  if('representativeId'in b && g.memberIds.includes(str(b.representativeId)))g.representativeId=str(b.representativeId);
  if(!g.memberIds.includes(g.representativeId))g.representativeId=g.memberIds[0];
  g.modifiedAt=nowIso();adminAudit('그룹수정',g,before,g);saveState();res.json({ok:true,group:g});
});
app.post('/api/groups/:id/member-add',auth,(req,res)=>{
  const g=state.groups.find(x=>x.id===req.params.id);if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const pid=str(req.body?.participantId),p=state.participants.find(x=>x.id===pid);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  if(g.type==='companion'){p.companionGroup=g.companionGroup}
  else{
    const allowed=new Set(availableParticipantIds(g.id).map(x=>x.id));
    if(!allowed.has(pid)&&!(g.memberIds||[]).includes(pid))return res.status(409).json({ok:false,error:'다른 그룹에 포함된 참가자입니다.'});
  }
  if(!g.memberIds.includes(pid))g.memberIds.push(pid);
  adminAudit('그룹구성원추가',g,null,{participantId:pid});saveState();res.json({ok:true});
});
app.post('/api/groups/:id/member-remove',auth,(req,res)=>{
  const g=state.groups.find(x=>x.id===req.params.id);if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const pid=str(req.body?.participantId);
  g.memberIds=(g.memberIds||[]).filter(id=>id!==pid);
  const p=state.participants.find(x=>x.id===pid);if(g.type==='companion'&&p)p.companionGroup='';
  if(g.memberIds.length<2){
    state.groups=state.groups.filter(x=>x.id!==g.id);
  }else if(!g.memberIds.includes(g.representativeId))g.representativeId=g.memberIds[0];
  adminAudit('그룹구성원제거',g,null,{participantId:pid});saveState();res.json({ok:true});
});
app.post('/api/groups/:id/representative',auth,(req,res)=>{
  const g=state.groups.find(x=>x.id===req.params.id);if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const pid=str(req.body?.participantId);if(!(g.memberIds||[]).includes(pid))return res.status(400).json({ok:false,error:'그룹 구성원만 대표자로 지정할 수 있습니다.'});
  const before=g.representativeId;g.representativeId=pid;adminAudit('그룹대표자변경',g,{representativeId:before},{representativeId:pid});saveState();res.json({ok:true});
});

app.get('/api/seats',auth,(req,res)=>{
  const participantMap=new Map();
  state.participants.filter(p=>participantActive(p)&&p.seat).forEach(p=>participantMap.set(str(p.seat).toUpperCase(),p));
  const rows=state.seats.map(s=>{
    const participant=participantMap.get(str(s.code).toUpperCase())||null;
    return {...s,occupied:Boolean(participant),arrived:Boolean(participant?.arrived),participant};
  });
  res.json({
    ok:true,
    total:rows.length,
    assigned:rows.filter(x=>x.occupied).length,
    arrivedAssigned:rows.filter(x=>x.arrived).length,
    rows
  });
});
app.post('/api/seats/release-pending',auth,(req,res)=>{
  let count=0;
  state.participants.filter(p=>!p.arrived&&participantActive(p)&&p.seat).forEach(p=>{releaseSeat(p);count++});
  saveState();res.json({ok:true,released:count});
});


app.post('/api/seats/:code/assign',auth,(req,res)=>{
  const code=str(req.params.code).toUpperCase(),seat=seatByCode(code);
  if(!seat||!seat.enabled)return res.status(404).json({ok:false,error:'사용 가능한 좌석을 찾을 수 없습니다.'});
  const p=state.participants.find(x=>x.id===str(req.body?.participantId));if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const occupant=findSeatOccupant(code),oldSeat=str(p.seat).toUpperCase();
  if(occupant&&occupant.id!==p.id){
    const mode=str(req.body?.mode||'swap');
    if(mode==='swap'&&oldSeat){
      occupant.seat=oldSeat;
    }else{
      occupant.seat='';
    }
    occupant.modifiedAt=nowIso();
  }
  p.seat=code;p.modifiedAt=nowIso();
  adminAudit('좌석직접지정',p,{seat:oldSeat},{seat:code},occupant&&occupant.id!==p.id?`기존 ${occupant.name} ${occupant.seat||'미배정'} 처리`:'');
  saveState();res.json({ok:true,participant:p,movedOccupant:occupant&&occupant.id!==p.id?occupant:null});
});
app.post('/api/seats/:code/release',auth,(req,res)=>{
  const code=str(req.params.code).toUpperCase(),p=findSeatOccupant(code);
  if(!p)return res.json({ok:true,released:false});
  const before=p.seat;p.seat='';p.modifiedAt=nowIso();adminAudit('좌석해제',p,{seat:before},{seat:''});saveState();res.json({ok:true,released:true,participant:p});
});
app.post('/api/seats/swap',auth,(req,res)=>{
  const a=state.participants.find(x=>x.id===str(req.body?.participantA)),b=state.participants.find(x=>x.id===str(req.body?.participantB));
  if(!a||!b)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const sa=a.seat||'',sb=b.seat||'';a.seat=sb;b.seat=sa;a.modifiedAt=b.modifiedAt=nowIso();
  adminAudit('좌석교환',a,{seat:sa},{seat:sb},`${b.name}와 교환`);saveState();res.json({ok:true,a,b});
});
app.post('/api/seats/auto-assign-unassigned',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const onlyArrived=bool(req.body?.onlyArrived);
  const targets=state.participants.filter(p=>participantActive(p)&&!p.seat&&(!onlyArrived||p.arrived)&&!p.onsite);
  const targetIds=new Set(targets.map(p=>p.id));
  let assigned=0,groupsDone=0;
  state.groups.forEach(g=>{
    const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(p=>p&&targetIds.has(p.id));
    if(members.length>=2){
      assignContiguous(members);
      members.forEach(p=>{if(p.seat){assigned++;targetIds.delete(p.id)}});
      groupsDone++;
    }
  });
  state.participants.filter(p=>targetIds.has(p.id)).sort((a,b)=>num(a.receptionNo)-num(b.receptionNo)).forEach(p=>{if(assignOne(p))assigned++});
  adminAudit('좌석일괄배치',{id:'bulk',name:'미배정자'},null,{assigned,groupsDone,onlyArrived});
  saveState();res.json({ok:true,assigned,groupsDone,remaining:state.participants.filter(p=>participantActive(p)&&!p.seat&&!p.onsite).length});
});



app.post('/api/seats/reset-general',auth,(req,res)=>{
  let released=0;
  state.participants.filter(participantActive).forEach(p=>{
    if(!p.seat||p.seatLocked)return;
    if(seatCodeCategory(p.seat)==='general'){p.seat='';p.modifiedAt=nowIso();released++}
  });
  adminAudit('일반좌석초기화',{id:'general-seats',name:'G~Y 일반석'},null,{released});
  saveState();res.json({ok:true,released});
});
app.post('/api/seats/final-auto-assign',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const resetGeneral=req.body?.resetGeneral!==false;
  let resetCount=0;
  if(resetGeneral){
    state.participants.filter(participantActive).forEach(p=>{
      if(p.seat&&!p.seatLocked&&seatCodeCategory(p.seat)==='general'){p.seat='';resetCount++}
    });
  }
  let vip=0,guest=0,wheelchair=0,general=0,groupsDone=0;

  const active=state.participants.filter(p=>participantActive(p)&&!p.onsite);
  active.filter(p=>!p.seat&&(p.seatCategory==='vip')).sort((a,b)=>num(a.receptionNo)-num(b.receptionNo)).forEach(p=>{if(assignOneCategory(p,'vip'))vip++});
  active.filter(p=>!p.seat&&(p.seatCategory==='guest')).sort((a,b)=>num(a.receptionNo)-num(b.receptionNo)).forEach(p=>{if(assignOneCategory(p,'guest'))guest++});
  active.filter(p=>!p.seat&&(p.wheelchairUser||p.seatCategory==='wheelchair')).sort((a,b)=>num(a.receptionNo)-num(b.receptionNo)).forEach(p=>{
    if(assignOneCategory(p,'wheelchair')||assignOneCategory(p,'general'))wheelchair++;
  });

  const remaining=new Set(active.filter(p=>!p.seat).map(p=>p.id));
  const priorityGroups=[
    ...state.groups.filter(g=>g.type==='representative'&&!g.auto),
    ...state.groups.filter(g=>g.type==='companion'),
    ...state.groups.filter(g=>g.type==='organization')
  ];
  for(const g of priorityGroups){
    const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(p=>p&&remaining.has(p.id)&&!p.wheelchairUser);
    if(members.length>=2){
      assignContiguousCategory(members,'general');
      members.forEach(p=>{if(p.seat){remaining.delete(p.id);general++}});
      groupsDone++;
    }
  }
  active.filter(p=>remaining.has(p.id)).sort((a,b)=>num(a.receptionNo)-num(b.receptionNo)).forEach(p=>{
    if(assignOneCategory(p,'general')){general++;remaining.delete(p.id)}
  });

  const result={resetCount,vip,guest,wheelchair,general,groupsDone,remaining:remaining.size};
  adminAudit('최종좌석일괄배치',{id:'final-layout',name:'최종 좌석배치'},null,result);
  saveState();res.json({ok:true,...result});
});

app.get('/api/logs',auth,(req,res)=>{
  const q=str(req.query.q).toLowerCase();
  const type=str(req.query.type);
  const limit=Math.max(20,Math.min(1000,num(req.query.limit,300)));
  let rows=[...state.logs,...state.checkins.map(x=>({
    id:`checkin-${x.at}-${x.participantId}`,at:x.at,type:x.action||'접수로그',
    targetId:x.participantId,targetName:x.name,note:`${x.station||''} ${x.note||''}`.trim(),
    before:null,after:{seat:x.seat}
  }))].filter(Boolean);
  if(type)rows=rows.filter(x=>str(x.type)===type);
  if(q)rows=rows.filter(x=>`${x.type} ${x.targetId} ${x.targetName} ${x.note}`.toLowerCase().includes(q));
  rows.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
  res.json({ok:true,total:rows.length,rows:rows.slice(0,limit)});
});


const rafflePreparations=new Map();
function eligibleRafflePool(filter='all'){
  const wonIds=new Set(state.rouletteHistory.filter(x=>x.enabled!==false).map(x=>x.participantId));
  let pool=state.participants.filter(p=>p.arrived&&participantActive(p)&&!wonIds.has(p.id));
  if(filter==='usesCenter')pool=pool.filter(p=>p.usesCenter);
  if(filter==='disabledPerson')pool=pool.filter(p=>p.disabledPerson);
  if(filter==='wheelchair')pool=pool.filter(p=>p.wheelchairUser);
  return pool;
}
function cryptoPickUnique(pool,count){
  const copy=[...pool],out=[];
  while(out.length<count&&copy.length){
    const i=crypto.randomInt(0,copy.length);
    out.push(copy.splice(i,1)[0]);
  }
  return out;
}
app.get('/api/raffle/products',auth,(req,res)=>res.json({ok:true,rows:state.rouletteProducts}));
app.post('/api/raffle/prepare',auth,(req,res)=>{
  const productNo=str(req.body?.productNo),count=Math.max(1,Math.min(20,num(req.body?.count,1))),filter=str(req.body?.filter||'all');
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:str(req.body?.productName)||'행운상품',quantity:999,enabled:true};
  if(!product.enabled)return res.status(400).json({ok:false,error:'사용 중지된 상품입니다.'});
  const pool=eligibleRafflePool(filter);
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const token=uuid('raffle');
  const sample=cryptoPickUnique(pool,Math.min(40,pool.length)).map(p=>({id:p.id,name:p.name,seat:p.seat,organization:p.organization}));
  rafflePreparations.set(token,{createdAt:Date.now(),productNo:product.number,productName:product.name,count,filter,poolIds:pool.map(p=>p.id)});
  setTimeout(()=>rafflePreparations.delete(token),10*60*1000).unref?.();
  res.json({ok:true,token,product,count,filter,poolSize:pool.length,sample});
});
app.post('/api/raffle/commit',auth,(req,res)=>{
  const token=str(req.body?.token),prep=rafflePreparations.get(token);
  if(!prep)return res.status(400).json({ok:false,error:'추첨 준비정보가 만료되었습니다. 다시 시작해 주세요.'});
  const currentPool=eligibleRafflePool(prep.filter).filter(p=>prep.poolIds.includes(p.id));
  if(currentPool.length<prep.count)return res.status(400).json({ok:false,error:'추첨 대상이 변경되어 다시 준비해야 합니다.'});
  const product=state.rouletteProducts.find(x=>str(x.number)===str(prep.productNo))||{number:prep.productNo,name:prep.productName};
  const winners=cryptoPickUnique(currentPool,prep.count);
  const drawId=uuid('draw'),drawnAt=nowIso();
  const records=winners.map((p,i)=>({drawId,drawnAt,prizeNo:product.number,prizeName:product.name,method:'시네마틱 랜덤',participantId:p.id,participantName:p.name,seat:p.seat,rank:i+1,enabled:true,received:false,filter:prep.filter}));
  state.rouletteHistory.push(...records);
  adminAudit('행운권추첨',{id:drawId,name:product.name},null,{winnerIds:winners.map(p=>p.id),count:records.length,filter:prep.filter},`대상 ${currentPool.length}명`);
  rafflePreparations.delete(token);
  saveState();
  res.json({ok:true,drawId,product,winners:records,poolSize:currentPool.length});
});
app.post('/api/raffle/draw',auth,(req,res)=>{
  const filter=str(req.body?.filter||'all'),productNo=str(req.body?.productNo),count=Math.max(1,Math.min(20,num(req.body?.count,1)));
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:str(req.body?.productName)||'행운상품',quantity:999,enabled:true};
  const pool=eligibleRafflePool(filter);
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const winners=cryptoPickUnique(pool,count),drawId=uuid('draw'),drawnAt=nowIso();
  const records=winners.map((p,i)=>({drawId,drawnAt,prizeNo:product.number,prizeName:product.name,method:'랜덤',participantId:p.id,participantName:p.name,seat:p.seat,rank:i+1,enabled:true,received:false,filter}));
  state.rouletteHistory.push(...records);saveState();res.json({ok:true,drawId,product,winners:records,poolSize:pool.length});
});
app.get('/api/raffle/history',auth,(req,res)=>res.json({ok:true,rows:[...state.rouletteHistory].reverse().slice(0,500)}));
app.post('/api/raffle/redeem',auth,(req,res)=>{
  const r=state.rouletteHistory.find(x=>x.drawId===str(req.body?.drawId)&&x.participantId===str(req.body?.participantId));
  if(!r)return res.status(404).json({ok:false,error:'당첨 기록을 찾을 수 없습니다.'});
  r.received=true;r.receivedAt=nowIso();adminAudit('경품수령',r,null,{received:true});saveState();res.json({ok:true,record:r});
});
app.post('/api/raffle/cancel',auth,(req,res)=>{
  const drawId=str(req.body?.drawId),participantId=str(req.body?.participantId);
  const r=state.rouletteHistory.find(x=>x.drawId===drawId&&x.participantId===participantId);
  if(!r)return res.status(404).json({ok:false,error:'당첨 기록을 찾을 수 없습니다.'});
  r.enabled=false;r.canceledAt=nowIso();adminAudit('당첨취소',r,{enabled:true},{enabled:false});saveState();res.json({ok:true});
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


app.post('/api/sms/send-group',auth,async(req,res)=>{
  rebuildAutomaticGroups({persist:false});
  const g=state.groups.find(x=>x.id===str(req.body?.groupId));
  if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const message=str(req.body?.message);if(!message)return res.status(400).json({ok:false,error:'문자 내용을 입력해 주세요.'});
  const mode=str(req.body?.mode||'representative');
  const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
  let targets=[];
  if(mode==='all')targets=members.filter(p=>p.phone);
  else{
    const rep=members.find(p=>p.id===g.representativeId&&p.phone)||members.find(p=>p.phone);
    if(rep)targets=[rep];
  }
  const seen=new Set();
  targets=targets.filter(p=>{const d=digits(p.phone);if(!d||seen.has(d))return false;seen.add(d);return true});
  if(!targets.length)return res.status(400).json({ok:false,error:'발송 가능한 연락처가 없습니다.'});
  const items=targets.map(p=>queueAndSendSms(p.phone,message,'group-manual',p.id)).filter(Boolean);
  adminAudit('그룹문자',{id:g.id,name:groupDisplayName(g)},null,{mode,count:items.length});
  saveState();
  res.json({ok:true,queued:items.length,groupName:groupDisplayName(g)});
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



app.get('/api/settings',auth,(req,res)=>{
  res.json({ok:true,settings:state.settings,role:req.adminRole,roleLabel:roleLabel(req.adminRole),rolePasswords:{
    reception:Boolean(RECEPTION_PASSWORD),seat:Boolean(SEAT_PASSWORD),raffle:Boolean(RAFFLE_PASSWORD)
  },externalBackupConfigured:Boolean(GDRIVE_BACKUP_URL&&GDRIVE_BACKUP_TOKEN)});
});
app.post('/api/settings',auth,(req,res)=>{
  if(req.adminRole!=='admin')return res.status(403).json({ok:false,error:'메인 관리자만 설정을 변경할 수 있습니다.'});
  const b=req.body||{},before={...state.settings};
  const textKeys=['eventName','eventDate','eventVenue','eventHost'];
  textKeys.forEach(k=>{if(k in b)state.settings[k]=str(b[k])});
  if('applicationCapacity'in b)state.settings.applicationCapacity=Math.max(1,num(b.applicationCapacity,450));
  if('checkinSmsEnabled'in b)state.settings.checkinSmsEnabled=bool(b.checkinSmsEnabled);
  if('autoSeatAssignOnCheckin'in b)state.settings.autoSeatAssignOnCheckin=bool(b.autoSeatAssignOnCheckin);
  if('individualAutoCheckinDelayMs'in b)state.settings.individualAutoCheckinDelayMs=Math.max(300,Math.min(10000,num(b.individualAutoCheckinDelayMs,1400)));
  if('checkinPopupCloseMs'in b)state.settings.checkinPopupCloseMs=Math.max(300,Math.min(10000,num(b.checkinPopupCloseMs,850)));
  if('externalBackupEnabled'in b)state.settings.externalBackupEnabled=bool(b.externalBackupEnabled);
  if('externalBackupIntervalSec'in b)state.settings.externalBackupIntervalSec=Math.max(30,Math.min(3600,num(b.externalBackupIntervalSec,60)));
  if('externalSnapshotIntervalMin'in b)state.settings.externalSnapshotIntervalMin=Math.max(1,Math.min(1440,num(b.externalSnapshotIntervalMin,10)));
  if('autoRestoreExternalIfEmpty'in b)state.settings.autoRestoreExternalIfEmpty=bool(b.autoRestoreExternalIfEmpty);
  adminAudit('시스템설정수정',{id:'settings',name:'시스템 설정'},before,state.settings);
  saveState();res.json({ok:true,settings:state.settings});
});

app.post('/api/import/xlsx/preview',auth,upload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({ok:false,error:'엑셀 파일을 선택해 주세요.'});
    const parsed=buildImport(req.file.buffer,req.file.originalname);
    const importId=uuid('import');
    previews.set(importId,{createdAt:Date.now(),parsed});
    const duplicateQr=parsed.participants.length-new Set(parsed.participants.map(p=>p.id)).size;
    const blankPhones=parsed.participants.filter(p=>!p.phone).length;
    const assignedSeats=parsed.participants.filter(p=>p.seat).length;
    res.json({
      ok:true,importId,fileName:parsed.name,sheets:parsed.sheets,
      summary:{
        participants:parsed.participants.length,
        seats:parsed.seats.length,
        settings:Object.keys(parsed.settings||{}).length,
        rouletteProducts:(parsed.rouletteProducts||[]).length,
        assignedSeats,duplicateQr,blankPhones
      },
      sampleParticipants:parsed.participants.slice(0,12),
      sampleSeats:parsed.seats.slice(0,12)
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});
app.post('/api/import/xlsx/confirm',auth,(req,res)=>{
  const h=previews.get(str(req.body?.importId));
  if(!h)return res.status(400).json({ok:false,error:'미리보기 정보가 만료되었습니다. 다시 파일을 선택해 주세요.'});
  const before=backupNow('before-xlsx-import');
  state.participants=h.parsed.participants;
  state.seats=h.parsed.seats;
  state.settings={...state.settings,...(h.parsed.settings||{})};
  state.rouletteProducts=h.parsed.rouletteProducts||[];
  state.groups=[];
  state.checkins=[];
  state.smsQueue=[];
  state.raffles=[];
  state.rouletteHistory=[];
  state.gifts=[];
  state.meta.importedAt=nowIso();
  state.meta.importSource=h.parsed.name;
  rebuildAutomaticGroups({persist:false});
  adminAudit('XLSX가져오기',{id:'xlsx',name:h.parsed.name},null,{
    participants:state.participants.length,seats:state.seats.length
  });
  saveState();
  const after=backupNow('after-xlsx-import');
  previews.delete(str(req.body?.importId));
  res.json({
    ok:true,participants:state.participants.length,seats:state.seats.length,
    groups:state.groups.length,beforeBackup:before,afterBackup:after
  });
});


const externalBackupRuntime={
  configured:Boolean(GDRIVE_BACKUP_URL&&GDRIVE_BACKUP_TOKEN),
  lastAttemptAt:null,lastSuccessAt:null,lastSnapshotAt:null,lastRestoreAt:null,lastError:'',lastRemoteName:''
};
let externalBackupBusy=false,lastExternalStateUpdatedAt='';
async function externalBackupRequest(action,payload={}){
  if(!GDRIVE_BACKUP_URL||!GDRIVE_BACKUP_TOKEN)throw new Error('Google Drive 외부백업 환경변수가 설정되지 않았습니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try{
    const r=await fetch(GDRIVE_BACKUP_URL,{
      method:'POST',redirect:'follow',signal:controller.signal,
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({token:GDRIVE_BACKUP_TOKEN,action,...payload})
    });
    const text=await r.text();
    let d={};try{d=JSON.parse(text)}catch(_){throw new Error(`외부백업 응답 오류: ${text.slice(0,180)}`)}
    if(!r.ok||!d.ok)throw new Error(d.error||`외부백업 HTTP ${r.status}`);
    return d;
  }finally{clearTimeout(timer)}
}
async function pushExternalBackup({force=false,snapshot=false}={}){
  if(externalBackupBusy)return {ok:false,skipped:'busy'};
  if(!state.settings.externalBackupEnabled&&!force)return {ok:false,skipped:'disabled'};
  if(!GDRIVE_BACKUP_URL||!GDRIVE_BACKUP_TOKEN)return {ok:false,skipped:'not-configured'};
  if(!force&&lastExternalStateUpdatedAt===state.meta.updatedAt)return {ok:true,skipped:'unchanged'};
  externalBackupBusy=true;externalBackupRuntime.lastAttemptAt=nowIso();
  try{
    const d=await externalBackupRequest('save',{state,snapshot,source:'cloudtype-v0.8'});
    externalBackupRuntime.lastSuccessAt=nowIso();
    externalBackupRuntime.lastError='';
    externalBackupRuntime.lastRemoteName=d.name||'latest.json';
    if(snapshot)externalBackupRuntime.lastSnapshotAt=externalBackupRuntime.lastSuccessAt;
    lastExternalStateUpdatedAt=state.meta.updatedAt;
    return {ok:true,...d};
  }catch(e){
    externalBackupRuntime.lastError=e.message;
    throw e;
  }finally{externalBackupBusy=false}
}
async function loadExternalBackup(name='latest.json'){
  const d=await externalBackupRequest('load',{name});
  if(!d.state)throw new Error('외부 백업에 상태 데이터가 없습니다.');
  return d;
}
async function restoreExternalBackup(name='latest.json'){
  backupNow('before-external-restore');
  const d=await loadExternalBackup(name);
  state=normalizeState(d.state);
  state.meta.restoredFromExternal=name;
  state.meta.restoredAt=nowIso();
  rebuildAutomaticGroups({persist:false});
  saveState();backupNow('after-external-restore');
  externalBackupRuntime.lastRestoreAt=nowIso();
  return {ok:true,name,participants:state.participants.length,seats:state.seats.length};
}
async function externalBackupWorker(){
  if(!state.settings.externalBackupEnabled||!GDRIVE_BACKUP_URL||!GDRIVE_BACKUP_TOKEN)return;
  const last=externalBackupRuntime.lastSuccessAt?new Date(externalBackupRuntime.lastSuccessAt).getTime():0;
  const interval=Math.max(30,num(state.settings.externalBackupIntervalSec,60))*1000;
  if(Date.now()-last<interval)return;
  const snapLast=externalBackupRuntime.lastSnapshotAt?new Date(externalBackupRuntime.lastSnapshotAt).getTime():0;
  const snapInterval=Math.max(1,num(state.settings.externalSnapshotIntervalMin,10))*60000;
  try{await pushExternalBackup({snapshot:Date.now()-snapLast>=snapInterval})}catch(e){console.error('[EXTERNAL BACKUP]',e.message)}
}
setInterval(()=>externalBackupWorker(),15000).unref();
setTimeout(async()=>{
  if(state.settings.autoRestoreExternalIfEmpty!==false && state.participants.length===0 && GDRIVE_BACKUP_URL && GDRIVE_BACKUP_TOKEN){
    try{
      const d=await loadExternalBackup('latest.json');
      if(Array.isArray(d.state?.participants)&&d.state.participants.length>0){
        state=normalizeState(d.state);state.meta.autoRestoredAt=nowIso();saveState();backupNow('startup-external-restore');
        externalBackupRuntime.lastRestoreAt=nowIso();
        console.log(`[EXTERNAL RESTORE] ${state.participants.length} participants restored`);
      }
    }catch(e){externalBackupRuntime.lastError=e.message;console.warn('[EXTERNAL RESTORE]',e.message)}
  }
},4000).unref();

app.get('/api/backup/local-list',auth,(req,res)=>{
  const rows=fs.readdirSync(BACKUP_DIR).filter(f=>f.endsWith('.json')).map(f=>{
    const st=fs.statSync(path.join(BACKUP_DIR,f));return {name:f,size:st.size,modifiedAt:st.mtime.toISOString()}
  }).sort((a,b)=>new Date(b.modifiedAt)-new Date(a.modifiedAt)).slice(0,300);
  res.json({ok:true,rows});
});
app.post('/api/backup/local-restore',auth,(req,res)=>{
  const name=path.basename(str(req.body?.name));
  if(!name.endsWith('.json'))return res.status(400).json({ok:false,error:'백업 파일명이 올바르지 않습니다.'});
  const fp=path.join(BACKUP_DIR,name);if(!fs.existsSync(fp))return res.status(404).json({ok:false,error:'로컬 백업을 찾을 수 없습니다.'});
  backupNow('before-local-restore');
  state=normalizeState(JSON.parse(fs.readFileSync(fp,'utf8')));
  state.meta.restoredFromLocal=name;state.meta.restoredAt=nowIso();saveState();backupNow('after-local-restore');
  res.json({ok:true,name,participants:state.participants.length,seats:state.seats.length});
});
app.post('/api/backup/restore',auth,upload.single('file'),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({ok:false,error:'JSON 백업 파일을 선택해 주세요.'});
    backupNow('before-upload-restore');
    const parsed=JSON.parse(req.file.buffer.toString('utf8'));
    state=normalizeState(parsed);state.meta.restoredAt=nowIso();state.meta.restoredFromUpload=req.file.originalname;
    rebuildAutomaticGroups({persist:false});saveState();backupNow('after-upload-restore');
    res.json({ok:true,participants:state.participants.length,seats:state.seats.length,groups:state.groups.length});
  }catch(e){res.status(400).json({ok:false,error:`복원 실패: ${e.message}`})}
});
app.get('/api/external-backup/status',auth,(req,res)=>res.json({
  ok:true,...externalBackupRuntime,configured:Boolean(GDRIVE_BACKUP_URL&&GDRIVE_BACKUP_TOKEN),
  enabled:state.settings.externalBackupEnabled!==false,autoRestore:state.settings.autoRestoreExternalIfEmpty!==false
}));
app.post('/api/external-backup/now',auth,async(req,res)=>{
  try{res.json(await pushExternalBackup({force:true,snapshot:Boolean(req.body?.snapshot)}))}
  catch(e){res.status(502).json({ok:false,error:e.message})}
});
app.get('/api/external-backup/list',auth,async(req,res)=>{
  try{res.json(await externalBackupRequest('list',{}))}
  catch(e){res.status(502).json({ok:false,error:e.message})}
});
app.post('/api/external-backup/restore',auth,async(req,res)=>{
  try{res.json(await restoreExternalBackup(str(req.body?.name)||'latest.json'))}
  catch(e){res.status(502).json({ok:false,error:e.message})}
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
app.listen(PORT,'0.0.0.0',()=>console.log(`NYJWEL Admin v0.8.0 · :${PORT}`));
