// node --test host/test/release.test.mjs   (what host/src/updater.js reads from GitHub's releases answer)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { compareVersions, parseVersion, pickRelease } from '../src/release.js';

// GitHub's own answer for the 1.7.0 release (trimmed to the fields that matter).
const real = JSON.parse(fs.readFileSync(new URL('./fixtures/latest-v1.7.0.json', import.meta.url), 'utf8'));

test('versions read from tags and compared by number', () => {
  assert.deepEqual(parseVersion('v1.7.0'), [1, 7, 0]);
  assert.deepEqual(parseVersion('1.10.2'), [1, 10, 2]);
  assert.equal(parseVersion('v1.8'), null);
  assert.equal(parseVersion('v1.8.0-beta'), null);
  assert.equal(parseVersion(undefined), null);
  assert.ok(compareVersions('v1.8.0', '1.7.0') > 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0, 'by number, not text');
  assert.ok(compareVersions('1.7.0', '1.7.1') < 0);
  assert.equal(compareVersions('v1.7.0', '1.7.0'), 0);
  assert.equal(compareVersions('nonsense', '1.7.0'), 0, 'no version is never newer');
});

test("the real release answer gives the installer and GitHub's SHA-256", () => {
  assert.deepEqual(pickRelease(real), {
    version: '1.7.0',
    url: 'https://github.com/unsalable/TruckPlay/releases/download/v1.7.0/TruckPlay-Kurulum.exe',
    size: 151960037,
    sha256: '344c08510fe7afbf833c47e1d727d8b9081deb01f575bc30740dc1b556f3c436',
  });
});

test('releases TruckPlay cannot take are left alone', () => {
  const asset = real.assets[0];
  const with_ = (patch, assetPatch) => ({ ...real, ...patch, assets: [{ ...asset, ...assetPatch }] });
  assert.equal(pickRelease(with_({ draft: true })), null, 'draft');
  assert.equal(pickRelease(with_({ prerelease: true })), null, 'pre-release');
  assert.equal(pickRelease(with_({ tag_name: 'latest' })), null, 'tag without a version');
  assert.equal(pickRelease(with_({}, { name: 'TruckPlay.zip' })), null, 'no installer');
  assert.equal(pickRelease(with_({}, { state: 'open' })), null, 'still uploading');
  assert.equal(pickRelease(with_({}, { digest: null })), null, 'no checksum');
  assert.equal(pickRelease(with_({}, { digest: 'md5:abc' })), null, 'not a SHA-256');
  assert.equal(pickRelease(with_({}, { size: 0 })), null, 'no size');
  assert.equal(pickRelease(with_({}, { browser_download_url: 'https://example.com/TruckPlay-Kurulum.exe' })), null, 'from elsewhere');
  assert.equal(pickRelease(with_({}, { browser_download_url: 'https://github.com/someone/TruckPlay/releases/download/v1.7.0/TruckPlay-Kurulum.exe' })), null, 'another repository');
  assert.equal(pickRelease(null), null);
  assert.equal(pickRelease({ message: 'Not Found' }), null);
});

test("the test cab's local feed only when allowed", () => {
  const local = { ...real, tag_name: 'v9.0.0', assets: [{ ...real.assets[0], browser_download_url: 'http://127.0.0.1:8123/TruckPlay-Kurulum.exe' }] };
  assert.equal(pickRelease(local), null);
  assert.equal(pickRelease(local, url => url.startsWith('http://127.0.0.1:'))?.version, '9.0.0');
});
