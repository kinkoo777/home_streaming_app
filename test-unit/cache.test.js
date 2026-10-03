// Unit tests for cache.js — per-entry lifetimes, size cap, persistence.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCache, tmdbTtl, DEFAULT_TTL, MAX_ENTRIES } = require('../cache');

const MIN = 60 * 1000;
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'filmbox-cache-')), 'cache.json');

test('tmdbTtl: lists and searches are short-lived, details long-lived', () => {
    for (const p of ['/movie/popular?language=cs-CZ&page=2', '/movie/top_rated?language=cs-CZ&page=1',
        '/trending/all/week?language=cs-CZ', '/search/multi?language=cs-CZ&query=dune', '/discover/tv?with_genres=18']) {
        assert.strictEqual(tmdbTtl(p), 30 * MIN, p);
    }
    for (const p of ['/movie/157336?language=cs-CZ', '/tv/1399/credits?language=cs-CZ', '/tv/1399/season/2?language=cs-CZ',
        '/person/287?language=en-US', '/collection/10?language=cs-CZ', '/genre/movie/list?language=cs-CZ', '/movie/550/recommendations']) {
        assert.strictEqual(tmdbTtl(p), 6 * 60 * MIN, p);
    }
});

test('entries expire after their own ttl', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const c = createCache(tmpFile());
    c.set('short', 1);                       // default ttl
    c.set('long', 2, 60 * MIN);
    t.mock.timers.tick(DEFAULT_TTL + 1);
    assert.strictEqual(c.get('short'), null);
    assert.strictEqual(c.get('long'), 2);
    t.mock.timers.tick(60 * MIN);
    assert.strictEqual(c.get('long'), null);
});

test('size is capped, oldest entries go first', () => {
    const c = createCache(tmpFile());
    for (let i = 0; i < MAX_ENTRIES + 5; i++) c.set('k' + i, i, 60 * MIN);
    assert.strictEqual(c.size, MAX_ENTRIES);
    assert.strictEqual(c.get('k0'), null);
    assert.strictEqual(c.get('k' + (MAX_ENTRIES + 4)), MAX_ENTRIES + 4);
});

test('fresh entries survive a restart, expired ones do not', () => {
    const file = tmpFile();
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({
        fresh:  { data: 'a', ts: now - 10 * MIN, ttl: 60 * MIN },
        stale:  { data: 'b', ts: now - 10 * MIN, ttl: 5 * MIN },
        legacy: { data: 'c', ts: now - 1 * MIN }           // written before per-entry ttl
    }));
    const c = createCache(file);
    assert.strictEqual(c.get('fresh'), 'a');
    assert.strictEqual(c.get('stale'), null);
    assert.strictEqual(c.get('legacy'), 'c');
});
