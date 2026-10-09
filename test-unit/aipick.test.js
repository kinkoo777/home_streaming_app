// aipick.js against a fake Anthropic API (ANTHROPIC_BASE_URL): the request it sends,
// how answers become TMDB cards, kids filtering, refusals, the hourly limit.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, requests = [], reply;
test.before(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(Object.assign({
                id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
                stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }
            }, reply)));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + server.address().port;
    process.env.ANTHROPIC_API_KEY = 'test-key';
});
test.after(() => { server.close(); delete process.env.ANTHROPIC_BASE_URL; delete process.env.ANTHROPIC_API_KEY; });

const { createPicker } = require('../aipick');
const TMDB = {
    'Na vlnách': { id: 1, title: 'Na vlnách', poster_path: '/1.jpg', genre_ids: [35] },
    'Shrek': { id: 808, title: 'Shrek', poster_path: '/s.jpg', genre_ids: [16, 10751, 35] },
    'Ted Lasso': { id: 97546, name: 'Ted Lasso', poster_path: '/t.jpg', genre_ids: [35, 18] }
};
const deps = {
    tmdbFetch: async p => { const q = decodeURIComponent(/query=([^&]+)/.exec(p)[1]); return { results: TMDB[q] ? [TMDB[q]] : [] }; },
    kidsOk: m => (m.genre_ids || []).includes(16)
};
const answer = picks => ({ content: [{ type: 'text', text: JSON.stringify({ picks }) }] });

test('asks Claude the right way and turns the answer into cards', async () => {
    requests = [];
    reply = answer([
        { title: 'Na vlnách', original_title: 'The Boat That Rocked', year: 2009, type: 'movie', why: 'Lehká komedie s výbornou hudbou.' },
        { title: 'Neexistující film', original_title: 'Nope Nope', year: 2001, type: 'movie', why: 'x' },
        { title: 'Ted Lasso', original_title: 'Ted Lasso', year: 2020, type: 'tv', why: 'Hřejivý humor.' }
    ]);
    const p = createPicker(deps);
    assert.strictEqual(p.enabled(), true);
    const picks = await p.pick('prof', 'něco vtipného na večer', { liked: ['Shrek'], disliked: ['Matrix'], watched: ['Shrek'], lists: [], kids: false });
    assert.deepStrictEqual(picks.map(x => [x.id, x.media_type, x.why]), [[1, 'movie', 'Lehká komedie s výbornou hudbou.'], [97546, 'tv', 'Hřejivý humor.']]);
    const r = requests[0];
    assert.match(r.url, /\/v1\/messages/);
    assert.strictEqual(r.body.model, 'claude-opus-5-5');
    assert.strictEqual(r.body.fallbacks, 'default');
    assert.match(r.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.strictEqual(r.body.output_config.effort, 'low');
    assert.strictEqual(r.body.output_config.format.type, 'json_schema');
    assert.ok(!('thinking' in r.body), 'thinking left to the model default');
    assert.match(r.body.messages[0].content, /Nelíbilo se mu: Matrix/);
    assert.match(r.body.messages[0].content, /Přání: něco vtipného na večer/);
});

test('kids profile: told so, and only children\'s titles come back', async () => {
    requests = [];
    reply = answer([
        { title: 'Shrek', original_title: 'Shrek', year: 2001, type: 'movie', why: 'Pohádka pro celou rodinu.' },
        { title: 'Na vlnách', original_title: 'The Boat That Rocked', year: 2009, type: 'movie', why: 'x' }
    ]);
    const picks = await createPicker(deps).pick('kid', 'pohádka', { kids: true });
    assert.deepStrictEqual(picks.map(x => x.id), [808]);
    assert.match(requests[0].body.messages[0].content, /dětský profil/);
});

test('refusal, missing key and the hourly limit', async () => {
    reply = { stop_reason: 'refusal', content: [] };
    const p = createPicker(deps);
    await assert.rejects(p.pick('a', 'cokoli', {}), e => e.code === 422);
    reply = answer([]);
    for (let i = 1; i < 20; i++) await p.pick('a', 'cokoli', {});
    await assert.rejects(p.pick('a', 'cokoli', {}), e => e.code === 429);
    await p.pick('b', 'cokoli', {});                 // another profile has its own limit
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try { await assert.rejects(createPicker(deps).pick('c', 'cokoli', {}), e => e.code === 501); }
    finally { process.env.ANTHROPIC_API_KEY = key; }
});
