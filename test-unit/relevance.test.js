// Unit tests for src/js/relevance.js — the "only real films / episodes" filter.
const test = require('node:test');
const assert = require('node:assert');
const { filterSources, titleWords, durationSeconds, hasEpisodeCode } = require('../src/js/relevance');

const r = (title, duration) => ({ title, duration, url: title });
const titles = list => list.map(x => x.title);

test('titleWords normalises diacritics, case and stop words', () => {
    assert.deepStrictEqual(titleWords('Příběh hraček: The Movie'), ['pribeh', 'hracek', 'movie']);
    assert.deepStrictEqual(titleWords('Kancl S02E03'), ['kancl']);
});

test('durationSeconds parses h:m:s and m:s', () => {
    assert.strictEqual(durationSeconds('02:49:04'), 10144);
    assert.strictEqual(durationSeconds('49:59'), 2999);
    assert.strictEqual(durationSeconds(''), null);
    assert.strictEqual(durationSeconds('abc'), null);
});

test('film search drops gameplay, clips, series episodes and short videos', () => {
    const all = [
        r('Manic Digger - Gameplay + Download', '00:19:59'),
        r('GRAVE DIGGER ft. Noora Louhimo - Thousand Tears (Official Video)', '00:04:58'),
        r('Gold Digger - S1E6 EN', '00:45:00'),
        r('Digger (2026) CZ 1080p', '01:52:10'),
        r('Digger trailer CZ', '00:02:10')
    ];
    assert.deepStrictEqual(titles(filterSources(all, { names: ['Digger'], mediaType: 'movie' })), ['Digger (2026) CZ 1080p']);
});

test('film search keeps every genuine upload', () => {
    const all = [r('Interstellar 2014 CZ Dabing 2160p', '02:49:04'), r('Interstellar (2014) CZ EN DABING', '02:49:04'), r('#Interstellar_2014_CZ_titulky', '')];
    assert.strictEqual(filterSources(all, { names: ['Interstellar'], mediaType: 'movie' }).length, 3);
});

test('original title matches when the Czech title is not in the upload name', () => {
    const all = [r('Toy Story 5 (2026) CZ dabing', '01:40:00'), r('Pribeh hracek 5 CZ', '01:40:00')];
    const got = filterSources(all, { names: ['Toy Story 5: Příběh hraček', 'Příběh hraček 5', 'Toy Story 5'], mediaType: 'movie' });
    assert.strictEqual(got.length, 2);
});

test('episode search keeps only the requested episode (all code styles)', () => {
    const all = [
        r('Kancl S02E03 Olympijské hry', '00:21:00'),
        r('Kancl 2x3 Olympijské hry 1080p.mkv', '00:21:00'),
        r('Kancl S02E13 Gay Witch Hunt', '00:21:00'),
        r('Kancl S12E03', '00:21:00'),
        r('Kancl S02E04', '00:21:00')
    ];
    const got = titles(filterSources(all, { names: ['Kancl'], mediaType: 'tv', episode: { season: 2, number: 3 } }));
    assert.deepStrictEqual(got, ['Kancl S02E03 Olympijské hry', 'Kancl 2x3 Olympijské hry 1080p.mkv']);
});

test('hasEpisodeCode matches S02E03 / S2E3 / S02 E03 / 2x03 but not other episodes', () => {
    const ep = { season: 2, number: 3 };
    for (const t of ['S02E03', 's2e3', 'S02 E03', '2x03', 'Show.2x3.mkv']) assert.ok(hasEpisodeCode(t, ep), t);
    for (const t of ['S02E13', 'S12E03', 'S02E30', '12x03']) assert.ok(!hasEpisodeCode(t, ep), t);
});

test('no names → nothing filtered', () => {
    const all = [r('anything', '00:01:00')];
    assert.strictEqual(filterSources(all, { names: [] }).length, 1);
});
