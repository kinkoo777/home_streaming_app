// ================= MOVIE CARD BUILDER =================

function buildCard(movie, extraClass = '') {
  const title     = movie.title || movie.name
  const year      = (movie.release_date || movie.first_air_date || '').slice(0, 4)
  const mediaType = movie.media_type || (movie.title ? 'movie' : 'tv')
  const inFav     = isFavorite(movie.id, mediaType)
  const watched   = typeof isWatched === 'function' && isWatched(movie.id)
  const _pEntry   = window._profileProgress ? window._profileProgress[String(movie.id)] : null
  const pSeconds  = _pEntry && typeof _pEntry === 'object' ? _pEntry.seconds  : _pEntry
  const pDuration = _pEntry && typeof _pEntry === 'object' && _pEntry.duration ? _pEntry.duration : (movie.runtime ? movie.runtime * 60 : null)
  const pct = pSeconds && pDuration
    ? Math.min(100, (parseFloat(pSeconds) / pDuration) * 100).toFixed(0)
    : null

  return `
    <div class="movie-card${extraClass ? ' ' + extraClass : ''}" onclick="openDetailModal(${movie.id},'${mediaType}',decodeURIComponent('${encodeURIComponent(title)}'))">
      <div class="movie-poster">
        <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${title}" loading="lazy">
        <div class="rating">⭐ ${(movie.vote_average || 0).toFixed(1)}</div>
        ${watched ? '<div class="watched-badge">✓ Seen</div>' : ''}
        <button class="fav-btn${inFav ? ' active' : ''}" data-tmdb-id="${movie.id}" data-media-type="${mediaType}" onclick="event.stopPropagation();favToggleCard(this,${movie.id},'${mediaType}')">
          <i class="bi ${inFav ? 'bi-heart-fill' : 'bi-heart'}"></i>
        </button>
        ${pct ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="movie-info">
        <h4>${title}</h4>
        <div class="movie-meta"><span>${year}</span><span>${mediaType === 'tv' ? 'Seriál' : 'Film'}</span></div>
      </div>
    </div>
  `
}

// ================= GRID STATE =================

const gridState = {} // { [containerId]: { allMovies, currentSort, activeGenre } }

function applyFiltersAndSort(containerId) {
  const state = gridState[containerId]
  if (!state) return
  let movies = [...state.allMovies]

  if (state.activeGenre) {
    movies = movies.filter(m => (m.genre_ids || []).includes(state.activeGenre))
  }

  if (state.currentSort === 'rating') {
    movies.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
  } else if (state.currentSort === 'year') {
    movies.sort((a, b) => {
      const ya = (b.release_date || b.first_air_date || '').slice(0, 4)
      const yb = (a.release_date || a.first_air_date || '').slice(0, 4)
      return ya.localeCompare(yb)
    })
  }

  const c = document.getElementById(containerId)
  if (!c) return
  const prevScroll = c.scrollTop
  c.innerHTML = movies.map(m => buildCard(m)).join('')
  c.scrollTop = prevScroll
}

// containerId -> loaded-count label element id
const countElementMap = {
  'popular-movies': 'count-popular',
  'trending':       'count-trending',
  'top-rated':      'count-top-rated'
}

function updateLoadedCount(containerId) {
  const id = countElementMap[containerId]
  if (!id) return
  const el = document.getElementById(id)
  if (!el || !gridState[containerId]) return
  el.textContent = `Zobrazeno ${gridState[containerId].allMovies.length}`
}

function buildGenreFilters(containerId, movies, filtersId) {
  const counts = {}
  movies.forEach(m => (m.genre_ids || []).forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
  const genres = Object.entries(counts)
    .filter(([id]) => GENRE_NAMES[id])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const wrap = document.getElementById(filtersId)
  if (!wrap || !genres.length) return

  const activeGenre = gridState[containerId] ? gridState[containerId].activeGenre : null

  wrap.innerHTML =
    `<button class="genre-chip${!activeGenre ? ' active' : ''}" data-genre="" data-grid="${containerId}">Vše</button>` +
    genres.map(([id]) =>
      `<button class="genre-chip${activeGenre === parseInt(id) ? ' active' : ''}" data-genre="${id}" data-grid="${containerId}">${GENRE_NAMES[id]}</button>`
    ).join('')
}

// ================= MOVIE GRIDS =================

async function fetchMovies(type, containerId, page = 1, append = false) {
  if (!append) renderSkeletons(containerId)
  try {
    const res    = await fetch(`/tmdb/movies?type=${type}&page=${page}`)
    const data   = await res.json()
    const movies = data.results.filter(m => m.poster_path)

    movies.forEach(m => { searchDataMap[m.id] = m })

    if (!gridState[containerId]) gridState[containerId] = { allMovies: [], currentSort: 'default', activeGenre: null }
    if (append) {
      gridState[containerId].allMovies.push(...movies)
    } else {
      gridState[containerId].allMovies = movies
    }

    applyFiltersAndSort(containerId)

    const filtersId = {
      'popular-movies': 'genre-filters-popular',
      'trending':       'genre-filters-trending',
      'top-rated':      'genre-filters-top-rated'
    }[containerId]
    if (filtersId) buildGenreFilters(containerId, gridState[containerId].allMovies, filtersId)

    updateLoadedCount(containerId)

  } catch {
    document.getElementById(containerId).innerHTML = '<p style="color:gray;padding:20px">Nepodařilo se načíst.</p>'
  }
}

fetchMovies('popular',   'popular-movies')
fetchMovies('trending',  'trending')
fetchMovies('top_rated', 'top-rated')

// ── Sort tabs ──
document.querySelectorAll('.sort-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabs = btn.closest('.sort-tabs')
    const grid = tabs.dataset.grid
    const sort = btn.dataset.sort
    tabs.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('active'))
    btn.classList.add('active')
    if (gridState[grid]) {
      gridState[grid].currentSort = sort
      applyFiltersAndSort(grid)
    }
  })
})

// ── Genre filters (event delegation) ──
document.addEventListener('click', e => {
  const chip = e.target.closest('.genre-chip')
  if (!chip) return
  const grid  = chip.dataset.grid
  const genre = chip.dataset.genre ? parseInt(chip.dataset.genre) : null
  chip.closest('.genre-filters').querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'))
  chip.classList.add('active')
  if (gridState[grid]) {
    gridState[grid].activeGenre = genre
    applyFiltersAndSort(grid)
  }
})

// ── Load more (shared by button + auto-load) ──
const gridLoading = {} // { [containerId]: true } while a page is loading

function loadNextPage(btn) {
  if (!btn) return
  const grid = btn.dataset.grid
  if (gridLoading[grid]) return
  gridLoading[grid] = true

  const page = parseInt(btn.dataset.page) + 1
  btn.dataset.page = page

  const original = btn.innerHTML
  btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Načítání...'
  btn.disabled = true

  return fetchMovies(btn.dataset.type, grid, page, true)
    .finally(() => {
      btn.innerHTML = original
      btn.disabled = false
      gridLoading[grid] = false
    })
}

document.querySelectorAll('.load-more-btn').forEach(btn => {
  btn.addEventListener('click', () => { loadNextPage(btn) })
})

// ── Auto-load on scroll (infinite scroll inside each category grid) ──
const SCROLL_THRESHOLD = 120
;['popular-movies', 'trending', 'top-rated'].forEach(containerId => {
  const grid = document.getElementById(containerId)
  if (!grid) return
  grid.addEventListener('scroll', () => {
    if (gridLoading[containerId]) return
    if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - SCROLL_THRESHOLD) {
      const btn = document.querySelector(`.load-more-btn[data-grid="${containerId}"]`)
      loadNextPage(btn)
    }
  })
})
