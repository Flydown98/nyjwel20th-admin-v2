'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'change-me-now');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BACKUP_INTERVAL_MS = 60 * 1000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

function nowIso() { return new Date().toISOString(); }
function id(prefix='id') { return `${prefix}_${crypto.randomUUID()}`; }

function defaultState() {
  return {
    meta: {
      app: 'nyjwel20th-admin-v2',
      version: '0.2.0',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      importedAt: null,
      importSource: null
    },
    settings: {},
    participants: [],
    groups: [],
    seats: [],
    checkins: [],
    gifts: [],
    raffles: [],
    rouletteHistory: [],
    rouletteProducts: [],
    smsQueue: [],
    logs: []
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      const initial = defaultState();
      fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...defaultState(), ...parsed, meta: { ...defaultState().meta, ...(parsed.meta || {}) } };
  } catch (err) {
    console.error('[STATE] load failed:', err);
    const fallback = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

let state = loadState();

function saveState() {
  state.meta.updatedAt = nowIso();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function backupNow(label='auto') {
  try {
    saveState();
    const stamp = nowIso().replace(/[:.]/g, '-');
    const filename = `${label}_${stamp}.json`;
    fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, filename));
    fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, 'latest.json'));

    const autos = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^auto_.*\.json$/.test(f))
      .map(f => ({f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs}))
      .sort((a,b) => b.t - a.t);
    autos.slice(180).forEach(x => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)); } catch (_) {}
    });
    return filename;
  } catch (err) {
    console.error('[BACKUP] failed:', err);
    return null;
  }
}

setInterval(() => backupNow('auto'), BACKUP_INTERVAL_MS).unref();

const sessions = new Map();
function cleanupSessions() {
  const now = Date.now();
  for (const [token, s] of sessions.entries()) {
    if (s.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 5 * 60 * 1000).unref();

function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const s = sessions.get(token);
  if (!s || s.expiresAt <= Date.now()) {
    return res.status(401).json({ok:false, error:'로그인이 필요합니다.'});
  }
  req.session = s;
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('엑셀 파일(.xlsx/.xls)만 업로드할 수 있습니다.'), ok);
  }
});

function excelSerialToIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) {
      const dt = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0)));
      return dt.toISOString();
    }
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}
function bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = str(v).toLowerCase();
  return ['true','1','y','yes','예','사용','참','o','○'].includes(s);
}
function num(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function phone(v) {
  const raw = str(v);
  if (!raw) return '';
  const digits = raw.replace(/\D/g,'');
  // 가져오기 단계에서는 원본 의미를 보존하되, 정상적인 10/11자리 번호만 보기 좋게 정리합니다.
  if (digits.length === 11 && digits.startsWith('010')) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  return raw;
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {defval:null, raw:true});
}

function meaningfulRows(rows, keys=[]) {
  return rows.filter(r => keys.some(k => str(r[k])));
}

function buildImport(buffer, originalName) {
  const wb = XLSX.read(buffer, {type:'buffer', cellDates:false});
  const sheetNames = wb.SheetNames || [];

  const pRows = sheetRows(wb, '참가자');
  const participants = pRows
    .filter(r => str(r['QR고유코드']) || str(r['이름']))
    .map((r, idx) => ({
      id: str(r['QR고유코드']) || `IMPORTED-${idx+1}`,
      receptionNo: num(r['접수번호'], idx+1),
      name: str(r['이름']),
      phone: phone(r['연락처']),
      seat: str(r['좌석번호']),
      applicationType: str(r['신청유형']),
      note: str(r['비고']),
      arrived: bool(r['도착여부']),
      arrivedAt: excelSerialToIso(r['도착시각']),
      ticketPrintedAt: excelSerialToIso(r['티켓출력시각']),
      registeredAt: excelSerialToIso(r['등록시각']),
      modifiedAt: excelSerialToIso(r['수정시각']),
      active: r['사용여부'] === null || r['사용여부'] === undefined ? true : bool(r['사용여부']),
      organization: str(r['소속기관']),
      requestedCount: Math.max(1, num(r['신청인원(개인=1)'], 1)),
      privacyConsent: bool(r['개인정보동의']),
      privacyConsentAt: excelSerialToIso(r['개인정보동의일시']),
      privacyConsentVersion: str(r['개인정보동의버전']),
      wheelchairUser: bool(r['휠체어이용여부']),
      sensitiveConsent: bool(r['민감정보동의']),
      wheelchairCount: Math.max(0, num(r['휠체어이용인원(개인신청 0·1)'], 0)),
      usesCenter: bool(r['복지관이용여부']),
      disabledPerson: bool(r['장애인당사자여부']),
      companionGroup: str(r['동반그룹']),
      participationStatus: str(r['참여상태']) || (r['사용여부'] === false ? '미참여' : '참여'),
      giftReceived: false
    }));

  const seatRows = sheetRows(wb, '좌석설정');
  const seats = seatRows.filter(r => str(r['좌석코드'])).map(r => ({
    code: str(r['좌석코드']).toUpperCase(),
    row: str(r['행']).toUpperCase(),
    side: str(r['측면']).toUpperCase(),
    number: num(r['번호'], 0),
    zone: str(r['구역']) || '일반',
    autoAssignable: bool(r['일반자동배정']),
    enabled: r['사용여부'] === null || r['사용여부'] === undefined ? true : bool(r['사용여부']),
    wheelchairAssignable: bool(r['휠체어자동배정']),
    note: str(r['메모']),
    sortOrder: num(r['정렬순서'], 0)
  }));

  const settings = {};
  sheetRows(wb, '설정').forEach(r => {
    const key = str(r['설정키']);
    if (key) settings[key] = r['값'];
  });

  const gifts = meaningfulRows(sheetRows(wb,'기념품지급'), ['QR코드','이름'])
    .map(r => ({
      participantId: str(r['QR코드']),
      name: str(r['이름']),
      received: bool(r['지급여부']),
      receivedAt: excelSerialToIso(r['지급시각']),
      operator: str(r['처리자']),
      modifiedAt: excelSerialToIso(r['수정시각'])
    }));

  const smsQueue = meaningfulRows(sheetRows(wb,'문자발송대기'), ['ID','수신번호','메시지'])
    .map(r => ({
      id: str(r['ID']) || id('sms'),
      phone: phone(r['수신번호']),
      message: str(r['메시지']),
      status: str(r['상태']) || '대기',
      result: str(r['결과']),
      requestedAt: excelSerialToIso(r['요청일시']),
      sentAt: excelSerialToIso(r['발송일시'])
    }));

  const raffles = meaningfulRows(sheetRows(wb,'행운추첨'), ['좌석번호','상품명','당첨자QR'])
    .map(r => ({
      seat: str(r['좌석번호']),
      prize: str(r['상품명']),
      enabled: bool(r['사용여부']),
      received: bool(r['수령여부']),
      receivedAt: excelSerialToIso(r['수령시각']),
      participantId: str(r['당첨자QR']),
      participantName: str(r['당첨자명']),
      createdAt: excelSerialToIso(r['등록시각']),
      modifiedAt: excelSerialToIso(r['수정시각']),
      note: str(r['비고'])
    }));

  const rouletteProducts = meaningfulRows(sheetRows(wb,'룰렛상품'), ['상품번호','상품명'])
    .map(r => ({
      number: str(r['상품번호']),
      name: str(r['상품명']),
      quantity: num(r['총수량'],0),
      enabled: bool(r['사용여부']),
      modifiedAt: excelSerialToIso(r['수정시각']),
      note: str(r['비고']),
      hasPhoto: bool(r['사진여부']),
      photoDataUrl: str(r['상품사진DataURL'])
    }));

  const rouletteHistory = meaningfulRows(sheetRows(wb,'룰렛추첨내역'), ['추첨ID','당첨자QR','당첨자명'])
    .map(r => ({
      drawId: str(r['추첨ID']),
      drawnAt: excelSerialToIso(r['추첨시각']),
      prizeNo: str(r['상품번호']),
      prizeName: str(r['상품명']),
      method: str(r['당첨방식']),
      winners: num(r['이번당첨인원'],0),
      poolSize: num(r['대상인원'],0),
      participantId: str(r['당첨자QR']),
      participantName: str(r['당첨자명']),
      seat: str(r['좌석번호']),
      rank: num(r['결승순위'],0),
      enabled: bool(r['사용여부']),
      canceledAt: excelSerialToIso(r['취소시각']),
      station: str(r['접수대']),
      note: str(r['비고'])
    }));

  const checkins = meaningfulRows(sheetRows(wb,'접수로그'), ['처리시각','작업','QR고유코드','이름'])
    .map(r => ({
      at: excelSerialToIso(r['처리시각']),
      action: str(r['작업']),
      participantId: str(r['QR고유코드']),
      receptionNo: num(r['접수번호'],0),
      name: str(r['이름']),
      seat: str(r['좌석번호']),
      station: str(r['접수대']),
      note: str(r['비고'])
    }));

  // 동반그룹 값이 실제로 있는 참가자만 그룹으로 묶습니다.
  const groupMap = new Map();
  participants.forEach(p => {
    const g = str(p.companionGroup);
    if (!g || /^(false|0)$/i.test(g)) return;
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g).push(p.id);
  });
  const groups = [...groupMap.entries()].map(([groupId, memberIds]) => ({
    id: groupId,
    memberIds,
    imported: true
  }));

  const giftById = new Map(gifts.filter(g => g.participantId).map(g => [g.participantId, g]));
  participants.forEach(p => {
    const g = giftById.get(p.id);
    if (g) p.giftReceived = Boolean(g.received);
  });

  const dupQr = participants.length - new Set(participants.map(p => p.id)).size;
  const blankPhones = participants.filter(p => !p.phone).length;
  const noLeadingZeroPhones = participants.filter(p => {
    const d = str(p.phone).replace(/\D/g,'');
    return d && !d.startsWith('0') && !d.startsWith('82');
  }).length;

  return {
    fileName: originalName,
    sheetNames,
    data: {participants, seats, settings, gifts, smsQueue, raffles, rouletteProducts, rouletteHistory, checkins, groups},
    summary: {
      participants: participants.length,
      seats: seats.length,
      settings: Object.keys(settings).length,
      groups: groups.length,
      gifts: gifts.length,
      smsQueue: smsQueue.length,
      raffles: raffles.length,
      rouletteProducts: rouletteProducts.length,
      rouletteHistory: rouletteHistory.length,
      checkins: checkins.length,
      duplicateQr: dupQr,
      blankPhones,
      suspiciousPhones: noLeadingZeroPhones
    },
    sampleParticipants: participants.slice(0, 8),
    sampleSeats: seats.slice(0, 8)
  };
}

const importPreviews = new Map();
function cleanupPreviews() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k,v] of importPreviews.entries()) {
    if (v.createdAt < cutoff) importPreviews.delete(k);
  }
}
setInterval(cleanupPreviews, 5 * 60 * 1000).unref();

app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(ROOT,'public'), {maxAge:0, etag:false}));

app.get('/api/health', (req,res) => {
  res.json({
    ok:true,
    app:'nyjwel20th-admin-v2',
    version:'0.2.0',
    serverTime:nowIso(),
    uptimeSeconds:Math.round(process.uptime()),
    memory:process.memoryUsage(),
    participants:state.participants.length,
    lastUpdatedAt:state.meta.updatedAt
  });
});

app.post('/api/login', (req,res) => {
  const password = String(req.body?.password || '');
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ok:false,error:'비밀번호가 올바르지 않습니다.'});
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token,{token,expiresAt});
  res.json({ok:true,token,expiresAt:new Date(expiresAt).toISOString()});
});

app.get('/api/bootstrap', auth, (req,res) => {
  res.json({
    ok:true,
    serverTime:nowIso(),
    summary:{
      participants:state.participants.length,
      arrived:state.participants.filter(p=>p.arrived).length,
      active:state.participants.filter(p=>p.active && p.participationStatus !== '미참여').length,
      groups:state.groups.length,
      seats:state.seats.length,
      assignedSeats:state.participants.filter(p=>p.seat).length,
      giftsReceived:state.participants.filter(p=>p.giftReceived).length,
      smsPending:state.smsQueue.filter(x=>x.status==='대기' || x.status==='pending').length
    },
    settings:state.settings,
    meta:state.meta
  });
});

app.get('/api/participants', auth, (req,res) => {
  const q = str(req.query.q).toLowerCase();
  const status = str(req.query.status || 'all');
  const limit = Math.min(300, Math.max(1, num(req.query.limit,100)));
  const offset = Math.max(0, num(req.query.offset,0));

  let rows = state.participants;
  if (q) {
    const qd = q.replace(/\D/g,'');
    rows = rows.filter(p => {
      const hay = `${p.name} ${p.phone} ${p.organization} ${p.id} ${p.seat}`.toLowerCase();
      return hay.includes(q) || (qd.length >= 3 && str(p.phone).replace(/\D/g,'').includes(qd));
    });
  }
  if (status === 'arrived') rows = rows.filter(p=>p.arrived);
  if (status === 'pending') rows = rows.filter(p=>!p.arrived && p.active && p.participationStatus !== '미참여');
  if (status === 'inactive') rows = rows.filter(p=>!p.active || p.participationStatus === '미참여');

  res.json({ok:true,total:rows.length,offset,limit,rows:rows.slice(offset,offset+limit)});
});

app.get('/api/seats', auth, (req,res) => {
  const q = str(req.query.q).toLowerCase();
  const limit = Math.min(600, Math.max(1,num(req.query.limit,200)));
  let rows = state.seats;
  if (q) rows = rows.filter(s => `${s.code} ${s.zone} ${s.note}`.toLowerCase().includes(q));
  res.json({ok:true,total:rows.length,rows:rows.slice(0,limit)});
});

app.post('/api/import/xlsx/preview', auth, upload.single('file'), (req,res,next) => {
  try {
    if (!req.file) return res.status(400).json({ok:false,error:'엑셀 파일을 선택해 주세요.'});
    const parsed = buildImport(req.file.buffer, req.file.originalname);
    const importId = id('import');
    importPreviews.set(importId,{createdAt:Date.now(),parsed});
    res.json({
      ok:true,
      importId,
      fileName:parsed.fileName,
      sheets:parsed.sheetNames,
      summary:parsed.summary,
      sampleParticipants:parsed.sampleParticipants,
      sampleSeats:parsed.sampleSeats
    });
  } catch (err) { next(err); }
});

app.post('/api/import/xlsx/confirm', auth, (req,res) => {
  const importId = str(req.body?.importId);
  const holder = importPreviews.get(importId);
  if (!holder) return res.status(400).json({ok:false,error:'미리보기 정보가 만료되었습니다. 파일을 다시 선택해 주세요.'});

  const pre = backupNow('before-import');
  const d = holder.parsed.data;

  state.participants = d.participants;
  state.seats = d.seats;
  state.settings = d.settings;
  state.gifts = d.gifts;
  state.smsQueue = d.smsQueue;
  state.raffles = d.raffles;
  state.rouletteProducts = d.rouletteProducts;
  state.rouletteHistory = d.rouletteHistory;
  state.checkins = d.checkins;
  state.groups = d.groups;
  state.meta.importedAt = nowIso();
  state.meta.importSource = holder.parsed.fileName;
  state.logs.push({id:id('log'),type:'xlsx-import',message:`${holder.parsed.fileName} 가져오기`,at:nowIso()});
  saveState();
  const after = backupNow('after-import');
  importPreviews.delete(importId);

  res.json({ok:true,summary:holder.parsed.summary,beforeBackup:pre,afterBackup:after,importedAt:state.meta.importedAt});
});

app.post('/api/backup', auth, (req,res) => {
  const filename = backupNow('manual');
  if (!filename) return res.status(500).json({ok:false,error:'백업 생성에 실패했습니다.'});
  res.json({ok:true,filename});
});

app.get('/api/backup/download', auth, (req,res) => {
  backupNow('download');
  res.download(STATE_FILE, `nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`);
});

app.use((req,res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ok:false,error:'API를 찾을 수 없습니다.'});
  res.sendFile(path.join(ROOT,'public','index.html'));
});

app.use((err,req,res,next) => {
  console.error('[ERROR]', err);
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ok:false,error:'엑셀 파일이 너무 큽니다. 12MB 이하 파일을 사용해 주세요.'});
  res.status(500).json({ok:false,error:err?.message || '서버 내부 오류가 발생했습니다.'});
});

app.listen(PORT,'0.0.0.0',() => {
  console.log('==============================================');
  console.log(' NYJWEL 20th Admin v2 · v0.2.0');
  console.log(` http://0.0.0.0:${PORT}`);
  console.log('==============================================');
  if (ADMIN_PASSWORD === 'change-me-now') console.warn('[WARNING] ADMIN_PASSWORD 환경변수를 반드시 설정하세요.');
});
