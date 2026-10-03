// ================= SOURCE RELEVANCE =================
// Keeps real films / episodes from a prehraj.to / fastshare / sledujteto result list and drops
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

  // ── Upload name → { name, year, season, episode } ──
  // "Matrix Revolutions [2003] akční, sci-fi AAC 5.1 1080p CZ dabing" → { name: "Matrix Revolutions", year: 2003 }
  // "Stranger Things S01E03 CZ" → { name: "Stranger Things", season: 1, episode: 3 }
  const RELEASE_JUNK = /^(cz|sk|en|eng|cze|czech|dabing|dab|czdab|czdabing|titulky|tit|subs?|1080p|720p|480p|2160p|4k|uhd|hd|fhd|fullhd|hdr|sdr|mkv|avi|mp4|m4v|bluray|bdrip|brrip|webrip|web|webdl|dvdrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|remastered|extended|uncut|rip|ewp)$/i

  function parseReleaseName(raw) {
    let t = String(raw || '').replace(/\.(mkv|avi|mp4|m4v|wmv)$/i, '')
    t = t.replace(/[._]+/g, ' ').replace(/\s+-\s+|-/g, ' ').replace(/\s+/g, ' ').trim()
    const out = { name: '', year: null, season: null, episode: null }
    let cut = t.length

    const ep = t.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i) || t.match(/\b(\d{1,2})x(\d{2,3})\b/)
    if (ep) { out.season = +ep[1]; out.episode = +ep[2]; cut = Math.min(cut, ep.index) }

    // A year after at least one word ("2012" alone is a title, not a year).
    const yr = /(?:^|[\s(\[])((?:19|20)\d{2})(?=$|[\s)\]])/g
    let m
    while ((m = yr.exec(t))) {
      const at = m.index + m[0].indexOf(m[1])
      if (at === 0) continue
      out.year = +m[1]
      cut = Math.min(cut, at)
      break
    }

    const words = t.slice(0, cut).replace(/[()[\]{}]/g, ' ').split(/\s+/).filter(Boolean)
    const keep = []
    for (const w of words) {
      if (RELEASE_JUNK.test(w.replace(/[^\w]/g, '')) || /^\d+(\.\d+)?(gb|mb)$/i.test(w)) break
      keep.push(w)
    }
    out.name = keep.join(' ').replace(/[,:;–-]+$/, '').trim()
    return out
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

  // Best TMDB /search/multi hit for a parsed upload name, or null when nothing is
  // convincing (a wrong link would mix up watch progress, so be strict).
  function pickTmdbMatch(parsed, results) {
    if (!parsed || !parsed.name || !Array.isArray(results)) return null
    const wantTv = parsed.season != null
    const name = norm(parsed.name)
    let best = null, bestScore = 0
    results.forEach((r, i) => {
      if (!r || (r.media_type !== 'movie' && r.media_type !== 'tv')) return
      if (wantTv && r.media_type !== 'tv') return
      const titles = [r.title, r.name, r.original_title, r.original_name].filter(Boolean).map(norm)
      const y = parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10)
      const exact = titles.some(x => x === name)
      const nameWords = name.split(' ')
      const prefix = titles.some(x => x && (name.indexOf(x) === 0 || x.indexOf(name) === 0 ||
        (nameWords.length >= 2 && nameWords.every(w => (' ' + x + ' ').indexOf(' ' + w + ' ') >= 0))))
      const yearOk = parsed.year && y && Math.abs(y - parsed.year) <= 1
      let score = 0
      if (exact) score += 50
      else if (prefix) score += 20
      else return
      if (yearOk) score += 40
      else if (parsed.year && y) score -= 30        // a different year → a different film
      if (wantTv) score += 10
      score -= i * 2                                 // TMDB's own ranking breaks ties
      if (score > bestScore) { bestScore = score; best = r }
    })
    return bestScore >= 45 ? best : null
  }

  // ── Source ranking by the profile's playback preferences ──
  // prefs: { audioPref: 'dub' | 'original' | 'any', qualityPref: '2160' | '1080' | '720' }
  // (profile settings, see db.js). Audio matters most, then resolution, then subtitles.
  const QUALITY_ORDER = { '2160': [2160, 1080, 720], '1080': [1080, 2160, 720], '720': [720, 1080, 2160] }
  function sourceScore(r, prefs) {
    prefs = prefs || {}
    const audio = prefs.audioPref || 'dub'
    const order = QUALITY_ORDER[prefs.qualityPref] || QUALITY_ORDER['1080']
    let score = 0
    if (audio === 'dub' && r.dub) score += 30
    if (audio === 'original' && !r.dub) score += 30
    const qi = order.indexOf(r.res)
    if (qi >= 0) score += 12 - qi * 3
    else if (r.res && r.res < 720) score += prefs.qualityPref === '720' ? 4 : 1
    if (r.subs) score += audio === 'original' ? 6 : 3
    return score
  }

  // Best match first; equal scores keep their original order.
  function rankSources(list, prefs) {
    return list.map((r, i) => ({ r: r, i: i, s: sourceScore(r, prefs) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map(x => x.r)
  }

  const api = { titleWords, durationSeconds, hasEpisodeCode, filterSources, parseReleaseName, pickTmdbMatch, sourceScore, rankSources }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.FilmBoxRelevance = api
})(typeof window !== 'undefined' ? window : this)
