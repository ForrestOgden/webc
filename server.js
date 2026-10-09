'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const GENDERS = new Set(['man', 'woman', 'nonbinary', 'undisclosed']);
const GENDER_FILTERS = new Set(['any', ...GENDERS].filter(v => v !== 'undisclosed'));
const ADMIN_HASH = process.env.PRIVATE_FILTER_PASSWORD_HASH || '';
const PILOT_CODE_HASH = process.env.ROAM_PREVIEW_CODE ? crypto.createHash('sha256').update(process.env.ROAM_PREVIEW_CODE).digest() : null;
const previewSessions = new Map();
const previewAttempts = new Map();
const PREVIEW_TTL = 7 * 24 * 60 * 60 * 1000;
function previewAllowed(req) {
  if (!PILOT_CODE_HASH) return true;
  const token = getCookie(req, 'roam_preview');
  const until = previewSessions.get(token);
  if (!until) return false;
  if (until <= Date.now()) { previewSessions.delete(token); return false; }
  return true;
}
function previewCookie(value, req) {
  const secure = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').startsWith('https://') || req.socket.encrypted;
  return `roam_preview=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${value ? 604800 : 0}${secure ? '; Secure' : ''}`;
}
function previewCodeValid(value) {
  if (typeof value !== 'string' || value.length > 256 || !PILOT_CODE_HASH) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(), PILOT_CODE_HASH);
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  const trusted = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://${req.headers.host}`;
  return req.headers.origin === trusted;
}

const adminSessions = new Map();
const authAttempts = new Map();
const ADMIN_TTL = 12 * 60 * 60 * 1000;
const REGIONS = new Set(['any', 'north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania', 'middle-east']);
const REASONS = new Set(['harassment', 'nudity', 'underage', 'hate', 'spam', 'other']);
const MAX_FRAME = 32 * 1024;
const MAX_PEERS_PER_IP = Number(process.env.MAX_PEERS_PER_IP || 8);
const REPORTS_FILE = process.env.REPORTS_FILE || path.join(__dirname, 'reports.jsonl');
const peers = new Map();
const queue = new Set();
const connectionsPerIp = new Map();
function getCookie(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  const entry = cookies.map(x => x.trim()).find(x => x.startsWith(name + '='));
  return entry ? entry.slice(name.length + 1) : '';
}
function sessionValid(token) {
  const until = adminSessions.get(token);
  if (!until) return false;
  if (until <= Date.now()) { adminSessions.delete(token); return false; }
  return true;
}
function isAdmin(peer) { return sessionValid(peer.adminToken); }
function verifyAdminPassword(password) {
  if (!ADMIN_HASH || typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = ADMIN_HASH.split('$');
  if (!/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(expected || '')) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function readJson(req, maxSize = 1024) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
      if (text.length > maxSize) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function json(res, status, result, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(result));
}
function adminCookie(value, request) {
  const secure = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').startsWith('https://') || !!request.socket.encrypted;
  return `roam_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? 43200 : 0}${secure ? '; Secure' : ''}`;
}


function publicStats() {
  return { online: peers.size, searching: queue.size, connected: [...peers.values()].filter(p => !!p.partner).length / 2 };
}
function sanitizeRegion(value, fallback) { return typeof value === 'string' && REGIONS.has(value) ? value : fallback; }
function send(peer, type, data = {}) {
  if (!peer || peer.closed || peer.socket.destroyed) return;
  try { peer.write(JSON.stringify({ type, ...data })); } catch { disconnect(peer); }
}
function rateLimited(peer, type, maximum, interval) {
  const now = Date.now();
  const key = type;
  const value = peer.limits.get(key) || { count: 0, from: now };
  if (now - value.from >= interval) { value.count = 0; value.from = now; }
  value.count++;
  peer.limits.set(key, value);
  return value.count > maximum;
}
function broadcastStats() {
  const stats = publicStats();
  for (const peer of peers.values()) send(peer, 'stats', stats);
}
function compatible(a, b) {
  if (a === b || a.partner || b.partner || !a.searching || !b.searching) return false;
  if (a.target !== 'any' && a.target !== b.region) return false;
  if (isAdmin(a) && a.genderTarget !== 'any' && a.genderTarget !== b.gender) return false;
  if (isAdmin(b) && b.genderTarget !== 'any' && b.genderTarget !== a.gender) return false;
  if (b.target !== 'any' && b.target !== a.region) return false;
  if (a.blocked.has(b.session) || b.blocked.has(a.session)) return false;
  if ((a.recent.get(b.session) || 0) > Date.now() || (b.recent.get(a.session) || 0) > Date.now()) return false;
  return true;
}
function matchmake() {
  const waiting = [...queue].map(id => peers.get(id)).filter(Boolean);
  for (let i = 0; i < waiting.length; i++) {
    const a = waiting[i];
    if (!a.searching || a.partner) continue;
    // A small preference for longer-waiting users; queue preserves arrival order.
    const b = waiting.find(p => compatible(a, p));
    if (!b) continue;
    queue.delete(a.id); queue.delete(b.id);
    a.searching = false; b.searching = false;
    a.partner = b.id; b.partner = a.id;
    const matchId = crypto.randomUUID();
    a.matchId = matchId; b.matchId = matchId;
    send(a, 'matched', { matchId, initiator: true, region: b.region });
    send(b, 'matched', { matchId, initiator: false, region: a.region });
  }
  broadcastStats();
}
function detach(peer, reason = 'left') {
  queue.delete(peer.id);
  peer.searching = false;
  if (!peer.partner) return null;
  const other = peers.get(peer.partner);
  peer.partner = null;
  peer.matchId = null;
  if (other && other.partner === peer.id) {
    other.partner = null;
    other.matchId = null;
    send(other, 'partner-left', { reason });
    return other;
  }
  return null;
}
function enqueue(peer) {
  if (peer.closed || peer.partner) return;
  peer.searching = true;
  queue.add(peer.id);
  send(peer, 'searching', { target: peer.target });
  matchmake();
}
function noteRecent(a, b) {
  const until = Date.now() + 3 * 60 * 1000;
  a.recent.set(b.session, until);
  b.recent.set(a.session, until);
}
function report(peer, body) {
  if (!peer.partner || rateLimited(peer, 'report', 4, 60_000)) return;
  const other = peers.get(peer.partner);
  if (!other || !REASONS.has(body.reason)) return;
  // Local, append-only moderation inbox. No media is captured or recorded.
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(),
    reporterSession: peer.session, reportedSession: other.session,
    reason: body.reason, detail: String(body.detail || '').slice(0, 300).replace(/[\r\n]/g, ' ') };
  fs.appendFile(REPORTS_FILE, JSON.stringify(record) + '\n', err => {
    if (err) {
      console.error('Could not save moderation report:', err.message);
      send(peer, 'error', { message: 'Report could not be saved. Please contact the site operator.' });
    } else send(peer, 'report-received');
  });
  peer.blocked.add(other.session);
  noteRecent(peer, other);
  const orphan = detach(peer, 'reported');
  enqueue(peer);
  if (orphan) enqueue(orphan);
}
function onMessage(peer, text) {
  if (typeof text !== 'string' || text.length > MAX_FRAME || rateLimited(peer, 'messages', 100, 10_000)) {
    return send(peer, 'error', { message: 'You are sending requests too quickly.' });
  }
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'hello': {
      if (peer.ready) return;
      if (msg.adult !== true) { send(peer, 'error', { message: 'You must confirm you are 18 or older.' }); return; }
      peer.session = typeof msg.session === 'string' && /^[a-f0-9-]{36}$/.test(msg.session) ? msg.session : crypto.randomUUID();
      peer.region = sanitizeRegion(msg.region, 'north-america');
      if (peer.region === 'any') peer.region = 'north-america';
      peer.target = sanitizeRegion(msg.target, 'any');
      peer.gender = GENDERS.has(msg.gender) ? msg.gender : 'undisclosed';
      peer.ready = true;
      send(peer, 'ready', { session: peer.session });
      broadcastStats();
      break;
    }
    case 'find': {
      if (!peer.ready || peer.searching || peer.partner || rateLimited(peer, 'find', 20, 60_000)) return;
      peer.region = sanitizeRegion(msg.region, peer.region);
      if (peer.region === 'any') peer.region = 'north-america';
      peer.target = sanitizeRegion(msg.target, peer.target);
      peer.gender = GENDERS.has(msg.gender) ? msg.gender : peer.gender;
      const chosenFilter = GENDER_FILTERS.has(msg.genderTarget) ? msg.genderTarget : 'any';
      if (chosenFilter !== 'any' && !isAdmin(peer)) {
        return send(peer, 'error', { message: 'Private gender selection requires your password.' });
      }
      peer.genderTarget = isAdmin(peer) ? chosenFilter : 'any';
      enqueue(peer);
      break;
    }
    case 'skip': {
      if (!peer.ready || rateLimited(peer, 'skip', 20, 60_000)) return;
      if (peer.partner) {
        const other = peers.get(peer.partner);
        if (other) noteRecent(peer, other);
        const orphan = detach(peer, 'skipped');
        enqueue(peer);
        if (orphan) enqueue(orphan);
      } else if (peer.searching) {
        send(peer, 'searching', { target: peer.target });
      } else enqueue(peer);
      break;
    }
    case 'leave': {
      if (!peer.ready) return;
      const orphan = detach(peer, 'left');
      if (orphan) enqueue(orphan);
      matchmake();
      break;
    }
    case 'signal': {
      if (!peer.ready || !peer.partner || msg.matchId !== peer.matchId || rateLimited(peer, 'signal', 200, 10_000)) return;
      const other = peers.get(peer.partner);
      if (!other || other.matchId !== peer.matchId) return;
      const allowed = ['offer', 'answer', 'candidate'];
      if (!allowed.includes(msg.kind)) return;
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 16000) return;
      send(other, 'signal', { matchId: peer.matchId, kind: msg.kind, payload });
      break;
    }
    case 'chat': {
      if (!peer.partner || rateLimited(peer, 'chat', 12, 10_000)) return;
      if (typeof msg.text !== 'string') return;
      const content = msg.text.trim().slice(0, 500);
      if (!content) return;
      const other = peers.get(peer.partner);
      if (other) send(other, 'chat', { text: content, matchId: peer.matchId });
      break;
    }
    case 'report': report(peer, msg); break;
    case 'block': {
      if (!peer.partner) return;
      const other = peers.get(peer.partner);
      if (other) { peer.blocked.add(other.session); noteRecent(peer, other); }
      const orphan = detach(peer, 'blocked');
      enqueue(peer);
      if (orphan) enqueue(orphan);
      break;
    }
    default: break;
  }
}

function disconnect(peer) {
  if (peer.closed) return;
  peer.closed = true;
  const orphan = detach(peer, 'disconnected');
  peers.delete(peer.id);
  const count = (connectionsPerIp.get(peer.ip) || 1) - 1;
  if (count > 0) connectionsPerIp.set(peer.ip, count); else connectionsPerIp.delete(peer.ip);
  try { peer.socket.destroy(); } catch {}
  if (orphan) enqueue(orphan);
  matchmake();
}

// Minimal RFC 6455 WebSocket connection. All browser frames are masked; 16 KiB message max.
class SocketPeer {
  constructor(socket, request) {
    this.id = crypto.randomUUID();
    this.ip = request.socket.remoteAddress || 'unknown';
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragment = null;
    this.closed = false; this.ready = false; this.searching = false;
    this.partner = null; this.matchId = null;
    this.region = 'north-america'; this.target = 'any'; this.gender = 'undisclosed'; this.genderTarget = 'any';
    this.adminToken = getCookie(request, 'roam_admin');
    this.limits = new Map(); this.recent = new Map(); this.blocked = new Set();
    this.lastPong = Date.now();
    socket.on('data', chunk => this.consume(chunk));
    socket.on('close', () => disconnect(this));
    socket.on('error', () => disconnect(this));
  }
  write(text) { this.frame(1, Buffer.from(text, 'utf8')); }
  frame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    let header;
    if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
    else header = Buffer.from([0x80 | opcode, 126, (payload.length >> 8) & 255, payload.length & 255]);
    this.socket.write(Buffer.concat([header, payload]));
  }
  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_FRAME * 3) return disconnect(this);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0]; const second = this.buffer[1];
      const fin = Boolean(first & 128); const opcode = first & 15;
      if ((first & 0x70) !== 0 || !(second & 128)) return disconnect(this);
      let length = second & 127; let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return disconnect(this);
        length = Number(big); offset = 10;
      }
      if (length > MAX_FRAME || this.buffer.length < offset + 4 + length) return length > MAX_FRAME ? disconnect(this) : undefined;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(offset + 4 + length);
      if (opcode >= 8 && (!fin || length > 125)) return disconnect(this);
      if (opcode === 8) { this.frame(8, Buffer.alloc(0)); return disconnect(this); }
      if (opcode === 9) { this.frame(10, payload); continue; }
      if (opcode === 10) { this.lastPong = Date.now(); continue; }
      if (opcode === 1 && fin) { onMessage(this, payload.toString('utf8')); continue; }
      if (opcode === 1 && !fin && !this.fragment) { this.fragment = payload; continue; }
      if (opcode === 0 && this.fragment) {
        this.fragment = Buffer.concat([this.fragment, payload]);
        if (this.fragment.length > MAX_FRAME) return disconnect(this);
        if (fin) { onMessage(this, this.fragment.toString('utf8')); this.fragment = null; }
        continue;
      }
      return disconnect(this);
    }
  }
}

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/social-preview.jpg': ['social-preview.jpg', 'image/jpeg'],
  '/legal.css': ['legal.css', 'text/css; charset=utf-8'],
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
  '/terms': ['terms.html', 'text/html; charset=utf-8'],
  '/rules': ['rules.html', 'text/html; charset=utf-8']
};
function getSiteOrigin(req) {
  // PUBLIC_ORIGIN wins so hostile Host headers cannot poison canonical SEO URLs.
  const configured = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin;
    } catch { /* fall through to local development origin */ }
  }
  const candidate = String(req.headers.host || `localhost:${PORT}`);
  const host = /^[a-z0-9.:-]{1,254}$/i.test(candidate) ? candidate : `localhost:${PORT}`;
  const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}
const server = http.createServer((req, res) => {
  const route = (req.url || '').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  if (PILOT_CODE_HASH) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (PILOT_CODE_HASH && route === '/api/preview/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, {error: 'Origin rejected'});
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = previewAttempts.get(ip) || {count: 0, since: now};
    if (now - attempt.since > 15 * 60_000) {attempt.count = 0; attempt.since = now;}
    if (attempt.count >= 8) return json(res, 429, {error: 'Too many attempts. Try again in 15 minutes.'});
    readJson(req).then(body => {
      if (!previewCodeValid(body.code)) {
        attempt.count++; previewAttempts.set(ip, attempt);
        return json(res, 401, {error: 'Invalid preview code'});
      }
      previewAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      previewSessions.set(token, Date.now() + PREVIEW_TTL);
      json(res, 200, {ok: true}, {'Set-Cookie': previewCookie(token, req)});
    }).catch(() => { if (!res.headersSent) json(res, 400, {error: 'Invalid request'}); });
    return;
  }
  if (PILOT_CODE_HASH && !previewAllowed(req)) {
    if (route === '/api/health' && req.method === 'GET') return json(res, 200, {status: 'ok'});
    if (route === '/robots.txt') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('User-agent: *\nDisallow: /\n'); }
    const pilotFile = {'/':['preview.html','text/html; charset=utf-8'], '/index.html':['preview.html','text/html; charset=utf-8'], '/preview.js':['preview.js','application/javascript; charset=utf-8'], '/preview.css':['preview.css','text/css; charset=utf-8'], '/favicon.svg':['favicon.svg','image/svg+xml']}[route];
    if (pilotFile && req.method === 'GET') {
      return fs.readFile(path.join(PUBLIC, pilotFile[0]), (err, body) => {
        if (err) return json(res, 500, {error: 'Preview unavailable'});
        res.writeHead(200, {'Content-Type':pilotFile[1], 'Cache-Control':'no-store'});res.end(body);
      });
    }
    return json(res, 401, {error:'Private pilot: invitation required'});
  }
  if (route.startsWith('/api/private/')) {
    const checkOrigin = () => !req.headers.origin || req.headers.origin === (process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`) || req.headers.origin === `https://${req.headers.host}`;
    if (route === '/api/private/status' && req.method === 'GET') {
      return json(res, 200, { enabled: Boolean(ADMIN_HASH), authenticated: sessionValid(getCookie(req, 'roam_admin')) });
    }
    if (!checkOrigin()) return json(res, 403, { error: 'Origin rejected' });
    if (route === '/api/private/login' && req.method === 'POST') {
      if (!ADMIN_HASH) return json(res, 503, { error: 'Private filter password is not configured on the server.' });
      const ip = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const attempts = authAttempts.get(ip) || { count: 0, since: now };
      if (now - attempts.since > 15 * 60 * 1000) { attempts.count = 0; attempts.since = now; }
      if (attempts.count >= 6) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      readJson(req).then(body => {
        if (!verifyAdminPassword(body.password)) {
          attempts.count++;
          authAttempts.set(ip, attempts);
          return json(res, 401, { error: 'Incorrect password.' });
        }
        authAttempts.delete(ip);
        const old = getCookie(req, 'roam_admin');
        adminSessions.delete(old);
        const token = crypto.randomBytes(32).toString('hex');
        adminSessions.set(token, Date.now() + ADMIN_TTL);
        json(res, 200, { authenticated: true }, { 'Set-Cookie': adminCookie(token, req) });
      }).catch(() => { if (!res.headersSent) json(res, 400, { error: 'Invalid request' }); });
      return;
    }
    if (route === '/api/private/logout' && req.method === 'POST') {
      const old = getCookie(req, 'roam_admin');
      adminSessions.delete(old);
      for (const peer of peers.values()) if (peer.adminToken === old) peer.genderTarget = 'any';
      return json(res, 200, { authenticated: false }, { 'Set-Cookie': adminCookie('', req) });
    }
    return json(res, 404, { error: 'Unknown endpoint' });
  }
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (route === '/robots.txt') {
    const origin = getSiteOrigin(req);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /ws\n\nSitemap: ${origin}/sitemap.xml\n`);
    return;
  }
  if (route === '/sitemap.xml') {
    const origin = getSiteOrigin(req);
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/privacy</loc></url><url><loc>${origin}/terms</loc></url><url><loc>${origin}/rules</loc></url></urlset>`);
    return;
  }
  if (route === '/api/stats') return json(res, 200, publicStats());
  if (route === '/api/health') {
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify({ status: 'ok' })); return;
  }
  if (route === '/api/config') {
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URLS && process.env.TURN_SHARED_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${crypto.randomBytes(5).toString('hex')}`;
      const credential = crypto.createHmac('sha1', process.env.TURN_SHARED_SECRET).update(username).digest('base64');
      iceServers.push({ urls: process.env.TURN_URLS.split(',').map(x => x.trim()), username, credential });
    }
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({ iceServers, turnConfigured: iceServers.length > 1 })); return;
  }
  if (!FILES[route]) { res.writeHead(404).end('Not found'); return; }
  const [filename, contentType] = FILES[route];
  fs.readFile(path.join(PUBLIC, filename), (err, data) => {
    if (err) { res.writeHead(500).end('Server error'); return; }
    res.writeHead(200, {'Content-Type':contentType, 'Cache-Control':filename === 'social-preview.jpg' ? 'public, max-age=86400' : 'no-cache'});
    if (filename === 'index.html') {
      res.end(data.toString('utf8').replaceAll('__ROAM_ORIGIN__', getSiteOrigin(req)));
    } else res.end(data);
  });
});
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  const origin = req.headers.origin;
  const acceptedOrigin = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
  const permitted = !origin || origin === acceptedOrigin || origin === `https://${req.headers.host}`;
  if (pathname !== '/ws' || !previewAllowed(req) || !permitted || req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      req.headers['sec-websocket-version'] !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key'] || '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  const ip = req.socket.remoteAddress || 'unknown';
  if ((connectionsPerIp.get(ip) || 0) >= MAX_PEERS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  connectionsPerIp.set(ip, (connectionsPerIp.get(ip) || 0) + 1);
  const peer = new SocketPeer(socket, req);
  peers.set(peer.id, peer);
  send(peer, 'welcome', { id: peer.id, ...publicStats() });
  if (head?.length) peer.consume(head);
  broadcastStats();
});
const heartbeat = setInterval(() => {
  for (const [token, expiration] of adminSessions) if (expiration < Date.now()) adminSessions.delete(token);
  for (const [token, expiration] of previewSessions) if (expiration < Date.now()) previewSessions.delete(token);
  for (const [ip, attempt] of previewAttempts) if (Date.now() - attempt.since > 15 * 60_000) previewAttempts.delete(ip);
  for (const [ip, entry] of authAttempts) if (Date.now() - entry.since > 15 * 60 * 1000) authAttempts.delete(ip);
  for (const peer of peers.values()) {
    if (Date.now() - peer.lastPong > 75_000) { disconnect(peer); continue; }
    peer.frame(9, Buffer.alloc(0));
    for (const [key, value] of peer.recent) if (value < Date.now()) peer.recent.delete(key);
  }
}, 25_000);
heartbeat.unref();
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Roam listening at http://localhost:${PORT}`));
}
module.exports = { server, peers, queue, REGIONS };
