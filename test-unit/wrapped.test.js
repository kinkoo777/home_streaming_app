// wrapped.js — a profile's year in FilmBox.
const test = require('node:test');
const assert = require('node:assert');
const { computeWrapped } = require('../wrapped');

const H = (date, items) => ({ profileId: 'p', date, items });
const it = (tmdbId, mediaType, title, seconds) => ({ [mediaType + ':' + tmdbId]: { tmdbId, mediaType, title, posterPath: '/' + tmdbId + '.jpg', seconds } });
const history = [
    H('2025-12-31', it(1, 'movie', 'Loňský film', 7200)),                    // other year
    H('2026-01-02', it(603, 'movie', 'Matrix', 8160)),
    H('2026-01-03', Object.assign(it(1399, 'tv', 'Hra o trůny S01E01', 3600), it(603, 'movie', 'Matrix', 600))),
    H('2026-01-04', it(1399, 'tv', 'Hra o trůny S01E02', 10800)),
    H('2026-01-05', it(1399, 'tv', 'Hra o trůny S01E05', 7200)),
    H('2026-03-10', it(1399, 'tv', 'Hra o trůny S02E01', 3600)),
    H('2026-03-11', it(66732, 'tv', 'Stranger Things', 120))                 // < 5 min: not an active day
];
const progress = {
    '1399:S01E01': { finished: true, updatedAt: '2026-01-03T20:00:00Z', title: 'Hra o trůny S01E01', posterPath: '/got.jpg' },
    '1399:S01E02': { finished: true, updatedAt: '2026-01-04T19:00:00Z', title: 'Hra o trůny S01E02' },
    '1399:S01E03': { finished: true, updatedAt: '2026-01-04T20:00:00Z', title: 'Hra o trůny S01E03' },
    '1399:S01E04': { seconds: 3000, duration: 3200, updatedAt: '2026-01-04T21:00:00Z', title: 'Hra o trůny S01E04' },
    '1399:S01E05': { seconds: 600, duration: 3200, updatedAt: '2026-01-05T21:00:00Z' },        // not finished
    '1399:S00E01': { finished: true, updatedAt: '2025-06-01T10:00:00Z' },                      // other year
    '157336': { finished: true, mediaType: 'movie', updatedAt: '2026-02-01T10:00:00Z' }
};
const watched = [{ tmdbId: 603, mediaType: 'movie', watchedAt: '2026-01-02T22:00:00Z' }, { tmdbId: 1, mediaType: 'movie', watchedAt: '2025-12-31T22:00:00Z' }];
const ratings = [{ tmdbId: 603, mediaType: 'movie', rating: 2, title: 'Matrix', ratedAt: '2026-01-02T23:00:00Z' }, { tmdbId: 5, mediaType: 'movie', rating: 1, title: 'X', ratedAt: '2026-01-02T23:00:00Z' }];

test('the year: time, films, episodes, top titles, months', () => {
    const w = computeWrapped({ history, watched, progress, ratings }, 2026);
    assert.strictEqual(w.seconds, 8160 + 3600 + 600 + 10800 + 7200 + 3600 + 120);
    assert.strictEqual(w.movieSeconds, 8760);
    assert.strictEqual(w.films, 2, 'Matrix (watched list) + Interstellar (finished progress)');
    assert.strictEqual(w.episodes, 4, 'S01E01–E04 (E04 past 90 %), not E05, not 2025');
    assert.deepStrictEqual(w.topTitles.map(t => t.title), ['Hra o trůny', 'Matrix', 'Stranger Things']);
    assert.strictEqual(w.topTitles[0].seconds, 25200);
    assert.strictEqual(w.months[0], 8160 + 3600 + 600 + 10800 + 7200);
    assert.strictEqual(w.bestMonth, 0);
    assert.deepStrictEqual(w.loved.map(l => l.title), ['Matrix']);
});

test('days, streak, binge, first title, favourite weekday', () => {
    const w = computeWrapped({ history, watched, progress, ratings }, 2026);
    assert.strictEqual(w.days, 5, '2.–5. 1. and 10. 3. (11. 3. is under 5 minutes)');
    assert.strictEqual(w.streak, 4);
    assert.deepStrictEqual([w.binge.date, w.binge.episodes, w.binge.title], ['2026-01-04', 3, 'Hra o trůny']);
    assert.deepStrictEqual([w.first.date, w.first.title], ['2026-01-02', 'Matrix']);
    assert.strictEqual(w.bestWeekday, 'neděle');       // 4. 1. 2026 is a Sunday (3 h)
});

test('an empty year', () => {
    const w = computeWrapped({}, 2030);
    assert.deepStrictEqual([w.seconds, w.films, w.episodes, w.days, w.streak, w.bestMonth, w.binge, w.first], [0, 0, 0, 0, 0, null, null, null]);
});
