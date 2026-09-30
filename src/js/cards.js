// ================= MOVIE CARD =================
// One builder for every card on the page. Cards carry their data in
// data-attributes and are handled by a single delegated click listener, so
// titles with quotes/apostrophes ("Ocean's Eleven") can't break anything.
//
// opts: { index, variant: 'continue', remove: 'continue'|'list'|'watched',
//         removeTitle, note, hideWatchedBadge }

function buildCard(movie, opts) {
  opts = opts || {}
  const title      = movie.title || movie.name || ''
  const safeTitle  = escapeHtml(title)
  const year       = (movie.release_date || movie.first_air_date || '').slice(0, 4)
  const mediaType  = movie.media_type || (movie.title ? 'movie' : 'tv')
  const isContinue = opts.variant === 'continue'
  const inFav      = isFavorite(movie.id, mediaType)
  const watched    = !opts.hideWatchedBadge && !isContinue && isWatched(movie.id, mediaType)
  const rating     = movie.vote_average ? Number(movie.vote_average) : 0

  // Continue-Watching cards pass an explicit position because their progress
  // can be keyed per-episode, not by the show's tmdbId.
  let pct = null
  let remainMin = null
  if (isContinue) {
    const dur = movie._duration || (movie.runtime ? movie.runtime * 60 : null)
    if (movie._seconds && dur) {
      pct = Math.min(100, (movie._seconds / dur) * 100)
      if (dur > movie._seconds) remainMin = Math.round((dur - movie._seconds) / 60)
    }
  }
  const badgeText = isContinue
    ? [movie._episodeLabel, remainMin != null ? 'Zbývá ' + remainMin + ' min' : null].filter(Boolean).join(' · ')
    : ''

  let removeBtn = ''
  if (opts.remove) {
    removeBtn = `<button class="card-btn remove-btn" data-action="remove-${opts.remove}" title="${escapeHtml(opts.removeTitle || 'Odebrat')}" aria-label="${escapeHtml(opts.removeTitle || 'Odebrat')}"><i class="bi bi-x-lg"></i></button>`
  }
  const favBtn = isContinue ? '' :
    `<button class="card-btn fav-btn${inFav ? ' active' : ''}" data-action="fav" data-id="${movie.id}" data-type="${mediaType}" title="Oblíbené" aria-label="Oblíbené"><i class="bi ${inFav ? 'bi-heart-fill' : 'bi-heart'}"></i></button>`

  const delay = opts.index != null ? ` style="-webkit-animation-delay:${Math.min(opts.index, 12) * 35}ms;animation-delay:${Math.min(opts.index, 12) * 35}ms"` : ''
  const poster = movie.poster_path
    ? `<img src="${tmdbImg(movie.poster_path, 'w342')}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : ''

  return `
    <div class="movie-card${isContinue ? ' continue-card' : ''}" tabindex="0" role="button"
         data-id="${movie.id}" data-type="${mediaType}" data-title="${safeTitle}"
         ${isContinue ? `data-play="1" data-key="${escapeHtml(movie._key)}" data-poster="${escapeHtml(movie.poster_path || '')}" data-ep="${escapeHtml(movie._episodeLabel || '')}"` : ''}
         aria-label="${safeTitle}"${delay}>
      <div class="movie-poster">
        <div class="poster-fallback">${safeTitle}</div>
        ${poster}
        <div class="card-overlay"><span class="card-play"><i class="bi bi-play-fill"></i></span></div>
        ${rating ? `<div class="rating${rating >= 8 ? ' high' : ''}"><i class="bi bi-star-fill"></i>${rating.toFixed(1)}</div>` : ''}
        ${watched ? '<div class="watched-badge" title="Zhlédnuto"><i class="bi bi-check-lg"></i></div>' : ''}
        ${badgeText ? `<div class="remaining-badge">${escapeHtml(badgeText)}</div>` : ''}
        ${pct != null ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div>` : ''}
        ${removeBtn}
        ${favBtn}
      </div>
      <div class="movie-info">
        <h4>${safeTitle}</h4>
        <div class="movie-meta">${year ? `<span>${year}</span>` : ''}<span>${mediaType === 'tv' ? 'Seriál' : 'Film'}</span>${opts.note ? `<span>${escapeHtml(opts.note)}</span>` : ''}</div>
      </div>
    </div>`
}

// ── One click handler for every card ──
document.addEventListener('click', e => {
  const actionBtn = e.target.closest('[data-action]')
  const card = e.target.closest('.movie-card')
  if (!card || card.classList.contains('skeleton-card')) return
  const id   = parseInt(card.dataset.id, 10)
  const type = card.dataset.type
  const title = card.dataset.title

  if (actionBtn && card.contains(actionBtn)) {
    e.stopPropagation()
    const action = actionBtn.dataset.action
    if (action === 'fav') window.favToggleCard(actionBtn, id, type)
    else if (action === 'remove-continue') window.removeFromContinue(card.dataset.key)
    else if (action === 'remove-list') window.removeFromCurrentList(id)
    else if (action === 'remove-watched') window.watchedRemoveCard(id, type)
    return
  }

  // Continue Watching cards carry "Show S01E03" titles — the detail view wants the show name.
  // (For series it opens on the right season with the next episode highlighted.)
  openDetailModal(id, type, card.dataset.play ? String(title).replace(/\s*S\d{1,2}E\d{1,3}.*$/i, '').trim() : title)
})

// ================= ROWS =================

// Left/right scroll buttons for pointer users (hidden on TV and touch).
function initRow(row) {
  if (row._init) return
  row._init = true
  const track = row.querySelector('.row-track')
  if (!track) return
  const mk = dir => {
    const b = document.createElement('button')
    b.className = 'row-arrow ' + dir + ' off'
    b.tabIndex = -1
    b.setAttribute('aria-label', dir === 'left' ? 'Posunout doleva' : 'Posunout doprava')
    b.innerHTML = `<i class="bi bi-chevron-${dir}"></i>`
    b.addEventListener('click', () => {
      const delta = track.clientWidth * 0.85 * (dir === 'left' ? -1 : 1)
      if (track.scrollBy) track.scrollBy({ left: delta, behavior: 'smooth' })
      else track.scrollLeft += delta
    })
    row.appendChild(b)
    return b
  }
  row._left = mk('left')
  row._right = mk('right')
  track.addEventListener('scroll', () => updateRowArrows(track), { passive: true })
}

function updateRowArrows(track) {
  const row = track && track.parentNode
  if (!row || !row._left) return
  row._left.classList.toggle('off', track.scrollLeft < 10)
  row._right.classList.toggle('off', track.scrollLeft + track.clientWidth >= track.scrollWidth - 10)
}
window.updateRowArrows = updateRowArrows

document.querySelectorAll('[data-row]').forEach(initRow)
window.addEventListener('resize', () => document.querySelectorAll('.row-track').forEach(updateRowArrows))

// ================= CATALOG ROWS =================

const gridState = {}     // { [containerId]: { allMovies, currentSort, activeGenre, page, done } }
const gridLoading = {}

const FILTER_IDS = {
  'popular-movies': 'genre-filters-popular',
  'trending':       'genre-filters-trending',
  'top-rated':      'genre-filters-top-rated'
}
const COUNT_IDS = {
  'popular-movies': 'count-popular',
  'trending':       'count-trending',
  'top-rated':      'count-top-rated'
}

function visibleMovies(state) {
  let movies = state.allMovies.slice()
  if (state.activeGenre) movies = movies.filter(m => (m.genre_ids || []).indexOf(state.activeGenre) >= 0)
  if (state.currentSort === 'rating') {
    movies.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
  } else if (state.currentSort === 'year') {
    const y = m => (m.release_date || m.first_air_date || '')
    movies.sort((a, b) => y(b).localeCompare(y(a)))
  }
  return movies
}

// Full re-render (sort / filter change). Keeps focus on the same title if it survives.
function renderCatalog(containerId) {
  const state = gridState[containerId]
  const c = document.getElementById(containerId)
  if (!state || !c) return
  const focusedId = document.activeElement && c.contains(document.activeElement) ? document.activeElement.dataset.id : null
  const movies = visibleMovies(state)
  c.innerHTML = movies.length
    ? movies.map((m, i) => buildCard(m, { index: i })).join('')
    : '<div class="row-empty">V tomto žánru zatím nic není — zkuste načíst další tituly posunutím doprava.</div>'
  c.scrollLeft = 0
  if (focusedId) {
    const again = c.querySelector(`.movie-card[data-id="${focusedId}"]`)
    if (again) again.focus({ preventScroll: true })
  }
  updateRowArrows(c)
}

function buildGenreFilters(containerId) {
  const state = gridState[containerId]
  const wrap = document.getElementById(FILTER_IDS[containerId])
  if (!wrap || !state) return
  const counts = {}
  state.allMovies.forEach(m => (m.genre_ids || []).forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
  const genres = Object.keys(counts)
    .filter(id => GENRE_NAMES[id])
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 10)
  if (!genres.length) return
  wrap.innerHTML =
    `<button class="genre-chip${!state.activeGenre ? ' active' : ''}" data-genre="" data-grid="${containerId}">Vše</button>` +
    genres.map(id =>
      `<button class="genre-chip${state.activeGenre === parseInt(id, 10) ? ' active' : ''}" data-genre="${id}" data-grid="${containerId}">${GENRE_NAMES[id]}</button>`
    ).join('')
}

async function fetchMovies(containerId, page, append) {
  const c = document.getElementById(containerId)
  if (!c) return
  const type = c.dataset.type
  if (!append) c.innerHTML = renderSkeletonsHTML(10)
  let loader = null
  if (append) {
    loader = document.createElement('div')
    loader.className = 'row-loader'
    loader.innerHTML = '<i class="bi bi-arrow-repeat"></i>'
    c.appendChild(loader)
  }
  try {
    const res  = await fetch(`/tmdb/movies?type=${type}&page=${page}`)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    const known = gridState[containerId] ? gridState[containerId].allMovies : []
    const seen = {}
    known.forEach(m => { seen[m.id] = true })
    const movies = (data.results || []).filter(m => m.poster_path && !seen[m.id])
    rememberMovies(movies)

    if (!gridState[containerId]) gridState[containerId] = { allMovies: [], currentSort: 'default', activeGenre: null, page: 1, done: false }
    const state = gridState[containerId]
    state.page = page
    state.done = page >= (data.total_pages || 1)

    if (loader && loader.parentNode) loader.parentNode.removeChild(loader)
    if (append) {
      state.allMovies = state.allMovies.concat(movies)
      if (state.currentSort === 'default' && !state.activeGenre) {
        // Append only the new cards so the focused card (TV remote) survives.
        c.insertAdjacentHTML('beforeend', movies.map((m, i) => buildCard(m, { index: i })).join(''))
      } else {
        renderCatalog(containerId)
      }
    } else {
      state.allMovies = movies
      renderCatalog(containerId)
    }
    buildGenreFilters(containerId)
    const count = document.getElementById(COUNT_IDS[containerId])
    if (count) count.textContent = '· ' + state.allMovies.length + ' titulů'
    updateRowArrows(c)
  } catch (e) {
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader)
    if (!append) {
      c.innerHTML = `<div class="row-empty">Nepodařilo se načíst. <button class="btn btn-ghost btn-sm" data-retry="${containerId}">Zkusit znovu</button></div>`
    }
  }
}

function loadNextPage(containerId) {
  const state = gridState[containerId]
  if (!state || state.done || gridLoading[containerId]) return
  gridLoading[containerId] = true
  fetchMovies(containerId, state.page + 1, true).then(() => { gridLoading[containerId] = false })
}

Object.keys(FILTER_IDS).forEach(containerId => {
  fetchMovies(containerId, 1, false)
  const track = document.getElementById(containerId)
  // Infinite scroll sideways: fetch the next page as the end comes into view.
  track.addEventListener('scroll', () => {
    if (track.scrollLeft + track.clientWidth >= track.scrollWidth - track.clientWidth * 0.6) loadNextPage(containerId)
  }, { passive: true })
})

document.addEventListener('click', e => {
  const retry = e.target.closest('[data-retry]')
  if (retry) { fetchMovies(retry.dataset.retry, 1, false); return }

  const tab = e.target.closest('.sort-tab')
  if (tab) {
    const tabs = tab.closest('.sort-tabs')
    const grid = tabs.dataset.grid
    tabs.querySelectorAll('.sort-tab').forEach(t => t.classList.toggle('active', t === tab))
    if (gridState[grid]) { gridState[grid].currentSort = tab.dataset.sort; renderCatalog(grid) }
    return
  }

  const chip = e.target.closest('.genre-chip')
  if (chip) {
    const grid = chip.dataset.grid
    chip.parentNode.querySelectorAll('.genre-chip').forEach(c => c.classList.toggle('active', c === chip))
    if (gridState[grid]) {
      gridState[grid].activeGenre = chip.dataset.genre ? parseInt(chip.dataset.genre, 10) : null
      renderCatalog(grid)
    }
  }
})

// ── Section reveal on scroll ──
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) }
    })
  }, { rootMargin: '0px 0px -8% 0px' })
  document.querySelectorAll('.row-section, .site-footer').forEach(s => { s.classList.add('reveal'); io.observe(s) })
}
