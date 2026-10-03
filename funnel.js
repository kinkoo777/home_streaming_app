// The public address of the watch-together guest server, for the links people share:
// PUBLIC_URL when set, otherwise a Tailscale Funnel that forwards to the guest port
// (read from `tailscale serve status --json`, the same config `tailscale funnel` writes).

const { execFile } = require('child_process');

// "pi.tailnet.ts.net" / "https://pi.tailnet.ts.net/" → "https://pi.tailnet.ts.net"; junk → ''.
function normalizeUrl(v) {
    let s = String(v || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
        const u = new URL(s);
        return (u.origin + u.pathname).replace(/\/+$/, '');
    } catch {
        return '';
    }
}

// Tailscale serve config → "https://host[:port]" of a Funnel proxying to `port`, or null.
// Shape: { AllowFunnel: { "pi.x.ts.net:443": true },
//          Web: { "pi.x.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } } } } }
function funnelUrlFrom(cfg, port) {
    if (!cfg || typeof cfg !== 'object') return null;
    const allow = cfg.AllowFunnel || {};
    const web = cfg.Web || {};
    const target = new RegExp('^(https?://)?((127\\.0\\.0\\.1|localhost|\\[::1\\]):)?' + port + '/?$');
    for (const hostPort of Object.keys(allow)) {
        if (!allow[hostPort]) continue;
        const handlers = (web[hostPort] && web[hostPort].Handlers) || {};
        const hit = Object.keys(handlers).some(path => {
            const proxy = handlers[path] && handlers[path].Proxy;
            return typeof proxy === 'string' && target.test(proxy);
        });
        if (!hit) continue;
        const i = hostPort.lastIndexOf(':');
        const host = i > 0 ? hostPort.slice(0, i) : hostPort;
        const p = i > 0 ? hostPort.slice(i + 1) : '443';
        return 'https://' + host + (p === '443' ? '' : ':' + p);
    }
    return null;
}

// cb(url | null). Quietly null when Tailscale isn't installed or Funnel isn't on.
function detectFunnel(port, cb) {
    execFile('tailscale', ['serve', 'status', '--json'], { timeout: 5000 }, (err, stdout) => {
        if (err) return cb(null);
        try { cb(funnelUrlFrom(JSON.parse(stdout), port)); } catch { cb(null); }
    });
}

module.exports = { normalizeUrl, funnelUrlFrom, detectFunnel };
