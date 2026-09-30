// ── Subtitles: SRT→WebVTT conversion + OpenSubtitles.com fallback search ──
//
// OpenSubtitles (official REST API, https://opensubtitles.stoplight.io) is used
// when a video comes without Czech/Slovak subtitles. It needs a free API key in
// .env (OPENSUBTITLES_API_KEY); OPENSUBTITLES_USERNAME / _PASSWORD are optional
// and raise the daily download quota. Downloaded files are cached in
// data/subtitles/ so re-watching doesn't spend quota.

const fs = require('fs');
const path = require('path');

const API = 'https://api.opensubtitles.com/api/v1';
const APP_UA = 'FilmBox v1.0';
const CACHE_DIR = path.join(__dirname, 'data', 'subtitles');

// Convert a SubRip (.srt) document to WebVTT so <track> can render it.
function srtToVtt(srt) {
    const body = String(srt)
        .replace(/^﻿/, '')
        .replace(/\r+/g, '')
        .replace(/^\d+\s*$/gm, '')                                   // drop sequence numbers
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');           // comma → dot in timestamps
    return 'WEBVTT\n\n' + body.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function enabled() { return !!process.env.OPENSUBTITLES_API_KEY; }

function headers(extra) {
    return Object.assign({
        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
        'User-Agent': APP_UA,
        Accept: 'application/json',
        'Content-Type': 'application/json'
    }, extra || {});
}

// Optional login → bearer token (higher download quota). Cached ~23 h.
let login = null;
async function bearer() {
    const user = process.env.OPENSUBTITLES_USERNAME;
    const pass = process.env.OPENSUBTITLES_PASSWORD;
    if (!user || !pass) return null;
    if (login && login.exp > Date.now()) return login.token;
    const res = await fetch(API + '/login', { method: 'POST', headers: headers(), body: JSON.stringify({ username: user, password: pass }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.error('OpenSubtitles login selhal:', res.status); return null; }
    const data = await res.json();
    login = { token: data.token, exp: Date.now() + 23 * 3600 * 1000 };
    return login.token;
}

// Search by TMDB id. For episodes TMDB id is the show's id + season/episode.
async function search({ tmdbId, type, season, episode, languages }) {
    if (!enabled()) { const e = new Error('OpenSubtitles není nastaveno (chybí OPENSUBTITLES_API_KEY)'); e.code = 503; throw e; }
    const q = new URLSearchParams({ languages: languages || 'cs,sk', order_by: 'download_count' });
    if (type === 'tv') {
        q.set('parent_tmdb_id', String(tmdbId));
        if (season) q.set('season_number', String(season));
        if (episode) q.set('episode_number', String(episode));
        q.set('type', 'episode');
    } else {
        q.set('tmdb_id', String(tmdbId));
        q.set('type', 'movie');
    }
    const res = await fetch(`${API}/subtitles?${q}`, { headers: headers(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('OpenSubtitles neodpovědělo (' + res.status + ')');
    const data = await res.json();
    return (data.data || []).map(item => {
        const a = item.attributes || {};
        const file = (a.files || [])[0];
        if (!file || !file.file_id) return null;
        return {
            fileId: file.file_id,
            lang: a.language || '',
            release: a.release || file.file_name || '',
            downloads: a.download_count || 0,
            hearingImpaired: !!a.hearing_impaired,
            fps: a.fps || null
        };
    }).filter(Boolean).slice(0, 20);
}

// Download one file (as WebVTT). Cached on disk by file id.
async function download(fileId) {
    if (!enabled()) { const e = new Error('OpenSubtitles není nastaveno'); e.code = 503; throw e; }
    const id = parseInt(fileId, 10);
    if (!id || id <= 0) throw new Error('Neplatné id titulků');
    const cached = path.join(CACHE_DIR, id + '.vtt');
    if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');

    const token = await bearer();
    const res = await fetch(API + '/download', {
        method: 'POST',
        headers: headers(token ? { Authorization: 'Bearer ' + token } : null),
        body: JSON.stringify({ file_id: id, sub_format: 'srt' }),
        signal: AbortSignal.timeout(15000)
    });
    if (res.status === 406) throw new Error('Denní limit stažení titulků vyčerpán');
    if (!res.ok) throw new Error('Titulky se nepodařilo stáhnout (' + res.status + ')');
    const { link } = await res.json();
    if (!link) throw new Error('Titulky se nepodařilo stáhnout');
    const file = await fetch(link, { signal: AbortSignal.timeout(20000) });
    if (!file.ok) throw new Error('Titulky se nepodařilo stáhnout (' + file.status + ')');
    const text = await file.text();
    const vtt = /^\s*WEBVTT/.test(text) ? text : srtToVtt(text);
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cached, vtt, 'utf8');
    } catch (e) { console.error('Cache titulků selhala:', e.message); }
    return vtt;
}

module.exports = { srtToVtt, enabled, search, download };
