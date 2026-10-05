// ── Finding and resolving videos for Kouknem rooms ──
//
// Kouknem keeps no catalogue of its own. A room proposes films by their TMDB
// entry; for the film that is chosen, this module searches third-party video
// sites (prehraj.to, fastshare.cloud, sledujteto.cz), keeps only uploads that
// really are that film (relevance.js), ranks them by the host's preferences and
// resolves the chosen one into playable links.
//
// Every page URL goes through the notice-and-action blocklist (notices.js):
// a URL removed after a valid notice is never listed, picked or refreshed again.

const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { fetchVideoPage, fetchFastsharePage, fetchSledujtetoPage, getMp4Info, isAllowedCdnUrl, cleanTrackLabel } = require('./stream');
const relevance = require('./relevance');
const { tmdbTtl } = require('./cache');

// configure({ tmdbToken, cache, isBlocked }) — called once by server.js.
const cfg = { tmdbToken: null, cache: null, isBlocked: () => false };
function configure(opts) { Object.assign(cfg, opts); }
const getCache = key => (cfg.cache ? cfg.cache.get(key) : undefined);
const setCache = (key, data, ttl) => { if (cfg.cache) cfg.cache.set(key, data, ttl); };
const isBlocked = url => !!cfg.isBlocked(url);

// ── TMDB (film metadata only: titles, posters, years) ──
async function tmdbFetch(path) {
    const cached = getCache('tmdb:' + path);
    if (cached) return cached;
    const res = await fetch('https://api.themoviedb.org/3' + path, {
        headers: { accept: 'application/json', Authorization: 'Bearer ' + cfg.tmdbToken },
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error('TMDB neodpovědělo');
    const data = await res.json();
    setCache('tmdb:' + path, data, tmdbTtl(path));
    return data;
}

// puppeteer is only needed when a page can't be read directly — load it then.
let puppeteer = null;
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
        if (!puppeteer) puppeteer = require('puppeteer');
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

// All chosen sites at once → combined results. Throws only if every site failed.
async function searchSources(q, sources) {
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
    if (failed.length === settled.length) throw failed[0].reason;
    return settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);
}

// ── Sources for watch-together rooms ──
// what = { tmdbId, mediaType: 'movie' | 'tv', episode: { season, number } | null }
// Uploads that really are this film / episode (relevance.js), best first by the
// room host's preferences (CZ dub / original, resolution) — what the room's
// source chooser lists.
const pad2 = n => String(n).padStart(2, '0');
async function listRoomSources(what, prefs) {
    const tv = what.mediaType === 'tv';
    const d = await tmdbFetch(`/${tv ? 'tv' : 'movie'}/${what.tmdbId}?language=cs-CZ`);
    const names = [...new Set((tv ? [d.name, d.original_name] : [d.title, d.original_title]).filter(Boolean))];
    const episode = tv && what.episode ? { season: what.episode.season, number: what.episode.number } : null;
    const code = episode ? ` S${pad2(episode.season)}E${pad2(episode.number)}` : '';
    const seen = new Set();
    const pool = [];
    for (const name of names) {
        let results = [];
        try { results = await searchSources(name + code, Object.keys(SEARCHERS)); } catch { continue; }
        for (const r of relevance.filterSources(results, { names, mediaType: tv ? 'tv' : 'movie', episode })) {
            if (r.url && !seen.has(r.url) && !isBlocked(r.url)) { seen.add(r.url); pool.push(r); }
        }
        if (pool.length >= 3) break;
    }
    return {
        title: (names[0] || 'Film') + code, posterPath: d.poster_path || null, episode, code: code.trim() || null,
        sources: relevance.rankSources(pool, prefs || {}).slice(0, 40).map(r => ({
            url: r.url, title: r.title, duration: r.duration || null, size: r.size || null, res: r.res || null,
            dub: !!r.dub, subs: !!r.subs, source: r.source || 'prehrajto', thumb: r.thumb || null
        }))
    };
}

// → a player payload for the room. With `url`: exactly that upload, which must be one
// listRoomSources offers (search results are cached, so this is cheap); without:
// the first of the top three that resolves.
async function findRoomPlayer(what, prefs, url) {
    const list = await listRoomSources(what, prefs);
    const order = url ? list.sources.filter(s => s.url === url) : list.sources.slice(0, 3);
    if (url && isBlocked(url)) throw new Error('Tento zdroj byl odstraněn na základě oznámení');
    if (url && !order.length) throw new Error('Tento zdroj už není v nabídce — načtěte seznam znovu');
    for (const pick of order) {
        try {
            const source = await resolveVideo(pick.url);
            const tv = what.mediaType === 'tv';
            return {
                title: list.title, tmdbId: what.tmdbId, mediaType: tv ? 'tv' : 'movie', posterPath: list.posterPath,
                episode: list.episode, episodeLabel: list.code,
                progressKey: list.code ? `${what.tmdbId}:${list.code}` : String(what.tmdbId),
                source, sourceSite: pick.source,
                alternatives: list.sources.filter(r => r !== pick).slice(0, 6)
                    .map(r => ({ url: r.url, title: r.title, source: r.source, dub: r.dub, res: r.res }))
            };
        } catch (err) {
            console.error('Zdroj pro místnost nefunguje:', pick.url, err.message);
        }
    }
    throw new Error(url ? 'Tento zdroj teď nefunguje — zkuste jiný' : `Pro „${list.title}“ se nenašel žádný funkční zdroj`);
}

// Film search for room members (the guest server has no other access to TMDB).
const roomTmdb = {
    slim: m => ({
        tmdbId: m.id, title: m.title || m.original_title || '', year: (m.release_date || '').slice(0, 4) || null,
        posterPath: m.poster_path || null, rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
        overview: (m.overview || '').slice(0, 240)
    }),
    async search(q) {
        const d = await tmdbFetch(`/search/movie?language=cs-CZ&include_adult=false&query=${encodeURIComponent(q)}`);
        return (d.results || []).slice(0, 12).map(roomTmdb.slim);
    },
    async trending() {
        const d = await tmdbFetch('/trending/movie/week?language=cs-CZ');
        return (d.results || []).slice(0, 12).map(roomTmdb.slim);
    },
    async movie(id) {
        return roomTmdb.slim(await tmdbFetch(`/movie/${id}?language=cs-CZ`));
    }
};

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

// SRT → WebVTT (what <track> understands).
function srtToVtt(srt) {
    const body = String(srt)
        .replace(/^\uFEFF/, '')
        .replace(/\r+/g, '')
        .replace(/^\d+\s*$/gm, '')                                   // drop sequence numbers
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');           // comma → dot in timestamps
    return 'WEBVTT\n\n' + body.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// A subtitle file from the video site's CDN as WebVTT (served through the room,
// which avoids cross-origin <track> failures).
async function loadSubtitle(src) {
    // Subtitle files live on prehraj.to's CDN (premiumcdn.net), not prehrajto.cz itself.
    if (!isAllowedCdnUrl(src)) throw Object.assign(new Error('Nepovolená URL'), { code: 400 });
    const r = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error('Titulky se nepodařilo načíst'), { code: 502 });
    const text = await r.text();
    return /\.srt(\?|$)/i.test(src) || !/^\s*WEBVTT/.test(text) ? srtToVtt(text) : text;
}

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
// Page URL (prehraj.to / fastshare / sledujteto) → { name, duration, …, qualities, subtitles, pageUrl }.
// Used when a film starts and when a room's links expire.
async function resolveVideo(url) {
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
    return { ...video, pageUrl: url };
}

// A player payload for a room: every link must point at the allowed video sites
// and the page must not be blocked. Returns an error message or null.
function checkPlayer(p) {
    const src = p && p.source;
    if (!p || typeof p !== 'object' || !src || !Array.isArray(src.qualities) || !src.qualities.length || src.qualities.length > 12) return 'Chybí video';
    if (!src.qualities.every(q => q && typeof q.src === 'string' && isAllowedCdnUrl(q.src))) return 'Nepovolený odkaz na video';
    const subsOk = s => s && typeof s.src === 'string' && isAllowedCdnUrl(s.src);
    if (src.subtitles != null && !(Array.isArray(src.subtitles) && src.subtitles.every(subsOk))) return 'Nepovolené titulky';
    if (src.pageUrl != null && !isAllowedVideoUrl(src.pageUrl)) return 'Nepovolená stránka videa';
    if (src.pageUrl != null && isBlocked(src.pageUrl)) return 'Video bylo odstraněno na základě oznámení';
    if (p.alternatives != null && !(Array.isArray(p.alternatives) && p.alternatives.every(a => a && isAllowedVideoUrl(a.url)))) return 'Nepovolený záložní zdroj';
    return null;
}

module.exports = {
    configure, tmdbFetch, roomTmdb, listRoomSources, findRoomPlayer, resolveVideo, loadSubtitle, srtToVtt,
    checkPlayer, isAllowedVideoUrl, searchSources
};
