// Server page (admin.js): status, update guard, restart detection, and the server
// waiting for its port after an update restart. Never runs a real update.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { startServer } = require('./server-harness');
const { restartMode } = require('../admin');

let server;
test.before(async () => { server = await startServer({ FILMBOX_ALLOW_UPDATE: '0' }); });
test.after(() => { if (server) server.stop(); });

test('status: running version, health, update switch', async () => {
    const st = await (await fetch(server.base + '/api/admin/status')).json();
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..') }).toString().trim();
    assert.strictEqual(st.version.commit, head);
    assert.ok(st.startedAt <= Date.now());
    assert.ok(st.memory.app > 0 && st.memory.total > 0);
    assert.ok(st.disk && st.disk.total > 0);
    assert.strictEqual(st.allowUpdate, false);
    assert.strictEqual(st.rooms, 0);
    assert.ok(Array.isArray(st.errors));
});

test('update: refused when turned off, from other sites, and on the guest server', async () => {
    const off = await fetch(server.base + '/api/admin/update', { method: 'POST' });
    assert.strictEqual(off.status, 403);
    assert.match((await off.json()).error, /FILMBOX_ALLOW_UPDATE/);
    const cross = await fetch(server.base + '/api/admin/update', { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(cross.status, 403);
    assert.strictEqual((await fetch(server.guestBase + '/api/admin/status')).status, 404);
});

test('player backups list: checks the title', async () => {
    assert.strictEqual((await fetch(server.base + '/api/sources?type=movie')).status, 400);
    assert.strictEqual((await fetch(server.base + '/api/sources?id=1399&type=tv')).status, 400);
    assert.strictEqual((await fetch(server.base + '/api/sources?id=abc&type=movie')).status, 400);
});

test('restart mode follows how FilmBox was started', () => {
    const keep = { pm_id: process.env.pm_id, INVOCATION_ID: process.env.INVOCATION_ID };
    try {
        delete process.env.INVOCATION_ID; process.env.pm_id = '3';
        assert.strictEqual(restartMode(), 'pm2');
        delete process.env.pm_id; process.env.INVOCATION_ID = 'abc';
        assert.strictEqual(restartMode(), 'systemd');
    } finally {
        for (const k of Object.keys(keep)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
    }
});

test('after an update restart the new server waits for the old one to free the port', async () => {
    const blocker = net.createServer();
    await new Promise(r => blocker.listen(0, '0.0.0.0', r));
    const port = blocker.address().port;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-wait-'));
    const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), GUEST_PORT: '', TMDB_READ_TOKEN: 'test', FILMBOX_DATA_DIR: dataDir, FILMBOX_WAIT_PORT: '1', PUBLIC_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });
    try {
        await new Promise(r => setTimeout(r, 1500));
        assert.ok(!out.includes('portu ' + port), 'must not start while the port is taken');
        assert.strictEqual(proc.exitCode, null, 'still waiting, not crashed: ' + out);
        await new Promise(r => blocker.close(r));
        await new Promise((resolve, reject) => {
            const t = setInterval(() => { if (out.includes('Server běží na portu ' + port)) { clearInterval(t); resolve(); } }, 100);
            setTimeout(() => { clearInterval(t); reject(new Error('did not start: ' + out)); }, 10000);
        });
    } finally {
        proc.kill();
        if (blocker.listening) blocker.close();
    }
});
