// ================= CONTINUE WATCHING =================

async function renderContinueWatching() {
  const section   = document.getElementById('continue-watching-section')
  const container = document.getElementById('continue-watching-movies')
  if (!section || !container) return

  const progress = window._profileProgress || {}
  const items = []

  for (const [key, val] of Object.entries(progress)) {
    const isObj    = val && typeof val === 'object'
    const seconds  = isObj ? val.seconds  : val
    const duration = isObj ? val.duration : null
    if (!seconds || seconds <= 30) continue
    const tmdbId      = (isObj && val.tmdbId != null) ? val.tmdbId : parseInt(key)
    const episodeLabel = isObj ? (val.episodeLabel || null) : null
    // Hide finished movies, but never hide an in-progress episode just because the show is "watched".
    if (typeof isWatched === 'function' && isWatched(tmdbId) && !episodeLabel) continue
    if (duration && (seconds / duration) >= 0.9) continue

    // Prefer device-independent server metadata; fall back to this browser's localStorage cache.
    let meta = null
    if (isObj && val.title) {
      meta = { id: tmdbId, title: val.title, poster_path: val.posterPath || null, media_type: val.mediaType || 'movie' }
    } else {
      const metaRaw = localStorage.getItem('filmbox_meta_' + key)
      if (metaRaw) meta = JSON.parse(metaRaw)
    }
    if (!meta) continue

    items.push({
      ...meta,
      _key:          key,
      _seconds:      seconds,
      _duration:     duration,
      _hasDuration:  !!duration,
      _episodeLabel: episodeLabel
    })
  }

  if (!items.length) { section.style.display = 'none'; return }

  // Fetch full TMDB details for items missing display fields (rating, year, runtime).
  // Skip only when the item already has a usable rating AND a way to draw the progress line.
  // Results are merged back into localStorage so the fetch only happens once per item.
  await Promise.all(items.map(async m => {
    if (m.vote_average && (m._hasDuration || m.runtime)) return
    try {
      const r = await fetch(`/tmdb/details?id=${m.id}&type=${m.media_type || 'movie'}`)
      if (!r.ok) return
      const d = await r.json()
      m.vote_average  = (m.vote_average != null && m.vote_average !== 0) ? m.vote_average : d.vote_average
      m.runtime       = m.runtime      || d.runtime
      m.release_date  = m.release_date || d.release_date
      m.first_air_date = m.first_air_date || d.first_air_date
      m.poster_path   = m.poster_path  || d.poster_path
      m.genre_ids     = m.genre_ids    || (Array.isArray(d.genres) ? d.genres.map(g => g.id) : undefined)
      const key = 'filmbox_meta_' + m.id
      const raw = localStorage.getItem(key)
      if (raw) {
        const mm = JSON.parse(raw)
        if (d.vote_average  != null) mm.vote_average  = mm.vote_average  || d.vote_average
        if (d.runtime       != null) mm.runtime       = mm.runtime       || d.runtime
        if (d.release_date  != null) mm.release_date  = mm.release_date  || d.release_date
        if (d.first_air_date != null) mm.first_air_date = mm.first_air_date || d.first_air_date
        if (d.poster_path   != null) mm.poster_path   = mm.poster_path   || d.poster_path
        if (Array.isArray(d.genres))  mm.genre_ids    = mm.genre_ids     || d.genres.map(g => g.id)
        localStorage.setItem(key, JSON.stringify(mm))
      }
    } catch {}
  }))

  section.style.display = 'block'
  section.classList.remove('section-reveal')
  void section.offsetWidth
  section.classList.add('section-reveal')
  container.innerHTML = items.map(m => buildCard(m, 'continue-card')).join('')
}

// Remove a single title/episode from Continue Watching (deletes its progress entry).
window.removeFromContinue = async function(key) {
  const profileId = getActiveProfileId()
  if (profileId === 'default') return
  try {
    await fetch(`/api/profiles/${profileId}/progress/${encodeURIComponent(key)}`, { method: 'DELETE' })
  } catch {}
  if (window._profileProgress) delete window._profileProgress[key]
  renderContinueWatching()
  showToast('Odebráno z „Pokračovat ve sledování"')
}

// ================= MULTI-LIST (SEZNAM) =================

const DEFAULT_LIST_ID = 'default'
let activeListId = DEFAULT_LIST_ID
let _listsCache = null
let _wlExplicitlyOpen = false   // keep the section visible (for list management) even when empty

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
  if (profileId === 'default') { showToast('Nejprve si vyberte profil'); return }
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

function renameList(listId, newName) {
  if (listId === DEFAULT_LIST_ID) { showToast('Výchozí seznam nelze přejmenovat'); return }
  const name = (newName || '').trim()
  if (!name) return
  const lists = getLists()
  const list  = lists.find(l => l.id === listId)
  if (!list) return
  if (lists.some(l => l.id !== listId && l.name.toLowerCase() === name.toLowerCase())) {
    showToast('Seznam s tímto názvem již existuje')
    return
  }
  list.name = name
  saveLists(lists)
  renderWatchlistTabs()
  renderWatchlist()
  if (!document.getElementById('wl-modal').classList.contains('hidden')) renderWlModalLists()
  showToast('Seznam přejmenován')
}

// Swap an element for an inline rename input; commits on Enter/blur, cancels on Escape.
function _inlineRename(targetEl, listId, rerender) {
  const list = getListById(listId)
  if (!list || !targetEl) return
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'wl-inline-input'
  input.value = list.name
  input.maxLength = 30
  const commit = () => {
    const val = input.value.trim()
    if (val && val.toLowerCase() !== list.name.toLowerCase()) renameList(listId, val)
    else rerender()
  }
  input.addEventListener('click', e => e.stopPropagation())
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    else if (e.key === 'Escape') { input.value = list.name; input.blur() }
  })
  input.addEventListener('blur', commit, { once: true })
  targetEl.replaceWith(input)
  input.focus()
  input.select()
}

window.startRenameTab = function(id) {
  const wrap = document.getElementById('watchlist-tabs')
  if (!wrap) return
  // Render the whole tab row as a single rename input, restored after commit.
  wrap.innerHTML = '<span class="wl-tab-rename-host"></span>'
  _inlineRename(wrap.firstChild, id, renderWatchlistTabs)
}

window.startRenameModalList = function(id) {
  const nameEl = document.querySelector(`#wl-modal-lists .wl-list-name[data-id="${id}"]`)
  _inlineRename(nameEl, id, renderWlModalLists)
}

// ── Watchlist tabs ──

function renderWatchlistTabs() {
  const lists = getLists()
  const wrap  = document.getElementById('watchlist-tabs')
  if (!wrap) return
  wrap.innerHTML = lists.map(l => `
    <button class="wl-tab${l.id === activeListId ? ' active' : ''}" onclick="switchList('${l.id}')">
      <span class="wl-tab-name">${escapeHtml(l.name)}</span>
      <span class="wl-tab-count">${l.movies.length}</span>
      ${l.id !== DEFAULT_LIST_ID ? `<span class="wl-tab-rename" title="Přejmenovat" onclick="event.stopPropagation();startRenameTab('${l.id}')"><i class="bi bi-pencil"></i></span>` : ''}
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

  // Hide only when there's nothing AND the user hasn't explicitly opened it for list management
  if (!totalMovies && !_wlExplicitlyOpen) { section.style.display = 'none'; return }
  section.style.display = 'block'
  section.classList.remove('section-reveal')
  void section.offsetWidth
  section.classList.add('section-reveal')

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
            <div class="wl-list-name" data-id="${l.id}">${escapeHtml(l.name)}</div>
            <div class="wl-list-meta">${l.movies.length} položek</div>
          </div>
        </div>
        ${l.id !== DEFAULT_LIST_ID ? `<div class="wl-list-actions">
          <button class="wl-list-rename" title="Přejmenovat" onclick="event.stopPropagation();startRenameModalList('${l.id}')"><i class="bi bi-pencil"></i></button>
          <button class="wl-list-delete" title="Smazat" onclick="event.stopPropagation();deleteList('${l.id}')"><i class="bi bi-trash"></i></button>
        </div>` : ''}
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
  if (section.style.display === 'none' || !section.style.display) {
    _wlExplicitlyOpen = true   // open even when empty so lists can be created/managed
    renderWatchlist()
    section.scrollIntoView({ behavior: 'smooth' })
  } else {
    section.style.display = 'none'
    _wlExplicitlyOpen = false
  }
})

// ── Inline "Nový seznam" in the watchlist section header ──
document.getElementById('wl-add-list-btn')?.addEventListener('click', () => {
  const box   = document.getElementById('wl-inline-new')
  const input = document.getElementById('wl-inline-input')
  box.classList.toggle('hidden')
  if (!box.classList.contains('hidden')) { input.value = ''; input.focus() }
})
document.getElementById('wl-inline-confirm')?.addEventListener('click', () => {
  const input = document.getElementById('wl-inline-input')
  const id = createList(input.value)
  if (id) { activeListId = id; renderWatchlist() }
  document.getElementById('wl-inline-new').classList.add('hidden')
  input.value = ''
})
document.getElementById('wl-inline-cancel')?.addEventListener('click', () => {
  document.getElementById('wl-inline-new').classList.add('hidden')
  document.getElementById('wl-inline-input').value = ''
})
document.getElementById('wl-inline-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter')       { e.preventDefault(); document.getElementById('wl-inline-confirm').click() }
  else if (e.key === 'Escape') { document.getElementById('wl-inline-cancel').click() }
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
