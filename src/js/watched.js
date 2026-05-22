// ================= WATCHED =================

const WATCHED_KEY = 'filmbox_watched'

function getWatched() {
  return JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]')
}

function saveWatched(list) {
  localStorage.setItem(WATCHED_KEY, JSON.stringify(list))
}

function isWatched(id) {
  return getWatched().some(w => w.id === id)
}

// Returns true if now watched, false if removed
async function toggleWatched(movie) {
  const list = getWatched()
  const idx  = list.findIndex(w => w.id === movie.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    saveWatched(list)
    showToast('Odebráno ze sledovaných')
    renderWatched()
    refreshWatchedBadges()
    return false
  }
  list.unshift({
    id:         movie.id,
    mediaType:  movie.media_type || (movie.title ? 'movie' : 'tv'),
    title:      movie.title || movie.name,
    posterPath: movie.poster_path || null,
    watchedAt:  new Date().toISOString()
  })
  saveWatched(list)
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

  const list = getWatched()
  if (!list.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = list.map(w => `
    <div class="movie-card" onclick="openDetailModal(${w.id},'${w.mediaType}',decodeURIComponent('${encodeURIComponent(w.title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${w.posterPath || ''}" alt="${w.title}" loading="lazy">
        <button class="fav-btn active" style="background:rgba(34,197,94,0.2);color:#4ade80"
                onclick="event.stopPropagation();watchedRemoveCard(${w.id})">
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

window.watchedRemoveCard = function(id) {
  const list = getWatched().filter(w => w.id !== id)
  saveWatched(list)
  renderWatched()
  refreshWatchedBadges()
  showToast('Odebráno ze sledovaných')
}

window.isWatched     = isWatched
window.toggleWatched = toggleWatched
window.renderWatched = renderWatched
window.reloadWatched = renderWatched

document.addEventListener('DOMContentLoaded', () => {
  renderWatched()
})
