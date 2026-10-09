// Unit tests for src/js/taste.js — taste profile and "% shoda".
const test = require('node:test');
const assert = require('node:assert');
const { buildTaste, match } = require('../src/js/taste');

const SCIFI = 878, ACTION = 28, ROMANCE = 10749, COMEDY = 35, DRAMA = 18;

test('likes pull genres up, dislikes push them down', () => {
    const t = buildTaste([
        { key: 'movie:1', genres: [SCIFI, ACTION], signal: 'love' },
        { key: 'movie:2', genres: [SCIFI], signal: 'like' },
        { key: 'movie:3', genres: [ROMANCE, COMEDY], signal: 'dislike' },
        { key: 'tv:4', genres: [DRAMA], signal: 'watched' }
    ]);
    assert.strictEqual(t.genres[SCIFI], 1);
    assert.ok(t.genres[ACTION] > 0 && t.genres[ACTION] < 1);
    assert.ok(t.genres[ROMANCE] < 0);
    assert.deepStrictEqual(t.disliked, ['movie:3']);
    assert.deepStrictEqual(t.liked.sort(), ['movie:1', 'movie:2']);
    assert.strictEqual(t.n, 4);
});

test('one title counts once — its strongest signal, a dislike always wins', () => {
    const t = buildTaste([
        { key: 'movie:1', genres: [SCIFI], signal: 'watched' },
        { key: 'movie:1', genres: [SCIFI], signal: 'favorite' },
        { key: 'movie:1', genres: [SCIFI], signal: 'watched' },
        { key: 'movie:2', genres: [COMEDY], signal: 'favorite' },
        { key: 'movie:2', genres: [COMEDY], signal: 'dislike' },
        { key: 'movie:2', genres: [COMEDY], signal: 'love' }
    ]);
    assert.strictEqual(t.n, 2);
    assert.deepStrictEqual(t.disliked, ['movie:2']);
    assert.ok(t.genres[COMEDY] < 0 && t.genres[SCIFI] > 0);
});

test('match: higher for liked genres, lower for disliked; range 50–99', () => {
    const t = buildTaste([
        { key: 'm:1', genres: [SCIFI], signal: 'love' }, { key: 'm:2', genres: [SCIFI, ACTION], signal: 'like' },
        { key: 'm:3', genres: [ROMANCE], signal: 'dislike' }, { key: 'm:4', genres: [ACTION], signal: 'watched' }
    ]);
    const sf = match(t, { genre_ids: [SCIFI, ACTION], vote_average: 8.4 });
    const ro = match(t, { genre_ids: [ROMANCE], vote_average: 8.4 });
    const sfBad = match(t, { genre_ids: [SCIFI, ACTION], vote_average: 5.1 });
    assert.ok(sf >= 90, 'sci-fi ' + sf);
    assert.ok(ro < 75, 'romance ' + ro);
    assert.ok(sfBad < sf);
    for (const v of [sf, ro, sfBad]) assert.ok(v >= 50 && v <= 99);
    // details shape (genres: [{ id }]) works too
    assert.strictEqual(match(t, { genres: [{ id: SCIFI }, { id: ACTION }], vote_average: 8.4 }), sf);
});

test('no match until there is enough to go on', () => {
    const few = buildTaste([{ key: 'm:1', genres: [SCIFI], signal: 'love' }, { key: 'm:2', genres: [SCIFI], signal: 'like' }]);
    assert.strictEqual(match(few, { genre_ids: [SCIFI], vote_average: 8 }), null);
    assert.strictEqual(match(null, { genre_ids: [SCIFI] }), null);
    const ok = buildTaste([1, 2, 3].map(i => ({ key: 'm:' + i, genres: [DRAMA], signal: 'watched' })));
    assert.strictEqual(match(ok, { genre_ids: [], vote_average: 8 }), null);
    assert.ok(match(ok, { genre_ids: [DRAMA] }) > 70);
});
