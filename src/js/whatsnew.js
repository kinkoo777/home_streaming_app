// ================= WHAT'S NEW VIDEO =================
// Plays once per profile, right after it is chosen, whenever VERSION changes.
// Seen state lives on the server (profile.settings.seenWhatsNew), so a profile
// doesn't get the video again on another device.

;(function () {
  'use strict'

  const VERSION = '2026-09'                 // bump together with a new video
  const SRC = 'media/whats-new.mp4'

  const $ = id => document.getElementById(id)
  let open = false

  function hasSeen(profile) {
    return !!(profile && profile.settings && profile.settings.seenWhatsNew === VERSION)
  }

  // The video isn't in git — only show the overlay when the file is actually there.
  let available = null
  async function videoAvailable() {
    if (available === null) {
      try { available = (await fetch(SRC, { method: 'HEAD' })).ok } catch (e) { available = false }
    }
    return available
  }

  function markSeen(profile) {
    const settings = Object.assign({}, profile.settings, { seenWhatsNew: VERSION })
    profile.settings = settings
    const active = getActiveProfile()
    if (active && active.id === profile.id) {
      active.settings = settings
      sessionStorage.setItem('filmbox_active_profile', JSON.stringify(active))
    }
    fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, jsonBody('PUT', { settings: { seenWhatsNew: VERSION } })).catch(() => {})
  }

  function close(profile, seen) {
    if (!open) return
    open = false
    const modal = $('whatsnew-modal'), video = $('whatsnew-video')
    video.pause()
    closeModal(modal)
    // Release the file so the TV doesn't keep buffering it in the background.
    setTimeout(() => { video.removeAttribute('src'); video.load() }, 300)
    if (seen) markSeen(profile)
    if (window.tvFocusStart) setTimeout(window.tvFocusStart, 320)
  }

  // Checked at page load so the overlay can start synchronously inside the
  // profile click — that keeps the browser's permission to autoplay with sound.
  function maybeShow(profile) {
    if (open || !profile || hasSeen(profile)) return false
    if (available === null) { videoAvailable().then(ok => { if (ok) maybeShow(profile) }); return false }
    if (!available) return false
    open = true
    const modal = $('whatsnew-modal'), video = $('whatsnew-video')
    const soundBtn = $('whatsnew-sound'), bar = $('whatsnew-progress-fill')

    bar.style.width = '0'
    soundBtn.classList.add('hidden')
    video.muted = false
    video.src = SRC
    openModal(modal, () => close(profile, true))

    video.onended = () => close(profile, true)
    video.onerror = () => close(profile, false)
    video.ontimeupdate = () => {
      if (video.duration) bar.style.width = (video.currentTime / video.duration * 100) + '%'
    }
    $('whatsnew-skip').onclick = () => close(profile, true)
    soundBtn.onclick = () => { video.muted = false; soundBtn.classList.add('hidden'); $('whatsnew-skip').focus() }

    // Autoplay with sound may be refused; fall back to muted with an "unmute" button.
    const p = video.play()
    if (p && p.catch) {
      p.catch(() => {
        if (!open) return
        video.muted = true
        soundBtn.classList.remove('hidden')
        if (document.body.classList.contains('kbd')) soundBtn.focus()
        video.play().catch(() => close(profile, false))
      })
    }
    return true
  }

  window.maybeShowWhatsNew = maybeShow
  document.addEventListener('DOMContentLoaded', videoAvailable)
})()
