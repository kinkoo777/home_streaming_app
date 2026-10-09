// ================= AUTOMATIC INTRO + CREDITS DETECTION =================
// Episodes of one season share their opening and end credits. Two episodes' audio
// is decoded (ffmpeg, mono 8 kHz, lowest quality — only the first 8 minutes and the
// last 4), turned into audio fingerprints and lined up: the longest stretch both
// share (15–150 s) is the intro / the credits. Results become the season's
// "Přeskočit úvod" mark (auto: true — a mark set by hand always wins) and the point
// where "Další epizoda" appears.
//
// Fingerprint: 256 ms frames every 128 ms; 33 log-spaced bands 250–3000 Hz; bit b is
// whether band b - band b+1 grew since the previous frame (Haitsma & Kalker), which
// survives different encodings and volumes. Near-silent frames never match.

const { spawn, execFile } = require('child_process');

const RATE = 8000;
const FRAME = 2048;                 // 256 ms
const HOP = 1024;                   // 128 ms
const HOP_S = HOP / RATE;
const BANDS = 33;
const MIN_LEN = 15, MAX_LEN = 150;  // seconds
const INTRO_WINDOW = 480;           // first 8 minutes
const CREDITS_WINDOW = 240;         // last 4 minutes

// ── FFT (in place, radix 2) ──
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k, b = a + len / 2;
                const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr; im[a] += xi;
                const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
            }
        }
    }
}

// Float32Array PCM (8 kHz mono) → { fp: Uint32Array, ok: Uint8Array }
function fingerprint(pcm) {
    const frames = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1);
    const fp = new Uint32Array(frames), ok = new Uint8Array(frames);
    const edges = [];
    for (let b = 0; b <= BANDS; b++) edges.push(Math.round(250 * Math.pow(3000 / 250, b / BANDS) * FRAME / RATE));
    const win = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1));
    const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
    let prev = null;
    for (let f = 0; f < frames; f++) {
        const off = f * HOP;
        let energy = 0;
        for (let i = 0; i < FRAME; i++) { const v = pcm[off + i]; re[i] = v * win[i]; im[i] = 0; energy += v * v; }
        fft(re, im);
        const e = new Float64Array(BANDS);
        for (let b = 0; b < BANDS; b++) {
            let s = 0;
            for (let k = edges[b]; k < Math.max(edges[b + 1], edges[b] + 1); k++) s += re[k] * re[k] + im[k] * im[k];
            e[b] = s;
        }
        if (prev) {
            let bits = 0;
            for (let b = 0; b < 32; b++) if ((e[b] - e[b + 1]) - (prev[b] - prev[b + 1]) > 0) bits |= (1 << b);
            fp[f] = bits >>> 0;
        }
        ok[f] = prev && energy / FRAME > 1e-6 ? 1 : 0;
        prev = e;
    }
    return { fp, ok };
}

function popcount(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// Longest stretch the two fingerprints share → { aStart, aEnd, bStart, bEnd } (seconds) | null
function findCommon(A, B, opts) {
    opts = opts || {};
    const minF = Math.round((opts.minLen || MIN_LEN) / HOP_S);
    const maxF = Math.round((opts.maxLen || MAX_LEN) / HOP_S);
    const gapF = Math.round(1.5 / HOP_S);
    const na = A.fp.length, nb = B.fp.length;
    if (na < minF || nb < minF) return null;
    // 1) Which offsets (b = a - off) line up best: count close frames, every 2nd frame.
    const cands = [];
    for (let off = -(nb - minF); off <= na - minF; off++) {
        const i0 = Math.max(0, off), i1 = Math.min(na, nb + off);
        let c = 0;
        for (let i = i0; i < i1; i += 2) {
            const j = i - off;
            if (A.ok[i] && B.ok[j] && popcount(A.fp[i] ^ B.fp[j]) <= 8) c++;
        }
        if (c * 2 < minF / 3) continue;
        cands.push({ off, c });
    }
    cands.sort((x, y) => y.c - x.c);
    // 2) Along the best offsets, the longest run of matching frames (short gaps allowed).
    let best = null;
    for (const { off } of cands.slice(0, 6)) {
        const i0 = Math.max(0, off), i1 = Math.min(na, nb + off);
        let runStart = -1, lastHit = -1;
        const close = (end) => {
            if (runStart >= 0) {
                const len = end - runStart + 1;
                if (len >= minF && (!best || len > best.len)) best = { len, a0: runStart, a1: end, off };
            }
        };
        for (let i = i0; i < i1; i++) {
            const j = i - off;
            const hit = A.ok[i] && B.ok[j] && popcount(A.fp[i] ^ B.fp[j]) <= 10;
            if (hit) {
                if (runStart < 0 || i - lastHit > gapF) { close(lastHit); runStart = i; }
                lastHit = i;
            }
        }
        close(lastHit);
    }
    if (!best || best.len > maxF) return null;
    const r = x => Math.round(x * HOP_S * 10) / 10;
    return { aStart: r(best.a0), aEnd: r(best.a1 + 1), bStart: r(best.a0 - best.off), bEnd: r(best.a1 + 1 - best.off) };
}

// ── Decoding with ffmpeg ──
let _ffmpeg;
function hasFfmpeg() {
    if (_ffmpeg === undefined) {
        _ffmpeg = new Promise(resolve => execFile(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { timeout: 10000 }, err => resolve(!err)));
    }
    return _ffmpeg;
}
// → Float32Array; { start } from the beginning, or { fromEnd } seconds before the end.
function decode(url, { start, fromEnd, seconds }) {
    return new Promise((resolve, reject) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
        if (/^https?:/i.test(url)) args.push('-user_agent', 'Mozilla/5.0 FilmBox', '-reconnect', '1', '-reconnect_streamed', '1');
        if (fromEnd) args.push('-sseof', String(-fromEnd)); else if (start) args.push('-ss', String(start));
        args.push('-t', String(seconds), '-i', url, '-vn', '-sn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1');
        const p = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        let err = '';
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg: časový limit')); }, 4 * 60 * 1000);
        p.stdout.on('data', c => chunks.push(c));
        p.stderr.on('data', d => { err += d; });
        p.on('error', e => { clearTimeout(timer); reject(e); });
        p.on('close', code => {
            clearTimeout(timer);
            const buf = Buffer.concat(chunks);
            if (code !== 0 && buf.length < RATE * 4 * 20) return reject(new Error('ffmpeg: ' + (err.trim().split('\n').pop() || 'chyba ' + code)));
            const aligned = Buffer.alloc(buf.length - (buf.length % 4));
            buf.copy(aligned, 0, 0, aligned.length);
            resolve(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4));
        });
    });
}

// Two episodes → { intro: { start, end } | null, credits: secondsFromEnd | null } (for A)
async function detectPair(urlA, urlB) {
    const [ia, ib] = await Promise.all([
        decode(urlA, { seconds: INTRO_WINDOW }), decode(urlB, { seconds: INTRO_WINDOW })
    ]);
    const intro = findCommon(fingerprint(ia), fingerprint(ib));
    let credits = null;
    try {
        const [ca, cb] = await Promise.all([
            decode(urlA, { fromEnd: CREDITS_WINDOW, seconds: CREDITS_WINDOW }), decode(urlB, { fromEnd: CREDITS_WINDOW, seconds: CREDITS_WINDOW })
        ]);
        const c = findCommon(fingerprint(ca), fingerprint(cb), { maxLen: 230 });
        if (c) credits = Math.round((ca.length / RATE - c.aStart) * 10) / 10;
    } catch (e) { /* the intro alone is still worth it */ }
    return {
        intro: intro && intro.aStart < 360 ? { start: intro.aStart, end: intro.aEnd } : null,
        credits: credits && credits >= 15 && credits <= 300 ? credits : null
    };
}

// ── Jobs: one at a time (the Pi's CPU and the connection), each season at most every 12 h ──
// deps: { intros: introsDB, findEpisodeSrc(tmdbId, season, number) → url | null }
function createDetector(deps) {
    const state = new Map();       // 'tmdbId:season' → { status, at, error }
    let chain = Promise.resolve();
    function request({ tmdbId, season, episode, src }) {
        const key = tmdbId + ':' + season;
        const cur = state.get(key);
        if (cur && (cur.status === 'queued' || cur.status === 'running' || Date.now() - cur.at < 12 * 3600 * 1000)) return cur;
        const job = { status: 'queued', at: Date.now() };
        state.set(key, job);
        chain = chain.then(async () => {
            job.status = 'running';
            try {
                if (!(await hasFfmpeg())) throw new Error('ffmpeg není nainstalovaný');
                // The other episode: the next one, or the previous one for a season finale.
                let other = await deps.findEpisodeSrc(tmdbId, season, episode + 1);
                if (!other && episode > 1) other = await deps.findEpisodeSrc(tmdbId, season, episode - 1);
                if (!other) throw new Error('Druhý díl řady se nenašel');
                const found = await detectPair(src, other);
                const existing = deps.intros.list(tmdbId).filter(i => i.season === season)[0];
                const manual = existing && !existing.auto;
                if (found.intro && !manual) deps.intros.set(tmdbId, season, Object.assign({ start: found.intro.start, end: found.intro.end, auto: true }, found.credits ? { credits: found.credits } : {}));
                else if (found.credits && existing) deps.intros.set(tmdbId, season, Object.assign({}, existing, { credits: found.credits }));
                job.status = found.intro || found.credits ? 'done' : 'nothing';
                job.result = found;
            } catch (err) {
                job.status = 'failed';
                job.error = err.message;
                console.error('Rozpoznání úvodu', key + ':', err.message);
            }
            job.at = Date.now();
        });
        return job;
    }
    return { request, status: (tmdbId, season) => state.get(tmdbId + ':' + season) || null };
}

module.exports = { fingerprint, findCommon, decode, detectPair, createDetector, hasFfmpeg, RATE };
