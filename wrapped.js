// ================= FILMBOX WRAPPED =================
// A profile's year in FilmBox, for the story-style recap (src/js/wrapped.js):
// hours, films and episodes, the most watched titles, the best month, favourite
// weekday, longest run of days, the biggest binge (most episodes of one series in a
// day), the first thing of the year and what it loved. Pure — the server adds the
// top genre (TMDB) and the household ranking.

const { localDate } = require('./db');

const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const MIN_DAY = 5 * 60;            // a day counts with at least 5 minutes
const showName = t => String(t || '').replace(/\s*S\d{2}E\d{2,3}.*$/i, '').trim();

function computeWrapped({ history = [], watched = [], progress = {}, ratings = [] }, year) {
    year = String(year);
    const inYear = date => typeof date === 'string' && date.slice(0, 4) === year;
    const isoDay = iso => (iso ? localDate(new Date(iso)) : null);

    let seconds = 0;
    const split = { movie: 0, tv: 0 };
    const titles = {};
    const months = new Array(12).fill(0);
    const weekdays = new Array(7).fill(0);
    const activeDays = [];
    let first = null;

    history.filter(d => inYear(d.date)).sort((a, b) => a.date.localeCompare(b.date)).forEach(day => {
        let daySeconds = 0, dayTop = null;
        Object.keys(day.items || {}).forEach(key => {
            const it = day.items[key];
            const s = Number(it.seconds) || 0;
            daySeconds += s;
            split[it.mediaType === 'tv' ? 'tv' : 'movie'] += s;
            const t = titles[key] || (titles[key] = { tmdbId: it.tmdbId, mediaType: it.mediaType, title: it.title, posterPath: it.posterPath, seconds: 0, days: 0 });
            t.seconds += s;
            t.days++;
            if (it.title) t.title = it.title;
            if (it.posterPath) t.posterPath = it.posterPath;
            if (!dayTop || s > dayTop.s) dayTop = { s, key };
        });
        seconds += daySeconds;
        const [y, m, d] = day.date.split('-').map(Number);
        months[m - 1] += daySeconds;
        weekdays[new Date(y, m - 1, d).getDay()] += daySeconds;
        if (daySeconds >= MIN_DAY) {
            activeDays.push(day.date);
            if (!first && dayTop) first = { date: day.date, key: dayTop.key };
        }
    });

    // Longest run of consecutive days.
    let streak = 0, run = 0, prev = null;
    activeDays.forEach(date => {
        const [y, m, d] = date.split('-').map(Number);
        const t = Date.UTC(y, m - 1, d);
        run = prev != null && t - prev === 86400000 ? run + 1 : 1;
        streak = Math.max(streak, run);
        prev = t;
    });

    // Finished this year: films (watched list + finished progress), episodes (progress).
    const films = new Set();
    watched.filter(w => w.mediaType === 'movie' && inYear(isoDay(w.watchedAt))).forEach(w => films.add(String(w.tmdbId)));
    let episodes = 0;
    const bingeMap = {};
    Object.keys(progress).forEach(k => {
        const p = progress[k];
        if (!p || typeof p !== 'object') return;
        const done = p.finished || (p.duration && p.seconds / p.duration >= 0.9);
        const day = isoDay(p.updatedAt);
        if (!done || !inYear(day)) return;
        const m = /^(\d+):S(\d+)E(\d+)$/.exec(k);
        if (m) {
            episodes++;
            const b = day + '|' + m[1];
            bingeMap[b] = bingeMap[b] || { date: day, tmdbId: Number(m[1]), title: String(p.title || '').replace(/\s*S\d{2}E\d{2}.*$/i, ''), posterPath: p.posterPath || null, episodes: 0 };
            bingeMap[b].episodes++;
        } else if (p.mediaType !== 'tv') films.add(k);
    });
    const binge = Object.keys(bingeMap).map(k => bingeMap[k]).sort((a, b) => b.episodes - a.episodes || a.date.localeCompare(b.date))[0] || null;

    const top = Object.keys(titles).map(k => titles[k]).sort((a, b) => b.seconds - a.seconds);
    const bestMonth = seconds ? months.indexOf(Math.max.apply(null, months)) : null;
    const bestWeekday = seconds ? weekdays.indexOf(Math.max.apply(null, weekdays)) : null;
    const loved = ratings.filter(r => r.rating === 2 && inYear(isoDay(r.ratedAt))).slice(0, 5)
        .map(r => ({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, posterPath: r.posterPath }));

    return {
        year: Number(year),
        seconds: Math.round(seconds),
        movieSeconds: Math.round(split.movie),
        tvSeconds: Math.round(split.tv),
        films: films.size,
        episodes,
        days: activeDays.length,
        streak,
        months: months.map(Math.round),
        bestMonth,
        bestWeekday: bestWeekday == null ? null : WEEKDAYS[bestWeekday],
        topTitles: top.slice(0, 5).map(t => ({ tmdbId: t.tmdbId, mediaType: t.mediaType, title: showName(t.title), posterPath: t.posterPath, seconds: Math.round(t.seconds), days: t.days })),
        titlesCount: top.length,
        first: first && titles[first.key] ? { date: first.date, title: showName(titles[first.key].title), posterPath: titles[first.key].posterPath, mediaType: titles[first.key].mediaType } : null,
        binge: binge && binge.episodes >= 3 ? binge : null,
        loved,
        // for the server: titles to look the genres up for
        _titles: top.slice(0, 25).map(t => ({ tmdbId: t.tmdbId, mediaType: t.mediaType, seconds: t.seconds }))
    };
}

module.exports = { computeWrapped, WEEKDAYS };
