const express = require('express');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { profiles: profilesDB, favorites: favoritesDB } = require('./db');
const TMDB_API_KEY = "4423c40ec92d2d940674ff0c6bf108dc";

const app = express();
const PORT = 3000;

let browser;
let page;
let isBusy = false; // lock pro frontu
const queue = [];   // fronta requestů


app.use(cors());
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.json());

// ── In-memory cache (5 min TTL) ──
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function getCache(key) {
    const e = cache.get(key);
    if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
    cache.delete(key); return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

// ── TMDB helper ──
const TMDB_AUTH = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ';
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
    try { res.json(await tmdbFetch(`/search/multi?language=cs-CZ&query=${encodeURIComponent(q)}`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/hero', async (req, res) => {
    try { res.json(await tmdbFetch('/trending/movie/week?language=cs-CZ')); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/details', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Chybí id nebo type' });
    try {
        const [details, credits] = await Promise.all([
            tmdbFetch(`/${type}/${id}?language=cs-CZ`),
            tmdbFetch(`/${type}/${id}/credits?language=cs-CZ`)
        ]);
        res.json({ ...details, cast: (credits.cast || []).slice(0, 8) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/videos', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Chybí id nebo type' });
    try { res.json(await tmdbFetch(`/${type}/${id}/videos?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/similar', async (req, res) => {
    const { id, type } = req.query;
    if (!id || !type) return res.status(400).json({ error: 'Chybí id nebo type' });
    try { res.json(await tmdbFetch(`/${type}/${id}/similar?language=cs-CZ`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/tmdb/actor', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Chybí id' });
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
    const { id, season } = req.query;
    if (!id || !season) return res.status(400).json({ error: 'Chybí id nebo season' });
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
    const page = parseInt(req.query.page) || 1;
    try { res.json(await tmdbFetch(p + `&page=${page}`)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});



// --- Fronta requestů ---
function enqueueRequest(fn) {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isBusy) return;
    if (queue.length === 0) return;

    const { fn, resolve, reject } = queue.shift();
    isBusy = true;

    try {
        const result = await fn();
        resolve(result);
    } catch (err) {
        reject(err);
    } finally {
        isBusy = false;
        processQueue(); // zpracuj další request ve frontě
    }
}




// ── Search helpers ──

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

    doc.querySelectorAll('.video__tag, .video__tag--others, .video__header').forEach(el => el.remove());

    const wrappers = [...doc.querySelectorAll('.video-wrapper')];
    makeAbsolute(wrappers, 'https://prehrajto.cz');
    return wrappers.map(v => v.outerHTML);
}

app.get('/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });

    const cacheKey = 'search:' + q.toLowerCase().trim();
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const results = await searchPrehrajto(q);
        setCache(cacheKey, results);
        res.json(results);
    } catch (err) {
        console.error('SEARCH ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36';
const BLOCK_TYPES = ['image', 'stylesheet', 'font'];

async function getVideoPrehrajto(url) {
    const p = await browser.newPage();
    try {
        await p.setUserAgent(UA);

        // Capture video stream URLs from network traffic — fires before DOM update
        const captured = new Set();
        await p.setRequestInterception(true);
        p.on('request', req => {
            try {
                const u = req.url();
                if (/\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(u)) captured.add(u);
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
                return { name, duration, thumbnail };
            })
        );

        // Wait for the video network request (max 8s)
        const deadline = Date.now() + 8000;
        while (captured.size === 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 150));
        }

        if (captured.size === 0) throw new Error('Nepodařilo se zachytit video URL');

        return [...captured].map((src, i) => ({
            ...(metadata[i] ?? metadata[0] ?? {}),
            videoSrc: src
        }));
    } finally {
        await p.close();
    }
}

app.get('/get_video', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Chybí query parameter "url"' });
    if (!browser) return res.status(503).json({ error: 'Browser není připraven, zkuste znovu' });

    try {
        console.log(`Fetching video from: ${url}`);
        const videos = await getVideoPrehrajto(url);
        console.log(`Successfully fetched ${videos.length} video(s)`);
        res.json(videos);
    } catch (err) {
        console.error('VIDEO ERROR:', err);
        // Provide more specific error messages
        if (err.name === 'TimeoutError') {
            res.status(504).json({
                error: 'Časový limit vypršel při načítání stránky. Zkuste to prosím znovu.'
            });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});



async function initBrowser() {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36'
    );

    await page.setRequestInterception(true);
    page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font'].includes(type)) req.abort();
        else req.continue();
    });

    await page.goto('https://prehrajto.cz', { waitUntil: 'domcontentloaded' });
    console.log('Browser a stránka připraveny!');
}

initBrowser().catch(console.error);

// --- Endpoint autocomplete ---
app.get('/autocomplete_data', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });
    if (q == "none") {
        console.log("Invalid input text!");
        return;
    }


    try {
        const results = await enqueueRequest(async () => {
            // vymažeme předchozí input
            await page.evaluate(() => {
                const input = document.querySelector('.video-search-phrase');
                if (input) input.value = '';
            });

            // vyplníme nový text
            await page.type('.video-search-phrase', q, { delay: 0 });

            // čekáme max 5s na autocomplete
            await page.waitForSelector('.autocomplete-list li', { timeout: 5000 }).catch(() => []);

            // získáme výsledky
            const res = await page.evaluate(() => {
                return [...document.querySelectorAll('.autocomplete-list li')].map(el => el.textContent.trim());
            });

            return res;
        });

        res.json(results);
    } catch (err) {
        console.error('AUTOCOMPLETE ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/load_most_visited', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };

        
        const response = await fetch(
            `https://api.themoviedb.org/3/trending/all/${q}?language=en-US`,
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/load_trending', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };
        
        const response = await fetch(
            q,
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

// movies https://api.themoviedb.org/3/movie/popular?language=en-US&page=1
// serials https://api.themoviedb.org/3/tv/popular?language=en-US&page=1

app.get('/load_popular', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };
        
        const response = await fetch(
            `https://api.themoviedb.org/3/${q}/popular?language=en-US&page=1`,
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});


// serials https://api.themoviedb.org/3/tv/top_rated?language=en-US&page=1
// movies https://api.themoviedb.org/3/movie/top_rated?language=en-US&page=1

app.get('/load_top_rated', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Chybí query parameter "q"' });

    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };

        
        const response = await fetch(
            `https://api.themoviedb.org/3/${q}/top_rated?language=en-US&page=1`,
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});



app.get('/load_now_playing', async (req, res) => {
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };

        
        const response = await fetch(
            'https://api.themoviedb.org/3/movie/now_playing?language=en-US&page=1',
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/load_upcoming', async (req, res) => {
    try {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0NDIzYzQwZWM5MmQyZDk0MDY3NGZmMGM2YmYxMDhkYyIsIm5iZiI6MTc2OTY3MzU3MS4zODMwMDAxLCJzdWIiOiI2OTdiMTM2M2E0Yjc3ZjMxNzhjMjE3NGQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.DkCb0ml_jIVGMcGglLHVdVeooRjwdBmZSVMR4dVdhuQ'
            }
        };

        
        const response = await fetch(
            'https://api.themoviedb.org/3/movie/upcoming?language=en-US&page=1',
            options
        );
        if (!response.ok) throw new Error('TMDB neodpovědělo');

        
        const data = await response.json();

        // pošli data klientovi
        res.json(data);
    } catch (err) {
        console.error('LOAD POPULAR ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

// ====================
// PROFILES API
// ====================

app.get('/api/profiles', (req, res) => {
    try {
        res.json(profilesDB.list());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profiles', (req, res) => {
    try {
        const { name, picture, theme } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        const profile = profilesDB.create({ name, picture: picture || null, theme: theme || 'dark' });
        res.status(201).json(profile);
    } catch (err) {
        res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
    }
});

app.get('/api/profiles/:id', (req, res) => {
    const profile = profilesDB.get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json(profile);
});

app.put('/api/profiles/:id', (req, res) => {
    try {
        const { name, picture, theme } = req.body;
        const changes = {};
        if (name !== undefined) changes.name = name;
        if (picture !== undefined) changes.picture = picture;
        if (theme !== undefined) changes.theme = theme;
        const profile = profilesDB.update(req.params.id, changes);
        if (!profile) return res.status(404).json({ error: 'Profile not found' });
        res.json(profile);
    } catch (err) {
        res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
    }
});

app.delete('/api/profiles/:id', (req, res) => {
    const deleted = profilesDB.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Profile not found' });
    favoritesDB.deleteByProfile(req.params.id);
    res.json({ message: 'Profile deleted' });
});

// ====================
// FAVORITES API
// ====================

app.get('/api/profiles/:id/favorites', (req, res) => {
    res.json(favoritesDB.list(req.params.id));
});

app.post('/api/profiles/:id/favorites', (req, res) => {
    try {
        const { tmdbId, mediaType, title, posterPath } = req.body;
        if (!tmdbId || !mediaType || !title) return res.status(400).json({ error: 'tmdbId, mediaType and title are required' });
        const fav = favoritesDB.add({ profileId: req.params.id, tmdbId, mediaType, title, posterPath: posterPath || null });
        res.status(201).json(fav);
    } catch (err) {
        res.status(err.code === 409 ? 409 : 400).json({ error: err.message });
    }
});

app.delete('/api/profiles/:id/favorites/:tmdbId/:mediaType', (req, res) => {
    const { id, tmdbId, mediaType } = req.params;
    const removed = favoritesDB.remove(id, Number(tmdbId), mediaType);
    if (!removed) return res.status(404).json({ error: 'Favorite not found' });
    res.json({ message: 'Removed from favorites' });
});

// ====================
// START SERVER
// ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server běží na portu ${PORT}`);
});