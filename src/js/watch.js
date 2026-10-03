// ================= WATCH TOGETHER — the room page =================
// Served to guests from the guest server as /r/<room> and to people at home from
// the main server as /watch.html?room=<room> (see rooms.js). The server keeps the
// room's playback state ({ playing, position, updatedAt }); every page plays along
// with it and corrects drift. Who may control playback, chat, react or remove
// people depends on the role the host gives them.
// Plain ES2018 (no ?. / ??) like the rest of FilmBox.

;(function () {
  'use strict'

  const $ = id => document.getElementById(id)
  const video = $('video')
  const ON_MAIN = !/^\/r\//.test(location.pathname)       // the home server (not the guest one)
  const ROOM = (/^\/r\/([\w-]{10,40})/.exec(location.pathname) || [])[1] || new URLSearchParams(location.search).get('room') || ''
  const API = '/api/rooms/' + encodeURIComponent(ROOM)
  const CRED_KEY = 'filmbox_room_' + ROOM
  const ROLE_NAMES = { host: 'Hostitel', moderator: 'Moderátor', viewer: 'Divák' }
  const PERM_NAMES = { control: 'Ovládat přehrávání a pouštět filmy', chat: 'Psát do chatu', react: 'Posílat reakce', suggest: 'Navrhovat filmy', kick: 'Odebírat lidi' }

  let creds = null              // { id, secret }
  let es = null
  let me = null                 // { id, name, role, perms }
  let room = null               // { id, hostId, settings, emoji, link, publicLink }
  let videoInfo = null
  let videoVersion = 0
  let state = { playing: false, position: 0, updatedAt: Date.now() }
  let offset = 0                // server clock − our clock
  let members = []
  let qualityIdx = 0
  let viaProxy = false
  let subIdx = -1
  let blocked = false           // autoplay refused until the next tap
  let buffering = false
  let unread = 0
  let activeTab = 'chat'
  let ended = false
  let poll = { items: [], finding: null, error: null }
  let lastPollError = null

  function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, '0')
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec
  }
  function toast(msg, ms) {
    const t = $('toast')
    t.textContent = msg
    t.classList.add('show')
    clearTimeout(t._t)
    t._t = setTimeout(() => t.classList.remove('show'), ms || 2600)
  }
  function avatarColor(name) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
    return 'hsl(' + h + ', 55%, 45%)'
  }

  // ── API ──
  function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' }
    if (creds) headers['X-Room-Member'] = creds.id + '.' + creds.secret
    return fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(r =>
      r.json().catch(() => ({})).then(b => {
        if (!r.ok) { const e = new Error(b.error || 'Chyba serveru'); e.status = r.status; throw e }
        return b
      }))
  }
  const authQuery = () => 'm=' + encodeURIComponent(creds.id) + '&s=' + encodeURIComponent(creds.secret)

  // ── Join ──
  function showJoin(info) {
    $('join').style.display = ''
    $('app').style.display = 'none'
    $('join-title').textContent = info.title + (info.episodeLabel && info.title.indexOf(info.episodeLabel) < 0 ? ' ' + info.episodeLabel : '')
    $('join-sub').textContent = (info.host ? 'Zve vás ' + info.host : 'Místnost') + ' · ' + info.count + (info.count === 1 ? ' člověk' : info.count < 5 ? ' lidé' : ' lidí') + ' uvnitř'
    if (info.posterPath) { $('join-poster').src = 'https://image.tmdb.org/t/p/w342' + info.posterPath; $('join-poster').style.display = '' }
    if (info.locked) { $('join-error').textContent = 'Hostitel místnost zamkl — noví lidé se teď připojit nemohou.'; return }
    if (info.full) { $('join-error').textContent = 'Místnost je plná.'; return }
    $('join-form').style.display = ''
    $('join-name').value = lsGet('filmbox_room_name') || profileName() || ''
    $('join-name').focus()
  }
  function profileName() {
    try { const p = JSON.parse(sessionStorage.getItem('filmbox_active_profile') || 'null'); return p && p.name } catch (e) { return null }
  }

  $('join-form').addEventListener('submit', e => {
    e.preventDefault()
    const name = $('join-name').value.trim()
    if (!name) return
    lsSet('filmbox_room_name', name)
    // This tap is what lets the video play with sound later.
    unlockPlayback()
    api('POST', '/join', { name }).then(res => {
      creds = res.member
      lsSet(CRED_KEY, JSON.stringify(creds))
      connect()
    }).catch(err => { $('join-error').textContent = err.message })
  })

  function unlockPlayback() {
    try {
      const p = video.play()
      if (p && p.catch) p.catch(() => {})
    } catch (e) {}
  }

  // ── Connection ──
  function connect() {
    if (es) es.close()
    es = new EventSource(API + '/events?' + authQuery())
    es.onmessage = e => {
      let msg
      try { msg = JSON.parse(e.data) } catch (err) { return }
      handle(msg)
    }
    es.onerror = () => {
      if (ended || es.readyState !== EventSource.CLOSED) return     // reconnecting by itself
      // Closed for good: the room ended, or these credentials are no longer valid.
      fetch(API).then(r => {
        if (r.status === 404) return end('Místnost skončila', 'Hostitel ji ukončil nebo vypršela.')
        lsSet(CRED_KEY, null)
        creds = null
        return r.json().then(showJoin)
      }).catch(() => setTimeout(connect, 3000))
    }
  }

  function handle(msg) {
    if (msg.serverTime) offset = msg.serverTime - Date.now()
    switch (msg.type) {
      case 'hello':
        me = msg.you
        room = msg.room
        members = msg.members
        $('join').style.display = 'none'
        $('app').style.display = ''
        $('chat-list').innerHTML = ''
        msg.chat.forEach(m => addChat(m, true))
        poll = msg.poll || poll
        renderAll()
        if (msg.videoVersion !== videoVersion) loadVideo(msg.video, msg.videoVersion)
        applyState(msg.state)
        break
      case 'sync':
        applyState(msg.state)
        if (msg.by && me && msg.by.id !== me.id) stageMsg(msg.by.name + ' ' + ({ play: 'spustil přehrávání', pause: 'pozastavil', seek: 'přetočil na ' + fmt(msg.state.position) })[msg.action])
        break
      case 'video':
        loadVideo(msg.video, msg.videoVersion)
        applyState(msg.state)
        if (!msg.refreshed && msg.video) stageMsg('Hraje: ' + msg.video.title)
        break
      case 'poll':
        poll = msg.poll
        renderPoll()
        if (poll.error && poll.error !== lastPollError) toast(poll.error, 6000)
        lastPollError = poll.error
        break
      case 'members':
        members = msg.members
        renderPeople()
        renderStatus()
        break
      case 'you':
        me = msg.you
        room.settings = msg.settings
        renderAll()
        break
      case 'chat': addChat(msg.message); break
      case 'reaction': floatReaction(msg.emoji, msg.from.name); break
      case 'kicked': end('Byli jste odebráni', 'Hostitel vás z místnosti odebral.'); break
      case 'left': end('Odešli jste z místnosti', ''); break
      case 'closed': end('Místnost skončila', msg.reason || ''); break
    }
  }

  function end(title, sub) {
    ended = true
    if (es) es.close()
    lsSet(CRED_KEY, null)
    video.pause()
    $('app').style.display = 'none'
    $('join').style.display = 'none'
    $('invite').style.display = 'none'
    $('ended').style.display = ''
    $('ended-title').textContent = title
    $('ended-sub').textContent = sub
    if (ON_MAIN) $('ended-home').style.display = ''
  }

  // ── Video ──
  // The best quality up to 1080p (720p on small screens — it starts faster);
  // if every one is bigger, the smallest.
  function pickQuality(list) {
    const cap = Math.max(window.screen.width, window.screen.height) * (window.devicePixelRatio || 1) > 1500 ? 1080 : 720
    let best = -1
    list.forEach((q, i) => { if ((q.res || 0) <= cap && (best < 0 || (q.res || 0) > (list[best].res || 0))) best = i })
    if (best >= 0) return best
    let small = 0
    list.forEach((q, i) => { if ((q.res || 0) < (list[small].res || 0)) small = i })
    return small
  }
  function srcFor(i) {
    return viaProxy ? API + '/stream/' + i + '?' + authQuery() : videoInfo.qualities[i].src
  }
  function loadVideo(v, version) {
    videoVersion = version
    if (!v) {                                         // no film: choosing one together
      videoInfo = null
      video.removeAttribute('src')
      video.querySelectorAll('track').forEach(t => t.remove())
      video.load()
      setLobby(true)
      return
    }
    // Fresh links for the same video keep the chosen quality; anything new starts over.
    const keepQuality = videoInfo && videoInfo.title === v.title && videoInfo.qualities.length === v.qualities.length
    videoInfo = v
    setLobby(false)
    videoVersion = version
    viaProxy = false
    if (!keepQuality) qualityIdx = pickQuality(v.qualities)
    $('title').textContent = v.title
    document.title = v.title + ' — Sledujeme společně'
    // Subtitles: one <track> each, from the room's own route.
    video.querySelectorAll('track').forEach(t => t.remove())
    v.subtitles.forEach((s, i) => {
      const t = document.createElement('track')
      t.kind = 'subtitles'
      t.label = s.label
      t.srclang = (s.lang || 'cs').slice(0, 2).toLowerCase()
      t.src = API + '/subtitle/' + i + '?' + authQuery()
      video.appendChild(t)
    })
    if (subIdx >= v.subtitles.length) subIdx = -1
    applySubs()
    setSrc()
    renderNextButton()
    renderGear()
  }
  function setSrc() {
    video.src = srcFor(qualityIdx)
    video.load()
  }
  // A link that fails: try the server's proxy once, then ask the server for fresh links.
  let refreshing = false
  video.addEventListener('error', () => {
    if (!videoInfo || !video.currentSrc) return
    if (!viaProxy) {
      // Through FilmBox's server = through the host's home upload: keep it light.
      viaProxy = true
      let light = -1                                   // the best of the ≤ 720p versions
      videoInfo.qualities.forEach((q, i) => {
        if ((q.res || 0) <= 720 && (light < 0 || (q.res || 0) > (videoInfo.qualities[light].res || 0))) light = i
      })
      if (light >= 0 && (videoInfo.qualities[qualityIdx].res || 0) > 720) qualityIdx = light
      toast('Video jde přes server hostitele — může se načítat pomaleji', 5000)
      renderGear()
      setSrc()
      return
    }
    if (refreshing) return
    refreshing = true
    toast('Obnovuji odkaz na video…')
    api('POST', '/refresh').catch(err => toast(err.message, 4000)).then(() => { refreshing = false })
  })
  video.addEventListener('loadedmetadata', () => { sync(true); renderTime() })

  function applySubs() {
    for (let i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = i === subIdx ? 'showing' : 'disabled'
  }

  // ── Sync ──
  const now = () => Date.now() + offset
  function target() {
    let t = state.position + (state.playing ? (now() - state.updatedAt) / 1000 : 0)
    if (isFinite(video.duration)) t = Math.min(t, video.duration - 0.25)
    return Math.max(0, t)
  }
  function applyState(s) {
    state = s
    sync(true)
    renderPlay()
  }
  // Plays along with the room:
  //  - behind by more than 3 s → one jump, aimed ahead by how long jumps take to load
  //    here (at most every 8 s; nothing else happens while a jump is loading — on a
  //    slow line, jumping again every second kept the video loading for ever);
  //  - ahead by 1.5–15 s → wait there (that part is already loaded) instead of jumping back;
  //  - close → catch up / ease back with a slightly different speed.
  // Play / pause / seek from someone in the room (force) always apply at once.
  let seekLead = 0              // seconds a jump takes to start playing on this connection
  let seekAt = 0                // when the current jump started (0 = none pending)
  let lastJump = 0
  let holdUntil = 0             // waiting for the room to catch up
  function sync(force) {
    if (!videoInfo || video.readyState < 1) return
    if (force) holdUntil = 0
    const loading = video.seeking || buffering
    if (force || !loading) {
      const t = target()
      const diff = video.currentTime - t
      const off = Math.abs(diff)
      const jump = force ? off > 1 : ((diff < -3 || diff > 15) && Date.now() - lastJump > 8000)
      if (jump) {
        const dur = isFinite(video.duration) ? video.duration - 0.25 : Infinity
        lastJump = Date.now()
        seekAt = state.playing ? Date.now() : 0
        video.currentTime = Math.min(dur, t + (state.playing ? seekLead : 0))
        video.playbackRate = 1
      } else if (state.playing && !loading && diff > 1.5 && !holdUntil) {
        holdUntil = Date.now() + diff * 1000
        video.pause()
      } else if (state.playing && !loading && off > 0.25) {
        video.playbackRate = diff > 0 ? (diff > 1 ? 0.9 : 0.95) : (diff < -1 ? 1.1 : 1.05)
      } else if (!loading) {
        video.playbackRate = 1
      }
    }
    if (holdUntil && Date.now() >= holdUntil) holdUntil = 0
    if (state.playing && video.paused && !blocked && !video.ended && !holdUntil) {
      const p = video.play()
      if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') setBlocked(true) })
    } else if (!state.playing && !video.paused) {
      video.pause()
    }
  }
  setInterval(() => { if (!document.hidden) sync(false) }, 1000)

  function setBlocked(b) {
    blocked = b
    $('tap-play').style.display = b ? '' : 'none'
  }
  $('tap-play-btn').addEventListener('click', () => {
    setBlocked(false)
    sync(true)
    if (state.playing) video.play().catch(() => setBlocked(true))
  })

  // ── Controls (for those allowed; everyone else just watches) ──
  const canControl = () => !!(me && me.perms.control)
  function act(type, position) {
    if (!canControl()) { toast('Přehrávání ovládá ' + (room && room.settings.perms.moderator.control ? 'hostitel a moderátoři' : 'hostitel')); return }
    const t = now()
    // Locally right away; the server's echo confirms it.
    const pos = position != null ? position : video.currentTime
    if (type === 'play') applyState({ playing: true, position: pos, updatedAt: t })
    if (type === 'pause') applyState({ playing: false, position: pos, updatedAt: t })
    if (type === 'seek') applyState({ playing: state.playing, position: pos, updatedAt: t })
    api('POST', '/action', { type, position: pos }).catch(err => toast(err.message))
  }
  function togglePlay() { if (videoInfo) act(state.playing ? 'pause' : 'play') }
  function seekBy(d) {
    const dur = isFinite(video.duration) ? video.duration : Infinity
    act('seek', Math.max(0, Math.min(dur - 1, target() + d)))
  }
  $('play-btn').addEventListener('click', togglePlay)
  $('back-btn').addEventListener('click', () => seekBy(-10))
  $('fwd-btn').addEventListener('click', () => seekBy(10))
  video.addEventListener('click', () => { if (blocked) return; togglePlay() })
  $('seek').addEventListener('click', e => {
    if (!isFinite(video.duration)) return
    const r = $('seek').getBoundingClientRect()
    act('seek', Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * video.duration)
  })
  // ── Volume: everyone sets their own; remembered on this device, never sent to the room ──
  function renderVolume() {
    const quiet = video.muted || video.volume === 0
    $('mute-btn').innerHTML = '<i class="bi ' + (quiet ? 'bi-volume-mute-fill' : video.volume < 0.5 ? 'bi-volume-down-fill' : 'bi-volume-up-fill') + '"></i>'
    $('volume').value = video.muted ? 0 : video.volume
  }
  function setVolume(v, announce) {
    video.volume = Math.max(0, Math.min(1, Math.round(v * 100) / 100))
    video.muted = video.volume === 0
    lsSet('filmbox_room_volume', String(video.volume))
    lsSet('filmbox_room_muted', video.muted ? '1' : '0')
    renderVolume()
    if (announce) toast('Hlasitost ' + Math.round(video.volume * 100) + ' % (jen u vás)', 1200)
  }
  ;(function restoreVolume() {
    const v = parseFloat(lsGet('filmbox_room_volume'))
    if (isFinite(v)) video.volume = Math.max(0, Math.min(1, v))
    video.muted = lsGet('filmbox_room_muted') === '1'
    renderVolume()
  })()
  $('volume').addEventListener('input', e => setVolume(parseFloat(e.target.value)))
  $('mute-btn').addEventListener('click', () => {
    if (video.muted || video.volume === 0) setVolume(video.volume || 0.5)
    else { video.muted = true; lsSet('filmbox_room_muted', '1'); renderVolume() }
  })
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => act('play'))
      navigator.mediaSession.setActionHandler('pause', () => act('pause'))
    } catch (e) {}
  }

  // Fullscreen: the stage (video + reactions + chat bubbles); iPhone only does the bare video.
  $('fs-btn').addEventListener('click', () => {
    const st = $('stage')
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return }
    const req = st.requestFullscreen || st.webkitRequestFullscreen
    if (req) { const p = req.call(st); if (p && p.catch) p.catch(() => {}) }
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen()
  })

  // Gear: quality + subtitles (just for this device).
  function renderGear() {
    const menu = $('gear-menu')
    if (!videoInfo) return
    let html = (viaProxy ? '<div class="menu-note">Přes server hostitele — při sekání zkuste nižší kvalitu</div>' : '') +
      '<div class="menu-title">Kvalita</div>' + videoInfo.qualities.map((q, i) =>
      `<button data-q="${i}" class="${i === qualityIdx ? 'on' : ''}"><i class="bi bi-check-lg"></i>${esc(q.label || (q.res ? q.res + 'p' : 'Zdroj ' + (i + 1)))}</button>`).join('')
    if (videoInfo.subtitles.length) {
      html += '<div class="menu-title">Titulky</div>' +
        `<button data-sub="-1" class="${subIdx < 0 ? 'on' : ''}"><i class="bi bi-check-lg"></i>Vypnuté</button>` +
        videoInfo.subtitles.map((s, i) => `<button data-sub="${i}" class="${i === subIdx ? 'on' : ''}"><i class="bi bi-check-lg"></i>${esc(s.label)}</button>`).join('')
    }
    menu.innerHTML = html
  }
  $('gear-btn').addEventListener('click', e => { e.stopPropagation(); $('gear-menu').classList.toggle('open') })
  document.addEventListener('click', () => $('gear-menu').classList.remove('open'))
  $('gear-menu').addEventListener('click', e => {
    e.stopPropagation()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.q != null) {
      qualityIdx = Number(b.dataset.q)
      setSrc()                                        // sync() puts it back at the room's position
    } else if (b.dataset.sub != null) {
      subIdx = Number(b.dataset.sub)
      applySubs()
    }
    renderGear()
  })

  // ── Status reports: position + buffering for the people list ──
  function presence() {
    if (!creds || ended) return
    api('POST', '/presence', { position: video.currentTime || 0, buffering }).catch(() => {})
  }
  setInterval(presence, 5000)
  function setBuffering(b) {
    $('spinner').classList.toggle('show', b)
    if (b === buffering) return
    buffering = b
    presence()
  }
  video.addEventListener('waiting', () => setBuffering(true))
  video.addEventListener('playing', () => {
    setBuffering(false)
    // Learn how long a jump takes here, so the next one lands where the room will be.
    if (seekAt) {
      // Capped: an overshoot only means waiting a moment, but not for long.
      const took = Math.min(6, (Date.now() - seekAt) / 1000)
      seekLead = seekLead ? seekLead * 0.5 + took * 0.5 : took
      seekAt = 0
    }
  })
  video.addEventListener('canplay', () => setBuffering(false))
  video.addEventListener('seeked', () => { if (video.readyState >= 3) setBuffering(false) })
  video.addEventListener('timeupdate', renderTime)
  video.addEventListener('progress', renderTime)
  video.addEventListener('play', renderPlay)
  video.addEventListener('pause', renderPlay)

  // ── Rendering ──
  function renderAll() {
    renderStatus()
    renderPlay()
    renderPeople()
    renderReactBar()
    renderSettings()
    renderNextButton()
    renderPoll()
    renderLobbyButton()
    $('chat-form').style.display = me.perms.chat ? '' : 'none'
    $('settings-tab').style.display = me.role === 'host' ? '' : 'none'
    $('leave-btn').innerHTML = me.role === 'host' ? '<i class="bi bi-x-circle"></i><span> Ukončit</span>' : '<i class="bi bi-box-arrow-right"></i><span> Odejít</span>'
    if (activeTab === 'settings' && me.role !== 'host') showTab('chat')
  }
  function renderStatus() {
    const online = members.filter(m => m.online).length
    $('room-status').textContent = online + (online === 1 ? ' divák' : online < 5 ? ' diváci' : ' diváků') + (me ? ' · ' + ROLE_NAMES[me.role] : '')
    $('people-count').textContent = online
  }
  function renderPlay() {
    $('play-btn').innerHTML = '<i class="bi ' + (state.playing ? 'bi-pause-fill' : 'bi-play-fill') + '"></i>'
    const can = canControl()
    $('stage').classList.toggle('no-control', !can)
    $('control-note').textContent = can ? '' : 'Ovládá ' + (room && room.settings.perms.moderator.control ? 'hostitel a moderátoři' : 'hostitel')
  }
  function renderTime() {
    const d = isFinite(video.duration) ? video.duration : 0
    $('time').textContent = fmt(video.currentTime) + ' / ' + fmt(d)
    $('seek-fill').style.width = d ? (video.currentTime / d * 100) + '%' : '0'
    let buf = 0
    try { if (video.buffered.length) buf = video.buffered.end(video.buffered.length - 1) } catch (e) {}
    $('seek-buf').style.width = d ? Math.min(100, buf / d * 100) + '%' : '0'
  }
  function renderPeople() {
    const list = members.slice().sort((a, b) => ({ host: 0, moderator: 1, viewer: 2 })[a.role] - ({ host: 0, moderator: 1, viewer: 2 })[b.role] || a.name.localeCompare(b.name))
    const rank = { host: 3, moderator: 2, viewer: 1 }
    $('people').innerHTML = list.map(m => {
      const self = me && m.id === me.id
      const status = !m.online ? 'odpojen' : m.buffering ? 'načítá…' : ''
      let tools = ''
      if (me && !self && m.role !== 'host') {
        if (me.role === 'host') {
          tools += `<select class="role-select" data-mid="${esc(m.id)}" aria-label="Role">
            <option value="moderator"${m.role === 'moderator' ? ' selected' : ''}>Moderátor</option>
            <option value="viewer"${m.role === 'viewer' ? ' selected' : ''}>Divák</option></select>`
        }
        if (me.perms.kick && rank[m.role] < rank[me.role]) tools += `<button class="kick" data-mid="${esc(m.id)}" data-name="${esc(m.name)}" title="Odebrat z místnosti" aria-label="Odebrat ${esc(m.name)}"><i class="bi bi-person-x-fill"></i></button>`
      }
      return `
        <li class="${m.online ? '' : 'offline'}">
          <span class="avatar" style="background:${avatarColor(m.name)}">${esc(m.name.charAt(0).toUpperCase())}</span>
          <span class="who"><b>${esc(m.name)}${self ? ' <small>(vy)</small>' : ''}</b><small class="role ${m.role}">${ROLE_NAMES[m.role]}${status ? ' · ' + status : ''}</small></span>
          ${tools}
        </li>`
    }).join('')
  }
  $('people').addEventListener('change', e => {
    const sel = e.target.closest('.role-select')
    if (sel) api('POST', '/members/' + encodeURIComponent(sel.dataset.mid), { role: sel.value }).catch(err => toast(err.message))
  })
  $('people').addEventListener('click', e => {
    const b = e.target.closest('.kick')
    if (!b) return
    if (!window.confirm('Odebrat ' + b.dataset.name + ' z místnosti?')) return
    api('DELETE', '/members/' + encodeURIComponent(b.dataset.mid)).catch(err => toast(err.message))
  })

  // Host: lock, role for newcomers and what each role may do.
  function renderSettings() {
    const panel = $('panel-settings')
    if (!me || me.role !== 'host') { panel.innerHTML = ''; return }
    const s = room.settings
    const row = perm => `
      <tr><th scope="row">${PERM_NAMES[perm]}</th>
        ${['moderator', 'viewer'].map(r => `<td><input type="checkbox" data-role="${r}" data-perm="${perm}"${s.perms[r][perm] ? ' checked' : ''} aria-label="${ROLE_NAMES[r]}: ${PERM_NAMES[perm]}"></td>`).join('')}</tr>`
    panel.innerHTML = `
      <label class="toggle"><input type="checkbox" id="set-locked"${s.locked ? ' checked' : ''}><span>Zamknout místnost <small>nikdo nový se nepřipojí</small></span></label>
      <div class="set-group">
        <span class="set-label">Noví lidé přicházejí jako</span>
        <div class="segmented" id="set-default">
          <button data-role="viewer" class="${s.defaultRole === 'viewer' ? 'active' : ''}">Divák</button>
          <button data-role="moderator" class="${s.defaultRole === 'moderator' ? 'active' : ''}">Moderátor</button>
        </div>
      </div>
      <div class="set-group">
        <span class="set-label">Co smí jednotlivé role</span>
        <table class="perm-table">
          <thead><tr><th></th><th scope="col">Moderátor</th><th scope="col">Divák</th></tr></thead>
          <tbody>${['control', 'suggest', 'chat', 'react', 'kick'].map(row).join('')}</tbody>
        </table>
        <p class="muted small">Hostitel smí vždy všechno. Role jednotlivých lidí měníte v záložce Lidé.</p>
      </div>
      <button class="btn btn-danger" id="set-close"><i class="bi bi-x-circle"></i> Ukončit místnost pro všechny</button>`
  }
  function saveSettings(change) {
    api('POST', '/settings', change).catch(err => { toast(err.message); renderSettings() })
  }
  $('panel-settings').addEventListener('change', e => {
    const t = e.target
    if (t.id === 'set-locked') saveSettings({ locked: t.checked })
    else if (t.dataset.perm) {
      const perms = {}
      perms[t.dataset.role] = {}
      perms[t.dataset.role][t.dataset.perm] = t.checked
      saveSettings({ perms })
    }
  })
  $('panel-settings').addEventListener('click', e => {
    const b = e.target.closest('#set-default [data-role]')
    if (b) { saveSettings({ defaultRole: b.dataset.role }); return }
    if (e.target.closest('#set-close')) closeRoom()
  })

  // ── Choosing a film together ──
  // The poll shows big on the stage while there's no film, and in the "Výběr" tab
  // (for the next film) while one plays. Each place has its own search box.
  function setLobby(on) {
    $('app').classList.toggle('lobby-mode', on)
    $('lobby').style.display = on ? '' : 'none'
    $('controls').style.display = on ? 'none' : ''
    $('poll-tab').style.display = on ? 'none' : ''
    if (on) {
      $('title').textContent = 'Vybíráme film'
      document.title = 'Vybíráme film — Sledujeme společně'
      setBuffering(false)
      if (activeTab === 'poll') showTab('chat')
    }
    renderLobbyButton()
    renderNextButton()
    renderGear()
  }
  function renderLobbyButton() {
    $('lobby-btn').style.display = me && me.role === 'host' && videoInfo ? '' : 'none'
  }
  $('lobby-btn').addEventListener('click', () => {
    if (!window.confirm('Zastavit film pro všechny a vybírat jiný?')) return
    api('POST', '/lobby').catch(err => toast(err.message))
  })

  const pollBoxes = [$('poll-lobby'), $('poll-side')]
  pollBoxes.forEach(box => {
    box.innerHTML = `
      <div class="poll-head"><h3></h3><p class="muted"></p></div>
      <div class="poll-status"></div>
      <div class="poll-search">
        <div class="poll-search-row">
          <i class="bi bi-search"></i>
          <input class="field poll-q" type="search" maxlength="100" placeholder="Navrhnout film — napište název…" autocomplete="off" aria-label="Hledat film k navržení" />
        </div>
        <div class="poll-results"></div>
      </div>
      <ol class="poll-items"></ol>
      <div class="poll-foot"></div>`
    let timer = null, seq = 0
    const input = box.querySelector('.poll-q')
    const results = box.querySelector('.poll-results')
    function search() {
      const q = input.value.trim()
      const my = ++seq
      api('GET', '/search?q=' + encodeURIComponent(q)).then(r => {
        if (my !== seq) return
        const inPoll = {}
        poll.items.forEach(i => { inPoll[i.tmdbId] = true })
        results.innerHTML = (r.trending ? '<div class="pr-head">Tipy tohoto týdne</div>' : '') + (r.results.length ? r.results.map(f => `
          <button class="pr" data-tmdb="${f.tmdbId}"${inPoll[f.tmdbId] ? ' disabled' : ''}>
            ${f.posterPath ? `<img src="https://image.tmdb.org/t/p/w92${esc(f.posterPath)}" alt="" loading="lazy">` : '<span class="pr-noposter"><i class="bi bi-film"></i></span>'}
            <span class="pr-text"><b>${esc(f.title)}</b><small>${esc([f.year, f.rating ? '★ ' + f.rating : ''].filter(Boolean).join(' · '))}</small></span>
            <span class="pr-add">${inPoll[f.tmdbId] ? 'V hlasování' : '<i class="bi bi-plus-lg"></i> Navrhnout'}</span>
          </button>`).join('') : '<div class="pr-none">Nic jsme nenašli</div>')
      }).catch(err => { if (my === seq) results.innerHTML = '<div class="pr-none">' + esc(err.message) + '</div>' })
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 300) })
    input.addEventListener('focus', () => { if (!results.innerHTML) search() })
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; results.innerHTML = ''; input.blur() } })
    results.addEventListener('click', e => {
      const b = e.target.closest('.pr')
      if (!b || b.disabled) return
      b.disabled = true
      const typed = input.value
      api('POST', '/poll', { tmdbId: Number(b.dataset.tmdb) }).then(() => {
        // Clear the search — unless the next one is already being typed.
        if (input.value !== typed) return
        input.value = ''
        results.innerHTML = ''
      }).catch(err => { b.disabled = false; toast(err.message) })
    })
    box.querySelector('.poll-items').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]')
      if (!b) return
      const id = encodeURIComponent(b.dataset.id)
      if (b.dataset.act === 'vote') api('POST', '/poll/' + id + '/vote').catch(err => toast(err.message))
      else if (b.dataset.act === 'remove') api('DELETE', '/poll/' + id).catch(err => toast(err.message))
      else if (b.dataset.act === 'play') startFromPoll(b.dataset.id, b.dataset.title)
    })
    box.querySelector('.poll-foot').addEventListener('click', e => {
      const b = e.target.closest('[data-act="play"]')
      if (b) startFromPoll(b.dataset.id, b.dataset.title)
    })
  })

  function startFromPoll(id, title) {
    if (videoInfo && !window.confirm('Zastavit „' + videoInfo.title + '“ a pustit „' + title + '“?')) return
    api('POST', '/poll/' + encodeURIComponent(id) + '/play').catch(err => toast(err.message))
  }

  function renderPoll() {
    if (!me) return
    const items = poll.items
    const leader = items.length && items[0].votes > 0 ? items[0] : null
    const top = items.reduce((n, i) => Math.max(n, i.votes), 0)
    const canPlay = me.perms.control
    $('poll-count').textContent = items.length ? String(items.length) : ''
    pollBoxes.forEach(box => {
      const big = box.id === 'poll-lobby'
      box.querySelector('.poll-head h3').textContent = big ? 'Co budeme sledovat?' : 'Další film'
      box.querySelector('.poll-head p').textContent = me.perms.suggest
        ? 'Navrhněte film a hlasujte — každý má 1 hlas, jde změnit.'
        : 'Hlasujte pro film — každý má 1 hlas, jde změnit.'
      box.querySelector('.poll-search').style.display = me.perms.suggest ? '' : 'none'
      box.querySelector('.poll-status').innerHTML = poll.finding
        ? `<i class="bi bi-arrow-repeat spin"></i> Hledám video pro „${esc(poll.finding)}“…`
        : poll.error ? `<i class="bi bi-exclamation-triangle"></i> ${esc(poll.error)}` : ''
      box.querySelector('.poll-status').className = 'poll-status' + (poll.finding ? ' finding' : poll.error ? ' error' : '')
      box.querySelector('.poll-items').innerHTML = items.length ? items.map(i => {
        const mine = i.voters.some(v => v.id === me.id)
        const removable = me.role === 'host' || i.by.id === me.id
        return `
          <li class="poll-item${leader && i.id === leader.id ? ' leader' : ''}${mine ? ' mine' : ''}">
            ${i.posterPath ? `<img src="https://image.tmdb.org/t/p/w92${esc(i.posterPath)}" alt="" loading="lazy">` : '<span class="pi-noposter"><i class="bi bi-film"></i></span>'}
            <div class="pi-text">
              <b>${esc(i.title)}</b>
              <small>${esc([i.year, i.rating ? '★ ' + i.rating : '', 'navrhl(a) ' + i.by.name].filter(Boolean).join(' · '))}</small>
              <div class="pi-bar"><span style="width:${top ? (i.votes / top * 100).toFixed(0) : 0}%"></span></div>
              <small class="pi-voters">${i.voters.length ? esc(i.voters.map(v => v.name).join(', ')) : 'zatím bez hlasů'}</small>
            </div>
            <div class="pi-actions">
              <button class="pi-vote${mine ? ' on' : ''}" data-act="vote" data-id="${esc(i.id)}" aria-pressed="${mine}" title="${mine ? 'Vzít hlas zpět' : 'Hlasovat pro tento film'}">
                <i class="bi ${mine ? 'bi-hand-thumbs-up-fill' : 'bi-hand-thumbs-up'}"></i><span>${i.votes}</span>
              </button>
              ${canPlay ? `<button class="pi-play" data-act="play" data-id="${esc(i.id)}" data-title="${esc(i.title)}" title="Pustit teď všem"${poll.finding ? ' disabled' : ''}><i class="bi bi-play-fill"></i></button>` : ''}
              ${removable ? `<button class="pi-remove" data-act="remove" data-id="${esc(i.id)}" title="Odebrat návrh"><i class="bi bi-x-lg"></i></button>` : ''}
            </div>
          </li>`
      }).join('') : `<p class="poll-empty">${me.perms.suggest ? 'Zatím žádné návrhy — vyhledejte film nahoře.' : 'Zatím žádné návrhy.'}</p>`
      box.querySelector('.poll-foot').innerHTML = canPlay && leader
        ? `<button class="btn btn-primary poll-winner" data-act="play" data-id="${esc(leader.id)}" data-title="${esc(leader.title)}"${poll.finding ? ' disabled' : ''}><i class="bi bi-trophy-fill"></i> Pustit vítěze: ${esc(leader.title)} (${leader.votes})</button>`
        : !canPlay && items.length ? '<p class="muted small">Film pustí hostitel' + (room && room.settings.perms.moderator.control ? ' nebo moderátor' : '') + '.</p>' : ''
    })
  }

  // ── Tabs ──
  function showTab(tab) {
    activeTab = tab
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
    ;['chat', 'poll', 'people', 'settings'].forEach(t => { $('panel-' + t).style.display = t === tab ? '' : 'none' })
    if (tab === 'chat') { unread = 0; renderUnread(); scrollChat(true) }
  }
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]')
    if (b) showTab(b.dataset.tab)
  })

  // ── Chat ──
  function scrollChat(force) {
    const l = $('chat-list')
    if (force || l.scrollHeight - l.scrollTop - l.clientHeight < 80) l.scrollTop = l.scrollHeight
  }
  function addChat(m, history) {
    const el = document.createElement('div')
    const time = new Date(m.at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    if (m.system) {
      el.className = 'msg system'
      el.textContent = m.text
    } else {
      el.className = 'msg' + (me && m.from.id === me.id ? ' mine' : '')
      el.innerHTML = `<span class="msg-head"><b style="color:${avatarColor(m.from.name)}">${esc(m.from.name)}</b>${m.from.role !== 'viewer' ? `<small class="role ${m.from.role}">${ROLE_NAMES[m.from.role]}</small>` : ''}<time>${time}</time></span><span class="msg-text"></span>`
      el.querySelector('.msg-text').textContent = m.text
    }
    const l = $('chat-list')
    const atBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 80
    l.appendChild(el)
    while (l.children.length > 200) l.removeChild(l.firstChild)
    if (atBottom || history) l.scrollTop = l.scrollHeight
    if (history || m.system) return
    if (activeTab !== 'chat' || !isVisible($('panel-chat'))) { unread++; renderUnread() }
    stageChat(m)
  }
  function isVisible(el) { return !!(el.offsetWidth || el.offsetHeight) }
  function renderUnread() { $('chat-unread').textContent = unread ? String(unread) : '' }
  $('chat-form').addEventListener('submit', e => {
    e.preventDefault()
    const input = $('chat-input')
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    api('POST', '/chat', { text }).catch(err => { toast(err.message); if (!input.value) input.value = text })
  })

  // In fullscreen (or a phone held sideways) the chat panel is gone: new messages
  // float over the video for a while.
  function stageChat(m) {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement
    if (!fsEl && isVisible(document.querySelector('.side'))) return
    const el = document.createElement('div')
    el.className = 'bubble'
    el.innerHTML = '<b></b> <span></span>'
    el.querySelector('b').textContent = m.from.name
    el.querySelector('span').textContent = m.text
    $('stage-chat').appendChild(el)
    while ($('stage-chat').children.length > 4) $('stage-chat').removeChild($('stage-chat').firstChild)
    setTimeout(() => el.classList.add('gone'), 7000)
    setTimeout(() => el.remove(), 7600)
  }

  function stageMsg(text) {
    const el = $('stage-msg')
    el.textContent = text
    el.classList.add('show')
    clearTimeout(el._t)
    el._t = setTimeout(() => el.classList.remove('show'), 2600)
  }

  // ── Reactions ──
  function renderReactBar() {
    const bar = $('react-bar')
    if (!me.perms.react) { bar.innerHTML = ''; bar.style.display = 'none'; return }
    bar.style.display = ''
    bar.innerHTML = room.emoji.map(e => `<button data-emoji="${e}" aria-label="Reakce ${e}">${e}</button>`).join('')
  }
  $('react-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-emoji]')
    if (b) api('POST', '/react', { emoji: b.dataset.emoji }).catch(err => toast(err.message))
  })
  function floatReaction(emoji, name) {
    const layer = $('reactions-layer')
    const el = document.createElement('div')
    el.className = 'float'
    el.style.left = (8 + Math.random() * 78) + '%'
    el.innerHTML = '<span class="e"></span><small></small>'
    el.querySelector('.e').textContent = emoji
    el.querySelector('small').textContent = name
    layer.appendChild(el)
    setTimeout(() => el.remove(), 3200)
  }

  // ── Invite ──
  function showInvite() {
    const link = (room && room.link) || location.origin + location.pathname + (ON_MAIN ? '?room=' + ROOM : '')
    $('invite-link').value = link
    $('invite-share').style.display = navigator.share ? '' : 'none'
    let note = ''
    if (room && !room.publicLink) {
      const host = (/^https?:\/\/([^/:]+)/.exec(link) || [])[1] || ''
      const tailnet = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || /\.ts\.net$/.test(host)
      note = (tailnet
        ? 'Tento odkaz vede na Tailscale adresu serveru — otevřou ho jen zařízení ve vaší síti Tailscale.'
        : 'Tento odkaz funguje jen na vaší domácí síti.') +
        (me && me.role === 'host'
          ? ' Pro přátele přes internet zapněte na serveru „sudo tailscale funnel --bg 3001“ — FilmBox si veřejnou adresu najde sám do půl minuty (nebo ji zadejte do PUBLIC_URL a server restartujte).'
          : '')
    }
    $('invite-note').textContent = note
    $('invite').style.display = ''
    $('invite-link').select()
  }
  // The current link (a Funnel switched on after the room opened shows up here).
  $('invite-btn').addEventListener('click', () => {
    fetch(API).then(r => (r.ok ? r.json() : null)).then(info => {
      if (info && info.link && room) { room.link = info.link; room.publicLink = info.public }
    }).catch(() => {}).then(showInvite)
  })
  $('invite-copy').addEventListener('click', () => {
    const input = $('invite-link')
    const done = () => toast('Odkaz zkopírován')
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); document.execCommand('copy'); done() })
    else { input.select(); document.execCommand('copy'); done() }
  })
  $('invite-share').addEventListener('click', () => {
    navigator.share({ title: 'Sledujme spolu: ' + (videoInfo ? videoInfo.title : 'FilmBox'), url: $('invite-link').value }).catch(() => {})
  })
  $('invite-close').addEventListener('click', () => { $('invite').style.display = 'none' })
  $('invite').addEventListener('click', e => { if (e.target.id === 'invite') $('invite').style.display = 'none' })

  // ── Leaving ──
  function closeRoom() {
    if (!window.confirm('Ukončit místnost pro všechny?')) return
    api('DELETE', '').catch(err => toast(err.message))
  }
  $('leave-btn').addEventListener('click', () => {
    if (me && me.role === 'host') { closeRoom(); return }
    const left = () => end('Odešli jste z místnosti', '')
    api('DELETE', '/members/' + encodeURIComponent(creds.id)).then(left, left)
  })

  // ── Host on the home server: next episode (searches like the player does) ──
  function renderNextButton() {
    const show = ON_MAIN && me && me.role === 'host' && videoInfo && videoInfo.episode && videoInfo.tmdbId
    $('next-btn').style.display = show ? '' : 'none'
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.FilmBoxRelevance) return resolve()
      const s = document.createElement('script')
      s.src = src
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
  }
  $('next-btn').addEventListener('click', async () => {
    const v = videoInfo
    const btn = $('next-btn')
    btn.disabled = true
    try {
      await loadScript('/js/relevance.js')
      const s = v.episode.season
      const n = v.episode.number + 1
      const code = 'S' + String(s).padStart(2, '0') + 'E' + String(n).padStart(2, '0')
      const base = v.title.replace(/\s*S\d{1,2}E\d{1,3}.*$/i, '').trim()
      toast('Hledám ' + code + '…', 6000)
      const results = await (await fetch('/search?q=' + encodeURIComponent(base + ' ' + code))).json()
      const epCode = new RegExp('s0?' + s + '\\s*e0?' + n + '(?!\\d)|\\b0?' + s + 'x0?' + n + '(?!\\d)', 'i')
      const exact = (Array.isArray(results) ? results : []).filter(r => r && r.url && epCode.test(r.title || ''))
      let settings = {}
      try { settings = (JSON.parse(sessionStorage.getItem('filmbox_active_profile') || '{}').settings) || {} } catch (e) {}
      const pick = window.FilmBoxRelevance.rankSources(exact, settings)[0]
      if (!pick) throw new Error('Díl ' + code + ' se nenašel')
      const vr = await fetch('/get_video?url=' + encodeURIComponent(pick.url))
      const source = await vr.json()
      if (!vr.ok || !source.qualities || !source.qualities.length) throw new Error(source.error || 'Video se nepodařilo načíst')
      await api('POST', '/video', {
        player: { title: base + ' ' + code, source, tmdbId: v.tmdbId, mediaType: 'tv', posterPath: v.posterPath, episode: { season: s, number: n }, episodeLabel: code, progressKey: v.tmdbId + ':' + code },
        position: 0
      })
    } catch (err) {
      toast(err.message, 4000)
    } finally {
      btn.disabled = false
    }
  })

  // ── Progress + watched time for whoever has a FilmBox profile here (home server) ──
  let played = 0, lastT = null
  video.addEventListener('timeupdate', () => {
    const t = video.currentTime
    if (!video.paused && !video.seeking && lastT != null && t - lastT > 0 && t - lastT < 3) played += t - lastT
    lastT = t
  })
  video.addEventListener('seeking', () => { lastT = null })
  function saveProgress(beacon) {
    if (!ON_MAIN || !videoInfo || !videoInfo.tmdbId) return
    let profile = null, token = null
    try {
      profile = JSON.parse(sessionStorage.getItem('filmbox_active_profile') || 'null')
      token = profile && (JSON.parse(sessionStorage.getItem('filmbox_tokens') || '{}'))[profile.id]
    } catch (e) {}
    if (!profile || !profile.id) return
    const base = '/api/profiles/' + profile.id
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['X-Profile-Token'] = token
    const q = token ? '?t=' + encodeURIComponent(token) : ''
    const post = (url, body, method) => {
      const json = JSON.stringify(body)
      if (beacon && navigator.sendBeacon) {
        try { if (navigator.sendBeacon(url + q, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return } catch (e) {}
      }
      fetch(url, { method: method || 'POST', headers, body: json, keepalive: !!beacon }).catch(() => {})
    }
    const seconds = Math.round(played)
    if (seconds >= 1) {
      played -= seconds
      post(base + '/watchtime', { seconds, tmdbId: videoInfo.tmdbId, mediaType: videoInfo.mediaType, title: videoInfo.title, posterPath: videoInfo.posterPath })
    }
    if (video.currentTime > 5 && isFinite(video.duration)) {
      const key = videoInfo.episodeLabel ? videoInfo.tmdbId + ':' + videoInfo.episodeLabel : String(videoInfo.tmdbId)
      post(base + '/progress/' + encodeURIComponent(key), {
        seconds: video.currentTime, duration: video.duration, title: videoInfo.title, posterPath: videoInfo.posterPath,
        mediaType: videoInfo.mediaType, tmdbId: videoInfo.tmdbId, episodeLabel: videoInfo.episodeLabel,
        finished: !!(videoInfo.episode && video.currentTime / video.duration >= 0.9)
      }, beacon ? 'POST' : 'PUT')
    }
  }
  setInterval(() => { if (!video.paused) saveProgress(false) }, 60000)
  video.addEventListener('pause', () => saveProgress(false))
  window.addEventListener('pagehide', () => saveProgress(true))

  // ── Keyboard / TV remote ──
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('app').style.display === 'none') return
    if ($('invite').style.display !== 'none') { if (e.key === 'Escape') $('invite').style.display = 'none'; return }
    const k = e.key
    if (k === ' ' || (k === 'Enter' && e.target === document.body)) { e.preventDefault(); togglePlay() }
    else if (k === 'ArrowLeft' && !e.target.closest('.side')) { e.preventDefault(); seekBy(-10) }
    else if (k === 'ArrowRight' && !e.target.closest('.side')) { e.preventDefault(); seekBy(10) }
    else if (k === 'ArrowUp' && !e.target.closest('.side')) { e.preventDefault(); setVolume((video.muted ? 0 : video.volume) + 0.1, true) }
    else if (k === 'ArrowDown' && !e.target.closest('.side')) { e.preventDefault(); setVolume((video.muted ? 0 : video.volume) - 0.1, true) }
    else if (k === 'f') $('fs-btn').click()
    else if (k === 'm') $('mute-btn').click()
  })

  // ── Start ──
  if (!ROOM) { end('Neplatný odkaz', 'V odkazu chybí místnost.'); return }
  try { creds = JSON.parse(lsGet(CRED_KEY) || 'null') } catch (e) { creds = null }
  if (creds && creds.id && creds.secret) {
    connect()
  } else {
    creds = null
    fetch(API).then(r => r.json().then(b => {
      if (!r.ok) return end('Místnost neexistuje', b.error || 'Odkaz už neplatí — místnost skončila.')
      showJoin(b)
    })).catch(() => { $('join-title').textContent = 'Server neodpovídá'; $('join-sub').textContent = 'Zkuste stránku načíst znovu.' })
  }
})()
