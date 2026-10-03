// ================= COMPAT (old TV engines) =================
// Installed apps on LG webOS 4.x run on Chromium 53, older than the browser.
// Fill the few gaps the app relies on; newer engines skip every block.
// Loaded before everything else on index.html and player.html.

;(function () {
  'use strict'

  function pad(s, len, fill, atStart) {
    s = String(s)
    fill = fill === undefined ? ' ' : String(fill)
    if (s.length >= len || !fill) return s
    let p = ''
    while (p.length < len - s.length) p += fill
    p = p.slice(0, len - s.length)
    return atStart ? p + s : s + p
  }
  if (!String.prototype.padStart) String.prototype.padStart = function (len, fill) { return pad(this, len, fill, true) }
  if (!String.prototype.padEnd) String.prototype.padEnd = function (len, fill) { return pad(this, len, fill, false) }

  if (!Object.values) Object.values = function (o) { return Object.keys(o).map(function (k) { return o[k] }) }
  if (!Object.entries) Object.entries = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]] }) }

  if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
    Promise.prototype.finally = function (fn) {
      return this.then(
        function (v) { return Promise.resolve(fn()).then(function () { return v }) },
        function (e) { return Promise.resolve(fn()).then(function () { throw e }) })
    }
  }

  function fragment(args) {
    const f = document.createDocumentFragment()
    for (let i = 0; i < args.length; i++) f.appendChild(args[i] instanceof Node ? args[i] : document.createTextNode(String(args[i])))
    return f
  }
  ;[Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (proto) {
    if (!proto.prepend) proto.prepend = function () { this.insertBefore(fragment(arguments), this.firstChild) }
    if (!proto.append) proto.append = function () { this.appendChild(fragment(arguments)) }
  })

  // Scroll calls with an options object ({ top, left, behavior }) need Chromium 61;
  // older engines throw "2 arguments required". Test the real call instead of guessing.
  let objectScrollOk = true
  try { window.scrollTo({ top: window.pageYOffset, left: window.pageXOffset }) } catch (e) { objectScrollOk = false }

  if (!objectScrollOk) {
    const nativeScrollTo = window.scrollTo.bind(window)
    let anim = 0
    // Smooth page scrolls are animated here (280 ms ease-out).
    const animateTo = function (x, y) {
      cancelAnimationFrame(anim)
      const sx = window.pageXOffset, sy = window.pageYOffset, t0 = Date.now(), dur = 280
      const step = function () {
        const k = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3)
        nativeScrollTo(sx + (x - sx) * e, sy + (y - sy) * e)
        if (k < 1) anim = requestAnimationFrame(step)
      }
      step()
    }
    window.scrollTo = window.scroll = function (a, b) {
      if (a && typeof a === 'object') {
        const x = a.left != null ? a.left : window.pageXOffset
        const y = a.top != null ? a.top : window.pageYOffset
        if (a.behavior === 'smooth') animateTo(x, y)
        else { cancelAnimationFrame(anim); nativeScrollTo(x, y) }
      } else {
        cancelAnimationFrame(anim)
        nativeScrollTo(a, b)
      }
    }
    window.scrollBy = function (a, b) {
      if (a && typeof a === 'object') window.scrollTo({ left: window.pageXOffset + (a.left || 0), top: window.pageYOffset + (a.top || 0), behavior: a.behavior })
      else window.scrollTo(window.pageXOffset + (a || 0), window.pageYOffset + (b || 0))
    }
  }
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function (a, b) {
      if (a && typeof a === 'object') {
        if (a.left != null) this.scrollLeft = a.left
        if (a.top != null) this.scrollTop = a.top
      } else { this.scrollLeft = a; this.scrollTop = b }
    }
  }
  if (!Element.prototype.scrollBy) {
    Element.prototype.scrollBy = function (a, b) {
      if (a && typeof a === 'object') { this.scrollLeft += a.left || 0; this.scrollTop += a.top || 0 }
      else { this.scrollLeft += a || 0; this.scrollTop += b || 0 }
    }
  }
  // scrollIntoView({ block: 'nearest' }) is Chromium 61 too; older engines read the
  // object as `true` and jump the element to the top.
  if (!objectScrollOk) {
    const nativeIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (arg) {
      if (arg && typeof arg === 'object') {
        if (arg.block === 'nearest' && this.scrollIntoViewIfNeeded) return this.scrollIntoViewIfNeeded(false)
        return nativeIntoView.call(this, arg.block !== 'end')
      }
      return nativeIntoView.apply(this, arguments)
    }
  }
})()

// ── Client diagnostics → server log (journalctl -u filmbox) ──
// Errors (script, playback) are always reported. The detailed trace (keys, focus, scrolling,
// playback) is only for chasing TV-only problems: open the app once with ?debug
// to switch it on for that device, ?debug=0 to switch it off again.
// At most 150 small events per page, sent in batches.
const CLIENT_DEBUG = (function () {
  const m = /[?&]debug(?:=([^&]*))?/.exec(location.search)
  try {
    if (m) {
      if (m[1] === '0') localStorage.removeItem('filmbox_debug')
      else localStorage.setItem('filmbox_debug', '1')
    }
    return localStorage.getItem('filmbox_debug') === '1'
  } catch (e) { return !!m && m[1] !== '0' }
})()
const _clientLogQ = []
let _clientLogN = 0, _clientLogTimer = null
function clientLog(event, data) {
  if (!CLIENT_DEBUG && !/(^|[.-])error$/.test(event)) return   // js-error, player.error…
  if (_clientLogN++ >= 150) return
  _clientLogQ.push({ t: Math.round(performance.now()), event: event, data: data || null })
  if (!_clientLogTimer) _clientLogTimer = setTimeout(_flushClientLog, 1500)
}
function _flushClientLog() {
  _clientLogTimer = null
  if (!_clientLogQ.length) return
  const batch = _clientLogQ.splice(0)
  try {
    fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: location.pathname, events: batch }) }).catch(() => {})
  } catch (e) {}
}
window.clientLog = clientLog
// Script errors on the TV (older engines choke on newer syntax) → log them too.
window.addEventListener('error', function (e) {
  clientLog('js-error', { msg: String(e.message).slice(0, 200), src: String(e.filename || '').split('/').pop(), line: e.lineno, col: e.colno })
})
window.addEventListener('unhandledrejection', function (e) {
  const r = e.reason
  clientLog('promise-error', { msg: String(r && (r.message || r)).slice(0, 200) })
})
