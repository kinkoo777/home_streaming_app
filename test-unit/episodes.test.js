// Unit tests for src/js/episodes.js — which episode plays next.
const test = require('node:test');
const assert = require('node:assert');
const { nextEpisode, noNextMessage } = require('../src/js/episodes');

const TODAY = '2026-10-04';
const show = extra => Object.assign({
    status: 'Ended',
    seasons: [
        { season_number: 0, episode_count: 3 },
        { season_number: 1, episode_count: 10, air_date: '2020-01-01' },
        { season_number: 2, episode_count: 8, air_date: '2021-01-01' }
    ],
    last_episode_to_air: { season_number: 2, episode_number: 8 },
    next_episode_to_air: null
}, extra);
const next = r => r.next && r.next.code;

test('next episode within the season', () => {
    assert.strictEqual(next(nextEpisode(show(), 1, 4, TODAY)), 'S01E05');
});

test('after the last episode of a season → first episode of the next season', () => {
    assert.strictEqual(next(nextEpisode(show(), 1, 10, TODAY)), 'S02E01');
    // Seasons out of order or with a gap
    const gap = show({ seasons: [{ season_number: 3, episode_count: 6 }, { season_number: 1, episode_count: 10 }], last_episode_to_air: { season_number: 3, episode_number: 6 } });
    assert.strictEqual(next(nextEpisode(gap, 1, 10, TODAY)), 'S03E01');
    // Numbers as strings (from a stored session)
    assert.strictEqual(next(nextEpisode(show(), '1', '10', TODAY)), 'S02E01');
});

test('last episode of an ended show → nothing next', () => {
    const r = nextEpisode(show(), 2, 8, TODAY);
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.ended, true);
    assert.strictEqual(noNextMessage(r), 'To byl poslední díl seriálu');
});

test('episodes TMDB announced but not aired yet are not offered', () => {
    const running = show({
        status: 'Returning Series',
        seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }],
        last_episode_to_air: { season_number: 2, episode_number: 3 },
        next_episode_to_air: { season_number: 2, episode_number: 4, air_date: '2026-10-12' }
    });
    assert.strictEqual(next(nextEpisode(running, 2, 2, TODAY)), 'S02E03');
    const r = nextEpisode(running, 2, 3, TODAY);
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.airDate, '2026-10-12');
    assert.strictEqual(noNextMessage(r), 'Další díl vyjde 12. 10. 2026');
    // Cached details are a few hours old and the episode has aired since
    assert.strictEqual(next(nextEpisode(running, 2, 3, '2026-10-12')), 'S02E04');
});

test('new season announced but not started → its premiere date', () => {
    const r = nextEpisode(show({
        status: 'Returning Series',
        seasons: [{ season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8, air_date: '2027-03-01' }],
        last_episode_to_air: { season_number: 1, episode_number: 10 },
        next_episode_to_air: null
    }), 1, 10, TODAY);
    assert.strictEqual(r.next, null);
    assert.strictEqual(r.airDate, '2027-03-01');
});

test('running show, latest episode, no date known', () => {
    const r = nextEpisode(show({ status: 'Returning Series' }), 2, 8, TODAY);
    assert.strictEqual(r.next, null);
    assert.strictEqual(noNextMessage(r), 'Další díl zatím nevyšel');
});

test('no season data or specials → the following number, as before', () => {
    assert.strictEqual(next(nextEpisode(null, 1, 4, TODAY)), 'S01E05');
    assert.strictEqual(next(nextEpisode({}, 3, 9, TODAY)), 'S03E10');
    assert.strictEqual(next(nextEpisode(show(), 0, 1, TODAY)), 'S00E02');
});
