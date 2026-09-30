// ================= FILM SERIES + WATCH GUIDES =================
// guides/guides.json (built by tools/build-guides.js) holds:
//   guides      — hand-made watch orders (release / chronological) for big franchises
//   collections — featured TMDB film series (parts in release order)
// Progress comes from the profile's watched list (+ in-progress films).

;(function () {
  'use strict'

  let dataPromise = null
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch('guides/guides.json')
        .then(r => (r.ok ? r.json() : null))
        .then(d => d || { guides: [], collections: [] })
        .catch(() => ({ guides: [], collections: [] }))
    }
    return dataPromise
  }

  const collectionCache = {}
  function loadCollection(id) {
    if (!collectionCache[id]) {
      collectionCache[id] = fetch(`/tmdb/collection?id=${id}`).then(r => r.json()).then(c => {
        const today = new Date().toISOString().slice(0, 10)
        const parts = (c.parts || []).filter(p => p.release_date && p.release_date <= today)
          .sort((a, b) => a.release_date.localeCompare(b.release_date))
        const items = {}
        parts.forEach(p => { items[p.id] = { title: p.title, year: parseInt(p.release_date.slice(0, 4), 10), poster: p.poster_path } })
        rememberMovies(parts.map(p => Object.assign({ media_type: 'movie' }, p)))
        return {
          kind: 'col', id,
          title: String(c.name || '').replace(/\s*\((kolekce|collection)\)\s*$/i, ''),
          subtitle: c.overview || '',
          backdrop: c.backdrop_path, poster: c.poster_path,
          items, orders: { release: parts.map(p => p.id) }
        }
      }).catch(err => { delete collectionCache[id]; throw err })
    }
    return collectionCache[id]
  }

  // ── Watch state of one film ──
  function filmState(id) {
    if (isWatched(id, 'movie')) return { status: 'done' }
    const p = (window._profileProgress || {})[String(id)]
    if (p && typeof p === 'object' && p.seconds > 30) {
      const pct = p.duration ? (p.seconds / p.duration) * 100 : 0
      if (pct >= 90) return { status: 'done' }
      return { status: 'partial', pct, left: p.duration ? Math.max(1, Math.round((p.duration - p.seconds) / 60)) : null }
    }
    return { status: 'none' }
  }
  const doneCount = ids => ids.filter(id => filmState(id).status === 'done').length

  // Next film in an order: a started one first, else the first unwatched.
  function nextFilm(ids) {
    const partial = ids.find(id => filmState(id).status === 'partial')
    if (partial) return { id: partial, resume: true }
    const next = ids.find(id => filmState(id).status !== 'done')
    return next ? { id: next, resume: false, first: next === ids[0] } : null
  }

  const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many

  // ================= Home row =================

  function seriesCard(key, title, poster, ids, isGuide, i) {
    const done = doneCount(ids)
    const n = ids.length
    const safe = escapeHtml(title)
    return `
      <div class="movie-card series-card" tabindex="0" role="button" data-series="${key}" aria-label="${safe}"
           style="-webkit-animation-delay:${Math.min(i, 12) * 35}ms;animation-delay:${Math.min(i, 12) * 35}ms">
        <div class="movie-poster">
          <div class="poster-fallback">${safe}</div>
          ${poster ? `<img src="${tmdbImg(poster, 'w342')}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="card-overlay"><span class="card-play"><i class="bi bi-collection-play-fill"></i></span></div>
          <div class="rating series-count"><i class="bi bi-film"></i>${n} ${plural(n, 'film', 'filmy', 'filmů')}</div>
          ${isGuide ? '<div class="type-badge">Průvodce</div>' : ''}
          ${done === n ? '<div class="watched-badge" title="Viděno vše"><i class="bi bi-check-lg"></i></div>' : ''}
          ${done && done < n ? `<div class="remaining-badge">Viděno ${done} z ${n}</div>` : ''}
          ${done ? `<div class="progress-bar"><div class="progress-fill done" style="width:${(done / n * 100).toFixed(0)}%"></div></div>` : ''}
        </div>
        <div class="movie-info">
          <h4>${safe}</h4>
          <div class="movie-meta"><span>${isGuide ? 'Pořadí sledování' : 'Filmová série'}</span></div>
        </div>
      </div>`
  }

  async function renderRow() {
    const section = document.getElementById('series-section')
    const track = document.getElementById('series-movies')
    if (!section || !track) return
    const d = await loadData()
    const cards = d.guides.map(g => ({ key: 'guide:' + g.id, title: g.title, poster: g.poster, ids: g.orders.release, guide: true }))
      .concat(d.collections.map(c => ({ key: 'col:' + c.id, title: c.name, poster: c.poster, ids: c.parts, guide: false })))
    if (!cards.length) { section.style.display = 'none'; return }
    const focused = document.activeElement && track.contains(document.activeElement) ? document.activeElement.dataset.series : null
    track.innerHTML = cards.map((c, i) => seriesCard(c.key, c.title, c.poster, c.ids, c.guide, i)).join('')
    section.style.display = 'block'
    if (focused) { const again = track.querySelector(`[data-series="${focused}"]`); if (again) again.focus({ preventScroll: true }) }
    if (window.updateRowArrows) window.updateRowArrows(track)
  }

  // Series cards aren't titles — handle them before the global card handler does.
  document.getElementById('series-movies').addEventListener('click', e => {
    const card = e.target.closest('[data-series]')
    if (!card) return
    e.stopPropagation()
    openSeries(card.dataset.series)
  })

  // ================= Guide / series sheet =================

  const modal = document.getElementById('guide-modal')
  const $g = id => document.getElementById(id)
  let current = null          // { kind, id, title, subtitle, note, backdrop, items, orders }
  let order = 'release'
  let openSeq = 0

  async function openSeries(key) {
    const seq = ++openSeq
    const [kind, rawId] = String(key).split(':')
    $g('guide-title').textContent = 'Načítání…'
    $g('guide-subtitle').textContent = ''
    $g('guide-note').textContent = ''
    $g('guide-list').innerHTML = '<div class="row-empty">Načítání…</div>'
    $g('guide-continue').style.display = 'none'
    $g('guide-order').style.display = 'none'
    const bd = $g('guide-backdrop')
    bd.classList.remove('loaded')
    bd.removeAttribute('src')
    modal.scrollTop = 0
    // Already open underneath (e.g. guide → film detail → "Průvodce" again)? Bring it to the top.
    while (isModalOpen(modal) && topModal() && topModal() !== modal) closeTopModal()
    openModal(modal, () => closeModal(modal))
    try {
      let s
      if (kind === 'guide') {
        const g = (await loadData()).guides.find(x => x.id === rawId)
        if (!g) throw new Error('Průvodce nenalezen')
        s = Object.assign({ kind: 'guide' }, g)
        rememberMovies(Object.keys(g.items).map(id => ({ id: Number(id), title: g.items[id].title, poster_path: g.items[id].poster, media_type: 'movie', release_date: String(g.items[id].year) })))
      } else {
        s = await loadCollection(Number(rawId))
      }
      if (seq !== openSeq) return
      current = s
      const saved = lsGet('filmbox_guide_order_' + s.id, null)
      order = s.orders.chrono && saved === 'chrono' ? 'chrono' : 'release'
      if (s.backdrop) { bd.onload = () => bd.classList.add('loaded'); bd.src = tmdbImg(s.backdrop, 'w1280') }
      renderSheet()
    } catch (err) {
      if (seq !== openSeq) return
      $g('guide-title').textContent = 'Nepodařilo se načíst'
      $g('guide-list').innerHTML = ''
    }
  }
  window.openSeries = openSeries

  function renderSheet() {
    const s = current
    if (!s) return
    const ids = s.orders[order] || s.orders.release
    const done = doneCount(ids)
    $g('guide-eyebrow').textContent = s.kind === 'guide' ? 'Průvodce pořadím sledování' : 'Filmová série'
    $g('guide-title').textContent = s.title
    $g('guide-subtitle').textContent = s.subtitle || ''
    $g('guide-note').textContent = order === 'chrono' && s.note ? s.note : ''
    $g('guide-progress-bar').style.width = (ids.length ? done / ids.length * 100 : 0).toFixed(0) + '%'
    $g('guide-progress-text').innerHTML = done
      ? `Viděno <b>${done} z ${ids.length}</b>`
      : `${ids.length} ${plural(ids.length, 'film', 'filmy', 'filmů')}`

    const orderEl = $g('guide-order')
    orderEl.style.display = s.orders.chrono ? '' : 'none'
    orderEl.querySelectorAll('[data-order]').forEach(b => b.classList.toggle('active', b.dataset.order === order))

    const next = nextFilm(ids)
    const btn = $g('guide-continue')
    if (next) {
      const t = s.items[next.id] ? s.items[next.id].title : ''
      btn.innerHTML = `<i class="bi bi-play-fill"></i> ${next.resume ? 'Pokračovat' : next.first ? 'Začít' : 'Další'}: ${escapeHtml(t)}`
      btn.dataset.film = next.id
      btn.style.display = ''
    } else {
      btn.style.display = 'none'
    }

    const focused = document.activeElement && modal.contains(document.activeElement) ? (document.activeElement.dataset.film || document.activeElement.dataset.markFilm) : null
    const focusedMark = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-mark-film')
    $g('guide-list').innerHTML = ids.map((id, i) => {
      const it = s.items[id] || {}
      const st = filmState(id)
      const isNext = next && next.id === id
      return `
        <div class="guide-item${st.status === 'done' ? ' watched' : ''}${isNext ? ' next-up' : ''}" role="button" tabindex="0" data-film="${id}">
          <span class="guide-num">${i + 1}</span>
          <div class="guide-poster">
            ${it.poster ? `<img src="${tmdbImg(it.poster, 'w154')}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            ${st.status === 'partial' && st.pct ? `<span class="ep-progress" style="width:${st.pct.toFixed(0)}%"></span>` : ''}
          </div>
          <div class="guide-info">
            <strong>${escapeHtml(it.title || '')}</strong>
            <span>${it.year || ''}${isNext ? ' <em class="ep-next">Další na řadě</em>' : ''}${st.status === 'partial' ? ` · ${st.left ? 'zbývá ' + st.left + ' min' : 'rozkoukáno'}` : ''}${st.status === 'done' ? ' · <b class="guide-done"><i class="bi bi-check-lg"></i> Viděno</b>' : ''}</span>
          </div>
          <button class="ep-mark${st.status === 'done' ? ' on' : ''}" data-mark-film="${id}"
                  title="${st.status === 'done' ? 'Označit jako nezhlédnuté' : 'Označit jako zhlédnuté'}" aria-label="${st.status === 'done' ? 'Označit jako nezhlédnuté' : 'Označit jako zhlédnuté'}">
            <i class="bi ${st.status === 'done' ? 'bi-check-circle-fill' : 'bi-check-circle'}"></i>
          </button>
        </div>`
    }).join('')
    if (focused) {
      const again = $g('guide-list').querySelector(focusedMark ? `[data-mark-film="${focused}"]` : `.guide-item[data-film="${focused}"]`)
      if (again) again.focus({ preventScroll: true })
    }
  }

  async function toggleFilm(id) {
    const it = current && current.items[id]
    await toggleWatched({ id, title: it ? it.title : '', media_type: 'movie', poster_path: it ? it.poster : null })
    // renderWatched() fires 'filmbox:watched', which refreshes everything.
  }

  $g('guide-order').addEventListener('click', e => {
    const b = e.target.closest('[data-order]')
    if (!b || !current) return
    order = b.dataset.order
    lsSet('filmbox_guide_order_' + current.id, order)
    renderSheet()
  })
  $g('guide-continue').addEventListener('click', e => {
    const id = Number(e.currentTarget.dataset.film)
    const it = current && current.items[id]
    if (id) openDetailModal(id, 'movie', it ? it.title : '')
  })
  $g('guide-list').addEventListener('click', e => {
    const mark = e.target.closest('[data-mark-film]')
    if (mark) { e.stopPropagation(); toggleFilm(Number(mark.dataset.markFilm)); return }
    const item = e.target.closest('.guide-item')
    if (item) {
      const id = Number(item.dataset.film)
      openDetailModal(id, 'movie', current && current.items[id] ? current.items[id].title : '')
    }
  })

  // ================= "Součást série" in the detail view =================

  let detailFor = null
  let detailIds = []
  async function renderDetailSeries(d) {
    const box = document.getElementById('detail-series')
    if (!box) return
    detailFor = d.id
    const data = await loadData()
    const guide = data.guides.find(g => g.items[d.id])
    const col = d.belongs_to_collection
    if (!guide && !col) return
    let s = null
    try { s = col ? await loadCollection(col.id) : null } catch (e) { s = null }
    if (detailFor !== d.id) return                           // another title opened meanwhile
    const src = s || (guide ? Object.assign({ kind: 'guide' }, guide) : null)
    if (!src) return
    const ids = src.orders.release
    detailIds = ids
    const done = doneCount(ids)
    box.innerHTML = `
      <div class="series-head">
        <h4 class="block-title">Součást série: ${escapeHtml(src.title)}</h4>
        <span class="series-progress">${done ? `Viděno ${done} z ${ids.length}` : `${ids.length} ${plural(ids.length, 'film', 'filmy', 'filmů')}`}</span>
        <div class="series-buttons">
          ${s ? `<button class="btn btn-ghost btn-sm" data-open-series="col:${s.id}"><i class="bi bi-collection-play"></i> Celá série</button>` : ''}
          ${guide ? `<button class="btn btn-ghost btn-sm" data-open-series="guide:${guide.id}"><i class="bi bi-signpost-split"></i> Průvodce: ${escapeHtml(guide.title)}</button>` : ''}
        </div>
      </div>
      ${s ? `<div class="row row-compact" data-row><div class="row-track">${ids.map((id, i) => buildCard({
        id, title: s.items[id].title, poster_path: s.items[id].poster, media_type: 'movie', release_date: String(s.items[id].year)
      }, { index: i, order: i + 1, current: id === d.id })).join('')}</div></div>` : ''}`
    box.style.display = 'block'
    const track = box.querySelector('.row-track')
    if (track) {
      const cur = track.querySelector('.movie-card.current')
      if (cur) track.scrollLeft = Math.max(0, cur.offsetLeft - 40)
    }
  }
  window.renderDetailSeries = renderDetailSeries

  document.getElementById('detail-series').addEventListener('click', e => {
    const b = e.target.closest('[data-open-series]')
    if (b) { e.stopPropagation(); openSeries(b.dataset.openSeries) }
  })

  // ================= Keep everything in sync =================

  document.addEventListener('filmbox:watched', () => {
    renderRow()
    if (current && isModalOpen(modal)) renderSheet()
    const box = document.getElementById('detail-series')
    if (box && box.style.display !== 'none' && detailFor) {
      const prog = box.querySelector('.series-progress')
      const done = doneCount(detailIds)
      if (prog) prog.textContent = done ? `Viděno ${done} z ${detailIds.length}` : `${detailIds.length} ${plural(detailIds.length, 'film', 'filmy', 'filmů')}`
      box.querySelectorAll('.movie-card').forEach(card => {
        const done = filmState(Number(card.dataset.id)).status === 'done'
        const poster = card.querySelector('.movie-poster')
        let badge = poster.querySelector('.watched-badge')
        if (done && !badge) poster.insertAdjacentHTML('beforeend', '<div class="watched-badge" title="Zhlédnuto"><i class="bi bi-check-lg"></i></div>')
        else if (!done && badge) badge.parentNode.removeChild(badge)
      })
    }
  })

  // The row needs the watched list; build it once the page has loaded it.
  document.addEventListener('DOMContentLoaded', () => { setTimeout(renderRow, hasActiveProfile() ? 1200 : 0) })
})()
