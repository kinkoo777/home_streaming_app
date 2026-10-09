// downloads.js — keeping a video on the server: complete file, HDR patch applied,
// subtitles saved, resume after a dropped connection, fresh link after expiry, disk
// space guard, delete. A local HTTP server plays the CDN.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createDownloads, keyOf } = require('../downloads');

const DATA = crypto.randomBytes(3 * 1024 * 1024);      // a 3 MB "video"
let server, base, dropFirst = false, expired = new Set(), served = [];
test.before(async () => {
    server = http.createServer((req, res) => {
        served.push(req.url + ' ' + (req.headers.range || ''));
        if (expired.has(req.url)) { res.writeHead(403); return res.end(); }
        const m = /bytes=(\d+)-/.exec(req.headers.range || '');
        const start = m ? +m[1] : 0;
        const head = m ? { 'Content-Range': `bytes ${start}-${DATA.length - 1}/${DATA.length}` } : {};
        res.writeHead(m ? 206 : 200, Object.assign({ 'Content-Length': DATA.length - start, 'Accept-Ranges': 'bytes' }, head));
        if (dropFirst) {            // send half, then cut the connection
            dropFirst = false;
            res.write(DATA.subarray(start, start + 1024 * 1024), () => res.destroy());
            return;
        }
        res.end(DATA.subarray(start));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

function make(extra) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-dl-'));
    const dl = createDownloads(Object.assign({
        dir: path.join(dataDir, 'downloads'), dataDir,
        isAllowedCdnUrl: u => u.startsWith(base),
        getMp4Info: async () => ({ patches: [{ offset: 100, bytes: Buffer.from([1, 2, 3, 4]) }] }),
        loadSubtitle: async src => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAhoj ' + src.split('/').pop() + '\n',
        resolveVideo: async () => ({ qualities: [{ src: base + '/fresh.mp4', label: '720p', res: 720 }] }),
        UA: 'test'
    }, extra || {}));
    return { dl, dataDir };
}
const player = (src, extra) => Object.assign({
    title: 'Matrix', tmdbId: 603, mediaType: 'movie', posterPath: '/m.jpg',
    source: { pageUrl: 'https://prehraj.to/matrix', qualities: [{ src, label: '720p', res: 720 }], subtitles: [{ src: base + '/cz.srt', label: 'Čeština', lang: 'cze' }] }
}, extra || {});
async function finished(dl, id) {
    for (let i = 0; i < 200; i++) {
        const d = dl.get(id);
        if (d && (d.status === 'done' || d.status === 'failed')) return d;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('download did not finish');
}
const expected = () => { const b = Buffer.from(DATA); Buffer.from([1, 2, 3, 4]).copy(b, 100); return b; };

test('keys: films and episodes', () => {
    assert.strictEqual(keyOf({ tmdbId: 603, mediaType: 'movie' }), 'movie:603');
    assert.strictEqual(keyOf({ tmdbId: 1399, mediaType: 'tv', episode: { season: 1, number: 2 } }), 'tv:1399:S01E02');
    assert.strictEqual(keyOf({ tmdbId: 1399, mediaType: 'tv' }), null);
});

test('downloads the whole file, fixes the colour tags, saves subtitles; one entry per title', async () => {
    const { dl } = make();
    const d = dl.add(player(base + '/a.mp4'), base + '/a.mp4');
    assert.strictEqual(dl.add(player(base + '/a.mp4'), base + '/a.mp4').id, d.id, 'same title → same entry');
    const done = await finished(dl, d.id);
    assert.strictEqual(done.status, 'done', done.error);
    assert.ok(fs.readFileSync(dl.videoFile(d.id)).equals(expected()));
    assert.strictEqual(done.size, DATA.length);
    assert.deepStrictEqual(done.subtitles.map(s => s.label), ['Čeština']);
    assert.match(fs.readFileSync(dl.subFile(d.id, 0), 'utf8'), /Ahoj cz\.srt/);
    assert.strictEqual(dl.find('movie:603').video, `/downloads/${d.id}/video`);
});

test('a dropped connection resumes where it stopped', async () => {
    const { dl } = make();
    dropFirst = true;
    served = [];
    const d = dl.add(player(base + '/b.mp4'), base + '/b.mp4');
    const done = await finished(dl, d.id);
    assert.strictEqual(done.status, 'done', done.error);
    assert.ok(fs.readFileSync(dl.videoFile(d.id)).equals(expected()));
    // resumed from what reached the disk (≈ 1 MB), not from the start
    assert.ok(served.some(s => { const m = /^\/b\.mp4 bytes=(\d+)-/.exec(s); return m && +m[1] > 500000; }), 'resumed with a Range: ' + served.join(' | '));
});

test('an expired link is refreshed from the video page', async () => {
    const { dl } = make();
    expired.add('/old.mp4');
    const d = dl.add(player(base + '/old.mp4'), base + '/old.mp4');
    const done = await finished(dl, d.id);
    assert.strictEqual(done.status, 'done', done.error);
    assert.ok(fs.readFileSync(dl.videoFile(d.id)).equals(expected()));
});

test('not enough disk space → refused; delete removes the files', async () => {
    process.env.FILMBOX_DOWNLOAD_MIN_FREE_GB = '1000000';
    const orig = console.error; console.error = () => {};
    try {
        const { dl } = make();
        const d = dl.add(player(base + '/c.mp4', { tmdbId: 604 }), base + '/c.mp4');
        const done = await finished(dl, d.id);
        assert.strictEqual(done.status, 'failed');
        assert.match(done.error, /místa/);
    } finally { delete process.env.FILMBOX_DOWNLOAD_MIN_FREE_GB; console.error = orig; }

    const { dl, dataDir } = make();
    const d = dl.add(player(base + '/d.mp4', { tmdbId: 605 }), base + '/d.mp4');
    await finished(dl, d.id);
    const f = dl.videoFile(d.id);
    assert.ok(fs.existsSync(f));
    assert.strictEqual(await dl.remove(d.id), true);
    assert.ok(!fs.existsSync(f));
    assert.deepStrictEqual(dl.list(), []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'downloads.json'), 'utf8')), []);
});

test('only allowed links and FilmBox titles', () => {
    const { dl } = make();
    assert.throws(() => dl.add(player('https://evil.example/x.mp4'), 'https://evil.example/x.mp4'), /Nepovolený/);
    assert.throws(() => dl.add(player(base + '/x.mp4', { tmdbId: null }), base + '/x.mp4'), /Stáhnout jde jen/);
});
