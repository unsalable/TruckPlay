// A stand-in for GitHub's releases API, for trying TruckPlay's updater locally.
//   node plugin/test/update-feed.mjs <installer.exe> <port> <tag> [--bad] [--slow]   (test cab: cab-v35*.txt)
// GET /latest.json answers like api.github.com/repos/.../releases/latest (with an ETag; 304 on a
// matching If-None-Match); GET /TruckPlay-Kurulum.exe serves the file, with Range (206) support.
// --bad lists a wrong SHA-256, to see the updater refuse the download; --slow answers the releases
// request after 1.5 s, so "Checking" stays on screen a moment.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const [file, portArg, tag] = process.argv.slice(2);
const bad = process.argv.includes('--bad');
const slow = process.argv.includes('--slow');
const port = Number(portArg);
const size = fs.statSync(file).size;
const hash = crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
const sha = bad ? '0'.repeat(64) : hash.digest('hex');
const release = {
  tag_name: tag,
  name: `TruckPlay ${tag}`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: 'TruckPlay-Kurulum.exe',
      state: 'uploaded',
      size,
      digest: `sha256:${sha}`,
      browser_download_url: `http://127.0.0.1:${port}/TruckPlay-Kurulum.exe`,
    },
  ],
};
const body = JSON.stringify(release);
const etag = `W/"${crypto.createHash('sha1').update(body).digest('hex')}"`;
const stamp = () => new Date().toISOString().slice(11, 19);

http
  .createServer((req, res) => {
    console.log(`${stamp()} ${req.method} ${req.url} ua=${req.headers['user-agent'] ?? '-'} range=${req.headers.range ?? '-'} inm=${req.headers['if-none-match'] ?? '-'}`);
    if (req.url === '/latest.json') {
      setTimeout(() => {
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
        res.end(body);
      }, slow ? 1500 : 0);
      return;
    }
    if (req.url === '/TruckPlay-Kurulum.exe') {
      const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
      const start = m ? Number(m[1]) : 0;
      if (start >= size) {
        res.writeHead(416);
        return res.end();
      }
      res.writeHead(m ? 206 : 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': size - start,
        ...(m ? { 'Content-Range': `bytes ${start}-${size - 1}/${size}` } : {}),
        'Accept-Ranges': 'bytes',
      });
      const stream = fs.createReadStream(file, { start });
      stream.pipe(res);
      res.on('close', () => console.log(`${stamp()} download closed (from ${start}, sent ${stream.bytesRead} bytes)`));
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, '127.0.0.1', () => console.log(`${stamp()} feed on http://127.0.0.1:${port}/latest.json: ${tag}, ${size} bytes, sha256 ${sha}`));
