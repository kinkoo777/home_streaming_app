// API tests: starts server.js on a free port with an empty temp data folder
// (no TMDB or network needed) and checks the progress store, PIN gate and the
// cross-site request guard.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

let server, base, host;

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        }).on('error', reject);
    });
}

test.before(async () => {
    const port = await freePort();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-api-'));
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), TMDB_READ_TOKEN: 'test', FILMBOX_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    host = '127.0.0.1:' + port;
    base = 'http://' + host;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
        let out = '';
        const onData = d => { out += d; if (out.includes(String(port))) { clearTimeout(timer); resolve(); } };
        server.stdout.on('data', onData);
        server.stderr.on('data', onData);
        server.on('exit', code => reject(new Error('server exited ' + code + ': ' + out)));
    });
});

test.after(() => { if (server) server.kill(); });

const json = (method, url, body, headers = {}) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body)
});

async function newProfile(name) {
    const res = await json('POST', '/api/profiles', { name });
    assert.strictEqual(res.status, 201);
    return (await res.json()).id;
}

const entry = { seconds: 754.2, duration: 5400, title: 'Interstellar', posterPath: '/p.jpg', mediaType: 'movie', tmdbId: 157336 };

test('progress: PUT, read back, DELETE', async () => {
    const id = await newProfile('Put');
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, entry)).status, 200);
    let all = await (await fetch(`${base}/api/profiles/${id}/progress`)).json();
    assert.strictEqual(all['157336'].seconds, 754.2);
    assert.strictEqual(all['157336'].title, 'Interstellar');
    assert.ok(all['157336'].updatedAt);

    assert.strictEqual((await fetch(`${base}/api/profiles/${id}/progress/157336`, { method: 'DELETE' })).status, 200);
    all = await (await fetch(`${base}/api/profiles/${id}/progress`)).json();
    assert.deepStrictEqual(all, {});
});

test('progress: episodes are stored under their own key', async () => {
    const id = await newProfile('Episodes');
    await json('PUT', `/api/profiles/${id}/progress/1399:S01E05`, { ...entry, mediaType: 'tv', tmdbId: 1399, episodeLabel: 'S01E05', seconds: 300 });
    await json('PUT', `/api/profiles/${id}/progress/1399:S01E06`, { ...entry, mediaType: 'tv', tmdbId: 1399, episodeLabel: 'S01E06', seconds: 60 });
    const all = await (await fetch(`${base}/api/profiles/${id}/progress`)).json();
    assert.strictEqual(all['1399:S01E05'].seconds, 300);
    assert.strictEqual(all['1399:S01E06'].seconds, 60);
});

test('progress: page-close beacon (POST text/plain) is saved', async () => {
    const id = await newProfile('Beacon');
    const res = await fetch(`${base}/api/profiles/${id}/progress/157336`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: base }, body: JSON.stringify(entry)
    });
    assert.strictEqual(res.status, 200);
    const all = await (await fetch(`${base}/api/profiles/${id}/progress`)).json();
    assert.strictEqual(all['157336'].seconds, 754.2);
});

test('progress: bad keys and bodies are refused', async () => {
    const id = await newProfile('Bad');
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/..%2Fprofiles`, entry)).status, 400);
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, { seconds: 'x' })).status, 400);
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, { seconds: -5 })).status, 400);
    assert.strictEqual((await json('PUT', `/api/profiles/nope/progress/157336`, entry)).status, 404);
});

test('PIN profile: progress needs the session token (header or ?t=)', async () => {
    const id = await newProfile('Pin');
    const set = await (await json('POST', `/api/profiles/${id}/pin`, { pin: '1234' })).json();
    assert.ok(set.token);

    assert.strictEqual((await fetch(`${base}/api/profiles/${id}/progress`)).status, 401);
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, entry)).status, 401);

    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, entry, { 'X-Profile-Token': set.token })).status, 200);
    const beacon = await fetch(`${base}/api/profiles/${id}/progress/550?t=${set.token}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...entry, tmdbId: 550 })
    });
    assert.strictEqual(beacon.status, 200);
    const all = await (await fetch(`${base}/api/profiles/${id}/progress`, { headers: { 'X-Profile-Token': set.token } })).json();
    assert.deepStrictEqual(Object.keys(all).sort(), ['157336', '550']);
});

test('requests from another website are refused, own pages are allowed', async () => {
    const id = await newProfile('Origin');
    const evil = { Origin: 'http://evil.example' };
    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, entry, evil)).status, 403);
    assert.strictEqual((await fetch(`${base}/api/profiles/${id}`, { method: 'DELETE', headers: evil })).status, 403);
    const textPost = await fetch(`${base}/api/profiles/${id}/progress/157336`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', ...evil }, body: JSON.stringify(entry)
    });
    assert.strictEqual(textPost.status, 403);
    // Profile still there, nothing written.
    assert.deepStrictEqual(await (await fetch(`${base}/api/profiles/${id}/progress`)).json(), {});

    assert.strictEqual((await json('PUT', `/api/profiles/${id}/progress/157336`, entry, { Origin: base })).status, 200);
    // No CORS headers: other sites can't read API answers either.
    const res = await fetch(`${base}/api/profiles`, { headers: evil });
    assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
});

test('profile playback preferences are saved and validated', async () => {
    const id = await newProfile('Prefs');
    const ok = await json('PUT', `/api/profiles/${id}`, { settings: { audioPref: 'original', qualityPref: '720', subLang: 'eng', stillWatching: false } });
    assert.strictEqual(ok.status, 200);
    const p = await ok.json();
    assert.strictEqual(p.settings.audioPref, 'original');
    assert.strictEqual(p.settings.subLang, 'eng');
    assert.strictEqual(p.settings.stillWatching, false);
    assert.strictEqual(p.settings.reduceMotion, false);           // defaults kept
    assert.strictEqual((await json('PUT', `/api/profiles/${id}`, { settings: { qualityPref: '8k' } })).status, 400);
    const fresh = await (await fetch(`${base}/api/profiles/${await newProfile('Defaults')}`)).json();
    assert.deepStrictEqual([fresh.settings.audioPref, fresh.settings.qualityPref, fresh.settings.subLang, fresh.settings.stillWatching], ['dub', '1080', 'device', true]);
});

test('intros: mark, read, nearest season, delete', async () => {
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 30, end: 95.55 })).status, 200);
    assert.strictEqual((await json('PUT', '/api/intros/1399/0', { start: 0, end: 40 })).status, 200);
    let list = await (await fetch(`${base}/api/intros/1399`)).json();
    assert.deepStrictEqual(list.sort((a, b) => a.season - b.season), [{ season: 0, start: 0, end: 40 }, { season: 2, start: 30, end: 95.6 }]);
    // Re-marking replaces; bad marks are refused.
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 31, end: 90 })).status, 200);
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 90, end: 31 })).status, 400);
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 10, end: 12 })).status, 400);       // too short
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 2000, end: 2060 })).status, 400);   // too late
    assert.strictEqual((await json('PUT', '/api/intros/abc/2', { start: 30, end: 90 })).status, 400);
    assert.strictEqual((await json('PUT', '/api/intros/1399/2', { start: 30, end: 90 }, { Origin: 'http://evil.example' })).status, 403);
    list = await (await fetch(`${base}/api/intros/1399`)).json();
    assert.strictEqual(list.find(i => i.season === 2).start, 31);
    assert.strictEqual((await fetch(`${base}/api/intros/1399/2`, { method: 'DELETE' })).status, 200);
    list = await (await fetch(`${base}/api/intros/1399`)).json();
    assert.deepStrictEqual(list, [{ season: 0, start: 0, end: 40 }]);
});

test('watch time adds up into stats; export and wipe include it', async () => {
    const id = await newProfile('Stats');
    const send = (body, type = 'application/json') => fetch(`${base}/api/profiles/${id}/watchtime`, {
        method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body)
    });
    assert.strictEqual((await send({ seconds: 600, tmdbId: 1399, mediaType: 'tv', title: 'Hra o trůny S01E01' })).status, 200);
    assert.strictEqual((await send({ seconds: 300, tmdbId: 1399, mediaType: 'tv', title: 'Hra o trůny S01E02' }, 'text/plain')).status, 200);
    assert.strictEqual((await send({ seconds: 1200, tmdbId: 550, mediaType: 'movie', title: 'Klub rváčů' })).status, 200);
    assert.strictEqual((await send({ seconds: 99999, tmdbId: 550, mediaType: 'movie' })).status, 400);
    assert.strictEqual((await send({ seconds: 60, tmdbId: 550, mediaType: 'book' })).status, 400);

    const s = await (await fetch(`${base}/api/profiles/${id}/stats?period=month`)).json();
    assert.strictEqual(s.totalSeconds, 2100);
    assert.deepStrictEqual(s.split, { movie: 1200, tv: 900 });
    assert.deepStrictEqual(s.topTitles.map(t => [t.title, t.seconds]), [['Klub rváčů', 1200], ['Hra o trůny', 900]]);
    assert.strictEqual(s.daysWatched, 1);
    assert.strictEqual(s.byMonth.length, 12);
    assert.ok(Array.isArray(s.genres));

    const exp = await (await fetch(`${base}/api/profiles/${id}/export`)).json();
    assert.strictEqual(exp.history.length, 1);
    await fetch(`${base}/api/profiles/${id}/data`, { method: 'DELETE' });
    assert.strictEqual((await (await fetch(`${base}/api/profiles/${id}/stats`)).json()).totalSeconds, 0);
});

// ── Casting ──
// Opens a receiver connection and collects the commands it gets.
async function receiver(id, key, name = 'Testovací TV') {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/cast/receiver?id=${id}&key=${key}&name=${encodeURIComponent(name)}`, { signal: ctl.signal });
    const got = [];
    if (res.status === 200) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        (async () => {
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    let i;
                    while ((i = buf.indexOf('\n\n')) >= 0) {
                        const block = buf.slice(0, i);
                        buf = buf.slice(i + 2);
                        const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
                        if (data) got.push(JSON.parse(data));
                    }
                }
            } catch { /* aborted */ }
        })();
    }
    return { status: res.status, got, close: () => ctl.abort() };
}
const waitFor = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); } };

const playerPayload = (over = {}) => ({
    title: 'Interstellar', tmdbId: 157336, mediaType: 'movie', progressKey: '157336',
    source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/v/abc.mp4', label: '1080p', res: 1080 }], subtitles: [{ src: '/subs/file/123', label: 'CZ' }], pageUrl: 'https://prehrajto.cz/interstellar/abc' },
    alternatives: [{ url: 'https://prehrajto.cz/interstellar-2/def' }],
    ...over
});

test('cast: receivers, ownership, remote commands and state', async () => {
    const tv = await receiver('tvaaaaaaaa01', 'keyaaaaaaaaa01');
    assert.strictEqual(tv.status, 200);
    try {
        const thief = await receiver('tvaaaaaaaa01', 'otherkeyxxxx01');
        assert.strictEqual(thief.status, 403, 'someone else cannot take over a TV id');

        const devices = await (await fetch(`${base}/api/cast/devices`)).json();
        const me = devices.find(d => d.id === 'tvaaaaaaaa01');
        assert.ok(me && me.online);
        assert.strictEqual(me.name, 'Testovací TV');
        assert.strictEqual(me.key, undefined, 'the key never leaves the server');

        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/command', { type: 'seek', by: -30 })).status, 200);
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/command', { type: 'toggle' })).status, 200);
        await waitFor(() => tv.got.length === 2);
        assert.deepStrictEqual(tv.got, [{ type: 'seek', by: -30 }, { type: 'toggle' }]);
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/command', { type: 'shutdown' })).status, 400);
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/command', { type: 'seek', by: 'x' })).status, 400);
        assert.strictEqual((await json('POST', '/api/cast/nosuchtv0001/command', { type: 'toggle' })).status, 404);
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/command', { type: 'toggle' }, { Origin: 'http://evil.example' })).status, 403);

        // Only the TV itself may report its state.
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/state', { page: 'player', title: 'X' }, { 'X-Cast-Key': 'wrongkeyxxxx01' })).status, 403);
        assert.strictEqual((await json('POST', '/api/cast/tvaaaaaaaa01/state', { page: 'player', title: 'Interstellar', position: 61, paused: false, evil: '<x>' }, { 'X-Cast-Key': 'keyaaaaaaaaa01' })).status, 204);
        const d = await (await fetch(`${base}/api/cast/tvaaaaaaaa01`)).json();
        assert.deepStrictEqual(d.state, { page: 'player', title: 'Interstellar', position: 61, paused: false });
    } finally { tv.close(); }
});

test('cast: play checks links and profiles, passes a PIN session on', async () => {
    const tv = await receiver('tvbbbbbbbb01', 'keybbbbbbbbb01');
    try {
        const open = await newProfile('Cast open');
        const locked = await newProfile('Cast locked');
        const { token } = await (await json('POST', `/api/profiles/${locked}/pin`, { pin: '4321' })).json();
        const play = (body, headers) => json('POST', '/api/cast/tvbbbbbbbb01/command', { type: 'play', ...body }, headers);

        assert.strictEqual((await play({ profileId: open, player: playerPayload({ source: { qualities: [{ src: 'http://192.168.0.1/admin' }] } }) })).status, 400);
        assert.strictEqual((await play({ profileId: open, player: playerPayload({ alternatives: [{ url: 'https://evil.example/x' }] }) })).status, 400);
        assert.strictEqual((await play({ profileId: open, player: playerPayload({ source: { qualities: [{ src: 'https://cdn1.premiumcdn.net/a.mp4' }], subtitles: [{ src: 'file:///etc/passwd' }] } }) })).status, 400);
        assert.strictEqual((await play({ profileId: 'nope', player: playerPayload() })).status, 404);
        assert.strictEqual((await play({ profileId: locked, player: playerPayload() })).status, 401, 'PIN profile needs the phone session');

        assert.strictEqual((await play({ profileId: open, player: playerPayload(), startAt: 754 })).status, 200);
        assert.strictEqual((await play({ profileId: locked, player: playerPayload() }, { 'X-Profile-Token': token })).status, 200);
        await waitFor(() => tv.got.length === 2);
        const [a, b] = tv.got;
        assert.strictEqual(a.type, 'play');
        assert.strictEqual(a.startAt, 754);
        assert.strictEqual(a.profile.id, open);
        assert.strictEqual(a.token, null);
        assert.strictEqual(a.player.title, 'Interstellar');
        assert.strictEqual(b.profile.id, locked);
        assert.strictEqual(b.profile.pinHash, undefined, 'no PIN hash goes out');
        assert.strictEqual(b.profile.hasPin, true);
        assert.strictEqual(b.token, token);
    } finally { tv.close(); }
});
