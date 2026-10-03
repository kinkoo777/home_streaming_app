// Unit tests for stats.js — watching stats from history, watched list and progress.
const test = require('node:test');
const assert = require('node:assert');
const { computeStats, periodStart } = require('../stats');

const NOW = new Date(2026, 9, 15, 20, 0);          // 15 Oct 2026, local time
const day = (date, items) => ({ profileId: 'p', date, items });
const movie = (id, seconds, title) => ({ ['movie:' + id]: { seconds, tmdbId: id, mediaType: 'movie', title, posterPath: null } });
const show = (id, seconds, title) => ({ ['tv:' + id]: { seconds, tmdbId: id, mediaType: 'tv', title, posterPath: null } });

const history = [
    day('2025-09-30', movie(1, 7200, 'Old film')),                         // outside the 12-month window
    day('2026-01-10', movie(2, 5400, 'Dune')),
    day('2026-10-01', Object.assign(show(10, 3000, 'Kancl'), movie(3, 600, 'Short'))),
    day('2026-10-02', show(10, 1800, 'Kancl')),
    day('2026-10-03', show(10, 1200, 'Kancl')),
    day('2026-10-07', movie(3, 6000, 'Short'))
];

test('periodStart', () => {
    assert.strictEqual(periodStart('month', NOW), '2026-10-01');
    assert.strictEqual(periodStart('year', NOW), '2026-01-01');
    assert.strictEqual(periodStart('all', NOW), null);
});

test('month: totals, split, days, streak, top titles', () => {
    const s = computeStats({ history }, 'month', NOW);
    assert.strictEqual(s.totalSeconds, 3000 + 600 + 1800 + 1200 + 6000);
    assert.deepStrictEqual(s.split, { movie: 6600, tv: 6000 });
    assert.strictEqual(s.daysWatched, 4);
    assert.strictEqual(s.longestStreak, 3);                                 // 1–3 Oct
    assert.deepStrictEqual(s.topTitles.map(t => [t.title, t.seconds]), [['Short', 6600], ['Kancl', 6000]]);
});

test('year and all widen the period; byMonth always covers the last 12 months', () => {
    assert.strictEqual(computeStats({ history }, 'year', NOW).totalSeconds, 12600 + 5400);
    assert.strictEqual(computeStats({ history }, 'all', NOW).totalSeconds, 12600 + 5400 + 7200);
    const s = computeStats({ history }, 'month', NOW);
    assert.strictEqual(s.byMonth.length, 12);
    assert.strictEqual(s.byMonth[0].month, '2025-11');
    assert.strictEqual(s.byMonth[11].month, '2026-10');
    assert.strictEqual(s.byMonth[11].seconds, 12600);
    assert.strictEqual(s.byMonth.find(m => m.month === '2026-01').seconds, 5400);
});

test('finished films and episodes come from the library', () => {
    const watched = [
        { mediaType: 'movie', watchedAt: new Date(2026, 9, 5).toISOString() },
        { mediaType: 'movie', watchedAt: new Date(2026, 3, 5).toISOString() },
        { mediaType: 'tv', watchedAt: new Date(2026, 9, 5).toISOString() }
    ];
    const progress = {
        '10:S01E01': { finished: true, updatedAt: new Date(2026, 9, 1).toISOString() },
        '10:S01E02': { finished: true, updatedAt: new Date(2026, 9, 2).toISOString() },
        '20:S02E01': { finished: true, updatedAt: new Date(2026, 9, 3).toISOString() },
        '20:S02E02': { finished: false, updatedAt: new Date(2026, 9, 3).toISOString() },
        '30:S01E01': { finished: true, updatedAt: new Date(2026, 1, 3).toISOString() },
        '555': { seconds: 100, updatedAt: new Date(2026, 9, 3).toISOString() }
    };
    const month = computeStats({ watched, progress }, 'month', NOW);
    assert.strictEqual(month.finishedMovies, 1);
    assert.strictEqual(month.finishedEpisodes, 3);
    assert.strictEqual(month.finishedShows, 2);
    const year = computeStats({ watched, progress }, 'year', NOW);
    assert.strictEqual(year.finishedMovies, 2);
    assert.strictEqual(year.finishedEpisodes, 4);
});

test('empty profile', () => {
    const s = computeStats({}, 'month', NOW);
    assert.strictEqual(s.totalSeconds, 0);
    assert.strictEqual(s.longestStreak, 0);
    assert.deepStrictEqual(s.topTitles, []);
});
