// Watching stats for one profile, from the watch history (seconds played per day
// and title, see db.js), the watched list and the per-episode progress store.
// Pure: the server adds genre shares from TMDB on top.

const { localDate } = require('./db');

const PERIODS = ['month', 'year', 'all'];

// First day of the period as 'YYYY-MM-DD' (null = everything).
function periodStart(period, now) {
    const today = localDate(now);
    if (period === 'month') return today.slice(0, 8) + '01';
    if (period === 'year') return today.slice(0, 5) + '01-01';
    return null;
}

// 'YYYY-MM' for the 12 months ending with the current one, oldest first.
function lastTwelveMonths(now) {
    const out = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push(localDate(d).slice(0, 7));
    }
    return out;
}

function nextDay(date) {
    const [y, m, d] = date.split('-').map(Number);
    return localDate(new Date(y, m - 1, d + 1));
}

function computeStats({ history = [], watched = [], progress = {} }, period = 'month', now = new Date()) {
    const from = periodStart(period, now);
    const inPeriod = date => !from || date >= from;
    const isoDay = iso => (iso ? localDate(new Date(iso)) : null);

    let totalSeconds = 0;
    const split = { movie: 0, tv: 0 };
    const titles = {};
    const days = [];
    const months = lastTwelveMonths(now);
    const byMonth = {};
    months.forEach(m => { byMonth[m] = 0; });

    for (const day of history) {
        let daySeconds = 0;
        for (const key of Object.keys(day.items || {})) {
            const it = day.items[key];
            const s = Number(it.seconds) || 0;
            daySeconds += s;
            if (!inPeriod(day.date)) continue;
            totalSeconds += s;
            split[it.mediaType === 'tv' ? 'tv' : 'movie'] += s;
            const t = titles[key] || (titles[key] = { tmdbId: it.tmdbId, mediaType: it.mediaType, title: it.title, posterPath: it.posterPath, seconds: 0 });
            t.seconds += s;
            if (it.title) t.title = it.title;
            if (it.posterPath) t.posterPath = it.posterPath;
        }
        const month = day.date.slice(0, 7);
        if (month in byMonth) byMonth[month] += daySeconds;
        if (daySeconds > 0 && inPeriod(day.date)) days.push(day.date);
    }

    // Longest run of consecutive days with something watched.
    days.sort();
    let streak = 0, run = 0, prev = null;
    for (const d of days) {
        run = prev && nextDay(prev) === d ? run + 1 : 1;
        if (run > streak) streak = run;
        prev = d;
    }

    // Finished titles come from the library, so they count from before stats existed too.
    const finishedMovies = watched.filter(w => w.mediaType === 'movie' && inPeriod(isoDay(w.watchedAt) || '')).length;
    const shows = new Set();
    let finishedEpisodes = 0;
    for (const key of Object.keys(progress)) {
        const p = progress[key];
        if (!p || typeof p !== 'object' || !p.finished || !/:S\d+E\d+$/.test(key)) continue;
        if (!inPeriod(isoDay(p.updatedAt) || '')) continue;
        finishedEpisodes++;
        shows.add(key.split(':')[0]);
    }

    const allTitles = Object.keys(titles).map(k => titles[k]).sort((a, b) => b.seconds - a.seconds);
    return {
        period,
        from,
        totalSeconds,
        daysWatched: days.length,
        longestStreak: streak,
        split,
        byMonth: months.map(m => ({ month: m, seconds: byMonth[m] })),
        topTitles: allTitles.slice(0, 10),
        titles: allTitles,
        finishedMovies,
        finishedEpisodes,
        finishedShows: shows.size
    };
}

module.exports = { computeStats, periodStart, PERIODS };
