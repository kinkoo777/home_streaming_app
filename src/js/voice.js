// ================= VOICE SEARCH =================
// A microphone in the search bar where the browser can turn speech into text
// (Chrome / Edge / Android, Safari 14.5+). Czech; words appear while you speak and
// search like typing. Not shown where the browser can't (Firefox, most TVs).

;(function () {
  'use strict'
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const input = document.getElementById('search-input')
  const bar = input && input.parentNode
  if (!SR || !bar || window.IS_TV) return

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'voice-btn'
  btn.title = 'Hledat hlasem'
  btn.setAttribute('aria-label', 'Hledat hlasem')
  btn.innerHTML = '<i class="bi bi-mic-fill"></i>'
  bar.insertBefore(btn, document.getElementById('search-mode'))

  let rec = null
  function stop() { if (rec) { try { rec.stop() } catch (e) {} } }
  btn.addEventListener('click', e => {
    e.preventDefault()
    if (rec) { stop(); return }
    rec = new SR()
    rec.lang = 'cs-CZ'
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onstart = () => { btn.classList.add('listening'); input.placeholder = 'Poslouchám…'; input.focus() }
    rec.onresult = ev => {
      let text = ''
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript
      input.value = text.replace(/[.?!]+$/, '').trim()
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    rec.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') showToast('Mikrofon není povolený — povolte ho v prohlížeči')
      else if (ev.error === 'no-speech') showToast('Nic jsem neslyšel — zkuste to znovu')
      else if (ev.error !== 'aborted') showToast('Hlasové hledání teď nejde (' + ev.error + ')')
    }
    rec.onend = () => { btn.classList.remove('listening'); input.placeholder = 'Filmy a seriály'; rec = null }
    try { rec.start() } catch (err) { rec = null; showToast('Hlasové hledání teď nejde') }
  })
})()
