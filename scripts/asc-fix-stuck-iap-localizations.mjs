#!/usr/bin/env node
// Second pass cleanup for IAP localizations stuck after the initial rename
// run. Apple's API rejects PATCH on any REJECTED-state localization, and
// the first-pass DELETE+POST left each IAP with one PREPARE_FOR_SUBMISSION
// locale and one REJECTED locale. Apple then rejects a second DELETE on
// the remaining REJECTED locale with a 500 UNEXPECTED_ERROR, apparently
// because it would briefly leave the IAP with only one localization in an
// already-submittable state.
//
// Workaround: for each IAP that still has any description containing
// "FantaF1", delete BOTH localizations first (regardless of current
// wording) and then recreate both fresh. A freshly-created IAP always has
// two locales from the start, so this returns it to a clean state in a
// single pass.
//
// --- Env vars ---   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH
// --- Usage ---      node scripts/asc-fix-stuck-iap-localizations.mjs --dry-run
//                    node scripts/asc-fix-stuck-iap-localizations.mjs

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

const DRY_RUN = process.argv.includes('--dry-run');
if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}

const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

const DESC_EN_BY_CATEGORY = {
  emblem: 'Team emblem for FantaGP 2026',
  helmet: 'Driver helmet skin for FantaGP 2026',
  suit: 'Race suit pattern for FantaGP 2026',
  color: 'Team accent color for FantaGP 2026',
  livery: 'Car livery for FantaGP 2026',
  bundle: 'Emblems, helmets and colors bundle',
  pass: 'All cosmetics unlocked for FantaGP 2026',
};
const DESC_IT_BY_CATEGORY = {
  emblem: 'Emblema squadra per FantaGP 2026',
  helmet: 'Skin casco pilota per FantaGP 2026',
  suit: 'Pattern tuta da gara per FantaGP 2026',
  color: 'Colore accento squadra per FantaGP 2026',
  livery: 'Livrea auto per FantaGP 2026',
  bundle: 'Bundle emblemi, caschi e colori',
  pass: 'Sblocca tutti i cosmetici FantaGP 2026',
};
function categoryOf(productId) {
  const parts = productId.split('.');
  return parts[2] ?? null;
}

function b64url(input) { return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function generateJWT() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const s = crypto.createSign('SHA256'); s.update(input);
  return `${input}.${b64url(s.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' }))}`;
}
async function asc(path, opts = {}) {
  const { method = 'GET', body = null } = opts;
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${generateJWT()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAppId() {
  const r = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  return r.body.data[0].id;
}
async function fetchAllIaps(appId) {
  const all = []; let url = `/v1/apps/${appId}/inAppPurchasesV2?limit=200`;
  while (url) {
    const r = await asc(url);
    for (const item of r.body.data) all.push({ id: item.id, productId: item.attributes?.productId, name: item.attributes?.name });
    url = r.body.links?.next ? r.body.links.next.replace(API_ROOT, '') : null;
  }
  return all;
}
async function fetchLocs(iapId) {
  const r = await asc(`/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=50`);
  return (r.body.data || []).map(d => ({ id: d.id, locale: d.attributes?.locale, name: d.attributes?.name, description: d.attributes?.description, state: d.attributes?.state }));
}

async function deleteLoc(id) {
  const r = await asc(`/v1/inAppPurchaseLocalizations/${id}`, { method: 'DELETE' });
  return r;
}
async function createLoc(iapId, locale, name, description) {
  const payload = {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: { locale, name, description },
      relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } } },
    },
  };
  return asc('/v1/inAppPurchaseLocalizations', { method: 'POST', body: payload });
}

async function processIap(iap) {
  const cat = categoryOf(iap.productId);
  const enDesc = DESC_EN_BY_CATEGORY[cat];
  const itDesc = DESC_IT_BY_CATEGORY[cat];
  if (!enDesc || !itDesc) {
    console.log(`${iap.productId} — unknown category, skipping`);
    return { skipped: true };
  }

  const locs = await fetchLocs(iap.id);
  const hasStale = locs.some(l => /FantaF1/i.test(l.description || ''));
  if (!hasStale) {
    console.log(`${iap.productId} — already clean, skipping`);
    return { alreadyClean: true };
  }

  console.log(`${iap.productId} — ${locs.length} loc(s) to rewrite`);
  if (DRY_RUN) return { dryRun: true };

  // Remember name for each locale so we can recreate faithfully
  const itLoc = locs.find(l => l.locale === 'it');
  const enLoc = locs.find(l => l.locale === 'en-US');
  const itName = itLoc?.name || iap.name;
  const enName = enLoc?.name || iap.name;

  // Delete all locales first, small delays between calls
  for (const l of locs) {
    const d = await deleteLoc(l.id);
    if (!d.ok && d.status !== 204) {
      console.error(`  ✖ delete ${l.locale}: ${d.status}`);
      // Keep going — we'll try to create the new ones anyway; a partial
      // state is fixable on a later run.
    } else {
      console.log(`  · deleted ${l.locale}`);
    }
    await sleep(300);
  }

  // Give Apple a moment before re-creating
  await sleep(600);

  // Recreate both locales
  const cIt = await createLoc(iap.id, 'it', itName, itDesc);
  if (cIt.ok) console.log(`  ✓ created it`);
  else console.error(`  ✖ create it: ${cIt.status} ${JSON.stringify(cIt.body).slice(0, 150)}`);
  await sleep(300);

  const cEn = await createLoc(iap.id, 'en-US', enName, enDesc);
  if (cEn.ok) console.log(`  ✓ created en-US`);
  else console.error(`  ✖ create en-US: ${cEn.status} ${JSON.stringify(cEn.body).slice(0, 150)}`);

  return { fixed: cIt.ok && cEn.ok };
}

(async () => {
  console.log(`\n=== ASC fix stuck IAP localizations ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);
  const appId = await fetchAppId();
  const iaps = await fetchAllIaps(appId);

  let fixed = 0, alreadyClean = 0, skipped = 0, partial = 0;
  for (const iap of iaps) {
    const r = await processIap(iap);
    if (r.fixed) fixed++;
    else if (r.alreadyClean) alreadyClean++;
    else if (r.skipped) skipped++;
    else partial++;
    await sleep(400);
  }

  console.log(`\n=== Done ===`);
  console.log(`  fixed: ${fixed}`);
  console.log(`  already clean: ${alreadyClean}`);
  console.log(`  non-cosmetic (skipped): ${skipped}`);
  console.log(`  partial/failed: ${partial}`);
  if (DRY_RUN) console.log('\n(Dry run — nothing was actually changed.)');
})().catch(e => { console.error('\n✖', e); process.exit(1); });
