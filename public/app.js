'use strict';

const TOKEN_KEY = 'nyj20_v2_token';
let token = localStorage.getItem(TOKEN_KEY) || '';

const $ = s => document.querySelector(s);
const out = value => {
  $('#output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function health() {
  const data = await api('/api/health');
  $('#serverState').textContent = '정상';
  $('#statusBadge').textContent = `연결됨 · v${data.version}`;
  $('#statusBadge').classList.add('ok');
  return data;
}

async function bootstrap() {
  const data = await api('/api/bootstrap');
  $('#participants').textContent = data.summary.participants;
  $('#checkins').textContent = data.summary.checkins;
  $('#smsPending').textContent = data.summary.smsPending;
  out(data);
}

async function refreshAll() {
  try {
    await health();
    await bootstrap();
    $('#loginOverlay').classList.add('hidden');
  } catch (e) {
    if (/로그인/.test(e.message)) {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      $('#loginOverlay').classList.remove('hidden');
    }
    out(`ERROR: ${e.message}`);
  }
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginMessage').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('#password').value })
    });
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    await refreshAll();
  } catch (e) {
    $('#loginMessage').textContent = e.message;
  }
});

$('#logoutBtn').addEventListener('click', () => {
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  $('#loginOverlay').classList.remove('hidden');
});

$('#refreshBtn').addEventListener('click', refreshAll);

$('#writeBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/test-write', {
      method: 'POST',
      body: JSON.stringify({ message: `테스트 저장 ${new Date().toLocaleString('ko-KR')}` })
    });
    out(data);
  } catch (e) { out(`ERROR: ${e.message}`); }
});

$('#backupBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/backup', { method: 'POST', body: '{}' });
    out(data);
  } catch (e) { out(`ERROR: ${e.message}`); }
});

$('#downloadBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/backup/download', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nyjwel20th-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { out(`ERROR: ${e.message}`); }
});

refreshAll();
