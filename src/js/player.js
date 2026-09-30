// ================= SOURCE PICKER (prehraj.to + fastshare.cloud + sledujteto.cz) =================

const prehrajModal         = document.getElementById('prehraj-modal')
const prehrajModalTitle    = document.getElementById('prehraj-modal-title')
const prehrajModalSubtitle = document.getElementById('prehraj-modal-subtitle')
const prehrajModalContent  = document.getElementById('prehraj-modal-content')
const prehrajQuery         = document.getElementById('prehraj-query')
const prehrajFilters       = document.getElementById('prehraj-filters')
const prehrajSites         = document.getElementById('prehraj-sites')
const prehrajSuggest       = document.getElementById('prehraj-suggest')

let _prehrajCtx = { title: '', baseTitle: '', tmdbId: null, mediaType: null, posterPath: null, episode: null }
let _prehrajResults = []     // what's shown (relevant only, unless "show all")
let _prehrajAll = []         // everything prehraj.to returned
let _prehrajShowAll = false
let _prehrajFilter = 'all'
let _prehrajSeq = 0          // ignore responses from superseded searches

function closePrehrajModal() {
  _prehrajSeq++
  closeSuggest()
  closeModal(prehrajModal)
}

const FILTERS = [
  { id: 'all',  label: 'Vše',        test: () => true },
  { id: 'dub',  label: 'CZ dabing',  icon: 'bi-mic',          test: r => r.dub },
  { id: 'subs', label: 'Titulky',    icon: 'bi-badge-cc',     test: r => r.subs },
  { id: '2160', label: '4K',         test: r => r.res === 2160 },
  { id: '1080', label: '1080p',      test: r => r.res === 1080 },
  { id: '720',  label: '720p',       test: r => r.res && r.res <= 720 }
]

// Czech household defaults: dubbed first, then quality, then subtitles.
const SOURCE_NAMES = { prehrajto: 'prehraj.to', fastshare: 'FastShare', sledujteto: 'Sledujteto' }
const SOURCE_KEYS = Object.keys(SOURCE_NAMES)

// ── Which sites to search (remembered per browser, shared with player.html) ──
function loadSites() {
  try {
    const list = JSON.parse(lsGet('filmbox_sources', 'null'))
    const valid = Array.isArray(list) ? list.filter(k => SOURCE_KEYS.indexOf(k) >= 0) : []
    return valid.length ? valid : SOURCE_KEYS.slice()
  } catch (e) { return SOURCE_KEYS.slice() }
}
let _sites = loadSites()

function sitesParam() {
  return _sites.length === SOURCE_KEYS.length ? '' : '&sources=' + encodeURIComponent(_sites.join(','))
}

function sitesLabel() {
  return _sites.map(k => SOURCE_NAMES[k]).join(', ').replace(/, ([^,]*)$/, ' a $1')
}

function renderSites() {
  prehrajSites.innerHTML = '<span class="sites-label">Hledat na:</span>' + SOURCE_KEYS.map(k => {
    const on = _sites.indexOf(k) >= 0
    return `<button class="chip${on ? ' active' : ''}" data-site="${k}" aria-pressed="${on}"><i class="bi ${on ? 'bi-check-lg' : 'bi-plus-lg'}"></i>${SOURCE_NAMES[k]}</button>`
  }).join('')
}

prehrajSites.addEventListener('click', e => {
  const chip = e.target.closest('[data-site]')
  if (!chip) return
  const k = chip.dataset.site
  const on = _sites.indexOf(k) >= 0
  if (on && _sites.length === 1) return             // keep at least one site
  _sites = on ? _sites.filter(x => x !== k) : SOURCE_KEYS.filter(x => x === k || _sites.indexOf(x) >= 0)
  lsSet('filmbox_sources', JSON.stringify(_sites))
  renderSites()
  const btn = prehrajSites.querySelector(`[data-site="${k}"]`)
  if (btn && document.body.classList.contains('kbd')) btn.focus()
  const q = prehrajQuery.value.trim() || _prehrajCtx.title
  if (q) runSourceSearch(q)
})

function sourceScore(r) {
  return (r.dub ? 30 : 0) + (r.res === 1080 ? 12 : r.res === 2160 ? 10 : r.res === 720 ? 6 : 0) + (r.subs ? 3 : 0)
}

function qualityTag(res) {
  if (res === 2160) return '<span class="q-4k">4K</span>'
  if (res === 1080) return '<span class="q-fhd">1080p</span>'
  if (res) return `<span class="q-hd">${res}p</span>`
  return ''
}

function renderSourceSkeletons() {
  let html = ''
  for (let i = 0; i < 5; i++) html += '<div class="source-skeleton"><div class="skeleton"></div><div class="lines"><div class="skeleton"></div><div class="skeleton"></div></div></div>'
  prehrajModalContent.innerHTML = html
}

// ── Relevance (see relevance.js): real films / episodes only ──
function relevantResults(all, query) {
  const ctx = _prehrajCtx
  const known = ctx.tmdbId ? searchDataMap[ctx.tmdbId] : null
  return FilmBoxRelevance.filterSources(all, {
    // Names the result title should contain: search box text, TMDB title, original title.
    names: [query, ctx.baseTitle, known && (known.title || known.name), known && (known.original_title || known.original_name)],
    mediaType: ctx.mediaType,
    episode: ctx.episode
  })
}

function applyRelevance() {
  const relevant = relevantResults(_prehrajAll, prehrajQuery.value)
  // Nothing passes? Show everything rather than an empty list.
  _prehrajResults = _prehrajShowAll || !relevant.length ? _prehrajAll.slice() : relevant
  return relevant
}

function renderFilters() {
  const present = FILTERS.filter(f => f.id === 'all' || _prehrajResults.some(f.test))
  prehrajFilters.innerHTML = present.length > 1 ? present.map(f =>
    `<button class="chip${f.id === _prehrajFilter ? ' active' : ''}" data-filter="${f.id}">${f.icon ? `<i class="bi ${f.icon}"></i>` : ''}${f.label} <span style="opacity:.55;margin-left:6px">${_prehrajResults.filter(f.test).length}</span></button>`
  ).join('') : ''
}

function renderSources() {
  const filter = FILTERS.find(f => f.id === _prehrajFilter) || FILTERS[0]
  const list = _prehrajResults.filter(filter.test)
  if (!list.length) {
    prehrajModalContent.innerHTML = '<div class="source-state"><i class="bi bi-funnel"></i>Žádný zdroj neodpovídá filtru.</div>'
    return
  }
  const bestUrl = _prehrajResults.slice().sort((a, b) => sourceScore(b) - sourceScore(a))[0].url
  prehrajModalContent.innerHTML = list.map((r, i) => {
    const rec = r.url === bestUrl
    return `
      <button class="source-item${rec ? ' recommended' : ''}" data-url="${escapeHtml(r.url)}" style="-webkit-animation-delay:${Math.min(i, 10) * 30}ms;animation-delay:${Math.min(i, 10) * 30}ms">
        <div class="source-thumb">
          ${r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
          ${r.duration ? `<span class="dur">${escapeHtml(r.duration)}</span>` : ''}
          <span class="play"><i class="bi bi-play-circle-fill"></i></span>
        </div>
        <div class="source-info">
          ${rec ? '<div class="source-recommend"><i class="bi bi-stars"></i> Doporučeno</div>' : ''}
          <h4>${escapeHtml(r.title)}</h4>
          <div class="source-tags">
            ${qualityTag(r.res)}
            ${r.dub ? '<span class="t-dub"><i class="bi bi-mic-fill"></i>CZ dabing</span>' : ''}
            ${r.subs ? '<span class="t-subs"><i class="bi bi-badge-cc-fill"></i>Titulky</span>' : ''}
            ${r.size ? `<span><i class="bi bi-hdd"></i>${escapeHtml(r.size)}</span>` : ''}
            <span class="t-src">${SOURCE_NAMES[r.source] || 'prehraj.to'}</span>
          </div>
        </div>
        <i class="bi bi-chevron-right source-go"></i>
      </button>`
  }).join('') + relevanceFooter()
}

function relevanceFooter() {
  const hidden = _prehrajAll.length - relevantResults(_prehrajAll, prehrajQuery.value).length
  if (hidden <= 0) return ''
  return _prehrajShowAll
    ? `<div class="source-note">Zobrazeny všechny výsledky včetně nesouvisejících videí.
         <button class="btn btn-ghost btn-sm" data-relevance="only"><i class="bi bi-funnel"></i> Jen filmy a seriály</button></div>`
    : `<div class="source-note">Skryto ${hidden} nesouvisejících videí (klipy, hry, trailery…).
         <button class="btn btn-ghost btn-sm" data-relevance="all"><i class="bi bi-eye"></i> Zobrazit vše</button></div>`
}

// episode (TV only) = { season, number } — kept so each episode tracks its own
// progress under a composite key "tmdbId:S01E05" instead of colliding on the show id.
function openPrehrajSearch(title, tmdbId, mediaType, posterPath, episode) {
  _prehrajCtx = {
    title,
    baseTitle: String(title || '').replace(/\s*S\d{1,2}E\d{1,3}.*$/i, '').trim(),
    tmdbId: tmdbId || null, mediaType: mediaType || null, posterPath: posterPath || null, episode: episode || null
  }
  prehrajModalTitle.textContent = title
  prehrajQuery.value = title
  _sites = loadSites()                               // may have changed in another tab
  renderSites()
  closeSuggest()
  openModal(prehrajModal, closePrehrajModal)
  runSourceSearch(title)
}

async function runSourceSearch(query) {
  const seq = ++_prehrajSeq
  _prehrajResults = []
  _prehrajAll = []
  _prehrajShowAll = false
  _prehrajFilter = 'all'
  prehrajFilters.innerHTML = ''
  prehrajModalSubtitle.textContent = `Hledání na ${sitesLabel()}…`
  renderSourceSkeletons()

  try {
    const response = await fetch(`/search?q=${encodeURIComponent(query)}${sitesParam()}`)
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Server neodpověděl')
    const results = await response.json()
    if (seq !== _prehrajSeq) return
    _prehrajAll = Array.isArray(results) ? results.filter(r => r && typeof r === 'object' && r.url) : []
    const relevant = applyRelevance()

    if (!_prehrajAll.length) {
      prehrajModalSubtitle.textContent = 'Žádné výsledky'
      prehrajModalContent.innerHTML = `
        <div class="source-state"><i class="bi bi-search"></i>
          Pro „${escapeHtml(query)}“ nebylo nic nalezeno.<br>Zkuste upravit název nahoře (např. bez roku nebo s anglickým názvem).
        </div>`
      prehrajQuery.focus()
      prehrajQuery.select()
      return
    }

    prehrajModalSubtitle.textContent = relevant.length
      ? `${relevant.length} ${relevant.length >= 5 ? 'zdrojů' : relevant.length === 1 ? 'zdroj' : 'zdroje'}`
      : 'Nic neodpovídá přesně — zobrazeny všechny výsledky'
    renderFilters()
    renderSources()
    if (document.body.classList.contains('kbd')) {
      const first = prehrajModalContent.querySelector('.source-item')
      if (first) first.focus()
    }
  } catch (err) {
    if (seq !== _prehrajSeq) return
    prehrajModalSubtitle.textContent = 'Chyba'
    prehrajModalContent.innerHTML = `<div class="source-state error"><i class="bi bi-exclamation-circle"></i>${escapeHtml(err.message)}</div>`
  }
}

async function playSource(url) {
  const seq = ++_prehrajSeq
  const ctx = _prehrajCtx
  prehrajModalSubtitle.textContent = 'Připravuji přehrávání…'
  prehrajFilters.innerHTML = ''
  prehrajModalContent.innerHTML = `
    <div class="source-resolving"><div class="ring"></div>
      <strong>Připravuji přehrávání</strong><p>Zjišťuji dostupné kvality a titulky…</p>
    </div>`

  try {
    const res = await fetch(`/get_video?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Server neodpověděl')
    // { name, duration, pageUrl, qualities: [{ src, label, res, hdr, transfer }], subtitles: [...] }
    const source = await res.json()
    if (seq !== _prehrajSeq) return
    if (!source.qualities || !source.qualities.length) throw new Error('Nepodařilo se získat odkaz na video')
    const ep = ctx.episode
    const episodeLabel = ep
      ? 'S' + String(ep.season).padStart(2, '0') + 'E' + String(ep.number).padStart(2, '0')
      : null
    const progressKey = (ctx.tmdbId && episodeLabel) ? `${ctx.tmdbId}:${episodeLabel}` : (ctx.tmdbId != null ? String(ctx.tmdbId) : null)
    sessionStorage.setItem('filmbox_player', JSON.stringify({
      title:      ctx.title,
      source,
      tmdbId:     ctx.tmdbId,
      mediaType:  ctx.mediaType,
      posterPath: ctx.posterPath,
      episode:    ep,
      episodeLabel,
      progressKey
    }))
    window.location.href = 'player.html'
  } catch (err) {
    if (seq !== _prehrajSeq) return
    prehrajModalSubtitle.textContent = 'Tento zdroj nefunguje'
    prehrajModalContent.innerHTML = `
      <div class="source-state error"><i class="bi bi-exclamation-circle"></i>${escapeHtml(err.message)}
        <div style="margin-top:16px"><button class="btn btn-ghost btn-sm" id="prehraj-back-to-list"><i class="bi bi-arrow-left"></i> Zpět na zdroje</button></div>
      </div>`
    const back = document.getElementById('prehraj-back-to-list')
    back.addEventListener('click', () => { renderFilters(); renderSources(); prehrajModalSubtitle.textContent = 'Vyberte jiný zdroj' })
    if (document.body.classList.contains('kbd')) back.focus()
  }
}

prehrajModalContent.addEventListener('click', e => {
  const rel = e.target.closest('[data-relevance]')
  if (rel) {
    _prehrajShowAll = rel.dataset.relevance === 'all'
    _prehrajFilter = 'all'
    applyRelevance()
    renderFilters()
    renderSources()
    return
  }
  const item = e.target.closest('.source-item[data-url]')
  if (item) playSource(item.dataset.url)
})
prehrajFilters.addEventListener('click', e => {
  const chip = e.target.closest('[data-filter]')
  if (!chip) return
  _prehrajFilter = chip.dataset.filter
  renderFilters()
  renderSources()
})
function submitSourceQuery() {
  closeSuggest()
  const q = prehrajQuery.value.trim()
  if (q) runSourceSearch(q)
}
document.getElementById('prehraj-query-btn').addEventListener('click', submitSourceQuery)

// ── Suggestions dropdown: the selected sites' own search hints ──
let _suggestSeq = 0
let _suggestIdx = -1
let _suggestTimer = null

function suggestOpen() { return prehrajSuggest.classList.contains('active') }
function closeSuggest() {
  clearTimeout(_suggestTimer)
  _suggestSeq++
  _suggestIdx = -1
  prehrajSuggest.classList.remove('active')
  prehrajQuery.setAttribute('aria-expanded', 'false')
}

function setSuggestFocus(idx) {
  const items = prehrajSuggest.querySelectorAll('.suggest-item')
  if (!items.length) return
  _suggestIdx = Math.max(-1, Math.min(idx, items.length - 1))
  items.forEach((el, i) => el.classList.toggle('focused', i === _suggestIdx))
  if (_suggestIdx >= 0) items[_suggestIdx].scrollIntoView({ block: 'nearest' })
}

// Bold the part of the hint that goes beyond what was typed.
function highlightTerm(term, typed) {
  const t = typed.trim().toLowerCase()
  if (t && term.toLowerCase().indexOf(t) === 0) return escapeHtml(term.slice(0, t.length)) + '<b>' + escapeHtml(term.slice(t.length)) + '</b>'
  return escapeHtml(term)
}

async function loadSuggestions() {
  const q = prehrajQuery.value.trim()
  if (q.length < 2) { closeSuggest(); return }
  const seq = ++_suggestSeq
  try {
    const res = await fetch(`/suggest?q=${encodeURIComponent(q)}${sitesParam()}`)
    const list = res.ok ? await res.json() : []
    if (seq !== _suggestSeq || document.activeElement !== prehrajQuery) return
    if (!list.length) { closeSuggest(); return }
    const showSrc = _sites.length > 1
    _suggestIdx = -1
    prehrajSuggest.innerHTML = list.map(s => `
      <div class="suggest-item" role="option" data-term="${escapeHtml(s.term)}">
        <i class="bi bi-search"></i>
        <span class="term">${highlightTerm(s.term, q)}</span>
        ${showSrc ? s.sources.map(k => `<span class="src">${escapeHtml(SOURCE_NAMES[k] || k)}</span>`).join('') : ''}
      </div>`).join('')
    prehrajSuggest.classList.add('active')
    prehrajQuery.setAttribute('aria-expanded', 'true')
  } catch (e) {
    if (seq === _suggestSeq) closeSuggest()
  }
}

function pickSuggestion(term) {
  prehrajQuery.value = term
  closeSuggest()
  runSourceSearch(term)
}

prehrajQuery.addEventListener('input', () => {
  clearTimeout(_suggestTimer)
  if (prehrajQuery.value.trim().length < 2) { closeSuggest(); return }
  _suggestTimer = setTimeout(loadSuggestions, 220)
})

prehrajQuery.addEventListener('keydown', e => {
  const items = prehrajSuggest.querySelectorAll('.suggest-item')
  if (e.key === 'ArrowDown' && suggestOpen() && items.length) {
    e.preventDefault()
    setSuggestFocus(_suggestIdx + 1)
  } else if (e.key === 'ArrowUp' && suggestOpen() && _suggestIdx >= 0) {
    e.preventDefault()
    setSuggestFocus(_suggestIdx - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (suggestOpen() && _suggestIdx >= 0 && items[_suggestIdx]) pickSuggestion(items[_suggestIdx].dataset.term)
    else submitSourceQuery()
  } else if (e.key === 'Escape' && suggestOpen()) {
    e.preventDefault()                               // close the dropdown, not the whole picker
    closeSuggest()
  }
})

// mousedown keeps focus in the field; click picks the hint.
prehrajSuggest.addEventListener('mousedown', e => e.preventDefault())
prehrajSuggest.addEventListener('click', e => {
  const item = e.target.closest('.suggest-item')
  if (item) pickSuggestion(item.dataset.term)
})
prehrajQuery.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== prehrajQuery) closeSuggest() }, 120))
