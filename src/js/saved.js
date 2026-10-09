// ================= SAVED IN FILMBOX =================
// Films / episodes kept on the server (downloads.js): a home row that plays them
// straight from there — no source picker, works even when the upload is gone.
// The Server page (server-admin.js) lists all of them with progress and Smazat.

;(function () {
  'use strict'
  const section = document.getElementById('saved-section')
  const track = document.getElementById('saved-movies')
  if (!section || !track) return
  let _items = []

  function playSaved(d) {
    const progressKey = d.episodeLabel ? d.tmdbId + ':' + d.episodeLabel : String(d.tmdbId)
    sessionStorage.setItem('filmbox_player', JSON.stringify({
      title: d.title,
      source: { qualities: [{ src: d.video, label: 'Z FilmBoxu' + (d.label ? ' · ' + d.label : ''), res: d.res || null, local: true }], subtitles: d.subtitles || [] },
      tmdbId: d.tmdbId, mediaType: d.mediaType, posterPath: d.posterPath,
      episode: d.episode, episodeLabel: d.episodeLabel, progressKey
    }))
    if (window.castSend && window.castSend(JSON.parse(sessionStorage.getItem('filmbox_player')))) return
    window.location.href = 'player.html'
  }

  window.reloadSaved = function () {
    return fetch('/api/downloads').then(r => r.ok ? r.json() : { items: [] }).then(res => {
      _items = (res.items || []).filter(d => d.status === 'done')
      if (!_items.length) { section.style.display = 'none'; return }
      track.innerHTML = _items.map((d, i) => buildCard(
        { id: d.tmdbId, title: d.title, poster_path: d.posterPath, media_type: d.mediaType },
        { index: i, badge: (d.episodeLabel ? d.episodeLabel + ' · ' : '') + 'Uloženo', hideWatchedBadge: true }
      ).replace('class="movie-card', `data-saved="${d.id}" class="movie-card saved-card`)).join('')
      section.style.display = 'block'
      if (window.updateRowArrows) window.updateRowArrows(track)
    }).catch(() => {})
  }

  // Before cards.js opens the detail: play it.
  track.addEventListener('click', e => {
    const card = e.target.closest('[data-saved]')
    if (!card || e.target.closest('[data-action]')) return
    e.stopPropagation()
    const d = _items.filter(x => x.id === card.dataset.saved)[0]
    if (d) playSaved(d)
  }, true)

  document.addEventListener('DOMContentLoaded', () => window.reloadSaved())
})()
