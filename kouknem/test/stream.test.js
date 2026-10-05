// Unit tests for stream.js — page parsing and the HDR colour-tag patching.
// Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('stream');
const { parseVideoPage, parseFastsharePage, parseSledujtetoPage, isAllowedCdnUrl, _internals } = require('../lib/stream');
const { unescapeNal, findSpsColour, patchSps, patchTransform, probeKey } = _internals;

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

test('isAllowedCdnUrl only allows prehraj.to / fastshare CDN hosts', () => {
    assert.ok(isAllowedCdnUrl('https://pf-storage3.premiumcdn.net/x.mp4'));
    assert.ok(isAllowedCdnUrl('https://prehrajto.cz/x'));
    assert.ok(isAllowedCdnUrl('https://stream2.fastshare.cloud/download_free_stream.php?id=1'));
    assert.ok(!isAllowedCdnUrl('https://fastshare.cloud.evil.com/x'));
    assert.ok(isAllowedCdnUrl('https://www.sledujteto.cz/player/index/sledujteto/abc'));
    assert.ok(!isAllowedCdnUrl('https://sledujteto.cz.evil.com/x'));
    assert.ok(!isAllowedCdnUrl('https://evil.com/premiumcdn.net'));
    assert.ok(!isAllowedCdnUrl('https://premiumcdn.net.evil.com/x'));
    assert.ok(!isAllowedCdnUrl('file:///etc/passwd'));
    assert.ok(!isAllowedCdnUrl('not a url'));
});

test('parseFastsharePage extracts the free stream and metadata', () => {
    const html = `
      <meta property="og:image" content="https://img.fastshare.cloud/upload/tn/1.jpg" />
      <h1 title="Test Film (2014) CZ dabing.mkv" class="section_title video_title text-left float-left">Test Film (2014) CZ dabing.mkv</h1>
      <video controls playsinline preload="none" id="player" crossorigin="anonymous" data-plyr-config='{"duration":8177.544312,"ratio":"12:5"}'>
        <source src="https://stream2.fastshare.cloud/download_free_stream.php?id=11&amp;stream=1&amp;session=&amp;f.mkv&amp;enc=ab.mp4" type="video/mp4" width="700" />
        <track kind="captions" src="https://stream2.fastshare.cloud/sub.vtt" srclang="cs" label="Čeština" default>
      </video>`;
    const v = parseFastsharePage(html);
    assert.deepStrictEqual(v.qualities.map(q => q.src), ['https://stream2.fastshare.cloud/download_free_stream.php?id=11&stream=1&session=&f.mkv&enc=ab.mp4']);
    assert.strictEqual(v.name, 'Test Film (2014) CZ dabing.mkv');
    assert.strictEqual(v.duration, '02:16:17');
    assert.strictEqual(v.thumbnail, 'https://img.fastshare.cloud/upload/tn/1.jpg');
    assert.deepStrictEqual(v.subtitles, [{ src: 'https://stream2.fastshare.cloud/sub.vtt', lang: 'cs', label: 'Čeština', default: true }]);
});

test('parseFastsharePage resolves relative subtitle src and &quot;-quoted config', () => {
    const html = `<video playsinline id="player" data-plyr-config="{&quot;duration&quot;:8171.712,&quot;ratio&quot;:&quot;16:9&quot;}">
        <source src="https://stream2.fastshare.cloud/download_free_stream.php?id=26252992&amp;enc=a.mp4" type="video/mp4">
        <track kind="subtitles" label="cze" src="/api/get_subtitles.php?key=get&amp;id=16832" srclang="cs" default="">
      </video>`;
    const v = parseFastsharePage(html, 'https://fastshare.cloud/26252992/star-wars-skryta-hrozba-1999.mkv');
    assert.strictEqual(v.duration, '02:16:11');
    assert.strictEqual(v.subtitles[0].src, 'https://fastshare.cloud/api/get_subtitles.php?key=get&id=16832');
    assert.ok(isAllowedCdnUrl(v.subtitles[0].src));
    assert.strictEqual(v.subtitles[0].default, true);
});

test('probeKey keeps fastshare files apart (shared script path)', () => {
    const a = 'https://stream2.fastshare.cloud/download_free_stream.php?id=1&enc=x.mp4';
    const b = 'https://stream2.fastshare.cloud/download_free_stream.php?id=2&enc=x.mp4';
    assert.notStrictEqual(probeKey(a), probeKey(b));
    assert.strictEqual(probeKey(a), probeKey(a.replace('enc=x', 'enc=y')));
    assert.strictEqual(probeKey('https://a.premiumcdn.net/1/x.mp4?t=1'), probeKey('https://a.premiumcdn.net/1/x.mp4?t=2'));
});

test('parseSledujtetoPage reads player init, subtitles and metadata', () => {
    const html = `
      <meta property="og:title" content="Rychle a zbesile 8 CZ titulky 2017 632.02 MB | Sledujteto"/>
      <div id="player" data-ng-init="
          player_options.auto_subtitles = true;\tplayer_options.image_url = 'https://www.sledujteto.cz/previews/1_big.jpg?t=1';
          setTracks([{&quot;id&quot;:431,&quot;file&quot;:&quot;https:\\/\\/www.sledujteto.cz\\/file\\/subtitles\\/?file=\\/content\\/431.srt&quot;,&quot;label&quot;:&quot;thefateofthefurious0000286370&quot;}]);
          init(4615, 'https://www.sledujteto.cz/player/index/sledujteto/', 'https://www.sledujteto.cz/player/dl/', 'https://www.sledujteto.cz');
      "></div>
      <tr><td class="w-1p"></td><td class="w-25"><i class="bi bi-clock"></i> Trvání</td>
          <td>2h 4m 11s</td></tr>`;
    const v = parseSledujtetoPage(html, 'https://www.sledujteto.cz/file/69641/x.html/');
    assert.strictEqual(v.playerId, 4615);
    assert.strictEqual(v.playerUrl, 'https://www.sledujteto.cz/player/index/sledujteto/');
    assert.strictEqual(v.mirror, 'https://www.sledujteto.cz');
    assert.strictEqual(v.name, 'Rychle a zbesile 8 CZ titulky 2017');
    assert.strictEqual(v.duration, '02:04:11');
    assert.strictEqual(v.thumbnail, 'https://www.sledujteto.cz/previews/1_big.jpg?t=1');
    assert.deepStrictEqual(v.subtitles, [{ src: 'https://www.sledujteto.cz/file/subtitles/?file=/content/431.srt', lang: '', label: 'Titulky', default: true }]);
});
