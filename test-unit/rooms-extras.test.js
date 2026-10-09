// Rooms: start time, queue, marathon, voice-chat signalling. In-process router with
// fake TMDB / source finding, no network.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const rooms = require('../rooms');
const { sse, waitFor } = require('./server-harness');

const FILMS = { 603: 'Matrix', 157336: 'Interstellar', 27205: 'Počátek' };
const player = (what) => ({
    title: what.mediaType === 'tv' ? 'Hra o trůny S01E0' + what.episode.number : FILMS[what.tmdbId],
    tmdbId: what.tmdbId, mediaType: what.mediaType, episode: what.episode || null,
    episodeLabel: what.episode ? 'S01E0' + what.episode.number : null,
    source: { pageUrl: 'https://prehrajto.cz/' + what.tmdbId, qualities: [{ src: 'https://cdn1.premiumcdn.net/' + what.tmdbId + (what.episode ? '-' + what.episode.number : '') + '.mp4', label: '720p', res: 720 }] }
});
const opts = {
    canCreate: true,
    scheduleLeadMs: 0,
    checkPlayer: p => (p && p.source && p.source.qualities.length ? null : 'Chybí video'),
    resolveVideo: async () => { throw new Error('offline'); },
    handleStream: async (req, res) => res.status(204).end(),
    loadSubtitle: async () => 'WEBVTT\n',
    linkFor: (host, id) => ({ link: 'http://test/r/' + id, public: false }),
    tmdb: { search: async () => [], trending: async () => [], movie: async id => { if (!FILMS[id]) throw new Error('404'); return { tmdbId: Number(id), title: FILMS[id], year: '2000', posterPath: null, rating: 8, overview: '' }; } },
    listSources: async () => ({ title: 'x', sources: [] }),
    findPlayer: async what => player(what),
    nextEpisode: async (id, s, n) => (n < 3 ? { season: s, number: n + 1 } : null)
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

const call = (method, url, body, m) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(m ? { 'X-Room-Member': m.id + '.' + m.secret } : {}) }, body: body && JSON.stringify(body)
});
const last = (c, type) => c.got.filter(e => e.type === type).pop();
const events = (id, m) => sse(`${base}/api/rooms/${id}/events?m=${m.id}&s=${m.secret}`);
const join = async (id, name) => (await (await call('POST', `/api/rooms/${id}/join`, { name })).json()).member;
async function roomWith(p, extra) {
    const res = await call('POST', '/api/rooms', Object.assign({ name: 'Vláďa', player: p, playing: false }, extra || {}));
    return res.json();
}

test('start time: only the host, sensible times, starts by itself', async () => {
    const room = await roomWith(player({ tmdbId: 603, mediaType: 'movie' }));
    const anna = await join(room.id, 'Anna');
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/schedule`, { at: Date.now() + 60000 }, anna)).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/schedule`, { at: Date.now() - 1000 }, room.member)).status, 400);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/schedule`, { at: Date.now() + 13 * 3600 * 1000 }, room.member)).status, 400);
        const info0 = await (await call('GET', `/api/rooms/${room.id}`)).json();
        assert.strictEqual(info0.startAt, null);
        const at = Date.now() + 400;
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/schedule`, { at }, room.member)).status, 200);
        assert.strictEqual((await (await call('GET', `/api/rooms/${room.id}`)).json()).startAt, at, 'join page shows the time');
        await waitFor(() => last(h, 'schedule') && last(h, 'schedule').startAt === at);
        await waitFor(() => { const s = last(h, 'sync'); return s && s.state.playing && s.by.name === 'FilmBox'; }, 3000);
        assert.ok(h.got.some(e => e.type === 'chat' && /začínáme/.test(e.message.text)));
        assert.strictEqual(last(h, 'schedule').started, true);
    } finally { h.close(); }
});

test('queue: proposals line up, the next film starts when one ends', async () => {
    const room = await roomWith(player({ tmdbId: 603, mediaType: 'movie' }), { position: 0, playing: true });
    const anna = await join(room.id, 'Anna');
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 157336 }, anna);
        await call('POST', `/api/rooms/${room.id}/poll`, { tmdbId: 27205 }, anna);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/queue`, { item: 'm157336' }, anna)).status, 403, 'viewers can\'t');
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/queue`, { item: 'm157336' }, room.member)).status, 200);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/queue`, { item: 'm27205' }, room.member)).status, 200);
        await waitFor(() => last(h, 'queue') && last(h, 'queue').queue.length === 2);
        assert.deepStrictEqual(last(h, 'queue').queue.map(q => q.title), ['Interstellar', 'Počátek']);
        assert.strictEqual(last(h, 'poll').poll.items.length, 0, 'moved out of the poll');
        const version = last(h, 'hello').videoVersion;
        // Not at the end yet → nothing happens
        const early = await (await call('POST', `/api/rooms/${room.id}/ended`, { videoVersion: version, duration: 7200 }, anna)).json();
        assert.strictEqual(early.next, false);
        // At the end (position ≥ duration − 25 s)
        await call('POST', `/api/rooms/${room.id}/action`, { type: 'seek', position: 7195 }, room.member);
        const r = await (await call('POST', `/api/rooms/${room.id}/ended`, { videoVersion: version, duration: 7200 }, anna)).json();
        assert.strictEqual(r.next, true);
        await waitFor(() => last(h, 'video') && last(h, 'video').video.title === 'Interstellar');
        assert.strictEqual(last(h, 'queue').queue.length, 1);
        assert.ok(h.got.some(e => e.type === 'chat' && /z fronty/.test(e.message.text)));
        // Removing from the queue
        const qid = last(h, 'queue').queue[0].id;
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/queue/${qid}`, null, room.member)).status, 200);
        await waitFor(() => last(h, 'queue').queue.length === 0);
    } finally { h.close(); }
});

test('marathon: the next episode starts by itself, stops after the last', async () => {
    const room = await roomWith(player({ tmdbId: 1399, mediaType: 'tv', episode: { season: 1, number: 2 } }), { position: 3000, playing: false });
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        await call('POST', `/api/rooms/${room.id}/marathon`, { on: true }, room.member);
        await waitFor(() => last(h, 'queue') && last(h, 'queue').marathon === true);
        await call('POST', `/api/rooms/${room.id}/ended`, { videoVersion: last(h, 'hello').videoVersion, duration: 3010 }, room.member);
        await waitFor(() => last(h, 'video') && last(h, 'video').video.episodeLabel === 'S01E03');
        const v = last(h, 'video');
        await call('POST', `/api/rooms/${room.id}/action`, { type: 'seek', position: 3000 }, room.member);
        await call('POST', `/api/rooms/${room.id}/ended`, { videoVersion: v.videoVersion, duration: 3010 }, room.member);
        await waitFor(() => h.got.some(e => e.type === 'chat' && /Konec maratonu/.test(e.message.text)));
    } finally { h.close(); }
});

test('voice: who is in, signalling between two members, at most 6, leaving on disconnect', async () => {
    const room = await roomWith(null);
    const anna = await join(room.id, 'Anna');
    const bob = await join(room.id, 'Bob');
    const h = await events(room.id, room.member), ea = await events(room.id, anna), eb = await events(room.id, bob);
    try {
        await waitFor(() => last(h, 'hello') && last(ea, 'hello') && last(eb, 'hello'));
        // Not in voice → can't signal
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/signal`, { to: bob.id, data: { sdp: 'x' } }, anna)).status, 400);
        const a = await (await call('POST', `/api/rooms/${room.id}/voice`, { on: true }, anna)).json();
        assert.deepStrictEqual(a.peers, []);
        const b = await (await call('POST', `/api/rooms/${room.id}/voice`, { on: true, muted: true }, bob)).json();
        assert.deepStrictEqual(b.peers, [anna.id], 'the newcomer calls who is already in');
        await waitFor(() => { const m = last(h, 'members'); return m && m.members.filter(x => x.voice).length === 2; });
        assert.deepStrictEqual(last(h, 'members').members.filter(x => x.voice).map(x => [x.name, x.muted]), [['Anna', false], ['Bob', true]]);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/signal`, { to: anna.id, data: { type: 'offer', sdp: 'v=0' } }, bob)).status, 200);
        await waitFor(() => last(ea, 'signal'));
        assert.deepStrictEqual(last(ea, 'signal'), { type: 'signal', from: bob.id, data: { type: 'offer', sdp: 'v=0' } });
        assert.ok(!last(h, 'signal'), 'only the addressee gets it');
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/signal`, { to: anna.id, data: 'x'.repeat(10) }, bob)).status, 400);
        // Bob's connection drops → out of voice
        eb.close();
        await waitFor(() => { const m = last(h, 'members'); return m && m.members.filter(x => x.voice).length === 1; });
        // Max 6
        const more = [];
        for (const n of ['C', 'D', 'E', 'F', 'G']) more.push(await join(room.id, n));
        for (const m of more.slice(0, 5)) await call('POST', `/api/rooms/${room.id}/voice`, { on: true }, m);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/voice`, { on: true }, room.member)).status, 409);
    } finally { h.close(); ea.close(); }
});
