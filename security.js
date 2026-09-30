// ── Input validation + PIN sessions for the profile API ──
//
// PIN: a profile with a PIN can only be read or changed with a session token,
// issued by POST /api/profiles/:id/pin/verify after the correct PIN. Tokens are
// sent as the X-Profile-Token header (or ?t= for navigator.sendBeacon, which
// can't set headers), live in memory, and expire after 12 h. Wrong PINs are
// rate-limited per profile + client address.

const crypto = require('crypto');

// ── Validators ──

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = v => Number.isInteger(v) && v > 0 && v < 1e9;
const MEDIA = new Set(['movie', 'tv']);
const POSTER = /^\/[\w.-]{1,100}$/;                         // TMDB image path, e.g. "/abc123.jpg"
const DATE = /^\d{4}(-\d{2}-\d{2})?$/;
const PROGRESS_KEY = /^\d{1,9}(:S\d{1,3}E\d{1,4})?$/;       // "157336" or "2316:S02E03"
const EPISODE_LABEL = /^S\d{1,3}E\d{1,4}$/;
const LIST_ID = /^[\w-]{1,60}$/;

function toId(v) {
    const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
    return isId(n) ? n : null;
}

function mediaType(v) { return MEDIA.has(v) ? v : null; }

function posterPath(v) { return typeof v === 'string' && POSTER.test(v) ? v : null; }

function title(v) { return isStr(v, 300) ? v : null; }

// Movie entry stored in a watchlist — only the fields a card needs.
function listMovie(m) {
    if (!m || typeof m !== 'object') return null;
    const id = toId(m.id);
    if (!id) return null;
    const out = { id, media_type: mediaType(m.media_type) || 'movie', poster_path: posterPath(m.poster_path) };
    if (title(m.title)) out.title = m.title;
    if (title(m.name)) out.name = m.name;
    if (!out.title && !out.name) return null;
    if (typeof m.vote_average === 'number' && m.vote_average >= 0 && m.vote_average <= 10) out.vote_average = m.vote_average;
    if (typeof m.release_date === 'string' && DATE.test(m.release_date)) out.release_date = m.release_date;
    if (typeof m.first_air_date === 'string' && DATE.test(m.first_air_date)) out.first_air_date = m.first_air_date;
    return out;
}

// Whole watchlist payload → sanitized copy, or null if unusable.
function watchlists(body) {
    if (!Array.isArray(body) || body.length > 50) return null;
    const lists = [];
    const seen = new Set();
    for (const l of body) {
        if (!l || typeof l !== 'object' || !LIST_ID.test(l.id) || seen.has(l.id)) return null;
        const name = typeof l.name === 'string' ? l.name.trim() : '';
        if (!name || name.length > 30) return null;
        if (!Array.isArray(l.movies) || l.movies.length > 1000) return null;
        seen.add(l.id);
        const movies = [];
        const ids = new Set();
        for (const m of l.movies) {
            const clean = listMovie(m);
            if (clean && !ids.has(clean.id)) { ids.add(clean.id); movies.push(clean); }
        }
        lists.push({ id: l.id, name, movies });
    }
    return lists;
}

// Favorite / watched entry: { tmdbId, mediaType, title, posterPath }
function libraryEntry(b) {
    if (!b || typeof b !== 'object') return null;
    const tmdbId = toId(b.tmdbId);
    const mt = mediaType(b.mediaType);
    const t = title(b.title);
    if (!tmdbId || !mt || !t) return null;
    return { tmdbId, mediaType: mt, title: t, posterPath: posterPath(b.posterPath) };
}

// Playback progress body → clean record, or null.
function progress(key, b) {
    if (!PROGRESS_KEY.test(String(key)) || !b || typeof b !== 'object') return null;
    const seconds = Number(b.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1e6) return null;
    const duration = b.duration == null ? null : Number(b.duration);
    return {
        seconds,
        duration:     Number.isFinite(duration) && duration > 0 && duration < 1e6 ? duration : null,
        title:        title(b.title),
        posterPath:   posterPath(b.posterPath),
        mediaType:    mediaType(b.mediaType) || 'movie',
        tmdbId:       b.tmdbId == null ? null : toId(b.tmdbId),
        episodeLabel: typeof b.episodeLabel === 'string' && EPISODE_LABEL.test(b.episodeLabel) ? b.episodeLabel : null,
        finished:     b.finished === true,          // episode watched to the end (kept for the episode list)
        updatedAt:    new Date().toISOString()
    };
}

// Profile create/update fields. Returns { changes } or { error }.
const SETTINGS_KEYS = ['reduceMotion', 'autoplayTrailers'];
const MAX_PICTURE = 300 * 1024;
function profileChanges(b, creating) {
    if (!b || typeof b !== 'object') return { error: 'Neplatná data' };
    const changes = {};
    if (b.name !== undefined || creating) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name || name.length > 30) return { error: 'Jméno musí mít 1–30 znaků' };
        changes.name = name;
    }
    if (b.theme !== undefined) {
        if (b.theme !== 'dark' && b.theme !== 'light') return { error: 'Neplatný motiv' };
        changes.theme = b.theme;
    }
    if (b.picture !== undefined) {
        if (b.picture !== null && !(typeof b.picture === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.picture) && b.picture.length <= MAX_PICTURE)) {
            return { error: 'Neplatný obrázek' };
        }
        changes.picture = b.picture;
    }
    if (b.settings !== undefined) {
        if (!b.settings || typeof b.settings !== 'object') return { error: 'Neplatná nastavení' };
        const s = {};
        SETTINGS_KEYS.forEach(k => { if (typeof b.settings[k] === 'boolean') s[k] = b.settings[k]; });
        changes.settings = s;
    }
    return { changes };
}

// TMDB proxy parameters
function tmdbType(v) { return mediaType(v); }
function season(v) { const n = toId(v); return n != null && n <= 200 ? n : (v === '0' || v === 0 ? 0 : null); }

// ── PIN sessions ──

const TOKEN_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();          // token → { profileId, exp }

function issueToken(profileId) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { profileId, exp: Date.now() + TOKEN_TTL });
    if (sessions.size > 500) {       // drop expired ones occasionally
        const now = Date.now();
        for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
    }
    return token;
}

function tokenFrom(req) {
    const h = req.get('x-profile-token');
    if (typeof h === 'string' && h) return h;
    return typeof req.query.t === 'string' ? req.query.t : null;
}

function hasSession(req, profileId) {
    const token = tokenFrom(req);
    const s = token && sessions.get(token);
    if (!s) return false;
    if (s.exp < Date.now()) { sessions.delete(token); return false; }
    return s.profileId === profileId;
}

function revokeProfile(profileId) {
    for (const [t, s] of sessions) if (s.profileId === profileId) sessions.delete(t);
}

// ── Wrong-PIN rate limit: 5 failures per 5 minutes per profile + client ──

const FAIL_WINDOW = 5 * 60 * 1000;
const MAX_FAILS = 5;
const failures = new Map();          // `${profileId}|${ip}` → [timestamps]

function failKey(req, profileId) { return profileId + '|' + (req.ip || req.socket.remoteAddress || '?'); }

function retryAfter(req, profileId) {
    const now = Date.now();
    const list = (failures.get(failKey(req, profileId)) || []).filter(t => now - t < FAIL_WINDOW);
    failures.set(failKey(req, profileId), list);
    return list.length >= MAX_FAILS ? Math.ceil((list[0] + FAIL_WINDOW - now) / 1000) : 0;
}

function recordFailure(req, profileId) {
    const key = failKey(req, profileId);
    const list = failures.get(key) || [];
    list.push(Date.now());
    failures.set(key, list);
}

function clearFailures(req, profileId) { failures.delete(failKey(req, profileId)); }

module.exports = {
    toId, mediaType, posterPath, title, watchlists, libraryEntry, progress, profileChanges,
    tmdbType, season,
    issueToken, hasSession, revokeProfile, retryAfter, recordFailure, clearFailures
};
