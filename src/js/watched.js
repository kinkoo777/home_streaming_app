// ================= WATCHED =================

let _watchedCache = []

async function _loadWatched() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { _watchedCache = []; return }
  try {
    const res = await fetch(`/api/profiles/${profileId}/watched`)
    _watchedCache = res.ok ? await res.json() : []
  } catch { _watchedCache = [] }
}

function isWatched(id) {
  return _watchedCache.some(w => w.tmdbId === Number(id))
}

async function toggleWatched(movie) {
  const profileId = getActiveProfileId()
  const tmdbId    = movie.id
  const mediaType = movie.media_type || (movie.title ? 'movie' : 'tv')
  const already   = isWatched(tmdbId)

  if (already) {
    await fetch(`/api/profiles/${profileId}/watched/${tmdbId}/${mediaType}`, { method: 'DELETE' })
    _watchedCache = _watchedCache.filter(w => !(w.tmdbId === Number(tmdbId) && w.mediaType === mediaType))
    showToast('Odebráno ze sledovaných')
    renderWatched()
    refreshWatchedBadges()
    return false
  }

  const body = {
    tmdbId,
    mediaType,
    title:      movie.title || movie.name,
    posterPath: movie.poster_path || null
  }
  const res = await fetch(`/api/profiles/${profileId}/watched`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  })
  if (res.ok) {
    const entry = await res.json()
    _watchedCache.unshift(entry)
  }
  showToast('Přidáno mezi uzřené ✓')
  renderWatched()
  refreshWatchedBadges()
  return true
}

function _timeAgo(isoStr) {
  const d = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (d === 0)  return 'Dnes'
  if (d === 1)  return 'Včera'
  if (d < 7)   return d + ' dní'
  if (d < 30)  return Math.floor(d / 7) + ' týd.'
  return Math.floor(d / 30) + ' měs.'
}

function renderWatched() {
  const section   = document.getElementById('watched-section')
  const container = document.getElementById('watched-movies')
  if (!section || !container) return

  if (!_watchedCache.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = _watchedCache.map(w => `
    <div class="movie-card" onclick="openDetailModal(${w.tmdbId},'${w.mediaType}',decodeURIComponent('${encodeURIComponent(w.title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${w.posterPath || ''}" alt="${w.title}" loading="lazy">
        <button class="fav-btn active" style="background:rgba(34,197,94,0.2);color:#4ade80"
                onclick="event.stopPropagation();watchedRemoveCard(${w.tmdbId},'${w.mediaType}')">
          <i class="bi bi-check-circle-fill"></i>
        </button>
      </div>
      <div class="movie-info">
        <h4>${w.title}</h4>
        <div class="movie-meta">
          <span>${w.mediaType === 'tv' ? 'Seriál' : 'Film'}</span>
          <span class="watched-time">${_timeAgo(w.watchedAt)}</span>
        </div>
      </div>
    </div>
  `).join('')
}

function refreshWatchedBadges() {
  document.querySelectorAll('.movie-card').forEach(card => {
    const fn = card.getAttribute('onclick') || ''
    const m  = fn.match(/openDetailModal\((\d+)/)
    if (!m) return
    const id     = parseInt(m[1])
    const poster = card.querySelector('.movie-poster')
    if (!poster) return
    let badge = poster.querySelector('.watched-badge')
    if (isWatched(id)) {
      if (!badge) {
        badge = document.createElement('div')
        badge.className = 'watched-badge'
        badge.textContent = '✓ Seen'
        poster.appendChild(badge)
      }
    } else {
      badge?.remove()
    }
  })
}

window.watchedRemoveCard = async function(tmdbId, mediaType) {
  const profileId = getActiveProfileId()
  await fetch(`/api/profiles/${profileId}/watched/${tmdbId}/${mediaType}`, { method: 'DELETE' })
  _watchedCache = _watchedCache.filter(w => !(w.tmdbId === Number(tmdbId) && w.mediaType === mediaType))
  renderWatched()
  refreshWatchedBadges()
  showToast('Odebráno ze sledovaných')
}

window.isWatched     = isWatched
window.toggleWatched = toggleWatched
window.renderWatched = renderWatched
window.reloadWatched = async function() {
  await _loadWatched()
  renderWatched()
}

document.addEventListener('DOMContentLoaded', async () => {
  await _loadWatched()
  renderWatched()
})
