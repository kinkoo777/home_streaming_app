// Starts server.js on a free port with an empty temp data folder — no TMDB or
// network needed. Shared by the API test files.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        }).on('error', reject);
    });
}

// → { base, host, dataDir, stop() }
async function startServer(env = {}) {
    const port = await freePort();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kouknem-api-'));
    const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: { ...process.env, PORT: String(port), PUBLIC_URL: '', TMDB_READ_TOKEN: 'test', KOUKNEM_DATA_DIR: dataDir, KOUKNEM_ROOMS_PER_IP: '1000', ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
        let out = '';
        const onData = d => {
            out += d;
            if (out.includes('portu ' + port)) { clearTimeout(timer); resolve(); }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('exit', code => reject(new Error('server exited ' + code + ': ' + out)));
    });
    return { base: 'http://127.0.0.1:' + port, host: '127.0.0.1:' + port, dataDir, stop: () => proc.kill() };
}

// Server-Sent Events reader: collects messages until close().
async function sse(url) {
    const ctl = new AbortController();
    const res = await fetch(url, { signal: ctl.signal });
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

async function waitFor(fn, ms = 2000) {
    const t = Date.now();
    while (!fn()) {
        if (Date.now() - t > ms) throw new Error('timeout');
        await new Promise(r => setTimeout(r, 20));
    }
}

module.exports = { startServer, sse, waitFor };
