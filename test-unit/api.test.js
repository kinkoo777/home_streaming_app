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
