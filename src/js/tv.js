// ================= TV / REMOTE NAVIGATION =================
// Spatial (D-pad) navigation for LG webOS and other TV browsers, plus the
// keyboard. Arrow keys move focus to the nearest element in that direction,
// OK/Enter activates it, Back/Esc closes the top modal.
//
// body.tv  — running on a TV browser (cheaper effects, bigger focus states)
// body.kbd — the user is navigating with keys (focus rings visible); the
//            LG Magic Remote pointer or a mouse switches it off again.

;(function () {
  'use strict'

  // TV detection. Newer LG browsers can report a plain desktop-Linux user agent,
  // so besides the UA we remember a device as a TV once a TV-only remote key
  // (colour buttons, webOS Back) is pressed. ?tv=1 / ?tv=0 forces it.
  const UA = navigator.userAgent || ''
  const TV_UA = /Web0S|webOS|NetCast|SmartTV|SMART-TV|LG Browser|LGE|WebAppManager|Tizen|HbbTV|BRAVIA|VIDAA|AFTB|AFTS|AFTM|CrKey/i
  const forced = (location.search.match(/[?&]tv=([01])/) || [])[1]
  if (forced) lsSet('filmbox_tv', forced)
  const stored = lsGet('filmbox_tv', null)
  let IS_TV = stored === '1' || (stored !== '0' && (TV_UA.test(UA) || !!window.PalmSystem))
  window.IS_TV = IS_TV
  if (IS_TV) document.body.classList.add('tv', 'kbd')
  clientLog('boot', { ua: UA, tv: IS_TV, stored: stored, screen: screen.width + 'x' + screen.height,
    inner: window.innerWidth + 'x' + window.innerHeight, dpr: window.devicePixelRatio })

  // Short description of an element for the diagnostics log.
  function desc(el) {
    if (!el || el === document.body) return 'body'
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.classList && el.classList.length ? '.' + [].slice.call(el.classList, 0, 2).join('.') : '') +
      (el.dataset && el.dataset.title ? '[' + el.dataset.title.slice(0, 30) + ']' : '')
  }
  let keyLogs = 0, cursorLogs = 0

  const KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }
  const BACK_CODES = [461, 10009, 27]   // webOS Back, Tizen Back, Escape
  const TV_ONLY_KEYS = [461, 10009, 403, 404, 405, 406, 415, 19, 413, 417, 412]

  function setKbd(on) { document.body.classList.toggle('kbd', on) }

  function enableTvMode() {
    if (IS_TV) return
    IS_TV = window.IS_TV = true
    if (stored !== '0') lsSet('filmbox_tv', '1')
    document.body.classList.add('tv', 'kbd')
    addHints()
  }

  // Mouse / Magic Remote pointer → pointer mode. webOS fires cursorStateChange
  // when its pointer appears or hides — once we've seen that, trust it alone:
  // a Magic Remote reports small movements constantly just from being held,
  // which used to switch key mode off right after every arrow press.
  let cursorEvents = false
  let moveSum = 0, moveStart = 0
  document.addEventListener('mousemove', e => {
    if (cursorEvents) return
    const d = Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0)
    // Ignore the synthetic mousemove some browsers fire after scrolling.
    if (d < 2) return
    const now = Date.now()
    if (now - moveStart > 400) { moveStart = now; moveSum = 0 }
    moveSum += d
    // On a TV only a deliberate pointer movement counts, not hand tremor.
    if (moveSum >= (IS_TV ? 40 : 4)) setKbd(false)
  }, { passive: true })
  document.addEventListener('cursorStateChange', e => {
    cursorEvents = true
    if (cursorLogs++ < 10) clientLog('cursor', { visible: e.detail && e.detail.visibility })
    if (e.detail && typeof e.detail.visibility === 'boolean') setKbd(!e.detail.visibility)
  })

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]):not([type="file"]), [tabindex]:not([tabindex="-1"])'

  function isVisible(el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  // Where focus is allowed to go right now.
  function scopeRoot() {
    const top = typeof topModal === 'function' ? topModal() : null
    if (top) return top
    const chooser = document.getElementById('profile-chooser')
    if (chooser && !chooser.classList.contains('hidden')) return chooser
    return document.body
  }

  function candidates(root, cur) {
    const list = root.querySelectorAll(FOCUSABLE)
    const out = []
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      if (el === cur) continue
      // Card-internal buttons (heart, remove) are for pointer users; on the
      // remote they would sit "between" cards. Detail modal has the same actions.
      if (el.classList.contains('card-btn')) continue
      if (el.getAttribute('tabindex') === '-1') continue   // explicitly pointer-only (row arrows, etc.)
      if (el.closest('.search-results:not(.active)')) continue
      if (el.closest('.hidden')) continue
      if (!isVisible(el)) continue
      out.push(el)
    }
    return out
  }

  function focusEl(el) {
    const track = el.closest('.row-track')
    if (track) track._lastFocus = el
    try { el.focus({ preventScroll: true }) } catch (e) { el.focus() }
    revealFocused(el)
  }

  // Keep the focused element on screen: rows scroll sideways, the page (or
  // the open modal) scrolls vertically so the focused row sits mid-screen.
  function revealFocused(el) {
    const track = el.closest('.row-track, .chip-row, .detail-cast')
    if (track) {
      const tr = track.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const pad = Math.max(24, tr.width * 0.06)
      if (r.left < tr.left + pad) track.scrollLeft -= (tr.left + pad - r.left)
      else if (r.right > tr.right - pad) track.scrollLeft += (r.right - (tr.right - pad))
    }

    const modal = el.closest('.sheet-modal, .overlay-modal, #profile-chooser')
    if (modal) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
    if (el.closest('.navbar')) return
    if (el.closest('.hero')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    const r = el.getBoundingClientRect()
    const navH = 90
    const target = window.pageYOffset + r.top - Math.max(navH, (window.innerHeight - r.height) / 2)
    if (r.top < navH + 10 || r.bottom > window.innerHeight - 20 || el.closest('.row-track')) {
      window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    }
  }

  function firstTarget(root) {
    if (root === document.body) {
      const heroPlay = document.getElementById('hero-play-btn')
      if (heroPlay && isVisible(heroPlay)) return heroPlay
    }
    const auto = root.querySelector('[data-autofocus]')
    if (auto && isVisible(auto)) return auto
    return candidates(root, null)[0] || null
  }

  function navigate(dir) {
    const root = scopeRoot()
    const cur = document.activeElement
    if (!cur || cur === document.body || !root.contains(cur) || !isVisible(cur)) {
      const t = firstTarget(root)
      if (t) focusEl(t)
      return !!t
    }

    const r = cur.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    let list = candidates(root, cur)

    // On the main page, Up/Down move row-to-row between cards (or the hero),
    // skipping row headers and filter chips — those are for the pointer.
    if (root === document.body && (dir === 'down' || dir === 'up') &&
        (cur.classList.contains('movie-card') || (dir === 'down' && cur.closest('.hero')))) {
      // …except sections marked data-nav-controls (Procházet), whose chips are the point.
      const cards = list.filter(el => el.classList.contains('movie-card') || !el.closest('.row-section') || el.closest('[data-nav-controls]'))
      if (cards.length) list = cards
    }

    let best = null
    let bestScore = Infinity
    for (let i = 0; i < list.length; i++) {
      const el = list[i]
      const b = el.getBoundingClientRect()
      const bx = b.left + b.width / 2
      const by = b.top + b.height / 2
      let primary, orth, overlap
      if (dir === 'left' || dir === 'right') {
        if (dir === 'right' ? (bx <= cx + 1 || b.right <= r.right - 2) : (bx >= cx - 1 || b.left >= r.left + 2)) continue
        primary = dir === 'right' ? Math.max(0, b.left - r.right) : Math.max(0, r.left - b.right)
        overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)
        if (overlap <= 0) continue          // Left/Right never leave the current row
        orth = overlap > Math.min(r.height, b.height) * 0.3 ? 0 : Math.abs(by - cy)
      } else {
        if (dir === 'down' ? (by <= cy + 1 || b.bottom <= r.bottom - 2) : (by >= cy - 1 || b.top >= r.top + 2)) continue
        primary = dir === 'down' ? Math.max(0, b.top - r.bottom) : Math.max(0, r.top - b.bottom)
        overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left)
        orth = overlap > 0 ? 0 : Math.abs(bx - cx)
      }
      const score = primary + orth * 2.2
      if (score < bestScore) { bestScore = score; best = el }
    }
    // Coming back into a row (Up/Down) → the card you were on last time.
    if (best && (dir === 'up' || dir === 'down')) {
      const track = best.closest('.row-track')
      const last = track && track._lastFocus
      if (last && last !== best && track !== cur.closest('.row-track') && document.body.contains(last) && isVisible(last)) best = last
    }
    if (best) { focusEl(best); return true }
    return false
  }
  window.tvNavigate = navigate
  window.tvFocus = focusEl

  function isTextInput(el) {
    return el && el.tagName === 'INPUT' && /^(text|search|password|number|email|url|tel)$/i.test(el.type || 'text')
  }

  document.addEventListener('keydown', e => {
    if (keyLogs < 40) {
      keyLogs++
      clientLog('key', { key: e.key, code: e.keyCode, prevented: e.defaultPrevented, active: desc(document.activeElement),
        kbd: document.body.classList.contains('kbd'), tv: IS_TV })
    }
    if (e.defaultPrevented) return
    const intro = document.getElementById('intro-screen')
    if (intro && intro.style.display !== 'none') return

    const code = e.keyCode
    const dir = KEYS[code]
    const target = e.target
    if (TV_ONLY_KEYS.indexOf(code) >= 0) enableTvMode()

    if (e.key === 'Tab') { setKbd(true); return }

    if (dir) {
      // In a text field, Left/Right move the caret; only leave the field at its edges.
      if (isTextInput(target)) {
        const atStart = target.selectionStart === 0 && target.selectionEnd === 0
        const atEnd = target.selectionStart === target.value.length
        if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return
      }
      setKbd(true)
      const moved = navigate(dir)
      if (keyLogs <= 40) clientLog('nav', { dir: dir, moved: !!moved, active: desc(document.activeElement), scope: desc(scopeRoot()) })
      if (moved) e.preventDefault()
      return
    }

    // OK / Enter on a non-native control (cards, cast, episodes) → click it.
    if (code === 13 && target && target !== document.body && target.hasAttribute('tabindex') &&
        target.tagName !== 'BUTTON' && target.tagName !== 'A' && target.tagName !== 'INPUT') {
      e.preventDefault()
      target.click()
      return
    }

    // Back / Esc
    const isBack = BACK_CODES.indexOf(code) >= 0 || e.key === 'GoBack' || e.key === 'BrowserBack' ||
      (code === 8 && !isTextInput(target))
    if (isBack) {
      if (typeof closeTopModal === 'function' && closeTopModal()) { e.preventDefault(); return }
      if (typeof window.closeSearchUI === 'function' && window.closeSearchUI()) { e.preventDefault(); return }
      // On the main page: Back returns to the top instead of leaving the app.
      if (code !== 27 && window.pageYOffset > 100) {
        e.preventDefault()
        const t = firstTarget(document.body)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        if (t) try { t.focus({ preventScroll: true }) } catch (err) { t.focus() }
      }
    }
  })

  // ── Colour buttons (webOS / Tizen remotes): quick actions on the main page ──
  const COLOR_KEYS = {
    403: () => {                                   // red → search
      const input = document.getElementById('search-input')
      const btn = document.getElementById('search-mobile-btn')
      if (btn && getComputedStyle(btn).display !== 'none') document.getElementById('search-wrapper').classList.add('mobile-open')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      input.focus()
    },
    404: () => {                                   // green → my list
      window.openWatchlistSection()
      setTimeout(() => {
        const card = document.querySelector('#watchlist-movies .movie-card') || document.getElementById('wl-add-list-btn')
        if (card) focusEl(card)
      }, 350)
    },
    405: () => window.openSettings(),              // yellow → settings
    406: () => window.showProfileChooser()         // blue → switch profile
  }
  document.addEventListener('keydown', e => {
    const action = COLOR_KEYS[e.keyCode]
    if (!action || e.defaultPrevented) return
    const chooser = document.getElementById('profile-chooser')
    if (chooser && !chooser.classList.contains('hidden')) return
    if (typeof topModal === 'function' && topModal()) return
    e.preventDefault()
    setKbd(true)
    action()
  })

  function addHints() {
    if (document.querySelector('.tv-hints')) return
    const hints = document.createElement('div')
    hints.className = 'tv-hints'
    hints.setAttribute('aria-hidden', 'true')
    hints.innerHTML =
      '<span><b>OK</b>Vybrat</span><span><b>↩</b>Zpět</span>' +
      '<span><i class="key red"></i>Hledat</span><span><i class="key green"></i>Můj seznam</span>' +
      '<span><i class="key yellow"></i>Nastavení</span><span><i class="key blue"></i>Profil</span>'
    document.body.appendChild(hints)
  }
  if (IS_TV) addHints()

  // Give TV users a starting focus once the page is ready.
  window.tvFocusStart = function () {
    if (!document.body.classList.contains('kbd')) return
    const root = scopeRoot()
    const t = firstTarget(root)
    if (t) focusEl(t)
  }
})()
