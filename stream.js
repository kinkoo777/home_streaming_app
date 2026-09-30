// ── prehraj.to video extraction + MP4 colour-tag probing + streaming proxy ──
//
// Many "4K" uploads on prehraj.to are HDR (BT.2020 / PQ) masters that were
// transcoded to 8-bit H.264 *without* tone mapping, but kept their HDR colour
// tags. Smart-TV browsers trust those tags and render the picture purple/green.
// /stream rewrites the tags (MP4 `colr` box + H.264 SPS VUI) to plain BT.709 in
// place — same byte length, so HTTP range requests / seeking keep working — and
// the player tone-maps the pixels back to SDR with WebGL.

const { Readable, Transform, pipeline } = require('stream');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/117.0.0.0 Safari/537.36';

// Video/subtitle files live on prehraj.to's CDN, fastshare's or sledujteto's stream servers.
function isAllowedCdnUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
        const host = u.hostname.toLowerCase();
        return host === 'premiumcdn.net' || host.endsWith('.premiumcdn.net')
            || host === 'prehrajto.cz' || host.endsWith('.prehrajto.cz')
            || host === 'fastshare.cloud' || host.endsWith('.fastshare.cloud')
            || host === 'sledujteto.cz' || host.endsWith('.sledujteto.cz');
    } catch {
        return false;
    }
}

// ── Page extraction (no headless browser needed) ──

function jsString(s) {
    try { return JSON.parse('"' + s + '"'); } catch { return s; }
}

function field(obj, name) {
    const m = obj.match(new RegExp(name + `\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`));
    return m ? jsString(m[1] != null ? m[1] : m[2]) : null;
}

function meta(html, prop) {
    const m = html.match(new RegExp(`<meta\\s+itemprop="${prop}"\\s+content="([^"]*)"`));
    return m ? m[1] : null;
}

// Short human label from prehraj.to's "CZE1 - 12703997 - cze1" style track names.
function cleanTrackLabel(label, lang) {
    const first = (label || '').split(' - ')[0].trim();
    return first || (lang || '').toUpperCase() || 'Titulky';
}

function parseVideoPage(html) {
    const qualities = [];
    const seen = new Set();
    const add = (src, label, res) => {
        if (!src || seen.has(src) || src.startsWith('blob:')) return;
        seen.add(src);
        const r = parseInt(res || (label || '').match(/(\d{3,4})p/)?.[1], 10) || null;
        qualities.push({ src, label: label || (r ? r + 'p' : 'Zdroj'), res: r });
    };

    // videojs branch: videos.push({ src: "...", type: 'video/mp4', res: '1080', label: '1080p' })
    for (const m of html.matchAll(/videos\.push\(\s*(\{[\s\S]*?\})\s*\)/g)) {
        add(field(m[1], 'src'), field(m[1], 'label'), field(m[1], 'res'));
    }
    // jwplayer branch: { file: "....mp4", label: '720p' }
    for (const m of html.matchAll(/\{\s*file:\s*"([^"]+\.(?:mp4|m3u8|webm|mkv)[^"]*)"\s*,\s*label:\s*'([^']*)'/g)) {
        add(jsString(m[1]), m[2]);
    }
    qualities.sort((a, b) => (b.res || 0) - (a.res || 0));

    // Both player branches list the same tracks; merge them (only videojs has srclang).
    const subs = new Map();
    for (const m of html.matchAll(/\{\s*(?:src|file)\s*:\s*"([^"]+\.(?:vtt|srt)[^"]*)"([\s\S]*?)\}/g)) {
        const src  = jsString(m[1]);
        const rest = m[2];
        const prev = subs.get(src) || {};
        const lang = field(rest, 'srclang') || prev.lang || '';
        subs.set(src, {
            src,
            lang,
            label:   cleanTrackLabel(field(rest, 'label') || prev.rawLabel, lang),
            rawLabel: field(rest, 'label') || prev.rawLabel || '',
            default: prev.default || /["']?default["']?\s*:\s*true/.test(rest)
        });
    }
    const subtitles = [...subs.values()].map(({ rawLabel, ...s }) => s);

    return {
        name:      meta(html, 'name'),
        duration:  meta(html, 'duration'),
        thumbnail: meta(html, 'thumbnailUrl'),
        width:     parseInt(meta(html, 'width'), 10) || null,
        height:    parseInt(meta(html, 'height'), 10) || null,
        qualities,
        subtitles
    };
}

async function fetchVideoPage(pageUrl) {
    const r = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Prehrajto neodpovědělo (' + r.status + ')');
    return parseVideoPage(await r.text());
}

// ── fastshare.cloud file page ──
// A single free stream: <video id="player"><source src="https://streamN.fastshare.cloud/download_free_stream.php?..."></video>

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? decodeEntities(m[1] != null ? m[1] : m[2]) : null;
}

function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 8177.5 → "02:16:17" (same shape as prehraj.to's duration meta)
function hms(secs) {
    const t = Math.floor(secs);
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':');
}

// pageUrl resolves relative srcs (subtitles are "/api/get_subtitles.php?key=get&id=…").
function parseFastsharePage(html, pageUrl = 'https://fastshare.cloud/') {
    const abs = src => { try { return new URL(src, pageUrl).href; } catch { return null; } };
    const video = (html.match(/<video\b[^>]*\bid=["']?player["']?[^>]*>[\s\S]*?<\/video>/i) || [])[0] || '';
    const qualities = [];
    for (const m of video.matchAll(/<source\b[^>]*>/gi)) {
        const src = abs(attr(m[0], 'src'));
        if (src && !qualities.some(q => q.src === src)) qualities.push({ src, label: 'Auto', res: null });
    }
    const subtitles = [];
    for (const m of video.matchAll(/<track\b[^>]*>/gi)) {
        const src = abs(attr(m[0], 'src'));
        if (!src) continue;
        const lang = attr(m[0], 'srclang') || '';
        subtitles.push({ src, lang, label: cleanTrackLabel(attr(m[0], 'label'), lang), default: /\bdefault\b/i.test(m[0]) });
    }

    let duration = null;
    const cfg = attr((video.match(/<video\b[^>]*>/i) || [''])[0], 'data-plyr-config');
    if (cfg) {
        try { const secs = JSON.parse(cfg).duration; if (secs > 0) duration = hms(secs); } catch {}
    }
    const h1 = html.match(/<h1\b[^>]*class="[^"]*video_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    const og = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);

    return {
        name:      h1 ? decodeEntities(h1[1].replace(/<[^>]+>/g, '')).trim() : null,
        duration,
        thumbnail: og ? decodeEntities(og[1]) : null,
        width:     null,
        height:    null,
        qualities,
        subtitles
    };
}

async function fetchFastsharePage(pageUrl) {
    const r = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('FastShare neodpovědělo (' + r.status + ')');
    return parseFastsharePage(await r.text(), pageUrl);
}

// ── sledujteto.cz file page ──
// The page only carries init(playerId, playerUrl, dlUrl, mirror) and setTracks([...]);
// the stream link is issued by POST mirror/services/add-file-link → { hash, video_url }.

// "2h 27m 54s" → "02:27:54"
function hmsText(t) {
    const m = String(t || '').match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
    if (!m || !m[0].trim()) return null;
    return hms((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

function parseSledujtetoPage(html, pageUrl = 'https://www.sledujteto.cz/') {
    const init = html.match(/init\(\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*'([^']*)'\s*\)/);
    let subtitles = [];
    const tracks = html.match(/setTracks\((\[[\s\S]*?\])\);/);
    if (tracks) {
        try {
            const list = JSON.parse(decodeEntities(tracks[1]));
            // Labels are upload file names ("thefateofthefurious0000286370"), not languages.
            subtitles = list.filter(t => t && t.file).map((t, i) => ({
                src: new URL(t.file, pageUrl).href,
                lang: '',
                label: list.length > 1 ? 'Titulky ' + (i + 1) : 'Titulky',
                default: i === 0 && /auto_subtitles\s*=\s*true/.test(html)
            }));
        } catch {}
    }
    const og = p => { const m = html.match(new RegExp(`<meta\\s+property="og:${p}"\\s+content="([^"]*)"`, 'i')); return m ? decodeEntities(m[1]) : null; };
    const image = html.match(/player_options\.image_url\s*=\s*'([^']*)'/);
    const dur = html.match(/bi-clock"><\/i>\s*Trvání<\/td>\s*<td>([^<]*)<\/td>/);
    return {
        playerId:  init ? parseInt(init[1], 10) : null,
        playerUrl: init ? init[2] : null,
        mirror:    init ? init[3] : null,
        name:      (og('title') || '').replace(/\s*\|\s*Sledujteto\s*$/i, '').replace(/\s+[\d.,]+\s*[KMGT]B$/i, '') || null,
        duration:  dur ? hmsText(dur[1]) : null,
        thumbnail: image ? image[1] : og('image'),
        width:     null,
        height:    null,
        subtitles
    };
}

async function fetchSledujtetoPage(pageUrl) {
    const r = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Sledujteto neodpovědělo (' + r.status + ')');
    const { playerId, playerUrl, mirror, ...video } = parseSledujtetoPage(await r.text(), pageUrl);
    if (!playerId || !mirror) throw new Error('Video na Sledujteto nebylo nalezeno');

    const lr = await fetch(new URL('/services/add-file-link', mirror).href, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: pageUrl },
        body: JSON.stringify({ params: { id: playerId } }),
        signal: AbortSignal.timeout(15000)
    });
    const link = await lr.json().catch(() => ({}));
    if (!link.hash) throw new Error(link.msg || 'Sledujteto nevydalo odkaz na video');
    const src = link.video_url || playerUrl + link.hash;
    return { ...video, qualities: isAllowedCdnUrl(src) ? [{ src, label: 'Auto', res: null }] : [] };
}

// ── MP4 probing ──

async function fetchRange(url, start, end) {
    const r = await fetch(url, {
        headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(10000)
    });
    if (r.status !== 206 && r.status !== 200) throw new Error('CDN ' + r.status);
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10) || null;
    // A 200 means the server ignored Range — read only what we asked for.
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    const want = end - start + 1;
    while (got < want) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
    }
    reader.cancel().catch(() => {});
    return { buf: Buffer.concat(chunks).subarray(0, want), total };
}

// MSB-first bit reader over an RBSP (emulation-prevention bytes removed).
class BitReader {
    constructor(buf) { this.buf = buf; this.pos = 0; }
    u(n) {
        let v = 0;
        for (let i = 0; i < n; i++) {
            const byte = this.buf[this.pos >> 3];
            if (byte === undefined) throw new Error('SPS truncated');
            v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
            this.pos++;
        }
        return v >>> 0;
    }
    ue() {
        let zeros = 0;
        while (this.u(1) === 0) { if (++zeros > 31) throw new Error('bad exp-golomb'); }
        return (2 ** zeros) - 1 + (zeros ? this.u(zeros) : 0);
    }
    se() { const k = this.ue(); return k & 1 ? (k + 1) / 2 : -(k / 2); }
}

function unescapeNal(nal) {
    const out = [];
    let zeros = 0;
    for (const b of nal) {
        if (zeros >= 2 && b === 3) { zeros = 0; continue; }
        out.push(b);
        zeros = b === 0 ? zeros + 1 : 0;
    }
    return { rbsp: Buffer.from(out) };
}

// Returns the RBSP bit offset of colour_primaries in an H.264 SPS, plus the
// current values, or null if the SPS has no colour description.
function findSpsColour(rbsp) {
    const r = new BitReader(rbsp);
    r.u(8);                                     // NAL header
    const profile = r.u(8); r.u(8); r.u(8); r.ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
        const chroma = r.ue();
        if (chroma === 3) r.u(1);
        r.ue(); r.ue(); r.u(1);
        if (r.u(1)) {
            for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
                if (!r.u(1)) continue;
                let last = 8, next = 8;
                for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
                    if (next !== 0) next = (last + r.se() + 256) % 256;
                    last = next === 0 ? last : next;
                }
            }
        }
    }
    r.ue();
    const poc = r.ue();
    if (poc === 0) r.ue();
    else if (poc === 1) { r.u(1); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
    r.ue(); r.u(1); r.ue(); r.ue();
    if (!r.u(1)) r.u(1);
    r.u(1);
    if (r.u(1)) { r.ue(); r.ue(); r.ue(); r.ue(); }
    if (!r.u(1)) return null;                   // no VUI
    if (r.u(1)) { if (r.u(8) === 255) { r.u(16); r.u(16); } }
    if (r.u(1)) r.u(1);
    if (!r.u(1)) return null;                   // no video_signal_type
    r.u(3); r.u(1);
    if (!r.u(1)) return null;                   // no colour description
    const bit = r.pos;
    return { bit, primaries: r.u(8), transfer: r.u(8), matrix: r.u(8) };
}

// Patch colour_primaries/transfer/matrix (3 fixed-width bytes) inside an escaped
// SPS NAL. Returns the patched NAL, or null if patching would change its length.
function patchSps(nal, colour, values) {
    const out = Buffer.from(unescapeNal(nal).rbsp);
    let bit = colour.bit;
    for (const v of values) {
        for (let i = 7; i >= 0; i--) {
            const byte = bit >> 3, mask = 1 << (7 - (bit & 7));
            if ((v >> i) & 1) out[byte] |= mask; else out[byte] &= ~mask;
            bit++;
        }
    }
    // Re-escape and require identical length so file offsets stay valid.
    const esc = [];
    let zeros = 0;
    for (const b of out) {
        if (zeros >= 2 && b <= 3) { esc.push(3); zeros = 0; }
        esc.push(b);
        zeros = b === 0 ? zeros + 1 : 0;
    }
    if (esc.length !== nal.length) return null;
    return Buffer.from(esc);
}

const TRANSFER = { 1: 'bt709', 6: 'bt709', 14: 'bt709', 15: 'bt709', 16: 'pq', 18: 'hlg' };
const BT709 = [1, 1, 1];

// Locate the video sample description in the MP4 header and compute byte
// patches that turn HDR colour tags into BT.709.
async function probeMp4(url) {
    let { buf, total } = await fetchRange(url, 0, 512 * 1024 - 1);
    let base = 0;

    // Walk top-level boxes to find moov (usually first, "faststart").
    let off = 0, moovStart = -1, moovSize = 0;
    for (let guard = 0; guard < 32; guard++) {
        let hdr;
        if (off - base + 16 <= buf.length && off >= base) hdr = buf.subarray(off - base, off - base + 16);
        else if (total && off < total) hdr = (await fetchRange(url, off, off + 15)).buf;
        else break;
        let size = hdr.readUInt32BE(0);
        const type = hdr.toString('latin1', 4, 8);
        if (size === 1) size = Number(hdr.readBigUInt64BE(8));
        else if (size === 0) size = (total || 0) - off;
        if (size < 8) break;
        if (type === 'moov') { moovStart = off; moovSize = size; break; }
        off += size;
    }
    if (moovStart < 0) return { transfer: 'unknown', patches: [] };

    // We only need the start of moov: the first trak's stsd sits near the top.
    const want = Math.min(moovSize, 4 * 1024 * 1024);
    if (!(moovStart >= base && moovStart + want <= base + buf.length)) {
        ({ buf } = await fetchRange(url, moovStart, moovStart + want - 1));
        base = moovStart;
    }

    const info = { transfer: 'unknown', primaries: null, codec: null, patches: [] };
    for (const c of ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09']) {
        if (buf.indexOf(c, 0, 'latin1') >= 0) { info.codec = c; break; }
    }

    // colr / nclx box
    for (let i = buf.indexOf('colrnclx', 0, 'latin1'); i >= 0; i = buf.indexOf('colrnclx', i + 1, 'latin1')) {
        const p = i + 8;
        if (p + 6 > buf.length) break;
        info.primaries = buf.readUInt16BE(p);
        const trc = buf.readUInt16BE(p + 2);
        info.transfer = TRANSFER[trc] || 'other:' + trc;
        if (trc === 16 || trc === 18 || info.primaries === 9) {
            info.patches.push({ offset: base + p, bytes: Buffer.from([0, 1, 0, 1, 0, 1]) });
        }
    }

    // avcC → SPS VUI colour description
    const a = buf.indexOf('avcC', 0, 'latin1');
    if (a >= 0) {
        let p = a + 4 + 5;
        const nSps = buf[p] & 31; p++;
        for (let s = 0; s < nSps && p + 2 <= buf.length; s++) {
            const len = buf.readUInt16BE(p); p += 2;
            const nal = buf.subarray(p, p + len);
            try {
                const colour = findSpsColour(unescapeNal(nal).rbsp);
                if (colour) {
                    if (info.transfer === 'unknown') {
                        info.primaries = colour.primaries;
                        info.transfer = TRANSFER[colour.transfer] || 'other:' + colour.transfer;
                    }
                    if (colour.transfer === 16 || colour.transfer === 18 || colour.primaries === 9) {
                        const patched = patchSps(nal, colour, BT709);
                        if (patched) info.patches.push({ offset: base + p, bytes: patched });
                    }
                }
            } catch (err) {
                console.error('SPS parse selhalo:', err.message);
            }
            p += len;
        }
    }

    info.hdr = info.transfer === 'pq' || info.transfer === 'hlg';
    return info;
}

// Signed CDN URLs change per page load but point at the same file, so key the
// cache by path (without the query string). fastshare serves every file from the
// same script path, so its file id has to be part of the key.
const probeCache = new Map();
function probeKey(url) {
    try {
        const u = new URL(url);
        const id = u.hostname.endsWith('fastshare.cloud') ? u.searchParams.get('id') : null;
        return u.host + u.pathname + (id ? '?id=' + id : '');
    } catch { return url; }
}

function getMp4Info(url) {
    const key = probeKey(url);
    if (probeCache.has(key)) return probeCache.get(key);
    const p = probeMp4(url).catch(err => {
        probeCache.delete(key);
        console.error('MP4 probe selhal:', err.message);
        return { transfer: 'unknown', hdr: false, patches: [] };
    });
    probeCache.set(key, p);
    if (probeCache.size > 200) probeCache.delete(probeCache.keys().next().value);
    return p;
}

// ── Streaming proxy ──

function patchTransform(startOffset, patches) {
    let pos = startOffset;
    return new Transform({
        transform(chunk, _enc, cb) {
            const end = pos + chunk.length;
            for (const { offset, bytes } of patches) {
                const pEnd = offset + bytes.length;
                if (pEnd <= pos || offset >= end) continue;
                const from = Math.max(offset, pos), to = Math.min(pEnd, end);
                chunk = Buffer.from(chunk);     // own a writable copy
                bytes.copy(chunk, from - pos, from - offset, to - offset);
            }
            pos = end;
            cb(null, chunk);
        }
    });
}

async function handleStream(req, res) {
    const url = req.query.url;
    if (typeof url !== 'string' || !isAllowedCdnUrl(url)) return res.status(400).json({ error: 'Nepovolená URL' });

    const info = await getMp4Info(url);
    const headers = { 'User-Agent': UA };
    if (req.headers.range) headers.Range = req.headers.range;

    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });

    let up;
    try {
        up = await fetch(url, { headers, signal: ac.signal });
    } catch (err) {
        if (!res.headersSent) res.status(502).json({ error: err.message });
        return;
    }

    res.status(up.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
        const v = up.headers.get(h);
        if (v) res.setHeader(h, v);
    }
    if (!up.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    if (!up.ok || !up.body) { res.end(); return; }

    const m = (up.headers.get('content-range') || '').match(/bytes\s+(\d+)-/);
    const start = m ? parseInt(m[1], 10) : 0;
    const body = Readable.fromWeb(up.body);
    const src = info.patches.length ? pipeline(body, patchTransform(start, info.patches), () => {}) : body;
    pipeline(src, res, err => {
        if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.name !== 'AbortError') {
            console.error('STREAM ERROR:', err.message);
        }
    });
}

module.exports = { UA, isAllowedCdnUrl, parseVideoPage, fetchVideoPage, parseFastsharePage, fetchFastsharePage, parseSledujtetoPage, fetchSledujtetoPage, getMp4Info, handleStream, cleanTrackLabel };
// Internals, exported for the unit tests (test-unit/).
module.exports._internals = { unescapeNal, findSpsColour, patchSps, patchTransform, probeKey };
