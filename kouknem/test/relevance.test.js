// Unit tests for src/js/relevance.js — the "only real films / episodes" filter.
const test = require('node:test');
const assert = require('node:assert');
const { filterSources, titleWords, durationSeconds, hasEpisodeCode, parseReleaseName, pickTmdbMatch } = require('../lib/relevance');

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

test('parseReleaseName pulls the title, year and episode out of upload names', () => {
    const p = t => { const r = parseReleaseName(t); return [r.name, r.year, r.season, r.episode]; };
    assert.deepStrictEqual(p('Matrix Revolutions [2003] akční, sci-fi AAC 5.1 1080p CZ dabing'), ['Matrix Revolutions', 2003, null, null]);
    assert.deepStrictEqual(p('Rychle a zbesile 8 CZ titulky v obraze 2017 The Fate of the Furious'), ['Rychle a zbesile 8', 2017, null, null]);
    assert.deepStrictEqual(p('Interstellar.2014.1080p.BluRay.x264'), ['Interstellar', 2014, null, null]);
    assert.deepStrictEqual(p('Pán prstenů - Společenstvo Prstenu mkv'), ['Pán prstenů Společenstvo Prstenu', null, null, null]);
    assert.deepStrictEqual(p('Stranger Things S01E03 CZ dabing'), ['Stranger Things', null, 1, 3]);
    assert.deepStrictEqual(p('Hra o trůny 2x05 CZ'), ['Hra o trůny', null, 2, 5]);
    assert.deepStrictEqual(p('2012 (2009) CZ dabing'), ['2012', 2009, null, null]);   // leading number is the title
});

test('pickTmdbMatch links only convincing matches', () => {
    const results = [
        { id: 603, media_type: 'movie', title: 'Matrix', original_title: 'The Matrix', release_date: '1999-03-30' },
        { id: 605, media_type: 'movie', title: 'Matrix Revolutions', release_date: '2003-11-05' },
        { id: 1893, media_type: 'movie', title: 'Star Wars: Epizoda I – Skrytá hrozba', release_date: '1999-05-19' },
        { id: 66732, media_type: 'tv', name: 'Stranger Things', first_air_date: '2016-07-15' },
        { id: 7, media_type: 'person', name: 'Matrix' }
    ];
    const id = t => (pickTmdbMatch(parseReleaseName(t), results) || {}).id || null;
    assert.strictEqual(id('Matrix 1 (1999) CZ dabing mkv'), 603);
    assert.strictEqual(id('Matrix Revolutions [2003] 1080p'), 605);
    assert.strictEqual(id('Star Wars Skryta hrozba 1999 mkv'), 1893);        // Czech title with extra words
    assert.strictEqual(id('Stranger Things S01E03'), 66732);                   // episode → TV show only
    assert.strictEqual(id('Matrix (2010) fan film'), null);                   // wrong year → no link
    assert.strictEqual(id('Minecraft gameplay part 3'), null);
});

test('sourceScore / rankSources follow the profile playback preferences', () => {
    const { sourceScore, rankSources } = require('../lib/relevance');
    const dub720 = { url: 'a', dub: true, res: 720 };
    const orig1080subs = { url: 'b', dub: false, res: 1080, subs: true };
    const dub4k = { url: 'c', dub: true, res: 2160 };
    const dub1080 = { url: 'd', dub: true, res: 1080 };
    const urls = list => list.map(x => x.url);

    // Defaults (no settings) = the old behaviour: dubbed first, 1080p before 4K.
    assert.deepStrictEqual(urls(rankSources([dub720, orig1080subs, dub4k, dub1080])), ['d', 'c', 'a', 'b']);
    assert.deepStrictEqual(urls(rankSources([dub720, orig1080subs, dub4k, dub1080], { audioPref: 'original' })), ['b', 'd', 'c', 'a']);
    assert.deepStrictEqual(urls(rankSources([dub720, orig1080subs, dub4k, dub1080], { qualityPref: '2160' })), ['c', 'd', 'a', 'b']);
    assert.deepStrictEqual(urls(rankSources([dub720, orig1080subs, dub4k, dub1080], { qualityPref: '720' })), ['a', 'd', 'c', 'b']);
    // "Nezáleží": resolution decides, subtitles break ties.
    assert.deepStrictEqual(urls(rankSources([dub720, orig1080subs, dub1080], { audioPref: 'any' })), ['b', 'd', 'a']);
    // Equal scores keep the site's order.
    assert.deepStrictEqual(urls(rankSources([{ url: 'x', res: 1080 }, { url: 'y', res: 1080 }])), ['x', 'y']);
    assert.ok(sourceScore({ res: 480 }, { qualityPref: '720' }) > sourceScore({ res: 480 }));
});
