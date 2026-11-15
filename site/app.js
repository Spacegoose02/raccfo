'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/></svg>',
  android: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M10.5 18h3"/></svg>',
  tv: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/><path d="m9 2 3 3 3-3"/></svg>',
  windows: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>',
  mac: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M2 20h20"/></svg>',
  linux: '<svg viewBox="0 0 24 24"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
};
const PLATFORM_NAMES = { android: 'Android', tv: 'TV', windows: 'Windows', mac: 'Mac', linux: 'Linux' };

// Best guess at what the visitor is on, to highlight the right download.
function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/AFT|BRAVIA|SmartTV|GoogleTV|Android TV|CrKey|Roku/i.test(ua)) return 'tv';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh/i.test(ua)) return 'mac';
  if (/Linux|CrOS/i.test(ua)) return 'linux';
  return null;
}
const MY = detectPlatform();

const state = { config: null, downloads: {}, filter: 'all', q: '' };

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}
function size(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(mb >= 100 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------- cards ----------

function peek(app) {
  const shot = app.screenshots?.[0];
  if (!shot) {
    return `<div class="peek placeholder" aria-hidden="true"><img src="${esc(app.icon)}" alt="" loading="lazy"></div>`;
  }
  const n = app.screenshots.length;
  return `<button class="peek" data-shots="${esc(app.slug)}" aria-label="See ${n} screenshot${n > 1 ? 's' : ''} of ${esc(app.name)}">
    <img src="${esc(shot.src)}" alt="" loading="lazy">
    ${n > 1 ? `<span class="shots-count">${n} screenshots</span>` : ''}
  </button>`;
}

function downloadHint(app) {
  const files = state.downloads[app.slug]?.files || [];
  if (!files.length) return '';
  const platforms = [...new Set(files.map((f) => f.platform))];
  const match = platforms.includes(MY);
  return `<p class="has-dl ${match ? 'match' : ''}">Get the app:
    <span class="pl">${platforms.map((p) => `<span class="${p === MY ? 'on' : ''}">${PLATFORM_NAMES[p] || p}</span>`).join('')}</span></p>`;
}

function card(app) {
  const replaces = app.replaces?.length
    ? `<p class="replaces">Replaces ${app.replaces.map((r) => `<span class="old">${esc(r)}</span>`).join('')}</p>`
    : '';
  return `<article class="card" style="--app:${esc(app.accent || '#3a3e55')}" data-slug="${esc(app.slug)}">
    ${peek(app)}
    <div class="body">
      <div class="head">
        <div class="icon"><img src="${esc(app.icon)}" alt="" width="62" height="62" loading="lazy"></div>
        <div>
          <h3>${esc(app.name)}${app.isNew ? '<span class="badge-new">New</span>' : ''}</h3>
          <p class="tag">${esc(app.tagline)}</p>
          <p class="host">${esc(hostOf(app.url))}</p>
        </div>
      </div>
      <p class="desc">${esc(app.description)}</p>
      ${replaces}
      ${downloadHint(app)}
      <div class="actions">
        <a class="btn primary" href="${esc(app.url)}" target="_blank" rel="noopener">${ICONS.open} Open</a>
        <button class="btn ghost" data-detail="${esc(app.slug)}" aria-label="More about ${esc(app.name)}">${ICONS.info} More</button>
      </div>
    </div>
  </article>`;
}

function matches(app) {
  if (state.filter !== 'all' && app.category !== state.filter) return false;
  if (!state.q) return true;
  const hay = [app.name, app.tagline, app.description, ...(app.replaces || []), ...(app.keywords || []), hostOf(app.url)].join(' ').toLowerCase();
  return state.q.split(/\s+/).every((w) => hay.includes(w));
}

function render() {
  const { config } = state;
  const cats = config.categories?.length ? config.categories : [{ id: '_', name: 'Apps' }];
  const html = cats
    .map((c) => {
      const apps = config.apps.filter((a) => (a.category || '_') === c.id || (cats.length === 1)).filter(matches);
      if (!apps.length) return '';
      return `<section class="section"><h2>${esc(c.name)}</h2><div class="grid">${apps.map(card).join('')}</div></section>`;
    })
    .join('');
  $('#sections').innerHTML = html;
  $('#empty').hidden = !!html;
}

function renderChips() {
  const cats = state.config.categories || [];
  if (!cats.length) return;
  const all = [{ id: 'all', name: 'Everything' }, ...cats];
  $('#chips').innerHTML = all
    .map((c) => `<button class="chip" data-filter="${esc(c.id)}" aria-pressed="${state.filter === c.id}">${esc(c.name)}</button>`)
    .join('');
}

// ---------- detail ----------

function downloadsBlock(app) {
  const d = state.downloads[app.slug];
  const files = d?.files || [];
  if (!files.length && d?.error) {
    return `<div><h3>Get the app</h3><p class="note">Couldn't check for app downloads just now. <a href="${esc(d.releasesUrl)}" rel="noopener">See all downloads on GitHub</a>.</p></div>`;
  }
  if (!files.length) {
    return `<div><h3>On your phone</h3><p class="note">No separate app needed: open it in your browser and use <b>Add to Home Screen</b> (iPhone) or <b>Install app</b> (Android) to keep it one tap away.</p></div>`;
  }
  const items = files
    .map((f) => {
      const meta = [f.kind, f.version, size(f.size)].filter(Boolean).join(' · ');
      return `<a class="dl ${f.platform === MY ? 'mine' : ''}" href="${esc(f.url)}" rel="noopener">
        <span class="pi">${ICONS[f.platform] || ICONS.windows}</span>
        <span><b>${esc(f.label)}${f.platform === MY ? ' · your device' : ''}</b><small>${esc(meta)}${f.prerelease ? ' · beta' : ''}</small></span>
      </a>`;
    })
    .join('');
  const ios = MY === 'ios' && !files.some((f) => f.platform === 'ios')
    ? `<p class="note">On iPhone and iPad, open it in Safari and use <b>Share → Add to Home Screen</b>.</p>` : '';
  return `<div><h3>Get the app</h3><div class="dl-list">${items}</div>${ios}
    <p class="note" style="margin-top:8px">Android: the first time, your browser will ask to allow installing apps. Say yes, then open the downloaded file.</p></div>`;
}

function openDetail(slug) {
  const app = state.config.apps.find((a) => a.slug === slug);
  if (!app) return;
  const shots = app.screenshots || [];
  const replaces = app.replaces?.length
    ? `<p class="replaces">Replaces ${app.replaces.map((r) => `<span class="old">${esc(r)}</span>`).join('')}</p>` : '';
  $('#d-body').innerHTML = `
    <div class="d-hero" style="--app:${esc(app.accent || '#3a3e55')}">
      <img src="${esc(app.icon)}" alt="">
      <div><h2 id="d-name">${esc(app.name)}${app.isNew ? '<span class="badge-new">New</span>' : ''}</h2><p>${esc(app.tagline)}</p></div>
    </div>
    <div class="d-content">
      <div class="d-top">
        <a class="btn primary" href="${esc(app.url)}" target="_blank" rel="noopener">${ICONS.open} Open ${esc(hostOf(app.url))}</a>
        ${replaces}
      </div>
      <div><h3>What is it?</h3><p>${esc(app.description)}</p></div>
      ${shots.length ? `<div><h3>Take a look</h3><div class="d-shots">${shots
        .map((s, i) => `<button data-shot="${esc(app.slug)}" data-i="${i}"><img src="${esc(s.src)}" alt="" loading="lazy"><span>${esc(s.caption || '')}</span></button>`)
        .join('')}</div></div>` : ''}
      ${downloadsBlock(app)}
      ${app.tips?.length ? `<div><h3>Good to know</h3><ul class="tips">${app.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  const dlg = $('#detail');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  history.replaceState(null, '', `#${slug}`);
}

// ---------- screenshot viewer ----------

const viewer = { app: null, i: 0 };
function showShot(slug, i) {
  const app = state.config.apps.find((a) => a.slug === slug);
  if (!app?.screenshots?.length) return;
  const n = app.screenshots.length;
  viewer.app = app;
  viewer.i = (i + n) % n;
  const s = app.screenshots[viewer.i];
  $('#v-img').src = s.src;
  $('#v-img').alt = s.caption || `${app.name} screenshot`;
  $('#v-cap').textContent = `${app.name} · ${s.caption || ''} (${viewer.i + 1} of ${n})`;
  const many = n > 1;
  $('#viewer .prev').hidden = !many;
  $('#viewer .next').hidden = !many;
  if (!$('#viewer').open) $('#viewer').showModal();
}

// ---------- wiring ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-detail],[data-shots],[data-shot],[data-filter],[data-close],.viewer .prev,.viewer .next');
  if (!t) {
    if (e.target.tagName === 'DIALOG') e.target.close(); // click on backdrop
    return;
  }
  if (t.dataset.detail) openDetail(t.dataset.detail);
  else if (t.dataset.shots) showShot(t.dataset.shots, 0);
  else if (t.dataset.shot) showShot(t.dataset.shot, Number(t.dataset.i));
  else if (t.dataset.filter) { state.filter = t.dataset.filter; renderChips(); render(); }
  else if ('close' in t.dataset) t.closest('dialog').close();
  else if (t.classList.contains('prev')) showShot(viewer.app.slug, viewer.i - 1);
  else if (t.classList.contains('next')) showShot(viewer.app.slug, viewer.i + 1);
});

document.addEventListener('keydown', (e) => {
  if (!$('#viewer').open) return;
  if (e.key === 'ArrowLeft') showShot(viewer.app.slug, viewer.i - 1);
  if (e.key === 'ArrowRight') showShot(viewer.app.slug, viewer.i + 1);
});

$('#detail').addEventListener('close', () => history.replaceState(null, '', location.pathname));
$('#q').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });

async function init() {
  const res = await fetch('api/apps').catch(() => null);
  state.config = res?.ok ? await res.json() : await (await fetch('apps.json')).json();
  const site = state.config.site || {};
  if (site.tagline) $('#tagline').textContent = site.tagline;
  if (site.intro) $('#intro').textContent = site.intro;
  if (MY) {
    const name = { ios: 'an iPhone or iPad', android: 'Android', tv: 'a TV', windows: 'Windows', mac: 'a Mac', linux: 'Linux' }[MY];
    $('#device').innerHTML = `Looks like you're on <b>${name}</b>. We'll point you to the right download.`;
    $('#device').hidden = false;
  }
  renderChips();
  render();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) openDetail(hash);

  // Downloads come from GitHub through the server and can take a moment.
  fetch('api/downloads')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      state.downloads = d.apps || {};
      render();
      if ($('#detail').open) openDetail(location.hash.slice(1));
    })
    .catch(() => {});
}

init();

window.addEventListener('hashchange', () => {
  const slug = decodeURIComponent(location.hash.slice(1));
  if (slug && state.config) openDetail(slug);
});

// Space (dark) is the default; the switch remembers a choice of light on this device.
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>';
function paintToggle() {
  const light = document.documentElement.dataset.theme === 'light';
  const btn = $('#theme');
  btn.innerHTML = light ? `${MOON} Space` : `${SUN} Light`;
  btn.setAttribute('aria-label', light ? 'Switch to the space theme' : 'Switch to the light theme');
  document.querySelector('meta[name="theme-color"]').content = light ? '#1b1e33' : '#070919';
}
$('#theme').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('raccfo-theme', light ? 'light' : 'space'); } catch {}
  paintToggle();
});
paintToggle();
