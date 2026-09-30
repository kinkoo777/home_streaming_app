// Unit tests for stream.js — page parsing and the HDR colour-tag patching.
// Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');
const { parseVideoPage, isAllowedCdnUrl, _internals } = require('../stream');
const { unescapeNal, findSpsColour, patchSps, patchTransform } = _internals;

// Real H.264 SPS from an HDR-tagged prehraj.to upload: 8-bit High profile,
// VUI colour description BT.2020 primaries (9), PQ transfer (16), BT.2020 matrix (9).
const HDR_SPS = Buffer.from('67640029acd940780227e5c05a848804db800001f480005dc0478c18cb', 'hex');

test('findSpsColour reads the VUI colour description', () => {
    const c = findSpsColour(unescapeNal(HDR_SPS).rbsp);
    assert.deepStrictEqual({ p: c.primaries, t: c.transfer, m: c.matrix }, { p: 9, t: 16, m: 9 });
});

test('patchSps rewrites the colour tags to BT.709 without changing length', () => {
    const colour = findSpsColour(unescapeNal(HDR_SPS).rbsp);
    const patched = patchSps(HDR_SPS, colour, [1, 1, 1]);
    assert.ok(patched, 'patch applied');
    assert.strictEqual(patched.length, HDR_SPS.length);
    const after = findSpsColour(unescapeNal(patched).rbsp);
    assert.deepStrictEqual({ p: after.primaries, t: after.transfer, m: after.matrix }, { p: 1, t: 1, m: 1 });
    // Only the three colour bytes may differ.
    let diff = 0;
    for (let i = 0; i < HDR_SPS.length; i++) if (HDR_SPS[i] !== patched[i]) diff++;
    assert.ok(diff > 0 && diff <= 4, `changed ${diff} bytes`);
});

test('unescapeNal removes emulation-prevention bytes', () => {
    const { rbsp } = unescapeNal(Buffer.from([0x00, 0x00, 0x03, 0x01, 0x42]));
    assert.deepStrictEqual([...rbsp], [0x00, 0x00, 0x01, 0x42]);
});

// Push `data` through patchTransform in chunks, as a ranged proxy response would.
async function runPatch(data, start, patches, chunk) {
    const parts = [];
    for (let i = 0; i < data.length; i += chunk) parts.push(data.subarray(i, i + chunk));
    const out = [];
    await new Promise((resolve, reject) => {
        Readable.from(parts).pipe(patchTransform(start, patches))
            .on('data', c => out.push(c)).on('end', resolve).on('error', reject);
    });
    return Buffer.concat(out);
}

test('patchTransform patches bytes that straddle chunk boundaries', async () => {
    const data = Buffer.alloc(100, 0xaa);
    const patches = [{ offset: 48, bytes: Buffer.from([1, 2, 3, 4, 5, 6]) }];
    const out = await runPatch(data, 0, patches, 7);     // 7-byte chunks split the patch
    assert.deepStrictEqual([...out.subarray(48, 54)], [1, 2, 3, 4, 5, 6]);
    assert.strictEqual(out[47], 0xaa);
    assert.strictEqual(out[54], 0xaa);
    assert.strictEqual(out.length, 100);
});

test('patchTransform honours the range start offset', async () => {
    // A ranged response starting at file offset 50 that covers part of a patch at 48..53.
    const data = Buffer.alloc(20, 0xaa);
    const out = await runPatch(data, 50, [{ offset: 48, bytes: Buffer.from([1, 2, 3, 4, 5, 6]) }], 5);
    assert.deepStrictEqual([...out.subarray(0, 4)], [3, 4, 5, 6]);
    assert.strictEqual(out[4], 0xaa);
});

test('patchTransform leaves ranges outside the patch untouched', async () => {
    const data = Buffer.alloc(30, 0x11);
    const out = await runPatch(data, 1000, [{ offset: 48, bytes: Buffer.from([9, 9]) }], 8);
    assert.ok(out.equals(data));
});

test('parseVideoPage extracts qualities, subtitles and metadata', () => {
    const html = `
      <div class="video-wrap"><meta itemprop="duration" content="02:49:04" /><meta itemprop="name" content="Test Film 2014" />
      <meta itemprop="height" content="2160" /><meta itemprop="width" content="3840" /></div>
      <script>
        var sources = [ { file: "https://a.premiumcdn.net/1/x.mp4?t=1", label: '720p' }, { file: "https://a.premiumcdn.net/1/y.mp4?t=1", label: '1080p' } ];
        var tracks = [ { file: "https://a.premiumcdn.net/1/cz.vtt?t=1",  "default": true ,  label: "CZE1 - 1 - cze1", kind: "captions" } ];
        videos.push({ src: "https://a.premiumcdn.net/1/y.mp4?t=1", type: 'video/mp4', res: '1080', label: '1080p', default: true });
        videos.push({ src: "https://a.premiumcdn.net/1/x.mp4?t=1", type: 'video/mp4', res: '720', label: '720p'  });
        var tracks = [ { src: "https://a.premiumcdn.net/1/cz.vtt?t=1", srclang: "cze1", label: "CZE1 - 1 - cze1", kind: "captions", default: true } ];
      </script>`;
    const v = parseVideoPage(html);
    assert.deepStrictEqual(v.qualities.map(q => q.label), ['1080p', '720p']);
    assert.strictEqual(v.qualities[0].res, 1080);
    assert.strictEqual(v.subtitles.length, 1, 'duplicate track merged');
    assert.deepStrictEqual({ label: v.subtitles[0].label, lang: v.subtitles[0].lang, def: v.subtitles[0].default }, { label: 'CZE1', lang: 'cze1', def: true });
    assert.strictEqual(v.duration, '02:49:04');
    assert.strictEqual(v.height, 2160);
});

test('isAllowedCdnUrl only allows prehraj.to CDN hosts', () => {
    assert.ok(isAllowedCdnUrl('https://pf-storage3.premiumcdn.net/x.mp4'));
    assert.ok(isAllowedCdnUrl('https://prehrajto.cz/x'));
    assert.ok(!isAllowedCdnUrl('https://evil.com/premiumcdn.net'));
    assert.ok(!isAllowedCdnUrl('https://premiumcdn.net.evil.com/x'));
    assert.ok(!isAllowedCdnUrl('file:///etc/passwd'));
    assert.ok(!isAllowedCdnUrl('not a url'));
});
