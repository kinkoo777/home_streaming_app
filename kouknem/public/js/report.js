// ================= KOUKNEM — notice-and-action form (/copyright/report) =================
// Sends the notice to POST /api/notices (lib/notices.js validates the same fields).

;(function () {
  'use strict'

  const $ = id => document.getElementById(id)
  const form = $('report-form')
  const behalf = $('behalf')
  const onBehalf = $('f-onbehalf')

  onBehalf.addEventListener('change', () => { behalf.style.display = onBehalf.checked ? 'grid' : 'none' })

  function showErrors(fields) {
    form.querySelectorAll('.err').forEach(el => { el.textContent = (fields && fields[el.dataset.for]) || '' })
    form.querySelectorAll('.field').forEach(el => el.classList.toggle('invalid', !!(fields && fields[el.name])))
    const first = fields && Object.keys(fields)[0]
    const el = first && form.elements[first]
    if (el && el.focus) el.focus()
  }

  form.addEventListener('submit', e => {
    e.preventDefault()
    const f = form.elements
    const body = {
      name: f.name.value, email: f.email.value,
      work: f.work.value, material: f.material.value, location: f.location.value, explanation: f.explanation.value,
      onBehalf: f.onBehalf.checked, principal: f.principal.value, authority: f.authority.checked,
      goodFaith: f.goodFaith.checked
    }
    const btn = $('submit-btn')
    btn.disabled = true
    $('form-error').textContent = ''
    fetch('/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().catch(() => ({})).then(b => {
        if (!r.ok) {
          showErrors(b.fields)
          throw new Error(b.error || 'The notice could not be sent.')
        }
        showErrors(null)
        form.style.display = 'none'
        $('result-id').textContent = b.id
        $('result').style.display = ''
        $('result').focus()
        window.scrollTo(0, 0)
      }))
      .catch(err => {
        $('form-error').textContent = err.message === 'Failed to fetch' ? 'The server is not responding — please try again, or send the notice by email.' : err.message
      })
      .then(() => { btn.disabled = false })
  })
})()
