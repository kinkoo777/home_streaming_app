// ================= CONTINUE WATCHING =================

async function renderContinueWatching() {
  const section   = document.getElementById('continue-watching-section')
  const container = document.getElementById('continue-watching-movies')
  if (!section || !container) return

  const progress = window._profileProgress || {}
  const items = []

  Object.keys(progress).forEach(key => {
    const val      = progress[key]
    const isObj    = val && typeof val === 'object'
    const seconds  = isObj ? val.seconds  : val
    const duration = isObj ? val.duration : null
    if (!seconds || seconds <= 30) return
    const tmdbId       = (isObj && val.tmdbId != null) ? val.tmdbId : parseInt(key, 10)
    const episodeLabel = isObj ? (val.episodeLabel || null) : null
    const mediaType    = isObj ? (val.mediaType || 'movie') : 'movie'
    // Hide finished movies, but never hide an in-progress episode just because the show is "watched".
    if (!episodeLabel && isWatched(tmdbId, mediaType)) return
    if (duration && (seconds / duration) >= 0.9) return

    // Prefer device-independent server metadata; fall back to this browser's localStorage cache.
    let meta = null
    if (isObj && val.title) {
      meta = { id: tmdbId, title: val.title, poster_path: val.posterPath || null, media_type: mediaType }
    } else {
      try { meta = JSON.parse(lsGet('filmbox_meta_' + key, 'null')) } catch (e) { meta = null }
    }
    if (!meta) return

    items.push(Object.assign({}, meta, {
      _key:          key,
      _seconds:      seconds,
      _duration:     duration,
      _episodeLabel: episodeLabel,
      _updatedAt:    isObj ? val.updatedAt : null
    }))
  })

  if (!items.length) { section.style.display = 'none'; return }

  // Most recently watched first.
  items.sort((a, b) => String(b._updatedAt || '').localeCompare(String(a._updatedAt || '')))

  // Fill in rating/year/runtime for items that lack them (one TMDB call each, cached server-side).
  await Promise.all(items.map(async m => {
    if (m.vote_average && (m._duration || m.runtime)) return
    try {
      const r = await fetch(`/tmdb/details?id=${m.id}&type=${m.media_type || 'movie'}`)
      if (!r.ok) return
      const d = await r.json()
      m.vote_average   = m.vote_average || d.vote_average
      m.runtime        = m.runtime      || d.runtime
      m.release_date   = m.release_date || d.release_date
      m.first_air_date = m.first_air_date || d.first_air_date
      m.poster_path    = m.poster_path  || d.poster_path
    } catch (e) {}
  }))

  section.style.display = 'block'
  container.innerHTML = items.map((m, i) => buildCard(m, { index: i, variant: 'continue', remove: 'continue', removeTitle: 'Odebrat z Pokračovat' })).join('')
  if (window.updateRowArrows) window.updateRowArrows(container)
}

// Remove a single title/episode from Continue Watching (deletes its progress entry).
window.removeFromContinue = async function (key) {
  const profileId = getActiveProfileId()
  if (profileId === 'default') return
  try {
    await fetch(`/api/profiles/${profileId}/progress/${encodeURIComponent(key)}`, { method: 'DELETE' })
  } catch (e) {}
  if (window._profileProgress) delete window._profileProgress[key]
  renderContinueWatching()
  showToast('Odebráno z „Pokračovat ve sledování“')
}

// ================= MULTI-LIST (SEZNAM) =================

const DEFAULT_LIST_ID = 'default'
const defaultLists = () => [{ id: DEFAULT_LIST_ID, name: 'Můj seznam', movies: [] }]
let activeListId = DEFAULT_LIST_ID
let _listsCache = null
let _wlExplicitlyOpen = false   // keep the section visible (for list management) even when empty

function getLists() {
  if (!_listsCache) _listsCache = defaultLists()
  return _listsCache
}

async function _loadLists() {
  const profileId = getActiveProfileId()
  if (profileId === 'default') { _listsCache = defaultLists(); return }
  try {
    const res = await fetch(`/api/profiles/${profileId}/watchlists`)
    const lists = res.ok ? await res.json() : null
    _listsCache = Array.isArray(lists) && lists.length ? lists : defaultLists()
  } catch (e) {
    _listsCache = defaultLists()
  }
  if (!getListById(activeListId)) activeListId = DEFAULT_LIST_ID
}

function saveLists(lists) {
  _listsCache = lists
  const profileId = getActiveProfileId()
  if (profileId === 'default') { showToast('Nejprve si vyberte profil'); return }
  fetch(`/api/profiles/${profileId}/watchlists`, jsonBody('PUT', lists)).catch(() => {})
}

function getListById(id) { return getLists().find(l => l.id === id) || null }
function isInAnyList(movieId) { return getLists().some(l => l.movies.some(m => m.id === movieId)) }

// Only keep what a card needs — list entries are stored in the profile JSON.
function slimMovie(m) {
  return {
    id: m.id, title: m.title, name: m.name, poster_path: m.poster_path || null,
    vote_average: m.vote_average, release_date: m.release_date, first_air_date: m.first_air_date,
    media_type: m.media_type || (m.title ? 'movie' : 'tv')
  }
}

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
  list.movies.unshift(slimMovie(movie))
  saveLists(lists)
  return true
}

function createList(name) {
  const clean = (name || '').trim()
  if (!clean) return null
  const lists = getLists()
  if (lists.some(l => l.name.toLowerCase() === clean.toLowerCase())) {
    showToast('Seznam s tímto názvem již existuje')
    return null
  }
  const id = 'list_' + Date.now()
  lists.push({ id, name: clean, movies: [] })
  saveLists(lists)
  renderWatchlistTabs()
  showToast('Seznam „' + clean + '“ vytvořen ✓')
  return id
}

async function deleteList(listId) {
  if (listId === DEFAULT_LIST_ID) { showToast('Výchozí seznam nelze smazat'); return }
  const list = getListById(listId)
  if (!list) return
  if (!(await confirmDialog(`Smazat seznam „${list.name}“?`, 'Smazat'))) return
  saveLists(getLists().filter(l => l.id !== listId))
  if (activeListId === listId) activeListId = DEFAULT_LIST_ID
  renderWatchlist()
  if (isModalOpen(document.getElementById('wl-modal'))) renderWlModalLists()
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
  renderWatchlist()
  if (isModalOpen(document.getElementById('wl-modal'))) renderWlModalLists()
  showToast('Seznam přejmenován')
}

// Swap an element for an inline rename input; commits on Enter/blur, cancels on Escape.
function _inlineRename(targetEl, listId, rerender) {
  const list = getListById(listId)
  if (!list || !targetEl) return
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'field field-sm wl-inline-input'
  input.value = list.name
  input.maxLength = 30
  let cancelled = false
  const commit = () => {
    const val = input.value.trim()
    if (!cancelled && val && val.toLowerCase() !== list.name.toLowerCase()) renameList(listId, val)
    else rerender()
  }
  input.addEventListener('click', e => e.stopPropagation())
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    else if (e.key === 'Escape' || e.keyCode === 461) { e.preventDefault(); cancelled = true; input.blur() }
  })
  input.addEventListener('blur', commit, { once: true })
  targetEl.parentNode.replaceChild(input, targetEl)
  input.focus()
  input.select()
}

// ── Watchlist tabs ──

function renderWatchlistTabs() {
  const wrap = document.getElementById('watchlist-tabs')
  if (!wrap) return
  wrap.innerHTML = getLists().map(l => `
    <button class="wl-tab${l.id === activeListId ? ' active' : ''}${l.id !== DEFAULT_LIST_ID ? ' has-rename' : ''}" data-list="${escapeHtml(l.id)}">
      <span class="wl-tab-name">${escapeHtml(l.name)}</span>
      <span class="wl-tab-count">${l.movies.length}</span>
      ${l.id !== DEFAULT_LIST_ID ? `<span class="wl-tab-rename" data-rename="${escapeHtml(l.id)}" title="Přejmenovat"><i class="bi bi-pencil"></i></span>` : ''}
    </button>`).join('')
}

document.getElementById('watchlist-tabs').addEventListener('click', e => {
  const ren = e.target.closest('[data-rename]')
  if (ren) {
    e.stopPropagation()
    const wrap = document.getElementById('watchlist-tabs')
    wrap.innerHTML = '<span></span>'
    _inlineRename(wrap.firstChild, ren.dataset.rename, renderWatchlistTabs)
    return
  }
  const tab = e.target.closest('[data-list]')
  if (tab) { activeListId = tab.dataset.list; renderWatchlist() }
})

// ── Render watchlist ──

function renderWatchlist() {
  const lists     = getLists()
  const section   = document.getElementById('watchlist-section')
  const container = document.getElementById('watchlist-movies')
  const totalMovies = lists.reduce((sum, l) => sum + l.movies.length, 0)

  // Hide only when there's nothing AND the user hasn't explicitly opened it for list management
  if (!totalMovies && !_wlExplicitlyOpen) { section.style.display = 'none'; return }
  section.style.display = 'block'

  renderWatchlistTabs()

  const list   = getListById(activeListId)
  const movies = list ? list.movies : []

  if (!movies.length) {
    container.innerHTML = '<div class="row-empty"><i class="bi bi-bookmark"></i>&nbsp; Tento seznam je prázdný — přidejte tituly tlačítkem „Přidat“ v detailu.</div>'
    return
  }
  container.innerHTML = movies.map((m, i) => buildCard(m, { index: i, remove: 'list', removeTitle: 'Odebrat ze seznamu' })).join('')
  if (window.updateRowArrows) window.updateRowArrows(container)
}

window.removeFromCurrentList = function (movieId) {
  const lists = getLists()
  const list  = lists.find(l => l.id === activeListId)
  if (!list) return
  list.movies = list.movies.filter(m => m.id !== movieId)
  saveLists(lists)
  renderWatchlist()
  showToast('Odebráno ze seznamu')
}

// Open the watchlist section (navbar "Můj seznam"), even when it's empty.
window.openWatchlistSection = function () {
  _wlExplicitlyOpen = true
  renderWatchlist()
  const section = document.getElementById('watchlist-section')
  const top = section.getBoundingClientRect().top + window.pageYOffset - 90
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

// ── Add-to-list modal ──

let wlModalMovie = null
const wlModal = document.getElementById('wl-modal')

function openWlModal(movie) {
  if (!hasActiveProfile()) { showToast('Nejprve vyberte profil'); return }
  wlModalMovie = movie
  renderWlModalLists()
  openModal(wlModal, closeWlModal)
}

function closeWlModal() {
  closeModal(wlModal)
  wlModalMovie = null
}

function renderWlModalLists() {
  const container = document.getElementById('wl-modal-lists')
  container.innerHTML = getLists().map(l => {
    const inList = wlModalMovie ? l.movies.some(m => m.id === wlModalMovie.id) : false
    return `
      <div class="wl-list-item" tabindex="0" role="checkbox" aria-checked="${inList}" data-toggle="${escapeHtml(l.id)}">
        <div class="wl-list-item-left">
          <div class="wl-list-check${inList ? ' checked' : ''}">${inList ? '<i class="bi bi-check"></i>' : ''}</div>
          <div style="min-width:0">
            <div class="wl-list-name" data-id="${escapeHtml(l.id)}">${escapeHtml(l.name)}</div>
            <div class="wl-list-meta">${l.movies.length} ${l.movies.length === 1 ? 'položka' : (l.movies.length >= 2 && l.movies.length <= 4 ? 'položky' : 'položek')}</div>
          </div>
        </div>
        ${l.id !== DEFAULT_LIST_ID ? `<div class="wl-list-actions">
          <button class="wl-list-rename" title="Přejmenovat" data-rename-list="${escapeHtml(l.id)}"><i class="bi bi-pencil"></i></button>
          <button class="wl-list-delete" title="Smazat" data-delete-list="${escapeHtml(l.id)}"><i class="bi bi-trash"></i></button>
        </div>` : ''}
      </div>`
  }).join('')
}

document.getElementById('wl-modal-lists').addEventListener('click', e => {
  const del = e.target.closest('[data-delete-list]')
  if (del) { e.stopPropagation(); deleteList(del.dataset.deleteList); return }
  const ren = e.target.closest('[data-rename-list]')
  if (ren) {
    e.stopPropagation()
    const nameEl = document.querySelector(`#wl-modal-lists .wl-list-name[data-id="${ren.dataset.renameList}"]`)
    _inlineRename(nameEl, ren.dataset.renameList, renderWlModalLists)
    return
  }
  const item = e.target.closest('[data-toggle]')
  if (item) wlModalToggle(item.dataset.toggle)
})

function wlModalToggle(listId) {
  if (!wlModalMovie) return
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.toggle : null
  const added = toggleMovieInList(listId, wlModalMovie)
  renderWlModalLists()
  if (focusedId) {
    const again = document.querySelector(`#wl-modal-lists [data-toggle="${focusedId}"]`)
    if (again) again.focus()
  }
  renderWatchlist()
  if (window.syncDetailListButton) window.syncDetailListButton()
  if (window.syncHeroListButton) window.syncHeroListButton()
  showToast(added ? 'Přidáno do „' + getListById(listId).name + '“ ✓' : 'Odebráno ze seznamu')
}

document.getElementById('wl-new-list-btn').addEventListener('click', () => {
  const input = document.getElementById('wl-new-list-input')
  const id = createList(input.value)
  if (id) {
    input.value = ''
    if (wlModalMovie) toggleMovieInList(id, wlModalMovie)
    renderWlModalLists()
    renderWatchlist()
    if (window.syncDetailListButton) window.syncDetailListButton()
  }
})
document.getElementById('wl-new-list-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('wl-new-list-btn').click()
})

document.getElementById('clear-watchlist').addEventListener('click', async () => {
  const list = getListById(activeListId)
  if (!list || !list.movies.length) return
  if (!(await confirmDialog(`Vymazat všechny tituly ze seznamu „${list.name}“?`, 'Vymazat'))) return
  list.movies = []
  saveLists(getLists())
  renderWatchlist()
  showToast('Seznam vymazán')
})

// ── Inline "Nový seznam" in the watchlist section header ──
document.getElementById('wl-add-list-btn').addEventListener('click', () => {
  const box   = document.getElementById('wl-inline-new')
  const input = document.getElementById('wl-inline-input')
  box.classList.toggle('hidden')
  if (!box.classList.contains('hidden')) { input.value = ''; input.focus() }
})
document.getElementById('wl-inline-confirm').addEventListener('click', () => {
  const input = document.getElementById('wl-inline-input')
  const id = createList(input.value)
  if (id) { activeListId = id; renderWatchlist() }
  document.getElementById('wl-inline-new').classList.add('hidden')
  input.value = ''
})
document.getElementById('wl-inline-cancel').addEventListener('click', () => {
  document.getElementById('wl-inline-new').classList.add('hidden')
  document.getElementById('wl-inline-input').value = ''
})
document.getElementById('wl-inline-input').addEventListener('keydown', e => {
  if (e.key === 'Enter')       { e.preventDefault(); document.getElementById('wl-inline-confirm').click() }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); document.getElementById('wl-inline-cancel').click() }
})

window.reloadWatchlist = async function () {
  await _loadLists()
  renderWatchlist()
}
window.reloadContinueWatching = renderContinueWatching

document.addEventListener('DOMContentLoaded', async () => {
  if (!hasActiveProfile()) return
  await Promise.all([_loadLists(), loadProfileProgress()])
  renderContinueWatching()
  renderWatchlist()
})
