// In-memory response cache (TMDB, source searches), persisted to a JSON file so it
// survives restarts. Each entry carries its own lifetime.

const fs   = require('fs');
const path = require('path');

const MIN  = 60 * 1000;
const HOUR = 60 * MIN;
const DEFAULT_TTL = 5 * MIN;
const MAX_ENTRIES = 3000;          // oldest entries are dropped beyond this

// How long a TMDB answer stays fresh. Lists and search results change daily;
// titles, credits, seasons, people, collections and genres hardly ever do.
function tmdbTtl(tmdbPath) {
    const route = String(tmdbPath).split('?')[0];
    if (/^\/(search|trending|discover)\//.test(route)) return 30 * MIN;
    if (/^\/movie\/(popular|top_rated|now_playing|upcoming)$/.test(route)) return 30 * MIN;
    return 6 * HOUR;
}

function createCache(file) {
    const entries = new Map();     // key → { data, ts, ttl }
    const fresh = (e, now) => e && now - e.ts < (e.ttl || DEFAULT_TTL);

    // Load whatever is still fresh from a previous run.
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const now = Date.now();
        for (const [key, e] of Object.entries(raw)) if (fresh(e, now)) entries.set(key, e);
    } catch { /* no cache file yet — fine */ }

    let saveTimer = null;
    function persist() {
        if (saveTimer) return;         // debounce: at most one write per 10 s
        saveTimer = setTimeout(() => {
            saveTimer = null;
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                const now = Date.now();
                const obj = {};
                for (const [key, e] of entries) if (fresh(e, now)) obj[key] = e;
                const tmp = file + '.' + process.pid + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
                fs.renameSync(tmp, file);
            } catch (err) { console.error('Cache persist selhalo:', err.message); }
        }, 10000);
        if (saveTimer.unref) saveTimer.unref();   // don't keep the process alive
    }

    return {
        get(key) {
            const e = entries.get(key);
            if (fresh(e, Date.now())) return e.data;
            entries.delete(key);
            return null;
        },
        set(key, data, ttl = DEFAULT_TTL) {
            entries.delete(key);       // re-insert so Map order stays oldest-first
            entries.set(key, { data, ts: Date.now(), ttl });
            while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
            persist();
        },
        get size() { return entries.size; }
    };
}

module.exports = { createCache, tmdbTtl, DEFAULT_TTL, MAX_ENTRIES };
