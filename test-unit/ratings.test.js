// Ratings API (👎 / 👍 / 👍👍), taste endpoint shape, ČSFD / providers validation.
// server.js with an empty data folder; TMDB is unreachable, so taste has no genres.
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./server-harness');

let server, base;
test.before(async () => { server = await startServer(); base = server.base; });
test.after(() => { if (server) server.stop(); });

const json = (method, url, body, headers = {}) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body)
});
async function newProfile(name) {
    const res = await json('POST', '/api/profiles', { name });
    return (await res.json()).id;
}

test('rate, change, list newest first, remove', async () => {
    const id = await newProfile('Hodnotitel');
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: 2, title: 'Matrix', posterPath: '/m.jpg' })).status, 200);
    await json('PUT', `/api/profiles/${id}/ratings/tv/1399`, { rating: -1, title: 'Hra o trůny' });
    await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: 1, title: 'Matrix' });
    let list = await (await json('GET', `/api/profiles/${id}/ratings`)).json();
    assert.deepStrictEqual(list.map(r => [r.mediaType, r.tmdbId, r.rating]), [['movie', 603, 1], ['tv', 1399, -1]]);
    const del = await (await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: 0 })).json();
    assert.deepStrictEqual(del, { removed: true });
    list = await (await json('GET', `/api/profiles/${id}/ratings`)).json();
    assert.strictEqual(list.length, 1);
});

test('bad ratings are refused', async () => {
    const id = await newProfile('Špatně');
    for (const [url, body] of [
        [`/api/profiles/${id}/ratings/movie/603`, { rating: 5, title: 'X' }],
        [`/api/profiles/${id}/ratings/movie/603`, { rating: 1 }],
        [`/api/profiles/${id}/ratings/book/603`, { rating: 1, title: 'X' }],
        [`/api/profiles/${id}/ratings/movie/abc`, { rating: 1, title: 'X' }]
    ]) assert.strictEqual((await json('PUT', url, body)).status, 400, JSON.stringify(body) + ' ' + url);
});

test('ratings are in the export, gone after wiping, and behind the PIN', async () => {
    const id = await newProfile('Export');
    await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: 2, title: 'Matrix' });
    const exp = await (await json('GET', `/api/profiles/${id}/export`)).json();
    assert.strictEqual(exp.ratings.length, 1);
    await json('DELETE', `/api/profiles/${id}/data`);
    assert.deepStrictEqual(await (await json('GET', `/api/profiles/${id}/ratings`)).json(), []);
    await json('POST', `/api/profiles/${id}/pin`, { pin: '1234' });
    assert.strictEqual((await json('GET', `/api/profiles/${id}/ratings`)).status, 401);
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: 1, title: 'M' })).status, 401);
});

test('taste answers even without TMDB; ČSFD and providers check their input', async () => {
    const id = await newProfile('Chuť');
    await json('PUT', `/api/profiles/${id}/ratings/movie/603`, { rating: -1, title: 'Matrix' });
    const t = await (await json('GET', `/api/profiles/${id}/taste`)).json();
    assert.deepStrictEqual(t.disliked, ['movie:603']);
    assert.strictEqual(typeof t.genres, 'object');
    assert.strictEqual((await json('GET', '/api/csfd')).status, 400);
    assert.strictEqual((await json('GET', '/tmdb/providers?id=603')).status, 400);
});
