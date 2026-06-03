;(function () {
  'use strict'

  const COLORS = [
    'linear-gradient(135deg,#e50914,#b81d24)',
    'linear-gradient(135deg,#2563eb,#1d4ed8)',
    'linear-gradient(135deg,#22c55e,#15803d)',
    'linear-gradient(135deg,#f59e0b,#d97706)',
    'linear-gradient(135deg,#a855f7,#7c3aed)',
    'linear-gradient(135deg,#ec4899,#be185d)',
  ]
  function avatarColor(name) {
    let h = 0
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
    return COLORS[Math.abs(h) % COLORS.length]
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg)
    else console.warn(msg)
  }

  // ── Active profile (sessionStorage) ──
  function getActive() {
    const raw = sessionStorage.getItem('filmbox_active_profile')
    return raw ? JSON.parse(raw) : null
  }
  function setActive(profile) {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))
  }

  async function apiFetch(path, opts) {
    const res = await fetch(path, opts)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || res.statusText)
    }
    return res.json()
  }

  // Persist partial changes via PUT, refresh cached profile + navbar + applied settings.
  async function saveProfile(changes) {
    const active = getActive()
    if (!active) throw new Error('Žádný aktivní profil')
    const updated = await apiFetch(`/api/profiles/${active.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    })
    setActive(updated)
    if (window.updateNavbarProfile) window.updateNavbarProfile(updated)
    if (window.applyProfileSettings) window.applyProfileSettings(updated)
    return updated
  }

  // ── Avatar preview ──
  function renderAvatar(profile) {
    const box = document.getElementById('settings-avatar')
    if (!box) return
    if (profile.picture) {
      box.style.background = ''
      box.innerHTML = `<img src="${profile.picture}" alt="">`
    } else {
      box.style.background = avatarColor(profile.name || '?')
      box.textContent = (profile.name || '?').charAt(0).toUpperCase()
    }
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

  // ── Open / populate the settings modal ──
  function syncThemeButtons(theme) {
    document.querySelectorAll('.settings-theme-option').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.theme === theme)
    )
  }
  function syncPinStatus(hasPin) {
    const el = document.getElementById('settings-pin-status')
    if (el) el.textContent = hasPin ? '(nastaveno)' : '(nenastaveno)'
    const removeBtn = document.getElementById('settings-pin-remove')
    if (removeBtn) removeBtn.style.display = hasPin ? '' : 'none'
  }

  window.openSettings = function () {
    const profile = getActive()
    if (!profile) { toast('Nejprve vyberte profil'); return }
    const modal = document.getElementById('settings-modal')
    if (!modal) return

    document.getElementById('settings-name-input').value = profile.name || ''
    renderAvatar(profile)
    syncThemeButtons(profile.theme || 'dark')
    syncPinStatus(!!profile.hasPin)
    document.getElementById('settings-pin-input').value = ''

    const s = profile.settings || {}
    document.getElementById('settings-reduce-motion').checked = !!s.reduceMotion
    document.getElementById('settings-autoplay').checked = s.autoplayTrailers !== false

    modal.classList.remove('hidden')
  }

  function closeSettings() {
    document.getElementById('settings-modal')?.classList.add('hidden')
  }

  // ── PIN prompt (used by intro.js when entering a locked profile) ──
  window.openPinPrompt = function (profile) {
    return new Promise(resolve => {
      const modal = document.getElementById('pin-prompt-modal')
      const input = document.getElementById('pin-prompt-input')
      const title = document.getElementById('pin-prompt-title')
      if (!modal || !input) { resolve(true); return }

      title.textContent = `PIN profilu „${profile.name}“`
      input.value = ''
      modal.classList.remove('hidden')
      setTimeout(() => input.focus(), 50)

      function cleanup(result) {
        modal.classList.add('hidden')
        confirmBtn.removeEventListener('click', onConfirm)
        cancelBtn.removeEventListener('click', onCancel)
        backdrop.removeEventListener('click', onCancel)
        input.removeEventListener('keydown', onKey)
        resolve(result)
      }
      async function onConfirm() {
        const pin = input.value.trim()
        try {
          const { ok } = await apiFetch(`/api/profiles/${profile.id}/pin/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
          })
          if (ok) { cleanup(true) }
          else {
            input.classList.add('shake')
            input.value = ''
            setTimeout(() => input.classList.remove('shake'), 420)
          }
        } catch (err) { toast('Chyba: ' + err.message) }
      }
      function onCancel() { cleanup(false) }
      function onKey(e) {
        if (e.key === 'Enter') onConfirm()
        else if (e.key === 'Escape') onCancel()
      }

      const confirmBtn = document.getElementById('pin-prompt-confirm')
      const cancelBtn = document.getElementById('pin-prompt-cancel')
      const backdrop = document.getElementById('pin-backdrop')
      confirmBtn.addEventListener('click', onConfirm)
      cancelBtn.addEventListener('click', onCancel)
      backdrop.addEventListener('click', onCancel)
      input.addEventListener('keydown', onKey)
    })
  }

  // ── Wiring ──
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('settings-btn')?.addEventListener('click', () => window.openSettings())
    document.getElementById('settings-close')?.addEventListener('click', closeSettings)
    document.getElementById('settings-backdrop')?.addEventListener('click', closeSettings)

    // Name
    document.getElementById('settings-name-save')?.addEventListener('click', async () => {
      const name = document.getElementById('settings-name-input').value.trim()
      if (!name) { toast('Jméno nesmí být prázdné'); return }
      try {
        const p = await saveProfile({ name })
        renderAvatar(p)
        toast('Jméno uloženo')
      } catch (err) { toast('Chyba: ' + err.message) }
    })

    // Picture upload
    document.getElementById('settings-pic-upload')?.addEventListener('click', () =>
      document.getElementById('settings-pic-input').click()
    )
    document.getElementById('settings-pic-input')?.addEventListener('change', async e => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const picture = await fileToResizedDataURL(file)
        const p = await saveProfile({ picture })
        renderAvatar(p)
        toast('Obrázek uložen')
      } catch (err) { toast('Chyba: ' + err.message) }
      e.target.value = ''
    })
    document.getElementById('settings-pic-remove')?.addEventListener('click', async () => {
      try {
        const p = await saveProfile({ picture: null })
        renderAvatar(p)
        toast('Obrázek odebrán')
      } catch (err) { toast('Chyba: ' + err.message) }
    })

    // Theme
    document.querySelectorAll('.settings-theme-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme
        document.body.classList.toggle('dark', theme === 'dark')
        if (theme === 'dark') localStorage.setItem('filmbox_theme', 'dark')
        else localStorage.removeItem('filmbox_theme')
        syncThemeButtons(theme)
        try { await saveProfile({ theme }) }
        catch (err) { toast('Chyba: ' + err.message) }
      })
    })

    // PIN set / change
    document.getElementById('settings-pin-save')?.addEventListener('click', async () => {
      const pin = document.getElementById('settings-pin-input').value.trim()
      if (!/^\d{4}$/.test(pin)) { toast('PIN musí mít 4 číslice'); return }
      const active = getActive()
      try {
        const { hasPin } = await apiFetch(`/api/profiles/${active.id}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        })
        active.hasPin = hasPin
        setActive(active)
        syncPinStatus(hasPin)
        document.getElementById('settings-pin-input').value = ''
        toast('PIN nastaven')
      } catch (err) { toast('Chyba: ' + err.message) }
    })
    // PIN remove
    document.getElementById('settings-pin-remove')?.addEventListener('click', async () => {
      const active = getActive()
      try {
        const { hasPin } = await apiFetch(`/api/profiles/${active.id}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: null })
        })
        active.hasPin = hasPin
        setActive(active)
        syncPinStatus(hasPin)
        toast('PIN odebrán')
      } catch (err) { toast('Chyba: ' + err.message) }
    })

    // Preferences
    document.getElementById('settings-reduce-motion')?.addEventListener('change', async e => {
      const reduceMotion = e.target.checked
      document.body.classList.toggle('reduce-motion', reduceMotion)
      try { await saveProfile({ settings: { reduceMotion } }) }
      catch (err) { toast('Chyba: ' + err.message) }
    })
    document.getElementById('settings-autoplay')?.addEventListener('change', async e => {
      try { await saveProfile({ settings: { autoplayTrailers: e.target.checked } }) }
      catch (err) { toast('Chyba: ' + err.message) }
    })

    // Delete profile
    document.getElementById('settings-delete')?.addEventListener('click', async () => {
      const active = getActive()
      if (!active) return
      if (!confirm(`Opravdu smazat profil „${active.name}“? Tuto akci nelze vrátit.`)) return
      try {
        await apiFetch(`/api/profiles/${active.id}`, { method: 'DELETE' })
        sessionStorage.removeItem('filmbox_active_profile')
        location.reload()
      } catch (err) { toast('Chyba: ' + err.message) }
    })

    // ESC closes settings
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSettings()
    })
  })
})()
