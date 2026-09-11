'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'event.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reception_no INTEGER,
      qr_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      seat TEXT DEFAULT '',
      application_type TEXT DEFAULT '개인신청',
      note TEXT DEFAULT '',
      arrived INTEGER NOT NULL DEFAULT 0,
      checkin_at TEXT,
      ticket_printed_at TEXT,
      registered_at TEXT,
      updated_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      organization TEXT DEFAULT '',
      party_size INTEGER NOT NULL DEFAULT 1,
      wheelchair_user INTEGER NOT NULL DEFAULT 0,
      wheelchair_count INTEGER NOT NULL DEFAULT 0,
      uses_center INTEGER NOT NULL DEFAULT 0,
      disabled_person INTEGER NOT NULL DEFAULT 0,
      companion_group TEXT DEFAULT '',
      participation_status TEXT DEFAULT '참여',
      source TEXT DEFAULT 'excel',
      imported_seat TEXT DEFAULT '',
      imported_arrived INTEGER NOT NULL DEFAULT 0,
      imported_checkin_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_participants_name ON participants(name);
    CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(phone);
    CREATE INDEX IF NOT EXISTS idx_participants_org ON participants(organization);
    CREATE INDEX IF NOT EXISTS idx_participants_seat ON participants(seat);
    CREATE INDEX IF NOT EXISTS idx_participants_arrived ON participants(arrived);

    CREATE TABLE IF NOT EXISTS seats (
      seat_code TEXT PRIMARY KEY,
      row_label TEXT DEFAULT '',
      side TEXT DEFAULT '',
      seat_no INTEGER,
      category TEXT DEFAULT '',
      auto_assignable INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      wheelchair_eligible INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 999999
    );

    CREATE INDEX IF NOT EXISTS idx_seats_sort ON seats(sort_order);

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processed_at TEXT NOT NULL,
      action TEXT NOT NULL,
      qr_code TEXT DEFAULT '',
      reception_no INTEGER,
      name TEXT DEFAULT '',
      seat TEXT DEFAULT '',
      station TEXT DEFAULT '',
      note TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(processed_at DESC);

    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      qr_code TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      kind TEXT DEFAULT '',
      text TEXT DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      response TEXT DEFAULT '',
      error TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      description TEXT DEFAULT ''
    );
  `);
}
initDb();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('엑셀(.xlsx/.xls) 파일만 업로드할 수 있습니다.'), ok);
  }
});

function nowIso() { return new Date().toISOString(); }
function boolVal(v) {
  if (v === true || v === 1) return 1;
  const s = String(v ?? '').trim().toLowerCase();
  return ['true', '1', 'y', 'yes', '예', '사용', '활성'].includes(s) ? 1 : 0;
}
function clean(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function digits(v) { return String(v ?? '').replace(/\D/g, ''); }
function fmtPhone(v) {
  const d = digits(v);
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return clean(v, 30);
}
function excelDateToIso(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0)).toISOString();
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function q(v) { return String(v ?? '').trim(); }
function normalizeSeat(v) { return clean(v, 100).toUpperCase().replace(/\s+/g, ''); }
function parseSeatList(v) {
  return normalizeSeat(v).split(/[;,/\s]+/).map(x => x.trim()).filter(Boolean);
}
function extractQr(raw) {
  const value = clean(raw, 1000);
  if (!value) return '';
  const m = value.match(/20TH-[A-Z0-9-]+/i);
  if (m) return m[0].toUpperCase();
  try {
    const u = new URL(value);
    for (const k of ['code', 'id', 'qr']) {
      const x = u.searchParams.get(k);
      if (x) return clean(x, 200).toUpperCase();
    }
  } catch (_) {}
  return value.toUpperCase();
}
function authOk(req) {
  if (!ADMIN_TOKEN) return false;
  const token = String(req.get('X-Admin-Token') || req.body?.token || req.query?.token || '');
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAuth(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ ok: false, error: 'Cloudtype 환경변수 ADMIN_TOKEN을 먼저 설정하세요.' });
  if (!authOk(req)) return res.status(401).json({ ok: false, error: '관리 토큰이 올바르지 않습니다.' });
  next();
}
function runTx(fn) {
  db.exec('BEGIN IMMEDIATE;');
  try { const out = fn(); db.exec('COMMIT;'); return out; }
  catch (e) { try { db.exec('ROLLBACK;'); } catch (_) {} throw e; }
}
function addLog(action, p = {}, station = '', note = '') {
  db.prepare(`INSERT INTO logs(processed_at,action,qr_code,reception_no,name,seat,station,note)
              VALUES(?,?,?,?,?,?,?,?)`).run(
    nowIso(), action, p.qr_code || '', p.reception_no || null, p.name || '', p.seat || '', clean(station, 80), clean(note, 1000)
  );
}
function participantByQr(code) {
  return db.prepare('SELECT * FROM participants WHERE qr_code=?').get(code) || null;
}
function participantById(id) {
  return db.prepare('SELECT * FROM participants WHERE id=?').get(Number(id)) || null;
}
function publicParticipant(p) {
  if (!p) return null;
  return {
    ...p,
    arrived: !!p.arrived,
    active: !!p.active,
    wheelchair_user: !!p.wheelchair_user,
    uses_center: !!p.uses_center,
    disabled_person: !!p.disabled_person
  };
}
function isExcluded(p) {
  const s = String(p?.participation_status || '').trim();
  return !p?.active || ['미참여', '참여불가', '취소'].includes(s);
}
function occupiedSeatSet(exceptParticipantId = null) {
  const rows = exceptParticipantId
    ? db.prepare('SELECT id,seat FROM participants WHERE active=1 AND id<>? AND COALESCE(seat,\'\')<>\'\'').all(Number(exceptParticipantId))
    : db.prepare('SELECT id,seat FROM participants WHERE active=1 AND COALESCE(seat,\'\')<>\'\'').all();
  const set = new Set();
  for (const r of rows) for (const s of parseSeatList(r.seat)) set.add(s);
  return set;
}
function seatExistsAndFree(code, exceptParticipantId = null) {
  const seat = db.prepare('SELECT * FROM seats WHERE seat_code=?').get(code);
  if (!seat || !seat.enabled) return false;
  return !occupiedSeatSet(exceptParticipantId).has(code);
}
function pickSeat(p, exceptParticipantId = null) {
  const occupied = occupiedSeatSet(exceptParticipantId);
  const query = p.wheelchair_user
    ? `SELECT * FROM seats WHERE enabled=1 AND wheelchair_eligible=1 ORDER BY sort_order, seat_code`
    : `SELECT * FROM seats WHERE enabled=1 AND auto_assignable=1 ORDER BY sort_order, seat_code`;
  const candidates = db.prepare(query).all();
  const free = candidates.find(s => !occupied.has(s.seat_code));
  if (free) return free.seat_code;
  if (p.wheelchair_user) {
    const fallback = db.prepare(`SELECT * FROM seats WHERE enabled=1 AND auto_assignable=1 ORDER BY sort_order, seat_code`).all()
      .find(s => !occupied.has(s.seat_code));
    return fallback ? fallback.seat_code : '';
  }
  return '';
}
function nextReceptionNo() {
  const r = db.prepare('SELECT MAX(COALESCE(reception_no,0)) AS max_no FROM participants').get();
  return Number(r?.max_no || 0) + 1;
}
function makeQr(no) {
  return `20TH-V2-${String(no).padStart(4, '0')}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

let SolapiMessageService = null;
try { ({ SolapiMessageService } = require('solapi')); } catch (_) {}
function solapiConfigured() {
  return !!(SolapiMessageService && process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER);
}
async function sendSms({ p, kind, text }) {
  const phone = digits(p.phone);
  if (!phone || phone.length < 9) return { ok: false, skipped: true, reason: '연락처 없음' };
  if (!solapiConfigured()) return { ok: false, skipped: true, reason: 'SOLAPI 미설정' };
  const from = digits(process.env.SOLAPI_SENDER);
  const createdAt = nowIso();
  try {
    const service = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
    const result = await service.send({ to: phone, from, text });
    db.prepare(`INSERT INTO sms_logs(created_at,qr_code,phone,kind,text,success,response,error) VALUES(?,?,?,?,?,?,?,?)`)
      .run(createdAt, p.qr_code || '', phone, kind, text, 1, JSON.stringify(result || {}), '');
    return { ok: true, result };
  } catch (e) {
    db.prepare(`INSERT INTO sms_logs(created_at,qr_code,phone,kind,text,success,response,error) VALUES(?,?,?,?,?,?,?,?)`)
      .run(createdAt, p.qr_code || '', phone, kind, text, 0, '', clean(e?.message || e, 2000));
    return { ok: false, error: e?.message || String(e) };
  }
}
function checkinText(p) {
  return `[남양주시장애인복지관]\n개관 20주년 기념행사 현장접수가 완료되었습니다.\n좌석: ${p.seat || '현장 안내'}\n감사합니다.`;
}
function seatChangeText(p) {
  return `[남양주시장애인복지관]\n20주년 기념행사 좌석이 변경되었습니다.\n변경 좌석: ${p.seat || '현장 안내'}\n안내데스크 안내를 따라주세요.`;
}
function queueSms(p, kind, text) {
  setImmediate(() => sendSms({ p, kind, text }).catch(() => {}));
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'nyjwel20th-admin-v2', time: nowIso(), db: path.basename(DB_PATH) }));
app.post('/api/login', (req, res) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ ok: false, error: 'ADMIN_TOKEN 미설정' });
  if (!authOk(req)) return res.status(401).json({ ok: false, error: '관리 토큰이 올바르지 않습니다.' });
  res.json({ ok: true });
});
app.use('/api', requireAuth);

app.get('/api/dashboard', (_req, res) => {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE active=1 AND COALESCE(participation_status,'참여') NOT IN ('미참여','참여불가','취소')`).get().n;
  const arrived = db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE active=1 AND arrived=1`).get().n;
  const seated = db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE active=1 AND COALESCE(seat,'')<>''`).get().n;
  const seatsTotal = db.prepare(`SELECT COUNT(*) AS n FROM seats WHERE enabled=1`).get().n;
  const freeAuto = db.prepare(`SELECT COUNT(*) AS n FROM seats WHERE enabled=1 AND auto_assignable=1`).get().n -
    db.prepare(`SELECT COUNT(DISTINCT seat) AS n FROM participants WHERE active=1 AND COALESCE(seat,'')<>''`).get().n;
  res.json({ ok: true, stats: { total, arrived, waiting: Math.max(0,total-arrived), seated, seatsTotal, freeAuto: Math.max(0,freeAuto) }, solapiConfigured: solapiConfigured() });
});

app.get('/api/participants', (req, res) => {
  const term = clean(req.query.q, 100);
  const arrived = req.query.arrived;
  let sql = 'SELECT * FROM participants WHERE 1=1';
  const params = [];
  if (term) {
    sql += ` AND (name LIKE ? OR phone LIKE ? OR organization LIKE ? OR qr_code LIKE ? OR seat LIKE ? OR CAST(reception_no AS TEXT) LIKE ?)`;
    const like = `%${term}%`;
    params.push(like, like, like, like, like, like);
  }
  if (arrived === '1' || arrived === '0') { sql += ' AND arrived=?'; params.push(Number(arrived)); }
  sql += ' ORDER BY COALESCE(reception_no,999999), id LIMIT 500';
  const rows = db.prepare(sql).all(...params).map(publicParticipant);
  res.json({ ok: true, participants: rows });
});

app.get('/api/participants/:id', (req, res) => {
  const p = participantById(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: '참가자를 찾지 못했습니다.' });
  res.json({ ok: true, participant: publicParticipant(p) });
});

app.post('/api/checkin', (req, res) => {
  try {
    const code = extractQr(req.body.code || req.body.qr || '');
    const station = clean(req.body.station || '현장접수', 80);
    if (!code) return res.status(400).json({ ok: false, error: 'QR 값이 비어 있습니다.' });
    const result = runTx(() => {
      let p = participantByQr(code);
      if (!p) throw new Error('등록되지 않은 QR코드입니다.');
      if (isExcluded(p)) throw new Error('참여불가/미참여 처리된 참가자입니다.');
      if (p.arrived) {
        addLog('중복 스캔', p, station, `최초 도착 ${p.checkin_at || ''}`);
        return { participant: publicParticipant(p), already: true, seatAssignedNow: false };
      }
      let seat = normalizeSeat(p.seat);
      let seatAssignedNow = false;
      if (!seat) {
        seat = pickSeat(p, p.id);
        if (!seat) throw new Error('자동 배정 가능한 좌석이 없습니다. 관리자에서 좌석을 확인해주세요.');
        seatAssignedNow = true;
      }
      const t = nowIso();
      db.prepare(`UPDATE participants SET seat=?,arrived=1,checkin_at=?,updated_at=? WHERE id=?`).run(seat, t, t, p.id);
      p = participantById(p.id);
      addLog('도착 처리', p, station, seatAssignedNow ? `현장 자동좌석 배정 ${seat}` : `기존 배정 좌석 유지 ${seat}`);
      return { participant: publicParticipant(p), already: false, seatAssignedNow };
    });
    if (!result.already) queueSms(result.participant, 'CHECKIN', checkinText(result.participant));
    res.json({ ok: true, ...result, smsQueued: !result.already && solapiConfigured() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.post('/api/participants/:id/undo-checkin', (req, res) => {
  try {
    const station = clean(req.body.station || '관리자', 80);
    const p = runTx(() => {
      const before = participantById(req.params.id);
      if (!before) throw new Error('참가자를 찾지 못했습니다.');
      const t = nowIso();
      db.prepare('UPDATE participants SET arrived=0,checkin_at=NULL,updated_at=? WHERE id=?').run(t, before.id);
      const after = participantById(before.id);
      addLog('도착 취소', after, station, `기존 좌석 ${before.seat || '없음'}`);
      return after;
    });
    res.json({ ok: true, participant: publicParticipant(p) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.post('/api/participants/:id/seat', (req, res) => {
  try {
    const station = clean(req.body.station || '관리자', 80);
    const newSeat = normalizeSeat(req.body.seat);
    if (!newSeat) return res.status(400).json({ ok: false, error: '좌석번호를 입력하세요.' });
    const result = runTx(() => {
      const before = participantById(req.params.id);
      if (!before) throw new Error('참가자를 찾지 못했습니다.');
      if (!seatExistsAndFree(newSeat, before.id)) throw new Error('사용할 수 없거나 이미 배정된 좌석입니다.');
      const oldSeat = before.seat || '';
      db.prepare('UPDATE participants SET seat=?,updated_at=? WHERE id=?').run(newSeat, nowIso(), before.id);
      const after = participantById(before.id);
      addLog('좌석 변경', after, station, `${oldSeat || '미배정'} → ${newSeat}`);
      return { before, after };
    });
    if (result.after.arrived) queueSms(result.after, 'SEAT_CHANGE', seatChangeText(result.after));
    res.json({ ok: true, participant: publicParticipant(result.after), smsQueued: !!result.after.arrived && solapiConfigured() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.post('/api/participants/:id/auto-seat', (req, res) => {
  try {
    const station = clean(req.body.station || '관리자', 80);
    const p = runTx(() => {
      const before = participantById(req.params.id);
      if (!before) throw new Error('참가자를 찾지 못했습니다.');
      const seat = pickSeat(before, before.id);
      if (!seat) throw new Error('자동 배정 가능한 좌석이 없습니다.');
      db.prepare('UPDATE participants SET seat=?,updated_at=? WHERE id=?').run(seat, nowIso(), before.id);
      const after = participantById(before.id);
      addLog('좌석 자동배정', after, station, `${before.seat || '미배정'} → ${seat}`);
      return after;
    });
    if (p.arrived) queueSms(p, 'SEAT_CHANGE', seatChangeText(p));
    res.json({ ok: true, participant: publicParticipant(p) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.post('/api/participants', (req, res) => {
  try {
    const body = req.body || {};
    const name = clean(body.name, 60);
    if (!name) return res.status(400).json({ ok: false, error: '이름을 입력하세요.' });
    const station = clean(body.station || '현장 신규등록', 80);
    const created = runTx(() => {
      const no = nextReceptionNo();
      const qr = makeQr(no);
      let seat = normalizeSeat(body.seat);
      const wheelchair = boolVal(body.wheelchair_user);
      const arrived = body.arrived === false ? 0 : 1;
      const draft = { wheelchair_user: wheelchair };
      if (seat && !seatExistsAndFree(seat)) throw new Error('선택한 좌석을 사용할 수 없습니다.');
      if (!seat && arrived) seat = pickSeat(draft) || '';
      if (arrived && !seat) throw new Error('자동 배정 가능한 좌석이 없습니다.');
      const t = nowIso();
      const info = db.prepare(`INSERT INTO participants(
        reception_no,qr_code,name,phone,seat,application_type,note,arrived,checkin_at,registered_at,updated_at,active,organization,party_size,wheelchair_user,wheelchair_count,uses_center,disabled_person,companion_group,participation_status,source,imported_seat,imported_arrived,imported_checkin_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        no, qr, name, fmtPhone(body.phone), seat, '현장등록', clean(body.note,500), arrived, arrived ? t : null, t, t, 1,
        clean(body.organization,100), 1, wheelchair, wheelchair ? 1 : 0, boolVal(body.uses_center), boolVal(body.disabled_person), '', '참여', 'v2-onsite', '', 0, null
      );
      const p = participantById(info.lastInsertRowid);
      addLog('현장 신규등록', p, station, arrived ? `등록 및 도착처리 / ${seat}` : '등록만');
      return p;
    });
    if (created.arrived) queueSms(created, 'CHECKIN', checkinText(created));
    res.json({ ok: true, participant: publicParticipant(created), smsQueued: !!created.arrived && solapiConfigured() });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.put('/api/participants/:id', (req, res) => {
  try {
    const before = participantById(req.params.id);
    if (!before) return res.status(404).json({ ok: false, error: '참가자를 찾지 못했습니다.' });
    const name = clean(req.body.name ?? before.name, 60);
    if (!name) return res.status(400).json({ ok: false, error: '이름을 입력하세요.' });
    const station = clean(req.body.station || '관리자', 80);
    const p = runTx(() => {
      db.prepare(`UPDATE participants SET name=?,phone=?,organization=?,note=?,active=?,wheelchair_user=?,wheelchair_count=?,uses_center=?,disabled_person=?,participation_status=?,updated_at=? WHERE id=?`).run(
        name, fmtPhone(req.body.phone ?? before.phone), clean(req.body.organization ?? before.organization,100), clean(req.body.note ?? before.note,500),
        req.body.active === undefined ? before.active : boolVal(req.body.active),
        req.body.wheelchair_user === undefined ? before.wheelchair_user : boolVal(req.body.wheelchair_user),
        req.body.wheelchair_user === undefined ? before.wheelchair_count : (boolVal(req.body.wheelchair_user) ? 1 : 0),
        req.body.uses_center === undefined ? before.uses_center : boolVal(req.body.uses_center),
        req.body.disabled_person === undefined ? before.disabled_person : boolVal(req.body.disabled_person),
        clean(req.body.participation_status ?? before.participation_status,30), nowIso(), before.id
      );
      const after = participantById(before.id);
      addLog('참가자 수정', after, station, '기본정보 수정');
      return after;
    });
    res.json({ ok: true, participant: publicParticipant(p) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message || String(e) }); }
});

app.get('/api/seats', (_req, res) => {
  const occupants = new Map();
  for (const p of db.prepare(`SELECT id,name,qr_code,seat,arrived FROM participants WHERE active=1 AND COALESCE(seat,'')<>''`).all()) {
    for (const s of parseSeatList(p.seat)) occupants.set(s, { id: p.id, name: p.name, qr_code: p.qr_code, arrived: !!p.arrived });
  }
  const seats = db.prepare('SELECT * FROM seats ORDER BY sort_order, seat_code').all().map(s => ({ ...s, auto_assignable: !!s.auto_assignable, enabled: !!s.enabled, wheelchair_eligible: !!s.wheelchair_eligible, occupant: occupants.get(s.seat_code) || null }));
  res.json({ ok: true, seats });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const rows = db.prepare(`SELECT * FROM logs ORDER BY id DESC LIMIT ?`).all(limit);
  res.json({ ok: true, logs: rows });
});
app.get('/api/sms-logs', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  res.json({ ok: true, logs: db.prepare(`SELECT * FROM sms_logs ORDER BY id DESC LIMIT ?`).all(limit) });
});

app.post('/api/sms/test', async (req, res) => {
  if (!solapiConfigured()) return res.status(400).json({ ok: false, error: 'SOLAPI 환경변수가 아직 설정되지 않았습니다.' });
  const phone = fmtPhone(req.body.phone);
  const p = { qr_code: 'TEST', phone };
  const result = await sendSms({ p, kind: 'TEST', text: clean(req.body.text || '[남양주시장애인복지관] SOLAPI 연동 테스트입니다.', 1000) });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/import-excel', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ ok: false, error: '엑셀 파일을 선택하세요.' });
  const mode = String(req.body.mode || 'merge');
  try {
    const wb = XLSX.readFile(file.path, { cellDates: true });
    const pSheet = wb.Sheets['참가자'];
    const sSheet = wb.Sheets['좌석설정'];
    const setSheet = wb.Sheets['설정'];
    const logSheet = wb.Sheets['접수로그'];
    if (!pSheet) throw new Error('엑셀에 "참가자" 시트가 없습니다.');
    if (!sSheet) throw new Error('엑셀에 "좌석설정" 시트가 없습니다.');
    const pRows = XLSX.utils.sheet_to_json(pSheet, { defval: null, raw: true });
    const sRows = XLSX.utils.sheet_to_json(sSheet, { defval: null, raw: true });
    const setRows = setSheet ? XLSX.utils.sheet_to_json(setSheet, { defval: null, raw: true }) : [];
    const lRows = logSheet ? XLSX.utils.sheet_to_json(logSheet, { defval: null, raw: true }) : [];

    const result = runTx(() => {
      if (mode === 'reset') {
        db.exec('DELETE FROM sms_logs; DELETE FROM logs; DELETE FROM participants; DELETE FROM seats; DELETE FROM settings;');
      }
      const seatStmt = db.prepare(`INSERT INTO seats(seat_code,row_label,side,seat_no,category,auto_assignable,enabled,wheelchair_eligible,note,sort_order)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(seat_code) DO UPDATE SET row_label=excluded.row_label,side=excluded.side,seat_no=excluded.seat_no,category=excluded.category,auto_assignable=excluded.auto_assignable,enabled=excluded.enabled,wheelchair_eligible=excluded.wheelchair_eligible,note=excluded.note,sort_order=excluded.sort_order`);
      let seatCount = 0;
      for (const r of sRows) {
        const code = normalizeSeat(r['좌석코드']);
        if (!code) continue;
        seatStmt.run(code, clean(r['행'],10), clean(r['측면'],10), Number(r['번호'] || 0), clean(r['구역'],80), boolVal(r['일반자동배정']), boolVal(r['사용여부']), boolVal(r['휠체어자동배정']), clean(r['메모'],500), Number(r['정렬순서'] || 999999));
        seatCount++;
      }
      const insertP = db.prepare(`INSERT INTO participants(reception_no,qr_code,name,phone,seat,application_type,note,arrived,checkin_at,ticket_printed_at,registered_at,updated_at,active,organization,party_size,wheelchair_user,wheelchair_count,uses_center,disabled_person,companion_group,participation_status,source,imported_seat,imported_arrived,imported_checkin_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const updateP = db.prepare(`UPDATE participants SET reception_no=?,name=?,phone=?,seat=?,application_type=?,note=?,arrived=?,checkin_at=?,ticket_printed_at=?,registered_at=?,updated_at=?,active=?,organization=?,party_size=?,wheelchair_user=?,wheelchair_count=?,uses_center=?,disabled_person=?,companion_group=?,participation_status=?,source='excel-merge',imported_seat=?,imported_arrived=?,imported_checkin_at=? WHERE qr_code=?`);
      const updatePreserveRuntime = db.prepare(`UPDATE participants SET reception_no=?,name=?,phone=?,application_type=?,note=?,active=?,organization=?,party_size=?,wheelchair_user=?,wheelchair_count=?,uses_center=?,disabled_person=?,companion_group=?,participation_status=?,source='excel-merge',imported_seat=?,imported_arrived=?,imported_checkin_at=? WHERE qr_code=?`);
      let added = 0, updated = 0, skipped = 0;
      for (const r of pRows) {
        const qr = clean(r['QR고유코드'],200).toUpperCase();
        const name = clean(r['이름'],60);
        if (!qr || !name) { skipped++; continue; }
        const incoming = {
          reception_no: Number(r['접수번호'] || 0) || null,
          qr_code: qr,
          name,
          phone: fmtPhone(r['연락처']),
          seat: normalizeSeat(r['좌석번호']),
          application_type: clean(r['신청유형'],30) || '개인신청',
          note: clean(r['비고'],500),
          arrived: boolVal(r['도착여부']),
          checkin_at: excelDateToIso(r['도착시각']),
          ticket_printed_at: excelDateToIso(r['티켓출력시각']),
          registered_at: excelDateToIso(r['등록시각']),
          updated_at: excelDateToIso(r['수정시각']) || nowIso(),
          active: r['사용여부'] === null ? 1 : boolVal(r['사용여부']),
          organization: clean(r['소속기관'],100),
          party_size: Math.max(1, Number(r['신청인원(개인=1)'] || 1)),
          wheelchair_user: boolVal(r['휠체어이용여부']),
          wheelchair_count: Number(r['휠체어이용인원(개인신청 0·1)'] || 0),
          uses_center: boolVal(r['복지관이용여부']),
          disabled_person: boolVal(r['장애인당사자여부']),
          companion_group: clean(r['동반그룹'],80),
          participation_status: clean(r['참여상태'],30) || '참여'
        };
        const old = participantByQr(qr);
        if (!old) {
          insertP.run(incoming.reception_no,qr,name,incoming.phone,incoming.seat,incoming.application_type,incoming.note,incoming.arrived,incoming.checkin_at,incoming.ticket_printed_at,incoming.registered_at,incoming.updated_at,incoming.active,incoming.organization,incoming.party_size,incoming.wheelchair_user,incoming.wheelchair_count,incoming.uses_center,incoming.disabled_person,incoming.companion_group,incoming.participation_status,'excel',incoming.seat,incoming.arrived,incoming.checkin_at);
          added++;
        } else if (mode === 'merge' && old.arrived) {
          updatePreserveRuntime.run(incoming.reception_no,name,incoming.phone,incoming.application_type,incoming.note,incoming.active,incoming.organization,incoming.party_size,incoming.wheelchair_user,incoming.wheelchair_count,incoming.uses_center,incoming.disabled_person,incoming.companion_group,incoming.participation_status,incoming.seat,incoming.arrived,incoming.checkin_at,qr);
          updated++;
        } else {
          updateP.run(incoming.reception_no,name,incoming.phone,incoming.seat,incoming.application_type,incoming.note,incoming.arrived,incoming.checkin_at,incoming.ticket_printed_at,incoming.registered_at,incoming.updated_at,incoming.active,incoming.organization,incoming.party_size,incoming.wheelchair_user,incoming.wheelchair_count,incoming.uses_center,incoming.disabled_person,incoming.companion_group,incoming.participation_status,incoming.seat,incoming.arrived,incoming.checkin_at,qr);
          updated++;
        }
      }
      const settingStmt = db.prepare(`INSERT INTO settings(key,value,description) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,description=excluded.description`);
      for (const r of setRows) {
        const key = clean(r['설정키'],100); if (!key) continue;
        settingStmt.run(key, clean(r['값'],1000), clean(r['설명'],500));
      }
      let importedLogs = 0;
      if (mode === 'reset') {
        const logStmt = db.prepare(`INSERT INTO logs(processed_at,action,qr_code,reception_no,name,seat,station,note) VALUES(?,?,?,?,?,?,?,?)`);
        for (const r of lRows) {
          if (!r['작업']) continue;
          logStmt.run(excelDateToIso(r['처리시각']) || nowIso(), clean(r['작업'],100), clean(r['QR고유코드'],200), Number(r['접수번호'] || 0) || null, clean(r['이름'],60), normalizeSeat(r['좌석번호']), clean(r['접수대'],80), clean(r['비고'],1000));
          importedLogs++;
        }
      }
      addLog('엑셀 명단 가져오기', {}, 'V2 관리자', `${mode} / 신규 ${added}, 업데이트 ${updated}, 좌석 ${seatCount}`);
      return { added, updated, skipped, seatCount, importedLogs };
    });
    res.json({ ok: true, mode, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  } finally {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
});

app.get('/api/export.xlsx', (req, res) => {
  const pRows = db.prepare('SELECT * FROM participants ORDER BY COALESCE(reception_no,999999),id').all();
  const sRows = db.prepare('SELECT * FROM seats ORDER BY sort_order,seat_code').all();
  const lRows = db.prepare('SELECT * FROM logs ORDER BY id').all();
  const smsRows = db.prepare('SELECT * FROM sms_logs ORDER BY id').all();
  const setRows = db.prepare('SELECT * FROM settings ORDER BY key').all();
  const wb = XLSX.utils.book_new();
  const participantHeaders = ['접수번호','QR고유코드','이름','연락처','좌석번호','신청유형','비고','도착여부','도착시각','티켓출력시각','등록시각','수정시각','사용여부','소속기관','신청인원(개인=1)','휠체어이용여부','휠체어이용인원(개인신청 0·1)','복지관이용여부','장애인당사자여부','동반그룹','참여상태','V2소스'];
  const participantData = [participantHeaders, ...pRows.map(p => [p.reception_no,p.qr_code,p.name,p.phone,p.seat,p.application_type,p.note,!!p.arrived,p.checkin_at,p.ticket_printed_at,p.registered_at,p.updated_at,!!p.active,p.organization,p.party_size,!!p.wheelchair_user,p.wheelchair_count,!!p.uses_center,!!p.disabled_person,p.companion_group,p.participation_status,p.source])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(participantData), '참가자');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sRows.map(s => ({'좌석코드':s.seat_code,'행':s.row_label,'측면':s.side,'번호':s.seat_no,'구역':s.category,'일반자동배정':!!s.auto_assignable,'사용여부':!!s.enabled,'휠체어자동배정':!!s.wheelchair_eligible,'메모':s.note,'정렬순서':s.sort_order}))), '좌석설정');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lRows.map(x => ({'처리시각':x.processed_at,'작업':x.action,'QR고유코드':x.qr_code,'접수번호':x.reception_no,'이름':x.name,'좌석번호':x.seat,'접수대':x.station,'비고':x.note}))), '접수로그');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(smsRows.map(x => ({'처리시각':x.created_at,'QR고유코드':x.qr_code,'연락처':x.phone,'유형':x.kind,'문자내용':x.text,'성공':!!x.success,'응답':x.response,'오류':x.error}))), '문자로그');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(setRows.map(x => ({'설정키':x.key,'값':x.value,'설명':x.description}))), '설정');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const stamp = new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`20주년_V2_백업_${stamp}.xlsx`)}`);
  res.send(buf);
});

app.post('/api/reset-runtime', (req, res) => {
  if (String(req.body.confirm || '') !== 'RESET') return res.status(400).json({ ok: false, error: 'confirm 값이 RESET이어야 합니다.' });
  runTx(() => {
    db.exec(`DELETE FROM participants WHERE source='v2-onsite'; UPDATE participants SET seat=COALESCE(imported_seat,''),arrived=COALESCE(imported_arrived,0),checkin_at=imported_checkin_at WHERE source<>'v2-onsite'; DELETE FROM logs; DELETE FROM sms_logs;`);
    addLog('운영상태 초기화', {}, '관리자', '도착/로그/문자로그 초기화');
  });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ ok: false, error: err.message || '요청 처리 중 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`nyjwel20th-admin-v2 running on port ${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`SOLAPI: ${solapiConfigured() ? 'configured' : 'not configured'}`);
});
