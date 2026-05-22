// ================= CONTINUE WATCHING =================

function renderContinueWatching() {
  const section   = document.getElementById('continue-watching-section')
  const container = document.getElementById('continue-watching-movies')
  if (!section || !container) return

  const progress = window._profileProgress || {}
  const items = []

  for (const [tmdbId, seconds] of Object.entries(progress)) {
    if (!seconds || seconds <= 30) continue
    if (typeof isWatched === 'function' && isWatched(parseInt(tmdbId))) continue
    const metaRaw = localStorage.getItem('filmbox_meta_' + tmdbId)
    if (!metaRaw) continue
    items.push({ ...JSON.parse(metaRaw), _progress: seconds })
  }

  if (!items.length) { section.style.display = 'none'; return }
  section.style.display = 'block'
  container.innerHTML = items.map(m => buildCard(m, 'continue-card')).join('')
}

// ================= MULTI-LIST (SEZNAM) =================

const DEFAULT_LIST_ID = 'default'
let activeListId = DEFAULT_LIST_ID
let _listsCache = null

function getLists() {
  if (_listsCache) return _listsCache
  _listsCache = [{ id: DEFAULT_LIST_ID, name: 'Můj seznam', movies: [] }]
  return _listsCache
}

async function _loadLists() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { _listsCache = [{ id: DEFAULT_LIST_ID, name: 'Můj seznam', movies: [] }]; return }
  try {
    const res = await fetch(`/api/profiles/${profileId}/watchlists`)
    _listsCache = res.ok ? await res.json() : [{ id: DEFAULT_LIST_ID, name: 'Můj seznam', movies: [] }]
  } catch {
    _listsCache = [{ id: DEFAULT_LIST_ID, name: 'Můj seznam', movies: [] }]
  }
}

function saveLists(lists) {
  _listsCache = lists
  const profileId = getActiveProfileId()
  if (profileId === 'default') return
  fetch(`/api/profiles/${profileId}/watchlists`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(lists)
  }).catch(() => {})
}

function getListById(id) {
  return getLists().find(l => l.id === id) || null
}

function isInAnyList(movieId) {
  return getLists().some(l => l.movies.some(m => m.id === movieId))
}

function getWatchlist()    { return (getListById(DEFAULT_LIST_ID) || { movies: [] }).movies }
function isInWatchlist(id) { return isInAnyList(id) }

function toggleMovieInList(listId, movie) {
  const lists = getLists()
  const list  = lists.find(l => l.id === listId)
  if (!list) return false
  const idx = list.movies.findIndex(m => m.id === movie.id)
  if (idx >= 0) {
    list.movies.splice(idx, 1)
    saveLists(lists)
    return false
  }
  list.movies.unshift(movie)
  saveLists(lists)
  return true
}

function createList(name) {
  if (!name.trim()) return
  const lists = getLists()
  if (lists.some(l => l.name.toLowerCase() === name.trim().toLowerCase())) {
    showToast('Seznam s tímto názvem již existuje')
    return
  }
  const id = 'list_' + Date.now()
  lists.push({ id, name: name.trim(), movies: [] })
  saveLists(lists)
  renderWatchlistTabs()
  showToast('Seznam "' + name.trim() + '" vytvořen ✓')
  return id
}

function deleteList(listId) {
  if (listId === DEFAULT_LIST_ID) { showToast('Výchozí seznam nelze smazat'); return }
  const lists = getLists().filter(l => l.id !== listId)
  saveLists(lists)
  if (activeListId === listId) activeListId = DEFAULT_LIST_ID
  renderWatchlistTabs()
  renderWatchlist()
  if (!document.getElementById('wl-modal').classList.contains('hidden')) renderWlModalLists()
  showToast('Seznam smazán')
}

// ── Watchlist tabs ──

function renderWatchlistTabs() {
  const lists = getLists()
  const wrap  = document.getElementById('watchlist-tabs')
  if (!wrap) return
  wrap.innerHTML = lists.map(l => `
    <button class="wl-tab${l.id === activeListId ? ' active' : ''}" onclick="switchList('${l.id}')">
      ${l.name}
      <span class="wl-tab-count">${l.movies.length}</span>
    </button>
  `).join('')
}

window.switchList = function(id) {
  activeListId = id
  renderWatchlistTabs()
  renderWatchlist()
}

// ── Render watchlist ──

function renderWatchlist() {
  const lists     = getLists()
  const section   = document.getElementById('watchlist-section')
  const container = document.getElementById('watchlist-movies')
  const totalMovies = lists.reduce((sum, l) => sum + l.movies.length, 0)

  if (!totalMovies) { section.style.display = 'none'; return }
  section.style.display = 'block'

  renderWatchlistTabs()

  const list   = getListById(activeListId)
  const movies = list ? list.movies : []

  if (!movies.length) {
    container.innerHTML = '<p style="color:gray;padding:20px">Tento seznam je prázdný.</p>'
    return
  }

  container.innerHTML = movies.map(movie => {
    const title = movie.title || movie.name
    const year  = (movie.release_date || movie.first_air_date || '').slice(0, 4)
    return `
      <div class="movie-card" onclick="openDetailModal(${movie.id},'${movie.media_type || 'movie'}',decodeURIComponent('${encodeURIComponent(title)}'))">
        <div class="movie-poster">
          <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${title}" loading="lazy">
          <div class="rating">⭐ ${(movie.vote_average || 0).toFixed(1)}</div>
          <button class="wl-btn active" onclick="event.stopPropagation();removeFromCurrentList(${movie.id})">
            <i class="bi bi-bookmark-fill"></i>
          </button>
        </div>
        <div class="movie-info">
          <h4>${title}</h4>
          <div class="movie-meta"><span>${year}</span></div>
        </div>
      </div>
    `
  }).join('')
}

window.removeFromCurrentList = function(movieId) {
  const lists = getLists()
  const list  = lists.find(l => l.id === activeListId)
  if (!list) return
  list.movies = list.movies.filter(m => m.id !== movieId)
  saveLists(lists)
  renderWatchlist()
  renderContinueWatching()
  showToast('Odebráno ze seznamu')
}

window.toggleWatchlistCard = function(btn, id) {
  let movie = searchDataMap[id]
  if (!movie) {
    for (const l of getLists()) {
      movie = l.movies.find(m => m.id === id)
      if (movie) break
    }
  }
  if (!movie) return
  const added = toggleMovieInList(activeListId, movie)
  btn.classList.toggle('active', added)
  btn.querySelector('i').className = 'bi ' + (added ? 'bi-bookmark-fill' : 'bi-bookmark')
  const section = document.getElementById('watchlist-section')
  if (section.style.display === 'block') renderWatchlist()
  renderContinueWatching()
  showToast(added ? 'Přidáno do "' + (getListById(activeListId) || {}).name + '" ✓' : 'Odebráno ze seznamu')
}

// ── WL Modal ──

let wlModalMovie = null

function openWlModal(movie) {
  wlModalMovie = movie
  const modal = document.getElementById('wl-modal')
  modal.classList.remove('hidden')
  openModal()
  renderWlModalLists()
}

function closeWlModal() {
  document.getElementById('wl-modal').classList.add('hidden')
  closeModal()
  wlModalMovie = null
}

function renderWlModalLists() {
  const lists     = getLists()
  const container = document.getElementById('wl-modal-lists')
  container.innerHTML = lists.map(l => {
    const inList = wlModalMovie ? l.movies.some(m => m.id === wlModalMovie.id) : false
    return `
      <div class="wl-list-item" onclick="wlModalToggle('${l.id}')">
        <div class="wl-list-item-left">
          <div class="wl-list-check${inList ? ' checked' : ''}">${inList ? '<i class="bi bi-check"></i>' : ''}</div>
          <div>
            <div class="wl-list-name">${l.name}</div>
            <div class="wl-list-meta">${l.movies.length} položek</div>
          </div>
        </div>
        ${l.id !== DEFAULT_LIST_ID ? `<button class="wl-list-delete" onclick="event.stopPropagation();deleteList('${l.id}')"><i class="bi bi-trash"></i></button>` : ''}
      </div>
    `
  }).join('')
}

window.wlModalToggle = function(listId) {
  if (!wlModalMovie) return
  toggleMovieInList(listId, wlModalMovie)
  renderWlModalLists()
  renderWatchlist()
  renderContinueWatching()
  const inAny = isInAnyList(wlModalMovie.id)
  const wlBtn = document.getElementById('detail-wl-btn')
  if (wlBtn) wlBtn.innerHTML = `<i class="bi ${inAny ? 'bi-bookmark-fill' : 'bi-bookmark'}"></i> ${inAny ? 'V seznamu' : 'Přidat'}`
}

document.getElementById('wl-modal-close').addEventListener('click', closeWlModal)
document.getElementById('wl-modal-backdrop').addEventListener('click', closeWlModal)
document.getElementById('wl-new-list-btn').addEventListener('click', () => {
  const input = document.getElementById('wl-new-list-input')
  if (input.value.trim()) {
    createList(input.value.trim())
    input.value = ''
    renderWlModalLists()
  }
})
document.getElementById('wl-new-list-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('wl-new-list-btn').click()
})

document.getElementById('clear-watchlist').addEventListener('click', () => {
  const lists = getLists()
  const list  = lists.find(l => l.id === activeListId)
  if (list) { list.movies = []; saveLists(lists) }
  renderWatchlist()
  renderContinueWatching()
  showToast('Seznam vymazán')
})

document.getElementById('watchlist-toggle')?.addEventListener('click', () => {
  const section = document.getElementById('watchlist-section')
  const lists   = getLists()
  const total   = lists.reduce((s, l) => s + l.movies.length, 0)
  if (!total) { showToast('Váš seznam je prázdný'); return }
  if (section.style.display === 'none' || !section.style.display) {
    renderWatchlist()
    section.scrollIntoView({ behavior: 'smooth' })
  } else {
    section.style.display = 'none'
  }
})

window.reloadWatchlist = async function() {
  await _loadLists()
  renderWatchlist()
}
window.reloadContinueWatching = renderContinueWatching

document.addEventListener('DOMContentLoaded', async () => {
  await _loadLists()
  renderContinueWatching()
  renderWatchlist()
})
