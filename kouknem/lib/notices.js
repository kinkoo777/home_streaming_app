// ── Notice-and-action (copyright / illegal-content reports) ──
//
// What the Copyright, Notice-and-Action & Intermediary Services Policy promises,
// as code:
//   - notices sent through the reporting form are validated (the eight items the
//     policy asks for) and appended to data/notices.jsonl with a reference number;
//   - a URL removed after a valid notice goes on data/blocked.json — blocked URLs
//     are never listed, picked or refreshed for a room again ("re-indexing
//     prevention"), and rooms playing one stop it at once;
//   - decisions are taken by a person with tools/admin.js, never automatically:
//     a notice by itself does not establish that the material is unlawful.
//
// Files are plain JSON so they are easy to preserve for legal / compliance needs.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX = { name: 120, email: 200, work: 2000, material: 2000, location: 4000, explanation: 6000, principal: 200 };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// Exact URL as the blocklist stores it: no fragment, no trailing slash, lower-case host.
function normalizeUrl(raw) {
    try {
        const u = new URL(String(raw).trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        u.hash = '';
        u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
        u.protocol = 'https:';
        return u.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

function clean(v, max) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

// Form body → { notice } or { errors: { field: message } }.
function validateNotice(b) {
    b = b || {};
    const n = {
        name: clean(b.name, MAX.name),
        email: clean(b.email, MAX.email),
        work: clean(b.work, MAX.work),
        material: clean(b.material, MAX.material),
        location: clean(b.location, MAX.location),
        explanation: clean(b.explanation, MAX.explanation),
        onBehalf: b.onBehalf === true || b.onBehalf === 'on' || b.onBehalf === 'true',
        principal: clean(b.principal, MAX.principal),
        authority: b.authority === true || b.authority === 'on' || b.authority === 'true',
        goodFaith: b.goodFaith === true || b.goodFaith === 'on' || b.goodFaith === 'true'
    };
    const errors = {};
    if (!n.name) errors.name = 'Enter your full name or the name of the organisation.';
    if (!EMAIL.test(n.email)) errors.email = 'Enter a valid email address.';
    if (!n.work) errors.work = 'Identify the copyrighted work or other right concerned.';
    if (!n.material) errors.material = 'Identify the allegedly infringing or illegal material.';
    if (!n.location) errors.location = 'Give the exact URL(s) or other information to locate the material.';
    if (n.explanation.length < 20) errors.explanation = 'Explain in reasonable detail why the material is unlawful.';
    if (n.onBehalf && !n.principal) errors.principal = 'Name the person or organisation you represent.';
    if (n.onBehalf && !n.authority) errors.authority = 'Confirm that you are authorised to act on their behalf.';
    if (!n.goodFaith) errors.goodFaith = 'Confirm that the notice is accurate and submitted in good faith.';
    if (!n.onBehalf) { n.principal = ''; n.authority = false; }
    // URLs found in the location field — what an operator can block in one step.
    n.urls = [...new Set((n.location.match(/https?:\/\/[^\s<>"']+/g) || []).map(normalizeUrl).filter(Boolean))].slice(0, 200);
    return Object.keys(errors).length ? { errors } : { notice: n };
}

function createNotices(dataDir) {
    const NOTICES = path.join(dataDir, 'notices.jsonl');
    const BLOCKED = path.join(dataDir, 'blocked.json');
    let blocked = new Map();           // normalized url → { noticeId, at, note }
    let blockedMtime = 0;
    const listeners = new Set();

    function ensureDir() { fs.mkdirSync(dataDir, { recursive: true }); }

    function loadBlocked() {
        let st = null;
        try { st = fs.statSync(BLOCKED); } catch { /* none yet */ }
        if (!st) { if (blocked.size) { blocked = new Map(); listeners.forEach(fn => fn()); } blockedMtime = 0; return; }
        if (st.mtimeMs === blockedMtime) return;
        blockedMtime = st.mtimeMs;
        try {
            const list = JSON.parse(fs.readFileSync(BLOCKED, 'utf8'));
            blocked = new Map((Array.isArray(list) ? list : []).filter(e => e && e.url).map(e => [normalizeUrl(e.url) || e.url, e]));
        } catch (err) {
            console.error('blocked.json nelze přečíst — ponechávám předchozí seznam:', err.message);
            return;
        }
        listeners.forEach(fn => fn());
    }
    loadBlocked();
    // The admin tool may run as a separate process: pick its changes up.
    setInterval(loadBlocked, 5000).unref();

    function saveBlocked() {
        ensureDir();
        const tmp = BLOCKED + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify([...blocked.values()], null, 2));
        fs.renameSync(tmp, BLOCKED);
        blockedMtime = fs.statSync(BLOCKED).mtimeMs;
        listeners.forEach(fn => fn());
    }

    function isBlocked(url) {
        const n = normalizeUrl(url);
        return !!n && blocked.has(n);
    }

    function block(url, info) {
        const n = normalizeUrl(url);
        if (!n) throw new Error('Not a valid URL: ' + url);
        blocked.set(n, Object.assign({ url: n, at: new Date().toISOString() }, info || {}));
        saveBlocked();
        return n;
    }

    function unblock(url) {
        const n = normalizeUrl(url);
        const had = !!n && blocked.delete(n);
        if (had) saveBlocked();
        return had;
    }

    function add(notice) {
        ensureDir();
        const id = 'KN-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const entry = Object.assign({ id, receivedAt: new Date().toISOString(), status: 'received' }, notice);
        fs.appendFileSync(NOTICES, JSON.stringify(entry) + '\n');
        return entry;
    }

    // Every notice with its latest status (status changes are appended as { id, status, … } lines).
    function list() {
        let lines = [];
        try { lines = fs.readFileSync(NOTICES, 'utf8').split('\n').filter(Boolean); } catch { return []; }
        const byId = new Map();
        for (const line of lines) {
            let e;
            try { e = JSON.parse(line); } catch { continue; }
            if (!e || !e.id) continue;
            if (byId.has(e.id) && e.update) byId.set(e.id, Object.assign(byId.get(e.id), e.update, { updatedAt: e.at }));
            else if (!e.update) byId.set(e.id, e);
        }
        return [...byId.values()];
    }

    function setStatus(id, status, note) {
        if (!list().some(n => n.id === id)) throw new Error('Unknown notice ' + id);
        ensureDir();
        fs.appendFileSync(NOTICES, JSON.stringify({ id, at: new Date().toISOString(), update: { status, note: note || '' } }) + '\n');
    }

    return {
        add, list, setStatus, isBlocked, block, unblock,
        blockedList: () => [...blocked.values()],
        onBlockedChange: fn => listeners.add(fn),
        reload: loadBlocked
    };
}

module.exports = { createNotices, validateNotice, normalizeUrl };
