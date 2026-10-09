// ================= CHYTRÉ "CO DNES?" (AI picks) =================
// "Něco vtipného na dva, do dvou hodin, s CZ dabingem" → five titles that fit, each with
// one sentence why. Claude gets what the profile liked, disliked and watched (titles
// only) and answers in a fixed JSON shape; every title is then looked up on TMDB so
// the page gets real cards. Optional: needs ANTHROPIC_API_KEY in .env (paid per use,
// roughly a few hellers per question). At most 20 questions per profile per hour.

const MODEL = process.env.FILMBOX_AI_MODEL || 'claude-opus-5-5';
const PER_HOUR = 20;

const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['picks'],
    properties: {
        picks: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'original_title', 'year', 'type', 'why'],
                properties: {
                    title: { type: 'string', description: 'Czech title if one exists, else the original' },
                    original_title: { type: 'string' },
                    year: { type: 'integer' },
                    type: { type: 'string', enum: ['movie', 'tv'] },
                    why: { type: 'string', description: 'One short Czech sentence: why this fits the request' }
                }
            }
        }
    }
};

const SYSTEM = `Jsi filmový poradce domácí streamovací aplikace FilmBox (Česko). Na přání uživatele vybereš 5 filmů nebo seriálů, které se k němu nejlíp hodí.
- Řiď se přáním (nálada, žánr, délka, s kým se dívá, dabing). Délku filmu ber vážně.
- Přihlédni k jeho vkusu (co se mu líbilo / nelíbilo). Nenabízej nic z toho, co už viděl nebo co se mu nelíbilo.
- Jen skutečné, existující tituly s přesným rokem vydání; mix známých a méně okoukaných.
- "why" piš česky, jedna krátká věta, osobně a konkrétně (proč právě tohle teď).`;

// deps: { tmdbFetch(path), kidsOk(item) }
function createPicker(deps) {
    let client = null;
    const used = new Map();          // profileId → [timestamps]
    const enabled = () => !!process.env.ANTHROPIC_API_KEY;
    function getClient() {
        if (!client) {
            const sdk = require('@anthropic-ai/sdk');
            const Anthropic = sdk.Anthropic || sdk.default || sdk;
            client = new Anthropic();
        }
        return client;
    }

    async function resolve(p, kids) {
        const type = p.type === 'tv' ? 'tv' : 'movie';
        const yearKey = type === 'tv' ? 'first_air_date_year' : 'year';
        for (const q of [...new Set([p.title, p.original_title].filter(Boolean))]) {
            let d;
            try { d = await deps.tmdbFetch(`/search/${type}?language=cs-CZ&include_adult=false&query=${encodeURIComponent(q)}${p.year ? `&${yearKey}=${p.year}` : ''}`); }
            catch (e) { continue; }
            const hit = (d.results || []).filter(r => r.poster_path)[0];
            if (!hit) continue;
            if (kids && !deps.kidsOk(Object.assign({ media_type: type }, hit))) return null;
            return Object.assign({}, hit, { media_type: type, why: p.why });
        }
        return null;
    }

    // ctx: { liked, disliked, watched, lists: titles; kids: bool }
    async function pick(profileId, query, ctx) {
        if (!enabled()) throw Object.assign(new Error('Chytré doporučení není nastavené (chybí ANTHROPIC_API_KEY)'), { code: 501 });
        const now = Date.now();
        const recent = (used.get(profileId) || []).filter(t => now - t < 3600 * 1000);
        if (recent.length >= PER_HOUR) throw Object.assign(new Error('Na tuhle hodinu už stačilo — zkuste to za chvíli'), { code: 429 });
        recent.push(now);
        used.set(profileId, recent);

        const list = (label, xs) => xs && xs.length ? `${label}: ${xs.slice(0, 40).join('; ')}` : '';
        const profile = [
            ctx.kids ? 'POZOR: dětský profil — vybírej jen pohádky, animované a rodinné tituly vhodné pro děti.' : '',
            list('Líbilo se mu', ctx.liked), list('Nelíbilo se mu', ctx.disliked),
            list('Už viděl', ctx.watched), list('Má v seznamu', ctx.lists)
        ].filter(Boolean).join('\n');
        const res = await getClient().beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
            system: SYSTEM,
            messages: [{ role: 'user', content: `${profile ? 'O divákovi:\n' + profile + '\n\n' : ''}Přání: ${query}` }]
        });
        if (res.stop_reason === 'refusal') throw Object.assign(new Error('Na tohle radu nedám — zkuste to popsat jinak'), { code: 422 });
        const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { throw Object.assign(new Error('Odpověď se nepodařilo přečíst — zkuste to znovu'), { code: 502 }); }
        const picks = (await Promise.all((parsed.picks || []).slice(0, 6).map(p => resolve(p, ctx.kids)))).filter(Boolean);
        const seen = new Set();
        return picks.filter(m => { const k = m.media_type + m.id; if (seen.has(k)) return false; seen.add(k); return true; });
    }

    return { enabled, pick };
}

module.exports = { createPicker, SCHEMA, SYSTEM };
