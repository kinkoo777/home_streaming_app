// ================= PREVIEWS =================
// Netflix-style muted trailers while browsing:
//  - hero: after a slide has been up for 2.5 s its trailer fades in behind the text
//    (the carousel waits for it to end; 🔇/🔊 button; paused when scrolled away or a
//    window opens);
//  - cards (mouse only): hovering a card for 0.7 s pops out a bigger preview with the
//    trailer, a few facts and Přehrát / Můj seznam / Detail.
// Never on TVs, with "Omezit animace", with data saving on, or when the profile turned
// "Přehrávat ukázky při procházení" off. YouTube via its iframe postMessage protocol.

;(function () {
  'use strict'

  const HOVER_MS = 700
  const HERO_DELAY = 2500
  const canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches

  function enabled() {
    if (window.IS_TV || document.body.classList.contains('reduce-motion')) return false
    if (navigator.connection && navigator.connection.saveData) return false
    const p = typeof getActiveProfile === 'function' ? getActiveProfile() : null
    return !(p && p.settings && p.settings.previews === false)
  }

  // ── Trailer lookup (cached per title) ──
  const _keys = {}
  function trailerKey(id, type) {
    const k = type + ':' + id
    if (!_keys[k]) {
      _keys[k] = fetch(`/tmdb/videos?id=${encodeURIComponent(id)}&type=${type === 'tv' ? 'tv' : 'movie'}`)
        .then(r => r.ok ? r.json() : {})
        .then(d => { const t = pickTrailer(d.results); return t ? t.key : null })
        .catch(() => { delete _keys[k]; return null })
    }
    return _keys[k]
  }

  // ── A muted, chromeless YouTube player ──
  // cb: { playing(), ended(), failed() } — from YouTube's own state messages.
  const _players = []
  function ytPlayer(box, key, cb) {
    const f = document.createElement('iframe')
    f.className = 'yt-preview'
    f.setAttribute('allow', 'autoplay; encrypted-media')
    f.setAttribute('tabindex', '-1')
    f.setAttribute('aria-hidden', 'true')
    f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(key) +
      '?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&enablejsapi=1&origin=' +
      encodeURIComponent(location.origin)
    const p = { frame: f, cb, state: -1, done: false }
    p.send = (func, args) => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*') } catch (e) {} }
    f.addEventListener('load', () => {
      // Ask the player to report its state to us.
      const hello = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: key, channel: 'widget' }), '*') } catch (e) {} }
      hello()
      p.helloTimer = setInterval(() => { if (p.state === -1) hello(); else clearInterval(p.helloTimer) }, 400)
      // Nothing started within 8 s (blocked, region locked, no network) → give up quietly.
      p.failTimer = setTimeout(() => { if (p.state !== 1 && !p.done) { p.done = true; cb.failed && cb.failed() } }, 8000)
    })
    box.appendChild(f)
    _players.push(p)
    return p
  }
  function destroy(p) {
    if (!p) return
    p.done = true
    clearInterval(p.helloTimer)
    clearTimeout(p.failTimer)
    const i = _players.indexOf(p)
    if (i >= 0) _players.splice(i, 1)
    if (p.frame.parentNode) p.frame.parentNode.removeChild(p.frame)
  }
  window.addEventListener('message', e => {
    if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return
    const p = _players.filter(x => x.frame.contentWindow === e.source)[0]
    if (!p || p.done) return
    let d
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch (err) { return }
    if (!d) return
    const state = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number' ? d.info.playerState : null
    if (d.event === 'onError') { p.done = true; p.cb.failed && p.cb.failed(); return }
    if (state == null || state === p.state) return
    p.state = state
    if (state === 1) { clearTimeout(p.failTimer); p.cb.playing && p.cb.playing() }
    if (state === 0) { p.done = true; p.cb.ended && p.cb.ended() }
  })

  // ── Hero ──
  const hero = document.getElementById('hero')
  const heroMedia = hero && hero.querySelector('.hero-media')
  let heroBox = null, heroPlayer = null, heroTimer = null, heroSlide = null
  let heroMuted = true, heroVisible = true

  const muteBtn = document.createElement('button')
  muteBtn.className = 'btn btn-glass btn-icon-only hero-mute'
  muteBtn.type = 'button'
  muteBtn.setAttribute('aria-label', 'Zapnout zvuk ukázky')
  muteBtn.innerHTML = '<i class="bi bi-volume-mute-fill"></i>'
  if (hero) hero.appendChild(muteBtn)
  muteBtn.addEventListener('click', () => {
    heroMuted = !heroMuted
    if (heroPlayer) heroPlayer.send(heroMuted ? 'mute' : 'unMute')
    muteBtn.innerHTML = '<i class="bi ' + (heroMuted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill') + '"></i>'
    muteBtn.setAttribute('aria-label', heroMuted ? 'Zapnout zvuk ukázky' : 'Vypnout zvuk ukázky')
  })

  function stopHero() {
    clearTimeout(heroTimer)
    destroy(heroPlayer)
    heroPlayer = null
    if (heroBox) heroBox.classList.remove('show')
    hero.classList.remove('previewing')
    if (window.heroPreviewPlaying) window.heroPreviewPlaying(false)
  }
  // Called by hero.js whenever a slide shows.
  window.heroPreviewSlide = function (movie) {
    if (!hero) return
    stopHero()
    heroSlide = movie
    if (!movie || !enabled()) return
    heroTimer = setTimeout(() => {
      if (heroSlide !== movie || !heroVisible || document.body.classList.contains('modal-open')) return
      trailerKey(movie.id, movie.media_type || (movie.title ? 'movie' : 'tv')).then(key => {
        if (!key || heroSlide !== movie || !enabled()) return
        if (!heroBox) {
          heroBox = document.createElement('div')
          heroBox.className = 'hero-video'
          heroMedia.insertBefore(heroBox, heroMedia.querySelector('.hero-shade'))
        }
        heroBox.innerHTML = ''
        heroPlayer = ytPlayer(heroBox, key, {
          playing() {
            if (!heroMuted) heroPlayer.send('unMute')
            heroBox.classList.add('show')
            hero.classList.add('previewing')
            if (window.heroPreviewPlaying) window.heroPreviewPlaying(true)
          },
          ended: stopHero,
          failed: stopHero
        })
      })
    }, HERO_DELAY)
  }
  // Out of view / a window or a card pop-out open → pause; back → play on.
  function heroPauseCheck() {
    if (!heroPlayer) return
    const hold = !heroVisible || document.hidden || document.body.classList.contains('modal-open') || !!popCard
    if (heroPlayer.held === hold) return
    heroPlayer.held = hold
    heroPlayer.send(hold ? 'pauseVideo' : 'playVideo')
  }
  if (hero && window.IntersectionObserver) {
    new IntersectionObserver(entries => {
      heroVisible = entries[0].intersectionRatio > 0.35
      heroPauseCheck()
    }, { threshold: [0, 0.35, 1] }).observe(hero)
  }
  document.addEventListener('visibilitychange', heroPauseCheck)
  if (window.MutationObserver) new MutationObserver(heroPauseCheck).observe(document.body, { attributes: true, attributeFilter: ['class'] })

  // ── Card pop-out ──
  let pop = null, popCard = null, popPlayer = null, hoverTimer = null, leaveTimer = null

  function closePop() {
    clearTimeout(hoverTimer)
    clearTimeout(leaveTimer)
    destroy(popPlayer)
    popPlayer = null
    popCard = null
    if (pop) pop.classList.remove('show')
    heroPauseCheck()
  }
  window.stopPreviews = function () { closePop(); stopHero() }

  function metaLine(m, type) {
    const parts = []
    if (m && m.vote_average) parts.push('<span class="rating-pill"><i class="bi bi-star-fill"></i>' + Number(m.vote_average).toFixed(1) + '</span>')
    const year = m && (m.release_date || m.first_air_date || '').slice(0, 4)
    if (year) parts.push('<span>' + year + '</span>')
    parts.push('<span class="pop-kind">' + (type === 'tv' ? 'Seriál' : 'Film') + '</span>')
    const genres = ((m && m.genre_ids) || []).map(g => GENRE_NAMES[g]).filter(Boolean).slice(0, 3)
    if (genres.length) parts.push('<span>' + genres.map(escapeHtml).join(' · ') + '</span>')
    return parts.join('')
  }

  function openPop(card) {
    if (!enabled() || document.body.classList.contains('modal-open')) return
    const id = parseInt(card.dataset.id, 10)
    const type = card.dataset.type === 'tv' ? 'tv' : 'movie'
    const m = searchDataMap[id] || null
    const title = card.dataset.title || (m && (m.title || m.name)) || ''
    if (!pop) {
      pop = document.createElement('div')
      pop.className = 'card-pop'
      pop.setAttribute('role', 'dialog')
      document.body.appendChild(pop)
      pop.addEventListener('mouseenter', () => clearTimeout(leaveTimer))
      pop.addEventListener('mouseleave', () => { leaveTimer = setTimeout(closePop, 150) })
      pop.addEventListener('click', onPopClick)
    }
    destroy(popPlayer)
    popPlayer = null
    popCard = card
    const img = m && m.backdrop_path ? tmdbImg(m.backdrop_path, 'w780') : (m && m.poster_path ? tmdbImg(m.poster_path, 'w342') : '')
    const inList = typeof isInAnyList === 'function' && isInAnyList(id)
    pop.dataset.id = id
    pop.dataset.type = type
    pop.dataset.title = title
    pop.dataset.poster = (m && m.poster_path) || ''
    pop.innerHTML = `
      <div class="pop-media">
        ${img ? `<img src="${img}" alt="">` : '<div class="pop-noimg"></div>'}
        <div class="pop-video"></div>
        <h4 class="pop-title">${escapeHtml(title)}</h4>
      </div>
      <div class="pop-body">
        <div class="pop-buttons">
          <button class="pop-btn pop-play" data-pop="play" aria-label="Přehrát"><i class="bi bi-play-fill"></i></button>
          <button class="pop-btn" data-pop="list" aria-label="${inList ? 'V seznamu' : 'Přidat do seznamu'}" title="${inList ? 'V seznamu' : 'Přidat do seznamu'}"><i class="bi ${inList ? 'bi-check-lg' : 'bi-plus-lg'}"></i></button>
          <span class="pop-spacer"></span>
          <button class="pop-btn" data-pop="info" aria-label="Více informací" title="Více informací"><i class="bi bi-chevron-down"></i></button>
        </div>
        <div class="pop-meta">${metaLine(m, type)}</div>
        ${window.matchBadge ? window.matchBadge(m, type) : ''}
      </div>`

    // Centre it over the card, inside the window.
    const r = card.getBoundingClientRect()
    const w = Math.min(380, Math.max(300, r.width * 1.8))
    const h = w * 0.5625 + 118
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))
    const top = Math.max(70, Math.min(window.innerHeight - h - 12, r.top + r.height / 2 - h / 2))
    pop.style.width = w + 'px'
    pop.style.left = (left + window.pageXOffset) + 'px'
    pop.style.top = (top + window.pageYOffset) + 'px'
    pop.style.transformOrigin = (r.left + r.width / 2 - left) + 'px ' + (r.top + r.height / 2 - top) + 'px'
    pop.classList.remove('show')
    void pop.offsetWidth
    pop.classList.add('show')
    heroPauseCheck()

    trailerKey(id, type).then(key => {
      if (!key || popCard !== card) return
      const box = pop.querySelector('.pop-video')
      popPlayer = ytPlayer(box, key, {
        playing() { box.classList.add('show') },
        ended() { box.classList.remove('show') },
        failed() {}
      })
    })
  }

  function onPopClick(e) {
    const btn = e.target.closest('[data-pop]')
    const id = parseInt(pop.dataset.id, 10), type = pop.dataset.type, title = pop.dataset.title
    const action = btn ? btn.dataset.pop : 'info'
    if (action === 'list') {
      if (!hasActiveProfile()) { showToast('Nejprve vyberte profil'); return }
      const m = searchDataMap[id] || { id, title, poster_path: pop.dataset.poster || null }
      const added = toggleMovieInList(DEFAULT_LIST_ID, Object.assign({ media_type: type }, m))
      if (typeof renderWatchlist === 'function') renderWatchlist()
      btn.innerHTML = '<i class="bi ' + (added ? 'bi-check-lg' : 'bi-plus-lg') + '"></i>'
      showToast(added ? 'Přidáno do „Můj seznam“ ✓' : 'Odebráno z „Můj seznam“')
      return
    }
    closePop()
    if (action === 'play') openPrehrajSearch(title, id, type, pop.dataset.poster || null)
    else openDetailModal(id, type, title)
  }

  if (canHover) {
    document.addEventListener('mouseover', e => {
      const card = e.target.closest && e.target.closest('.movie-card')
      if (!card || card.classList.contains('skeleton-card') || card === popCard) return
      if (e.target.closest('[data-action]')) return
      clearTimeout(hoverTimer)
      hoverTimer = setTimeout(() => { if (card.matches(':hover')) openPop(card) }, HOVER_MS)
    })
    document.addEventListener('mouseout', e => {
      const card = e.target.closest && e.target.closest('.movie-card')
      if (!card) return
      if (e.relatedTarget && (card.contains(e.relatedTarget) || (pop && pop.contains(e.relatedTarget)))) return
      clearTimeout(hoverTimer)
      if (popCard === card) leaveTimer = setTimeout(closePop, 150)
    })
    window.addEventListener('scroll', () => { if (popCard) closePop() }, { passive: true })
    document.addEventListener('scroll', e => { if (popCard && e.target !== document && !(pop && pop.contains(e.target))) closePop() }, { passive: true, capture: true })
    window.addEventListener('resize', closePop)
    if (window.MutationObserver) new MutationObserver(() => { if (document.body.classList.contains('modal-open')) closePop() })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }
})()
