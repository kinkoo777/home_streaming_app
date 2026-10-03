// Unit tests for security.js — API input validation and PIN rate limiting.
const test = require('node:test');
const assert = require('node:assert');
const sec = require('../security');

test('toId accepts positive integers only', () => {
    assert.strictEqual(sec.toId('157336'), 157336);
    assert.strictEqual(sec.toId(42), 42);
    for (const bad of ['0', '-1', '1.5', '12abc', '../account', '', null, undefined, 1e12]) assert.strictEqual(sec.toId(bad), null, String(bad));
});

test('tmdbType and season', () => {
    assert.strictEqual(sec.tmdbType('movie'), 'movie');
    assert.strictEqual(sec.tmdbType('tv'), 'tv');
    assert.strictEqual(sec.tmdbType('../account'), null);
    assert.strictEqual(sec.season('0'), 0);                 // specials
    assert.strictEqual(sec.season('3'), 3);
    assert.strictEqual(sec.season('x'), null);
});

test('posterPath only allows TMDB-style paths', () => {
    assert.strictEqual(sec.posterPath('/abc123.jpg'), '/abc123.jpg');
    for (const bad of ['javascript:alert(1)', 'https://evil/x.jpg', '/../x', '/a b.jpg', '']) assert.strictEqual(sec.posterPath(bad), null, bad);
});

test('watchlists: sanitises entries and rejects bad structure', () => {
    const lists = sec.watchlists([{ id: 'default', name: ' Můj seznam ', movies: [
        { id: 1, title: 'A', poster_path: '/a.jpg', evil: '<script>', vote_average: 7.5 },
        { id: 1, title: 'A again' },                          // duplicate id dropped
        { id: 'x', title: 'bad id' },                        // invalid dropped
        { id: 2 }                                            // no title dropped
    ] }]);
    assert.strictEqual(lists[0].name, 'Můj seznam');
    assert.deepStrictEqual(lists[0].movies, [{ id: 1, media_type: 'movie', poster_path: '/a.jpg', title: 'A', vote_average: 7.5 }]);
    assert.strictEqual(sec.watchlists({ not: 'an array' }), null);
    assert.strictEqual(sec.watchlists([{ id: '<x>', name: 'a', movies: [] }]), null);
    assert.strictEqual(sec.watchlists([{ id: 'a', name: '', movies: [] }]), null);
    assert.strictEqual(sec.watchlists([{ id: 'a', name: 'x', movies: [] }, { id: 'a', name: 'y', movies: [] }]), null, 'duplicate list ids');
});

test('progress: validates key and numbers', () => {
    assert.ok(sec.progress('157336', { seconds: 60, duration: 600 }));
    assert.ok(sec.progress('2316:S02E03', { seconds: 60 }));
    assert.strictEqual(sec.progress('../x', { seconds: 1 }), null);
    assert.strictEqual(sec.progress('1', { seconds: 'abc' }), null);
    assert.strictEqual(sec.progress('1', { seconds: -5 }), null);
    assert.strictEqual(sec.progress('1', { seconds: 5, episodeLabel: '<b>' }).episodeLabel, null);
    assert.strictEqual(sec.progress('2316:S01E04', { seconds: 60, finished: true }).finished, true);
    assert.strictEqual(sec.progress('2316:S01E04', { seconds: 60, finished: 'yes' }).finished, false, 'only a real boolean counts');
});

test('profileChanges: name, theme, picture and settings rules', () => {
    assert.ok(sec.profileChanges({ name: 'Anna' }, true).changes);
    assert.ok(sec.profileChanges({}, true).error, 'name required on create');
    assert.ok(sec.profileChanges({ name: 'x'.repeat(31) }, true).error);
    assert.ok(sec.profileChanges({ theme: 'neon' }, false).error);
    assert.ok(sec.profileChanges({ picture: 'http://evil/x.png' }, false).error);
    assert.ok(sec.profileChanges({ picture: 'data:image/jpeg;base64,AAAA' }, false).changes);
    assert.deepStrictEqual(sec.profileChanges({ settings: { reduceMotion: true, isAdmin: true } }, false).changes.settings, { reduceMotion: true });
    assert.deepStrictEqual(sec.profileChanges({ settings: { seenWhatsNew: '2026-09' } }, false).changes.settings, { seenWhatsNew: '2026-09' });
    assert.deepStrictEqual(sec.profileChanges({ settings: { seenWhatsNew: '<script>' } }, false).changes.settings, {});
});

test('profileChanges: playback preferences take only known values', () => {
    assert.deepStrictEqual(
        sec.profileChanges({ settings: { audioPref: 'original', qualityPref: '720', subLang: 'cze', stillWatching: false } }, false).changes.settings,
        { audioPref: 'original', qualityPref: '720', subLang: 'cze', stillWatching: false });
    assert.ok(sec.profileChanges({ settings: { audioPref: 'loud' } }, false).error);
    assert.ok(sec.profileChanges({ settings: { qualityPref: 1080 } }, false).error);
    assert.ok(sec.profileChanges({ settings: { subLang: 'de' } }, false).error);
    assert.deepStrictEqual(sec.profileChanges({ settings: { stillWatching: 'yes' } }, false).changes.settings, {});
});

test('wrong-PIN limit: 5 failures then blocked, success clears', () => {
    const req = { ip: '10.0.0.' + Math.floor(Math.random() * 250), socket: {} };
    const id = 'profile-' + Date.now();
    for (let i = 0; i < 5; i++) { assert.strictEqual(sec.retryAfter(req, id), 0); sec.recordFailure(req, id); }
    assert.ok(sec.retryAfter(req, id) > 0, 'blocked after 5');
    sec.clearFailures(req, id);
    assert.strictEqual(sec.retryAfter(req, id), 0);
});

test('PIN sessions: token valid only for its profile, revocable', () => {
    const token = sec.issueToken('p-a');
    const req = t => ({ get: h => (h === 'x-profile-token' ? t : undefined), query: {} });
    assert.ok(sec.hasSession(req(token), 'p-a'));
    assert.ok(!sec.hasSession(req(token), 'p-b'));
    assert.ok(!sec.hasSession(req('forged'), 'p-a'));
    sec.revokeProfile('p-a');
    assert.ok(!sec.hasSession(req(token), 'p-a'));
});
