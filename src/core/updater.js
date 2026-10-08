// Update checker: asks GitHub for this game's releases, compares them with VERSION and
// offers the newer build (plus every older version) as a download. The game is a folder
// you run with the launchers, so "updating" = download the new zip and unzip it over
// your old folder (your saves live in the browser, so they survive).
import { VERSION, settings, updateSettings } from './store.js';

export const UPDATE_REPO = 'TheGamingP3rs0n/Test-Game';
/* global __BUILD_DATE__ */
export const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : null;

export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function gh(path) {
  const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub rate limit hit — try again in a bit.' : `GitHub answered ${r.status}.`);
  return r.json();
}

/** @returns {{ latest, releases, newer, checkedAt }} */
export async function checkForUpdates() {
  let releases = [];
  const rel = await gh('releases?per_page=30');
  if (Array.isArray(rel) && rel.length) {
    releases = rel.filter((x) => !x.draft).map((x) => ({
      tag: x.tag_name, name: x.name || x.tag_name, date: x.published_at, notes: (x.body || '').trim(), page: x.html_url, prerelease: !!x.prerelease,
      download: (x.assets || []).find((a) => /\.zip$/i.test(a.name))?.browser_download_url || x.zipball_url,
    }));
  } else {
    const tags = await gh('tags?per_page=30');
    releases = (tags || []).filter((t) => /^v?\d+\.\d+/.test(t.name)).map((t) => ({ tag: t.name, name: t.name, date: null, notes: '', page: `https://github.com/${UPDATE_REPO}/releases/tag/${t.name}`, prerelease: false, download: t.zipball_url }));
  }
  releases.sort((a, b) => cmpVersion(b.tag, a.tag));
  const latest = releases.find((x) => !x.prerelease) || releases[0] || null;
  const checkedAt = Date.now();
  updateSettings({ lastUpdateCheck: checkedAt, lastSeenLatest: latest?.tag || null });
  return { latest, releases, newer: !!latest && cmpVersion(latest.tag, VERSION) > 0, checkedAt };
}

/** Quiet check at launch (at most once a day). Resolves to the newer release or null. */
export async function autoCheck() {
  if (settings.autoUpdateCheck === false) return null;
  if (Date.now() - (settings.lastUpdateCheck || 0) < 20 * 3600 * 1000) {
    return settings.lastSeenLatest && cmpVersion(settings.lastSeenLatest, VERSION) > 0 ? { tag: settings.lastSeenLatest } : null;
  }
  try {
    const r = await checkForUpdates();
    return r.newer ? r.latest : null;
  } catch {
    return null;
  }
}
