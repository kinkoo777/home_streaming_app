// ================= KIDS PROFILES =================
// The page adds ?kids=1 to every /tmdb/ call of a kids profile. Lists then keep only
// animated / family / kids titles without horror, thriller, crime or war; a single
// title that isn't one is refused (403). server.js also swaps the home rows for
// family "discover" lists (KIDS_DISCOVER).

const KIDS_GENRES = [16, 10751, 10762];            // Animation, Family, Kids (TV)
const NOT_FOR_KIDS = [27, 53, 80, 10752, 10768];   // Horror, Thriller, Crime, War, War & Politics
const KIDS_DISCOVER = 'include_adult=false&without_genres=' + NOT_FOR_KIDS.join(',');

function kidsOk(m) {
    if (!m || m.adult || m.media_type === 'person') return false;
    const g = Array.isArray(m.genre_ids) ? m.genre_ids : (m.genres || []).map(x => x && x.id);
    return g.some(x => KIDS_GENRES.includes(x)) && !g.some(x => NOT_FOR_KIDS.includes(x));
}

function middleware(req, res, next) {
    if (req.query.kids !== '1') return next();
    req.kids = true;
    const json = res.json.bind(res);
    res.json = body => {
        if (res.statusCode >= 400 || !body || typeof body !== 'object') return json(body);
        if (Array.isArray(body.results)) return json(Object.assign({}, body, { results: body.results.filter(kidsOk) }));
        if (Array.isArray(body.parts)) return json(Object.assign({}, body, { parts: body.parts.filter(kidsOk) }));
        if (Array.isArray(body.genres) && (body.title || body.name) && !kidsOk(body)) {
            res.status(403);
            return json({ error: 'Tohle není pro dětský profil', kids: true });
        }
        return json(body);
    };
    next();
}

module.exports = { kidsOk, middleware, KIDS_GENRES, NOT_FOR_KIDS, KIDS_DISCOVER };
