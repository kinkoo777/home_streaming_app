// Choosing a film together (rooms.js): empty rooms, proposals, voting, permissions,
// starting the chosen film. The router runs in-process with fake TMDB / source
// finding, so no network is needed.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const rooms = require('../rooms');
const { sse, waitFor } = require('./server-harness');

const FILMS = {
    603: { tmdbId: 603, title: 'Matrix', year: '1999', posterPath: '/m.jpg', rating: 8.2, overview: 'Neo…' },
    157336: { tmdbId: 157336, title: 'Interstellar', year: '2014', posterPath: '/i.jpg', rating: 8.4, overview: 'Vesmír…' },
    666: { tmdbId: 666, title: 'Nikde ke zhlédnutí', year: '2001', posterPath: null, rating: null, overview: '' }
};
let findCalls = [];
const opts = {
    canCreate: true,
    checkPlayer: p => (p && p.source && Array.isArray(p.source.qualities) && p.source.qualities.length ? null : 'Chybí video'),
    resolveVideo: async () => { throw new Error('offline'); },
    handleStream: async (req, res) => res.status(204).end(),
    loadSubtitle: async () => 'WEBVTT\n',
    linkFor: (host, id) => ({ link: 'http://test/r/' + id, public: false }),
    tmdb: {
        search: async q => Object.values(FILMS).filter(f => f.title.toLowerCase().includes(q.toLowerCase())),
        trending: async () => [FILMS[603], FILMS[157336]],
        movie: async id => { if (!FILMS[id]) throw new Error('404'); return Object.assign({}, FILMS[id]); }
    },
    findMovie: async (tmdbId, prefs) => {
        findCalls.push({ tmdbId, prefs });
        await new Promise(r => setTimeout(r, 50));
        if (tmdbId === 666) throw new Error('Pro „Nikde ke zhlédnutí“ se nenašel žádný funkční zdroj');
        return { title: FILMS[tmdbId].title, tmdbId, mediaType: 'movie', posterPath: FILMS[tmdbId].posterPath, source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/' + tmdbId + '.mp4', label: '1080p', res: 1080 }] } };
    }
};

let server, base;
test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/rooms', rooms.router(opts));
    await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
    base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { server.closeAllConnections(); server.close(); });

const call = (method, url, body, member) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(member ? { 'X-Room-Member': member.id + '.' + member.secret } : {}) },
    body: body && JSON.stringify(body)
});
const last = (conn, type) => conn.got.filter(e => e.type === type).pop();

async function emptyRoom(prefs) {
    const res = await call('POST', '/api/rooms', { name: 'Vláďa', prefs });
    assert.strictEqual(res.status, 201);
    return res.json();
}
async function join(id, name) {
    return (await (await call('POST', `/api/rooms/${id}/join`, { name })).json()).member;
}
const events = (id, m) => sse(`${base}/api/rooms/${id}/events?m=${m.id}&s=${m.secret}`);

test('a room can start without a film', async () => {
    const room = await emptyRoom();
    const info = await (await call('GET', `/api/rooms/${room.id}`)).json();
    assert.deepStrictEqual([info.title, info.choosing], ['Vybíráme film', true]);
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        const hello = last(h, 'hello');
        assert.strictEqual(hello.video, null);
        assert.strictEqual(hello.state.playing, false);
        assert.deepStrictEqual(hello.poll, { items: [], finding: null, error: null });
        assert.strictEqual(hello.you.perms.suggest, true);
        // Nothing to stream yet.
        assert.strictEqual((await fetch(`${base}/api/rooms/${room.id}/stream/0?m=${room.member.id}&s=${room.member.secret}`)).status, 404);
    } finally { h.close(); }
});

test('film search for members: query, trending, permission', async () => {
    const room = await emptyRoom();
    const anna = await join(room.id, 'Anna');
    assert.strictEqual((await call('GET', `/api/rooms/${room.id}/search?q=matr`)).status, 401);
    const found = await (await call('GET', `/api/rooms/${room.id}/search?q=matr`, null, anna)).json();
    assert.deepStrictEqual(found.results.map(r => r.title), ['Matrix']);
    const tips = await (await call('GET', `/api/rooms/${room.id}/search?q=`, null, anna)).json();
    assert.strictEqual(tips.trending, true);
    assert.strictEqual(tips.results.length, 2);
    await call('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { suggest: false } } }, room.member);
    assert.strictEqual((await call('GET', `/api/rooms/${room.id}/search?q=matr`, null, anna)).status, 403);
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, anna)).status, 403);
});

test('proposing and voting: one vote each, changeable, proposer votes for own film', async () => {
    const room = await emptyRoom();
    const anna = await join(room.id, 'Anna');
    const bob = await join(room.id, 'Bob');
    const h = await events(room.id, room.member);
    try {
        // Metadata comes from TMDB, whatever the request says.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603, title: '<script>' }, anna)).status, 201);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, bob)).status, 409);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 99999 }, bob)).status, 404);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 'x' }, bob)).status, 400);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 157336 }, bob)).status, 201);
        await waitFor(() => { const p = last(h, 'poll'); return p && p.poll.items.length === 2; });
        let poll = last(h, 'poll').poll;
        assert.deepStrictEqual(poll.items.map(i => [i.title, i.votes, i.by.name]), [['Matrix', 1, 'Anna'], ['Interstellar', 1, 'Bob']]);
        assert.ok(h.got.some(e => e.type === 'chat' && /Anna navrhuje: Matrix \(1999\)/.test(e.message.text)));

        // Host votes Interstellar → it leads; Anna switches to Interstellar too.
        await call('POST', `/api/rooms/${room.id}/poll/m157336/vote`, null, room.member);
        const switched = await (await call('POST', `/api/rooms/${room.id}/poll/m157336/vote`, null, anna)).json();
        assert.strictEqual(switched.voted, true);
        await waitFor(() => last(h, 'poll').poll.items[0].votes === 3);
        poll = last(h, 'poll').poll;
        assert.deepStrictEqual(poll.items.map(i => [i.title, i.votes]), [['Interstellar', 3], ['Matrix', 0]]);
        assert.deepStrictEqual(poll.items[0].voters.map(v => v.name).sort(), ['Anna', 'Bob', 'Vláďa']);
        // Voting again for the same film takes the vote back.
        const back = await (await call('POST', `/api/rooms/${room.id}/poll/m157336/vote`, null, anna)).json();
        assert.strictEqual(back.voted, false);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/nope/vote`, null, anna)).status, 404);

        // Removing: not someone else's proposal; your own or as host yes.
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/poll/m603`, null, bob)).status, 403);
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/poll/m603`, null, anna)).status, 200);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, anna)).status, 201);
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/poll/m603`, null, room.member)).status, 200);
    } finally { h.close(); }
});

test('starting the chosen film: permission, finding, video for all, votes reset', async () => {
    findCalls = [];
    const room = await emptyRoom({ audioPref: 'original', qualityPref: '720' });
    const anna = await join(room.id, 'Anna');
    const a = await events(room.id, anna);
    try {
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 157336 }, anna);
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, room.member);
        await call('POST', `/api/rooms/${room.id}/poll/m157336/vote`, null, room.member);
        // Viewers can't start films by default.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m157336/play`, null, anna)).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m157336/play`, null, room.member)).status, 202);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m603/play`, null, room.member)).status, 409, 'one at a time');
        await waitFor(() => a.got.some(e => e.type === 'poll' && e.poll.finding === 'Interstellar'));
        await waitFor(() => last(a, 'video'));
        const v = last(a, 'video');
        assert.deepStrictEqual([v.video.title, v.state.playing, v.state.position], ['Interstellar', true, 0]);
        assert.deepStrictEqual(findCalls, [{ tmdbId: 157336, prefs: { audioPref: 'original', qualityPref: '720' } }]);
        await waitFor(() => { const p = last(a, 'poll'); return p && !p.poll.finding; });
        const poll = last(a, 'poll').poll;
        assert.deepStrictEqual(poll.items.map(i => [i.title, i.votes]), [['Matrix', 0]], 'played film leaves, votes reset');
        assert.ok(a.got.some(e => e.type === 'chat' && e.message.text === 'Hraje: Interstellar (2 hlasy)'));

        // A film with no working upload: the room is told, nothing else changes.
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 666 }, anna);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m666/play`, null, room.member)).status, 202);
        await waitFor(() => { const p = last(a, 'poll'); return p && p.poll.error; });
        assert.match(last(a, 'poll').poll.error, /nenašel žádný funkční zdroj/);
        assert.strictEqual(last(a, 'video').video.title, 'Interstellar');

        // Back to choosing: host only.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/lobby`, null, anna)).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/lobby`, null, room.member)).status, 200);
        await waitFor(() => last(a, 'video').video === null);
        assert.strictEqual(last(a, 'video').state.playing, false);
    } finally { a.close(); }
});

test('at most 20 films in the poll', async () => {
    const room = await emptyRoom();
    const anna = await join(room.id, 'Anna');
    const bob = await join(room.id, 'Bob');
    for (let i = 0; i < 20; i++) {
        FILMS[1000 + i] = { tmdbId: 1000 + i, title: 'Film ' + i, year: '2000', posterPath: null, rating: null, overview: '' };
        const who = i % 2 ? anna : room.member;              // (proposals are rate-limited per person)
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 1000 + i }, who)).status, 201);
    }
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, bob)).status, 400);
});
