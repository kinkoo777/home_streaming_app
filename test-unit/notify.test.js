// notify.js — which new episodes are announced, to whom, and only once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNotifier } = require('../notify');

const NOW = Date.parse('2026-10-09T12:00:00Z');
function setup(extra) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-notify-'));
    const posts = [];
    const shows = {
        1399: { name: 'Hra o trůny', last_episode_to_air: { season_number: 2, episode_number: 5, air_date: '2026-10-08', name: 'Duch Harrenhalu' } },
        66732: { name: 'Stranger Things', last_episode_to_air: { season_number: 4, episode_number: 9, air_date: '2022-07-01' } },
        100: { name: 'Viděný', last_episode_to_air: { season_number: 1, episode_number: 3, air_date: '2026-10-09' } }
    };
    const profiles = [
        { id: 'a', name: 'Vláďa', settings: { ntfyTopic: 'filmbox-vlada-123' } },
        { id: 'b', name: 'Bez upozornění', settings: {} }
    ];
    const deps = Object.assign({
        dataDir,
        profiles: { list: () => profiles },
        progress: { getAll: id => id === 'a' ? { '1399:S02E04': { seconds: 3000, duration: 3200, finished: true, title: 'Hra o trůny S02E04' }, '100:S01E03': { finished: true } } : {} },
        watched: { list: id => id === 'a' ? [{ tmdbId: 66732, mediaType: 'tv', title: 'Stranger Things' }, { tmdbId: 100, mediaType: 'tv', title: 'Viděný' }] : [{ tmdbId: 1399, mediaType: 'tv', title: 'Hra o trůny' }] },
        favorites: { list: () => [] },
        tmdbFetch: async p => { const id = /\/tv\/(\d+)/.exec(p)[1]; if (!shows[id]) throw new Error('404'); return shows[id]; },
        post: async body => { posts.push(body); },
        now: () => NOW
    }, extra || {});
    return { n: createNotifier(deps), posts, dataDir };
}

test('announces a fresh episode of a followed series, once', async () => {
    const { n, posts } = setup();
    const sent = await n.runOnce();
    assert.deepStrictEqual(sent, [{ profileId: 'a', show: 'Hra o trůny', code: 'S02E05' }]);
    assert.strictEqual(posts[0].topic, 'filmbox-vlada-123');
    assert.strictEqual(posts[0].title, 'Nový díl: Hra o trůny S02E05');
    assert.match(posts[0].message, /Duch Harrenhalu/);
    assert.deepStrictEqual(await n.runOnce(), [], 'not twice');
});

test('old episodes, already seen ones and profiles without a topic stay quiet', async () => {
    const { n, posts } = setup();
    await n.runOnce();
    // Stranger Things aired 2022, "Viděný" S01E03 is finished, profile b has no topic
    assert.deepStrictEqual(posts.map(p => p.title), ['Nový díl: Hra o trůny S02E05']);
});

test('a failed send is tried again next time', async () => {
    let fail = true;
    const posts = [];
    const { n } = setup({ post: async b => { if (fail) throw new Error('offline'); posts.push(b); } });
    const orig = console.error; console.error = () => {};
    try { assert.deepStrictEqual(await n.runOnce(), []); } finally { console.error = orig; }
    fail = false;
    assert.strictEqual((await n.runOnce()).length, 1);
});
