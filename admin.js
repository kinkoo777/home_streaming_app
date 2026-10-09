// ================= SERVER PAGE =================
// Nastavení → Server: which version runs, updates waiting on GitHub, one-tap update
// (git pull → npm ci if the dependencies changed → restart) and the Pi's health —
// uptime, disk, memory, CPU temperature, recent errors. Main app only, never the
// guest server. FILMBOX_ALLOW_UPDATE=0 turns the update button off.

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

// ── Recent errors (console.error), for the page ──
const errors = [];
const origError = console.error;
console.error = function (...args) {
    try {
        const text = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        errors.push({ at: Date.now(), text: text.slice(0, 400) });
        if (errors.length > 30) errors.shift();
    } catch (e) {}
    return origError.apply(console, args);
};

function run(cmd, args, cwd, timeout) {
    return new Promise(resolve => {
        execFile(cmd, args, { cwd, timeout: timeout || 30000, maxBuffer: 4 * 1024 * 1024, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) },
            (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.code || 1) : 0, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() }));
    });
}

// How this process gets started again after an update.
//  pm2 → exits, pm2 starts it again · systemd / Docker → non-zero exit, Restart=on-failure /
//  restart policy brings it back · anything else (terminal, nohup) → starts its own
//  replacement, which waits for the port, then exits.
function restartMode() {
    if (process.env.pm_id != null) return 'pm2';
    if (process.env.INVOCATION_ID) return 'systemd';
    if (fs.existsSync('/.dockerenv')) return 'docker';
    return 'self';
}
function restart(dir) {
    const mode = restartMode();
    console.log('Restartuji po aktualizaci (' + mode + ')…');
    setTimeout(() => {
        if (mode === 'pm2') process.exit(0);
        if (mode === 'systemd' || mode === 'docker') process.exit(75);
        let out = 'ignore';
        try { out = fs.openSync(path.join(dir, 'filmbox.log'), 'a'); } catch (e) {}
        spawn(process.execPath, process.argv.slice(1), {
            cwd: dir, detached: true, stdio: ['ignore', out, out],
            env: Object.assign({}, process.env, { FILMBOX_WAIT_PORT: '1' })
        }).unref();
        process.exit(0);
    }, 800);
}

function cpuTemp() {
    try { return Math.round(parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8'), 10) / 100) / 10; }
    catch (e) { return null; }
}
async function disk(dir) {
    try {
        const s = await fs.promises.statfs(dir);
        return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch (e) { return null; }
}

// opts: { dir, dataDir, info: () => ({ rooms, funnel }) }
function router(opts) {
    const r = express.Router();
    const dir = opts.dir;
    const allowUpdate = process.env.FILMBOX_ALLOW_UPDATE !== '0';
    let job = null;          // { step, log[], done, error, startedAt }
    let lastFetch = null;    // { at, result }

    async function version() {
        const [log, branch] = await Promise.all([
            run('git', ['log', '-1', '--format=%h%x09%cI%x09%s'], dir),
            run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir)
        ]);
        if (!log.ok) return null;
        const [commit, date, subject] = log.out.split('\t');
        return { commit, date, subject, branch: branch.ok ? branch.out : null };
    }

    r.get('/status', async (req, res) => {
        const mem = process.memoryUsage();
        res.json({
            version: await version(),
            startedAt: Date.now() - Math.round(process.uptime() * 1000),
            node: process.version,
            host: os.hostname(),
            memory: { app: mem.rss, free: os.freemem(), total: os.totalmem() },
            load: os.loadavg()[0],
            cpus: os.cpus().length,
            temp: cpuTemp(),
            disk: await disk(opts.dataDir),
            restart: restartMode(),
            allowUpdate,
            updating: job && !job.done ? job.step : null,
            errors: errors.slice().reverse(),
            ...(opts.info ? opts.info() : {})
        });
    });

    // Changes waiting on GitHub (fetches at most once a minute).
    r.get('/updates', async (req, res) => {
        if (lastFetch && Date.now() - lastFetch.at < 60000 && !req.query.force) return res.json(lastFetch.result);
        const v = await version();
        if (!v || !v.branch || v.branch === 'HEAD') return res.json({ error: 'FilmBox neběží z gitu — aktualizujte ho ručně' });
        const fetched = await run('git', ['fetch', '--quiet', 'origin', v.branch], dir, 60000);
        if (!fetched.ok) return res.json({ error: 'GitHub není dostupný: ' + fetched.err.split('\n')[0] });
        const [log, status] = await Promise.all([
            run('git', ['log', 'HEAD..origin/' + v.branch, '--format=%h%x09%cI%x09%s', '-n', '50'], dir),
            run('git', ['status', '--porcelain', '--untracked-files=no'], dir)
        ]);
        const result = {
            branch: v.branch,
            changes: log.out ? log.out.split('\n').map(l => { const [commit, date, subject] = l.split('\t'); return { commit, date, subject }; }) : [],
            localChanges: status.ok && !!status.out
        };
        lastFetch = { at: Date.now(), result };
        res.json(result);
    });

    r.get('/update', (req, res) => res.json(job || { done: true, idle: true }));

    r.post('/update', async (req, res) => {
        if (!allowUpdate) return res.status(403).json({ error: 'Aktualizace z aplikace je vypnutá (FILMBOX_ALLOW_UPDATE=0)' });
        if (job && !job.done) return res.status(409).json({ error: 'Aktualizace už běží' });
        const v = await version();
        if (!v || !v.branch || v.branch === 'HEAD') return res.status(400).json({ error: 'FilmBox neběží z gitu — aktualizujte ho ručně' });
        job = { step: 'Stahuji změny', log: [], done: false, error: null, startedAt: Date.now(), from: v.commit };
        res.status(202).json(job);
        const fail = (msg, out) => { job.error = msg; job.done = true; if (out) job.log.push(out.slice(-2000)); console.error('Aktualizace selhala:', msg); };
        try {
            const before = await run('git', ['rev-parse', 'HEAD'], dir);
            const pull = await run('git', ['pull', '--ff-only', 'origin', v.branch], dir, 120000);
            job.log.push(pull.out || pull.err);
            if (!pull.ok) return fail('git pull se nepovedl — na serveru jsou možná ruční změny', pull.err);
            const after = await run('git', ['rev-parse', 'HEAD'], dir);
            if (before.out === after.out) { job.step = 'Už máte nejnovější verzi'; job.done = true; return; }
            const changed = await run('git', ['diff', '--name-only', before.out, after.out], dir);
            if (/^package(-lock)?\.json$/m.test(changed.out)) {
                job.step = 'Instaluji knihovny (může trvat pár minut)';
                const npm = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], dir, 15 * 60000);
                job.log.push((npm.out || npm.err).slice(-2000));
                if (!npm.ok) return fail('npm ci se nepovedl', npm.err);
            }
            job.step = 'Restartuji';
            job.to = after.out.slice(0, 7);
            job.done = true;
            job.restarting = true;
            restart(dir);
        } catch (err) {
            fail(err.message);
        }
    });
    return r;
}

module.exports = { router, restartMode };
