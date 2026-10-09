// ================= TASTE + "% SHODA" =================
// A profile's taste from what it rated, favourited and watched, as genre weights;
// a title's match with it as a percentage like Netflix's "98 % shoda". Pure functions —
// the server builds the taste (it has the genres), the page computes matches
// (window.FilmBoxTaste); the unit tests require() it.

;(function (root) {
  'use strict'

  // How much each signal counts. A dislike outweighs a like.
  const WEIGHTS = { love: 3, like: 2, dislike: -3, favorite: 2, watched: 1, progress: 0.5 }

  // items: [{ key: 'movie:603', genres: [28, 878], signal: 'like' | … }]
  // A key that appears with several signals counts once, with its strongest
  // (a dislike always wins).
  // → { genres: { [id]: -1…1 }, disliked: [keys], liked: [keys], n }
  function buildTaste(items) {
    const byKey = {}
    ;(items || []).forEach(it => {
      if (!it || !it.key) return
      const w = WEIGHTS[it.signal]
      if (w == null) return
      const cur = byKey[it.key]
      if (!cur || (w < 0) || (cur.w > 0 && w > cur.w)) {
        if (cur && cur.w < 0) return
        byKey[it.key] = { w, genres: Array.isArray(it.genres) ? it.genres : [] }
      }
    })
    const sum = {}
    const keys = Object.keys(byKey)
    keys.forEach(k => {
      const it = byKey[k]
      if (!it.genres.length) return
      // A title with many genres says less about each one.
      const share = it.w / Math.sqrt(it.genres.length)
      it.genres.forEach(g => { sum[g] = (sum[g] || 0) + share })
    })
    const max = Object.keys(sum).reduce((m, g) => Math.max(m, Math.abs(sum[g])), 0)
    const genres = {}
    Object.keys(sum).forEach(g => { genres[g] = max ? Math.round((sum[g] / max) * 1000) / 1000 : 0 })
    return {
      genres,
      disliked: keys.filter(k => byKey[k].w < 0),
      liked: keys.filter(k => byKey[k].w >= 2),
      n: keys.filter(k => byKey[k].genres.length).length
    }
  }

  // → 50…99, or null while the profile hasn't told us enough (fewer than 3 titles)
  // or the title has no genres. Genre fit counts 75 %, TMDB rating 25 %.
  function match(taste, movie) {
    if (!taste || !taste.n || taste.n < 3 || !movie) return null
    const gs = movie.genre_ids || (movie.genres || []).map(g => g && g.id).filter(Boolean)
    if (!gs.length) return null
    let fit = 0
    gs.forEach(g => { fit += taste.genres[g] || 0 })
    fit = Math.max(-1, Math.min(1, fit / Math.sqrt(gs.length)))
    const vote = Number(movie.vote_average) || 6
    const quality = Math.max(0, Math.min(1, (vote - 5) / 3.5))
    const raw = 0.75 * ((fit + 1) / 2) + 0.25 * quality
    return Math.max(50, Math.min(99, Math.round(50 + raw * 49)))
  }

  const api = { buildTaste, match, WEIGHTS }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.FilmBoxTaste = api
})(typeof window !== 'undefined' ? window : this)
