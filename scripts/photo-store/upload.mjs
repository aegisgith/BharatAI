// Event photos -> R2, step 2 (23 Nov 2026): copy every photo in the manifest to R2.
//
// For each photo: fetch the original from Drive, make the small and medium versions
// from it, and put all three in the bucket bharatai-uploads:
//   event-photos/<event>/<pid>/s.jpg   600 px long side, for grids and emails
//   event-photos/<event>/<pid>/m.jpg   1600 px long side, to look at on a phone
//   event-photos/<event>/<pid>/o.jpg   the original (for a RAW photo, Drive's full-size JPEG of it)
// The worker serves these only through signed links (src/routes/photo-store.ts); the
// bucket is never public. The small and medium versions carry no camera metadata.
//
// How: in batches. A batch of photos is fetched and resized into <dir>/staging/, sent
// with `wrangler r2 bulk put --remote` (wrangler's own sign-in), then deleted, while the
// next batch is being fetched. This computer has ~9 GB free and the originals are ~30 GB,
// so at most two batches are ever on disk. (wrangler's remote binding, getPlatformProxy,
// crashed on this computer: "access violation in the runtime".)
//
// Resumable: every photo sent is a line in <dir>/progress.jsonl; a re-run skips them.
// A photo Drive would not give is a line in <dir>/failed.jsonl, tried again next run.
//
// usage: node scripts/photo-store/upload.mjs <dir with manifest.json> [--limit N] [--batch 120] [--fetch 6] [--puts 8] [--event 1]
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const args = process.argv.slice(2);
const DIR = args[0];
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i > 0 ? args[i + 1] : dflt; };
const LIMIT = Number(opt('limit', 0)) || Infinity;
const BATCH = Math.max(1, Number(opt('batch', 120)));
const FETCH = Math.max(1, Number(opt('fetch', 6)));
const EVENT = Number(opt('event', 1));
const BUCKET = 'bharatai-uploads';
if (!DIR) { console.error('usage: upload.mjs <dir> [--limit N] [--batch N] [--fetch N]'); process.exit(2); }

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const PROGRESS = join(DIR, 'progress.jsonl');
const FAILED = join(DIR, 'failed.jsonl');
const STAGING = join(DIR, 'staging');
const done = new Set();
if (existsSync(PROGRESS)) for (const line of readFileSync(PROGRESS, 'utf8').split('\n')) { try { done.add(JSON.parse(line).pid); } catch {} }
const todo = manifest.filter(r => !done.has(r.pid)).slice(0, LIMIT);
writeFileSync(FAILED, '');
console.log(`${manifest.length} in the manifest, ${done.size} already copied, ${todo.length} to copy now (batches of ${BATCH}, ${FETCH} fetches at a time)`);
if (!todo.length) process.exit(0);

const UA = { 'User-Agent': 'bharatai-photo-store/1.0' };
async function original(r) {
  // A JPG: the file itself. A RAW: Drive's full-size JPEG render (=s0).
  const url = r.raw
    ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(r.drive_id)}=s0`
    : `https://drive.usercontent.google.com/download?id=${encodeURIComponent(r.drive_id)}&export=download&confirm=t`;
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`Drive answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Drive answers a refused download (quota, sign-in) with an HTML page, status 200.
  if (/text\/html/.test(type) || buf.length < 20000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`not a JPEG (${type}, ${buf.length} bytes)`);
  if (!r.raw && r.drive_bytes && buf.length !== r.drive_bytes) throw new Error(`size ${buf.length} is not Drive's ${r.drive_bytes}`);
  return buf;
}

// Fetch and resize one photo into the batch folder; returns its record and its files.
async function stage(r, dir) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const o = await original(r);
      const meta = await sharp(o).metadata();
      const turned = (meta.orientation || 1) >= 5;
      const s = await sharp(o).rotate().resize({ width: 600, height: 600, fit: 'inside' }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
      const m = await sharp(o).rotate().resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const files = [];
      for (const [part, bytes] of [['o', o], ['m', m], ['s', s]]) {
        const file = join(dir, `${r.pid}-${part}.jpg`);
        writeFileSync(file, bytes);
        files.push({ key: `event-photos/${EVENT}/${r.pid}/${part}.jpg`, file });
      }
      return { rec: { pid: r.pid, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height, bytes: o.length, s_bytes: s.length, m_bytes: m.length }, files };
    } catch (e) {
      last = e;
      await new Promise(ok => setTimeout(ok, 2000 * attempt * attempt));
    }
  }
  appendFileSync(FAILED, JSON.stringify({ pid: r.pid, drive_id: r.drive_id, title: r.title, error: String(last && last.message || last) }) + '\n');
  return null;
}

async function stageBatch(rows, no) {
  const dir = join(STAGING, 'b' + no);
  mkdirSync(dir, { recursive: true });
  const out = [], queue = rows.slice();
  await Promise.all(Array.from({ length: FETCH }, async () => {
    while (queue.length) { const got = await stage(queue.shift(), dir); if (got) out.push(got); }
  }));
  return { dir, out };
}

// 8 at a time: at 12 (with 6 Drive fetches) the line was full, and a batch stopped part
// way with no message (23 Nov, batch 6), while other calls on this computer timed out.
const PUTS = Math.max(1, Number(opt('puts', 8)));
function bulkPut(listFile) {
  return new Promise((ok) => {
    const p = spawn('npx', ['wrangler', 'r2', 'bulk', 'put', BUCKET, '--remote', '--filename', listFile, '--content-type', 'image/jpeg', '--concurrency', String(PUTS)],
      { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
    p.on('close', code => ok({ code, log }));
  });
}

let sent = 0, failed = 0, bytes = 0;
const t0 = Date.now();
const batches = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let next = stageBatch(batches[0], 0);
for (let b = 0; b < batches.length; b++) {
  const { dir, out } = await next;
  if (b + 1 < batches.length) next = stageBatch(batches[b + 1], b + 1);   // fetch the next while this one goes up
  failed += batches[b].length - out.length;
  if (out.length) {
    const listFile = join(dir, 'list.json');
    writeFileSync(listFile, JSON.stringify(out.flatMap(x => x.files)));
    // Up to three tries, a minute apart: R2 puts are safe to repeat.
    let res = await bulkPut(listFile);
    for (let t = 2; t <= 3 && res.code !== 0; t++) { await new Promise(ok => setTimeout(ok, 60000)); res = await bulkPut(listFile); }
    if (res.code !== 0) {
      const errs = res.log.split('\n').filter(l => /error|fail|timeout|refused|reset/i.test(l)).slice(0, 8).join('\n');
      console.error(`batch ${b} did not upload (exit ${res.code}); its photos stay to do. wrangler said:\n${errs || res.log.slice(-600)}`);
      failed += out.length;
    } else {
      const at = new Date().toISOString();
      for (const x of out) { appendFileSync(PROGRESS, JSON.stringify({ ...x.rec, at }) + '\n'); bytes += x.rec.bytes + x.rec.s_bytes + x.rec.m_bytes; }
      sent += out.length;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  const mins = (Date.now() - t0) / 60000, left = todo.length - sent - failed;
  console.log(`${new Date().toISOString().slice(11, 19)}  batch ${b + 1}/${batches.length}: sent ${sent}/${todo.length}, failed ${failed}, ${(bytes / 1e9).toFixed(2)} GB, about ${Math.round(left * mins / Math.max(sent + failed, 1))} min left`);
}
console.log(`DONE: sent ${sent}, failed ${failed} (see failed.jsonl), ${(bytes / 1e9).toFixed(2)} GB in ${Math.round((Date.now() - t0) / 60000)} min`);
