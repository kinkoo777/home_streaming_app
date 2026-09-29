// ================= WATCHED =================

let _watchedCache = []

async function _loadWatched() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { _watchedCache = []; return }
  try {
    const res = await fetch(`/api/profiles/${profileId}/watched`)
    _watchedCache = res.ok ? await res.json() : []
  } catch (e) { _watchedCache = [] }
}

// mediaType is optional; when given, a movie and a show sharing a TMDB id don't collide.
function isWatched(id, mediaType) {
  const n = Number(id)
  return _watchedCache.some(w => w.tmdbId === n && (!mediaType || w.mediaType === mediaType))
}

async function toggleWatched(movie) {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { showToast('Nejprve vyberte profil'); return false }
  const tmdbId    = Number(movie.id)
  const mediaType = movie.media_type || (movie.title ? 'movie' : 'tv')

  if (isWatched(tmdbId, mediaType)) {
    await fetch(`/api/profiles/${profileId}/watched/${tmdbId}/${mediaType}`, { method: 'DELETE' })
    _watchedCache = _watchedCache.filter(w => !(w.tmdbId === tmdbId && w.mediaType === mediaType))
    showToast('Odebráno ze zhlédnutých')
    renderWatched()
    refreshWatchedBadges()
    return false
  }

  const res = await fetch(`/api/profiles/${profileId}/watched`, jsonBody('POST', {
    tmdbId,
    mediaType,
    title:      movie.title || movie.name,
    posterPath: movie.poster_path || null
  }))
  if (res.ok) _watchedCache.unshift(await res.json())
  showToast('Označeno jako zhlédnuté ✓')
  renderWatched()
  refreshWatchedBadges()
  return true
}

function _timeAgo(isoStr) {
  const d = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (d <= 0)  return 'Dnes'
  if (d === 1) return 'Včera'
  if (d < 7)   return 'před ' + d + ' dny'
  if (d < 30)  return 'před ' + Math.floor(d / 7) + ' týd.'
  return 'před ' + Math.floor(d / 30) + ' měs.'
}

function renderWatched() {
  const section   = document.getElementById('watched-section')
  const container = document.getElementById('watched-movies')
  if (!section || !container) return

  if (!_watchedCache.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = _watchedCache.map((w, i) => buildCard({
    id: w.tmdbId,
    media_type: w.mediaType,
    title: w.title,
    poster_path: w.posterPath
  }, { index: i, remove: 'watched', removeTitle: 'Odebrat ze zhlédnutých', note: _timeAgo(w.watchedAt), hideWatchedBadge: true })).join('')
  if (window.updateRowArrows) window.updateRowArrows(container)
}

function refreshWatchedBadges() {
  document.querySelectorAll('.movie-card[data-id]').forEach(card => {
    if (card.classList.contains('continue-card') || card.closest('#watched-movies')) return
    const poster = card.querySelector('.movie-poster')
    if (!poster) return
    let badge = poster.querySelector('.watched-badge')
    if (isWatched(card.dataset.id, card.dataset.type)) {
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'watched-badge'
        badge.title = 'Zhlédnuto'
        badge.innerHTML = '<i class="bi bi-check-lg"></i>'
        poster.appendChild(badge)
      }
    } else if (badge) {
      badge.parentNode.removeChild(badge)
    }
  })
}

window.watchedRemoveCard = async function (tmdbId, mediaType) {
  const profileId = getActiveProfileId()
  if (profileId === 'default') return
  await fetch(`/api/profiles/${profileId}/watched/${tmdbId}/${mediaType}`, { method: 'DELETE' })
  _watchedCache = _watchedCache.filter(w => !(w.tmdbId === Number(tmdbId) && w.mediaType === mediaType))
  renderWatched()
  refreshWatchedBadges()
  showToast('Odebráno ze zhlédnutých')
}

window.isWatched     = isWatched
window.toggleWatched = toggleWatched
window.renderWatched = renderWatched
window.reloadWatched = async function () {
  await _loadWatched()
  renderWatched()
  refreshWatchedBadges()
}

document.addEventListener('DOMContentLoaded', () => {
  if (hasActiveProfile()) window.reloadWatched()
})
