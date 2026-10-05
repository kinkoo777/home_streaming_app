// Notice-and-action (lib/notices.js + POST /api/notices): what a notice must
// contain, how it's stored, and the blocklist that keeps removed URLs out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNotices, validateNotice, normalizeUrl } = require('../lib/notices');
const sources = require('../lib/sources');
const { startServer } = require('./server-harness');

const valid = (over = {}) => Object.assign({
    name: 'Studio Example a.s.', email: 'legal@studio.example',
    work: 'Example Film (2024), all rights held by Studio Example a.s.',
    material: 'A full copy of the film offered for playback.',
    location: 'https://prehrajto.cz/example-film-2024/abc123\nhttps://www.sledujteto.cz/file/999/example/#t=5',
    explanation: 'The upload is a complete copy of the film made available without any licence from us.',
    goodFaith: true
}, over);

test('normalizeUrl: one form per page', () => {
    assert.strictEqual(normalizeUrl('https://WWW.Prehrajto.cz/a/b/#x'), 'https://prehrajto.cz/a/b');
    assert.strictEqual(normalizeUrl('http://prehrajto.cz/a/b'), 'https://prehrajto.cz/a/b');
    assert.strictEqual(normalizeUrl('ftp://x'), null);
    assert.strictEqual(normalizeUrl('nope'), null);
});

test('validateNotice requires the eight items of the policy', () => {
    const { notice, errors } = validateNotice(valid());
    assert.strictEqual(errors, undefined);
    assert.deepStrictEqual(notice.urls, ['https://prehrajto.cz/example-film-2024/abc123', 'https://sledujteto.cz/file/999/example']);

    const bad = validateNotice({}).errors;
    assert.deepStrictEqual(Object.keys(bad).sort(), ['email', 'explanation', 'goodFaith', 'location', 'material', 'name', 'work']);
    assert.ok(validateNotice(valid({ email: 'not-an-email' })).errors.email);
    assert.ok(validateNotice(valid({ explanation: 'pirated' })).errors.explanation, 'a reasonably detailed explanation');
    assert.ok(validateNotice(valid({ goodFaith: false })).errors.goodFaith);
    // On behalf of someone else: who, and confirmation of authority.
    const behalf = validateNotice(valid({ onBehalf: true })).errors;
    assert.ok(behalf.principal && behalf.authority);
    assert.strictEqual(validateNotice(valid({ onBehalf: true, principal: 'Studio', authority: true })).errors, undefined);
    // Control characters are stripped, lengths capped.
    assert.strictEqual(validateNotice(valid({ name: 'A\u0000B' + 'x'.repeat(500) })).notice.name.length, 120);
});

test('notices are stored with a reference and a status history; the blocklist survives restarts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kouknem-notices-'));
    const store = createNotices(dir);
    const saved = store.add(validateNotice(valid()).notice);
    assert.match(saved.id, /^KN-\d{8}-[0-9A-F]{8}$/);
    assert.strictEqual(store.list()[0].status, 'received');
    store.setStatus(saved.id, 'actioned', 'blocked 2 URLs');
    assert.deepStrictEqual([store.list()[0].status, store.list()[0].note], ['actioned', 'blocked 2 URLs']);
    assert.throws(() => store.setStatus('KN-nope', 'actioned'));

    let changes = 0;
    store.onBlockedChange(() => changes++);
    store.block('https://www.prehrajto.cz/example-film-2024/abc123/', { noticeId: saved.id });
    assert.strictEqual(changes, 1);
    assert.ok(store.isBlocked('https://prehrajto.cz/example-film-2024/abc123'));
    assert.ok(store.isBlocked('http://prehrajto.cz/example-film-2024/abc123#t=1'));
    assert.ok(!store.isBlocked('https://prehrajto.cz/example-film-2024/other'));

    // Another process (tools/admin.js) sees and changes the same list.
    const other = createNotices(dir);
    assert.ok(other.isBlocked('https://prehrajto.cz/example-film-2024/abc123'));
    other.unblock('https://prehrajto.cz/example-film-2024/abc123');
    const later = Date.now() + 10;
    while (Date.now() < later) { /* make sure the file's mtime moves */ }
    fs.utimesSync(path.join(dir, 'blocked.json'), new Date(), new Date());
    store.reload();
    assert.ok(!store.isBlocked('https://prehrajto.cz/example-film-2024/abc123'));
    assert.strictEqual(changes, 2);
});

test('a blocked page is refused for rooms', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kouknem-notices-'));
    const store = createNotices(dir);
    sources.configure({ isBlocked: store.isBlocked });
    const player = { title: 'X', source: { pageUrl: 'https://prehrajto.cz/x/1', qualities: [{ src: 'https://cdn1.premiumcdn.net/v/a.mp4' }] } };
    assert.strictEqual(sources.checkPlayer(player), null);
    store.block('https://prehrajto.cz/x/1');
    assert.match(sources.checkPlayer(player), /odstraněno/);
    assert.match(sources.checkPlayer({ source: { qualities: [{ src: 'http://192.168.0.1/a.mp4' }] } }), /Nepovolený/);
    sources.configure({ isBlocked: () => false });
});

test('POST /api/notices', async () => {
    const srv = await startServer();
    try {
        const post = (body, headers = {}) => fetch(srv.base + '/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
        const bad = await post({ name: 'x' });
        assert.strictEqual(bad.status, 400);
        assert.ok((await bad.json()).fields.email);
        assert.strictEqual((await post(valid(), { Origin: 'http://evil.example' })).status, 403);
        const ok = await post(valid());
        assert.strictEqual(ok.status, 201);
        const { id } = await ok.json();
        const stored = fs.readFileSync(path.join(srv.dataDir, 'notices.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
        assert.deepStrictEqual([stored.length, stored[0].id, stored[0].email, stored[0].urls.length], [1, id, 'legal@studio.example', 2]);
        assert.strictEqual(stored[0].ip, undefined, 'no IP addresses are kept');
    } finally { srv.stop(); }
});
