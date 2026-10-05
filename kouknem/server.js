// ═════════════ Kouknem — watch films together, anywhere ═════════════
//
// One public server:
//   /                     landing page
//   /r/<room>             a room (public/room.html + js/room.js)
//   /api/rooms            rooms: create, join, sync, chat, voting… (lib/rooms.js)
//   /copyright            Copyright, Notice-and-Action & Intermediary Services Policy
//   /copyright/report     the reporting form → POST /api/notices (lib/notices.js)
//
// There is no film catalogue and no library: a room searches TMDB for film
// metadata and finds uploads on third-party video sites only for the film it
// chose (lib/sources.js). Anything removed after a valid notice is blocked from
// rooms for good.

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const rooms = require('./lib/rooms');
const sources = require('./lib/sources');
const { handleStream } = require('./lib/stream');
const { createCache } = require('./lib/cache');
const { createNotices, validateNotice } = require('./lib/notices');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = process.env.KOUKNEM_DATA_DIR || path.join(__dirname, 'data');
// The address people reach Kouknem on (https://kouknem.cz) — used in room links.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '') || null;

const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_READ_TOKEN) {
    console.error('Chybí TMDB_READ_TOKEN — nastavte ho v .env (viz .env.example)');
    process.exit(1);
}

// Operator details shown in the policy and the footer. Until they are filled in,
// the pages show a visible "[to be completed]" marker instead of inventing them.
const todo = what => `[to be completed: ${what}]`;
const LEGAL = {
    SERVICE: 'Kouknem',
    OPERATOR: process.env.KOUKNEM_OPERATOR || todo('legal name'),
    ADDRESS: process.env.KOUKNEM_ADDRESS || todo('registered address'),
    COMPANY_ID: process.env.KOUKNEM_COMPANY_ID || todo('registration / company number, if applicable'),
    COPYRIGHT_EMAIL: process.env.KOUKNEM_COPYRIGHT_EMAIL || 'copyright@kouknem.cz',
    EFFECTIVE_DATE: process.env.KOUKNEM_POLICY_DATE || todo('effective date'),
    REPORT_URL: (PUBLIC_URL || '') + '/copyright/report',
    YEAR: String(new Date().getFullYear())
};

// ── Notice-and-action ──
const notices = createNotices(DATA_DIR);
notices.onBlockedChange(() => rooms.dropBlocked(notices.isBlocked));

// ── Video sources (TMDB metadata + third-party uploads) ──
const cache = createCache(path.join(DATA_DIR, 'tmdb-cache.json'));
sources.configure({ tmdbToken: TMDB_READ_TOKEN, cache, isBlocked: notices.isBlocked });

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy / tunnel (Caddy, nginx, Cloudflare…) req.ip must be the
// visitor's, or the rate limits would treat everyone as one person.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// No CORS, and no cross-site writes: browsers send an Origin header with cross-site
// POST/DELETE — refuse those (CORS alone doesn't stop simple form posts).
function sameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return true;
    try { return new URL(origin).host === req.get('host'); } catch { return false; }
}
app.use((req, res, next) => {
    // A room link is the invitation: never leak it in a Referer.
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    if (req.method === 'GET' || req.method === 'HEAD' || sameOrigin(req)) return next();
    res.status(403).json({ error: 'Požadavek z cizí stránky byl odmítnut' });
});
app.use(express.json({ limit: '200kb' }));

// ── Pages ──
const VIEWS = path.join(__dirname, 'views');
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const views = {};
function render(name) {
    if (!views[name] || process.env.NODE_ENV === 'development') {
        views[name] = fs.readFileSync(path.join(VIEWS, name), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in LEGAL ? escHtml(LEGAL[k]) : m));
    }
    return views[name];
}
const page = name => (req, res) => res.type('html').send(render(name));

app.get('/', page('index.html'));
app.get('/copyright', page('copyright.html'));
app.get('/copyright/report', page('report.html'));
app.get('/r/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Notices ──
const noticeLimit = (() => {
    const hits = new Map();
    return key => {
        const t = Date.now();
        const h = (hits.get(key) || []).filter(at => t - at < 60 * 60 * 1000);
        if (h.length >= 10) return false;
        h.push(t);
        hits.set(key, h);
        if (hits.size > 10000) hits.delete(hits.keys().next().value);
        return true;
    };
})();
app.post('/api/notices', (req, res) => {
    if (!noticeLimit(req.ip || '?')) return res.status(429).json({ error: 'Too many notices from this address — please try again later or write to ' + LEGAL.COPYRIGHT_EMAIL });
    const { notice, errors } = validateNotice(req.body);
    if (errors) return res.status(400).json({ error: 'Some required information is missing.', fields: errors });
    try {
        const saved = notices.add(notice);
        console.log(`Nové oznámení ${saved.id}: ${saved.urls.length} URL — ${saved.name} <${saved.email}>`);
        res.status(201).json({ id: saved.id });
    } catch (err) {
        console.error('Oznámení nelze uložit:', err.message);
        res.status(500).json({ error: 'The notice could not be saved — please email it to ' + LEGAL.COPYRIGHT_EMAIL });
    }
});

// ── Rooms ──
function roomLinks(host, id) {
    if (PUBLIC_URL) return { link: `${PUBLIC_URL}/r/${id}`, public: true };
    return { link: `http://${host || 'localhost:' + PORT}/r/${id}`, public: false };
}
app.use('/api/rooms', rooms.router({
    canCreate: true,
    maxRooms: parseInt(process.env.KOUKNEM_MAX_ROOMS, 10) || undefined,
    roomsPerIp: parseInt(process.env.KOUKNEM_ROOMS_PER_IP, 10) || undefined,
    checkPlayer: sources.checkPlayer,
    resolveVideo: sources.resolveVideo,
    handleStream,
    loadSubtitle: sources.loadSubtitle,
    linkFor: roomLinks,
    listSources: sources.listRoomSources,
    findPlayer: sources.findRoomPlayer,
    tmdb: sources.roomTmdb
}));

app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Nenalezeno' });
    res.status(404).type('html').send(render('404.html'));
});

// Express 5 hands listen errors (e.g. port already in use) to this callback.
app.listen(PORT, '0.0.0.0', err => {
    if (err) {
        console.error(`Kouknem nelze spustit na portu ${PORT}: ${err.message}`);
        process.exit(1);
    }
    console.log(`Kouknem běží na portu ${PORT}${PUBLIC_URL ? ' — veřejně ' + PUBLIC_URL : ''}`);
});
