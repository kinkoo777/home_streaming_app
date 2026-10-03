// Watch-together rooms (rooms.js): creating on the home server, joining through the
// guest server, roles + permissions, sync, chat, reactions, and what the guest
// server does NOT expose.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, sse, waitFor } = require('./server-harness');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => { if (srv) srv.stop(); });

const call = (b, method, url, body, headers = {}) => fetch(b + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body)
});
const main = (m, u, b, h) => call(srv.base, m, u, b, h);
const guest = (m, u, b, h) => call(srv.guestBase, m, u, b, h);
const as = member => ({ 'X-Room-Member': member.id + '.' + member.secret });

const player = (over = {}) => ({
    title: 'Interstellar', tmdbId: 157336, mediaType: 'movie', posterPath: '/p.jpg',
    source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/v/a.mp4', label: '1080p', res: 1080 }, { src: 'https://cdn1.premiumcdn.net/v/b.mp4', label: '720p', res: 720 }],
        subtitles: [{ src: 'https://cdn1.premiumcdn.net/s/cz.vtt', label: 'CZ', lang: 'cze' }], pageUrl: 'https://prehrajto.cz/interstellar/abc' },
    ...over
});

async function newRoom() {
    const res = await main('POST', '/api/rooms', { player: player(), name: 'Vláďa', position: 120, playing: true });
    assert.strictEqual(res.status, 201);
    return res.json();
}
async function join(roomId, name) {
    const res = await guest('POST', `/api/rooms/${roomId}/join`, { name });
    assert.strictEqual(res.status, 201, await res.clone().text());
    return (await res.json()).member;
}
const events = (roomId, m, b = srv.guestBase) => sse(`${b}/api/rooms/${roomId}/events?m=${m.id}&s=${m.secret}`);
const last = (conn, type) => conn.got.filter(e => e.type === type).pop();

test('the guest server exposes only the room page, its assets and the room API', async () => {
    const room = await newRoom();
    assert.strictEqual((await fetch(`${srv.guestBase}/r/${room.id}`)).status, 200);
    assert.match(await (await fetch(`${srv.guestBase}/r/${room.id}`)).text(), /Sledujeme společně/);
    for (const ok of ['/css/watch.css', '/js/watch.js', '/icons/icon-192.png']) assert.strictEqual((await fetch(srv.guestBase + ok)).status, 200, ok);
    for (const no of ['/', '/index.html', '/player.html', '/js/player.js', '/js/utils.js', '/api/profiles', '/api/cast/devices', '/tmdb/search?q=x',
        '/search?q=x', '/get_video?url=https://prehrajto.cz/x', '/stream?url=https://cdn1.premiumcdn.net/a.mp4', '/get_subtitle?url=x', '/api/intros/1']) {
        assert.strictEqual((await fetch(srv.guestBase + no)).status, 404, no);
    }
    // Rooms can't be created from outside.
    assert.strictEqual((await guest('POST', '/api/rooms', { player: player() })).status, 404);
    // The invitation must not leak through a Referer.
    assert.strictEqual((await fetch(`${srv.guestBase}/r/${room.id}`)).headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(room.link, `http://127.0.0.1:${srv.guestHost.split(':')[1]}/r/${room.id}`);
    assert.strictEqual(room.public, false);
});

test('creating checks the video links', async () => {
    assert.strictEqual((await main('POST', '/api/rooms', { player: player({ source: { qualities: [{ src: 'http://192.168.0.1/x' }] } }) })).status, 400);
    assert.strictEqual((await main('POST', '/api/rooms', { player: { title: 'x' } })).status, 400);
    assert.strictEqual((await main('POST', '/api/rooms', { player: player() }, { Origin: 'http://evil.example' })).status, 403);
});

test('join, snapshot, sync, chat and reactions', async () => {
    const room = await newRoom();
    const info = await (await guest('GET', `/api/rooms/${room.id}`)).json();
    assert.deepStrictEqual([info.title, info.host, info.count, info.locked], ['Interstellar', 'Vláďa', 1, false]);
    assert.strictEqual(info.pageUrl, undefined);

    const host = await events(room.id, room.member, srv.base);
    const anna = await join(room.id, '  Anna <b>  ');
    const a = await events(room.id, anna);
    try {
        await waitFor(() => last(a, 'hello'));
        const hello = last(a, 'hello');
        assert.strictEqual(hello.you.name, 'Anna b');
        assert.strictEqual(hello.you.role, 'viewer');
        assert.deepStrictEqual(hello.you.perms, { control: false, chat: true, react: true, kick: false });
        assert.ok(hello.room.link.endsWith('/r/' + room.id), 'everyone can pass the link on');
        assert.strictEqual(hello.room.publicLink, false);
        assert.strictEqual(hello.video.qualities.length, 2);
        assert.strictEqual(hello.video.subtitles[0].src, undefined, 'subtitles go through the room');
        assert.ok(hello.state.playing && hello.state.position >= 120);
        assert.ok(hello.chat.some(m => m.system && /Anna b se připojil/.test(m.text)));
        await waitFor(() => last(host, 'hello'));
        assert.ok(last(host, 'hello').room.link.endsWith('/r/' + room.id));

        // Viewers can't control playback by default; the host can.
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/action`, { type: 'pause', position: 200 }, as(anna))).status, 403);
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/action`, { type: 'pause', position: 200 }, as(room.member))).status, 200);
        await waitFor(() => last(a, 'sync'));
        assert.deepStrictEqual([last(a, 'sync').state.playing, last(a, 'sync').state.position, last(a, 'sync').by.name, last(a, 'sync').action], [false, 200, 'Vláďa', 'pause']);

        // Chat + reactions
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: '  ahoj <script>  ' }, as(anna))).status, 200);
        await waitFor(() => host.got.some(e => e.type === 'chat' && e.message.text === 'ahoj <script>'));
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: '   ' }, as(anna))).status, 400);
        let limited = 0;
        for (let i = 0; i < 6; i++) if ((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'x' + i }, as(anna))).status === 429) limited++;
        assert.ok(limited >= 1, 'chat is rate limited');
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/react`, { emoji: '💩' }, as(anna))).status, 400);
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/react`, { emoji: '😂' }, as(anna))).status, 200);
        await waitFor(() => last(host, 'reaction'));
        assert.deepStrictEqual([last(host, 'reaction').emoji, last(host, 'reaction').from.name], ['😂', 'Anna b']);

        // Buffering shows in the people list.
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/presence`, { position: 201, buffering: true }, as(anna))).status, 204);
        await waitFor(() => { const m = last(host, 'members'); return m && m.members.some(x => x.name === 'Anna b' && x.buffering); });
    } finally { a.close(); host.close(); }
});

test('credentials, cross-site requests and room-only proxies', async () => {
    const room = await newRoom();
    const bob = await join(room.id, 'Bob');
    assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'x' }, { 'X-Room-Member': bob.id + '.wrong' + bob.secret.slice(5) })).status, 401);
    assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'x' })).status, 401);
    assert.strictEqual((await sse(`${srv.guestBase}/api/rooms/${room.id}/events?m=${bob.id}&s=nope`)).status, 401);
    assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'x' }, { ...as(bob), Origin: 'http://evil.example' })).status, 403);
    assert.strictEqual((await guest('POST', '/api/rooms/doesnotexist000/join', { name: 'x' })).status, 404);
    // Only the room's own qualities / subtitles, and only for members.
    assert.strictEqual((await fetch(`${srv.guestBase}/api/rooms/${room.id}/stream/7?m=${bob.id}&s=${bob.secret}`)).status, 404);
    assert.strictEqual((await fetch(`${srv.guestBase}/api/rooms/${room.id}/stream/0`)).status, 401);
    assert.strictEqual((await fetch(`${srv.guestBase}/api/rooms/${room.id}/subtitle/3?m=${bob.id}&s=${bob.secret}`)).status, 404);
    assert.strictEqual((await fetch(`${srv.guestBase}/api/rooms/${room.id}/subtitle/0`)).status, 401);
});

test('roles and permissions set by the host', async () => {
    const room = await newRoom();
    const cyril = await join(room.id, 'Cyril');
    const dana = await join(room.id, 'Dana');
    const c = await events(room.id, cyril);
    const d = await events(room.id, dana);
    try {
        await waitFor(() => last(c, 'hello') && last(d, 'hello'));
        // Only the host changes settings / roles.
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: true } } }, as(cyril))).status, 403);
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/members/${dana.id}`, { role: 'moderator' }, as(cyril))).status, 403);

        // Host lets viewers control playback → everyone's permissions update.
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: true } } }, as(room.member))).status, 200);
        await waitFor(() => last(c, 'you') && last(c, 'you').you.perms.control);
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/action`, { type: 'seek', position: 30 }, as(cyril))).status, 200);
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: 'yes' } } }, as(room.member))).status, 400);
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/settings`, { defaultRole: 'host' }, as(room.member))).status, 400);

        // Cyril becomes moderator: may remove viewers, not the host or other moderators.
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/members/${cyril.id}`, { role: 'moderator' }, as(room.member))).status, 200);
        await waitFor(() => last(c, 'you') && last(c, 'you').you.role === 'moderator');
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/members/${room.member.id}`, { role: 'viewer' }, as(room.member))).status, 404, 'the host stays host');
        assert.strictEqual((await guest('DELETE', `/api/rooms/${room.id}/members/${room.member.id}`, null, as(cyril))).status, 403);
        assert.strictEqual((await guest('DELETE', `/api/rooms/${room.id}/members/${dana.id}`, null, as(cyril))).status, 200);
        await waitFor(() => last(d, 'kicked'));
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'jsem tu?' }, as(dana))).status, 401);

        // Kick permission can be taken away from moderators.
        const eva = await join(room.id, 'Eva');
        await main('POST', `/api/rooms/${room.id}/settings`, { perms: { moderator: { kick: false } } }, as(room.member));
        assert.strictEqual((await guest('DELETE', `/api/rooms/${room.id}/members/${eva.id}`, null, as(cyril))).status, 403);
        // …and chat from viewers.
        await main('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { chat: false } } }, as(room.member));
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/chat`, { text: 'ahoj' }, as(eva))).status, 403);

        // New people as moderators.
        await main('POST', `/api/rooms/${room.id}/settings`, { defaultRole: 'moderator' }, as(room.member));
        const filip = await join(room.id, 'Filip');
        const f = await events(room.id, filip);
        await waitFor(() => last(f, 'hello'));
        assert.strictEqual(last(f, 'hello').you.role, 'moderator');
        f.close();

        // Leaving on your own works without the kick permission.
        assert.strictEqual((await guest('DELETE', `/api/rooms/${room.id}/members/${eva.id}`, null, as(eva))).status, 200);
    } finally { c.close(); d.close(); }
});

test('lock, video change and closing', async () => {
    const room = await newRoom();
    const gabi = await join(room.id, 'Gábi');
    const g = await events(room.id, gabi);
    try {
        await waitFor(() => last(g, 'hello'));
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/settings`, { locked: true }, as(room.member))).status, 200);
        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/join`, { name: 'Pozdě' })).status, 403);
        assert.strictEqual((await (await guest('GET', `/api/rooms/${room.id}`)).json()).locked, true);

        assert.strictEqual((await guest('POST', `/api/rooms/${room.id}/video`, { player: player() }, as(gabi))).status, 403);
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/video`, { player: player({ alternatives: [{ url: 'https://evil.example' }] }) }, as(room.member))).status, 400);
        assert.strictEqual((await main('POST', `/api/rooms/${room.id}/video`, { player: player({ title: 'Kancl S02E03', mediaType: 'tv', episode: { season: 2, number: 3 }, episodeLabel: 'S02E03' }), position: 0 }, as(room.member))).status, 200);
        await waitFor(() => last(g, 'video'));
        assert.deepStrictEqual([last(g, 'video').video.title, last(g, 'video').video.episodeLabel, last(g, 'video').state.position], ['Kancl S02E03', 'S02E03', 0]);

        assert.strictEqual((await guest('DELETE', `/api/rooms/${room.id}`, null, as(gabi))).status, 403);
        assert.strictEqual((await main('DELETE', `/api/rooms/${room.id}`, null, as(room.member))).status, 200);
        await waitFor(() => last(g, 'closed'));
        assert.strictEqual((await guest('GET', `/api/rooms/${room.id}`)).status, 404);
    } finally { g.close(); }
});
