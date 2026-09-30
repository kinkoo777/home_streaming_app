require('dotenv').config();
const express = require('express');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { execSync } = require('child_process');

function getSystemChromium() {
  if (process.platform !== 'linux') return undefined
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      const p = execSync(`which ${bin}`, { encoding: 'utf8' }).trim()
      if (p) return p
    } catch {}
  }
  return undefined
}
const { fetchVideoPage, fetchFastsharePage, fetchSledujtetoPage, getMp4Info, handleStream, isAllowedCdnUrl, cleanTrackLabel } = require('./stream');
const sec = require('./security');
const subtitles = require('./subtitles');
const { srtToVtt } = subtitles;
const { profiles: profilesDB, favorites: favoritesDB, watched: watchedDB, watchlists: watchlistsDB, progress: progressDB, sanitizeProfile } = require('./db');
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ── Headless browser (fallback video extraction) ──
// Launched on first use, relaunched if Chromium dies, closed after 10 min idle,
// and at most 2 tabs at a time so parallel requests can't exhaust memory.
let browser = null;
let browserLaunch = null;
let browserIdleTimer = null;
const MAX_PAGES = 2;
let openPages = 0;
const pageWaiters = [];

async function getBrowser() {
    if (browser && browser.connected !== false) return browser;
    if (!browserLaunch) {
        browserLaunch = puppeteer.launch({
            headless: true,
            executablePath: getSystemChromium() || undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }).then(b => {
            browser = b;
            b.on('disconnected', () => {
                if (browser === b) browser = null;
                console.log('Headless prohlížeč ukončen — při další potřebě se spustí znovu');
            });
            return b;
        }).finally(() => { browserLaunch = null; });
    }
    return browserLaunch;
}

// Run fn(page) in a fresh tab, respecting the tab limit.
async function withPage(fn) {
    if (openPages >= MAX_PAGES) await new Promise(r => pageWaiters.push(r));
    openPages++;
    clearTimeout(browserIdleTimer);
    let p = null;
    try {
        p = await (await getBrowser()).newPage();
        return await fn(p);
    } finally {
        if (p) await p.close().catch(() => {});
        openPages--;
        const next = pageWaiters.shift();
        if (next) next();
        if (!openPages) {
            browserIdleTimer = setTimeout(() => { if (!openPages && browser) browser.close().catch(() => {}); }, 10 * 60 * 1000);
            if (browserIdleTimer.unref) browserIdleTimer.unref();
        }
    }
}


app.use(cors());
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.json());

// ── Cache (5 min TTL, persisted to disk so it survives restarts) ──
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, 'data', 'tmdb-cache.json');

// Load any non-expired entries left over from a previous run.
(function loadCache() {
    try {
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const now = Date.now();
        for (const [key, e] of Object.entries(raw)) {
            if (e && now - e.ts < CACHE_TTL) cache.set(key, e);
        }
    } catch { /* no cache file yet — fine */ }
})();

let cacheSaveTimer = null;
function persistCache() {
    if (cacheSaveTimer) return;            // debounce: at most one write per 10 s
    cacheSaveTimer = setTimeout(() => {
        cacheSaveTimer = null;
        try {
            if (!fs.existsSync(path.dirname(CACHE_FILE))) fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
            const now = Date.now();
            const obj = {};
            for (const [key, e] of cache) if (now - e.ts < CACHE_TTL) obj[key] = e;
            const tmp = CACHE_FILE + '.' + process.pid + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
            fs.renameSync(tmp, CACHE_FILE);
        } catch (err) { console.error('Cache persist selhalo:', err.message); }
    }, 10000);
    if (cacheSaveTimer.unref) cacheSaveTimer.unref();   // don't keep the process alive
}

function getCache(key) {
    const e = cache.get(key);
    if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
    cache.delete(key); return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); persistCache(); }

// ── TMDB helper ──
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
if (!TMDB_READ_TOKEN) {
    console.error('Chybí TMDB_READ_TOKEN — nastavte ho v .env (viz .env.example)');
    process.exit(1);
}
const TMDB_AUTH = 'Bearer ' + TMDB_READ_TOKEN;
async function tmdbFetch(path) {
    const cached = getCache('tmdb:' + path);
    if (cached) return cached;
    const res = await fetch('https://api.themoviedb.org/3' + path, {
        headers: { accept: 'application/json', Authorization: TMDB_AUTH }
    });
    if (!res.ok) throw new Error('TMDB neodpovědělo');
    const data = await res.json();
    setCache('tmdb:' + path, data);
    return data;
}

// ── TMDB proxy endpoints ──
app.get('/tmdb/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí q' });
    if (typeof q !== 'string' || q.length > 200) return res.status(400).json({ error: 'Neplatný dotaz' });
    try { res.json(await tmdbFetch(`/search/multi?language=cs-CZ&query=${encodeURIComponent(q)}`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/hero', async (req, res) => {
    try { res.json(await tmdbFetch('/trending/movie/week?language=cs-CZ')); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/details', async (req, res) => {
    const id = sec.toId(req.query.id);
    const type = sec.tmdbType(req.query.type);
    if (!id || !type) return res.status(400).json({ error: 'Neplatné id nebo type (movie|tv)' });
    try {
        const [details, credits] = await Promise.all([
            tmdbFetch(`/${type}/${id}?language=cs-CZ`),
            tmdbFetch(`/${type}/${id}/credits?language=cs-CZ`)
        ]);
        res.json({ ...details, cast: (credits.cast || []).slice(0, 8) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/videos', async (req, res) => {
    const id = sec.toId(req.query.id);
    const type = sec.tmdbType(req.query.type);
    if (!id || !type) return res.status(400).json({ error: 'Neplatné id nebo type (movie|tv)' });
    try { res.json(await tmdbFetch(`/${type}/${id}/videos?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/similar', async (req, res) => {
    const id = sec.toId(req.query.id);
    const type = sec.tmdbType(req.query.type);
    if (!id || !type) return res.status(400).json({ error: 'Neplatné id nebo type (movie|tv)' });
    try { res.json(await tmdbFetch(`/${type}/${id}/similar?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/actor', async (req, res) => {
    const id = sec.toId(req.query.id);
    if (!id) return res.status(400).json({ error: 'Neplatné id' });
    try {
        const [person, credits] = await Promise.all([
            tmdbFetch(`/person/${id}?language=cs-CZ`),
            tmdbFetch(`/person/${id}/combined_credits?language=cs-CZ`)
        ]);
        // Czech biography is often empty — fall back to English
        let biography = person.biography;
        if (!biography) {
            const personEn = await tmdbFetch(`/person/${id}?language=en-US`);
            biography = personEn.biography || '';
        }
        const works = (credits.cast || [])
            .filter(m => m.poster_path)
            .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
            .slice(0, 20);
        res.json({ ...person, biography, works });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/season', async (req, res) => {
    const id = sec.toId(req.query.id);
    const season = sec.season(req.query.season);
    if (!id || season == null) return res.status(400).json({ error: 'Neplatné id nebo season' });
    try { res.json(await tmdbFetch(`/tv/${id}/season/${season}?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/movies', async (req, res) => {
    const paths = {
        popular:   '/movie/popular?language=cs-CZ',
        trending:  '/trending/all/week?language=cs-CZ',
        top_rated: '/movie/top_rated?language=cs-CZ'
    };
    const p = paths[req.query.type];
    if (!p) return res.status(400).json({ error: 'Neznámý type' });
    const page = Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1));   // TMDB caps at 500
    try { res.json(await tmdbFetch(p + `&page=${page}`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Recommendations for one title (used to build "Doporučeno pro vás").
app.get('/tmdb/recommendations', async (req, res) => {
    const id = sec.toId(req.query.id);
    const type = sec.tmdbType(req.query.type);
    if (!id || !type) return res.status(400).json({ error: 'Neplatné id nebo type (movie|tv)' });
    try { res.json(await tmdbFetch(`/${type}/${id}/recommendations?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Browse by genre / year range / sort ("Procházet").
const DISCOVER_SORT = { popular: 'popularity.desc', rating: 'vote_average.desc', newest: null };
app.get('/tmdb/discover', async (req, res) => {
    const type = sec.tmdbType(req.query.type);
    if (!type) return res.status(400).json({ error: 'type musí být movie nebo tv' });
    const sort = Object.prototype.hasOwnProperty.call(DISCOVER_SORT, req.query.sort) ? req.query.sort : 'popular';
    const q = new URLSearchParams({ language: 'cs-CZ', include_adult: 'false' });
    q.set('sort_by', DISCOVER_SORT[sort] || (type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc'));
    if (sort === 'rating') q.set('vote_count.gte', '200');                         // keep obscure 10/10s out
    if (sort === 'newest') q.set(type === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte', new Date().toISOString().slice(0, 10));
    const genre = sec.toId(req.query.genre);
    if (genre) q.set('with_genres', String(genre));
    // Year range (decade chips in the UI): from / to, inclusive.
    const from = sec.toId(req.query.from), to = sec.toId(req.query.to);
    const field = type === 'tv' ? 'first_air_date' : 'primary_release_date';
    if (from && from >= 1900 && from <= 2100) q.set(field + '.gte', from + '-01-01');
    if (to && to >= 1900 && to <= 2100) q.set(field + '.lte', to + '-12-31');
    q.set('page', String(Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1))));
    try { res.json(await tmdbFetch(`/discover/${type}?${q}`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// A film series (TMDB collection) with its parts.
app.get('/tmdb/collection', async (req, res) => {
    const id = sec.toId(req.query.id);
    if (!id) return res.status(400).json({ error: 'Neplatné id' });
    try { res.json(await tmdbFetch(`/collection/${id}?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/genres', async (req, res) => {
    const type = sec.tmdbType(req.query.type);
    if (!type) return res.status(400).json({ error: 'type musí být movie nebo tv' });
    try { res.json(await tmdbFetch(`/genre/${type}/list?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Online subtitles (OpenSubtitles, optional — see subtitles.js) ──
app.get('/subs/status', (req, res) => res.json({ enabled: subtitles.enabled() }));

app.get('/subs/search', async (req, res) => {
    const tmdbId = sec.toId(req.query.tmdbId);
    const type = sec.tmdbType(req.query.type);
    if (!tmdbId || !type) return res.status(400).json({ error: 'Neplatné tmdbId nebo type' });
    const season = sec.toId(req.query.season);
    const episode = sec.toId(req.query.episode);
    const key = `subs:${type}:${tmdbId}:${season}:${episode}`;
    const cached = getCache(key);
    if (cached) return res.json(cached);
    try {
        const list = await subtitles.search({ tmdbId, type, season, episode });
        setCache(key, list);
        res.json(list);
    } catch (err) {
        res.status(err.code === 503 ? 503 : 502).json({ error: err.message });
    }
});

app.get('/subs/file/:fileId', async (req, res) => {
    try {
        const vtt = await subtitles.download(req.params.fileId);
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vtt);
    } catch (err) {
        res.status(err.code === 503 ? 503 : 502).json({ error: err.message });
    }
});



function makeAbsolute(elements, base) {
    elements.forEach(v => {
        v.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href && href.startsWith('/')) a.setAttribute('href', base + href);
        });
        v.querySelectorAll('img[src], img[data-src]').forEach(img => {
            const dataSrc = img.getAttribute('data-src');
            if (dataSrc) {
                const abs = dataSrc.startsWith('/') ? base + dataSrc : dataSrc;
                img.setAttribute('src', abs);
                img.removeAttribute('data-src');
            } else {
                const src = img.getAttribute('src');
                if (src && src.startsWith('/')) img.setAttribute('src', base + src);
            }
        });
    });
}

async function searchPrehrajto(q) {
    const response = await fetch(
        `https://prehrajto.cz/hledej/${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) throw new Error('Prehrajto neodpovědělo');

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const wrappers = [...doc.querySelectorAll('.video-wrapper')];
    makeAbsolute(wrappers, 'https://prehrajto.cz');
    const text = (root, sel) => { const el = root.querySelector(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };

    // Structured results — the client renders its own cards (never raw site HTML).
    return wrappers.map(w => {
        const a = w.querySelector('a.video--link[href], a[href]');
        if (!a) return null;
        const title = text(w, '.video__title') || a.getAttribute('title') || '';
        const thumb = w.querySelector('img.thumb1, img.thumb');
        const res = (title.match(/(2160|1080|720|480)p/i) || [])[1];
        return {
            title: title.trim(),
            url: a.getAttribute('href'),
            thumb: thumb ? thumb.getAttribute('src') : null,
            duration: text(w, '.video__tag--time'),
            size: text(w, '.video__tag--size'),
            format: text(w, '.video__tag--format'),
            res: res ? parseInt(res, 10) : null,
            dub: /cz\s*dab|dabing|czdab/i.test(title),
            subs: /titulky|cz\s*tit|\btit\b/i.test(title),
            source: 'prehrajto'
        };
    }).filter(r => r && r.url && isAllowedVideoUrl(r.url));
}

// fastshare.cloud loads results over AJAX (test2.php, base64 term) and returns
// an empty list to non-browser User-Agents.
async function searchFastshare(q) {
    const term = Buffer.from(q, 'utf8').toString('base64');
    const params = new URLSearchParams({
        u: '', term, search_purpose: '0', search_resolution: '0', plain_search: '0',
        limit: '1', order: '', type: 'video', step: '4', view: 'cz'
    });
    const response = await fetch(`https://fastshare.cloud/test2.php?${params}`, {
        headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://fastshare.cloud/' },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('FastShare neodpovědělo');

    const doc = new JSDOM(await response.text()).window.document;
    const items = [...doc.querySelectorAll('li.search_item')];
    makeAbsolute(items, 'https://fastshare.cloud');
    const text = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    // jsdom's querySelector() misses descendant matches on every item after the
    // first in this markup; querySelectorAll() finds them reliably.
    const one = (root, sel) => root.querySelectorAll(sel)[0] || null;

    return items.map(li => {
        const url = li.getAttribute('data-file-url') || one(li, '.video_detail a[href]')?.getAttribute('href');
        if (!url) return null;
        // Fallback: ".../11331345/matrix-1-1999-cz-dabing.mkv" → "matrix 1 1999 cz dabing mkv"
        const title = text(one(li, '.video_detail p a'))
            || decodeURIComponent(url.split('/').pop() || '').replace(/[-_.]+/g, ' ').trim();
        const thumb = one(li, 'img.videoThumbnail');
        const times = [...li.querySelectorAll('.vd_view .video_time')];
        const duration = text(times.find(t => t.querySelectorAll('.fa-clock-o').length));
        const size = text(one(li, '.vd_view .video_time.pull-right'));
        // "1920x800" → 1080, else fall back to a "1080p" tag in the file name
        const dims = times.map(text).map(t => t && t.match(/^(\d{3,4})x(\d{3,4})$/)).find(Boolean);
        const w = dims ? parseInt(dims[1], 10) : 0;
        const nameRes = (title.match(/(2160|1080|720|480)p/i) || [])[1];
        const res = w >= 3200 ? 2160 : w >= 1600 ? 1080 : w >= 1100 ? 720 : w > 0 ? 480 : nameRes ? parseInt(nameRes, 10) : null;
        const ext = (url.match(/\.([a-z0-9]{2,4})(?:$|\?)/i) || [])[1];
        return {
            title,
            url,
            thumb: thumb ? thumb.getAttribute('src') : null,
            duration,
            size,
            format: ext ? ext.toUpperCase() : null,
            res,
            dub: /cz\s*dab|dabing|czdab/i.test(title),
            subs: /titulky|cz\s*tit|\btit\b/i.test(title),
            source: 'fastshare'
        };
    }).filter(r => r && r.url && isAllowedVideoUrl(r.url));
}

// sledujteto.cz has a JSON search API (the page itself is an empty Vue shell).
async function searchSledujteto(q) {
    const response = await fetch(`https://www.sledujteto.cz/api/web/videos?${new URLSearchParams({ query: q, page: '1' })}`, {
        headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Sledujteto neodpovědělo');
    const files = ((await response.json()).data || {}).files || [];

    // "2h 9m 15s" → "02:09:15" (same shape as the other sources)
    const hms = t => {
        const m = String(t || '').match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
        if (!m || !m[0].trim()) return null;
        return [m[1], m[2], m[3]].map(n => String(+n || 0).padStart(2, '0')).join(':');
    };

    return files.filter(f => f && !f.is_nsfw && f.is_processed !== false).map(f => {
        const title = String(f.name || f.filename || '').trim();
        const w = parseInt(String(f.movie_resolution || f.resolution || '').split('*')[0], 10) || 0;
        const nameRes = (title.match(/(2160|1080|720|480)p/i) || [])[1];
        const res = w >= 3200 ? 2160 : w >= 1600 ? 1080 : w >= 1100 ? 720 : w > 0 ? 480 : nameRes ? parseInt(nameRes, 10) : null;
        return {
            title,
            url: f.full_url || (f.url ? 'https://www.sledujteto.cz' + f.url : null),
            thumb: f.preview || null,
            duration: hms(f.movie_duration || f.duration),
            size: f.filesize || null,
            format: f.movie_codec ? String(f.movie_codec).toUpperCase() : null,
            res,
            dub: /cz\s*dab|dabing|czdab/i.test(title),
            subs: /titulky|cz\s*tit|\btit\b/i.test(title),
            source: 'sledujteto'
        };
    }).filter(r => r.url && isAllowedVideoUrl(r.url));
}

const SEARCHERS = { prehrajto: searchPrehrajto, fastshare: searchFastshare, sledujteto: searchSledujteto };

// ?sources=prehrajto,fastshare → only those sites; missing/empty → all of them.
function pickSources(raw) {
    const list = typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(s => SEARCHERS[s]) : [];
    return list.length ? [...new Set(list)] : Object.keys(SEARCHERS);
}

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });
    if (typeof q !== 'string' || q.length > 200) return res.status(400).json({ error: 'Neplatný dotaz' });
    const sources = pickSources(req.query.sources);
    const norm = q.toLowerCase().trim();

    // Cached per site, so toggling a source on/off doesn't refetch the others.
    const settled = await Promise.allSettled(sources.map(async name => {
        const key = `search5:${name}:${norm}`;
        const cached = getCache(key);
        if (cached) return cached;
        const results = await SEARCHERS[name](q);
        setCache(key, results);
        return results;
    }));
    // One site being down shouldn't hide the others' results.
    const failed = settled.filter(s => s.status === 'rejected');
    failed.forEach(f => console.error('SEARCH ERROR:', f.reason && f.reason.message));
    if (failed.length === settled.length) return res.status(500).json({ error: failed[0].reason.message });
    res.json(settled.flatMap(s => s.status === 'fulfilled' ? s.value : []));
});

// ── Search suggestions (each site's own "našeptávač") ──

const SUGGESTERS = {
    prehrajto: async q => {
        const r = await fetch(`https://prehrajto.cz/api/v1/public/suggest/${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(4000)
        });
        return ((await r.json()).items || []).map(i => i && i.name);
    },
    fastshare: async q => {
        const r = await fetch(`https://fastshare.cloud/search.php?${new URLSearchParams({ term: q })}`, {
            headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' }, signal: AbortSignal.timeout(4000)
        });
        const list = await r.json();
        return Array.isArray(list) ? list.map(i => typeof i === 'string' ? i : i && (i.value || i.label)) : [];
    },
    sledujteto: async q => {
        const r = await fetch(`https://www.sledujteto.cz/api/web/search/suggestions?${new URLSearchParams({ query: q })}`, {
            headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, signal: AbortSignal.timeout(4000)
        });
        const terms = ((await r.json()).data || {}).terms || [];
        return Array.isArray(terms) ? terms : Object.values(terms);
    }
};

// Short-lived and in-memory only — suggestions would bloat the persisted cache.
const suggestCache = new Map();
async function cachedSuggest(name, q) {
    const key = name + ':' + q;
    const hit = suggestCache.get(key);
    if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.data;
    const data = (await SUGGESTERS[name](q)).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim());
    suggestCache.set(key, { data, ts: Date.now() });
    if (suggestCache.size > 500) suggestCache.delete(suggestCache.keys().next().value);
    return data;
}

// → [{ term, sources: ['fastshare', …] }], interleaved by each site's own ranking.
app.get('/suggest', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (q.length < 2 || q.length > 100) return res.json([]);
    const sources = pickSources(req.query.sources);
    const lists = await Promise.all(sources.map(name => cachedSuggest(name, q).catch(err => {
        console.error('SUGGEST ERROR:', name, err.message);
        return [];
    })));

    const key = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
    const merged = new Map();
    const longest = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < longest; i++) {
        lists.forEach((list, s) => {
            const term = list[i];
            if (!term) return;
            const k = key(term);
            if (!merged.has(k)) merged.set(k, { term, sources: [] });
            const entry = merged.get(k);
            if (!entry.sources.includes(sources[s])) entry.sources.push(sources[s]);
        });
    }
    res.json([...merged.values()].slice(0, 10));
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36';
const BLOCK_TYPES = ['image', 'stylesheet', 'font'];

async function getVideoPrehrajto(url) {
    return withPage(async p => {
        await p.setUserAgent(UA);

        // Capture video stream URLs from network traffic — fires before DOM update
        const captured = new Set();
        const subsCaptured = new Set();
        await p.setRequestInterception(true);
        p.on('request', req => {
            try {
                const u = req.url();
                if (/\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(u)) captured.add(u);
                if (/\.(vtt|srt)(\?|$)/i.test(u)) subsCaptured.add(u);
                if (BLOCK_TYPES.includes(req.resourceType())) {
                    req.abort().catch(() => {});
                } else {
                    req.continue().catch(() => {});
                }
            } catch (err) {
                // Silently handle request interception errors
                console.error('Request interception error:', err.message);
            }
        });

        // Read metadata from DOM as soon as it's available
        // Increased timeout and using fallback strategy
        try {
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (navError) {
            // If domcontentloaded times out, try with networkidle as fallback
            console.log('Navigation timeout, retrying with networkidle2...');
            await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        }

        const metadata = await p.evaluate(() =>
            Array.from(document.querySelectorAll('div.video-wrap')).map(w => {
                const metas = w.querySelectorAll(':scope > meta[itemprop]');
                let name = null, duration = null, thumbnail = null;
                for (const m of metas) {
                    const prop = m.getAttribute('itemprop');
                    if (prop === 'name') name = m.content;
                    else if (prop === 'duration') duration = m.content;
                    else if (prop === 'thumbnailUrl') thumbnail = m.content;
                }
                // Subtitle <track> elements declared on the player, if any
                const tracks = Array.from(w.querySelectorAll('track')).map(t => ({
                    src:   t.src || t.getAttribute('src'),
                    label: t.label || t.getAttribute('label') || t.srclang || 'Titulky',
                    lang:  t.srclang || t.getAttribute('srclang') || ''
                })).filter(t => t.src);
                return { name, duration, thumbnail, tracks };
            })
        );

        // Wait for the video network request (max 8s)
        const deadline = Date.now() + 8000;
        while (captured.size === 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 150));
        }

        if (captured.size === 0) throw new Error('Nepodařilo se zachytit video URL');

        // Merge subtitle tracks: those declared in the DOM plus any .vtt/.srt seen on the wire.
        const netSubs = [...subsCaptured].map(src => ({ src, label: 'Titulky', lang: '' }));

        return [...captured].map((src, i) => {
            const meta = metadata[i] ?? metadata[0] ?? {};
            const subtitles = [...(meta.tracks || []), ...netSubs]
                .filter((s, idx, arr) => arr.findIndex(x => x.src === s.src) === idx);
            return { ...meta, videoSrc: src, subtitles };
        });
    });
}

function hostOf(raw) {
    try {
        const u = new URL(raw);
        return (u.protocol === 'https:' || u.protocol === 'http:') ? u.hostname.toLowerCase() : null;
    } catch {
        return null;
    }
}

function isFastshareUrl(raw) {
    const host = hostOf(raw);
    return !!host && (host === 'fastshare.cloud' || host === 'www.fastshare.cloud');
}

function isSledujtetoUrl(raw) {
    const host = hostOf(raw);
    return !!host && (host === 'sledujteto.cz' || host === 'www.sledujteto.cz');
}

// Only allow scraping prehraj.to / fastshare / sledujteto hosts — prevents SSRF via attacker-supplied url
function isAllowedVideoUrl(raw) {
    const host = hostOf(raw);
    if (!host) return false;
    return host === 'prehrajto.cz' || host.endsWith('.prehrajto.cz') || isFastshareUrl(raw) || isSledujtetoUrl(raw);
}


// Proxy + normalize subtitle files (avoids cross-origin <track> failures).
app.get('/get_subtitle', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Chybí query parameter "url"' });
    // Subtitle files live on prehraj.to's CDN (premiumcdn.net), not prehrajto.cz itself.
    if (!isAllowedCdnUrl(url)) return res.status(400).json({ error: 'Nepovolená URL' });
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return res.status(502).json({ error: 'Titulky se nepodařilo načíst' });
        const text = await r.text();
        const vtt = /\.srt(\?|$)/i.test(url) || !/^\s*WEBVTT/.test(text) ? srtToVtt(text) : text;
        res.set('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vtt);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Legacy headless-browser extraction → same shape as fetchVideoPage().
async function getVideoViaBrowser(url) {
    const vids = await getVideoPrehrajto(url);
    const first = vids[0] || {};
    const subs = new Map();
    vids.forEach(v => (v.subtitles || []).forEach(s => subs.set(s.src, { ...s, label: cleanTrackLabel(s.label, s.lang) })));
    return {
        name: first.name, duration: first.duration, thumbnail: first.thumbnail,
        qualities: vids.map((v, i) => ({ src: v.videoSrc, label: vids.length > 1 ? 'Zdroj ' + (i + 1) : 'Auto', res: null })),
        subtitles: [...subs.values()]
    };
}

// Returns { name, duration, thumbnail, width, height, pageUrl,
//           qualities: [{ src, label, res, hdr, transfer }], subtitles: [{ src, label, lang, default }] }
app.get('/get_video', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Chybí query parameter "url"' });
    if (!isAllowedVideoUrl(url)) return res.status(400).json({ error: 'Nepovolená URL' });

    try {
        console.log(`Fetching video from: ${url}`);
        let video = null;
        if (isFastshareUrl(url)) {
            // Free stream is a plain <video><source> on the file page.
            video = await fetchFastsharePage(url);
        } else if (isSledujtetoUrl(url)) {
            // Stream link is issued per play via services/add-file-link.
            video = await fetchSledujtetoPage(url);
        } else {
            // Fast path: sources are listed in the page's inline script.
            try {
                video = await fetchVideoPage(url);
                if (!video.qualities.length) video = null;
            } catch (err) {
                console.error('Page extraction failed, falling back to browser:', err.message);
            }
            if (!video) {
                video = await getVideoViaBrowser(url);
            }
        }
        if (!video.qualities.length) throw new Error('Nepodařilo se získat odkaz na video');

        // Flag HDR-tagged files so the player can route them through /stream.
        await Promise.all(video.qualities.map(async q => {
            const info = await Promise.race([
                getMp4Info(q.src),
                new Promise(r => setTimeout(() => r(null), 6000))
            ]);
            q.transfer = info ? info.transfer : 'unknown';
            q.hdr = !!(info && info.hdr);
        }));

        console.log(`Found ${video.qualities.length} quality variant(s): ${video.qualities.map(q => q.label + (q.hdr ? ' HDR' : '')).join(', ')}`);
        res.json({ ...video, pageUrl: url });
    } catch (err) {
        console.error('VIDEO ERROR:', err);
        if (err.name === 'TimeoutError') {
            res.status(504).json({
                error: 'Časový limit vypršel při načítání stránky. Zkuste to prosím znovu.'
            });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Range-aware proxy that rewrites HDR colour tags to BT.709 (see stream.js).
app.get('/stream', (req, res) => handleStream(req, res).catch(err => {
    console.error('STREAM ERROR:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
}));



// ====================
// PROFILES API
// ====================
// All input goes through security.js validators. Profiles with a PIN require a
// session token (X-Profile-Token / ?t=) for everything below except listing.

function libraryDelete(db) {
    return (req, res) => {
        const tmdbId = sec.toId(req.params.tmdbId);
        const mediaType = sec.mediaType(req.params.mediaType);
        if (!tmdbId || !mediaType) return res.status(400).json({ error: 'Neplatné parametry' });
        if (!db.remove(req.params.id, tmdbId, mediaType)) return res.status(404).json({ error: 'Položka nenalezena' });
        res.json({ ok: true });
    };
}

function libraryAdd(db) {
    return (req, res) => {
        const entry = sec.libraryEntry(req.body);
        if (!entry) return res.status(400).json({ error: 'tmdbId, mediaType (movie|tv) a title jsou povinné' });
        try {
            res.status(201).json(db.add(Object.assign({ profileId: req.params.id }, entry)));
        } catch (err) {
            res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
        }
    };
}

app.get('/api/profiles', (req, res) => {
    res.json(profilesDB.list().map(sanitizeProfile));
});

app.post('/api/profiles', (req, res) => {
    const { changes, error } = sec.profileChanges(req.body, true);
    if (error) return res.status(400).json({ error });
    try {
        const profile = profilesDB.create({ name: changes.name, picture: changes.picture || null, theme: changes.theme || 'dark' });
        res.status(201).json(sanitizeProfile(profile));
    } catch (err) {
        res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
    }
});

// Verify a PIN attempt → { ok, token }. Rate-limited; doesn't need a session.
app.post('/api/profiles/:id/pin/verify', (req, res) => {
    const id = req.params.id;
    const profile = profilesDB.get(id);
    if (!profile) return res.status(404).json({ error: 'Profil nenalezen' });
    if (!profile.pinHash) return res.json({ ok: true, token: null });
    const wait = sec.retryAfter(req, id);
    if (wait) {
        res.set('Retry-After', String(wait));
        return res.status(429).json({ error: `Příliš mnoho pokusů — zkuste to za ${Math.ceil(wait / 60)} min` });
    }
    if (!profilesDB.verifyPin(id, String(req.body && req.body.pin != null ? req.body.pin : ''))) {
        sec.recordFailure(req, id);
        return res.json({ ok: false });
    }
    sec.clearFailures(req, id);
    res.json({ ok: true, token: sec.issueToken(id) });
});

// Gate: every other /api/profiles/:id… route of a PIN-protected profile needs a session.
app.use('/api/profiles/:id', (req, res, next) => {
    const profile = profilesDB.get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil nenalezen' });
    if (profile.pinHash && !sec.hasSession(req, profile.id)) {
        return res.status(401).json({ error: 'Vyžadován PIN', pinRequired: true });
    }
    req.profile = profile;
    next();
});

app.get('/api/profiles/:id', (req, res) => {
    res.json(sanitizeProfile(req.profile));
});

app.put('/api/profiles/:id', (req, res) => {
    const { changes, error } = sec.profileChanges(req.body, false);
    if (error) return res.status(400).json({ error });
    try {
        res.json(sanitizeProfile(profilesDB.update(req.params.id, changes)));
    } catch (err) {
        res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
    }
});

// Set (4 digits) or clear (null) the PIN. Setting one returns a fresh token so
// the current session stays unlocked; any change revokes older sessions.
app.post('/api/profiles/:id/pin', (req, res) => {
    const pin = req.body ? req.body.pin : undefined;
    try {
        const profile = profilesDB.setPin(req.params.id, pin == null || pin === '' ? null : String(pin));
        sec.revokeProfile(profile.id);
        res.json({ hasPin: !!profile.pinHash, token: profile.pinHash ? sec.issueToken(profile.id) : null });
    } catch (err) {
        res.status(err.code === 400 ? 400 : 500).json({ error: err.message });
    }
});

app.delete('/api/profiles/:id', (req, res) => {
    const id = req.params.id;
    profilesDB.delete(id);
    favoritesDB.deleteByProfile(id);
    watchedDB.deleteByProfile(id);
    watchlistsDB.deleteByProfile(id);
    progressDB.deleteByProfile(id);
    sec.revokeProfile(id);
    res.json({ ok: true });
});

// ── Favorites ──
app.get('/api/profiles/:id/favorites', (req, res) => res.json(favoritesDB.list(req.params.id)));
app.post('/api/profiles/:id/favorites', libraryAdd(favoritesDB));
app.delete('/api/profiles/:id/favorites/:tmdbId/:mediaType', libraryDelete(favoritesDB));

// ── Watched ──
app.get('/api/profiles/:id/watched', (req, res) => res.json(watchedDB.list(req.params.id)));
app.post('/api/profiles/:id/watched', libraryAdd(watchedDB));
app.delete('/api/profiles/:id/watched/:tmdbId/:mediaType', libraryDelete(watchedDB));

// ── Watchlists ──
app.get('/api/profiles/:id/watchlists', (req, res) => res.json(watchlistsDB.getByProfile(req.params.id)));
app.put('/api/profiles/:id/watchlists', (req, res) => {
    const lists = sec.watchlists(req.body);
    if (!lists) return res.status(400).json({ error: 'Neplatný formát seznamů' });
    watchlistsDB.saveByProfile(req.params.id, lists);
    res.json({ ok: true });
});

// ── Progress ── PUT from fetch(); POST from navigator.sendBeacon() on page close.
function saveProgress(req, res) {
    const data = sec.progress(req.params.key, req.body);
    if (!data) return res.status(400).json({ error: 'Neplatná data průběhu' });
    progressDB.set(req.params.id, req.params.key, data);
    res.json({ ok: true });
}
app.get('/api/profiles/:id/progress', (req, res) => res.json(progressDB.getAll(req.params.id)));
app.put('/api/profiles/:id/progress/:key', saveProgress);
app.post('/api/profiles/:id/progress/:key', saveProgress);
app.delete('/api/profiles/:id/progress/:key', (req, res) => {
    res.json({ ok: progressDB.remove(req.params.id, req.params.key) });
});

// ── Export / wipe ──
app.get('/api/profiles/:id/export', (req, res) => {
    const id = req.params.id;
    res.json({
        exportedAt: new Date().toISOString(),
        profile:    sanitizeProfile(req.profile),
        favorites:  favoritesDB.list(id),
        watched:    watchedDB.list(id),
        watchlists: watchlistsDB.getByProfile(id),
        progress:   progressDB.getAll(id)
    });
});

app.delete('/api/profiles/:id/data', (req, res) => {
    const id = req.params.id;
    favoritesDB.deleteByProfile(id);
    watchedDB.deleteByProfile(id);
    watchlistsDB.deleteByProfile(id);
    progressDB.deleteByProfile(id);
    res.json({ ok: true });
});

// ====================
// START SERVER
// ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server běží na portu ${PORT}`);
});