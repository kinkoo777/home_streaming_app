// ================= CAST RECEIVER — the TV side of "Pustit na TV" =================
// On a TV (or any device opened once with ?receiver=1; ?receiver=0 turns it off)
// both the home page and the player listen for commands from phones over
// Server-Sent Events (see cast.js on the server). "play" carries the same data the
// source picker hands the player, plus the profile to play as; the player page
// handles the remote commands through window.castCommand.
// Plain ES2017 — it also runs in the player, which old webOS app engines load.

;(function () {
  'use strict'

  function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) {} }

  const opt = /[?&]receiver=([01])/.exec(location.search)
  if (opt) lsSet('filmbox_receiver', opt[1])
  const pref = lsGet('filmbox_receiver')
  const isTv = document.body.classList.contains('tv')
  if (!(pref === '1' || (pref !== '0' && isTv)) || typeof EventSource === 'undefined') return

  function randomId() { return (Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 24) }
  function stored(k) {
    let v = lsGet(k)
    if (!v || !/^[a-z0-9]{8,40}$/.test(v)) { v = randomId(); lsSet(k, v) }
    return v
  }
  const id = stored('filmbox_cast_id')
  const key = stored('filmbox_cast_key')
  const UA = navigator.userAgent
  const name = lsGet('filmbox_cast_name') ||
    (/Web0S|webOS|NetCast|LG Browser|LGE/i.test(UA) || window.PalmSystem ? 'LG televize' : /Tizen|SMART-TV/i.test(UA) ? 'Samsung televize' : isTv ? 'Televize' : 'Přijímač ' + id.slice(0, 4))
  const page = /player\.html/.test(location.pathname) ? 'player' : 'home'

  function report(state) {
    try {
      fetch('/api/cast/' + id + '/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cast-Key': key },
        body: JSON.stringify(state)
      }).catch(function () {})
    } catch (e) {}
  }

  function startPlayback(cmd) {
    try {
      sessionStorage.setItem('filmbox_active_profile', JSON.stringify(cmd.profile))
      if (cmd.token) {
        const tokens = JSON.parse(sessionStorage.getItem('filmbox_tokens') || '{}')
        tokens[cmd.profile.id] = cmd.token
        sessionStorage.setItem('filmbox_tokens', JSON.stringify(tokens))
      }
      // castStart: where to begin (the phone already asked "resume?"); no resume prompt on the TV.
      sessionStorage.setItem('filmbox_player', JSON.stringify(Object.assign({}, cmd.player, { castStart: cmd.startAt || 0, autoplayChain: 0 })))
    } catch (e) { return }
    if (page === 'player') location.replace('player.html')
    else location.href = 'player.html'
  }

  const es = new EventSource('/api/cast/receiver?id=' + id + '&key=' + key + '&name=' + encodeURIComponent(name))
  es.onopen = function () { if (page === 'home') report({ page: 'home' }) }
  es.onmessage = function (e) {
    let cmd = null
    try { cmd = JSON.parse(e.data) } catch (err) { return }
    if (!cmd || !cmd.type) return
    if (cmd.type === 'play') startPlayback(cmd)
    else if (typeof window.castCommand === 'function') window.castCommand(cmd)
  }

  window.castReceiver = { id: id, name: name, report: report }
})()
