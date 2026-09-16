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
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SMS_RELAY_TOKEN = String(process.env.SMS_RELAY_TOKEN || '');
const MUNJANARA_ID = String(process.env.MUNJANARA_ID || '');
const MUNJANARA_PW = String(process.env.MUNJANARA_PW || '');
const MUNJANARA_SENDER = String(process.env.MUNJANARA_SENDER || '');
const MUNJANARA_TEST_RECEIVER = String(process.env.MUNJANARA_TEST_RECEIVER || '');
const PUBLIC_BASE_URL=(process.env.PUBLIC_BASE_URL||'https://port-0-nyjwel20th-admin-v2-mtx2s3js32aa7bae.sel3.cloudtype.app').replace(/\/$/,'');

const GDRIVE_BACKUP_URL = String(process.env.GDRIVE_BACKUP_URL || '');
const GDRIVE_BACKUP_TOKEN = String(process.env.GDRIVE_BACKUP_TOKEN || '');
const RECEPTION_PASSWORD = String(process.env.RECEPTION_PASSWORD || '');
const SEAT_PASSWORD = String(process.env.SEAT_PASSWORD || '');
const RAFFLE_PASSWORD = String(process.env.RAFFLE_PASSWORD || '');

const SYSTEM_DEMO_MODE = String(process.env.SYSTEM_DEMO_MODE || '').toLowerCase()==='true';
const DEMO_PASSWORD = String(process.env.DEMO_PASSWORD || 'demo1234');
const FRONTEND_VERSION = '0.9.16';


if(!ADMIN_PASSWORD && !SYSTEM_DEMO_MODE){
  console.error('[FATAL] ADMIN_PASSWORD 환경변수가 없습니다. 보안을 위해 서버를 시작하지 않습니다.');
  process.exit(1);
}
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
    meta:{app:'nyjwel20th-admin-v2',version:'0.9.18',createdAt:nowIso(),updatedAt:nowIso(),importedAt:null,importSource:null},
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
      eventOperationMode:false,
      stationRequired:false,
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
    meta:{...d.meta,...(s?.meta||{}),version:'0.9.18'},
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

function seedDemoState(){
  const rows='ABCDEFGHIJKLMNO'.split('');
  const seats=[];
  let sort=1;
  for(const row of rows){
    for(const side of ['L','R']){
      for(let n=1;n<=10;n++){
        seats.push({code:`${row}${side}-${String(n).padStart(2,'0')}`,row,side,number:n,zone:['A','B','C'].includes(row)?'우선석':(['D','E','F'].includes(row)?'내빈석':'일반석'),autoAssignable:!['A','B','C','D','E','F'].includes(row),enabled:true,wheelchairAssignable:['A','B','C'].includes(row),sortOrder:sort++});
      }
    }
  }
  const names=['김하늘','박서준','이유진','최민수','정다은','한지우','오세훈','윤가람','서민재','장예린','권도윤','문지아','임서현','배준호','조아라','신유진','강민호','노하린','백승우','유나영'];
  const orgs=['푸른마을복지회','행복나눔센터','우리동네협회','','남양주시장애인복지관'];
  const ps=names.map((name,i)=>({id:`DEMO-${String(i+1).padStart(3,'0')}`,receptionNo:i+1,name,phone:`010-9000-${String(1000+i).slice(-4)}`,organization:orgs[i%orgs.length],seat:'',active:true,participationStatus:'참여',arrived:false,giftReceived:false,onsite:false,usesCenter:i%2===0,disabledPerson:i%3===0,wheelchairUser:i===2||i===11,seatCategory:i===0?'vip':(i===1?'guest':'auto'),registeredAt:nowIso(),modifiedAt:nowIso(),companionGroup:''}));
  state=normalizeState(defaultState());
  state.settings.checkinSmsEnabled=true;
  state.settings.externalBackupEnabled=false;
  state.settings.eventName='[시연용] 남양주시장애인복지관 20주년 관리자';
  state.seats=seats;state.participants=ps;
  state.rouletteProducts=[{number:1,name:'20주년 기념 선물',quantity:5,enabled:true},{number:2,name:'행운 상품권',quantity:3,enabled:true}];
  fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2),'utf8');
}
if(SYSTEM_DEMO_MODE && (!state.participants?.length || process.env.DEMO_RESET_ON_START==='true'))seedDemoState();
if(!SYSTEM_DEMO_MODE){const seatExpansion=ensureEvent400Expansion();if(seatExpansion.added>0){fs.writeFileSync(STATE_FILE,JSON.stringify(state,null,2),'utf8');console.log(`[SEAT] EVENT400-V6 확장좌석 ${seatExpansion.added}석 추가 · 총 ${seatExpansion.total}석`);}}


const sseClients=new Set();

const raffleStageClients=new Set();

const raffleRemote={
  status:'idle', // idle | spinning | winner
  screen:'idle', // idle | title | black | raffle | winner
  token:'',
  product:null,
  sample:[],
  poolSize:0,
  count:1,
  filter:'usesCenter',
  startedAt:null,
  winners:[],
  targetCount:1,
  currentIndex:0,
  drawSessionId:'',
  lastActionAt:nowIso()
};

function raffleStageKey(){
  const secret=ADMIN_PASSWORD||DEMO_PASSWORD;
  return crypto.createHmac('sha256',secret).update('raffle-stage-public').digest('hex').slice(0,20);
}
function broadcastRaffleStage(type,payload={}){
  const data=`event: ${type}\ndata: ${JSON.stringify({type,at:nowIso(),...payload})}\n\n`;
  for(const res of [...raffleStageClients]){
    try{res.write(data)}catch(_){raffleStageClients.delete(res)}
  }
}

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
  if(SYSTEM_DEMO_MODE && p===DEMO_PASSWORD)return 'admin';
  if(ADMIN_PASSWORD && p===ADMIN_PASSWORD)return 'admin';
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

function buildEvent376Seats(){
  const out=[];let sort=1;
  // A~F: 기존 런웨이 구조 그대로, 각 16석. 장애인석 없이 전부 내빈석 영역.
  const frontRows='ABCDEF'.split('');
  frontRows.forEach((row,ri)=>{
    for(let n=1;n<=8;n++)out.push({code:`${row}L-${String(n).padStart(2,'0')}`,label:`${row}${n}`,row,side:'L',number:n,displayNumber:n,section:'front',block:'FRONT-GUEST-L',zone:'내빈석',enabled:true,autoAssignable:true,wheelchairAssignable:false,wheelchairOnly:false,sortOrder:sort++});
    for(let n=1;n<=8;n++){const dn=n+8;out.push({code:`${row}R-${String(n).padStart(2,'0')}`,label:`${row}${dn}`,row,side:'R',number:n,displayNumber:dn,section:'front',block:'FRONT-GUEST-R',zone:'내빈석',enabled:true,autoAssignable:true,wheelchairAssignable:false,wheelchairOnly:false,sortOrder:sort++});}
  });
  // G~T: 20석 x 14줄. 1,2,19,20번은 장애인/휠체어 + 보호자 우선석.
  const rows='GHIJKLMNOPQRST'.split('');
  rows.forEach(row=>{
    for(let n=1;n<=20;n++){
      const accessible=n<=2||n>=19;
      out.push({code:`${row}B-${String(n).padStart(2,'0')}`,label:`${row}${n}`,row,side:'B',number:n,displayNumber:n,section:'rear',block:'MAIN-20',zone:accessible?'장애인석':'일반석',enabled:true,autoAssignable:true,wheelchairAssignable:accessible,wheelchairOnly:accessible,sortOrder:sort++});
    }
  });
  return out;
}

// EVENT400-V6: 기존 376석은 그대로 두고 L열 뒤(M~T)에 바깥쪽 좌석 24석만 추가한다.
// M~P: 좌 2 + 우 2 (각 24석), Q~T: 좌 1 + 우 1 (각 22석) => 총 400석.
function event400ExtensionSeats(){
  const out=[];
  const rows='MNOPQRST'.split('');
  let sort=10000;
  rows.forEach(row=>{
    const perSide='MNOP'.includes(row)?2:1;
    for(let n=perSide;n>=1;n--){
      out.push({code:`${row}XL-${String(n).padStart(2,'0')}`,label:`${row} 좌측추가 ${n}`,row,side:'XL',number:n,displayNumber:`L${n}`,section:'rear-extension',block:'REAR-EXT-L',zone:'일반석',enabled:true,autoAssignable:true,wheelchairAssignable:false,wheelchairOnly:false,extension:true,sortOrder:sort++});
    }
    for(let n=1;n<=perSide;n++){
      out.push({code:`${row}XR-${String(n).padStart(2,'0')}`,label:`${row} 우측추가 ${n}`,row,side:'XR',number:n,displayNumber:`R${n}`,section:'rear-extension',block:'REAR-EXT-R',zone:'일반석',enabled:true,autoAssignable:true,wheelchairAssignable:false,wheelchairOnly:false,extension:true,sortOrder:sort++});
    }
  });
  return out;
}
function expectedEvent400Codes(){
  return new Set([...buildEvent376Seats(),...event400ExtensionSeats()].map(x=>x.code));
}
function ensureEvent400Expansion(){
  if(!Array.isArray(state.seats))state.seats=[];
  // 완전 신규 서버라 좌석 데이터가 하나도 없을 때만 기본 376석을 생성한다.
  // 기존 운영 데이터가 있으면 어떤 기존 좌석도 교체/삭제하지 않는다.
  if(state.seats.length===0)state.seats=buildEvent376Seats();
  const existing=new Set(state.seats.map(x=>str(x.code).toUpperCase()));
  const extras=event400ExtensionSeats();
  let added=0;
  extras.forEach(seat=>{if(!existing.has(seat.code)){state.seats.push(seat);existing.add(seat.code);added++;}});
  if(!state.meta)state.meta={};
  if(added||state.seats.length===400){
    state.meta.seatLayout='EVENT400-V6';
    state.meta.seatLayoutAppliedAt=state.meta.seatLayoutAppliedAt||nowIso();
  }
  return {added,total:state.seats.length};
}


function phoneLast4(v){
  const d=digits(v);
  return d.length>=4?d.slice(-4):'';
}
function raffleDisplayName(p){
  const last4=phoneLast4(p?.phone);
  return `${str(p?.name)}${last4?` (${last4})`:''}`;
}
function participantSeatLabel(p){
  return p?.seat?displaySeatCode(p.seat):'스탠딩석';
}

function displaySeatCode(code){
  const raw=str(code).toUpperCase();if(!raw)return '';
  const seat=seatByCode(raw);if(seat?.label)return str(seat.label);
  let m=raw.match(/^([A-F])([LR])-(\d{1,2})$/);if(m){const n=num(m[3]);return `${m[1]}${m[2]==='L'?n:n+8}`;}
  m=raw.match(/^([G-T])B-(\d{1,2})$/);if(m)return `${m[1]}${num(m[2])}`;
  // 이전 배치 링크/기록 호환
  m=raw.match(/^([A-L])([LR])-(\d{1,2})$/);if(m){const n=num(m[3]);return `${m[1]}${m[2]==='L'?n:n+8}`;}
  const n=raw.match(/^([A-Y])(\d{1,2})$/);return n?`${n[1]}${num(n[2])}`:raw;
}

function assignableSeats(wheelchair=false, excludeIds=[]){
  const occ=occupiedSeatSet(excludeIds);
  return state.seats.filter(seat=>{
    if(!seat.enabled||seat.autoAssignable===false||occ.has(str(seat.code).toUpperCase()))return false;
    const category=seatCodeCategory(seat.code);
    if(wheelchair)return category==='wheelchair' && seat.wheelchairAssignable!==false;
    return category==='general' && !seat.wheelchairOnly;
  }).sort((x,y)=>(num(x.sortOrder)-num(y.sortOrder)) || str(x.code).localeCompare(str(y.code),'ko'));
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

function wheelchairPairCandidates(excludeIds=[]){
  const occ=occupiedSeatSet(excludeIds);
  const rows='GHIJKLMNOPQRST'.split(''),out=[];
  rows.forEach(row=>{
    const code=n=>`${row}B-${String(n).padStart(2,'0')}`;
    out.push({row,side:'left',wheel:code(1),guardian:code(2),general:Array.from({length:16},(_,i)=>code(i+3))});
    out.push({row,side:'right',wheel:code(20),guardian:code(19),general:Array.from({length:16},(_,i)=>code(18-i))});
  });
  return out.filter(x=>!occ.has(x.wheel)&&!occ.has(x.guardian));
}
function assignWheelchairParty(people,{lock=false}={}){
  const active=people.filter(Boolean);
  const wheel=active.find(p=>p.wheelchairUser||p.seatCategory==='wheelchair');
  if(!wheel)return {seats:active.map(p=>p.seat).filter(Boolean),wheelchair:0,guardian:0,companions:0};
  const group=groupForParticipant(wheel);
  const others=active.filter(p=>p.id!==wheel.id);
  let guardian=null;
  if(group?.representativeId)guardian=others.find(p=>p.id===group.representativeId)||null;
  if(!guardian)guardian=others[0]||null;
  const extras=others.filter(p=>!guardian||p.id!==guardian.id);
  const excludeIds=active.map(p=>p.id),occ=occupiedSeatSet(excludeIds);
  const pairs=wheelchairPairCandidates(excludeIds);
  const pair=pairs.find(x=>{
    // 보호자 다음 일반 동반자도 가능한 한 같은 줄 안쪽으로 붙일 수 있는 쪽 우선
    const free=x.general.filter(code=>!occ.has(code));
    return free.length>=Math.min(extras.length,4);
  })||pairs[0];
  if(!pair){
    if(assignOneCategory(wheel,'wheelchair',excludeIds)&&lock)wheel.seatLocked=true;
    extras.concat(guardian?[guardian]:[]).filter(Boolean).forEach(p=>{if(!p.seat)assignOneCategory(p,'general',excludeIds);if(lock&&p.seat)p.seatLocked=true});
    return {seats:active.map(p=>p.seat).filter(Boolean),wheelchair:wheel.seat?1:0,guardian:guardian?.seat?1:0,companions:extras.filter(p=>p.seat).length,fallback:true};
  }
  wheel.seat=pair.wheel;if(lock)wheel.seatLocked=true;
  if(guardian){guardian.seat=pair.guardian;if(lock)guardian.seatLocked=true;}
  const freeGeneral=pair.general.filter(code=>!occ.has(code));
  extras.forEach((p,i)=>{
    if(freeGeneral[i])p.seat=freeGeneral[i];
    else assignOneCategory(p,'general',excludeIds);
    if(lock&&p.seat)p.seatLocked=true;
  });
  return {seats:active.map(p=>p.seat).filter(Boolean),wheelchair:1,guardian:guardian?1:0,companions:extras.filter(p=>p.seat).length,row:pair.row,side:pair.side};
}
function assignGroupSmart(people){
  const need=people.filter(p=>!p.seat);
  if(need.some(p=>p.wheelchairUser||p.seatCategory==='wheelchair'))return assignWheelchairParty(need,{lock:false});
  assignContiguousCategory(need,'general');
  return {seats:people.map(p=>p.seat).filter(Boolean),mixed:false,wheelchair:0,companions:need.filter(p=>p.seat).length};
}
function releaseSeat(p){const old=p.seat||'';p.seat='';return old}

function releaseSeatIfUnlocked(p){
  if(!p||p.seatLocked===true)return '';
  return releaseSeat(p);
}
function lockCurrentAssignedSeats(){
  let locked=0;
  state.participants.filter(participantActive).forEach(p=>{
    if(p.seat&&seatByCode(p.seat)){
      if(p.seatLocked!==true)locked++;
      p.seatLocked=true;
      p.seatLockedAt=p.seatLockedAt||nowIso();
      p.modifiedAt=nowIso();
    }
  });
  return locked;
}


function seatCodeCategory(code){
  const seat=seatByCode(code);if(!seat)return 'general';
  const row=str(seat.row).toUpperCase(),n=num(seat.number);
  if(seat.extension===true||['XL','XR'].includes(str(seat.side).toUpperCase()))return 'general';
  if(['A','B','C'].includes(row))return 'vip';
  if(['D','E','F'].includes(row))return 'guest';
  if(row>='G'&&row<='T'&&(n<=2||n>=19))return 'wheelchair';
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
  if(SYSTEM_DEMO_MODE){
    item.status='성공';item.result='DEMO MODE · 실제 문자 발송 없이 성공으로 시뮬레이션';item.sentAt=nowIso();saveState();return item;
  }
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

function seatGuideKeyForParticipant(p){
  const receptionNo=Math.max(0,num(p?.receptionNo,0));
  const ref=receptionNo.toString(36);
  const sig=crypto.createHmac('sha256',ADMIN_PASSWORD).update(`seat-guide-short:${ref}`).digest('hex').slice(0,6);
  return `${ref}-${sig}`;
}
function seatGuideUrl(p){
  if(!p)return '';
  return `${PUBLIC_BASE_URL}/s/${seatGuideKeyForParticipant(p)}`;
}
function verifySeatGuideKey(key){
  const raw=str(key).toLowerCase();

  // v0.9.3 단축키: /s/<접수번호base36>-<서명6자리>
  let m=raw.match(/^([0-9a-z]+)-([a-f0-9]{6})$/i);
  if(m){
    const expected=crypto.createHmac('sha256',ADMIN_PASSWORD).update(`seat-guide-short:${m[1]}`).digest('hex').slice(0,6);
    const a=Buffer.from(expected),b=Buffer.from(m[2]);
    if(a.length===b.length&&crypto.timingSafeEqual(a,b)){
      const receptionNo=parseInt(m[1],36);
      return state.participants.find(p=>num(p.receptionNo,0)===receptionNo)||null;
    }
  }

  // 이미 발송된 v0.8.5~0.9.2 링크도 계속 열리도록 호환
  m=str(key).match(/^(p:\d+)\.([a-f0-9]{12})$/i);
  if(!m)return null;
  const expected=crypto.createHmac('sha256',ADMIN_PASSWORD).update(`seat-guide:${m[1]}`).digest('hex').slice(0,12);
  const a=Buffer.from(expected),b=Buffer.from(m[2].toLowerCase());
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const receptionNo=num(m[1].slice(2),0);
  return state.participants.find(p=>num(p.receptionNo,0)===receptionNo)||null;
}
function checkinMessage(p,extra=''){
  const seat=participantSeatLabel(p);
  const guide=seatGuideUrl(p);
  return `[남양주시장애인복지관]\n${p.name}님 현장 접수가 완료되었습니다.\n좌석: ${seat}\n좌석배치도: ${guide}\n기념품: 지급완료${extra?`\n${extra}`:''}\n개관 20주년 기념행사에 함께해 주셔서 감사합니다.`;
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
  // 대표자 수동그룹 + 사용자가 직접 수정한 자동그룹은 재구성 시 그대로 유지한다.
  const manualGroups=state.groups.filter(g=>
    (g.type==='representative'&&!g.auto) || g.manualOverride===true
  );
  const manualUsed=new Set(manualGroups.flatMap(g=>g.memberIds||[]));
  const overriddenOrganizations=new Set(
    manualGroups.filter(g=>g.manualOverride&&g.sourceType==='organization').map(g=>normalizeOrg(g.sourceKey||g.organization)).filter(Boolean)
  );
  const overriddenCompanions=new Set(
    manualGroups.filter(g=>g.manualOverride&&g.sourceType==='companion').map(g=>str(g.sourceKey||g.companionGroup)).filter(Boolean)
  );
  const autoGroups=[];
  const autoUsed=new Set();

  // 1) 같은 외부기관 자동그룹. 사용자가 수정해 고정한 기관은 자동 재생성하지 않는다.
  const byOrg=new Map();
  state.participants.filter(participantActive).forEach(p=>{
    if(manualUsed.has(p.id))return;
    const org=normalizeOrg(p.organization);
    if(!org||isInternalOrganization(org)||excludedOrganizationSet().has(org)||overriddenOrganizations.has(org))return;
    if(!byOrg.has(org))byOrg.set(org,[]);
    byOrg.get(org).push(p);
  });
  for(const [org,members] of byOrg.entries()){
    if(members.length<2)continue;
    const old=state.groups.find(g=>g.type==='organization'&&!g.manualOverride&&normalizeOrg(g.organization)===org);
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

  // 2) 기관그룹에 속하지 않은 동반신청 자동그룹.
  const byCompanion=new Map();
  state.participants.filter(participantActive).forEach(p=>{
    if(manualUsed.has(p.id)||autoUsed.has(p.id))return;
    const key=str(p.companionGroup);
    if(!key||excludedCompanionSet().has(key)||overriddenCompanions.has(key))return;
    if(!byCompanion.has(key))byCompanion.set(key,[]);
    byCompanion.get(key).push(p);
  });
  for(const [key,members] of byCompanion.entries()){
    if(members.length<2)continue;
    const old=state.groups.find(g=>g.type==='companion'&&!g.manualOverride&&g.companionGroup===key);
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

  const before=JSON.stringify(state.groups.map(g=>({id:g.id,type:g.type,name:g.name,memberIds:g.memberIds,representativeId:g.representativeId,manualOverride:g.manualOverride})));
  state.groups=[...manualGroups,...autoGroups];
  const after=JSON.stringify(state.groups.map(g=>({id:g.id,type:g.type,name:g.name,memberIds:g.memberIds,representativeId:g.representativeId,manualOverride:g.manualOverride})));
  const changed=before!==after;
  if(changed&&persist)saveState();
  return {
    changed,
    organizationGroups:autoGroups.filter(g=>g.type==='organization').length,
    companionGroups:autoGroups.filter(g=>g.type==='companion').length,
    manualOverrides:manualGroups.filter(g=>g.manualOverride).length
  };
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
    if(!p.seat && state.settings.autoSeatAssignOnCheckin!==false){
      if(p.seatCategory==='vip')assignOneCategory(p,'vip');
      else if(p.seatCategory==='guest')assignOneCategory(p,'guest');
      else if(p.wheelchairUser||p.seatCategory==='wheelchair'){
        assignOneCategory(p,'wheelchair')||assignOneCategory(p,'general');
      }else assignOneCategory(p,'general');
    }
    addLog('QR접수',p,'기념품 지급완료',station);
    const priority=(p.seatCategory==='vip'||p.seatCategory==='guest')?'VIP/내빈':((p.wheelchairUser||p.seatCategory==='wheelchair')?'이동지원':'');
    if(priority)broadcastEvent('priority-arrival',{priority,participant:{id:p.id,name:p.name,seat:p.seat,organization:p.organization,wheelchairUser:Boolean(p.wheelchairUser)},station});
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
app.get('/vendor/html5-qrcode.min.js',(req,res)=>{
  res.sendFile(path.join(ROOT,'node_modules','html5-qrcode','html5-qrcode.min.js'));
});



app.post('/api/demo/reset',(req,res)=>{
  if(!SYSTEM_DEMO_MODE)return res.status(404).json({ok:false});
  seedDemoState();broadcastEvent('state',{demoReset:true});res.json({ok:true,participants:state.participants.length,seats:state.seats.length});
});

app.get('/api/health',(req,res)=>{
  let disk=null;try{const d=fs.statfsSync(DATA_DIR);disk={totalBytes:d.blocks*d.bsize,freeBytes:d.bavail*d.bsize}}catch(_){}
  res.json({ok:true,version:'0.9.18',serverTime:nowIso(),uptimeSeconds:Math.round(process.uptime()),participants:state.participants.length,
    smsReady:munjanaraConfigured(),externalBackupConfigured:Boolean(GDRIVE_BACKUP_URL&&GDRIVE_BACKUP_TOKEN),
    disk,memory:{rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed}});
});

app.get('/api/public/seat-guide',(req,res)=>{
  const p=verifySeatGuideKey(req.query.k);
  if(!p)return res.status(404).json({ok:false,error:'유효하지 않거나 만료된 좌석 안내 링크입니다.'});
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,name:str(p.name),seat:participantSeatLabel(p),hasAssignedSeat:Boolean(p.seat),rawSeat:str(p.seat),arrived:Boolean(p.arrived),eventName:state.settings.eventName||'남양주시장애인복지관 개관 20주년 기념행사'});
});


app.get('/s/:key',(req,res)=>{
  const p=verifySeatGuideKey(req.params.key);
  if(!p)return res.status(404).send('유효하지 않은 좌석 안내 링크입니다.');
  res.redirect(302,`/seat-guide.html?k=${encodeURIComponent(req.params.key)}`);
});
app.get('/api/public/seat-layout',(req,res)=>{
  const rows=state.seats.filter(x=>x.enabled!==false).map(x=>({code:x.code,label:displaySeatCode(x.code),row:x.row,side:x.side,number:x.number,displayNumber:x.displayNumber||x.number,section:x.section||'',block:x.block||'',zone:x.zone||''}));
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,rows});
});

['/9.18','/9.18/','/918','/918/','/invite','/invite/'].forEach(route=>{
  app.get(route,(req,res)=>res.sendFile(path.join(ROOT,'public','invite-918.html')));
});

const inviteLookupRate=new Map();
function inviteRateAllowed(req){
  const key=str(req.ip||req.socket?.remoteAddress||'unknown');
  const now=Date.now(),windowMs=10*60*1000,limit=30;
  const recent=(inviteLookupRate.get(key)||[]).filter(t=>now-t<windowMs);
  if(recent.length>=limit){inviteLookupRate.set(key,recent);return false;}
  recent.push(now);inviteLookupRate.set(key,recent);return true;
}
app.post('/api/public/invite-lookup',async(req,res)=>{
  if(!inviteRateAllowed(req))return res.status(429).json({ok:false,error:'조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.'});
  const name=str(req.body?.name).replace(/\s+/g,'');
  const phoneNo=digits(req.body?.phone);
  if(name.length<2||phoneNo.length<9)return res.status(400).json({ok:false,error:'성함과 휴대전화번호를 정확히 입력해 주세요.'});
  const matches=state.participants.filter(p=>participantActive(p)&&str(p.name).replace(/\s+/g,'')===name&&digits(p.phone)===phoneNo);
  if(!matches.length)return res.status(404).json({ok:false,error:'입력하신 정보와 일치하는 초대장을 찾을 수 없습니다.'});
  const p=matches[0];
  let qr='';
  try{const QRCode=require('qrcode');qr=await QRCode.toDataURL(str(p.id),{margin:1,width:360,errorCorrectionLevel:'M'});}catch(_){qr='';}
  res.setHeader('Cache-Control','no-store');
  res.json({ok:true,invite:{name:str(p.name),organization:str(p.organization),seat:participantSeatLabel(p),hasAssignedSeat:Boolean(p.seat),ticketCode:str(p.id),qr,eventName:state.settings.eventName||'남양주시장애인복지관 개관 20주년 기념행사',eventDate:'2026. 9. 17.(목) 13:30',venue:'남양주금곡실내체육관',subtitle:'스무번의 계절, 스물한 번째 약속',seatGuideUrl:p.seat?`/s/${seatGuideKeyForParticipant(p)}`:''}});
});


app.get('/api/public/raffle-stage',(req,res)=>{
  if(str(req.query.k)!==raffleStageKey())return res.status(403).end();
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ok:true,at:nowIso()})}\n\n`);
  raffleStageClients.add(res);
  res.write(`event: raffle-sync\ndata: ${JSON.stringify({type:'raffle-sync',at:nowIso(),remote:raffleRemote})}\n\n`);
  const keepalive=setInterval(()=>{try{res.write(': ping\n\n')}catch(_){}},25000);
  req.on('close',()=>{clearInterval(keepalive);raffleStageClients.delete(res)});
});

app.get('/api/raffle/stage-link',auth,(req,res)=>{
  res.json({ok:true,url:`${req.protocol}://${req.get('host')}/raffle-stage.html?k=${raffleStageKey()}`});
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
app.use('/api',(req,res,next)=>{
  if(!state.settings?.eventOperationMode || req.method==='GET')return next();
  const p=req.path;
  const safePrefixes=['/checkin/','/participants/onsite','/participant/','/participants/','/sms/','/raffle/','/events'];
  const safeExact=['/operation-mode','/seats/swap'];
  const safeSeatManual=/^\/seats\/[^/]+\/(assign|release)$/.test(p);
  if(safeExact.includes(p)||safeSeatManual||safePrefixes.some(x=>p.startsWith(x)))return next();
  return res.status(423).json({ok:false,error:'행사 운영 잠금모드입니다. 설정/복원/대규모 재배치 기능은 잠겨 있습니다.'});
});


app.get('/api/bootstrap',auth,(req,res)=>{
  rebuildAutomaticGroups({persist:true});
  const active=state.participants.filter(participantActive);
  const extraStanding=state.groups.reduce((n,g)=>n+num(g.extraStanding,0),0);
  const extraGifts=state.groups.reduce((n,g)=>n+num(g.extraGiftCount,0),0);
  const arrived=active.filter(p=>p.arrived).length;
  const onsite=active.filter(p=>p.onsite&&p.arrived).length;
  const pending=active.filter(p=>!p.arrived).length;
  const vipPending=active.filter(p=>!p.arrived&&(p.seatCategory==='vip'||p.seatCategory==='guest')).length;
  const mobilityPending=active.filter(p=>!p.arrived&&(p.wheelchairUser||p.seatCategory==='wheelchair')).length;
  const unassigned=active.filter(p=>p.arrived&&!p.seat&&!p.onsite).length;
  const smsFailed=state.smsQueue.filter(x=>x.status==='실패').length;
  const freeSeats=Math.max(0,state.seats.filter(x=>x.enabled!==false).length-active.filter(p=>p.seat).length);
  const recent10=active.filter(p=>p.arrivedAt && Date.now()-new Date(p.arrivedAt).getTime()<=10*60*1000).length;
  res.json({ok:true,serverTime:nowIso(),version:'0.9.18',frontendVersion:FRONTEND_VERSION,demoMode:SYSTEM_DEMO_MODE,
    role:req.adminRole,roleLabel:roleLabel(req.adminRole),summary:{
      participants:state.participants.length,active:active.length,arrived,pending,
      actualAttendance:arrived+extraStanding,extraStanding,recent10,
      vipPending,mobilityPending,unassigned,smsFailed,freeSeats,
      groups:state.groups.length,seats:state.seats.length,assignedSeats:active.filter(p=>p.seat).length,
      giftsReceived:state.participants.filter(p=>p.giftReceived).length+extraGifts,
      smsPending:state.smsQueue.filter(x=>x.status==='대기'||x.status==='pending').length,
      onsite
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
  // 자동 그룹의 구성원은 다른 자동 그룹 수정/수동 그룹 편집에서 이동할 수 있다.
  // 명시적으로 만든 대표자 그룹 또는 자동그룹을 수동 수정해 고정한 그룹만 구성원을 점유한다.
  const used=new Set(
    state.groups
      .filter(g=>g.id!==excludeGroupId && ((g.type==='representative'&&!g.auto) || g.manualOverride===true))
      .flatMap(g=>g.memberIds||[])
  );
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

app.post('/api/participants/:id/delete',auth,(req,res)=>{
  const id=str(req.params.id);
  const p=state.participants.find(x=>x.id===id);
  if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const before={...p};
  state.participants=state.participants.filter(x=>x.id!==id);
  state.groups.forEach(g=>{g.memberIds=(g.memberIds||[]).filter(x=>x!==id);if(g.representativeId===id)g.representativeId=''});
  state.groups=state.groups.filter(g=>(g.memberIds||[]).length>0);
  adminAudit('참가자삭제',p,before,null,'참가자 목록에서 삭제 · 기존 문자/당첨 로그는 감사기록을 위해 유지');
  saveState();
  res.json({ok:true,deleted:{id:p.id,name:p.name,seat:p.seat||''}});
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

  // 운영 규칙: 먼저 온 사람이 남은 그룹원 전체를 한 번에 접수하는 것을 기본으로 한다.
  // 일부만 접수한 경우 아직 접수하지 않은 인원의 기존 좌석은 해제하고,
  // 이후 실제 도착 시 다시 접수하면서 좌석을 배정한다.
  // 미리 확정된 좌석(seatLocked)은 일부접수여도 절대 해제하지 않는다.
  // 잠금되지 않은 임시 좌석만 일부접수에서 정리할 수 있다.
  orderedPending.slice(checkCount).forEach(p=>releaseSeatIfUnlocked(p));
  selected.forEach(p=>{p.arrived=true;p.arrivedAt=nowIso();p.giftReceived=true;p.giftReceivedAt=nowIso();p.modifiedAt=nowIso()});
  const seatPlan=assignGroupSmart(selected);
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
    const seats=selected.map(p=>displaySeatCode(p.seat)).filter(Boolean);
    const extraText=extras?`추가 ${extras}명은 좌석 미배정(스탠딩 안내)입니다.`:'';
    sms=queueAndSendSms(smsTarget.phone,`[남양주시장애인복지관]\n${displayName} 현장 접수가 완료되었습니다.\n이번 접수 ${actual}명 / 좌석 ${checkCount}석\n${seats.length?'좌석: '+seats.join(', ')+'\n':''}${extraText}${extraText?'\n':''}좌석배치도: ${seatGuideUrl(smsTarget)}\n기념품: ${actual}명 지급완료\n감사합니다.`,'group-checkin',smsTarget.id);
  }
  saveState();res.json({ok:true,groupName:displayName,total:members.length,checkedInNow:checkCount,actualCount:actual,extraStanding:extras,
    seats:selected.map(p=>p.seat).filter(Boolean),seatPlan,smsQueued:Boolean(sms),smsTargetName:smsTarget?.name||''});
});


app.post('/api/checkin/undo',auth,(req,res)=>{
  const p=findParticipant(req.body?.code);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  p.arrived=false;p.arrivedAt=null;p.giftReceived=false;p.giftReceivedAt=null;
  const keptSeat=p.seatLocked===true?str(p.seat):'';
  if(!keptSeat)releaseSeat(p);
  p.modifiedAt=nowIso();
  addLog('접수취소',p,keptSeat?'도착·기념품 취소 / 사전확정 좌석 유지':'도착·기념품·좌석 취소',str(req.body?.station)||'관리자');
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
  if((g.type==='organization'&&g.auto) || (g.manualOverride&&g.sourceType==='organization')){
    const value=normalizeOrg(g.sourceKey||g.organization);
    const arr=new Set(state.settings.excludedOrganizations||[]);if(value)arr.add(value);state.settings.excludedOrganizations=[...arr];
    state.groups.splice(i,1);
  }else if((g.type==='companion'&&g.auto) || (g.manualOverride&&g.sourceType==='companion')){
    const value=str(g.sourceKey||g.companionGroup);
    const arr=new Set(state.settings.excludedCompanionGroups||[]);if(value)arr.add(value);state.settings.excludedCompanionGroups=[...arr];
    state.groups.splice(i,1);
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
  rebuildAutomaticGroups({persist:false});
  const g=state.groups.find(x=>x.id===req.params.id);if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  const before=JSON.parse(JSON.stringify(g)),b=req.body||{};
  const wasAuto=Boolean(g.auto)&&!g.manualOverride;

  if('name'in b)g.name=str(b.name)||groupDisplayName(g);

  if(Array.isArray(b.memberIds)){
    const ids=[...new Set(b.memberIds.map(str).filter(Boolean))];
    if(ids.length<2)return res.status(400).json({ok:false,error:'구성원은 2명 이상이어야 합니다.'});
    const members=ids.map(id=>state.participants.find(p=>p.id===id)).filter(Boolean);
    if(members.length!==ids.length)return res.status(400).json({ok:false,error:'일부 참가자를 찾을 수 없습니다.'});

    // 수동 대표자 그룹/이미 고정된 다른 그룹의 구성원만 이동 제한.
    const allowed=new Set(availableParticipantIds(g.id).map(p=>p.id));
    if(ids.some(id=>!allowed.has(id)&&!(g.memberIds||[]).includes(id))){
      return res.status(409).json({ok:false,error:'다른 수동/고정 그룹에 포함된 참가자가 있습니다.'});
    }
    g.memberIds=ids;
  }

  if(wasAuto){
    // 자동그룹을 한 번 수정하면 "수정 고정"으로 전환.
    // 이후 자동그룹 다시 만들기를 눌러도 이 그룹은 사용자가 정한 구성 그대로 유지한다.
    g.manualOverride=true;
    g.auto=false;
    g.sourceType=g.type;
    g.sourceKey=g.type==='organization'?normalizeOrg(g.organization):str(g.companionGroup);
    g.overriddenAt=nowIso();
  }

  if('representativeId'in b && g.memberIds.includes(str(b.representativeId)))g.representativeId=str(b.representativeId);
  if(!g.memberIds.includes(g.representativeId))g.representativeId=g.memberIds[0];
  g.modifiedAt=nowIso();

  // 같은 참가자가 다른 순수 자동그룹에 남아 있으면 다음 재구성에서 제거되도록 즉시 재구성.
  const targetId=g.id;
  adminAudit(wasAuto?'자동그룹수동수정':'그룹수정',g,before,g,wasAuto?'자동묶음 → 수정 고정':'');
  rebuildAutomaticGroups({persist:false});
  const saved=state.groups.find(x=>x.id===targetId)||g;
  saveState();res.json({ok:true,group:saved,convertedFromAuto:wasAuto});
});

app.post('/api/groups/:id/reset-auto',auth,(req,res)=>{
  const g=state.groups.find(x=>x.id===req.params.id);
  if(!g)return res.status(404).json({ok:false,error:'그룹을 찾을 수 없습니다.'});
  if(!g.manualOverride)return res.status(400).json({ok:false,error:'수동 수정된 자동그룹이 아닙니다.'});
  const before=JSON.parse(JSON.stringify(g));
  state.groups=state.groups.filter(x=>x.id!==g.id);
  const result=rebuildAutomaticGroups({persist:false});
  adminAudit('자동그룹원상복구',g,before,null,`원본 ${g.sourceType||g.type}: ${g.sourceKey||''}`);
  saveState();
  res.json({ok:true,result});
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


function migrateSeatCodeTo400(code){
  const raw=str(code).toUpperCase();if(!raw)return '';
  // 새 확장 좌석은 그대로 유지
  if(/^([M-T])X[LR]-(\d{2})$/.test(raw))return raw;
  let m=raw.match(/^([A-F])([LR])-(\d{1,2})$/);
  if(m&&num(m[3])>=1&&num(m[3])<=8)return `${m[1]}${m[2]}-${String(num(m[3])).padStart(2,'0')}`;
  m=raw.match(/^([G-L])([LR])-(\d{1,2})$/);
  if(m){const visible=m[2]==='L'?num(m[3]):num(m[3])+8;if(visible>=1&&visible<=16)return `${m[1]}B-${String(visible).padStart(2,'0')}`;}
  m=raw.match(/^([G-T])B-(\d{1,2})$/);if(m&&num(m[2])>=1&&num(m[2])<=20)return `${m[1]}B-${String(num(m[2])).padStart(2,'0')}`;
  m=raw.match(/^([A-T])(\d{1,2})$/);if(m){const row=m[1],n=num(m[2]);if(row<='F'){if(n>=1&&n<=8)return `${row}L-${String(n).padStart(2,'0')}`;if(n>=9&&n<=16)return `${row}R-${String(n-8).padStart(2,'0')}`;}else if(n>=1&&n<=20)return `${row}B-${String(n).padStart(2,'0')}`;}
  return '';
}

// 기존 좌석/배정은 전혀 재생성하지 않고, 뒤쪽 확장좌석 24석만 추가한다.
app.post('/api/seats/apply-event-400',auth,(req,res)=>{
  const before=backupNow('before-400-seat-extension-v6');
  const beforeTotal=state.seats.length;
  const result=ensureEvent400Expansion();
  state.settings.autoSeatAssignOnCheckin=true;
  adminAudit('400석후면확장적용',{id:'EVENT400-V6',name:'400석 후면 확장 · 기존좌석 보존'},null,{...result,beforeTotal});
  saveState();const after=backupNow('after-400-seat-extension-v6');
  res.json({ok:true,...result,beforeTotal,preservedAssignments:state.participants.filter(p=>p.seat).length,beforeBackup:before,afterBackup:after,autoSeatAssignOnCheckin:true});
});

app.post('/api/seats/lock-current',auth,(req,res)=>{
  const locked=lockCurrentAssignedSeats();
  adminAudit('현재좌석확정',{id:'seat-lock-current',name:'현재 배정좌석 확정'},null,{locked,totalLocked:state.participants.filter(p=>p.seatLocked&&p.seat).length});
  saveState();
  res.json({ok:true,locked,totalLocked:state.participants.filter(p=>p.seatLocked&&p.seat).length});
});
app.post('/api/seats/:code/unlock-participant',auth,(req,res)=>{
  const code=str(req.params.code).toUpperCase(),p=findSeatOccupant(code);
  if(!p)return res.status(404).json({ok:false,error:'좌석 배정 참가자를 찾을 수 없습니다.'});
  p.seatLocked=false;p.modifiedAt=nowIso();
  adminAudit('좌석고정해제',p,{seatLocked:true},{seatLocked:false});
  saveState();res.json({ok:true,participant:p});
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
    layoutVersion:state.meta.seatLayout||'',
    layoutNeedsRepair:rows.length!==400 ||
      'ABCDEF'.split('').some(r=>rows.filter(x=>x.row===r&&x.enabled!==false).length!==16) ||
      'GHIJKL'.split('').some(r=>rows.filter(x=>x.row===r&&x.enabled!==false).length!==20) ||
      'MNOP'.split('').some(r=>rows.filter(x=>x.row===r&&x.enabled!==false).length!==24) ||
      'QRST'.split('').some(r=>rows.filter(x=>x.row===r&&x.enabled!==false).length!==22),
    autoSeatAssignOnCheckin:state.settings.autoSeatAssignOnCheckin!==false,
    rows
  });
});

app.post('/api/seats/:code/add-participant',auth,(req,res)=>{
  const code=str(req.params.code).toUpperCase(),seat=seatByCode(code);
  if(!seat||seat.enabled===false)return res.status(404).json({ok:false,error:'사용 가능한 좌석을 찾을 수 없습니다.'});
  if(findSeatOccupant(code))return res.status(409).json({ok:false,error:'이미 참가자가 배정된 좌석입니다.'});
  const b=req.body||{},name=str(b.name);
  if(!name)return res.status(400).json({ok:false,error:'이름을 입력해 주세요.'});
  const maxNo=Math.max(0,...state.participants.map(p=>num(p.receptionNo,0)));
  const p={
    id:`SEAT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    receptionNo:maxNo+1,name,phone:phone(b.phone),organization:str(b.organization),seat:code,
    applicationType:'좌석직접추가',note:str(b.note),arrived:false,arrivedAt:null,registeredAt:nowIso(),modifiedAt:nowIso(),
    active:true,requestedCount:1,wheelchairUser:bool(b.wheelchairUser),usesCenter:bool(b.usesCenter),
    disabledPerson:bool(b.disabledPerson),participationStatus:'참여',giftReceived:false,onsite:false,standing:false,
    seatCategory:str(b.seatCategory)||'auto',seatLocked:b.seatLocked===false?false:true
  };
  state.participants.push(p);
  adminAudit('좌석참가자추가',p,null,{seat:code,seatLocked:p.seatLocked},'좌석관리에서 간편 추가');
  saveState();res.json({ok:true,participant:p});
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
  const onlyArrived=req.body?.onlyArrived===false?false:true;
  const targets=state.participants.filter(p=>participantActive(p)&&!p.seat&&(!onlyArrived||p.arrived)&&!p.onsite);
  const targetIds=new Set(targets.map(p=>p.id));
  let assigned=0,groupsDone=0;
  state.groups.forEach(g=>{
    const members=(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(p=>p&&targetIds.has(p.id));
    if(members.length>=2){
      assignGroupSmart(members);
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
  adminAudit('일반좌석초기화',{id:'general-seats',name:'G~T 일반석'},null,{released});
  saveState();res.json({ok:true,released});
});
app.post('/api/seats/final-auto-assign',auth,(req,res)=>{
  let vip=0,guest=0,wheelchair=0,guardians=0,companions=0;
  const active=state.participants.filter(p=>participantActive(p)&&!p.onsite);
  active.filter(p=>!p.seat&&p.seatCategory==='vip').sort((x,y)=>num(x.receptionNo)-num(y.receptionNo)).forEach(p=>{if(assignOneCategory(p,'vip')){p.seatLocked=true;vip++}});
  active.filter(p=>!p.seat&&p.seatCategory==='guest').sort((x,y)=>num(x.receptionNo)-num(y.receptionNo)).forEach(p=>{if(assignOneCategory(p,'guest')){p.seatLocked=true;guest++}});
  const processed=new Set();
  active.filter(p=>!p.seat&&(p.wheelchairUser||p.seatCategory==='wheelchair')).sort((x,y)=>num(x.receptionNo)-num(y.receptionNo)).forEach(w=>{
    const g=groupForParticipant(w),key=g?`g:${g.id}`:`p:${w.id}`;if(processed.has(key))return;processed.add(key);
    const party=g?(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(p=>p&&participantActive(p)): [w];
    const result=assignWheelchairParty(party,{lock:true});wheelchair+=result.wheelchair||0;guardians+=result.guardian||0;companions+=result.companions||0;
  });
  const manualLocked=active.filter(p=>p.seat&&p.seatLocked&&p.seatCategory!=='vip'&&p.seatCategory!=='guest'&&!p.wheelchairUser&&p.seatCategory!=='wheelchair').length;
  const unassignedGeneral=active.filter(p=>!p.seat&&p.seatCategory!=='vip'&&p.seatCategory!=='guest'&&!p.wheelchairUser&&p.seatCategory!=='wheelchair').length;
  const result={vip,guest,wheelchair,guardians,companions,manualLocked,unassignedGeneral};
  adminAudit('사전우선석배치',{id:'priority-preassign',name:'내빈·휠체어 사전배치'},null,result,'휠체어 1명 + 보호자 1명 우선, 나머지 동반자는 같은 줄 일반석 우선');
  saveState();res.json({ok:true,...result});
});

app.post('/api/seats/reassign-wheelchair',auth,(req,res)=>{
  const before=backupNow('before-wheelchair-reassign');
  rebuildAutomaticGroups({persist:false});
  const active=state.participants.filter(p=>participantActive(p)&&!p.onsite);
  const processed=new Set();let parties=0,wheelchair=0,guardians=0,companions=0,released=0;
  active.filter(p=>p.wheelchairUser||p.seatCategory==='wheelchair').sort((x,y)=>num(x.receptionNo)-num(y.receptionNo)).forEach(w=>{
    const g=groupForParticipant(w),key=g?`g:${g.id}`:`p:${w.id}`;if(processed.has(key))return;processed.add(key);
    const party=g?(g.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(p=>p&&participantActive(p)): [w];
    party.forEach(p=>{if(p.seat){p.seat='';p.seatLocked=false;p.modifiedAt=nowIso();released++}});
    const result=assignWheelchairParty(party,{lock:true});parties++;wheelchair+=result.wheelchair||0;guardians+=result.guardian||0;companions+=result.companions||0;
  });
  adminAudit('휠체어좌석재배치',{id:'wheelchair-refresh',name:'휠체어 신청자만 재배치'},null,{parties,wheelchair,guardians,companions,released});
  saveState();const after=backupNow('after-wheelchair-reassign');
  res.json({ok:true,parties,wheelchair,guardians,companions,released,beforeBackup:before,afterBackup:after});
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

function eligibleRafflePool(filter='usesCenter'){
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
function productDrawnCount(productNo){
  return state.rouletteHistory.filter(x=>x.enabled!==false&&str(x.prizeNo)===str(productNo)).length;
}
function productRemaining(product){
  const qty=Math.max(0,num(product?.quantity,0));
  if(!Number.isFinite(qty)||qty<=0)return 999999;
  return Math.max(0,qty-productDrawnCount(product.number));
}
app.get('/api/raffle/products',auth,(req,res)=>{
  const rows=state.rouletteProducts.map(x=>({...x,drawn:productDrawnCount(x.number),remaining:productRemaining(x)}));
  res.json({ok:true,rows});
});
app.post('/api/raffle/products',auth,(req,res)=>{
  const name=str(req.body?.name).trim();
  const quantity=Math.max(1,Math.min(9999,num(req.body?.quantity,1)));
  if(!name)return res.status(400).json({ok:false,error:'상품명을 입력해 주세요.'});
  const nextNumber = state.rouletteProducts.length
    ? Math.max(...state.rouletteProducts.map(x=>num(x.number,0)))+1
    : 1;
  const product={number:nextNumber,name,quantity,enabled:true,createdAt:nowIso()};
  state.rouletteProducts.push(product);
  adminAudit('추첨상품등록',{id:String(product.number),name:product.name},null,product);
  saveState();
  res.json({ok:true,product:{...product,drawn:0,remaining:quantity}});
});
app.post('/api/raffle/products/:number/update',auth,(req,res)=>{
  const p=state.rouletteProducts.find(x=>str(x.number)===str(req.params.number));
  if(!p)return res.status(404).json({ok:false,error:'추첨 상품을 찾을 수 없습니다.'});
  const before={...p};
  if('name' in req.body)p.name=str(req.body.name).trim()||p.name;
  if('quantity' in req.body){
    const q=Math.max(1,Math.min(9999,num(req.body.quantity,p.quantity||1)));
    const drawn=productDrawnCount(p.number);
    if(q<drawn)return res.status(400).json({ok:false,error:`이미 ${drawn}개가 당첨되어 수량을 ${drawn}개보다 작게 줄일 수 없습니다.`});
    p.quantity=q;
  }
  if('enabled' in req.body)p.enabled=bool(req.body.enabled);
  p.modifiedAt=nowIso();
  adminAudit('추첨상품수정',{id:String(p.number),name:p.name},before,p);
  saveState();
  res.json({ok:true,product:{...p,drawn:productDrawnCount(p.number),remaining:productRemaining(p)}});
});
app.post('/api/raffle/products/:number/delete',auth,(req,res)=>{
  const i=state.rouletteProducts.findIndex(x=>str(x.number)===str(req.params.number));
  if(i<0)return res.status(404).json({ok:false,error:'추첨 상품을 찾을 수 없습니다.'});
  const p=state.rouletteProducts[i],drawn=productDrawnCount(p.number);
  if(drawn>0){
    p.enabled=false;p.modifiedAt=nowIso();
    adminAudit('추첨상품중지',{id:String(p.number),name:p.name},{enabled:true},{enabled:false,drawn});
    saveState();
    return res.json({ok:true,disabled:true,drawn,product:p});
  }
  state.rouletteProducts.splice(i,1);
  adminAudit('추첨상품삭제',{id:String(p.number),name:p.name},p,null);
  saveState();
  res.json({ok:true,deleted:true});
});


app.get('/api/raffle/remote/status',auth,(req,res)=>{
  res.json({
    ok:true,
    connectedScreens:raffleStageClients.size,
    status:raffleRemote.status,
    screen:raffleRemote.screen,
    product:raffleRemote.product,
    poolSize:raffleRemote.poolSize,
    count:raffleRemote.count,
    startedAt:raffleRemote.startedAt,
    winners:raffleRemote.winners||[],
    lastActionAt:raffleRemote.lastActionAt
  });
});

app.post('/api/raffle/remote/screen',auth,(req,res)=>{
  const mode=str(req.body?.mode||'idle');
  const allowed=new Set(['idle','title','black','raffle','winner']);
  if(!allowed.has(mode))return res.status(400).json({ok:false,error:'지원하지 않는 무대 화면입니다.'});
  raffleRemote.screen=mode;
  raffleRemote.lastActionAt=nowIso();
  if(mode==='idle' || mode==='title' || mode==='black'){
    if(raffleRemote.status!=='spinning')raffleRemote.status='idle';
  }
  broadcastRaffleStage('stage-mode',{mode,product:raffleRemote.product,winners:raffleRemote.winners||[]});
  res.json({ok:true,mode,connectedScreens:raffleStageClients.size});
});


function commitBatchRaffle(prep,method='동시 슬롯 추첨'){
  if(!prep)throw new Error('추첨 준비정보가 없습니다.');
  const count=Math.max(1,Math.min(5,num(prep.count,1)));
  const currentPool=eligibleRafflePool(prep.filter).filter(p=>prep.poolIds.includes(p.id));
  if(currentPool.length<count)throw new Error(`추첨 가능한 참가자가 ${currentPool.length}명뿐입니다.`);
  const product=state.rouletteProducts.find(x=>str(x.number)===str(prep.productNo))||{number:prep.productNo,name:prep.productName,quantity:999};
  if(productRemaining(product)<count)throw new Error(`상품 남은 수량이 ${productRemaining(product)}개입니다.`);
  const winners=cryptoPickUnique(currentPool,count);
  const drawId=prep.drawSessionId||uuid('draw'),drawnAt=nowIso();
  const records=winners.map((p,i)=>({
    drawId,drawnAt,prizeNo:product.number,prizeName:product.name,method,participantId:p.id,participantName:p.name,participantPhoneLast4:phoneLast4(p.phone),participantDisplayName:raffleDisplayName(p),
    seat:participantSeatLabel(p),rank:i+1,enabled:true,received:false,filter:prep.filter
  }));
  state.rouletteHistory.push(...records);
  saveState();
  return {product,winners:records,drawId,poolSize:currentPool.length};
}

function commitOneRaffle(prep,method='순차 추첨'){
  if(!prep)throw new Error('추첨 준비정보가 없습니다.');
  const already=new Set((prep.winners||[]).map(x=>x.participantId));
  const currentPool=eligibleRafflePool(prep.filter).filter(p=>prep.poolIds.includes(p.id)&&!already.has(p.id));
  if(!currentPool.length)throw new Error('추첨 가능한 참가자가 없습니다.');
  const product=state.rouletteProducts.find(x=>str(x.number)===str(prep.productNo))||{number:prep.productNo,name:prep.productName,quantity:999};
  if(productRemaining(product)<1)throw new Error('상품 남은 수량이 없습니다.');
  const p=cryptoPickUnique(currentPool,1)[0],rank=(prep.winners?.length||0)+1,drawId=prep.drawSessionId||uuid('draw');prep.drawSessionId=drawId;
  const record={drawId,drawnAt:nowIso(),prizeNo:product.number,prizeName:product.name,method,participantId:p.id,participantName:p.name,participantPhoneLast4:phoneLast4(p.phone),participantDisplayName:raffleDisplayName(p),seat:participantSeatLabel(p),rank,enabled:true,received:false,filter:prep.filter};
  prep.winners=prep.winners||[];prep.winners.push(record);state.rouletteHistory.push(record);saveState();
  return {record,product,winners:[...prep.winners],done:prep.winners.length>=prep.count,remainingPool:currentPool.length-1};
}

app.post('/api/raffle/remote/start',auth,(req,res)=>{
  if(raffleRemote.status==='spinning')return res.status(409).json({ok:false,error:'이미 슬롯 추첨이 진행 중입니다.'});
  const productNo=str(req.body?.productNo),count=Math.max(1,Math.min(5,num(req.body?.count,1))),filter=str(req.body?.filter||'usesCenter');
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:'행운상품',quantity:999,enabled:true};
  if(!product.enabled)return res.status(400).json({ok:false,error:'사용 중지된 상품입니다.'});
  if(productRemaining(product)<count)return res.status(400).json({ok:false,error:`${product.name} 남은 수량이 부족합니다.`});
  const pool=eligibleRafflePool(filter);
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const token=uuid('raffle'),prep={createdAt:Date.now(),productNo:product.number,productName:product.name,count,filter,poolIds:pool.map(p=>p.id),winners:[],drawSessionId:uuid('draw-session')};
  rafflePreparations.set(token,prep);setTimeout(()=>rafflePreparations.delete(token),20*60*1000).unref?.();
  const sample=cryptoPickUnique(pool,Math.min(90,pool.length)).map(p=>({id:p.id,name:p.name,displayName:raffleDisplayName(p),phoneLast4:phoneLast4(p.phone),seat:participantSeatLabel(p),organization:p.organization}));
  Object.assign(raffleRemote,{status:'spinning',screen:'raffle',token,product:{number:product.number,name:product.name,remaining:productRemaining(product)},sample,poolSize:pool.length,count,targetCount:count,currentIndex:1,filter,startedAt:nowIso(),winners:[],drawSessionId:prep.drawSessionId,lastActionAt:nowIso()});
  broadcastRaffleStage('raffle-start',{product:raffleRemote.product,poolSize:pool.length,sample,count,targetCount:count,batchMode:true});
  res.json({ok:true,status:'spinning',connectedScreens:raffleStageClients.size,product:raffleRemote.product,poolSize:pool.length,targetCount:count,batchMode:true});
});

app.post('/api/raffle/remote/stop',auth,(req,res)=>{
  if(raffleRemote.status!=='spinning'||!raffleRemote.token)return res.status(409).json({ok:false,error:'현재 회전 중인 슬롯 추첨이 없습니다.'});
  const token=raffleRemote.token,prep=rafflePreparations.get(token);
  if(!prep)return res.status(400).json({ok:false,error:'추첨 준비정보가 만료되었습니다.'});
  try{
    const result=commitBatchRaffle(prep,prep.count===1?'1인 슬롯 추첨':'동시 슬롯 추첨');
    rafflePreparations.delete(token);
    raffleRemote.status='revealing';raffleRemote.screen='raffle';raffleRemote.token='';raffleRemote.winners=result.winners;
    raffleRemote.currentIndex=result.winners.length;raffleRemote.product={number:result.product.number,name:result.product.name,remaining:productRemaining(result.product)};raffleRemote.lastActionAt=nowIso();
    broadcastRaffleStage('raffle-batch-winners',{product:{name:result.product.name},winners:result.winners,targetCount:result.winners.length,batchMode:true});
    adminAudit('원격행운권당첨',{id:result.drawId,name:result.product.name},null,{winnerIds:result.winners.map(x=>x.participantId),count:result.winners.length,filter:prep.filter});
    setTimeout(()=>{
      raffleRemote.status='final';raffleRemote.screen='final';raffleRemote.lastActionAt=nowIso();
      broadcastRaffleStage('raffle-final',{product:{name:result.product.name},winners:result.winners,targetCount:result.winners.length});
    },Math.max(6500,3600+result.winners.length*650)).unref?.();
    res.json({ok:true,status:'revealing',done:true,drawId:result.drawId,product:raffleRemote.product,winners:result.winners,connectedScreens:raffleStageClients.size});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.post('/api/raffle/remote/next',auth,(req,res)=>{
  res.status(409).json({ok:false,error:'v0.9.16부터는 1~5명을 한 번에 추첨합니다. 새 추첨 시작 버튼을 사용해 주세요.'});
});

app.post('/api/raffle/remote/reset',auth,(req,res)=>{if(raffleRemote.token)rafflePreparations.delete(raffleRemote.token);Object.assign(raffleRemote,{status:'idle',screen:'idle',token:'',product:null,sample:[],poolSize:0,count:1,targetCount:1,currentIndex:0,filter:'usesCenter',startedAt:null,winners:[],drawSessionId:'',lastActionAt:nowIso()});broadcastRaffleStage('stage-mode',{mode:'idle'});res.json({ok:true,connectedScreens:raffleStageClients.size});});

app.post('/api/raffle/prepare',auth,(req,res)=>{
  const productNo=str(req.body?.productNo),count=Math.max(1,Math.min(5,num(req.body?.count,1))),filter=str(req.body?.filter||'usesCenter');
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:str(req.body?.productName)||'행운상품',quantity:999,enabled:true};
  if(!product.enabled)return res.status(400).json({ok:false,error:'사용 중지된 상품입니다.'});
  const remaining=productRemaining(product);
  if(remaining<count)return res.status(400).json({ok:false,error:`${product.name} 남은 수량이 ${remaining}개입니다.`});
  const pool=eligibleRafflePool(filter);
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const token=uuid('raffle');
  const sample=cryptoPickUnique(pool,Math.min(70,pool.length)).map(p=>({id:p.id,name:p.name,seat:p.seat,organization:p.organization}));
  rafflePreparations.set(token,{createdAt:Date.now(),productNo:product.number,productName:product.name,count,filter,poolIds:pool.map(p=>p.id),winners:[],drawSessionId:uuid('draw-session')});
  setTimeout(()=>rafflePreparations.delete(token),10*60*1000).unref?.();
  broadcastRaffleStage('raffle-start',{product:{name:product.name,remaining},poolSize:pool.length,sample});
  res.json({ok:true,token,product:{...product,remaining},count,filter,poolSize:pool.length,sample});
});
app.post('/api/raffle/commit-one',auth,(req,res)=>{const token=str(req.body?.token),prep=rafflePreparations.get(token);if(!prep)return res.status(400).json({ok:false,error:'추첨 준비정보가 만료되었습니다. 다시 시작해 주세요.'});try{const result=commitOneRaffle(prep,'PC 순차 랜덤');if(result.done)rafflePreparations.delete(token);res.json({ok:true,...result,targetCount:prep.count,currentIndex:result.winners.length});}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/raffle/commit',auth,(req,res)=>{
  const token=str(req.body?.token),prep=rafflePreparations.get(token);
  if(!prep)return res.status(400).json({ok:false,error:'추첨 준비정보가 만료되었습니다. 다시 시작해 주세요.'});
  const currentPool=eligibleRafflePool(prep.filter).filter(p=>prep.poolIds.includes(p.id));
  if(currentPool.length<prep.count)return res.status(400).json({ok:false,error:'추첨 대상이 변경되어 다시 준비해야 합니다.'});
  const product=state.rouletteProducts.find(x=>str(x.number)===str(prep.productNo))||{number:prep.productNo,name:prep.productName,quantity:999};
  const remaining=productRemaining(product);
  if(remaining<prep.count)return res.status(400).json({ok:false,error:`상품 남은 수량이 ${remaining}개입니다.`});
  const winners=cryptoPickUnique(currentPool,prep.count);
  const drawId=uuid('draw'),drawnAt=nowIso();
  const records=winners.map((p,i)=>({drawId,drawnAt,prizeNo:product.number,prizeName:product.name,method:'슬롯 스톱 랜덤',participantId:p.id,participantName:p.name,seat:displaySeatCode(p.seat),rank:i+1,enabled:true,received:false,filter:prep.filter}));
  state.rouletteHistory.push(...records);
  adminAudit('행운권추첨',{id:drawId,name:product.name},null,{winnerIds:winners.map(p=>p.id),count:records.length,filter:prep.filter},`대상 ${currentPool.length}명`);
  rafflePreparations.delete(token);
  saveState();
  broadcastRaffleStage('raffle-winner',{product:{name:product.name},winners:records});
  res.json({ok:true,drawId,product:{...product,remaining:productRemaining(product)},winners:records,poolSize:currentPool.length});
});
app.post('/api/raffle/draw',auth,(req,res)=>{
  const filter=str(req.body?.filter||'usesCenter'),productNo=str(req.body?.productNo),count=Math.max(1,Math.min(5,num(req.body?.count,1)));
  const product=state.rouletteProducts.find(x=>str(x.number)===productNo)||{number:productNo||'custom',name:str(req.body?.productName)||'행운상품',quantity:999,enabled:true};
  const remaining=productRemaining(product);
  if(remaining<count)return res.status(400).json({ok:false,error:`${product.name} 남은 수량이 ${remaining}개입니다.`});
  const pool=eligibleRafflePool(filter);
  if(pool.length<count)return res.status(400).json({ok:false,error:`추첨 가능한 참가자가 ${pool.length}명뿐입니다.`});
  const winners=cryptoPickUnique(pool,count),drawId=uuid('draw'),drawnAt=nowIso();
  const records=winners.map((p,i)=>({drawId,drawnAt,prizeNo:product.number,prizeName:product.name,method:'랜덤',participantId:p.id,participantName:p.name,seat:displaySeatCode(p.seat),rank:i+1,enabled:true,received:false,filter}));
  state.rouletteHistory.push(...records);saveState();res.json({ok:true,drawId,product,winners:records,poolSize:pool.length});
});
app.get('/api/raffle/history',auth,(req,res)=>res.json({ok:true,rows:[...state.rouletteHistory].reverse().slice(0,500)}));

app.post('/api/raffle/winner-sms',auth,(req,res)=>{
  const drawId=str(req.body?.drawId),participantId=str(req.body?.participantId);
  const record=state.rouletteHistory.find(x=>x.drawId===drawId&&x.participantId===participantId&&x.enabled!==false);
  if(!record)return res.status(404).json({ok:false,error:'유효한 당첨 기록을 찾을 수 없습니다.'});
  const winner=state.participants.find(p=>p.id===participantId)||null;
  const group=winner?groupForParticipant(winner):null;
  const members=group?(group.memberIds||[]).map(id=>state.participants.find(p=>p.id===id)).filter(Boolean):[];
  const representative=(group&&group.representativeId)?state.participants.find(p=>p.id===group.representativeId&&p.phone):null;
  const target=representative || members.find(p=>p.phone) || (winner?.phone?winner:null);
  if(!target?.phone)return res.status(400).json({ok:false,error:'당첨자 또는 대표자의 연락처가 없습니다.'});
  const seatText=record.seat?`\n좌석: ${record.seat}`:'';
  const repText=target.id!==participantId?`\n${record.participantName}님의 당첨 안내를 대표 연락처로 보내드립니다.`:'';
  const message=`[남양주시장애인복지관]\n20주년 행운권 당첨을 축하드립니다!\n당첨자: ${record.participantName}\n경품: ${record.prizeName}${seatText}${repText}\n경품 수령 시 본 문자를 보여주세요.\n단체 참가자는 대표자가 확인 후 대신 수령하실 수 있습니다.`;
  const item=queueAndSendSms(target.phone,message,'raffle-winner',target.id);
  if(!item)return res.status(400).json({ok:false,error:'문자 발송 대상 번호가 올바르지 않습니다.'});
  record.winnerSmsSentAt=nowIso();
  record.winnerSmsTargetId=target.id;
  record.winnerSmsTargetName=target.name;
  record.winnerSmsPhone=target.phone;
  record.winnerSmsStatus='발송요청';
  adminAudit('행운권당첨문자',record,null,{targetId:target.id,targetName:target.name,phone:target.phone},`${record.participantName} / ${record.prizeName}`);
  saveState();
  res.json({ok:true,record,target:{id:target.id,name:target.name,phone:target.phone,isRepresentative:target.id!==participantId},smsId:item.id});
});

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


app.get('/api/participant/:id/sms-history',auth,(req,res)=>{
  const p=findParticipant(req.params.id);if(!p)return res.status(404).json({ok:false,error:'참가자를 찾을 수 없습니다.'});
  const rows=state.smsQueue.filter(x=>x.participantId===p.id).slice(-20).reverse();
  res.json({ok:true,rows});
});
app.post('/api/sms/retry/:smsId',auth,async(req,res)=>{
  const old=state.smsQueue.find(x=>x.id===str(req.params.smsId));
  if(!old)return res.status(404).json({ok:false,error:'문자 기록을 찾을 수 없습니다.'});
  const item=queueSms(old.phone,old.message,`${old.kind||'sms'}-retry`,old.participantId||'');
  if(!item)return res.status(400).json({ok:false,error:'수신번호가 없습니다.'});
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




app.post('/api/operation-mode',auth,(req,res)=>{
  if(req.adminRole!=='admin')return res.status(403).json({ok:false,error:'메인 관리자만 변경할 수 있습니다.'});
  const password=str(req.body?.password);
  if(!SYSTEM_DEMO_MODE && password!==ADMIN_PASSWORD)return res.status(401).json({ok:false,error:'관리자 비밀번호가 올바르지 않습니다.'});
  state.settings.eventOperationMode=bool(req.body?.enabled);
  adminAudit('행사운영잠금',{id:'operation-mode',name:'행사 운영모드'},null,{enabled:state.settings.eventOperationMode});
  saveState();res.json({ok:true,enabled:state.settings.eventOperationMode});
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
  if(SYSTEM_DEMO_MODE)return {ok:true,demo:true,rows:[]};
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
    const d=await externalBackupRequest('save',{state,snapshot,source:'cloudtype-v0.9'});
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
app.listen(PORT,'0.0.0.0',()=>console.log(`NYJWEL Admin v0.9.16 · :${PORT}`));
