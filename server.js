// raccfo: a tiny static server with one API route that finds each app's
// downloadable clients on its GitHub releases. No dependencies.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(__dirname, 'site'));
const CONFIG_DIR = path.resolve(process.env.CONFIG_DIR || '/config');
const CACHE_MINUTES = Number(process.env.RELEASE_CACHE_MINUTES || 60);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- config ----------

// The site ships with site/apps.json. Drop your own apps.json into /config to
// override it without rebuilding the image. Files in /config/icons and
// /config/screenshots are served too, and win over the built-in ones.
async function loadConfig() {
  for (const file of [path.join(CONFIG_DIR, 'apps.json'), path.join(SITE_DIR, 'apps.json')]) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[raccfo] could not read ${file}: ${err.message}`);
    }
  }
  return { apps: [] };
}

// ---------- downloads from GitHub releases ----------

const CLIENT_EXT = /\.(apk|exe|msi|dmg|pkg|appimage|deb|rpm|zip)$/i;
const ALWAYS_SKIP = /(blockmap|\.sig$|sha256|checksum|latest.*\.yml|source code|-debug|symbols|plugin-)/i;

function describeAsset(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.apk')) {
    if (/\btv\b|-tv[-.]|androidtv|firetv/.test(n)) return { platform: 'tv', label: 'Android TV / Fire TV', kind: 'APK' };
    return { platform: 'android', label: 'Android', kind: 'APK' };
  }
  if (n.includes('roku')) return { platform: 'tv', label: 'Roku', kind: 'Channel zip' };
  if (n.endsWith('.exe') || n.endsWith('.msi')) {
    const kind = n.includes('portable') ? 'Portable' : n.endsWith('.msi') ? 'MSI installer' : 'Installer';
    return { platform: 'windows', label: 'Windows', kind };
  }
  if (n.endsWith('.dmg') || n.endsWith('.pkg')) return { platform: 'mac', label: 'Mac', kind: 'Installer' };
  if (n.endsWith('.appimage')) return { platform: 'linux', label: 'Linux', kind: 'AppImage' };
  if (n.endsWith('.deb')) return { platform: 'linux', label: 'Linux', kind: '.deb' };
  if (n.endsWith('.rpm')) return { platform: 'linux', label: 'Linux', kind: '.rpm' };
  return null;
}

async function fetchReleases(repo) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'raccfo' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${repo}`);
  return res.json();
}

// Newest asset wins for each platform + kind, so an APK attached to an older
// release still shows up when the newest release only has a Windows build.
function pickDownloads(releases, rules = {}) {
  const include = rules.include ? new RegExp(rules.include, 'i') : null;
  const exclude = rules.exclude ? new RegExp(rules.exclude, 'i') : null;
  const picked = new Map();
  for (const rel of releases) {
    if (rel.draft) continue;
    for (const a of rel.assets || []) {
      if (!CLIENT_EXT.test(a.name) || ALWAYS_SKIP.test(a.name)) continue;
      if (include && !include.test(a.name)) continue;
      if (exclude && exclude.test(a.name)) continue;
      // A bare .zip is only a client when the app says so (include rule) or it's a Roku channel.
      if (/\.zip$/i.test(a.name) && !include && !/roku/i.test(a.name)) continue;
      const d = describeAsset(a.name);
      if (!d) continue;
      const key = `${d.platform}|${d.label}|${d.kind}`;
      if (picked.has(key)) continue;
      picked.set(key, {
        ...d,
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        version: rel.tag_name,
        prerelease: !!rel.prerelease,
        published: a.updated_at || rel.published_at,
      });
    }
  }
  const order = ['android', 'tv', 'windows', 'mac', 'linux'];
  return [...picked.values()].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
}

let cache = { at: 0, data: null, pending: null };

async function buildDownloads() {
  const config = await loadConfig();
  const out = {};
  await Promise.all(
    (config.apps || []).map(async (app) => {
      if (!app.repo || app.downloads === false) return;
      const manual = Array.isArray(app.downloads?.links) ? app.downloads.links : [];
      try {
        const releases = await fetchReleases(app.repo);
        out[app.slug] = {
          releasesUrl: `https://github.com/${app.repo}/releases`,
          files: [...manual, ...pickDownloads(releases, app.downloads || {})],
        };
      } catch (err) {
        console.error(`[raccfo] ${err.message}`);
        out[app.slug] = { releasesUrl: `https://github.com/${app.repo}/releases`, files: manual, error: true };
      }
    }),
  );
  return { updated: new Date().toISOString(), apps: out };
}

async function getDownloads() {
  const fresh = cache.data && Date.now() - cache.at < CACHE_MINUTES * 60_000;
  if (fresh) return cache.data;
  if (!cache.pending) {
    cache.pending = buildDownloads()
      .then((data) => {
        // If GitHub couldn't be reached, try again in 5 minutes instead of waiting a full cache period.
        const failed = Object.values(data.apps).some((a) => a.error);
        const at = failed ? Date.now() - Math.max(0, CACHE_MINUTES - 5) * 60_000 : Date.now();
        cache = { at, data, pending: null };
        return data;
      })
      .catch((err) => {
        cache.pending = null;
        throw err;
      });
  }
  // Serve stale data right away if we have it, and refresh in the background.
  return cache.data || cache.pending;
}

// ---------- http ----------

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function safeJoin(root, urlPath) {
  const p = path.normalize(path.join(root, urlPath));
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

async function serveFile(res, file, req) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html' || ext === '.json';
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://raccfo');
    let pathname = decodeURIComponent(url.pathname);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    if (pathname === '/healthz') return send(res, 200, 'ok');

    if (pathname === '/api/apps') {
      return send(res, 200, JSON.stringify(await loadConfig()), TYPES['.json'], { 'Cache-Control': 'no-cache' });
    }

    if (pathname === '/api/downloads') {
      const data = await getDownloads();
      return send(res, 200, JSON.stringify(data), TYPES['.json'], { 'Cache-Control': 'public, max-age=300' });
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    // /config overrides first (custom icons, screenshots), then the built-in site.
    for (const root of [CONFIG_DIR, SITE_DIR]) {
      if (root === CONFIG_DIR && !/^\/(icons|screenshots|brand)\//.test(pathname)) continue;
      const file = safeJoin(root, pathname);
      if (!file) return send(res, 400, 'Bad path');
      try {
        return await serveFile(res, file, req);
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      }
    }
    return send(res, 404, 'Not found');
  } catch (err) {
    console.error('[raccfo]', err);
    if (!res.headersSent) send(res, 500, 'Something went wrong');
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[raccfo] listening on :${PORT} (site ${SITE_DIR}, config ${CONFIG_DIR})`);
    getDownloads().catch(() => {});
  });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = { pickDownloads, describeAsset, server };
