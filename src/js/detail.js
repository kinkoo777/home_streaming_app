// ================= DETAIL MODAL =================

const detailModal = document.getElementById('detail-modal')
const $d = id => document.getElementById(id)

let _detailSeq = 0
let _detailMovie = null     // slim movie object for list/fav/watched actions

function closeDetailModal() {
  _detailSeq++
  closeModal(detailModal)
}

function setOn(btn, on, iconOn, iconOff, labelOn, labelOff, good) {
  btn.classList.toggle('is-on', on)
  btn.classList.toggle('good', !!good)
  const icon = `<i class="bi ${on ? iconOn : iconOff}"></i>`
  if (btn.classList.contains('btn-icon-only')) {
    btn.innerHTML = icon
    btn.title = on ? labelOn : labelOff
    btn.setAttribute('aria-label', btn.title)
  } else {
    btn.innerHTML = icon + ' ' + (on ? labelOn : labelOff)
  }
}

function syncDetailButtons() {
  const m = _detailMovie
  if (!m) return
  setOn($d('detail-fav-btn'), isFavorite(m.id, m.media_type), 'bi-heart-fill', 'bi-heart', 'V oblíbených', 'Oblíbit')
  setOn($d('detail-watched-btn'), isWatched(m.id, m.media_type), 'bi-check-circle-fill', 'bi-check-circle', 'Zhlédnuto', 'Označit jako zhlédnuté', true)
  setOn($d('detail-wl-btn'), isInAnyList(m.id), 'bi-bookmark-fill', 'bi-bookmark', 'V seznamu', 'Přidat')
}
window.syncDetailListButton = syncDetailButtons

window.openDetailModal = async function (id, type, title) {
  const seq = ++_detailSeq
  type = type === 'tv' ? 'tv' : 'movie'
  _detailMovie = { id, media_type: type, title }

  $d('detail-title').textContent    = title || ''
  $d('detail-overview').textContent = ''
  $d('detail-cast').innerHTML       = ''
  $d('detail-genres').innerHTML     = ''
  $d('detail-meta').textContent     = ''
  $d('detail-poster').style.display = 'none'
  detailModal.querySelector('.detail-poster-wrap').style.display = ''
  $d('detail-skeleton').style.display = 'block'
  $d('detail-cast-wrap').style.display = 'none'
  $d('detail-seasons').style.display  = 'none'
  $d('detail-similar').style.display  = 'none'
  $d('detail-seasons').innerHTML      = ''
  $d('detail-similar-grid').innerHTML = ''
  const backdrop = $d('detail-backdrop')
  backdrop.classList.remove('loaded')
  backdrop.removeAttribute('src')
  syncDetailButtons()

  detailModal.scrollTop = 0
  openModal(detailModal, closeDetailModal)

  // Actions work immediately, even before details arrive.
  $d('detail-play-btn').onclick    = () => { closeDetailModal(); openPrehrajSearch(_detailMovie.title || title, id, type, _detailMovie.poster_path || null) }
  $d('detail-trailer-btn').onclick = () => openTrailerModal(id, type)
  $d('detail-wl-btn').onclick      = () => openWlModal(_detailMovie)
  $d('detail-fav-btn').onclick     = async () => { await toggleFavorite(_detailMovie); syncDetailButtons() }
  $d('detail-watched-btn').onclick = async () => { await toggleWatched(_detailMovie); syncDetailButtons() }

  try {
    const results = await Promise.all([
      fetch(`/tmdb/details?id=${id}&type=${type}`).then(r => r.json()),
      fetch(`/tmdb/similar?id=${id}&type=${type}`).then(r => r.json()).catch(() => ({}))
    ])
    if (seq !== _detailSeq) return
    const d = results[0]
    const sim = results[1]
    if (d.error) throw new Error(d.error)

    const movieTitle = d.title || d.name || title
    _detailMovie = {
      id, title: d.title, name: d.name, poster_path: d.poster_path,
      vote_average: d.vote_average, release_date: d.release_date,
      first_air_date: d.first_air_date, media_type: type, runtime: d.runtime
    }
    rememberMovies([_detailMovie])

    if (d.backdrop_path) {
      backdrop.onload = () => backdrop.classList.add('loaded')
      backdrop.src = tmdbImg(d.backdrop_path, 'w1280')
    }
    $d('detail-skeleton').style.display = 'none'
    if (d.poster_path) {
      $d('detail-poster').src = tmdbImg(d.poster_path, 'w342')
      $d('detail-poster').style.display = 'block'
    } else {
      detailModal.querySelector('.detail-poster-wrap').style.display = 'none'
    }

    $d('detail-title').textContent    = movieTitle
    $d('detail-overview').textContent = d.overview || 'Popis není dostupný.'

    const bits = []
    const year = (d.release_date || d.first_air_date || '').slice(0, 4)
    if (year) bits.push(escapeHtml(year))
    if (d.runtime) bits.push(Math.floor(d.runtime / 60) ? `${Math.floor(d.runtime / 60)} h ${d.runtime % 60} min` : `${d.runtime} min`)
    else if (d.number_of_seasons) bits.push(d.number_of_seasons + (d.number_of_seasons === 1 ? ' řada' : d.number_of_seasons < 5 ? ' řady' : ' řad'))
    if (d.vote_average) bits.push(`<span class="rating-inline"><i class="bi bi-star-fill"></i> ${Number(d.vote_average).toFixed(1)}</span>`)
    if (d.original_title && d.original_title !== movieTitle) bits.push(escapeHtml(d.original_title))
    $d('detail-meta').innerHTML = bits.join('  ·  ')

    $d('detail-genres').innerHTML = (d.genres || [])
      .map(g => `<span class="genre-tag">${escapeHtml(g.name)}</span>`).join('')

    const cast = d.cast || []
    if (cast.length) {
      $d('detail-cast-wrap').style.display = 'block'
      $d('detail-cast').innerHTML = cast.map(a => {
        const name = escapeHtml(a.name)
        return `
          <div class="cast-item" tabindex="0" role="button" data-actor="${a.id}" title="${name}">
            ${a.profile_path
              ? `<img src="${tmdbImg(a.profile_path, 'w185')}" alt="" loading="lazy">`
              : '<div class="cast-placeholder"><i class="bi bi-person"></i></div>'}
            <span>${name}</span>
            ${a.character ? `<small>${escapeHtml(a.character)}</small>` : ''}
          </div>`
      }).join('')
    }

    syncDetailButtons()

    // ── Seasons (TV only) ──
    if (type === 'tv' && d.number_of_seasons) {
      const seasons = (d.seasons || []).filter(s => s.season_number > 0)
      const nums = seasons.length ? seasons.map(s => s.season_number) : Array.from({ length: d.number_of_seasons }, (_, i) => i + 1)
      const el = $d('detail-seasons')
      el.style.display = 'block'
      el.innerHTML = `
        <h4 class="block-title">Epizody</h4>
        <div class="chip-row seasons-tabs">
          ${nums.map(n => `<button class="chip season-tab" data-season="${n}" data-id="${id}">${n}. řada</button>`).join('')}
        </div>
        <div id="episodes-list" class="episodes-list"></div>`
      loadSeason(id, nums[0], movieTitle, d.poster_path || null)
    }

    // ── Similar titles ──
    const simMovies = (sim.results || []).filter(m => m.poster_path).slice(0, 14)
    if (simMovies.length) {
      rememberMovies(simMovies)
      $d('detail-similar').style.display = 'block'
      const track = $d('detail-similar-grid')
      track.innerHTML = simMovies.map((m, i) => buildCard(Object.assign({ media_type: type }, m), { index: i })).join('')
      track.scrollLeft = 0
    }
  } catch (e) {
    if (seq !== _detailSeq) return
    $d('detail-skeleton').style.display = 'none'
    $d('detail-overview').textContent   = 'Nepodařilo se načíst detaily.'
  }
}

// ── Season episodes ──

async function loadSeason(tvId, seasonNum, showTitle, showPoster) {
  const list = $d('episodes-list')
  if (!list) return
  list.innerHTML = '<div class="row-empty">Načítání epizod…</div>'
  document.querySelectorAll('.season-tab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.season, 10) === seasonNum))
  list.dataset.show = showTitle || ''
  list.dataset.poster = showPoster || ''
  list.dataset.tv = tvId

  try {
    const res  = await fetch(`/tmdb/season?id=${tvId}&season=${seasonNum}`)
    const data = await res.json()
    const eps  = data.episodes || []
    const sNum = String(seasonNum).padStart(2, '0')
    const progress = window._profileProgress || {}

    if (!eps.length) { list.innerHTML = '<div class="row-empty">Epizody nejsou k dispozici.</div>'; return }

    list.innerHTML = eps.map(ep => {
      const eNum = String(ep.episode_number).padStart(2, '0')
      const p = progress[`${tvId}:S${sNum}E${eNum}`]
      const pct = p && typeof p === 'object' && p.duration ? Math.min(100, (p.seconds / p.duration) * 100) : 0
      return `
        <button class="episode-item" data-season="${seasonNum}" data-episode="${ep.episode_number}">
          <div class="episode-thumb">
            ${ep.still_path ? `<img src="${tmdbImg(ep.still_path, 'w300')}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span class="ep-play"><i class="bi bi-play-circle-fill"></i></span>
            ${pct ? `<span class="ep-progress" style="width:${pct.toFixed(0)}%"></span>` : ''}
          </div>
          <div class="episode-info">
            <div class="episode-num">S${sNum}E${eNum}</div>
            <strong>${escapeHtml(ep.name || 'Epizoda ' + ep.episode_number)}</strong>
            <span>${escapeHtml(ep.overview || '')}</span>
          </div>
          ${ep.runtime ? `<span class="episode-runtime">${ep.runtime} min</span>` : ''}
        </button>`
    }).join('')
  } catch (e) {
    list.innerHTML = '<div class="row-empty">Nepodařilo se načíst epizody.</div>'
  }
}

detailModal.addEventListener('click', e => {
  const tab = e.target.closest('.season-tab')
  if (tab) {
    const list = $d('episodes-list')
    loadSeason(parseInt(tab.dataset.id, 10), parseInt(tab.dataset.season, 10), list ? list.dataset.show : '', list ? list.dataset.poster : null)
    return
  }
  const ep = e.target.closest('.episode-item')
  if (ep) {
    const list = $d('episodes-list')
    const s = parseInt(ep.dataset.season, 10)
    const n = parseInt(ep.dataset.episode, 10)
    const query = `${list.dataset.show} S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`
    openPrehrajSearch(query, parseInt(list.dataset.tv, 10), 'tv', list.dataset.poster || null, { season: s, number: n })
    return
  }
  const actor = e.target.closest('[data-actor]')
  if (actor) openActorModal(parseInt(actor.dataset.actor, 10))
})
