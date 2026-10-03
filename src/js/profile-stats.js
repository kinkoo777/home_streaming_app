// ================= WATCHING STATS =================
// Sheet opened from profile settings: hours watched, finished titles, the last
// 12 months as columns, genre shares and the most watched titles.
// Data: GET /api/profiles/:id/stats?period=month|year|all (stats.js on the server).

;(function () {
  'use strict'

  const modal = document.getElementById('stats-modal')
  const body = document.getElementById('stats-body')
  const periodBox = document.getElementById('stats-period')
  const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']
  const MONTHS_LONG = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
  let _period = 'month'
  let _seq = 0

  // 45 min · 3 h · 12 h 30 min
  function fmtDuration(sec) {
    const min = Math.round((sec || 0) / 60)
    if (min < 60) return min + ' min'
    const h = Math.floor(min / 60)
    const m = min % 60
    return m && h < 100 ? h + ' h ' + m + ' min' : h + ' h'
  }
  function shortHours(sec) {
    const h = (sec || 0) / 3600
    if (h < 1) return Math.round((sec || 0) / 60) + ' min'
    return (h < 10 ? Math.round(h * 10) / 10 : Math.round(h)).toString().replace('.', ',') + ' h'
  }
  function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many }
  function monthLabel(ym, long) {
    const parts = ym.split('-')
    const name = (long ? MONTHS_LONG : MONTHS)[parseInt(parts[1], 10) - 1]
    return long ? name + ' ' + parts[0] : name
  }

  function tile(value, label) {
    return `<div class="stats-tile"><span class="stats-tile-value">${escapeHtml(value)}</span><span class="stats-tile-label">${escapeHtml(label)}</span></div>`
  }

  // 12 columns, one series (accent). The tallest and the current month carry a
  // label on the cap; hover / remote focus shows any month; a table repeats it all.
  function monthsChart(byMonth) {
    const max = Math.max.apply(null, byMonth.map(m => m.seconds))
    if (!max) return ''
    const last = byMonth.length - 1
    const maxIdx = byMonth.findIndex(m => m.seconds === max)
    const cols = byMonth.map((m, i) => {
      const pct = m.seconds ? Math.max(2, (m.seconds / max) * 100) : 0
      const label = i === maxIdx || (i === last && m.seconds) ? `<span class="stats-cap">${escapeHtml(shortHours(m.seconds))}</span>` : ''
      const text = monthLabel(m.month, true) + ': ' + (m.seconds ? fmtDuration(m.seconds) : 'nic')
      return `
        <div class="stats-col${i === last ? ' current' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(text)}" data-tip="${escapeHtml(text)}">
          <div class="stats-col-plot">${m.seconds ? `<div class="stats-bar" style="height:${pct.toFixed(1)}%">${label}</div>` : ''}</div>
          <span class="stats-col-label">${monthLabel(m.month)}</span>
        </div>`
    }).join('')
    const rows = byMonth.map(m => `<tr><td>${escapeHtml(monthLabel(m.month, true))}</td><td>${escapeHtml(fmtDuration(m.seconds))}</td></tr>`).join('')
    return `
      <section class="stats-block">
        <h4 class="block-title">Posledních 12 měsíců</h4>
        <div class="stats-chart"><div class="stats-tip" aria-hidden="true"></div>${cols}</div>
        <details class="stats-table"><summary>Zobrazit jako tabulku</summary>
          <table><thead><tr><th>Měsíc</th><th>Sledováno</th></tr></thead><tbody>${rows}</tbody></table>
        </details>
      </section>`
  }

  function genresBlock(genres) {
    if (!genres || !genres.length) return ''
    const max = genres[0].seconds || 1
    return `
      <section class="stats-block">
        <h4 class="block-title">Nejsledovanější žánry</h4>
        <div class="stats-genres">${genres.map(g => `
          <div class="stats-genre">
            <span class="stats-genre-name">${escapeHtml(g.name)}</span>
            <div class="stats-genre-track"><div class="stats-genre-bar" style="width:${Math.max(2, (g.seconds / max) * 100).toFixed(1)}%"></div><span class="stats-genre-value">${escapeHtml(shortHours(g.seconds))}</span></div>
          </div>`).join('')}
        </div>
      </section>`
  }

  function titlesBlock(titles) {
    if (!titles || !titles.length) return ''
    return `
      <section class="stats-block">
        <h4 class="block-title">Nejvíc sledované</h4>
        <ol class="stats-titles">${titles.map((t, i) => `
          <li><button class="stats-title" data-id="${t.tmdbId}" data-type="${t.mediaType}" data-title="${escapeHtml(t.title || '')}">
            <span class="stats-rank">${i + 1}</span>
            ${t.posterPath ? `<img src="${tmdbImg(t.posterPath, 'w92')}" alt="" loading="lazy">` : '<span class="stats-noposter"><i class="bi bi-film"></i></span>'}
            <span class="stats-title-text"><b>${escapeHtml(t.title || 'Bez názvu')}</b><small>${t.mediaType === 'tv' ? 'Seriál' : 'Film'}</small></span>
            <span class="stats-title-time">${escapeHtml(fmtDuration(t.seconds))}</span>
          </button></li>`).join('')}
        </ol>
      </section>`
  }

  function render(s) {
    const periodName = { month: 'tento měsíc', year: 'letos', all: 'celkem' }[s.period]
    const nothing = !s.totalSeconds && !s.finishedMovies && !s.finishedEpisodes
    const split = s.totalSeconds
      ? `Filmy ${fmtDuration(s.split.movie)} · Seriály ${fmtDuration(s.split.tv)}`
      : 'Čas sledování se začal počítat s touto verzí FilmBoxu.'
    body.innerHTML = `
      <div class="stats-hero">
        <span class="stats-hero-value">${escapeHtml(fmtDuration(s.totalSeconds))}</span>
        <span class="stats-hero-label">sledování ${periodName} · ${escapeHtml(split)}</span>
      </div>
      <div class="stats-tiles">
        ${tile(String(s.finishedMovies), plural(s.finishedMovies, 'dokončený film', 'dokončené filmy', 'dokončených filmů'))}
        ${tile(String(s.finishedEpisodes), plural(s.finishedEpisodes, 'epizoda', 'epizody', 'epizod') + ' z ' + s.finishedShows + ' ' + plural(s.finishedShows, 'seriálu', 'seriálů', 'seriálů'))}
        ${tile(String(s.daysWatched), plural(s.daysWatched, 'den se sledováním', 'dny se sledováním', 'dní se sledováním'))}
        ${tile(String(s.longestStreak), plural(s.longestStreak, 'den v řadě', 'dny v řadě', 'dní v řadě') + ' nejvíc')}
      </div>
      ${nothing ? '<p class="stats-empty"><i class="bi bi-film"></i> Za toto období tu zatím nic není. Pusťte si něco a statistiky se začnou plnit.</p>' : ''}
      ${monthsChart(s.byMonth)}
      ${genresBlock(s.genres)}
      ${titlesBlock(s.topTitles)}`
  }

  async function load() {
    const seq = ++_seq
    periodBox.querySelectorAll('[data-period]').forEach(b => b.classList.toggle('active', b.dataset.period === _period))
    body.innerHTML = '<div class="stats-loading"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>'
    try {
      const s = await apiFetch(`/api/profiles/${getActiveProfileId()}/stats?period=${_period}`)
      if (seq === _seq) render(s)
    } catch (err) {
      if (seq === _seq) body.innerHTML = `<p class="stats-empty"><i class="bi bi-exclamation-circle"></i> ${escapeHtml(err.message)}</p>`
    }
  }

  window.openStats = function () {
    const profile = getActiveProfile()
    if (!profile) { showToast('Nejprve vyberte profil'); return }
    document.getElementById('stats-title').textContent = profile.name || ''
    modal.scrollTop = 0
    openModal(modal, () => closeModal(modal))
    load()
  }

  periodBox.addEventListener('click', e => {
    const b = e.target.closest('[data-period]')
    if (!b || b.dataset.period === _period) return
    _period = b.dataset.period
    load()
  })

  // Month tooltip on hover / remote focus.
  function showTip(col) {
    const chart = col.closest('.stats-chart')
    const tip = chart && chart.querySelector('.stats-tip')
    if (!tip) return
    tip.textContent = col.dataset.tip
    const c = chart.getBoundingClientRect()
    const r = col.getBoundingClientRect()
    tip.style.left = Math.max(0, Math.min(c.width - 160, r.left - c.left + r.width / 2 - 80)) + 'px'
    tip.classList.add('show')
  }
  function hideTip(col) {
    const tip = col.closest('.stats-chart').querySelector('.stats-tip')
    if (tip) tip.classList.remove('show')
  }
  body.addEventListener('mouseover', e => { const c = e.target.closest('.stats-col'); if (c) showTip(c) })
  body.addEventListener('mouseout', e => { const c = e.target.closest('.stats-col'); if (c && !c.contains(e.relatedTarget)) hideTip(c) })
  body.addEventListener('focusin', e => { const c = e.target.closest('.stats-col'); if (c) showTip(c) })
  body.addEventListener('focusout', e => { const c = e.target.closest('.stats-col'); if (c) hideTip(c) })

  body.addEventListener('click', e => {
    const t = e.target.closest('.stats-title')
    if (!t) return
    openDetailModal(parseInt(t.dataset.id, 10), t.dataset.type, t.dataset.title)
  })

  document.getElementById('settings-stats').addEventListener('click', () => window.openStats())
})()
