// Kouknem rooms on the real server: pages, creating from the landing page,
// joining, roles + permissions, sync, chat, reactions, and what clients may NOT
// do (send their own video, write cross-site, reach anything but their room).
const test = require('node:test');
const assert = require('node:assert');
const { startServer, sse, waitFor } = require('./server-harness');

let srv;
test.before(async () => { srv = await startServer({ KOUKNEM_OPERATOR: 'Test <Operator> s.r.o.' }); });
test.after(() => { if (srv) srv.stop(); });

const call = (method, url, body, headers = {}) => fetch(srv.base + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body)
});
const as = member => ({ 'X-Room-Member': member.id + '.' + member.secret });

async function newRoom() {
    const res = await call('POST', '/api/rooms', { name: 'Vláďa', prefs: { audioPref: 'original', qualityPref: '720' } });
    assert.strictEqual(res.status, 201);
    return res.json();
}
async function join(roomId, name) {
    const res = await call('POST', `/api/rooms/${roomId}/join`, { name });
    assert.strictEqual(res.status, 201, await res.clone().text());
    return (await res.json()).member;
}
const events = (roomId, m) => sse(`${srv.base}/api/rooms/${roomId}/events?m=${m.id}&s=${m.secret}`);
const last = (conn, type) => conn.got.filter(e => e.type === type).pop();

test('pages: landing, room, policy, report form, 404', async () => {
    const home = await fetch(srv.base + '/');
    assert.strictEqual(home.status, 200);
    const html = await home.text();
    assert.match(html, /Kouknem/);
    assert.match(html, /href="\/copyright"/);
    // Operator details are filled in and escaped.
    assert.match(html, /Test &lt;Operator&gt; s\.r\.o\./);
    assert.doesNotMatch(html, /\{\{\w+\}\}/);

    const policy = await (await fetch(srv.base + '/copyright')).text();
    assert.match(policy, /Copyright, Notice-and-Action &amp; Intermediary Services Policy/);
    assert.match(policy, /Kouknem provides technology/);
    assert.doesNotMatch(policy, /NAME OF SERVICE|\{\{\w+\}\}/);
    assert.match(policy, /\[to be completed: registered address\]/, 'missing operator details are marked, not invented');

    assert.match(await (await fetch(srv.base + '/copyright/report')).text(), /Submit notice/);
    const room = await fetch(srv.base + '/r/abcdefghijklmnop');
    assert.strictEqual(room.status, 200);
    assert.match(await room.text(), /js\/room\.js/);
    for (const ok of ['/css/room.css', '/css/site.css', '/js/room.js', '/js/landing.js', '/js/report.js', '/icons/favicon.svg']) assert.strictEqual((await fetch(srv.base + ok)).status, 200, ok);
    for (const no of ['/views/index.html', '/index.html', '/server.js', '/lib/rooms.js', '/data/notices.jsonl', '/search?q=x', '/get_video?url=https://prehrajto.cz/x', '/stream?url=https://cdn1.premiumcdn.net/a.mp4']) {
        assert.strictEqual((await fetch(srv.base + no)).status, 404, no);
    }
    assert.strictEqual((await call('GET', '/api/nothing')).status, 404);
    assert.strictEqual(home.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(home.headers.get('x-frame-options'), 'DENY');
});

test('creating a room: always starts choosing, never with a client-supplied video', async () => {
    const res = await call('POST', '/api/rooms', {
        name: 'Mallory',
        player: { title: 'x', source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/v/a.mp4' }], pageUrl: 'https://prehrajto.cz/x' } }
    });
    assert.strictEqual(res.status, 201);
    const room = await res.json();
    assert.strictEqual(room.link, `http://${srv.host}/r/${room.id}`);
    assert.strictEqual(room.public, false);
    const info = await (await call('GET', `/api/rooms/${room.id}`)).json();
    assert.deepStrictEqual([info.choosing, info.host, info.count], [true, 'Mallory', 1]);
    // No endpoint takes a video from a client.
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/video`, { player: {} }, as(room.member))).status, 404);
    assert.strictEqual((await call('POST', '/api/rooms', { name: 'x' }, { Origin: 'http://evil.example' })).status, 403);
});

test('join, snapshot, sync, chat and reactions', async () => {
    const room = await newRoom();
    const info = await (await call('GET', `/api/rooms/${room.id}`)).json();
    assert.deepStrictEqual([info.title, info.host, info.count, info.locked], ['Vybíráme film', 'Vláďa', 1, false]);
    assert.strictEqual(info.pageUrl, undefined);

    const host = await events(room.id, room.member);
    const anna = await join(room.id, '  Anna <b>  ');
    const a = await events(room.id, anna);
    try {
        await waitFor(() => last(a, 'hello'));
        const hello = last(a, 'hello');
        assert.strictEqual(hello.you.name, 'Anna b');
        assert.strictEqual(hello.you.role, 'viewer');
        assert.deepStrictEqual(hello.you.perms, { control: false, chat: true, react: true, suggest: true, kick: false });
        assert.ok(hello.room.link.endsWith('/r/' + room.id), 'everyone can pass the link on');
        assert.strictEqual(hello.room.publicLink, false);
        assert.strictEqual(hello.video, null);
        assert.strictEqual(hello.state.playing, false);
        assert.ok(hello.chat.some(m => m.system && /Anna b se připojil/.test(m.text)));
        await waitFor(() => last(host, 'hello'));
        assert.ok(last(host, 'hello').room.link.endsWith('/r/' + room.id));

        // Viewers can't control playback by default; the host can.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/action`, { type: 'pause', position: 200 }, as(anna))).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/action`, { type: 'pause', position: 200 }, as(room.member))).status, 200);
        await waitFor(() => last(a, 'sync'));
        assert.deepStrictEqual([last(a, 'sync').state.playing, last(a, 'sync').state.position, last(a, 'sync').by.name, last(a, 'sync').action], [false, 200, 'Vláďa', 'pause']);

        // Chat + reactions
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: '  ahoj <script>  ' }, as(anna))).status, 200);
        await waitFor(() => host.got.some(e => e.type === 'chat' && e.message.text === 'ahoj <script>'));
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: '   ' }, as(anna))).status, 400);
        let limited = 0;
        for (let i = 0; i < 6; i++) if ((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'x' + i }, as(anna))).status === 429) limited++;
        assert.ok(limited >= 1, 'chat is rate limited');
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/react`, { emoji: '💩' }, as(anna))).status, 400);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/react`, { emoji: '😂' }, as(anna))).status, 200);
        await waitFor(() => last(host, 'reaction'));
        assert.deepStrictEqual([last(host, 'reaction').emoji, last(host, 'reaction').from.name], ['😂', 'Anna b']);

        // Buffering shows in the people list.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/presence`, { position: 201, buffering: true }, as(anna))).status, 204);
        await waitFor(() => { const m = last(host, 'members'); return m && m.members.some(x => x.name === 'Anna b' && x.buffering); });
    } finally { a.close(); host.close(); }
});

test('credentials, cross-site requests and room-only proxies', async () => {
    const room = await newRoom();
    const bob = await join(room.id, 'Bob');
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'x' }, { 'X-Room-Member': bob.id + '.wrong' + bob.secret.slice(5) })).status, 401);
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'x' })).status, 401);
    assert.strictEqual((await sse(`${srv.base}/api/rooms/${room.id}/events?m=${bob.id}&s=nope`)).status, 401);
    assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'x' }, { ...as(bob), Origin: 'http://evil.example' })).status, 403);
    assert.strictEqual((await call('POST', '/api/rooms/doesnotexist000/join', { name: 'x' })).status, 404);
    // Only the room's own qualities / subtitles, and only for members.
    assert.strictEqual((await fetch(`${srv.base}/api/rooms/${room.id}/stream/7?m=${bob.id}&s=${bob.secret}`)).status, 404);
    assert.strictEqual((await fetch(`${srv.base}/api/rooms/${room.id}/stream/0`)).status, 401);
    assert.strictEqual((await fetch(`${srv.base}/api/rooms/${room.id}/subtitle/3?m=${bob.id}&s=${bob.secret}`)).status, 404);
    assert.strictEqual((await fetch(`${srv.base}/api/rooms/${room.id}/subtitle/0`)).status, 401);
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
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: true } } }, as(cyril))).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/members/${dana.id}`, { role: 'moderator' }, as(cyril))).status, 403);

        // Host lets viewers control playback → everyone's permissions update.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: true } } }, as(room.member))).status, 200);
        await waitFor(() => last(c, 'you') && last(c, 'you').you.perms.control);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/action`, { type: 'seek', position: 30 }, as(cyril))).status, 200);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { control: 'yes' } } }, as(room.member))).status, 400);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/settings`, { defaultRole: 'host' }, as(room.member))).status, 400);

        // Cyril becomes moderator: may remove viewers, not the host or other moderators.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/members/${cyril.id}`, { role: 'moderator' }, as(room.member))).status, 200);
        await waitFor(() => last(c, 'you') && last(c, 'you').you.role === 'moderator');
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/members/${room.member.id}`, { role: 'viewer' }, as(room.member))).status, 404, 'the host stays host');
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/members/${room.member.id}`, null, as(cyril))).status, 403);
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/members/${dana.id}`, null, as(cyril))).status, 200);
        await waitFor(() => last(d, 'kicked'));
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'jsem tu?' }, as(dana))).status, 401);

        // Kick permission can be taken away from moderators.
        const eva = await join(room.id, 'Eva');
        await call('POST', `/api/rooms/${room.id}/settings`, { perms: { moderator: { kick: false } } }, as(room.member));
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/members/${eva.id}`, null, as(cyril))).status, 403);
        // …and chat from viewers.
        await call('POST', `/api/rooms/${room.id}/settings`, { perms: { viewer: { chat: false } } }, as(room.member));
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/chat`, { text: 'ahoj' }, as(eva))).status, 403);

        // New people as moderators.
        await call('POST', `/api/rooms/${room.id}/settings`, { defaultRole: 'moderator' }, as(room.member));
        const filip = await join(room.id, 'Filip');
        const f = await events(room.id, filip);
        await waitFor(() => last(f, 'hello'));
        assert.strictEqual(last(f, 'hello').you.role, 'moderator');
        f.close();

        // Leaving on your own works without the kick permission.
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}/members/${eva.id}`, null, as(eva))).status, 200);
    } finally { c.close(); d.close(); }
});

test('lock and closing', async () => {
    const room = await newRoom();
    const gabi = await join(room.id, 'Gábi');
    const g = await events(room.id, gabi);
    try {
        await waitFor(() => last(g, 'hello'));
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/settings`, { locked: true }, as(room.member))).status, 200);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/join`, { name: 'Pozdě' })).status, 403);
        assert.strictEqual((await (await call('GET', `/api/rooms/${room.id}`)).json()).locked, true);

        // Only the host goes back to choosing; nothing to refresh without a film.
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/lobby`, null, as(gabi))).status, 403);
        assert.strictEqual((await call('POST', `/api/rooms/${room.id}/refresh`, null, as(gabi))).status, 400);

        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}`, null, as(gabi))).status, 403);
        assert.strictEqual((await call('DELETE', `/api/rooms/${room.id}`, null, as(room.member))).status, 200);
        await waitFor(() => last(g, 'closed'));
        assert.strictEqual((await call('GET', `/api/rooms/${room.id}`)).status, 404);
    } finally { g.close(); }
});
