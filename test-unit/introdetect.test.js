// introdetect.js: two generated "episodes" that share an opening jingle and end
// credits at different places (different noise around them, different volume).
// Needs ffmpeg — skipped without it.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const det = require('../introdetect');

let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { ffmpeg = false; }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-intro-'));
const JINGLE = "0.4*sin(2*PI*t*(300+120*floor(mod(t*2\\,8))))+0.25*sin(2*PI*t*(1100+90*floor(mod(t*3\\,5))))";
const CREDITS = "0.35*sin(2*PI*t*(520+70*floor(mod(t*1.5\\,6))))+0.2*sin(2*PI*t*(1600-110*floor(mod(t*2.5\\,4))))";
// [kind, seconds, seed | volume]
function episode(name, parts) {
    const inputs = [];
    parts.forEach(([kind, d, x]) => {
        inputs.push('-f', 'lavfi', '-i', kind === 'noise'
            ? `anoisesrc=d=${d}:c=pink:r=8000:a=0.25:s=${x}`
            : `aevalsrc='${(kind === 'jingle' ? JINGLE : CREDITS).replace(/'/g, '')}*${x}':d=${d}:s=8000`);
    });
    const file = path.join(dir, name + '.m4a');
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs,
        '-filter_complex', parts.map((_, i) => `[${i}]`).join('') + `concat=n=${parts.length}:v=0:a=1`, '-c:a', 'aac', '-b:a', '64k', file]);
    return file;
}

let A, B, C;
test.before(() => {
    if (!ffmpeg) return;
    // A: intro 70–110 s, credits 310–340 of 360 s (50 s before the end)
    A = episode('a', [['noise', 70, 1], ['jingle', 40, 1], ['noise', 200, 2], ['credits', 30, 1], ['noise', 20, 3]]);
    // B: intro 20–60 s, quieter; credits 40 s before the end
    B = episode('b', [['noise', 20, 4], ['jingle', 40, 0.6], ['noise', 260, 5], ['credits', 30, 0.7], ['noise', 10, 6]]);
    // C: nothing in common with A
    C = episode('c', [['noise', 360, 7]]);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('finds the shared opening and the end credits', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
    const r = await det.detectPair(A, B);
    assert.ok(r.intro, 'intro found');
    assert.ok(Math.abs(r.intro.start - 70) <= 1.5, 'start ' + r.intro.start);
    assert.ok(Math.abs(r.intro.end - 110) <= 1.5, 'end ' + r.intro.end);
    assert.ok(r.credits && Math.abs(r.credits - 50) <= 1.5, 'credits ' + r.credits);
});

test('episodes with nothing in common: no marks', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
    const r = await det.detectPair(A, C);
    assert.deepStrictEqual(r, { intro: null, credits: null });
});

test('reads over http (range requests) like a CDN', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
    const server = http.createServer((req, res) => {
        const file = req.url.indexOf('a.m4a') >= 0 ? A : B;
        const size = fs.statSync(file).size;
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        if (!m) { res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mp4' }); return fs.createReadStream(file).pipe(res); }
        const start = +m[1], end = m[2] ? +m[2] : size - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mp4' });
        fs.createReadStream(file, { start, end }).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    try {
        const r = await det.detectPair(base + 'a.m4a', base + 'b.m4a');
        assert.ok(r.intro && Math.abs(r.intro.start - 70) <= 1.5);
        assert.ok(r.credits && Math.abs(r.credits - 50) <= 1.5);
    } finally { server.close(); }
});

test('job: saves an automatic mark, never over one set by hand, once per season', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
    const store = [];
    const intros = {
        list: id => store.filter(i => i.tmdbId === id),
        set: (id, season, m) => { const i = store.findIndex(x => x.tmdbId === id && x.season === season); if (i >= 0) store.splice(i, 1); store.push(Object.assign({ tmdbId: id, season }, m)); }
    };
    const asked = [];
    const d = det.createDetector({ intros, findEpisodeSrc: async (id, s, n) => { asked.push(n); return n === 3 ? B : null; } });
    const job = d.request({ tmdbId: 1, season: 1, episode: 4, src: A });
    assert.strictEqual(d.request({ tmdbId: 1, season: 1, episode: 4, src: A }), job, 'no second job');
    for (let i = 0; i < 300 && (job.status === 'queued' || job.status === 'running'); i++) await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(job.status, 'done', job.error);
    assert.deepStrictEqual(asked, [5, 3], 'next episode first, then the previous one');
    const m = intros.list(1)[0];
    assert.ok(m.auto && Math.abs(m.start - 70) <= 1.5 && Math.abs(m.credits - 50) <= 1.5);

    intros.set(2, 1, { start: 5, end: 40 });            // by hand
    const job2 = d.request({ tmdbId: 2, season: 1, episode: 2, src: A });
    for (let i = 0; i < 300 && (job2.status === 'queued' || job2.status === 'running'); i++) await new Promise(r => setTimeout(r, 100));
    const m2 = intros.list(2)[0];
    assert.deepStrictEqual([m2.start, m2.end, !!m2.auto], [5, 40, false], 'hand-made mark kept');
    assert.ok(Math.abs(m2.credits - 50) <= 1.5, 'credits added to it');
});
