;(function () {
  'use strict'

  const COLORS = [
    'linear-gradient(135deg,#f43f5e,#be123c)',
    'linear-gradient(135deg,#3b82f6,#1d4ed8)',
    'linear-gradient(135deg,#22c55e,#15803d)',
    'linear-gradient(135deg,#f59e0b,#d97706)',
    'linear-gradient(135deg,#a855f7,#7c3aed)',
    'linear-gradient(135deg,#ec4899,#be185d)',
    'linear-gradient(135deg,#14b8a6,#0f766e)',
  ]

  function avatarColor(name) {
    let h = 0
    const s = String(name || '?')
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff
    return COLORS[Math.abs(h) % COLORS.length]
  }
  window.avatarColor = avatarColor

  // Avatar contents: uploaded picture (data: URL only) or the initial.
  function avatarHTML(p) {
    if (p.picture && /^data:image\//.test(p.picture)) return `<img src="${escapeHtml(p.picture)}" alt="">`
    return escapeHtml(String(p.name || '?').charAt(0).toUpperCase())
  }
  window.profileAvatarHTML = avatarHTML

  const api = {
    list:   ()            => apiFetch('/api/profiles'),
    create: (name, theme) => apiFetch('/api/profiles', jsonBody('POST', { name, theme })),
    delete: id            => apiFetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  }

  let profiles = []

  function setActiveProfile(profile) {
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))
  }

  // ── Theme + per-profile preferences ──
  function applyTheme(theme) {
    const dark = theme !== 'light'
    document.body.classList.toggle('dark', dark)
    lsSet('filmbox_theme', dark ? 'dark' : 'light')
    const icon = document.querySelector('#theme-toggle i')
    if (icon) icon.className = 'bi ' + (dark ? 'bi-moon-stars' : 'bi-sun')
  }
  window.applyTheme = applyTheme

  function applyProfileSettings(profile) {
    if (!profile) return
    applyTheme(profile.theme)
    document.body.classList.toggle('reduce-motion', !!(profile.settings && profile.settings.reduceMotion))
  }
  window.applyProfileSettings = applyProfileSettings

  // ── Navbar profile chip ──
  function updateNavbarProfile(profile) {
    const box = document.getElementById('navbar-logo-box')
    if (box) {
      box.style.background = profile.picture ? '' : avatarColor(profile.name)
      box.innerHTML = avatarHTML(profile)
      box.classList.remove('profile-switched')
      void box.offsetWidth
      box.classList.add('profile-switched')
    }
    const name = document.getElementById('navbar-profile-name')
    if (name) name.textContent = profile.name || ''
  }
  window.updateNavbarProfile = updateNavbarProfile

  // ── Profile grid ──
  async function renderProfileGrid() {
    const grid = document.getElementById('profile-grid')
    if (!grid) return
    grid.innerHTML = '<div class="profile-msg">Načítání…</div>'

    try {
      profiles = await api.list()
    } catch (e) {
      grid.innerHTML = '<div class="profile-msg error">Chyba načítání profilů</div>'
      return
    }

    if (!profiles.length) {
      grid.innerHTML = '<div class="profile-msg">Žádné profily – vytvořte první.</div>'
      if (document.body.classList.contains('kbd')) document.getElementById('add-profile-btn').focus()
      return
    }

    grid.innerHTML = profiles.map(p => `
      <div class="profile-card" tabindex="0" role="button" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(p.name)}">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" style="${p.picture ? '' : 'background:' + avatarColor(p.name)}">${avatarHTML(p)}</div>
          ${p.hasPin ? '<span class="profile-lock"><i class="bi bi-lock-fill"></i></span>' : ''}
          <button class="profile-delete-btn" data-id="${escapeHtml(p.id)}" title="Smazat profil" aria-label="Smazat profil ${escapeHtml(p.name)}" tabindex="-1">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <span class="profile-name">${escapeHtml(p.name)}</span>
      </div>`).join('')

    grid.querySelectorAll('.profile-card').forEach(card => {
      card.addEventListener('click', () => chooseProfile(card.dataset.id))
    })
    grid.querySelectorAll('.profile-delete-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation()
        const p = profiles.find(x => x.id === btn.dataset.id)
        if (p && p.hasPin && !getProfileToken(p.id)) {
          if (!(await window.openPinPrompt(p))) return
        }
        const ok = await confirmDialog(`Smazat profil „${p ? p.name : ''}“ včetně oblíbených, seznamů a historie? Tuto akci nelze vrátit.`, 'Smazat')
        if (!ok) return
        try {
          await api.delete(btn.dataset.id)
          await renderProfileGrid()
          showToast('Profil smazán')
        } catch (err) {
          showToast('Chyba: ' + err.message)
        }
      })
    })

    if (document.body.classList.contains('kbd')) {
      const first = grid.querySelector('.profile-card')
      if (first) first.focus()
    }
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
    // First visit after an update → the "what's new" video (whatsnew.js), over the fading chooser.
    if (window.maybeShowWhatsNew) window.maybeShowWhatsNew(profile)

    const chooser = document.getElementById('profile-chooser')
    chooser.style.transition = 'opacity 0.4s ease'
    chooser.style.opacity = '0'
    setTimeout(async () => {
      chooser.classList.add('hidden')
      updateNavbarProfile(profile)
      await reloadProfileData()
      if (window.tvFocusStart) window.tvFocusStart()
    }, 400)
  }

  async function reloadProfileData() {
    const tasks = []
    if (window.reloadFavorites) tasks.push(window.reloadFavorites())
    if (window.reloadWatched)   tasks.push(window.reloadWatched())
    if (window.reloadWatchlist) tasks.push(window.reloadWatchlist())
    tasks.push(loadProfileProgress())
    if (window.reloadRatings)   tasks.push(window.reloadRatings())
    await Promise.all(tasks)
    if (window.reloadContinueWatching) window.reloadContinueWatching()
    if (window.reloadRecommendations) window.reloadRecommendations()
    if (window.reloadUpcoming) window.reloadUpcoming()
  }

  // ── Show chooser (navbar profile chip) ──
  window.showProfileChooser = function () {
    const chooser = document.getElementById('profile-chooser')
    chooser.style.transition = ''
    chooser.style.opacity = '0'
    chooser.classList.remove('hidden')
    renderProfileGrid()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chooser.style.transition = 'opacity 0.4s ease'
      chooser.style.opacity = '1'
    }))
  }

  // ── Add-profile modal ──
  let selectedTheme = 'dark'
  const addModal = () => document.getElementById('profile-add-modal')

  function openAddProfile() {
    const nameInput = document.getElementById('new-profile-name')
    nameInput.value = ''
    selectedTheme = 'dark'
    syncThemeOptions()
    openModal(addModal(), closeAddProfile)
    setTimeout(() => nameInput.focus(), 60)
  }
  function closeAddProfile() { closeModal(addModal()) }

  function syncThemeOptions() {
    document.querySelectorAll('.theme-option').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.theme === selectedTheme))
  }

  // ── Intro sound ──
  function playIntroSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const t = ctx.currentTime
      const tone = (freq, start, dur, peak, type) => {
        const osc  = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = type || 'sine'
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
      btn.addEventListener('click', () => { selectedTheme = btn.dataset.theme; syncThemeOptions() })
    })

    document.getElementById('add-profile-btn').addEventListener('click', openAddProfile)
    document.getElementById('profile-add-cancel').addEventListener('click', closeAddProfile)
    document.getElementById('profile-add-confirm').addEventListener('click', async () => {
      const name = document.getElementById('new-profile-name').value.trim()
      if (!name) { document.getElementById('new-profile-name').focus(); return }
      try {
        await api.create(name, selectedTheme)
        closeAddProfile()
        await renderProfileGrid()
      } catch (err) {
        showToast('Chyba: ' + err.message)
      }
    })
    document.getElementById('new-profile-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('profile-add-confirm').click()
    })
    document.getElementById('profile-btn').addEventListener('click', () => window.showProfileChooser())

    // Theme before any profile is picked: stored choice, else the OS preference.
    const stored = lsGet('filmbox_theme', null)
    if (stored) applyTheme(stored)
    else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

    const intro = document.getElementById('intro-screen')

    // Profile already active in this tab → skip intro
    const active = getActiveProfile()
    if (active) {
      intro.style.display = 'none'
      document.getElementById('profile-chooser').classList.add('hidden')
      applyProfileSettings(active)
      updateNavbarProfile(active)   // library rows load themselves (favorites/watched/watchlist.js)
      setTimeout(() => { if (window.tvFocusStart) window.tvFocusStart() }, 600)
      return
    }

    // Intro animation → chooser (skippable with any key / click)
    let left = false
    const leave = () => {
      if (left) return
      left = true
      intro.classList.add('leaving')
      setTimeout(() => {
        intro.style.display = 'none'
        window.showProfileChooser()
      }, 560)
    }
    setTimeout(playIntroSound, 400)
    setTimeout(leave, 2800)
    intro.addEventListener('click', leave)
    document.addEventListener('keydown', function skip() {
      document.removeEventListener('keydown', skip)
      leave()
    })
  })
})()
