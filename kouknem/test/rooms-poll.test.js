// Choosing a film together (rooms.js): empty rooms, proposals, voting, permissions,
// starting the chosen film. The router runs in-process with fake TMDB / source
// finding, so no network is needed.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const rooms = require('../lib/rooms');
const { sse, waitFor } = require('./server-harness');

const FILMS = {
    603: { tmdbId: 603, title: 'Matrix', year: '1999', posterPath: '/m.jpg', rating: 8.2, overview: 'Neo…' },
    157336: { tmdbId: 157336, title: 'Interstellar', year: '2014', posterPath: '/i.jpg', rating: 8.4, overview: 'Vesmír…' },
    666: { tmdbId: 666, title: 'Nikde ke zhlédnutí', year: '2001', posterPath: null, rating: null, overview: '' }
};
let findCalls = [];
const blocked = new Set();        // the notice-and-action blocklist, as the server would see it
const opts = {
    canCreate: true,
    roomsPerIp: 1000,
    checkPlayer: p => (!(p && p.source && Array.isArray(p.source.qualities) && p.source.qualities.length) ? 'Chybí video'
        : blocked.has(p.source.pageUrl) ? 'Video bylo odstraněno na základě oznámení' : null),
    resolveVideo: async () => { throw new Error('offline'); },
    handleStream: async (req, res) => res.status(204).end(),
    loadSubtitle: async () => 'WEBVTT\n',
    linkFor: (host, id) => ({ link: 'http://test/r/' + id, public: false }),
    tmdb: {
        search: async q => Object.values(FILMS).filter(f => f.title.toLowerCase().includes(q.toLowerCase())),
        trending: async () => [FILMS[603], FILMS[157336]],
        movie: async id => { if (!FILMS[id]) throw new Error('404'); return Object.assign({}, FILMS[id]); }
    },
    // Two uploads per film: a dubbed 1080p one (recommended) and an original 720p one.
    listSources: async what => ({
        title: FILMS[what.tmdbId].title,
        sources: [
            { url: 'https://prehrajto.cz/' + what.tmdbId + '-cz', title: FILMS[what.tmdbId].title + ' CZ dabing 1080p', res: 1080, dub: true, subs: false, source: 'prehrajto', duration: '2:10:00', size: '4 GB' },
            { url: 'https://prehrajto.cz/' + what.tmdbId + '-en', title: FILMS[what.tmdbId].title + ' 720p titulky', res: 720, dub: false, subs: true, source: 'prehrajto', duration: '2:10:00', size: '2 GB' }
        ]
    }),
    findPlayer: async (what, prefs, url) => {
        findCalls.push({ tmdbId: what.tmdbId, prefs, url });
        await new Promise(r => setTimeout(r, 50));
        if (what.tmdbId === 666) throw new Error('Pro „Nikde ke zhlédnutí“ se nenašel žádný funkční zdroj');
        const list = await opts.listSources(what);
        const pick = url ? list.sources.find(x => x.url === url) : list.sources[0];
        if (!pick) throw new Error('Tento zdroj už není v nabídce — načtěte seznam znovu');
        return { title: FILMS[what.tmdbId].title, tmdbId: what.tmdbId, mediaType: 'movie', posterPath: FILMS[what.tmdbId].posterPath,
            source: { pageUrl: pick.url, qualities: [{ src: 'https://cdn1.premiumcdn.net/' + pick.url.split('/').pop() + '.mp4', label: pick.res + 'p', res: pick.res }] } };
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
        assert.deepStrictEqual(findCalls, [{ tmdbId: 157336, prefs: { audioPref: 'original', qualityPref: '720' }, url: null }]);
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

test('choosing the upload: list, play a chosen one, switch mid-film keeping the position', async () => {
    findCalls = [];
    const room = await emptyRoom();
    const anna = await join(room.id, 'Anna');
    const a = await events(room.id, anna);
    try {
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, anna);
        // The list is for those who may start films.
        assert.strictEqual((await call('GET', `/api/rooms/${room.id}/poll/m603/sources`, null, anna)).status, 403);
        const list = await (await call('GET', `/api/rooms/${room.id}/poll/m603/sources`, null, room.member)).json();
        assert.deepStrictEqual(list.sources.map(x => [x.title, x.dub, x.res, x.current]), [['Matrix CZ dabing 1080p', true, 1080, false], ['Matrix 720p titulky', false, 720, false]]);
        assert.strictEqual(list.recommended, 'https://prehrajto.cz/603-cz');
        assert.strictEqual((await call('GET', `/api/rooms/${room.id}/sources`, null, room.member)).status, 400, 'no film playing yet');

        // Start it with the original 720p upload.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m603/play`, { url: 'https://prehrajto.cz/603-en' }, room.member)).status, 202);
        await waitFor(() => last(a, 'video') && last(a, 'video').video);
        assert.strictEqual(last(a, 'video').video.qualities[0].src, 'https://cdn1.premiumcdn.net/603-en.mp4');
        assert.strictEqual(findCalls[0].url, 'https://prehrajto.cz/603-en');

        // The playing film's list marks the current upload.
        const now = await (await call('GET', `/api/rooms/${room.id}/sources`, null, room.member)).json();
        assert.deepStrictEqual(now.sources.map(x => x.current), [false, true]);
        assert.strictEqual((await call('GET', `/api/rooms/${room.id}/sources`, null, anna)).status, 403);

        // Pause at 300 s, then switch to the dubbed upload: same position, still paused.
        await call('POST', `/api/rooms/${room.id}/action`, { type: 'pause', position: 300 }, room.member);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/source`, { url: 'https://prehrajto.cz/603-cz' }, anna)).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/source`, {}, room.member)).status, 400);
        const before = a.got.filter(e => e.type === 'video').length;
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/source`, { url: 'https://prehrajto.cz/603-cz' }, room.member)).status, 202);
        await waitFor(() => a.got.some(e => e.type === 'switching' && e.by === 'Vláďa'));
        await waitFor(() => a.got.filter(e => e.type === 'video').length > before);
        const v = last(a, 'video');
        assert.strictEqual(v.video.qualities[0].src, 'https://cdn1.premiumcdn.net/603-cz.mp4');
        assert.deepStrictEqual([v.state.position, v.state.playing], [300, false]);
        assert.ok(a.got.some(e => e.type === 'chat' && e.message.text === 'Jiný zdroj: Matrix'));

        // An upload that's no longer offered: everyone is told, nothing changes.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/source`, { url: 'https://prehrajto.cz/gone' }, room.member)).status, 202);
        await waitFor(() => a.got.some(e => e.type === 'switching' && e.error));
        assert.match(a.got.filter(e => e.type === 'switching' && e.error).pop().error, /už není v nabídce/);
        assert.strictEqual(last(a, 'video').video.qualities[0].src, 'https://cdn1.premiumcdn.net/603-cz.mp4');
    } finally { a.close(); }
});

test('creating rooms is rate limited per address', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/rooms', rooms.router(Object.assign({}, opts, { roomsPerIp: 2 })));
    const srv = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    try {
        const url = 'http://127.0.0.1:' + srv.address().port + '/api/rooms';
        const post = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
        assert.deepStrictEqual([(await post()).status, (await post()).status, (await post()).status], [201, 201, 429]);
    } finally { srv.closeAllConnections(); srv.close(); }
});

test('a blocked upload stops in every room playing it and cannot be refreshed back', async () => {
    const room = await emptyRoom();
    const anna = await join(room.id, 'Anna');
    const a = await events(room.id, anna);
    try {
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 603 }, room.member);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/poll/m603/play`, { url: 'https://prehrajto.cz/603-cz' }, room.member)).status, 202);
        await waitFor(() => last(a, 'video') && last(a, 'video').video);

        // Another URL being blocked changes nothing.
        rooms.dropBlocked(u => u === 'https://prehrajto.cz/other');
        await new Promise(r => setTimeout(r, 50));
        assert.ok(last(a, 'video').video);

        blocked.add('https://prehrajto.cz/603-cz');
        rooms.dropBlocked(u => blocked.has(u));
        await waitFor(() => last(a, 'video').video === null);
        assert.ok(a.got.some(e => e.type === 'chat' && /odstraněno na základě oznámení/.test(e.message.text)));
        assert.strictEqual((await fetch(`${base}/api/rooms/${room.id}/stream/0?m=${anna.id}&s=${anna.secret}`)).status, 404);
    } finally { a.close(); blocked.clear(); }
});

test('refreshing a video whose page was blocked meanwhile ends it instead', async () => {
    const room = await emptyRoom();
    const h = await events(room.id, room.member);
    try {
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 157336 }, room.member);
        await call('POST', `/api/rooms/${room.id}/poll/m157336/play`, null, room.member);
        await waitFor(() => last(h, 'video') && last(h, 'video').video);
        blocked.add('https://prehrajto.cz/157336-cz');
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/refresh`, null, room.member)).status, 410);
        await waitFor(() => last(h, 'video').video === null);
    } finally { h.close(); blocked.clear(); }
});
