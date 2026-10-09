// ================= FILMBOX WRAPPED =================
// "Rok ve FilmBoxu": the profile's year as full-screen story slides (like Spotify
// Wrapped) — hours, the first film, the most watched, genres, the biggest binge, days
// in a row, months, what it loved, the household ranking and a summary picture to
// save. From Statistiky (any time) and a banner on the home page in December / January.
// Tap / click right = next, left = back, arrows + OK on a remote, Esc / Back closes,
// hold to pause. Data: GET /api/profiles/:id/wrapped?year= (wrapped.js on the server).

;(function () {
  'use strict'

  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
  const MONTHS_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']
  const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']
  const SLIDE_MS = 7000
  const esc = s => escapeHtml(String(s == null ? '' : s))
  const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many
  const hours = s => Math.round((s || 0) / 3600)
  const img = (p, size) => p ? tmdbImg(p, size || 'w342') : ''
  const dateCz = d => { const p = String(d).split('-'); return Number(p[2]) + '. ' + MONTHS_GEN[Number(p[1]) - 1] }

  let root = null, slides = [], idx = 0, timer = null, started = 0, paused = false, pausedAt = 0, data = null, profileName = ''

  function el() {
    if (root) return root
    root = document.createElement('div')
    root.id = 'wrapped'
    root.className = 'wrapped'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', 'Rok ve FilmBoxu')
    root.innerHTML = '<div class="wr-bars"></div><div class="wr-stage" aria-live="polite"></div>' +
      '<button class="wr-close" aria-label="Zavřít"><i class="bi bi-x-lg"></i></button>'
    document.body.appendChild(root)
    root.querySelector('.wr-close').addEventListener('click', close)
    root.addEventListener('click', e => {
      if (e.target.closest('.wr-close, .wr-action, a')) return
      const r = root.getBoundingClientRect()
      go(e.clientX < r.left + r.width * 0.3 ? -1 : 1)
    })
    const hold = on => { if (on) pause(); else resume() }
    root.addEventListener('mousedown', e => { if (!e.target.closest('.wr-action, .wr-close')) hold(true) })
    root.addEventListener('mouseup', () => hold(false))
    root.addEventListener('touchstart', e => { if (!e.target.closest('.wr-action, .wr-close')) hold(true) }, { passive: true })
    root.addEventListener('touchend', () => hold(false))
    return root
  }

  // ── Slides ──
  function build(w) {
    const out = []
    const total = hours(w.seconds)
    out.push({ cls: 'wr-c1', html: `<span class="wr-eyebrow">FilmBox · ${esc(profileName)}</span><h1 class="wr-huge">Váš rok<br>${w.year}</h1><p class="wr-lead">Co jste viděli, kolik toho bylo a co vás chytlo nejvíc.</p>` })
    if (!w.seconds) {
      out.push({ cls: 'wr-c2', html: `<h2 class="wr-big">Letos jste toho ve FilmBoxu ještě moc neviděli</h2><p class="wr-lead">Pusťte si něco — a v prosinci se sem vraťte.</p>` })
      return out
    }
    const daysEq = Math.round(w.seconds / 86400 * 10) / 10
    const tvPct = Math.round(w.tvSeconds / Math.max(1, w.seconds) * 100)
    out.push({ cls: 'wr-c2', html: `<span class="wr-eyebrow">Celkem</span><h2 class="wr-num" data-count="${total}">0</h2><p class="wr-big">${plural(total, 'hodina', 'hodiny', 'hodin')} u obrazovky</p>` +
      `<p class="wr-lead">${daysEq >= 1 ? 'To je ' + String(daysEq).replace('.', ',') + ' ' + plural(Math.round(daysEq), 'den', 'dny', 'dní') + ' v kuse.' : ''} ${w.films} ${plural(w.films, 'film', 'filmy', 'filmů')} a ${w.episodes} ${plural(w.episodes, 'díl', 'díly', 'dílů')} seriálů.</p>` +
      `<div class="wr-split"><i style="width:${100 - tvPct}%"></i><b style="width:${tvPct}%"></b></div><p class="wr-small">Filmy ${100 - tvPct} % · Seriály ${tvPct} %</p>` })
    if (w.first) out.push({ cls: 'wr-c3', html: `<span class="wr-eyebrow">Na začátku</span>${w.first.posterPath ? `<img class="wr-poster" src="${img(w.first.posterPath)}" alt="">` : ''}<h2 class="wr-big">Rok jste začali ${dateCz(w.first.date)}<br><em>${esc(w.first.title)}</em></h2>` })
    const t = w.topTitles[0]
    if (t) out.push({ cls: 'wr-c4', html: `<span class="wr-eyebrow">Nejvíc ze všeho</span>${t.posterPath ? `<img class="wr-poster big" src="${img(t.posterPath, 'w500')}" alt="">` : ''}<h2 class="wr-big"><em>${esc(t.title)}</em></h2><p class="wr-lead">${hours(t.seconds) || '<1'} h · vraceli jste se k ${t.mediaType === 'tv' ? 'němu' : 'němu'} ${t.days} ${plural(t.days, 'den', 'dny', 'dní')}</p>` })
    if (w.topTitles.length > 1) out.push({ cls: 'wr-c5', html: `<span class="wr-eyebrow">Vaše top ${w.topTitles.length}</span><ol class="wr-top">${w.topTitles.map((x, i) =>
      `<li style="animation-delay:${0.15 + i * 0.12}s"><span class="wr-rank">${i + 1}</span>${x.posterPath ? `<img src="${img(x.posterPath, 'w154')}" alt="">` : '<span class="wr-noimg"></span>'}<div><b>${esc(x.title)}</b><small>${hours(x.seconds) || '<1'} h</small></div></li>`).join('')}</ol>` })
    if (w.genres && w.genres.length) {
      const max = w.genres[0].seconds || 1
      out.push({ cls: 'wr-c6', html: `<span class="wr-eyebrow">Žánr roku</span><h2 class="wr-huge sm">${esc(w.genres[0].name)}</h2><div class="wr-bars-list">${w.genres.slice(0, 5).map((g, i) =>
        `<div class="wr-gbar" style="animation-delay:${0.2 + i * 0.1}s"><span>${esc(g.name)}</span><i style="width:${Math.max(8, g.seconds / max * 100)}%"></i></div>`).join('')}</div>` })
    }
    if (w.binge) out.push({ cls: 'wr-c7', html: `<span class="wr-eyebrow">Největší maraton</span><h2 class="wr-num" data-count="${w.binge.episodes}">0</h2><p class="wr-big">${plural(w.binge.episodes, 'díl', 'díly', 'dílů')} <em>${esc(w.binge.title)}</em><br>za jediný den</p><p class="wr-lead">${dateCz(w.binge.date)}. Jen ještě jeden…</p>` })
    out.push({ cls: 'wr-c8', html: `<span class="wr-eyebrow">Věrnost</span><h2 class="wr-num" data-count="${w.days}">0</h2><p class="wr-big">${plural(w.days, 'den', 'dny', 'dní')} se FilmBoxem</p>` +
      `<p class="wr-lead">${w.streak > 1 ? 'Nejdelší série: <b>' + w.streak + ' ' + plural(w.streak, 'den', 'dny', 'dní') + ' v kuse</b>. ' : ''}${w.bestWeekday ? 'Nejradši se díváte v <b>' + esc(w.bestWeekday === 'neděle' ? 'neděli' : w.bestWeekday === 'středa' ? 'středu' : w.bestWeekday === 'sobota' ? 'sobotu' : w.bestWeekday) + '</b>.' : ''}</p>` })
    if (w.bestMonth != null) {
      const max = Math.max.apply(null, w.months) || 1
      out.push({ cls: 'wr-c9', html: `<span class="wr-eyebrow">Nejsilnější měsíc</span><h2 class="wr-huge sm">${MONTHS[w.bestMonth]}</h2><div class="wr-months">${w.months.map((s, i) =>
        `<div class="wr-mcol${i === w.bestMonth ? ' best' : ''}"><i style="height:${Math.max(3, s / max * 100)}%;animation-delay:${i * 0.05}s"></i><span>${MONTHS_SHORT[i]}</span></div>`).join('')}</div>` })
    }
    if (w.loved && w.loved.length) out.push({ cls: 'wr-c10', html: `<span class="wr-eyebrow">👍👍 Miluju to</span><h2 class="wr-big">Tohle vás letos nadchlo</h2><div class="wr-loved">${w.loved.map(l => l.posterPath ? `<img src="${img(l.posterPath)}" alt="${esc(l.title)}">` : `<span>${esc(l.title)}</span>`).join('')}</div>` })
    if (w.household && w.household.length > 1) {
      const me = w.household.findIndex(h => h.me)
      out.push({ cls: 'wr-c11', html: `<span class="wr-eyebrow">Doma</span><h2 class="wr-big">${me === 0 ? 'Jste šampion domácnosti 🏆' : 'Kdo se díval nejvíc'}</h2><ol class="wr-house">${w.household.slice(0, 6).map((h, i) =>
        `<li class="${h.me ? 'me' : ''}" style="animation-delay:${0.15 + i * 0.12}s"><span class="wr-rank">${i + 1}</span><b>${esc(h.name)}</b><small>${hours(h.seconds)} h</small></li>`).join('')}</ol>` })
    }
    out.push({ cls: 'wr-c12 wr-final', html: `<span class="wr-eyebrow">Rok ${w.year} ve FilmBoxu</span>${summaryHtml(w)}<div class="wr-actions"><button class="btn btn-primary wr-action" data-wr="save"><i class="bi bi-download"></i> Uložit obrázek</button><button class="btn btn-glass wr-action" data-wr="again"><i class="bi bi-arrow-counterclockwise"></i> Znovu</button></div>` })
    return out
  }
  function summaryHtml(w) {
    const t = w.topTitles[0]
    return `<div class="wr-summary"><div><b>${hours(w.seconds)} h</b><span>u obrazovky</span></div><div><b>${w.films}</b><span>${plural(w.films, 'film', 'filmy', 'filmů')}</span></div><div><b>${w.episodes}</b><span>${plural(w.episodes, 'díl', 'díly', 'dílů')}</span></div>` +
      `<div><b>${w.days}</b><span>${plural(w.days, 'den', 'dny', 'dní')}</span></div>${t ? `<div class="wide"><b>${esc(t.title)}</b><span>nejvíc sledované</span></div>` : ''}${w.genres && w.genres[0] ? `<div class="wide"><b>${esc(w.genres[0].name)}</b><span>žánr roku</span></div>` : ''}</div>`
  }

  // ── Showing ──
  function show(i) {
    idx = Math.max(0, Math.min(slides.length - 1, i))
    const s = slides[idx]
    const stage = root.querySelector('.wr-stage')
    stage.className = 'wr-stage ' + s.cls
    stage.innerHTML = '<div class="wr-slide">' + s.html + '</div>'
    root.querySelectorAll('.wr-bar').forEach((b, j) => {
      b.classList.toggle('done', j < idx)
      b.classList.remove('run')
      if (j === idx) { void b.offsetWidth; b.classList.add('run') }
    })
    stage.querySelectorAll('[data-count]').forEach(countUp)
    stage.querySelectorAll('[data-wr]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation()
      if (b.dataset.wr === 'save') saveImage()
      else show(0)
    }))
    clearTimeout(timer)
    started = Date.now()
    paused = false
    if (idx < slides.length - 1) timer = setTimeout(() => go(1), SLIDE_MS)
    const focus = stage.querySelector('.wr-action')
    if (focus && document.body.classList.contains('kbd')) focus.focus()
  }
  function go(d) {
    if (idx + d >= slides.length) return
    show(idx + d)
  }
  function pause() {
    if (paused || idx >= slides.length - 1) return
    paused = true
    pausedAt = Date.now()
    clearTimeout(timer)
    root.classList.add('paused')
  }
  function resume() {
    if (!paused) return
    paused = false
    root.classList.remove('paused')
    const left = Math.max(800, SLIDE_MS - (pausedAt - started))
    started = Date.now() - (SLIDE_MS - left)
    timer = setTimeout(() => go(1), left)
  }
  function countUp(node) {
    const to = parseInt(node.dataset.count, 10) || 0
    const t0 = performance.now()
    const step = now => {
      const k = Math.min(1, (now - t0) / 1400)
      node.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString('cs-CZ')
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  function onKey(e) {
    if (!root || root.classList.contains('hidden')) return
    const back = e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 461 || e.keyCode === 10009
    if (back) { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('.wr-action')) || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1) }
  }

  // ── Summary picture (1080 × 1350 PNG) ──
  function loadImg(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null)
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => resolve(i)
      i.onerror = () => resolve(null)
      // A copy the page already showed (without CORS) can't be drawn — fetch a fresh one.
      i.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'canvas=1'
    })
  }
  async function saveImage() {
    const w = data
    const c = document.createElement('canvas')
    c.width = 1080; c.height = 1350
    const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 1080, 1350)
    g.addColorStop(0, '#f43f5e'); g.addColorStop(0.55, '#7c3aed'); g.addColorStop(1, '#0ea5e9')
    x.fillStyle = g; x.fillRect(0, 0, 1080, 1350)
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, 1080, 1350)
    x.fillStyle = '#fff'
    x.font = '700 40px system-ui, sans-serif'
    x.fillText('FilmBox · ' + profileName, 80, 120)
    x.font = '900 120px system-ui, sans-serif'
    x.fillText('Rok ' + w.year, 80, 260)
    const posters = await Promise.all(w.topTitles.slice(0, 3).map(t => loadImg(img(t.posterPath, 'w342'))))
    posters.forEach((p, i) => {
      if (!p) return
      try { x.drawImage(p, 80 + i * 320, 330, 280, 420) } catch (e) {}
    })
    const rows = [[hours(w.seconds) + ' h', 'u obrazovky'], [String(w.films), plural(w.films, 'film', 'filmy', 'filmů')], [String(w.episodes), plural(w.episodes, 'díl', 'díly', 'dílů')], [String(w.days), plural(w.days, 'den', 'dny', 'dní')]]
    rows.forEach((r, i) => {
      const cx = 80 + (i % 2) * 480, cy = 870 + Math.floor(i / 2) * 170
      x.font = '900 84px system-ui, sans-serif'; x.fillText(r[0], cx, cy)
      x.font = '500 36px system-ui, sans-serif'; x.fillText(r[1], cx, cy + 50)
    })
    if (w.topTitles[0]) { x.font = '700 40px system-ui, sans-serif'; x.fillText('Nejvíc: ' + w.topTitles[0].title.slice(0, 38), 80, 1260) }
    try {
      c.toBlob(blob => {
        if (!blob) { showToast('Obrázek se nepodařilo vytvořit'); return }
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'filmbox-' + w.year + '.png'
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }, 'image/png')
    } catch (e) { showToast('Obrázek se nepodařilo vytvořit') }
  }

  // ── Open / close ──
  window.openWrapped = async function (year) {
    const p = getActiveProfile()
    if (!p) { showToast('Nejprve vyberte profil'); return }
    profileName = p.name || ''
    year = year || defaultYear()
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(p.id)}/wrapped?year=${year}`)
      if (!r.ok) throw new Error('Nepodařilo se načíst')
      data = await r.json()
    } catch (e) { showToast(e.message); return }
    el()
    slides = build(data)
    root.querySelector('.wr-bars').innerHTML = slides.map(() => '<span class="wr-bar"><i></i></span>').join('')
    root.style.setProperty('--wr-slide', SLIDE_MS + 'ms')
    root.classList.remove('hidden')
    document.body.classList.add('wrapped-open')
    document.addEventListener('keydown', onKey, true)
    show(0)
  }
  function close() {
    clearTimeout(timer)
    if (root) root.classList.add('hidden')
    document.body.classList.remove('wrapped-open')
    document.removeEventListener('keydown', onKey, true)
  }
  // December and January → this / last year; otherwise the year so far.
  function defaultYear() { const d = new Date(); return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear() }

  // Home banner in December / January.
  function banner() {
    const m = new Date().getMonth()
    const box = document.getElementById('wrapped-banner')
    if (!box) return
    if ((m !== 11 && m !== 0) || !hasActiveProfile()) { box.style.display = 'none'; return }
    box.querySelector('b').textContent = 'Váš rok ' + defaultYear() + ' ve FilmBoxu'
    box.style.display = ''
  }
  document.addEventListener('DOMContentLoaded', () => {
    banner()
    const b = document.getElementById('wrapped-banner')
    if (b) b.addEventListener('click', () => window.openWrapped())
    const s = document.getElementById('stats-wrapped')
    if (s) s.addEventListener('click', () => window.openWrapped())
  })
  window.reloadWrappedBanner = banner
})()
