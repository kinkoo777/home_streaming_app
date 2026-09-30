// ================= SOURCE RELEVANCE =================
// Keeps real films / episodes from a prehraj.to result list and drops
// gameplay, clips, trailers, wrong episodes, etc. Pure functions — loaded by
// the page (window.FilmBoxRelevance) and by the Node unit tests (require).

;(function (root) {
  'use strict'

  const JUNK = /\b(trailer|teaser|gameplay|walkthrough|let'?s ?play|soundtrack|lyrics|official (music )?video|music video|videoklip|klip|making of|behind the scenes|review|recenze|reaction|reakce|fan ?made|parod(y|ie)|shorts|tutorial|unboxing|podcast|karaoke|cover)\b/i
  const STOP = { the: 1, a: 1, an: 1, of: 1, and: 1, in: 1, on: 1, to: 1, i: 1, v: 1, na: 1, se: 1, z: 1, s: 1, o: 1, u: 1, k: 1, do: 1, le: 1, la: 1, de: 1, der: 1, die: 1, das: 1 }
  const EPISODE_CODE = /\bs\d{1,2}\s*e\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i
  const MIN_FILM = 40 * 60
  const MIN_EPISODE = 8 * 60

  // "Příběh hraček S01E02" → ["pribeh", "hracek"]
  function titleWords(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/s\d{1,2}\s*e\d{1,3}/g, ' ').split(/[^a-z0-9]+/).filter(w => w && !STOP[w])
  }

  // "02:49:04" → 10144, "49:59" → 2999, bad → null
  function durationSeconds(d) {
    if (d == null || d === '') return null
    const parts = String(d).split(':').map(n => parseInt(n, 10))
    if (!parts.length || parts.some(isNaN)) return null
    return parts.reduce((acc, n) => acc * 60 + n, 0)
  }

  // S02E03 / S2E3 / S02 E03 / 2x03 for the requested episode
  function hasEpisodeCode(title, ep) {
    const s = ep.season, e = ep.number
    const re = new RegExp('(s0?' + s + '\\s*[ex.\\-]?\\s*e?0?' + e + '(?!\\d))|(\\b0?' + s + 'x0?' + e + '(?!\\d))', 'i')
    return re.test(title)
  }

  // opts: { names: [strings the title should contain], mediaType: 'movie'|'tv', episode: {season, number}|null }
  function isRelevant(r, nameWords, opts) {
    const isEpisode = !!opts.episode
    const tv = isEpisode || opts.mediaType === 'tv'
    if (JUNK.test(r.title)) return false
    // Searching a film: series episodes ("Gold Digger S1E6") aren't it.
    if (!tv && EPISODE_CODE.test(r.title)) return false
    const secs = durationSeconds(r.duration)
    if (secs != null && secs < (tv ? MIN_EPISODE : MIN_FILM)) return false
    const words = titleWords(r.title)
    const has = w => words.indexOf(w) >= 0
    // Every significant word of at least one name (≥75% for long titles).
    return nameWords.some(n => {
      const hit = n.filter(has).length
      return n.length >= 4 ? hit / n.length >= 0.75 : hit === n.length
    })
  }

  function filterSources(all, opts) {
    opts = opts || {}
    const nameWords = (opts.names || []).map(titleWords).filter(w => w.length)
    if (!nameWords.length) return all.slice()
    let list = all.filter(r => r && r.title && isRelevant(r, nameWords, opts))
    if (opts.episode) {
      const exact = list.filter(r => hasEpisodeCode(r.title, opts.episode))
      if (exact.length) list = exact
    }
    return list
  }

  const api = { titleWords, durationSeconds, hasEpisodeCode, filterSources }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.FilmBoxRelevance = api
})(typeof window !== 'undefined' ? window : this)
