;(function () {
  'use strict'

  // ── Profile color palette ──
  const COLORS = [
    { bg: 'linear-gradient(135deg,#e50914,#b81d24)', solid: '#e50914' },
    { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', solid: '#2563eb' },
    { bg: 'linear-gradient(135deg,#22c55e,#15803d)', solid: '#22c55e' },
    { bg: 'linear-gradient(135deg,#f59e0b,#d97706)', solid: '#f59e0b' },
    { bg: 'linear-gradient(135deg,#a855f7,#7c3aed)', solid: '#a855f7' },
    { bg: 'linear-gradient(135deg,#ec4899,#be185d)', solid: '#ec4899' },
    { bg: 'linear-gradient(135deg,#52525b,#27272a)', solid: '#52525b' }, // guest (index 6)
  ]

  // ── Storage helpers ──
  function getProfiles() {
    const raw = localStorage.getItem('filmbox_profiles')
    if (raw) return JSON.parse(raw)
    const defaults = [
      { id: 'p1',    name: 'Uživatel 1', colorIdx: 0 },
      { id: 'p2',    name: 'Uživatel 2', colorIdx: 1 },
      { id: 'p3',    name: 'Uživatel 3', colorIdx: 2 },
      { id: 'guest', name: 'Host',       colorIdx: 6, guest: true },
    ]
    localStorage.setItem('filmbox_profiles', JSON.stringify(defaults))
    return defaults
  }

  function saveProfiles(profiles) {
    localStorage.setItem('filmbox_profiles', JSON.stringify(profiles))
  }

  function getActiveProfile() {
    const raw = sessionStorage.getItem('filmbox_active_profile')
    return raw ? JSON.parse(raw) : null
  }

  // ── Netflix-style "ta-dum" sound via Web Audio API ──
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

      // "Ta" — short sharp hit
      tone(130.81, 0.0, 0.45, 0.45)
      tone(261.63, 0.0, 0.35, 0.22)

      // "Dum" — deeper resonant hit
      tone(98.00,  0.62, 1.3, 0.60)
      tone(196.00, 0.62, 1.0, 0.32)
      tone(293.66, 0.67, 0.6, 0.14)
    } catch (e) { /* AudioContext blocked — silent intro is fine */ }
  }

  // ── Update navbar to show active profile ──
  function updateNavbarProfile(profile) {
    const color  = COLORS[profile.colorIdx] || COLORS[0]
    const letter = profile.name.charAt(0).toUpperCase()

    const logoBox = document.getElementById('navbar-logo-box')
    if (logoBox) {
      logoBox.style.background = color.bg
      logoBox.textContent = letter
    }

    const profileText = document.getElementById('navbar-profile-text')
    if (profileText) {
      profileText.innerHTML =
        `<h1>${profile.name}</h1>` +
        `<p><a class="profile-switch-link" onclick="window.showProfileChooser();return false" href="#">` +
        `${profile.guest ? 'Hostující režim' : 'Přihlášený profil'} · Změnit</a></p>`
    }
  }

  // ── Render profile grid ──
  function renderProfileGrid() {
    const profiles = getProfiles()
    const grid = document.getElementById('profile-grid')
    if (!grid) return

    grid.innerHTML = profiles.map(p => {
      const color  = COLORS[p.colorIdx] || COLORS[0]
      const letter = p.name.charAt(0).toUpperCase()
      return `
        <div class="profile-card" data-id="${p.id}">
          <div class="profile-avatar" style="background:${color.bg}">${letter}</div>
          <span class="profile-name">${p.name}</span>
        </div>`
    }).join('')

    grid.querySelectorAll('.profile-card').forEach(card => {
      card.addEventListener('click', () => chooseProfile(card.dataset.id))
    })
  }

  // ── Select a profile ──
  function chooseProfile(id) {
    const profile = getProfiles().find(p => p.id === id)
    if (!profile) return
    sessionStorage.setItem('filmbox_active_profile', JSON.stringify(profile))

    const chooser = document.getElementById('profile-chooser')
    chooser.style.transition = 'opacity 0.35s ease'
    chooser.style.opacity = '0'
    setTimeout(() => {
      chooser.classList.add('hidden')
      updateNavbarProfile(profile)
    }, 360)
  }

  // ── Show profile chooser (also callable from navbar "Změnit") ──
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
  let selectedColorIdx = 0

  function openAddProfile() {
    const modal = document.getElementById('profile-add-modal')
    if (!modal) return
    modal.classList.remove('hidden')
    const nameInput = document.getElementById('new-profile-name')
    nameInput.value = ''
    nameInput.focus()
    selectedColorIdx = 0
    syncSwatches()
  }

  function closeAddProfile() {
    document.getElementById('profile-add-modal').classList.add('hidden')
  }

  function syncSwatches() {
    document.querySelectorAll('.color-swatch').forEach((s, i) =>
      s.classList.toggle('selected', i === selectedColorIdx))
  }

  // ── Boot ──
  document.addEventListener('DOMContentLoaded', () => {

    // Build color swatches in add-profile modal
    const picker = document.getElementById('profile-color-picker')
    if (picker) {
      picker.innerHTML = COLORS.slice(0, 6).map((c, i) =>
        `<div class="color-swatch${i === 0 ? ' selected' : ''}"
              style="background:${c.solid}" data-idx="${i}"></div>`
      ).join('')
      picker.querySelectorAll('.color-swatch').forEach(s => {
        s.addEventListener('click', () => {
          selectedColorIdx = parseInt(s.dataset.idx)
          syncSwatches()
        })
      })
    }

    // Wire add-profile buttons
    document.getElementById('add-profile-btn')?.addEventListener('click', openAddProfile)
    document.getElementById('profile-add-cancel')?.addEventListener('click', closeAddProfile)
    document.getElementById('profile-add-confirm')?.addEventListener('click', () => {
      const name = document.getElementById('new-profile-name').value.trim()
      if (!name) return
      const profiles = getProfiles()
      const guestIdx = profiles.findIndex(p => p.guest)
      const newP = { id: 'p_' + Date.now(), name, colorIdx: selectedColorIdx }
      if (guestIdx >= 0) profiles.splice(guestIdx, 0, newP)
      else profiles.push(newP)
      saveProfiles(profiles)
      renderProfileGrid()
      closeAddProfile()
    })
    document.getElementById('new-profile-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('profile-add-confirm').click()
    })
    document.getElementById('profile-add-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('profile-add-modal')) closeAddProfile()
    })

    // ── If profile already selected in this tab → skip intro ──
    const active = getActiveProfile()
    if (active) {
      document.getElementById('intro-screen').style.display = 'none'
      document.getElementById('profile-chooser').classList.add('hidden')
      document.getElementById('profile-chooser').style.opacity = '0'
      updateNavbarProfile(active)
      return
    }

    // ── Play intro ──
    // Sound starts ~400 ms in (logo scaling up)
    setTimeout(playIntroSound, 400)

    // After ~2.7 s: fade out intro, reveal profile chooser
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
