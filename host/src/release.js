// What TruckPlay's GitHub releases offer, read without Electron (host/test/release.test.mjs).
// A release is a tag vX.Y.Z on github.com/unsalable/TruckPlay with one file, TruckPlay-Kurulum.exe;
// GitHub publishes each file's SHA-256 next to it ("digest"), which is what a download is held to.

export const REPO = 'unsalable/TruckPlay';
export const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
export const ASSET = 'TruckPlay-Kurulum.exe';
const DOWNLOADS = `https://github.com/${REPO}/releases/download/`;

/** 'v1.8.0' or '1.8.0' -> [1, 8, 0]; null for anything else. */
export function parseVersion(v) {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(String(v ?? '').trim());
  return m ? m.slice(1).map(Number) : null;
}

/** Above 0 when a is newer than b, below 0 when older, 0 when the same (or either is no version). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * The installer a GitHub "latest release" answer offers: {version, url, size, sha256}, or null when
 * it offers none TruckPlay can take (a draft or pre-release, no such file, a file still uploading, no
 * checksum, or a download from anywhere but this repository's releases). `allow(url)` widens the
 * last check for the test cab's local feed.
 */
export function pickRelease(json, allow = () => false) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const v = parseVersion(json.tag_name);
  if (!v) return null;
  const asset = (Array.isArray(json.assets) ? json.assets : []).find(a => a && a.name === ASSET);
  if (!asset || (asset.state && asset.state !== 'uploaded')) return null;
  const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest ?? ''))?.[1]?.toLowerCase();
  const size = Number(asset.size);
  const url = String(asset.browser_download_url ?? '');
  if (!sha256 || !(size > 0) || !(url.startsWith(DOWNLOADS) || allow(url))) return null;
  return { version: v.join('.'), url, size, sha256 };
}
