// ================= FAVORITES =================

// All cached data is tied to a specific profileId.
// If the active profile changes, stale data is never used.
let _state = { profileId: null, list: [], cache: {} }

function getActiveProfileId() {
  const raw = sessionStorage.getItem('filmbox_active_profile')
  return raw ? JSON.parse(raw).id : null
}

async function loadFavorites() {
  const profileId = getActiveProfileId()
  // Clear immediately so renderFavorites() shows nothing while fetching
  _state = { profileId, list: [], cache: {} }
  if (!profileId) return
  try {
    const res = await fetch(`/api/profiles/${profileId}/favorites`)
    if (res.ok) {
      const list = await res.json()
      // Only commit if the profile hasn't switched during the fetch
      if (_state.profileId === profileId) {
        _state.list = list
        list.forEach(f => { _state.cache[f.tmdbId + '_' + f.mediaType] = true })
      }
    }
  } catch {}
}

function isFavorite(tmdbId, mediaType) {
  // Guard against stale state from a previous profile
  if (_state.profileId !== getActiveProfileId()) return false
  return !!_state.cache[tmdbId + '_' + mediaType]
}

// Returns true if now a favorite, false if removed
async function toggleFavorite(movie) {
  const profileId = getActiveProfileId()
  if (!profileId) { showToast('Nejprve vyberte profil'); return false }

  const tmdbId     = movie.id
  const mediaType  = movie.media_type || (movie.title ? 'movie' : 'tv')
  const title      = movie.title || movie.name
  const posterPath = movie.poster_path || null
  const key        = tmdbId + '_' + mediaType

  // Reload state if it belongs to a different profile
  if (_state.profileId !== profileId) {
    await loadFavorites()
  }

  if (isFavorite(tmdbId, mediaType)) {
    const res = await fetch(`/api/profiles/${profileId}/favorites/${tmdbId}/${mediaType}`, { method: 'DELETE' })
    if (res.ok) {
      delete _state.cache[key]
      _state.list = _state.list.filter(f => !(f.tmdbId === tmdbId && f.mediaType === mediaType))
      showToast('Odebráno z oblíbených')
    } else {
      showToast('Chyba při odebrání')
    }
  } else {
    const res = await fetch(`/api/profiles/${profileId}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbId, mediaType, title, posterPath })
    })
    if (res.ok) {
      const fav = await res.json()
      _state.cache[key] = true
      _state.list.unshift(fav)
      showToast('Přidáno do oblíbených ♥')
    } else {
      const body = await res.json().catch(() => ({}))
      showToast('Chyba: ' + (body.error || 'nelze přidat'))
    }
  }

  refreshFavButtons()
  renderFavorites()
  return !!_state.cache[key]
}

function renderFavorites() {
  const section   = document.getElementById('favorites-section')
  const container = document.getElementById('favorites-movies')
  if (!section || !container) return

  if (!_state.list.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = _state.list.map(f => `
    <div class="movie-card" onclick="openDetailModal(${f.tmdbId},'${f.mediaType}',decodeURIComponent('${encodeURIComponent(f.title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${f.posterPath || ''}" alt="${f.title}" loading="lazy">
        <button class="fav-btn active" data-tmdb-id="${f.tmdbId}" data-media-type="${f.mediaType}"
                onclick="event.stopPropagation();favRemoveCard(${f.tmdbId},'${f.mediaType}')">
          <i class="bi bi-heart-fill"></i>
        </button>
      </div>
      <div class="movie-info">
        <h4>${f.title}</h4>
        <div class="movie-meta"><span>${f.mediaType === 'tv' ? 'Seriál' : 'Film'}</span></div>
      </div>
    </div>
  `).join('')
}

function refreshFavButtons() {
  document.querySelectorAll('.fav-btn[data-tmdb-id]').forEach(btn => {
    const active = isFavorite(parseInt(btn.dataset.tmdbId), btn.dataset.mediaType)
    btn.classList.toggle('active', active)
    btn.querySelector('i').className = 'bi ' + (active ? 'bi-heart-fill' : 'bi-heart')
  })
}

window.favRemoveCard = async function(tmdbId, mediaType) {
  const profileId = getActiveProfileId()
  if (!profileId) return
  const res = await fetch(`/api/profiles/${profileId}/favorites/${tmdbId}/${mediaType}`, { method: 'DELETE' })
  if (res.ok) {
    delete _state.cache[tmdbId + '_' + mediaType]
    _state.list = _state.list.filter(f => !(f.tmdbId === tmdbId && f.mediaType === mediaType))
    refreshFavButtons()
    renderFavorites()
    showToast('Odebráno z oblíbených')
  } else {
    showToast('Chyba při odebrání')
  }
}

window.favToggleCard = async function(btn, tmdbId, mediaType) {
  const movie = searchDataMap[tmdbId]
  if (!movie) { showToast('Data nejsou k dispozici'); return }
  const nowFav = await toggleFavorite({ ...movie, id: tmdbId, media_type: mediaType })
  btn.classList.toggle('active', nowFav)
  btn.querySelector('i').className = 'bi ' + (nowFav ? 'bi-heart-fill' : 'bi-heart')
}

window.reloadFavorites = async function() {
  await loadFavorites()
  refreshFavButtons()
  renderFavorites()
}

document.addEventListener('DOMContentLoaded', async () => {
  if (getActiveProfileId()) {
    await loadFavorites()
    refreshFavButtons()
    renderFavorites()
  }
})
