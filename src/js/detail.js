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
      detailModal._seasonCounts = {}
      seasons.forEach(se => { detailModal._seasonCounts[se.season_number] = se.episode_count || 0 })
      // Open the season with the most recently watched episode, else the first.
      let startSeason = nums[0]
      let latest = ''
      const progress = window._profileProgress || {}
      Object.keys(progress).forEach(k => {
        const m = new RegExp('^' + id + ':S(\\d+)E').exec(k)
        const v = progress[k]
        if (m && v && (v.updatedAt || '') >= latest && nums.indexOf(parseInt(m[1], 10)) >= 0) { latest = v.updatedAt || ''; startSeason = parseInt(m[1], 10) }
      })
      renderSeasonTabs(id)
      loadSeason(id, startSeason, movieTitle, d.poster_path || null)
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

// ── Episode watch state (from the profile's progress map) ──
// Keys are "tvId:S02E03". Finished = flagged by the player / marked by hand,
// or watched past 90 %.
function episodeKey(tvId, s, e) {
  return `${tvId}:S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
}
function episodeState(tvId, s, e) {
  const p = (window._profileProgress || {})[episodeKey(tvId, s, e)]
  if (!p || typeof p !== 'object') return { status: 'none', pct: 0 }
  const pct = p.duration ? Math.min(100, (p.seconds / p.duration) * 100) : 0
  if (p.finished || pct >= 90) return { status: 'done', pct: 100 }
  if (pct > 0 || p.seconds > 30) return { status: 'partial', pct, left: p.duration ? Math.max(1, Math.round((p.duration - p.seconds) / 60)) : null, at: p.updatedAt || '' }
  return { status: 'none', pct: 0 }
}
function seasonWatchedCount(tvId, s) {
  const prefix = `${tvId}:S${String(s).padStart(2, '0')}E`
  const progress = window._profileProgress || {}
  return Object.keys(progress).filter(k => k.indexOf(prefix) === 0)
    .filter(k => { const e = parseInt(k.slice(prefix.length), 10); return episodeState(tvId, s, e).status === 'done' }).length
}

// Season tabs: "2. řada ✓" when every episode is watched, "3/10" when started.
function renderSeasonTabs(tvId) {
  const counts = detailModal._seasonCounts || {}
  document.querySelectorAll('.season-tab').forEach(t => {
    const n = parseInt(t.dataset.season, 10)
    const total = counts[n] || 0
    const done = seasonWatchedCount(tvId, n)
    const mark = total && done >= total ? ' <i class="bi bi-check-circle-fill" style="color:var(--good);margin-left:6px"></i>'
      : done ? ` <span style="opacity:.6;margin-left:6px">${done}/${total || '?'}</span>` : ''
    t.innerHTML = `${n}. řada${mark}`
  })
}

async function loadSeason(tvId, seasonNum, showTitle, showPoster) {
  const list = $d('episodes-list')
  if (!list) return
  list.innerHTML = '<div class="row-empty">Načítání epizod…</div>'
  document.querySelectorAll('.season-tab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.season, 10) === seasonNum))
  list.dataset.show = showTitle || ''
  list.dataset.poster = showPoster || ''
  list.dataset.tv = tvId
  list.dataset.season = seasonNum

  try {
    const res  = await fetch(`/tmdb/season?id=${tvId}&season=${seasonNum}`)
    const data = await res.json()
    const eps  = data.episodes || []
    if (parseInt(list.dataset.season, 10) !== seasonNum) return      // another season was picked meanwhile
    if (!eps.length) { list.innerHTML = '<div class="row-empty">Epizody nejsou k dispozici.</div>'; return }
    list._episodes = eps
    renderEpisodes(tvId, seasonNum)
  } catch (e) {
    list.innerHTML = '<div class="row-empty">Nepodařilo se načíst epizody.</div>'
  }
}

function renderEpisodes(tvId, seasonNum) {
  const list = $d('episodes-list')
  const eps = list._episodes || []
  const sNum = String(seasonNum).padStart(2, '0')
  const states = eps.map(ep => episodeState(tvId, seasonNum, ep.episode_number))
  const done = states.filter(st => st.status === 'done').length

  // Next up: the most recently started unfinished episode, else the first one
  // after the last finished episode (or the first episode).
  let next = -1
  let latest = ''
  states.forEach((st, i) => { if (st.status === 'partial' && st.at >= latest) { latest = st.at; next = i } })
  if (next < 0) {
    let last = -1
    states.forEach((st, i) => { if (st.status === 'done') last = i })
    next = last + 1 < eps.length ? last + 1 : -1
  }

  const focusedEp = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.episode : null
  const focusedMark = document.activeElement && document.activeElement.classList.contains('ep-mark')

  const summary = `
    <div class="season-summary">
      <div class="season-summary-bar"><span style="width:${eps.length ? (done / eps.length * 100).toFixed(0) : 0}%"></span></div>
      <span>${done ? `Zhlédnuto <b>${done} z ${eps.length}</b>` : `${eps.length} ${eps.length >= 5 ? 'epizod' : 'epizody'}`}</span>
      ${next >= 0 ? `<button class="btn btn-primary btn-sm" data-play-episode="${eps[next].episode_number}"><i class="bi bi-play-fill"></i> ${states[next].status === 'partial' ? 'Pokračovat' : done ? 'Další' : 'Přehrát'} S${sNum}E${String(eps[next].episode_number).padStart(2, '0')}</button>` : done === eps.length ? '<span class="season-done"><i class="bi bi-check-circle-fill"></i> Řada zhlédnuta</span>' : ''}
    </div>`

  list.innerHTML = summary + eps.map((ep, i) => {
    const eNum = String(ep.episode_number).padStart(2, '0')
    const st = states[i]
    const cls = st.status === 'done' ? ' watched' : ''
    return `
      <div class="episode-item${cls}${i === next ? ' next-up' : ''}" role="button" tabindex="0" data-season="${seasonNum}" data-episode="${ep.episode_number}">
        <div class="episode-thumb">
          ${ep.still_path ? `<img src="${tmdbImg(ep.still_path, 'w300')}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          <span class="ep-play"><i class="bi bi-play-circle-fill"></i></span>
          ${st.status === 'done' ? '<span class="ep-status done"><i class="bi bi-check-lg"></i> Zhlédnuto</span>' : ''}
          ${st.status === 'partial' ? `<span class="ep-status partial">${st.left ? 'Zbývá ' + st.left + ' min' : 'Rozkoukáno'}</span>` : ''}
          ${st.pct ? `<span class="ep-progress${st.status === 'done' ? ' done' : ''}" style="width:${st.pct.toFixed(0)}%"></span>` : ''}
        </div>
        <div class="episode-info">
          <div class="episode-num">S${sNum}E${eNum}${i === next ? ' <span class="ep-next">Další na řadě</span>' : ''}</div>
          <strong>${escapeHtml(ep.name || 'Epizoda ' + ep.episode_number)}</strong>
          <span>${escapeHtml(ep.overview || '')}</span>
        </div>
        ${ep.runtime ? `<span class="episode-runtime">${ep.runtime} min</span>` : ''}
        <button class="ep-mark${st.status === 'done' ? ' on' : ''}" data-mark="${ep.episode_number}" data-runtime="${ep.runtime || ''}"
                title="${st.status === 'done' ? 'Označit jako nezhlédnuté' : 'Označit jako zhlédnuté'}" aria-label="${st.status === 'done' ? 'Označit jako nezhlédnuté' : 'Označit jako zhlédnuté'}">
          <i class="bi ${st.status === 'done' ? 'bi-check-circle-fill' : 'bi-check-circle'}"></i>
        </button>
      </div>`
  }).join('')
  renderSeasonTabs(tvId)

  if (focusedEp) {
    const again = list.querySelector(focusedMark ? `.ep-mark[data-mark="${focusedEp}"]` : `.episode-item[data-episode="${focusedEp}"]`)
    if (again) again.focus({ preventScroll: true })
  }
}

// Mark / unmark one episode as watched (stored in the profile's progress map).
async function toggleEpisodeWatched(tvId, seasonNum, epNum, runtime) {
  const pid = getActiveProfileId()
  if (pid === 'default') { showToast('Nejprve vyberte profil'); return }
  const key = episodeKey(tvId, seasonNum, epNum)
  const url = `/api/profiles/${pid}/progress/${encodeURIComponent(key)}`
  const wasDone = episodeState(tvId, seasonNum, epNum).status === 'done'
  const list = $d('episodes-list')
  try {
    if (wasDone) {
      const r = await fetch(url, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      delete window._profileProgress[key]
    } else {
      const secs = (parseInt(runtime, 10) || 45) * 60
      const label = key.split(':')[1]
      const entry = {
        seconds: secs, duration: secs, finished: true, mediaType: 'tv', tmdbId: tvId, episodeLabel: label,
        title: `${list.dataset.show} ${label}`, posterPath: list.dataset.poster || null
      }
      const r = await fetch(url, jsonBody('PUT', entry))
      if (!r.ok) throw new Error()
      window._profileProgress[key] = Object.assign({ updatedAt: new Date().toISOString() }, entry)
    }
    renderEpisodes(tvId, seasonNum)
    if (window.reloadContinueWatching) window.reloadContinueWatching()
    showToast(wasDone ? 'Epizoda označena jako nezhlédnutá' : 'Epizoda označena jako zhlédnutá ✓')
  } catch (e) {
    showToast('Nepodařilo se uložit')
  }
}

detailModal.addEventListener('click', e => {
  const tab = e.target.closest('.season-tab')
  if (tab) {
    const list = $d('episodes-list')
    loadSeason(parseInt(tab.dataset.id, 10), parseInt(tab.dataset.season, 10), list ? list.dataset.show : '', list ? list.dataset.poster : null)
    return
  }
  const list = $d('episodes-list')
  const mark = e.target.closest('[data-mark]')
  if (mark && list) {
    e.stopPropagation()
    toggleEpisodeWatched(parseInt(list.dataset.tv, 10), parseInt(list.dataset.season, 10), parseInt(mark.dataset.mark, 10), mark.dataset.runtime)
    return
  }
  const playBtn = e.target.closest('[data-play-episode]')
  const ep = playBtn || e.target.closest('.episode-item')
  if (ep && list) {
    const s = parseInt(list.dataset.season, 10)
    const n = parseInt(playBtn ? playBtn.dataset.playEpisode : ep.dataset.episode, 10)
    const query = `${list.dataset.show} S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`
    openPrehrajSearch(query, parseInt(list.dataset.tv, 10), 'tv', list.dataset.poster || null, { season: s, number: n })
    return
  }
  const actor = e.target.closest('[data-actor]')
  if (actor) openActorModal(parseInt(actor.dataset.actor, 10))
})
