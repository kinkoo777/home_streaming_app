;(function () {
  'use strict'

  const modal = document.getElementById('settings-modal')
  const $ = id => document.getElementById(id)

  function setActive(profile) {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))
  }

  // Persist partial changes via PUT, refresh cached profile + navbar + applied settings.
  async function saveProfile(changes) {
    const active = getActiveProfile()
    if (!active) throw new Error('Žádný aktivní profil')
    const updated = await apiFetch(`/api/profiles/${active.id}`, jsonBody('PUT', changes))
    setActive(updated)
    window.updateNavbarProfile(updated)
    window.applyProfileSettings(updated)
    return updated
  }

  function renderAvatar(profile) {
    const box = $('settings-avatar')
    box.style.background = profile.picture ? '' : window.avatarColor(profile.name || '?')
    box.innerHTML = window.profileAvatarHTML(profile)
  }

  // Resize an uploaded image to a 256×256 JPEG data URL (cover-crop).
  function fileToResizedDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Nelze načíst soubor'))
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => reject(new Error('Neplatný obrázek'))
        img.onload = () => {
          const SIZE = 256
          const canvas = document.createElement('canvas')
          canvas.width = SIZE
          canvas.height = SIZE
          const ctx = canvas.getContext('2d')
          const scale = Math.max(SIZE / img.width, SIZE / img.height)
          const w = img.width * scale
          const h = img.height * scale
          ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.src = reader.result
      }
      reader.readAsDataURL(file)
    })
  }

  function syncThemeButtons(theme) {
    document.querySelectorAll('.settings-theme-option').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.theme === theme))
  }
  // Playback preference groups: one active button per [data-setting] group.
  const CHOICE_DEFAULTS = { audioPref: 'dub', qualityPref: '1080', subLang: 'device' }
  function syncChoices(settings) {
    document.querySelectorAll('.settings-choice').forEach(group => {
      const key = group.dataset.setting
      const value = settings[key] || CHOICE_DEFAULTS[key]
      group.querySelectorAll('[data-value]').forEach(b => {
        const on = b.dataset.value === value
        b.classList.toggle('active', on)
        b.setAttribute('aria-pressed', on ? 'true' : 'false')
      })
    })
  }

  function syncPinStatus(hasPin) {
    $('settings-pin-status').textContent = hasPin ? '(nastaveno)' : '(nenastaveno)'
    $('settings-pin-remove').style.display = hasPin ? '' : 'none'
  }

  function openSettings() {
    const profile = getActiveProfile()
    if (!profile) { showToast('Nejprve vyberte profil'); return }
    $('settings-name-input').value = profile.name || ''
    renderAvatar(profile)
    syncThemeButtons(profile.theme || 'dark')
    syncPinStatus(!!profile.hasPin)
    $('settings-pin-input').value = ''
    const s = profile.settings || {}
    $('settings-reduce-motion').checked = !!s.reduceMotion
    $('settings-autoplay').checked = s.autoplayTrailers !== false
    $('settings-still-watching').checked = s.stillWatching !== false
    $('settings-previews').checked = s.previews !== false
    $('settings-kids').checked = !!profile.kids
    $('settings-ntfy').value = s.ntfyTopic || ''
    $('settings-ntfy-status').textContent = s.ntfyTopic ? '· zapnuto' : '· vypnuto'
    syncParentPin()
    syncChoices(s)
    modal.querySelector('.overlay-card').scrollTop = 0
    openModal(modal, closeSettings)
  }
  window.openSettings = openSettings

  function closeSettings() { closeModal(modal) }

  // ── PIN prompt (used by intro.js when entering a locked profile) ──
  // opts: { title, verify(pin) → Promise<bool> } for PINs other than a profile's;
  // then resolves with the PIN (or false when cancelled).
  window.openPinPrompt = function (profile, opts) {
    return new Promise(resolve => {
      const pinModal   = $('pin-prompt-modal')
      const input      = $('pin-prompt-input')
      const confirmBtn = $('pin-prompt-confirm')
      const cancelBtn  = $('pin-prompt-cancel')
      const backdrop   = $('pin-backdrop')

      $('pin-prompt-title').textContent = opts && opts.title ? opts.title : `PIN profilu „${profile.name}“`
      input.value = ''
      let done = false

      function cleanup(result) {
        if (done) return
        done = true
        closeModal(pinModal)
        confirmBtn.removeEventListener('click', onConfirm)
        cancelBtn.removeEventListener('click', onCancel)
        backdrop.removeEventListener('click', onCancel)
        input.removeEventListener('keydown', onKey)
        resolve(result)
      }
      async function onConfirm() {
        const pin = input.value.trim()
        if (!pin) { input.focus(); return }
        try {
          if (opts && opts.verify) {
            if (await opts.verify(pin)) { cleanup(pin); return }
            input.classList.add('shake')
            input.value = ''
            setTimeout(() => input.classList.remove('shake'), 420)
            return
          }
          const res = await apiFetch(`/api/profiles/${profile.id}/pin/verify`, jsonBody('POST', { pin }))
          if (res.ok) { setProfileToken(profile.id, res.token); cleanup(true) }
          else {
            input.classList.add('shake')
            input.value = ''
            setTimeout(() => input.classList.remove('shake'), 420)
          }
        } catch (err) { showToast('Chyba: ' + err.message) }
      }
      function onCancel() { cleanup(false) }
      function onKey(e) {
        if (e.key === 'Enter') onConfirm()
        // Auto-submit on the 4th digit — handy with a TV remote's number keys.
        else if (/^\d$/.test(e.key) && input.value.length === 3) setTimeout(onConfirm, 0)
      }

      confirmBtn.addEventListener('click', onConfirm)
      cancelBtn.addEventListener('click', onCancel)
      backdrop.addEventListener('click', onCancel)
      input.addEventListener('keydown', onKey)
      openModal(pinModal, onCancel)
      setTimeout(() => input.focus(), 60)
    })
  }

  // ── Parent PIN (kids profiles) ──
  // → '' when none is set, the PIN when entered right, false when cancelled.
  window.askParentPin = async function () {
    let has = false
    try { has = (await (await fetch('/api/household')).json()).parentPin } catch (e) {}
    if (!has) return ''
    return window.openPinPrompt(null, {
      title: 'Rodičovský PIN',
      verify: async pin => {
        const r = await fetch('/api/household/parent-pin/verify', jsonBody('POST', { pin }))
        const b = await r.json().catch(() => ({}))
        if (r.status === 429) showToast(b.error || 'Příliš mnoho pokusů')
        return !!b.ok
      }
    })
  }
  const fourDigits = { title: 'Nový rodičovský PIN (4 číslice)', verify: async pin => /^\d{4}$/.test(pin) }
  async function syncParentPin() {
    let has = false
    try { has = (await (await fetch('/api/household')).json()).parentPin } catch (e) {}
    $('settings-parent-status').textContent = has ? '· nastaven' : '· nenastaven'
    $('settings-parent-set').innerHTML = '<i class="bi bi-shield-lock"></i> ' + (has ? 'Změnit' : 'Nastavit')
    $('settings-parent-remove').hidden = !has
  }
  async function putParentPin(pin) {
    const current = await window.askParentPin()
    if (current === false) return
    const res = await fetch('/api/household/parent-pin', jsonBody('PUT', { pin, currentPin: current || undefined }))
    const b = await res.json().catch(() => ({}))
    showToast(res.ok ? (pin ? 'Rodičovský PIN uložen' : 'Rodičovský PIN odebrán') : (b.error || 'Chyba'))
    syncParentPin()
  }
  $('settings-parent-set').addEventListener('click', async () => {
    const pin = await window.openPinPrompt(null, fourDigits)
    if (pin) putParentPin(pin)
  })
  $('settings-parent-remove').addEventListener('click', () => putParentPin(null))
  $('settings-kids').addEventListener('change', async e => {
    const on = e.target.checked
    let parentPin
    if (!on) {
      parentPin = await window.askParentPin()
      if (parentPin === false) { e.target.checked = true; return }
    }
    try {
      const updated = await saveProfile(on ? { kids: true } : { kids: false, parentPin: parentPin || undefined })
      showToast(updated.kids ? 'Dětský profil zapnut' : 'Dětský profil vypnut')
      if (window.reloadHomeRows) window.reloadHomeRows()
      else setTimeout(() => location.reload(), 600)
    } catch (err) { e.target.checked = !on; showToast('Chyba: ' + err.message) }
  })

  // ── New-episode notifications (ntfy topic) ──
  $('settings-ntfy-new').addEventListener('click', () => {
    const p = getActiveProfile()
    const slug = String((p && p.name) || 'filmbox').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'profil'
    const rnd = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)
    $('settings-ntfy').value = 'filmbox-' + slug + '-' + rnd
  })
  $('settings-ntfy-save').addEventListener('click', async () => {
    const topic = $('settings-ntfy').value.trim()
    try {
      const updated = await saveProfile({ settings: { ntfyTopic: topic } })
      $('settings-ntfy-status').textContent = updated.settings.ntfyTopic ? '· zapnuto' : '· vypnuto'
      showToast(topic ? 'Uloženo — v aplikaci ntfy odebírejte téma ' + topic : 'Upozornění vypnuta')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })
  $('settings-ntfy-test').addEventListener('click', async () => {
    const p = getActiveProfile()
    if (!p) return
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(p.id)}/notify/test`, { method: 'POST' })
      const b = await r.json().catch(() => ({}))
      showToast(r.ok ? 'Odesláno — zkontrolujte telefon' : (b.error || 'Nepodařilo se odeslat'))
    } catch (err) { showToast('Chyba: ' + err.message) }
  })

  // ── Wiring ──
  $('settings-btn').addEventListener('click', openSettings)

  $('settings-name-save').addEventListener('click', async () => {
    const name = $('settings-name-input').value.trim()
    if (!name) { showToast('Jméno nesmí být prázdné'); return }
    try {
      renderAvatar(await saveProfile({ name }))
      showToast('Jméno uloženo')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })
  $('settings-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('settings-name-save').click() })

  $('settings-pic-upload').addEventListener('click', () => $('settings-pic-input').click())
  $('settings-pic-input').addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    try {
      renderAvatar(await saveProfile({ picture: await fileToResizedDataURL(file) }))
      showToast('Obrázek uložen')
    } catch (err) { showToast('Chyba: ' + err.message) }
    e.target.value = ''
  })
  $('settings-pic-remove').addEventListener('click', async () => {
    try {
      renderAvatar(await saveProfile({ picture: null }))
      showToast('Obrázek odebrán')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })

  document.querySelectorAll('.settings-theme-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme
      window.applyTheme(theme)
      syncThemeButtons(theme)
      try { await saveProfile({ theme }) }
      catch (err) { showToast('Chyba: ' + err.message) }
    })
  })

  $('settings-pin-save').addEventListener('click', async () => {
    const pin = $('settings-pin-input').value.trim()
    if (!/^\d{4}$/.test(pin)) { showToast('PIN musí mít 4 číslice'); return }
    const active = getActiveProfile()
    try {
      const res = await apiFetch(`/api/profiles/${active.id}/pin`, jsonBody('POST', { pin }))
      setProfileToken(active.id, res.token)
      active.hasPin = res.hasPin
      setActive(active)
      syncPinStatus(res.hasPin)
      $('settings-pin-input').value = ''
      showToast('PIN nastaven')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })
  $('settings-pin-remove').addEventListener('click', async () => {
    const active = getActiveProfile()
    try {
      const res = await apiFetch(`/api/profiles/${active.id}/pin`, jsonBody('POST', { pin: null }))
      setProfileToken(active.id, null)
      active.hasPin = res.hasPin
      setActive(active)
      syncPinStatus(res.hasPin)
      showToast('PIN odebrán')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })

  $('settings-reduce-motion').addEventListener('change', async e => {
    document.body.classList.toggle('reduce-motion', e.target.checked)
    try { await saveProfile({ settings: { reduceMotion: e.target.checked } }) }
    catch (err) { showToast('Chyba: ' + err.message) }
  })
  $('settings-autoplay').addEventListener('change', async e => {
    try { await saveProfile({ settings: { autoplayTrailers: e.target.checked } }) }
    catch (err) { showToast('Chyba: ' + err.message) }
  })

  $('settings-previews').addEventListener('change', async e => {
    if (!e.target.checked && window.stopPreviews) window.stopPreviews()
    try { await saveProfile({ settings: { previews: e.target.checked } }) }
    catch (err) { showToast('Chyba: ' + err.message) }
  })

  $('settings-still-watching').addEventListener('change', async e => {
    try { await saveProfile({ settings: { stillWatching: e.target.checked } }) }
    catch (err) { showToast('Chyba: ' + err.message) }
  })
  document.querySelectorAll('.settings-choice').forEach(group => {
    group.addEventListener('click', async e => {
      const btn = e.target.closest('[data-value]')
      if (!btn) return
      const change = {}
      change[group.dataset.setting] = btn.dataset.value
      const before = (getActiveProfile() || {}).settings || {}
      syncChoices(Object.assign({}, before, change))
      try { await saveProfile({ settings: change }) }
      catch (err) { syncChoices(before); showToast('Chyba: ' + err.message) }
    })
  })

  $('settings-export').addEventListener('click', async () => {
    const active = getActiveProfile()
    if (!active) return
    try {
      const data = await apiFetch(`/api/profiles/${active.id}/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const safe = (active.name || 'profil').replace(/[^\w\-]+/g, '_')
      a.href = url
      a.download = `filmbox-${safe}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Data exportována')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })

  $('settings-wipe').addEventListener('click', async () => {
    const active = getActiveProfile()
    if (!active) return
    if (!(await confirmDialog('Opravdu vymazat oblíbené, zhlédnuté, seznamy a průběh? Profil zůstane zachován.', 'Vymazat'))) return
    try {
      await apiFetch(`/api/profiles/${active.id}/data`, { method: 'DELETE' })
      window._profileProgress = {}
      await Promise.all([window.reloadWatched(), window.reloadWatchlist(), window.reloadFavorites(), window.reloadRatings ? window.reloadRatings() : null])
      window.reloadContinueWatching()
      showToast('Data vymazána')
    } catch (err) { showToast('Chyba: ' + err.message) }
  })

  $('settings-delete').addEventListener('click', async () => {
    const active = getActiveProfile()
    if (!active) return
    if (!(await confirmDialog(`Opravdu smazat profil „${active.name}“? Tuto akci nelze vrátit.`, 'Smazat profil'))) return
    try {
      await apiFetch(`/api/profiles/${active.id}`, { method: 'DELETE' })
      sessionStorage.removeItem('filmbox_active_profile')
      location.reload()
    } catch (err) { showToast('Chyba: ' + err.message) }
  })
})()
