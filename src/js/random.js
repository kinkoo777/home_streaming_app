// ================= "CO PUSTIT?" — RANDOM PICK =================
// One random title from the profile's lists and/or its recommendations, filtered by
// type, genre and length. Titles already watched or in progress are left out; with
// nothing to pick from (new profile) it falls back to this week's trending titles.

;(function () {
  'use strict'

  const modal = document.getElementById('random-modal')
  const result = document.getElementById('random-result')
  const genresBox = document.getElementById('random-genres')
  const filters = { from: 'all', type: 'all', length: 0, genre: null }
  let _pool = []          // [{ m: card data, d: TMDB details }]
  let _recent = []        // keys of the last picks, so "Jiný tip" doesn't repeat itself
  let _seq = 0

  const keyOf = m => (m.media_type === 'tv' ? 'tv' : 'movie') + m.id
  const typeOf = m => (m.media_type === 'tv' || (!m.title && m.name) ? 'tv' : 'movie')

  function inProgress(id, type) {
    const p = window._profileProgress || {}
    return Object.keys(p).some(k => {
      const v = p[k]
      return v && typeof v === 'object' && Number(v.tmdbId) === id && (v.mediaType || 'movie') === type && !v.finished
    })
  }

  // Candidates from the chosen source, without watched / started titles.
  async function candidates() {
    const out = {}
    const add = m => {
      if (!m || !m.id) return
      const type = typeOf(m)
      const item = Object.assign({}, m, { media_type: type })
      if (isWatched(m.id, type) || inProgress(m.id, type)) return
      out[keyOf(item)] = item
    }
    if (filters.from !== 'recommended' && typeof getLists === 'function') getLists().forEach(l => l.movies.forEach(add))
    if (filters.from !== 'list') (window._recommendedPicks || []).forEach(add)
    let list = Object.keys(out).map(k => out[k])
    if (!list.length && filters.from !== 'list') {
      try {
        const d = await (await fetch('/tmdb/movies?type=trending&page=1')).json()
        ;(d.results || []).forEach(add)
        list = Object.keys(out).map(k => out[k])
      } catch (e) {}
    }
    return list.slice(0, 60)
  }

  // Details (genres, runtime) for every candidate — cached by the server.
  async function loadPool() {
    const seq = ++_seq
    result.innerHTML = '<div class="random-loading"><div class="skeleton random-skel-poster"></div><div class="random-skel-lines"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>'
    const list = await candidates()
    const details = await Promise.all(list.map(m =>
      fetch(`/tmdb/details?id=${m.id}&type=${m.media_type}`).then(r => (r.ok ? r.json() : null)).catch(() => null)))
    if (seq !== _seq) return false
    _pool = list.map((m, i) => ({ m, d: details[i] || {} }))
    renderGenres()
    return true
  }

  function genresOf(x) {
    return (x.d.genres || []).map(g => g.name)
  }
  function runtimeOf(x) {
    return x.d.runtime || (x.d.episode_run_time && x.d.episode_run_time[0]) || null
  }

  function matching() {
    return _pool.filter(x => {
      if (filters.type !== 'all' && x.m.media_type !== filters.type) return false
      if (filters.genre && genresOf(x).indexOf(filters.genre) < 0) return false
      // Length limits films; a series episode is always shorter.
      if (filters.length && x.m.media_type === 'movie' && (!x.d.runtime || x.d.runtime > filters.length)) return false
      return true
    })
  }

  function renderGenres() {
    const counts = {}
    _pool.forEach(x => genresOf(x).forEach(g => { counts[g] = (counts[g] || 0) + 1 }))
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 12)
    if (filters.genre && names.indexOf(filters.genre) < 0) filters.genre = null
    genresBox.innerHTML = `<button class="chip${!filters.genre ? ' active' : ''}" data-genre="">Všechny žánry</button>` +
      names.map(n => `<button class="chip${filters.genre === n ? ' active' : ''}" data-genre="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')
  }

  function pick() {
    const list = matching()
    if (!list.length) {
      result.innerHTML = `<div class="random-none"><i class="bi bi-emoji-neutral"></i><p>${_pool.length ? 'S těmito filtry tu nic není — zkuste je povolit.' : 'Zatím není z čeho vybírat. Přidejte si něco do seznamu.'}</p></div>`
      return
    }
    const fresh = list.filter(x => _recent.indexOf(keyOf(x.m)) < 0)
    const from = fresh.length ? fresh : list
    const x = from[Math.floor(Math.random() * from.length)]
    _recent = [keyOf(x.m)].concat(_recent).slice(0, Math.min(5, list.length - 1))
    show(x)
  }

  function show(x) {
    const m = x.m
    const d = x.d
    const title = d.title || d.name || m.title || m.name || ''
    const year = (d.release_date || d.first_air_date || m.release_date || m.first_air_date || '').slice(0, 4)
    const rt = runtimeOf(x)
    const bits = [year, m.media_type === 'tv' ? (d.number_of_seasons ? d.number_of_seasons + (d.number_of_seasons === 1 ? ' řada' : d.number_of_seasons < 5 ? ' řady' : ' řad') : 'Seriál') : null,
      rt ? (rt >= 60 ? Math.floor(rt / 60) + ' h ' + (rt % 60) + ' min' : rt + ' min') + (m.media_type === 'tv' ? ' / díl' : '') : null].filter(Boolean)
    const rating = d.vote_average || m.vote_average
    const poster = d.poster_path || m.poster_path
    result.innerHTML = `
      <div class="random-pick">
        ${poster ? `<img class="random-poster" src="${tmdbImg(poster, 'w342')}" alt="">` : '<div class="random-poster random-noposter"><i class="bi bi-film"></i></div>'}
        <div class="random-info">
          <h4>${escapeHtml(title)}</h4>
          <p class="random-meta">${escapeHtml(bits.join(' · '))}${rating ? ` · <span class="rating-inline"><i class="bi bi-star-fill"></i> ${Number(rating).toFixed(1)}</span>` : ''}</p>
          <div class="random-genres-line">${genresOf(x).slice(0, 3).map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('')}</div>
          <p class="random-overview">${escapeHtml(d.overview || '')}</p>
          <div class="random-actions">
            <button class="btn btn-primary" id="random-play"><i class="bi bi-play-fill"></i> Přehrát</button>
            <button class="btn btn-glass" id="random-detail"><i class="bi bi-info-circle"></i> Detail</button>
            <button class="btn btn-ghost" id="random-again"><i class="bi bi-shuffle"></i> Jiný tip</button>
          </div>
        </div>
      </div>`
    rememberMovies([m])
    document.getElementById('random-play').onclick = () => {
      closeModal(modal)
      openPrehrajSearch(title, m.id, m.media_type, poster || null)
    }
    document.getElementById('random-detail').onclick = () => openDetailModal(m.id, m.media_type, title)
    document.getElementById('random-again').onclick = () => { pick(); focusAgain() }
  }

  function focusAgain() {
    if (!document.body.classList.contains('kbd')) return
    const b = document.getElementById('random-again')
    if (b) b.focus()
  }

  async function open() {
    if (!hasActiveProfile()) { showToast('Nejprve vyberte profil'); return }
    openModal(modal, () => closeModal(modal))
    if (await loadPool()) {
      pick()
      if (document.body.classList.contains('kbd')) {
        const b = document.getElementById('random-play')
        if (b) b.focus()
      }
    }
  }
  window.openRandomPick = open

  // Segmented filters
  ;[['random-from', 'from'], ['random-type', 'type'], ['random-length', 'length']].forEach(pair => {
    const box = document.getElementById(pair[0])
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-value]')
      if (!b) return
      box.querySelectorAll('[data-value]').forEach(x => x.classList.toggle('active', x === b))
      filters[pair[1]] = pair[1] === 'length' ? Number(b.dataset.value) : b.dataset.value
      if (pair[1] === 'from') { if (!(await loadPool())) return }
      pick()
    })
  })
  genresBox.addEventListener('click', e => {
    const b = e.target.closest('[data-genre]')
    if (!b) return
    filters.genre = b.dataset.genre || null
    genresBox.querySelectorAll('[data-genre]').forEach(x => x.classList.toggle('active', x === b))
    pick()
  })

  document.getElementById('random-btn').addEventListener('click', open)
})()
