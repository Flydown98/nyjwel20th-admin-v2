'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'change-me-now');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BACKUP_INTERVAL_MS = 60 * 1000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

function defaultState() {
  return {
    meta: {
      app: 'nyjwel20th-admin-v2',
      version: '0.1.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    participants: [],
    groups: [],
    seats: [],
    checkins: [],
    gifts: [],
    raffles: [],
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
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    console.error('[STATE] load failed:', err);
    const fallback = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

let state = loadState();

function saveState() {
  state.meta.updatedAt = new Date().toISOString();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function backupNow(label = 'auto') {
  try {
    saveState();
    const d = new Date();
    const stamp = d.toISOString().replace(/[:.]/g, '-');
    const filename = `${label}_${stamp}.json`;
    const target = path.join(BACKUP_DIR, filename);
    fs.copyFileSync(STATE_FILE, target);

    const latest = path.join(BACKUP_DIR, 'latest.json');
    fs.copyFileSync(STATE_FILE, latest);

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^auto_.*\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a,b) => b.t - a.t);

    files.slice(120).forEach(x => {
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
  for (const [token, info] of sessions.entries()) {
    if (info.expiresAt <= now) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 5 * 60 * 1000).unref();

function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    return res.status(401).json({ ok:false, error:'로그인이 필요합니다.' });
  }
  req.session = session;
  next();
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public'), {
  maxAge: 0,
  etag: false
}));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'nyjwel20th-admin-v2',
    version: '0.1.0',
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    participants: state.participants.length,
    lastUpdatedAt: state.meta.updatedAt
  });
});

app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok:false, error:'비밀번호가 올바르지 않습니다.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { token, expiresAt });
  res.json({ ok:true, token, expiresAt: new Date(expiresAt).toISOString() });
});

app.get('/api/bootstrap', auth, (req, res) => {
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    summary: {
      participants: state.participants.length,
      checkins: state.checkins.length,
      groups: state.groups.length,
      seats: state.seats.length,
      smsPending: state.smsQueue.filter(x => x.status === 'pending').length
    },
    meta: state.meta
  });
});

app.post('/api/backup', auth, (req, res) => {
  const filename = backupNow('manual');
  if (!filename) return res.status(500).json({ ok:false, error:'백업 생성에 실패했습니다.' });
  res.json({ ok:true, filename });
});

app.get('/api/backup/download', auth, (req, res) => {
  backupNow('download');
  res.download(STATE_FILE, `nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`);
});

app.post('/api/test-write', auth, (req, res) => {
  state.logs.push({
    id: crypto.randomUUID(),
    type: 'test',
    message: String(req.body?.message || '현장 관리자 v2 테스트 저장'),
    at: new Date().toISOString()
  });
  if (state.logs.length > 5000) state.logs = state.logs.slice(-5000);
  saveState();
  res.json({ ok:true, logs: state.logs.length, updatedAt: state.meta.updatedAt });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok:false, error:'API를 찾을 수 없습니다.' });
  }
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ ok:false, error:'서버 내부 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log(' NYJWEL 20th Admin v2');
  console.log(` http://0.0.0.0:${PORT}`);
  console.log('==============================================');
  if (ADMIN_PASSWORD === 'change-me-now') {
    console.warn('[WARNING] ADMIN_PASSWORD 환경변수를 반드시 설정하세요.');
  }
});
