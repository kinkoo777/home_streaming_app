// ================= CAST SENDER — the phone side of "Pustit na TV" =================
// The navbar cast button appears once a TV is online (polled from /api/cast/devices).
// With a TV chosen, "Přehrát" in the source picker sends the video there (asking
// "resume?" here, since the TV won't) and opens a remote that polls the TV's state.

;(function () {
  'use strict'

  const btn = document.getElementById('cast-btn')
  const modal = document.getElementById('cast-modal')
  const devicesBox = document.getElementById('cast-devices')
  const remote = document.getElementById('remote-modal')
  const $ = id => document.getElementById(id)
  const ownId = window.castReceiver ? window.castReceiver.id : null   // a receiver doesn't list itself
  let _devices = []
  let _remoteTarget = null
  let _remoteTimer = null
  let _state = null

  function fmt(s) {
    s = Math.max(0, Math.round(s || 0))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, '0')
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec
  }

  // ── Target TV (this tab only) ──
  function getTarget() {
    try { return JSON.parse(sessionStorage.getItem('filmbox_cast_target') || 'null') } catch (e) { return null }
  }
  function setTarget(t) {
    try {
      if (t) sessionStorage.setItem('filmbox_cast_target', JSON.stringify(t))
      else sessionStorage.removeItem('filmbox_cast_target')
    } catch (e) {}
    syncButton()
  }
  window.castTarget = getTarget

  function syncButton() {
    const t = getTarget()
    btn.style.display = _devices.length || t ? '' : 'none'
    btn.classList.toggle('is-casting', !!t)
    btn.title = t ? 'Přehrává se na: ' + t.name : 'Pustit na TV'
    btn.setAttribute('aria-label', btn.title)
  }

  async function refresh() {
    try {
      const r = await fetch('/api/cast/devices')
      const list = r.ok ? await r.json() : []
      _devices = list.filter(d => d.id !== ownId)
    } catch (e) { _devices = [] }
    syncButton()
    if (isModalOpen(modal)) renderDevices()
  }

  function stateText(d) {
    const st = d.state
    if (!d.online) return 'Připojuje se…'
    if (st && st.page === 'player' && st.title) return (st.paused ? 'Pozastaveno: ' : 'Hraje: ') + st.title
    return 'Zapnutá, připravená'
  }

  function renderDevices() {
    const t = getTarget()
    const here = `
      <div class="cast-device${!t ? ' active' : ''}">
        <button class="cast-pick" data-id="">
          <i class="bi bi-phone"></i><span><b>Tento přístroj</b><small>Přehrávat tady</small></span>${!t ? '<i class="bi bi-check-lg cast-check"></i>' : ''}
        </button>
      </div>`
    const tvs = _devices.map(d => {
      const on = !!(t && t.id === d.id)
      const playing = d.state && d.state.page === 'player'
      return `
        <div class="cast-device${on ? ' active' : ''}">
          <button class="cast-pick" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}">
            <i class="bi bi-tv"></i><span><b>${escapeHtml(d.name)}</b><small>${escapeHtml(stateText(d))}</small></span>${on ? '<i class="bi bi-check-lg cast-check"></i>' : ''}
          </button>
          ${playing ? `<button class="btn btn-glass btn-sm cast-remote" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}"><i class="bi bi-controller"></i> Ovladač</button>` : ''}
        </div>`
    }).join('')
    devicesBox.innerHTML = here + (tvs || '<p class="cast-none">Žádná televize teď není připojená.</p>')
  }

  function openChooser() {
    renderDevices()
    openModal(modal, () => closeModal(modal))
    refresh()
  }

  devicesBox.addEventListener('click', e => {
    const r = e.target.closest('.cast-remote')
    if (r) { closeModal(modal); openRemote({ id: r.dataset.id, name: r.dataset.name }); return }
    const p = e.target.closest('.cast-pick')
    if (!p) return
    setTarget(p.dataset.id ? { id: p.dataset.id, name: p.dataset.name } : null)
    renderDevices()
    showToast(p.dataset.id ? 'Přehrávání půjde na: ' + p.dataset.name : 'Přehrávání tady na tomto přístroji')
    setTimeout(() => closeModal(modal), 350)
  })
  btn.addEventListener('click', openChooser)

  // ── Sending from the source picker (player.js → playSource) ──
  // data = the player payload. Returns true when it's handled here.
  window.castSend = function (data) {
    const t = getTarget()
    if (!t || !data) return false
    const p = (window._profileProgress || {})[data.progressKey]
    const saved = p && typeof p === 'object' && !p.finished ? p.seconds : 0
    const dur = p && p.duration
    if (saved > 30 && (!dur || saved < dur * 0.95)) {
      prehrajModalSubtitle.textContent = 'Pustit na ' + t.name
      prehrajModalContent.innerHTML = `
        <div class="source-state cast-choice"><i class="bi bi-cast"></i>
          <p>Kde začít na televizi <b>${escapeHtml(t.name)}</b>?</p>
          <div class="cast-choice-actions">
            <button class="btn btn-primary" data-start="${saved}"><i class="bi bi-play-fill"></i> Pokračovat od ${fmt(saved)}</button>
            <button class="btn btn-glass" data-start="0"><i class="bi bi-arrow-counterclockwise"></i> Od začátku</button>
          </div>
        </div>`
      prehrajModalContent.querySelectorAll('[data-start]').forEach(b =>
        b.addEventListener('click', () => sendPlay(t, data, Number(b.dataset.start))))
      if (document.body.classList.contains('kbd')) prehrajModalContent.querySelector('[data-start]').focus()
    } else {
      sendPlay(t, data, 0)
    }
    return true
  }

  async function sendPlay(t, data, startAt) {
    prehrajModalSubtitle.textContent = 'Posílám na ' + t.name + '…'
    const profileId = getActiveProfileId()
    const token = typeof getProfileToken === 'function' ? getProfileToken(profileId) : null
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['X-Profile-Token'] = token
    try {
      const res = await fetch(`/api/cast/${encodeURIComponent(t.id)}/command`, {
        method: 'POST', headers, body: JSON.stringify({ type: 'play', player: data, profileId, startAt })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || 'Nepodařilo se poslat na televizi')
        err.status = res.status
        throw err
      }
      closePrehrajModal()
      showToast('Přehrává se na: ' + t.name)
      setTimeout(() => openRemote(t), 300)
    } catch (err) {
      prehrajModalSubtitle.textContent = 'Televize neodpovídá'
      prehrajModalContent.innerHTML = `
        <div class="source-state error cast-choice"><i class="bi bi-tv"></i>
          <p>${escapeHtml(err.status === 404 ? t.name + ' teď není připojená — je na ní FilmBox zapnutý?' : err.message)}</p>
          <div class="cast-choice-actions">
            <button class="btn btn-primary" id="cast-retry"><i class="bi bi-arrow-clockwise"></i> Zkusit znovu</button>
            <button class="btn btn-glass" id="cast-here"><i class="bi bi-phone"></i> Přehrát tady</button>
          </div>
        </div>`
      $('cast-retry').onclick = () => sendPlay(t, data, startAt)
      $('cast-here').onclick = () => { window.location.href = 'player.html' }
    }
  }

  // ── Remote ──
  function command(cmd) {
    if (!_remoteTarget) return
    // Feels instant: show the expected result before the TV reports back.
    if (_state) {
      if (cmd.type === 'toggle') _state.paused = !_state.paused
      if (cmd.type === 'seek') _state.position = Math.max(0, Math.min(_state.duration || 1e9, (_state.position || 0) + cmd.by))
      if (cmd.type === 'seekTo') _state.position = cmd.to
      if (cmd.type === 'subs') _state.subs = !_state.subs
      renderRemote()
    }
    fetch(`/api/cast/${encodeURIComponent(_remoteTarget.id)}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd)
    }).then(r => { if (r.status === 404) showToast(_remoteTarget.name + ' není připojená') }).catch(() => {})
    setTimeout(poll, 700)
  }

  async function poll() {
    if (!_remoteTarget) return
    try {
      const r = await fetch(`/api/cast/${encodeURIComponent(_remoteTarget.id)}`)
      if (r.status === 404) { _state = { offline: true }; renderRemote(); return }
      const d = await r.json()
      _state = d.state || {}
      // Between two reports the video keeps going.
      if (_state.page === 'player' && !_state.paused && d.stateAge) _state.position = (_state.position || 0) + d.stateAge / 1000
    } catch (e) { return }
    renderRemote()
  }

  function renderRemote() {
    const st = _state || {}
    const playing = st.page === 'player'
    remote.classList.toggle('remote-idle', !playing)
    $('remote-title').textContent = st.offline ? 'Televize není připojená' : playing ? (st.title || 'Přehrává se') : 'Na televizi teď nic nehraje'
    $('remote-sub').textContent = st.offline ? 'Je na ní FilmBox zapnutý?' : playing ? (st.mediaType === 'tv' ? 'Seriál' : 'Film') + (st.paused ? ' · pozastaveno' : '') : 'Vyberte film nebo díl a stiskněte Přehrát.'
    const poster = $('remote-poster')
    if (playing && st.posterPath) { poster.src = tmdbImg(st.posterPath, 'w185'); poster.style.display = '' } else poster.style.display = 'none'
    const dur = st.duration || 0
    const pos = Math.min(dur || 0, st.position || 0)
    $('remote-progress-fill').style.width = dur ? (pos / dur * 100).toFixed(2) + '%' : '0%'
    $('remote-progress').setAttribute('aria-valuemax', String(dur))
    $('remote-progress').setAttribute('aria-valuenow', String(Math.round(pos)))
    $('remote-pos').textContent = fmt(pos)
    $('remote-dur').textContent = dur ? '−' + fmt(dur - pos) : '0:00'
    $('remote-play').innerHTML = `<i class="bi ${st.paused || !playing ? 'bi-play-fill' : 'bi-pause-fill'}"></i>`
    $('remote-subs').style.display = playing && st.hasSubs ? '' : 'none'
    $('remote-subs').classList.toggle('is-on', !!st.subs)
    $('remote-next').style.display = playing && st.hasNext ? '' : 'none'
    $('remote-hint').textContent = playing && st.muted ? 'Prohlížeč na televizi spustil video bez zvuku — zapněte ho tlačítkem OK na ovladači televize.' : ''
    remote.querySelectorAll('.remote-main button, #remote-stop').forEach(b => { b.disabled = !playing })
  }

  function openRemote(t) {
    _remoteTarget = t
    _state = null
    $('remote-device').innerHTML = '<i class="bi bi-tv"></i> ' + escapeHtml(t.name)
    $('remote-title').textContent = 'Připojuji…'
    $('remote-sub').textContent = ''
    openModal(remote, closeRemote)
    poll()
    clearInterval(_remoteTimer)
    _remoteTimer = setInterval(poll, 1500)
  }
  function closeRemote() {
    clearInterval(_remoteTimer)
    _remoteTimer = null
    _remoteTarget = null
    closeModal(remote)
  }
  window.openCastRemote = openRemote

  remote.addEventListener('click', e => {
    const b = e.target.closest('[data-cmd]')
    if (!b || b.disabled) return
    const cmd = { type: b.dataset.cmd }
    if (cmd.type === 'seek') cmd.by = Number(b.dataset.by)
    command(cmd)
  })
  $('remote-progress').addEventListener('click', e => {
    const st = _state || {}
    if (st.page !== 'player' || !st.duration) return
    const r = e.currentTarget.getBoundingClientRect()
    command({ type: 'seekTo', to: Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.duration) })
  })
  $('remote-progress').addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      command({ type: 'seek', by: e.key === 'ArrowRight' ? 30 : -30 })
    }
  })

  // Keep the button in sync: on load, every 15 s, and when the tab comes back.
  refresh()
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh() }, 15000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
})()
