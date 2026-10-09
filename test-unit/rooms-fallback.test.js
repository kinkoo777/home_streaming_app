// Automatic source fallback in rooms (rooms.js): an upload that stops working is
// replaced by the next one at the same second, for everyone. In-process router with
// fake source resolving, no network.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const rooms = require('../rooms');
const { sse, waitFor } = require('./server-harness');

const dead = new Set();           // page URLs that no longer resolve
const resolved = [];
const page = id => 'https://prehrajto.cz/' + id;
const source = id => ({ pageUrl: page(id), qualities: [{ src: 'https://cdn1.premiumcdn.net/' + id + '.mp4', label: '720p', res: 720 }] });
const opts = {
    canCreate: true,
    checkPlayer: p => (p && p.source && Array.isArray(p.source.qualities) && p.source.qualities.length ? null : 'Chybí video'),
    resolveVideo: async url => {
        resolved.push(url.split('/').pop());
        await new Promise(r => setTimeout(r, 20));
        if (dead.has(url)) throw new Error('Video bylo smazáno');
        return source(url.split('/').pop());
    },
    handleStream: async (req, res) => res.status(204).end(),
    loadSubtitle: async () => 'WEBVTT\n',
    linkFor: (host, id) => ({ link: 'http://test/r/' + id, public: false }),
    tmdb: { search: async () => [], trending: async () => [], movie: async () => ({}) },
    listSources: async () => ({ title: 'Matrix', sources: ['list-a', 'list-b'].map(id => ({ url: page(id), title: 'Matrix ' + id, source: 'fastshare', res: 1080 })) }),
    findPlayer: async () => { throw new Error('not used'); }
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
const events = (id, m) => sse(`${base}/api/rooms/${id}/events?m=${m.id}&s=${m.secret}`);
const playingId = conn => { const v = last(conn, 'video') || last(conn, 'hello'); return v && v.video && v.video.qualities[0].src.split('/').pop().replace('.mp4', ''); };

async function filmRoom(alternatives) {
    const res = await call('POST', '/api/rooms', {
        name: 'Vláďa', position: 754, playing: false,
        player: { title: 'Matrix', tmdbId: 603, mediaType: 'movie', source: source('main'), alternatives: alternatives.map(id => ({ url: page(id), title: 'Matrix ' + id, source: 'prehrajto' })) }
    });
    assert.strictEqual(res.status, 201);
    return res.json();
}
async function join(id, name) {
    return (await (await call('POST', `/api/rooms/${id}/join`, { name })).json()).member;
}

test('upload deleted → the room moves to the next working backup, same second', async () => {
    dead.clear(); resolved.length = 0;
    dead.add(page('main')); dead.add(page('alt-1'));
    const room = await filmRoom(['alt-1', 'alt-2', 'alt-3']);
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        const r = await (await call('POST', `/api/rooms/${room.id}/refresh`, {}, room.member)).json();
        assert.strictEqual(r.switching, true);
        await waitFor(() => playingId(h) === 'alt-2');
        assert.ok(h.got.some(e => e.type === 'switching' && e.auto));
        assert.deepStrictEqual(resolved, ['main', 'alt-1', 'alt-2']);
        const v = last(h, 'video');
        assert.strictEqual(v.state.playing, false);
        assert.ok(Math.abs(v.state.position - 754) < 1, 'kept the position');
        await waitFor(() => h.got.some(e => e.type === 'chat' && /Zdroj přestal fungovat/.test(e.message.text)));
    } finally { h.close(); }
});

test('fresh links still not playing: one viewer is not enough, two are; control is', async () => {
    dead.clear(); resolved.length = 0;
    const room = await filmRoom(['alt-1']);
    const a = await join(room.id, 'Anna');
    const b = await join(room.id, 'Bára');
    const h = await events(room.id, room.member), ea = await events(room.id, a), eb = await events(room.id, b);
    try {
        await waitFor(() => last(h, 'hello') && last(ea, 'hello') && last(eb, 'hello'));
        // "failed" before any refresh = just refresh
        await call('POST', `/api/rooms/${room.id}/refresh`, { failed: true, videoVersion: 1 }, a);
        await waitFor(() => last(h, 'video') && last(h, 'video').refreshed);
        const version = last(h, 'video').videoVersion;
        assert.strictEqual(playingId(h), 'main');
        const one = await (await call('POST', `/api/rooms/${room.id}/refresh`, { failed: true, videoVersion: version }, a)).json();
        assert.strictEqual(one.waiting, true);
        assert.strictEqual(playingId(h), 'main');
        // A report for an older version doesn't count
        const old = await (await call('POST', `/api/rooms/${room.id}/refresh`, { failed: true, videoVersion: version - 1 }, b)).json();
        assert.ok(!old.switching);
        const two = await (await call('POST', `/api/rooms/${room.id}/refresh`, { failed: true, videoVersion: version }, b)).json();
        assert.strictEqual(two.switching, true);
        await waitFor(() => playingId(ea) === 'alt-1');
    } finally { h.close(); ea.close(); eb.close(); }

    // The host (control) alone is enough
    const room2 = await filmRoom(['alt-9']);
    const h2 = await events(room2.id, room2.member);
    try {
        await waitFor(() => last(h2, 'hello'));
        await call('POST', `/api/rooms/${room2.id}/refresh`, {}, room2.member);
        await waitFor(() => last(h2, 'video'));
        const r = await (await call('POST', `/api/rooms/${room2.id}/refresh`, { failed: true, videoVersion: last(h2, 'video').videoVersion }, room2.member)).json();
        assert.strictEqual(r.switching, true);
        await waitFor(() => playingId(h2) === 'alt-9');
    } finally { h2.close(); }
});

test('backups used up → the rest of the film\'s upload list; nothing works → says so', async () => {
    dead.clear(); resolved.length = 0;
    dead.add(page('main')); dead.add(page('alt-1')); dead.add(page('list-a'));
    const room = await filmRoom(['alt-1']);
    const h = await events(room.id, room.member);
    try {
        await waitFor(() => last(h, 'hello'));
        await call('POST', `/api/rooms/${room.id}/refresh`, {}, room.member);
        await waitFor(() => playingId(h) === 'list-b');
        assert.deepStrictEqual(resolved, ['main', 'alt-1', 'list-a', 'list-b']);
    } finally { h.close(); }

    dead.clear(); resolved.length = 0;
    ['main', 'alt-1', 'list-a', 'list-b'].forEach(id => dead.add(page(id)));
    const room2 = await filmRoom(['alt-1']);
    const h2 = await events(room2.id, room2.member);
    try {
        await waitFor(() => last(h2, 'hello'));
        await call('POST', `/api/rooms/${room2.id}/refresh`, {}, room2.member);
        await waitFor(() => h2.got.some(e => e.type === 'switching' && e.error));
        assert.strictEqual(playingId(h2), 'main');
    } finally { h2.close(); }
});
