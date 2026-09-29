// ================= FAVORITES =================

// Cached data is tied to a profileId so stale data from a previous profile is never used.
let _favState = { profileId: null, list: [], cache: {} }

async function loadFavorites() {
  const profileId = getActiveProfileId()
  // Clear immediately so renderFavorites() shows nothing while fetching
  _favState = { profileId, list: [], cache: {} }
  if (profileId === 'default') return
  try {
    const res = await fetch(`/api/profiles/${profileId}/favorites`)
    if (res.ok) {
      const list = await res.json()
      // Only commit if the profile hasn't switched during the fetch
      if (_favState.profileId === profileId) {
        _favState.list = list
        list.forEach(f => { _favState.cache[f.tmdbId + '_' + f.mediaType] = true })
      }
    }
  } catch (e) {}
}

function isFavorite(tmdbId, mediaType) {
  if (_favState.profileId !== getActiveProfileId()) return false
  return !!_favState.cache[tmdbId + '_' + mediaType]
}

// Returns true if now a favorite, false if removed
async function toggleFavorite(movie) {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { showToast('Nejprve vyberte profil'); return false }

  const tmdbId     = Number(movie.id)
  const mediaType  = movie.media_type || (movie.title ? 'movie' : 'tv')
  const title      = movie.title || movie.name
  const posterPath = movie.poster_path || null
  const key        = tmdbId + '_' + mediaType

  if (_favState.profileId !== profileId) await loadFavorites()

  if (isFavorite(tmdbId, mediaType)) {
    const res = await fetch(`/api/profiles/${profileId}/favorites/${tmdbId}/${mediaType}`, { method: 'DELETE' })
    if (res.ok) {
      delete _favState.cache[key]
      _favState.list = _favState.list.filter(f => !(f.tmdbId === tmdbId && f.mediaType === mediaType))
      showToast('Odebráno z oblíbených')
    } else {
      showToast('Chyba při odebrání')
    }
  } else {
    const res = await fetch(`/api/profiles/${profileId}/favorites`, jsonBody('POST', { tmdbId, mediaType, title, posterPath }))
    if (res.ok) {
      const fav = await res.json()
      _favState.cache[key] = true
      _favState.list.unshift(fav)
      showToast('Přidáno do oblíbených ♥')
    } else {
      const body = await res.json().catch(() => ({}))
      showToast('Chyba: ' + (body.error || 'nelze přidat'))
    }
  }

  refreshFavButtons()
  renderFavorites()
  return !!_favState.cache[key]
}

function renderFavorites() {
  const section   = document.getElementById('favorites-section')
  const container = document.getElementById('favorites-movies')
  if (!section || !container) return

  if (!_favState.list.length) { section.style.display = 'none'; return }
  section.style.display = 'block'

  container.innerHTML = _favState.list.map((f, i) => buildCard({
    id: f.tmdbId,
    media_type: f.mediaType,
    title: f.title,
    poster_path: f.posterPath
  }, { index: i })).join('')
  if (window.updateRowArrows) window.updateRowArrows(container)
}

function refreshFavButtons() {
  document.querySelectorAll('.fav-btn[data-id]').forEach(btn => {
    const active = isFavorite(parseInt(btn.dataset.id, 10), btn.dataset.type)
    btn.classList.toggle('active', active)
    btn.querySelector('i').className = 'bi ' + (active ? 'bi-heart-fill' : 'bi-heart')
  })
}

window.favToggleCard = async function (btn, tmdbId, mediaType) {
  const movie = searchDataMap[tmdbId] || { id: tmdbId, media_type: mediaType, title: (btn.closest('.movie-card') || {}).dataset.title }
  const nowFav = await toggleFavorite(Object.assign({}, movie, { id: tmdbId, media_type: mediaType }))
  btn.classList.toggle('active', nowFav)
  btn.querySelector('i').className = 'bi ' + (nowFav ? 'bi-heart-fill' : 'bi-heart')
  btn.classList.remove('bump')
  void btn.offsetWidth
  btn.classList.add('bump')
}

window.reloadFavorites = async function () {
  await loadFavorites()
  refreshFavButtons()
  renderFavorites()
}

document.addEventListener('DOMContentLoaded', () => {
  if (hasActiveProfile()) window.reloadFavorites()
})
