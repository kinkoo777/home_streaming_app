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

  // ── API helpers ──

  async function apiFetch(path, opts) {
    const res = await fetch(path, opts)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || res.statusText)
    }
    return res.json()
  }

  const api = {
    list:   ()         => apiFetch('/api/profiles'),
    create: (name, theme) => apiFetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, theme })
    }),
    delete: id => apiFetch(`/api/profiles/${id}`, { method: 'DELETE' }),
  }

  // ── Cached profiles list ──
  let profiles = []

  // ── Active profile (sessionStorage) ──
  function getActiveProfile() {
    const raw = sessionStorage.getItem('filmbox_active_profile')
    return raw ? JSON.parse(raw) : null
  }

  function setActiveProfile(profile) {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))
  }

  // ── Apply theme to body ──
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark')
      localStorage.setItem('filmbox_theme', 'dark')
    } else {
      document.body.classList.remove('dark')
      localStorage.removeItem('filmbox_theme')
    }
  }

  // ── Apply theme + per-profile preferences (reduce motion) ──
  function applyProfileSettings(profile) {
    if (!profile) return
    applyTheme(profile.theme)
    const reduceMotion = !!(profile.settings && profile.settings.reduceMotion)
    document.body.classList.toggle('reduce-motion', reduceMotion)
  }
  window.applyProfileSettings = applyProfileSettings

  // ── Update navbar badge ──
  function updateNavbarProfile(profile) {
    const logoBox = document.getElementById('navbar-logo-box')
    if (logoBox) {
      if (profile.picture) {
        logoBox.style.background = ''
        logoBox.innerHTML = `<img src="${profile.picture}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      } else {
        logoBox.style.background = avatarColor(profile.name)
        logoBox.textContent = profile.name.charAt(0).toUpperCase()
      }
      logoBox.classList.remove('profile-switched')
      void logoBox.offsetWidth
      logoBox.classList.add('profile-switched')
    }
    const profileText = document.getElementById('navbar-profile-text')
    if (profileText) {
      profileText.innerHTML =
        `<h1>${profile.name}</h1>` +
        `<p class="profile-switch-line"><a class="profile-switch-link" onclick="window.showProfileChooser();return false" href="#">` +
        `Profil · Změnit</a></p>`
    }
  }
  window.updateNavbarProfile = updateNavbarProfile

  // ── Render profile grid ──
  async function renderProfileGrid() {
    const grid = document.getElementById('profile-grid')
    if (!grid) return
    grid.innerHTML = '<div style="color:#555;font-size:14px;padding:20px">Načítání...</div>'

    try {
      profiles = await api.list()
    } catch {
      grid.innerHTML = '<div style="color:#e55;font-size:14px;padding:20px">Chyba načítání profilů</div>'
      return
    }

    if (!profiles.length) {
      grid.innerHTML = '<div style="color:#555;font-size:14px;padding:20px">Žádné profily – vytvořte první.</div>'
      return
    }

    grid.innerHTML = profiles.map(p => {
      const bg    = p.picture ? '' : `background:${avatarColor(p.name)}`
      const inner = p.picture
        ? `<img src="${p.picture}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
        : p.name.charAt(0).toUpperCase()
      return `
        <div class="profile-card" data-id="${p.id}">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar" style="${bg}">${inner}</div>
            <button class="profile-delete-btn" data-id="${p.id}" title="Smazat profil">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <span class="profile-name">${p.name}</span>
        </div>`
    }).join('')

    grid.querySelectorAll('.profile-card').forEach(card => {
      card.addEventListener('click', () => chooseProfile(card.dataset.id))
    })

    grid.querySelectorAll('.profile-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        try {
          await api.delete(btn.dataset.id)
          await renderProfileGrid()
        } catch (err) {
          showToast('Chyba: ' + err.message)
        }
      })
    })
  }

  // ── Choose a profile ──
  async function chooseProfile(id) {
    const profile = profiles.find(p => p.id === id)
    if (!profile) return

    // Locked profile → require the correct PIN before entering.
    if (profile.hasPin && typeof window.openPinPrompt === 'function') {
      const ok = await window.openPinPrompt(profile)
      if (!ok) return
    }

    setActiveProfile(profile)
    applyProfileSettings(profile)

    const chooser = document.getElementById('profile-chooser')
    chooser.style.transition = 'opacity 0.35s ease'
    chooser.style.opacity = '0'
    setTimeout(async () => {
      chooser.classList.add('hidden')
      updateNavbarProfile(profile)
      if (window.reloadFavorites)        window.reloadFavorites()
      if (window.reloadWatched)          await window.reloadWatched()
      if (window.reloadWatchlist)        await window.reloadWatchlist()
      if (typeof loadProfileProgress === 'function') await loadProfileProgress()
      if (window.reloadContinueWatching) window.reloadContinueWatching()
    }, 360)
  }

  // ── Show chooser (callable from navbar "Změnit") ──
  window.showProfileChooser = function () {
    const chooser = document.getElementById('profile-chooser')
    chooser.style.opacity = '0'
    chooser.classList.remove('hidden')
    renderProfileGrid()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chooser.style.transition = 'opacity 0.35s ease'
      chooser.style.opacity = '1'
    }))
  }

  // ── Add-profile modal ──
  let selectedTheme = 'dark'

  function openAddProfile() {
    const modal = document.getElementById('profile-add-modal')
    if (!modal) return
    modal.classList.remove('hidden')
    const nameInput = document.getElementById('new-profile-name')
    nameInput.value = ''
    nameInput.focus()
    selectedTheme = 'dark'
    syncThemeOptions()
  }

  function closeAddProfile() {
    document.getElementById('profile-add-modal').classList.add('hidden')
  }

  function syncThemeOptions() {
    document.querySelectorAll('.theme-option').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.theme === selectedTheme)
    )
  }

  // ── Intro sound ──
  function playIntroSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const t = ctx.currentTime
      function tone(freq, start, dur, peak, type = 'sine') {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(freq, t + start)
        gain.gain.setValueAtTime(0, t + start)
        gain.gain.linearRampToValueAtTime(peak, t + start + 0.05)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t + start)
        osc.stop(t + start + dur + 0.1)
      }
      tone(130.81, 0.0, 0.45, 0.45)
      tone(261.63, 0.0, 0.35, 0.22)
      tone(98.00,  0.62, 1.3,  0.60)
      tone(196.00, 0.62, 1.0,  0.32)
      tone(293.66, 0.67, 0.6,  0.14)
    } catch (e) {}
  }

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', () => {

    document.querySelectorAll('.theme-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedTheme = btn.dataset.theme
        syncThemeOptions()
      })
    })

    document.getElementById('add-profile-btn')?.addEventListener('click', openAddProfile)
    document.getElementById('profile-add-cancel')?.addEventListener('click', closeAddProfile)
    document.getElementById('profile-add-confirm')?.addEventListener('click', async () => {
      const name = document.getElementById('new-profile-name').value.trim()
      if (!name) return
      try {
        await api.create(name, selectedTheme)
        await renderProfileGrid()
        closeAddProfile()
      } catch (err) {
        showToast('Chyba: ' + err.message)
      }
    })
    document.getElementById('new-profile-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('profile-add-confirm').click()
    })
    document.getElementById('profile-add-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('profile-add-modal')) closeAddProfile()
    })

    // Apply system dark-mode preference on first visit (no stored theme, no active session)
    if (!localStorage.getItem('filmbox_theme') && !sessionStorage.getItem('filmbox_active_profile')) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark')
      }
    }

    // If profile already active in this tab → skip intro
    const active = getActiveProfile()
    if (active) {
      document.getElementById('intro-screen').style.display = 'none'
      document.getElementById('profile-chooser').classList.add('hidden')
      document.getElementById('profile-chooser').style.opacity = '0'
      applyProfileSettings(active)
      updateNavbarProfile(active)
      if (typeof loadProfileProgress === 'function') {
        loadProfileProgress().then(() => {
          if (window.reloadContinueWatching) window.reloadContinueWatching()
        })
      }
      return
    }

    // Play intro animation → show chooser
    setTimeout(playIntroSound, 400)
    setTimeout(() => {
      const intro = document.getElementById('intro-screen')
      intro.style.transition = 'opacity 0.55s ease'
      intro.style.opacity = '0'
      setTimeout(() => {
        intro.style.display = 'none'
        window.showProfileChooser()
      }, 560)
    }, 2700)
  })
})()
