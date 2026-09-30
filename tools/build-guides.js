// Builds src/guides/guides.json from tools/guides.spec.js using the TMDB API.
//   node tools/build-guides.js
// Needs TMDB_READ_TOKEN in .env (same as the server). Re-run when a new film
// in a franchise comes out — upcoming films are skipped until released.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const spec = require('./guides.spec');

const TOKEN = process.env.TMDB_READ_TOKEN;
if (!TOKEN) { console.error('Chybí TMDB_READ_TOKEN v .env'); process.exit(1); }
const today = new Date().toISOString().slice(0, 10);

async function tmdb(p) {
    const res = await fetch('https://api.themoviedb.org/3' + p, { headers: { Authorization: 'Bearer ' + TOKEN, accept: 'application/json' } });
    if (!res.ok) throw new Error('TMDB ' + res.status + ' for ' + p);
    return res.json();
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

async function resolveFilm(title, year) {
    const find = async withYear => (await tmdb(`/search/movie?language=cs-CZ&query=${encodeURIComponent(title)}${withYear ? '&primary_release_year=' + year : ''}`)).results || [];
    let results = await find(true);
    if (!results.length) results = await find(false);
    const exact = results.find(r => norm(r.original_title) === norm(title) && String(r.release_date || '').startsWith(String(year)));
    const pick = exact || results.find(r => String(r.release_date || '').startsWith(String(year))) || results[0];
    if (!pick) return null;
    return {
        id: pick.id,
        title: pick.title,
        original: pick.original_title,
        date: pick.release_date || '',
        poster: pick.poster_path || null,
        backdrop: pick.backdrop_path || null,
        votes: pick.vote_count || 0,
        exact: !!exact
    };
}

(async () => {
    const out = { generated: new Date().toISOString(), guides: [], collections: [] };

    for (const g of spec.guides) {
        console.log(`\n== ${g.title}`);
        const byKey = {};
        for (const [key, title, year] of g.films) {
            const f = await resolveFilm(title, year);
            if (!f) { console.log(`  ✗ ${key}: nenalezeno (${title} ${year})`); continue; }
            const released = f.date && f.date <= today;
            console.log(`  ${f.exact ? '✓' : '?'} ${key.padEnd(22)} ${String(f.id).padEnd(8)} ${f.date || '----'}  ${f.title}${f.exact ? '' : '   ← zkontrolovat: ' + f.original}${released ? '' : '   (zatím nevyšlo — vynecháno)'}`);
            if (released) byKey[key] = f;
        }
        const films = Object.values(byKey);
        const items = {};
        films.forEach(f => { items[f.id] = { title: f.title, year: parseInt(f.date.slice(0, 4), 10), poster: f.poster } });
        const release = films.slice().sort((a, b) => a.date.localeCompare(b.date)).map(f => f.id);
        const chrono = g.chrono ? g.chrono.filter(k => byKey[k]).map(k => byKey[k].id) : null;
        const hero = films.slice().sort((a, b) => b.votes - a.votes)[0];
        out.guides.push({
            id: g.id,
            title: g.title,
            subtitle: g.subtitle || '',
            note: g.note || '',
            backdrop: hero ? hero.backdrop : null,
            poster: hero ? hero.poster : null,
            items,
            orders: chrono ? { release, chrono } : { release }
        });
    }

    console.log('\n== Filmové série');
    for (const id of spec.collections) {
        try {
            const c = await tmdb(`/collection/${id}?language=cs-CZ`);
            const parts = (c.parts || []).filter(p => p.release_date && p.release_date <= today)
                .sort((a, b) => a.release_date.localeCompare(b.release_date));
            console.log(`  ✓ ${String(id).padEnd(8)} ${c.name} (${parts.length} filmů)`);
            if (parts.length < 2) continue;
            out.collections.push({ id, name: String(c.name || '').replace(/\s*\((kolekce|collection)\)\s*$/i, ''), poster: c.poster_path || null, backdrop: c.backdrop_path || null, parts: parts.map(p => p.id) });
        } catch (e) {
            console.log(`  ✗ ${id}: ${e.message}`);
        }
    }

    const file = path.join(__dirname, '..', 'src', 'guides', 'guides.json');   // (src/data/ is git-ignored)
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log(`\nZapsáno ${path.relative(process.cwd(), file)}: ${out.guides.length} průvodců, ${out.collections.length} sérií`);
})().catch(e => { console.error(e); process.exit(1); });
