// Kids profiles: the title filter (kids.js) and the parent PIN / kids switch API.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const kids = require('../kids');
const { startServer } = require('./server-harness');

test('only animated / family / kids titles, never horror, thriller, crime or war', () => {
    assert.ok(kids.kidsOk({ title: 'Ledové království', genre_ids: [16, 10751, 14] }));
    assert.ok(kids.kidsOk({ name: 'Bluey', genre_ids: [16, 10762] }));
    assert.ok(kids.kidsOk({ title: 'V hlavě', genres: [{ id: 16 }, { id: 10751 }, { id: 18 }] }));
    assert.ok(!kids.kidsOk({ title: 'Matrix', genre_ids: [28, 878] }));
    assert.ok(!kids.kidsOk({ title: 'Coraline', genre_ids: [16, 10751, 27] }), 'animated horror');
    assert.ok(!kids.kidsOk({ title: 'X', genre_ids: [16], adult: true }));
    assert.ok(!kids.kidsOk({ name: 'Herec', media_type: 'person' }));
});

test('filter middleware: lists filtered, a single grown-up title refused, others untouched', async () => {
    const app = express();
    app.use('/tmdb', kids.middleware);
    app.get('/tmdb/list', (req, res) => res.json({ page: 1, results: [{ id: 1, genre_ids: [16, 10751] }, { id: 2, genre_ids: [27] }] }));
    app.get('/tmdb/details', (req, res) => res.json({ id: 2, title: 'Vřískot', genres: [{ id: 27 }] }));
    app.get('/tmdb/season', (req, res) => res.json({ episodes: [{ episode_number: 1 }] }));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        assert.deepStrictEqual((await (await fetch(base + '/tmdb/list?kids=1')).json()).results.map(r => r.id), [1]);
        assert.deepStrictEqual((await (await fetch(base + '/tmdb/list')).json()).results.map(r => r.id), [1, 2]);
        assert.strictEqual((await fetch(base + '/tmdb/details?kids=1')).status, 403);
        assert.strictEqual((await fetch(base + '/tmdb/details')).status, 200);
        assert.strictEqual((await fetch(base + '/tmdb/season?kids=1')).status, 200);
    } finally { server.close(); }
});

test('parent PIN: set, verify, change needs the current one; kids → grown-up needs it', async () => {
    const srv = await startServer();
    const json = (method, url, body) => fetch(srv.base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    try {
        assert.deepStrictEqual(await (await json('GET', '/api/household')).json(), { parentPin: false });
        const kid = await (await json('POST', '/api/profiles', { name: 'Anička', kids: true })).json();
        assert.strictEqual(kid.kids, true);
        // No parent PIN yet → the switch is free
        assert.strictEqual((await (await json('PUT', `/api/profiles/${kid.id}`, { kids: false })).json()).kids, false);
        await json('PUT', `/api/profiles/${kid.id}`, { kids: true });

        assert.strictEqual((await json('PUT', '/api/household/parent-pin', { pin: '12a4' })).status, 400);
        assert.strictEqual((await json('PUT', '/api/household/parent-pin', { pin: '2468' })).status, 200);
        assert.deepStrictEqual(await (await json('GET', '/api/household')).json(), { parentPin: true });
        assert.deepStrictEqual(await (await json('POST', '/api/household/parent-pin/verify', { pin: '0000' })).json(), { ok: false });
        assert.deepStrictEqual(await (await json('POST', '/api/household/parent-pin/verify', { pin: '2468' })).json(), { ok: true });
        // Changing it needs the current one
        assert.strictEqual((await json('PUT', '/api/household/parent-pin', { pin: '1111' })).status, 403);
        assert.strictEqual((await json('PUT', '/api/household/parent-pin', { pin: '1357', currentPin: '2468' })).status, 200);

        const blocked = await json('PUT', `/api/profiles/${kid.id}`, { kids: false });
        assert.strictEqual(blocked.status, 403);
        assert.strictEqual((await blocked.json()).parentPinRequired, true);
        assert.strictEqual((await json('PUT', `/api/profiles/${kid.id}`, { kids: false, parentPin: '2468' })).status, 403);
        const ok = await json('PUT', `/api/profiles/${kid.id}`, { kids: false, parentPin: '1357' });
        assert.strictEqual((await ok.json()).kids, false);
        // Turning it on never needs it
        assert.strictEqual((await (await json('PUT', `/api/profiles/${kid.id}`, { kids: true })).json()).kids, true);
        assert.strictEqual((await json('PUT', `/api/profiles/${kid.id}`, { kids: 'yes' })).status, 400);
    } finally { srv.stop(); }
});
