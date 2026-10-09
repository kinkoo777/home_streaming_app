// ================= ČSFD RATING =================
// The ČSFD (csfd.cz) rating of a film / series, shown next to TMDB's. Search by the
// Czech title (then the original one), pick the result with the right year, read
// the rating from the film page — its JSON-LD aggregateRating first, the visible
// "85%" box otherwise. Best effort: anything unexpected → null, the page shows no
// ČSFD badge. Results are cached by the caller (server.js).

const BASE = 'https://www.csfd.cz';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'cs-CZ,cs;q=0.9',
    Accept: 'text/html,application/xhtml+xml'
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').trim();

// Search page → [{ id, path, title, year }], in page order.
function parseSearch(html) {
    const out = [];
    const re = /<a\s+href="(\/film\/(\d+)-[^"\/]*\/)"[^>]*class="[^"]*film-title-name[^"]*"[^>]*>([^<]+)<\/a>([\s\S]{0,400}?)(?=<a\s+href="\/film\/|$)/g;
    let m;
    while ((m = re.exec(String(html || '')))) {
        const year = /\((\d{4})\)/.exec(m[4]);
        if (out.some(r => r.id === m[2])) continue;
        out.push({ id: m[2], path: m[1], title: decode(m[3]), year: year ? parseInt(year[1], 10) : null });
    }
    return out;
}

// Best search result for the title and year (±1 — premieres differ by country).
function pickResult(results, names, year) {
    const wanted = (names || []).map(norm).filter(Boolean);
    const yearOk = r => !year || (r.year && Math.abs(r.year - year) <= 1);
    return results.filter(r => yearOk(r) && wanted.indexOf(norm(r.title)) >= 0)[0] ||
        (year ? results.filter(r => r.year === year)[0] : null) ||
        null;
}

// Film page → rating 0–100 (or null: not enough votes / unknown page).
function parseRating(html) {
    html = String(html || '');
    const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (const b of blocks) {
        try {
            const json = JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').trim());
            const items = Array.isArray(json) ? json : [json];
            for (const it of items) {
                const ar = it && it.aggregateRating;
                if (ar && ar.ratingValue != null) {
                    const best = Number(ar.bestRating) || 100;
                    const v = Number(ar.ratingValue) / best * 100;
                    if (Number.isFinite(v)) return { rating: Math.round(v), votes: Number(ar.ratingCount) || null };
                }
            }
        } catch (e) { /* not this block */ }
    }
    const box = /class="[^"]*film-rating-average[^"]*"[^>]*>\s*(\d{1,3})\s*%/.exec(html);
    if (box) return { rating: parseInt(box[1], 10), votes: null };
    return null;
}

async function get(url, fetchImpl) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
        const r = await (fetchImpl || fetch)(url, { headers: HEADERS, signal: ctl.signal, redirect: 'follow' });
        if (!r.ok) throw new Error('ČSFD ' + r.status);
        return { html: await r.text(), url: r.url || url };
    } finally { clearTimeout(t); }
}

// { title, original, year } → { rating, votes, url } | null
async function lookup({ title, original, year }, fetchImpl) {
    const names = [title, original].filter(Boolean);
    for (const q of [...new Set(names)]) {
        const page = await get(BASE + '/hledat/?q=' + encodeURIComponent(q), fetchImpl);
        // A unique hit can redirect straight to the film page.
        if (/\/film\/\d+-/.test(page.url) && !/\/hledat\//.test(page.url)) {
            const r = parseRating(page.html);
            return r ? Object.assign({ url: page.url }, r) : null;
        }
        const hit = pickResult(parseSearch(page.html), names, year);
        if (!hit) continue;
        const film = await get(BASE + hit.path, fetchImpl);
        const r = parseRating(film.html);
        return r ? Object.assign({ url: BASE + hit.path }, r) : null;
    }
    return null;
}

module.exports = { lookup, parseSearch, pickResult, parseRating };
