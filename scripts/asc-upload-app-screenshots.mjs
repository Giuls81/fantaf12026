#!/usr/bin/env node
// Uploads App Store screenshots for the 6.9" iPhone display slot on the
// FantaGP version 1.0 page, deleting any existing screenshots in that
// slot first so the new set is the only one.
//
// Apple requires exactly 1290x2796 PNG for the 6.9" display. Make sure
// the source files already match before running.
//
// --- Env vars ---   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH
// --- Usage ---
//   node scripts/asc-upload-app-screenshots.mjs --dry-run
//   node scripts/asc-upload-app-screenshots.mjs
//   node scripts/asc-upload-app-screenshots.mjs --dir=assets/store_upload/iphone69_final_1290

import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';
// Apple uses APP_IPHONE_67 (6.7") for 1290x2796 screenshots — the same
// resolution the iPhone 16 Pro Max uses, even though Apple markets that
// as a 6.9" display. APP_IPHONE_69 is NOT a valid ASC enum value.
const SCREENSHOT_DISPLAY_TYPE = 'APP_IPHONE_67';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

const argsArr = process.argv.slice(2);
const DRY_RUN = argsArr.includes('--dry-run');
const dirArg = argsArr.find(a => a.startsWith('--dir='));
const SCREENSHOT_DIR = dirArg ? dirArg.slice('--dir='.length) : 'assets/store_upload/iphone69_final_1290';

if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}
const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function generateJWT() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('SHA256'); signer.update(input);
  return `${input}.${b64url(signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' }))}`;
}
async function asc(urlPath, opts = {}) {
  const { method = 'GET', body = null, headers = {} } = opts;
  const res = await fetch(`${API_ROOT}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${generateJWT()}`, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAppId() {
  const r = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  if (!r.ok) throw new Error(`fetchAppId: ${r.status}`);
  return r.body.data[0].id;
}

async function fetchVersion(appId) {
  // Find version 1.0 in PREPARE_FOR_SUBMISSION / DEVELOPER_REJECTED / METADATA_REJECTED
  const r = await asc(`/v1/apps/${appId}/appStoreVersions?limit=10`);
  if (!r.ok) throw new Error(`fetchVersion: ${r.status}`);
  const editable = r.body.data.find(v =>
    ['PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'DEVELOPER_REJECTED', 'REJECTED'].includes(v.attributes?.appStoreState)
  );
  if (!editable) {
    console.error('No editable version found. States:', r.body.data.map(v => v.attributes?.appStoreState));
    throw new Error('No editable version');
  }
  return editable;
}

async function fetchLocalizations(versionId) {
  const r = await asc(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=20`);
  if (!r.ok) throw new Error(`fetchLocalizations: ${r.status}`);
  return r.body.data;
}

async function fetchScreenshotSets(localizationId) {
  const r = await asc(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`);
  if (!r.ok) throw new Error(`fetchScreenshotSets: ${r.status}`);
  return r.body.data;
}

async function findOrCreateScreenshotSet(localizationId, displayType) {
  const sets = await fetchScreenshotSets(localizationId);
  const existing = sets.find(s => s.attributes?.screenshotDisplayType === displayType);
  if (existing) {
    console.log(`  · found existing ${displayType} set ${existing.id}`);
    return existing.id;
  }
  console.log(`  → creating ${displayType} set`);
  if (DRY_RUN) return `DRY_${displayType}`;
  const r = await asc('/v1/appScreenshotSets', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } },
        },
      },
    },
  });
  if (!r.ok) throw new Error(`create set: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.data.id;
}

async function deleteExistingScreenshots(setId) {
  if (setId.startsWith('DRY_')) {
    console.log(`  · dry run, skipping delete`);
    return;
  }
  const r = await asc(`/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`);
  if (!r.ok) throw new Error(`list screenshots: ${r.status}`);
  const items = r.body.data || [];
  if (!items.length) {
    console.log(`  · set empty`);
    return;
  }
  console.log(`  → deleting ${items.length} existing screenshot(s)`);
  for (const s of items) {
    if (DRY_RUN) { console.log(`    DRY delete ${s.id}`); continue; }
    const d = await asc(`/v1/appScreenshots/${s.id}`, { method: 'DELETE' });
    if (d.ok || d.status === 204) console.log(`    ✓ deleted ${s.id}`);
    else console.error(`    ✖ ${d.status} ${JSON.stringify(d.body).slice(0, 150)}`);
    await sleep(150);
  }
}

async function uploadScreenshot(setId, filePath, fileName) {
  const bytes = readFileSync(filePath);
  const fileSize = bytes.length;
  const checksum = crypto.createHash('md5').update(bytes).digest('hex');

  // Step 1 — reserve
  const reserve = await asc('/v1/appScreenshots', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshots',
        attributes: { fileName, fileSize },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
      },
    },
  });
  if (!reserve.ok) {
    console.error(`    ✖ reserve: ${reserve.status} ${JSON.stringify(reserve.body).slice(0, 200)}`);
    return { ok: false };
  }
  const screenshotId = reserve.body.data.id;
  const uploadOps = reserve.body.data.attributes.uploadOperations;

  // Step 2 — upload chunks
  for (const op of uploadOps) {
    const slice = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value]));
    const up = await fetch(op.url, { method: op.method, headers, body: slice });
    if (!up.ok) {
      const t = await up.text();
      console.error(`    ✖ chunk upload: ${up.status} ${t.slice(0, 200)}`);
      return { ok: false };
    }
  }

  // Step 3 — commit
  const commit = await asc(`/v1/appScreenshots/${screenshotId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appScreenshots',
        id: screenshotId,
        attributes: { uploaded: true, sourceFileChecksum: checksum },
      },
    },
  });
  if (!commit.ok) {
    console.error(`    ✖ commit: ${commit.status} ${JSON.stringify(commit.body).slice(0, 200)}`);
    return { ok: false };
  }
  return { ok: true, id: screenshotId };
}

(async () => {
  console.log(`\n=== ASC upload 6.9" screenshots ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Source: ${SCREENSHOT_DIR}`);

  const files = readdirSync(SCREENSHOT_DIR)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .sort();
  if (!files.length) {
    console.error('No .png files in source dir');
    process.exit(1);
  }
  console.log(`Files (${files.length}):`);
  for (const f of files) {
    const s = statSync(path.join(SCREENSHOT_DIR, f));
    console.log(`  ${f} (${(s.size / 1024).toFixed(0)} KB)`);
  }

  const appId = await fetchAppId();
  console.log(`\nApp: ${appId}`);

  const version = await fetchVersion(appId);
  console.log(`Version: ${version.attributes?.versionString} (${version.attributes?.appStoreState})`);

  const locs = await fetchLocalizations(version.id);
  const en = locs.find(l => l.attributes?.locale === 'en-US') || locs[0];
  console.log(`Localization: ${en.attributes?.locale} (${en.id})`);

  const setId = await findOrCreateScreenshotSet(en.id, SCREENSHOT_DISPLAY_TYPE);
  await deleteExistingScreenshots(setId);
  await sleep(500);

  let uploaded = 0, failed = 0;
  for (const f of files) {
    console.log(`\n${f}`);
    if (DRY_RUN) { console.log('  DRY upload'); uploaded++; continue; }
    const r = await uploadScreenshot(setId, path.join(SCREENSHOT_DIR, f), f);
    if (r.ok) { console.log(`  ✓ uploaded ${r.id}`); uploaded++; }
    else failed++;
    await sleep(400);
  }

  console.log(`\n=== Done ===`);
  console.log(`  uploaded: ${uploaded}`);
  console.log(`  failed: ${failed}`);
})().catch(e => { console.error('\n✖', e); process.exit(1); });
