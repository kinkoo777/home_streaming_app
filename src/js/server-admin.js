// ================= SERVER PAGE =================
// Nastavení → Server a aktualizace: which version runs, changes waiting on GitHub with
// a one-tap update (the server pulls, installs if needed and restarts; this page waits
// for it and reloads), and the Pi's health. Server side: admin.js (/api/admin/*).

;(function () {
  'use strict'

  const modal = document.getElementById('server-modal')
  if (!modal) return
  const $ = id => document.getElementById(id)
  let _poll = null

  function getJson(url, opts) {
    return fetch(url, opts).then(r => r.json().catch(() => ({})).then(b => {
      if (!r.ok) throw new Error(b.error || 'Chyba serveru')
      return b
    }))
  }
  function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many }
  function fmtBytes(b) {
    if (b == null) return '–'
    const gb = b / 1073741824
    return gb >= 10 ? Math.round(gb) + ' GB' : gb >= 1 ? (Math.round(gb * 10) / 10).toString().replace('.', ',') + ' GB' : Math.round(b / 1048576) + ' MB'
  }
  function fmtDate(iso) {
    const d = new Date(iso)
    if (isNaN(d)) return ''
    return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
  }
  function fmtUptime(ms) {
    const min = Math.floor(ms / 60000)
    if (min < 60) return min + ' min'
    const h = Math.floor(min / 60)
    if (h < 48) return h + ' h ' + (min % 60) + ' min'
    return Math.floor(h / 24) + ' ' + plural(Math.floor(h / 24), 'den', 'dny', 'dní')
  }
  function tile(value, label, warn) {
    return `<div class="stats-tile${warn ? ' server-warn' : ''}"><span class="stats-tile-value">${escapeHtml(value)}</span><span class="stats-tile-label">${escapeHtml(label)}</span></div>`
  }

  function renderStatus(st) {
    const v = st.version
    $('server-version').textContent = v
      ? `Verze ${v.commit} z ${fmtDate(v.date)} — ${v.subject}`
      : 'Verzi nejde zjistit (FilmBox neběží z gitu)'
    const mem = st.memory || {}
    const d = st.disk
    const diskLow = d && d.free < 2 * 1073741824
    $('server-tiles').innerHTML = [
      tile(fmtUptime(Date.now() - st.startedAt), 'Běží bez restartu'),
      d ? tile(fmtBytes(d.free), 'Volno na disku z ' + fmtBytes(d.total), diskLow) : '',
      tile(fmtBytes(mem.app), 'Paměť FilmBoxu · volno ' + fmtBytes(mem.free)),
      st.temp != null ? tile(String(st.temp).replace('.', ',') + ' °C', 'Teplota procesoru', st.temp >= 75) : '',
      tile(String(st.rooms || 0), plural(st.rooms || 0, 'Otevřená místnost', 'Otevřené místnosti', 'Otevřených místností')),
      tile(st.funnel ? 'Zapnuto' : 'Vypnuto', 'Veřejné odkazy do místností (Funnel)' + (st.funnel ? ': ' + st.funnel.replace(/^https:\/\//, '') : ' — fungují jen doma / v Tailscale'))
    ].join('')
    const errs = st.errors || []
    $('server-errors').innerHTML = errs.length
      ? `<details class="server-errlist"><summary class="block-title">Poslední chyby (${errs.length})</summary><ul>${errs.map(e =>
          `<li><time>${escapeHtml(fmtDate(new Date(e.at).toISOString()))}</time> ${escapeHtml(e.text)}</li>`).join('')}</ul></details>`
      : '<p class="stats-empty"><i class="bi bi-check-circle"></i>Od spuštění žádné chyby</p>'
  }

  function renderUpdates(u, st) {
    const box = $('server-update')
    if (u.error) { box.innerHTML = `<p class="server-line"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(u.error)}</p>`; return }
    const n = u.changes.length
    $('server-dot').hidden = !n
    if (!n) { box.innerHTML = '<p class="server-line server-ok"><i class="bi bi-check-circle-fill"></i> Máte nejnovější verzi</p>'; return }
    box.innerHTML = `
      <p class="server-line server-new"><i class="bi bi-cloud-arrow-down-fill"></i> ${n} ${plural(n, 'nová změna', 'nové změny', 'nových změn')} na GitHubu</p>
      <ul class="server-changes">${u.changes.slice(0, 12).map(c => `<li><b>${escapeHtml(c.subject)}</b><span>${escapeHtml(fmtDate(c.date))}</span></li>`).join('')}</ul>
      ${u.localChanges ? '<p class="settings-hint">Na serveru jsou ruční změny souborů — pokud aktualizace selže, je potřeba je vyřešit v terminálu.</p>' : ''}
      ${st && st.allowUpdate === false
        ? '<p class="settings-hint">Aktualizace z aplikace je vypnutá (FILMBOX_ALLOW_UPDATE=0).</p>'
        : '<button class="btn btn-primary" id="server-update-btn"><i class="bi bi-arrow-repeat"></i> Aktualizovat a restartovat</button><p class="settings-hint">Přehrávání a místnosti se na chvíli přeruší.</p>'}`
  }

  // ── Saved in FilmBox (downloads) ──
  let _dlTimer = null
  function renderDownloads() {
    return getJson('/api/downloads').then(res => {
      const items = res.items || []
      const box = $('server-downloads')
      if (!items.length) { box.innerHTML = ''; return }
      const used = items.reduce((s, d) => s + (d.status === 'done' ? d.size || 0 : d.done || 0), 0)
      box.innerHTML = `<h4 class="block-title">Uloženo ve FilmBoxu <span class="muted-inline">${fmtBytes(used)}</span></h4><ul class="server-dl">${items.map(d => {
        const pct = d.size ? Math.floor((d.done || 0) / d.size * 100) : 0
        const state = d.status === 'done' ? fmtBytes(d.size) + (d.label ? ' · ' + escapeHtml(d.label) : '')
          : d.status === 'failed' ? 'Chyba: ' + escapeHtml(d.error || '')
          : d.status === 'queued' ? 'Ve frontě' : 'Stahuji ' + pct + ' % z ' + fmtBytes(d.size)
        return `<li data-id="${escapeHtml(d.id)}"><div class="server-dl-main"><b>${escapeHtml(d.title)}</b><span>${state}</span>` +
          (d.status === 'downloading' ? `<div class="server-dl-bar"><i style="width:${pct}%"></i></div>` : '') + '</div>' +
          (d.status === 'failed' ? '<button class="btn btn-ghost btn-sm" data-dl="retry">Znovu</button>' : '') +
          '<button class="btn btn-ghost btn-sm" data-dl="delete" aria-label="Smazat"><i class="bi bi-trash"></i></button></li>'
      }).join('')}</ul>`
      clearTimeout(_dlTimer)
      if (items.some(d => d.status === 'downloading' || d.status === 'queued') && !modal.classList.contains('hidden')) _dlTimer = setTimeout(renderDownloads, 3000)
    }).catch(() => {})
  }
  modal.addEventListener('click', e => {
    const b = e.target.closest('[data-dl]')
    if (!b) return
    const id = b.closest('[data-id]').dataset.id
    if (b.dataset.dl === 'delete') {
      if (!window.confirm('Smazat uloženou kopii?')) return
      fetch('/api/downloads/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => { renderDownloads(); if (window.reloadSaved) window.reloadSaved() })
    } else {
      fetch('/api/downloads/' + encodeURIComponent(id) + '/retry', { method: 'POST' }).then(renderDownloads)
    }
  })

  function load() {
    renderDownloads()
    $('server-update').innerHTML = '<p class="server-line"><i class="bi bi-arrow-repeat spin"></i> Hledám aktualizace…</p>'
    getJson('/api/admin/status').then(st => {
      renderStatus(st)
      if (st.updating) return follow(st.version && st.version.commit)
      return getJson('/api/admin/updates').then(u => renderUpdates(u, st))
    }).catch(err => { $('server-update').innerHTML = `<p class="server-line"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(err.message)}</p>` })
  }

  // After the update starts: show its steps, then wait for the new server and reload.
  function follow(fromCommit) {
    clearInterval(_poll)
    const box = $('server-update')
    let restarting = false
    let waited = 0
    const show = (text, icon) => { box.innerHTML = `<p class="server-line"><i class="bi ${icon || 'bi-arrow-repeat spin'}"></i> ${escapeHtml(text)}</p>` }
    _poll = setInterval(() => {
      if (!restarting) {
        getJson('/api/admin/update').then(job => {
          if (job.error) { clearInterval(_poll); show('Aktualizace selhala: ' + job.error, 'bi-exclamation-triangle'); return }
          if (job.restarting) { restarting = true; show('Restartuji server…'); return }
          if (job.done) { clearInterval(_poll); show(job.step || 'Hotovo', 'bi-check-circle-fill'); return }
          show(job.step + '…')
        }).catch(() => { restarting = true; show('Restartuji server…') })
        return
      }
      waited++
      if (waited > 90) { clearInterval(_poll); show('Server se zatím nevrátil — zkontrolujte ho prosím (viz README: Aktualizace).', 'bi-exclamation-triangle'); return }
      getJson('/api/admin/status').then(st => {
        if (st.version && st.version.commit !== fromCommit) {
          clearInterval(_poll)
          show('Hotovo — verze ' + st.version.commit + '. Načítám znovu…', 'bi-check-circle-fill')
          setTimeout(() => location.reload(), 1500)
        }
      }).catch(() => {})
    }, 1500)
  }

  modal.addEventListener('click', e => {
    if (!e.target.closest('#server-update-btn')) return
    if (!window.confirm('Aktualizovat FilmBox a restartovat server? Přehrávání a místnosti se na chvíli přeruší.')) return
    getJson('/api/admin/status').then(st => {
      const from = st.version && st.version.commit
      return getJson('/api/admin/update', { method: 'POST' }).then(() => follow(from))
    }).catch(err => showToast(err.message))
  })

  window.openServerPage = function () {
    modal.scrollTop = 0
    openModal(modal, () => { clearInterval(_poll); closeModal(modal) })
    load()
  }
  $('settings-server').addEventListener('click', () => window.openServerPage())
})()
