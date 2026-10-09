// ================= KEEP ON THE PI (downloads) =================
// "Stáhnout do FilmBoxu" saves a film / episode on the server's disk (data/downloads,
// or FILMBOX_DOWNLOAD_DIR — e.g. a USB disk). Played from there it starts at once and
// never buffers, and it keeps working when the upload disappears. One download at a
// time; resumes after a restart or an expired link (fresh link from the page);
// stops when the disk would fall under FILMBOX_DOWNLOAD_MIN_FREE_GB (default 2 GB).
// HDR colour tags are fixed in the file (same patches as the /stream proxy), and the
// subtitles are saved next to it.
//
// downloads.json: [{ id, key, tmdbId, mediaType, episode, episodeLabel, title, posterPath,
//   pageUrl, src, label, res, size, done, status, error, subtitles: [{ label, lang, file }],
//   patches: [{ offset, bytes(base64) }], createdAt, finishedAt }]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const GB = 1024 * 1024 * 1024;

// "movie:603" | "tv:1399:S01E02"
function keyOf(p) {
    if (!p || !p.tmdbId) return null;
    if (p.mediaType === 'tv') {
        if (!p.episode) return null;
        return `tv:${p.tmdbId}:S${String(p.episode.season).padStart(2, '0')}E${String(p.episode.number).padStart(2, '0')}`;
    }
    return 'movie:' + p.tmdbId;
}

// deps: { dir, dataDir, resolveVideo(pageUrl), getMp4Info(url), loadSubtitle(src) → vtt, isAllowedCdnUrl, UA }
function createDownloads(deps) {
    const dir = deps.dir;
    const file = path.join(deps.dataDir, 'downloads.json');
    const minFree = (parseFloat(process.env.FILMBOX_DOWNLOAD_MIN_FREE_GB) || 2) * GB;
    let list = [];
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(list)) list = []; } catch (e) { list = []; }
    let saveTimer = null;
    function save(now) {
        const write = () => { saveTimer = null; fs.mkdirSync(deps.dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 1)); };
        if (now) { clearTimeout(saveTimer); write(); }
        else if (!saveTimer) saveTimer = setTimeout(write, 2000);
    }
    const videoPath = d => path.join(dir, d.id + '.mp4');
    const partPath = d => path.join(dir, d.id + '.part');
    let active = null;            // { d, ctl }

    async function freeBytes() {
        try { const s = await fs.promises.statfs(dir); return s.bavail * s.bsize; } catch (e) { return Infinity; }
    }

    function pub(d) {
        return {
            id: d.id, key: d.key, tmdbId: d.tmdbId, mediaType: d.mediaType, episode: d.episode, episodeLabel: d.episodeLabel,
            title: d.title, posterPath: d.posterPath, label: d.label, res: d.res, size: d.size, done: d.done,
            status: d.status, error: d.error || null, createdAt: d.createdAt, finishedAt: d.finishedAt || null,
            subtitles: (d.subtitles || []).map((s, i) => ({ label: s.label, lang: s.lang, src: `/downloads/${d.id}/sub/${i}` })),
            video: d.status === 'done' ? `/downloads/${d.id}/video` : null
        };
    }

    // A player payload ({ title, tmdbId, mediaType, episode, posterPath, source }) + which
    // quality (its src) → queued entry.
    function add(player, qualitySrc) {
        const key = keyOf(player);
        if (!key) throw Object.assign(new Error('Stáhnout jde jen film nebo díl z FilmBoxu'), { code: 400 });
        const existing = list.filter(d => d.key === key && d.status !== 'failed')[0];
        if (existing) return existing;
        const qs = (player.source && player.source.qualities) || [];
        const q = qs.filter(x => x.src === qualitySrc)[0] || qs.slice().sort((a, b) => (b.res || 0) - (a.res || 0)).filter(x => (x.res || 0) <= 1080)[0] || qs[0];
        if (!q || !deps.isAllowedCdnUrl(q.src)) throw Object.assign(new Error('Nepovolený odkaz na video'), { code: 400 });
        const d = {
            id: crypto.randomBytes(6).toString('hex'), key,
            tmdbId: Number(player.tmdbId), mediaType: player.mediaType === 'tv' ? 'tv' : 'movie',
            episode: player.episode || null, episodeLabel: player.episodeLabel || null,
            title: String(player.title || 'Film').slice(0, 200), posterPath: player.posterPath || null,
            pageUrl: (player.source && player.source.pageUrl) || null,
            src: q.src, label: q.label || '', res: q.res || null,
            sourceSubs: ((player.source && player.source.subtitles) || []).slice(0, 6).map(s => ({ src: s.src, label: s.label || s.lang || 'Titulky', lang: s.lang || '' })),
            size: 0, done: 0, status: 'queued', createdAt: new Date().toISOString()
        };
        list.unshift(d);
        save(true);
        pump();
        return d;
    }

    async function remove(id) {
        const d = list.filter(x => x.id === id)[0];
        if (!d) return false;
        if (active && active.d === d) active.ctl.abort();
        list = list.filter(x => x !== d);
        save(true);
        for (const f of [videoPath(d), partPath(d)].concat((d.subtitles || []).map(s => path.join(dir, s.file)))) {
            try { await fs.promises.unlink(f); } catch (e) {}
        }
        pump();
        return true;
    }

    async function fresh(d) {
        if (!d.pageUrl) return false;
        try {
            const src = await deps.resolveVideo(d.pageUrl);
            const q = src.qualities.filter(x => x.res === d.res && x.label === d.label)[0] || src.qualities.filter(x => x.res === d.res)[0];
            if (!q) return false;
            d.src = q.src;
            if (src.subtitles && src.subtitles.length && !(d.sourceSubs || []).length) d.sourceSubs = src.subtitles.slice(0, 6);
            return true;
        } catch (e) { return false; }
    }

    async function run(d) {
        const ctl = new AbortController();
        active = { d, ctl };
        d.status = 'downloading';
        d.error = null;
        save();
        fs.mkdirSync(dir, { recursive: true });
        try {
            // Colour-tag patches, worked out from the file's header while the link is fresh.
            if (!d.patches) {
                try {
                    const info = await deps.getMp4Info(d.src);
                    d.patches = (info.patches || []).map(p => ({ offset: p.offset, bytes: Buffer.from(p.bytes).toString('base64') }));
                } catch (e) { d.patches = []; }
            }
            for (let attempt = 0; attempt < 4; attempt++) {
                let have = 0;
                try { have = (await fs.promises.stat(partPath(d))).size; } catch (e) {}
                const r = await fetch(d.src, { headers: Object.assign({ 'User-Agent': deps.UA || 'Mozilla/5.0' }, have ? { Range: `bytes=${have}-` } : {}), signal: ctl.signal });
                if (r.status === 403 || r.status === 410 || r.status === 404) {
                    if (attempt < 3 && await fresh(d)) continue;
                    throw new Error('Odkaz na video už nefunguje');
                }
                if (r.status === 416) break;                       // already complete
                if (!r.ok) throw new Error('Server zdroje odpověděl ' + r.status);
                const resumed = r.status === 206 && have > 0;
                const total = resumed
                    ? parseInt(((r.headers.get('content-range') || '').split('/')[1]) || '0', 10)
                    : parseInt(r.headers.get('content-length') || '0', 10);
                d.size = total || d.size;
                if (d.size && (await freeBytes()) - (d.size - have) < minFree) throw new Error('Na disku není dost místa');
                d.done = resumed ? have : 0;
                const out = fs.createWriteStream(partPath(d), { flags: resumed ? 'a' : 'w' });
                let lastCheck = Date.now();
                const body = Readable.fromWeb(r.body);
                body.on('data', c => {
                    d.done += c.length;
                    save();
                    if (Date.now() - lastCheck > 15000) {
                        lastCheck = Date.now();
                        freeBytes().then(f => { if (f < minFree) ctl.abort(new Error('Na disku dochází místo')); });
                    }
                });
                try {
                    await pipeline(body, out);
                    break;
                } catch (err) {
                    if (ctl.signal.aborted) throw ctl.signal.reason instanceof Error ? ctl.signal.reason : err;
                    if (attempt === 3) throw err;                 // connection dropped → resume
                }
            }
            // Fix the HDR tags in place (same length) and finish.
            if (d.patches && d.patches.length) {
                const fd = await fs.promises.open(partPath(d), 'r+');
                try { for (const p of d.patches) { const b = Buffer.from(p.bytes, 'base64'); await fd.write(b, 0, b.length, p.offset); } }
                finally { await fd.close(); }
            }
            await fs.promises.rename(partPath(d), videoPath(d));
            d.size = (await fs.promises.stat(videoPath(d))).size;
            d.done = d.size;
            d.subtitles = [];
            for (const [i, s] of (d.sourceSubs || []).entries()) {
                try {
                    const vtt = await deps.loadSubtitle(s.src);
                    const name = `${d.id}.${i}.vtt`;
                    await fs.promises.writeFile(path.join(dir, name), vtt);
                    d.subtitles.push({ label: s.label, lang: s.lang, file: name });
                } catch (e) { /* video without that subtitle track */ }
            }
            d.status = 'done';
            d.finishedAt = new Date().toISOString();
        } catch (err) {
            if (!list.includes(d)) return;                       // deleted meanwhile
            d.status = 'failed';
            d.error = err.message;
            console.error('Stahování', d.title + ':', err.message);
        } finally {
            active = null;
            save(true);
        }
    }

    function pump() {
        if (active) return;
        const next = list.slice().reverse().filter(d => d.status === 'queued' || d.status === 'downloading')[0];
        if (next) run(next).then(pump, pump);
    }

    // Restarted mid-download → carry on.
    setTimeout(pump, 3000).unref();

    return {
        list: () => list.map(pub),
        get: id => { const d = list.filter(x => x.id === id)[0]; return d ? pub(d) : null; },
        find: key => { const d = list.filter(x => x.key === key)[0]; return d ? pub(d) : null; },
        add: (player, src) => pub(add(player, src)),
        retry: id => { const d = list.filter(x => x.id === id)[0]; if (d && d.status === 'failed') { d.status = 'queued'; save(true); pump(); } return d ? pub(d) : null; },
        remove,
        videoFile: id => { const d = list.filter(x => x.id === id)[0]; return d && d.status === 'done' ? videoPath(d) : null; },
        subFile: (id, n) => { const d = list.filter(x => x.id === id)[0]; const s = d && d.subtitles && d.subtitles[n]; return s ? path.join(dir, s.file) : null; },
        freeBytes,
        keyOf
    };
}

module.exports = { createDownloads, keyOf };
