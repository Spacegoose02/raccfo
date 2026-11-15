'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDownloads } = require('../server.js');

const asset = (name, size = 1000) => ({ name, size, browser_download_url: `https://example.test/${name}`, updated_at: '2026-11-01T00:00:00Z' });
const rel = (tag, names, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: names.map((n) => asset(n)), ...extra });

test('BingeBandit: keeps TV, Windows app and Roku, drops server binaries and plugins', () => {
  const releases = [
    rel('v0.9.0', [
      'bingebandit-v0.9.0-windows-amd64.exe', 'bingebandit-v0.9.0-linux-amd64', 'plugin-foo-v0.9.0-linux-amd64.zip',
      'BingeBandit-TV-v0.9.0.apk', 'BingeBandit-Windows-Setup-0.9.0.exe', 'BingeBandit-Windows-Setup-0.9.0.exe.blockmap',
      'BingeBandit-Roku-v0.9.0.zip',
    ]),
  ];
  const got = pickDownloads(releases, { include: 'BingeBandit-(TV|Windows|Roku)' });
  assert.deepEqual(got.map((d) => `${d.label}/${d.kind}`), ['Android TV / Fire TV/APK', 'Roku/Channel zip', 'Windows/Installer']);
});

test('newest asset per platform wins, older releases fill gaps', () => {
  const releases = [rel('v2', ['DenDuty-Setup.exe']), rel('v1', ['DenDuty-Setup-1.exe', 'DenDuty.apk'])];
  const got = pickDownloads(releases);
  assert.equal(got.find((d) => d.platform === 'windows').version, 'v2');
  assert.equal(got.find((d) => d.platform === 'android').version, 'v1');
});

test('debug APKs, checksums and drafts are skipped; plain zips need an include rule', () => {
  const releases = [
    rel('v3', ['Dendrop-3-android.apk'], { draft: true }),
    rel('v2', ['Dendrop-2-android-debug.apk', 'Dendrop-2-android.apk', 'Dendrop.AppImage', 'Dendrop_2_amd64.deb', 'SHA256SUMS.txt', 'lootden-cli-win-x64.zip']),
  ];
  const got = pickDownloads(releases, { exclude: 'debug' });
  assert.deepEqual(got.map((d) => d.name), ['Dendrop-2-android.apk', 'Dendrop.AppImage', 'Dendrop_2_amd64.deb']);
});

test('portable and installer exes are both offered', () => {
  const got = pickDownloads([rel('v1', ['DenDuty-Setup.exe', 'DenDuty-Portable.exe', 'BookBandit-1-windows-x64.msi'])]);
  assert.deepEqual(got.map((d) => d.kind).sort(), ['Installer', 'MSI installer', 'Portable']);
});
