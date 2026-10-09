// Unit tests for csfd.js — parsing ČSFD search / film pages (fixtures shaped like
// csfd.cz markup; no network).
const test = require('node:test');
const assert = require('node:assert');
const { parseSearch, pickResult, parseRating, lookup } = require('../csfd');

const SEARCH = `
<section class="main-movies"><div class="box-content">
<article class="article article-poster-50"><figure class="article-img"><a href="/film/9499-matrix/" class="article-img"></a></figure>
 <div class="article-content"><header class="article-header"><h3 class="film-title-nooverflow">
  <a href="/film/9499-matrix/" class="film-title-name">Matrix</a>
  <span class="film-title-info"><span class="info">(1999)</span></span></h3></header>
  <p class="film-origins-genres"><span class="info">USA, Akční / Sci-Fi</span></p></div></article>
<article class="article article-poster-50"><div class="article-content"><header class="article-header"><h3 class="film-title-nooverflow">
  <a href="/film/10789-matrix-reloaded/" class="film-title-name">Matrix Reloaded</a>
  <span class="film-title-info"><span class="info">(2003)</span></span></h3></header></div></article>
<article class="article"><h3><a href="/film/1234-matrix/" class="film-title-name">Matrix</a> <span class="info">(2021)</span> <span class="info">(seriál)</span></h3></article>
</div></section>`;

const FILM_LD = `<html><head><script type="application/ld+json">{"@context":"http://schema.org","@type":"Movie","name":"Matrix","aggregateRating":{"@type":"AggregateRating","bestRating":100,"worstRating":0,"ratingValue":90.2,"ratingCount":98765}}</script></head>
<body><div class="film-rating-average"> 90% </div></body></html>`;
const FILM_BOX = `<html><body><div class="box-rating"><div class="film-rating-average rating-average-withtabs"> 74% </div></div></body></html>`;
const FILM_NONE = `<html><body><div class="film-rating-average">?%</div></body></html>`;

test('search results: id, path, title, year — in page order', () => {
    const r = parseSearch(SEARCH);
    assert.deepStrictEqual(r.map(x => [x.id, x.title, x.year]), [['9499', 'Matrix', 1999], ['10789', 'Matrix Reloaded', 2003], ['1234', 'Matrix', 2021]]);
    assert.strictEqual(r[0].path, '/film/9499-matrix/');
});

test('the right year wins; a wrong-year namesake is not picked', () => {
    const r = parseSearch(SEARCH);
    assert.strictEqual(pickResult(r, ['Matrix'], 1999).id, '9499');
    assert.strictEqual(pickResult(r, ['Matrix'], 2021).id, '1234');
    assert.strictEqual(pickResult(r, ['Matrix'], 2000).id, '9499');       // ±1 year
    assert.strictEqual(pickResult(r, ['Matrix'], 1985), null);
    assert.strictEqual(pickResult(r, ['Matrix Reloaded', 'The Matrix Reloaded'], 2003).id, '10789');
});

test('rating: JSON-LD first, the visible box otherwise, nothing when unrated', () => {
    assert.deepStrictEqual(parseRating(FILM_LD), { rating: 90, votes: 98765 });
    assert.deepStrictEqual(parseRating(FILM_BOX), { rating: 74, votes: null });
    assert.strictEqual(parseRating(FILM_NONE), null);
    assert.strictEqual(parseRating('<html></html>'), null);
});

test('lookup: Czech title, then the original; follows a direct redirect', async () => {
    const calls = [];
    const fake = async url => {
        calls.push(url);
        if (url.includes('/hledat/?q=Ve%C4%8Dern%C3%AD')) return { ok: true, url, text: async () => '<p>Nic</p>' };
        if (url.includes('/hledat/?q=The%20Matrix')) return { ok: true, url: 'https://www.csfd.cz/film/9499-matrix/', text: async () => FILM_LD };
        if (url.includes('/hledat/?q=Matrix')) return { ok: true, url, text: async () => SEARCH };
        if (url.endsWith('/film/9499-matrix/')) return { ok: true, url, text: async () => FILM_LD };
        return { ok: false, status: 404, url, text: async () => '' };
    };
    assert.deepStrictEqual(await lookup({ title: 'Matrix', original: 'The Matrix', year: 1999 }, fake),
        { url: 'https://www.csfd.cz/film/9499-matrix/', rating: 90, votes: 98765 });
    assert.strictEqual(calls.length, 2);
    calls.length = 0;
    const r = await lookup({ title: 'Večerní', original: 'The Matrix', year: 1999 }, fake);
    assert.strictEqual(r.rating, 90);
    assert.strictEqual(calls.length, 2);
});
