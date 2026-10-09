// ================= RATINGS + MATCH =================
// 👎 Nelíbí se mi / 👍 Líbí se mi / 👍👍 Miluju to — per profile (/api/profiles/:id/ratings).
// Ratings, favourites and what the profile watched make its taste (server: /taste);
// FilmBoxTaste.match() turns it into "97 % shoda" on the detail and the card pop-out.
// 👎 titles never come up in recommendations or "Co pustit?".

;(function () {
  'use strict'

  let _ratings = {}          // 'movie:603' → -1 | 1 | 2
  let _list = []             // newest first: [{ tmdbId, mediaType, rating, title, posterPath, ratedAt }]
  let _tasteSeq = 0
  window._taste = null

  const key = (id, type) => (type === 'tv' ? 'tv' : 'movie') + ':' + id
  window.getRating = (id, type) => _ratings[key(id, type)] || 0
  window.getRatedList = () => _list.slice()
  window.isDisliked = (id, type) => _ratings[key(id, type)] === -1 ||
    !!(window._taste && window._taste.disliked && window._taste.disliked.indexOf(key(id, type)) >= 0)

  function loadTaste() {
    const id = getActiveProfileId()
    const seq = ++_tasteSeq
    if (!hasActiveProfile()) { window._taste = null; return Promise.resolve() }
    return fetch(`/api/profiles/${encodeURIComponent(id)}/taste`)
      .then(r => r.ok ? r.json() : null)
      .then(t => { if (seq === _tasteSeq) window._taste = t })
      .catch(() => {})
  }

  window.reloadRatings = function () {
    _ratings = {}
    _list = []
    if (!hasActiveProfile()) { window._taste = null; return Promise.resolve() }
    const id = getActiveProfileId()
    return fetch(`/api/profiles/${encodeURIComponent(id)}/ratings`)
      .then(r => r.ok ? r.json() : [])
      .then(list => { _list = list || []; _list.forEach(r => { _ratings[key(r.tmdbId, r.mediaType)] = r.rating }) })
      .catch(() => {})
      .then(loadTaste)
  }

  // "97 % shoda" for a title (TMDB list item or details), or '' when unknown.
  window.matchPercent = function (m) {
    return window.FilmBoxTaste && window._taste ? window.FilmBoxTaste.match(window._taste, m) : null
  }
  window.matchBadge = function (m) {
    const p = window.matchPercent(m)
    if (p == null) return ''
    return `<span class="match-badge${p >= 80 ? ' high' : ''}" title="Podle toho, co jste hodnotili a sledovali">${p} % shoda</span>`
  }

  const CHOICES = [
    { v: -1, icon: 'bi-hand-thumbs-down', on: 'bi-hand-thumbs-down-fill', label: 'Nelíbí se mi' },
    { v: 1, icon: 'bi-hand-thumbs-up', on: 'bi-hand-thumbs-up-fill', label: 'Líbí se mi' },
    { v: 2, icon: 'bi-hand-thumbs-up', on: 'bi-hand-thumbs-up-fill', label: 'Miluju to', double: true }
  ]

  async function setRating(movie, value) {
    if (!hasActiveProfile()) { showToast('Nejprve vyberte profil'); return false }
    const type = movie.media_type === 'tv' ? 'tv' : 'movie'
    const k = key(movie.id, type)
    const prev = _ratings[k] || 0
    const next = prev === value ? 0 : value            // the same button again = take it back
    if (next) _ratings[k] = next; else delete _ratings[k]
    _list = _list.filter(r => key(r.tmdbId, r.mediaType) !== k)
    if (next) _list.unshift({ tmdbId: movie.id, mediaType: type, rating: next, title: movie.title || movie.name || '', posterPath: movie.poster_path || null, ratedAt: new Date().toISOString() })
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(getActiveProfileId())}/ratings/${type}/${movie.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: next, title: movie.title || movie.name || '', posterPath: movie.poster_path || null })
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Hodnocení se nepodařilo uložit')
    } catch (err) {
      if (prev) _ratings[k] = prev; else delete _ratings[k]
      showToast(err.message)
      return false
    }
    showToast(!next ? 'Hodnocení odebráno' : next === -1 ? 'Dobře, podobné vám nebudeme nabízet' : next === 2 ? 'Miluju to 👍👍 — víc takových' : 'Líbí se vám 👍')
    // Taste and the rows built from it follow.
    loadTaste().then(() => {
      if (window.reloadRecommendations) window.reloadRecommendations()
    })
    return true
  }
  window.setRating = setRating

  // Three buttons into `box` for `movie` ({ id, media_type, title|name, poster_path }).
  window.renderRateGroup = function (box, movie, opts) {
    if (!box || !movie) return
    const cur = window.getRating(movie.id, movie.media_type)
    box.innerHTML = CHOICES.map(c =>
      `<button type="button" class="rate-btn${cur === c.v ? ' on' : ''}${c.double ? ' love' : ''}" data-rate="${c.v}" title="${c.label}" aria-label="${c.label}" aria-pressed="${cur === c.v}">` +
      (c.double ? `<span class="dbl"><i class="bi ${cur === c.v ? c.on : c.icon}"></i><i class="bi ${cur === c.v ? c.on : c.icon}"></i></span>` : `<i class="bi ${cur === c.v ? c.on : c.icon}"></i>`) +
      '</button>').join('')
    box.onclick = async e => {
      const b = e.target.closest('[data-rate]')
      if (!b) return
      e.stopPropagation()
      if (await setRating(movie, parseInt(b.dataset.rate, 10))) {
        window.renderRateGroup(box, movie, opts)
        if (opts && opts.onRated) opts.onRated(window.getRating(movie.id, movie.media_type))
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => { if (hasActiveProfile()) window.reloadRatings() })
})()
