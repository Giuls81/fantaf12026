#!/usr/bin/env node
// Updates every IAP localization that still references "FantaF1" to use
// "FantaGP" instead. Apple rejected the v1.0 submission under Guideline
// 4.1(c) — all 39 IAPs had descriptions like:
//   "Driver helmet skin for FantaF1 2026"
//   "Skin casco pilota per FantaF1 2026"
// Those strings trigger the Formula 1 trademark flag. The fix: PATCH
// each localization with the FantaGP-equivalent description, keeping the
// display name (which is already trademark-safe, e.g. "Carbon Raw").
//
// Apple's 55-character description limit still applies.
//
// --- Env vars ---
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH
//
// --- Usage ---
//   node scripts/asc-rename-iap-descriptions.mjs --dry-run
//   node scripts/asc-rename-iap-descriptions.mjs
//   node scripts/asc-rename-iap-descriptions.mjs --only=fantaf1.cosmetic.helmet.carbon

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';
const MAX_DESC_LEN = 55;

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

const argsArr = process.argv.slice(2);
const args = new Set(argsArr);
const DRY_RUN = args.has('--dry-run');
const onlyArg = argsArr.find((a) => a.startsWith('--only='));
const ONLY_IDS = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}

const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

// --- Target descriptions by category and locale ---
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
for (const [k, v] of Object.entries({ ...DESC_EN_BY_CATEGORY, ...DESC_IT_BY_CATEGORY })) {
  if (v.length > MAX_DESC_LEN) {
    console.error(`Description too long (${v.length} > ${MAX_DESC_LEN}): ${k}: "${v}"`);
    process.exit(1);
  }
}

function categoryOf(productId) {
  const parts = productId.split('.');
  return parts[2] ?? null;
}

// --- JWT + HTTP ---
function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function generateJWT() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}
async function asc(path, opts = {}) {
  const { method = 'GET', body = null } = opts;
  const jwt = generateJWT();
  const res = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Fetch helpers ---
async function fetchAppId() {
  const r = await asc(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`);
  if (!r.ok) throw new Error(`fetchAppId: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data[0].id;
}
async function fetchAllIaps(appId) {
  const all = [];
  let url = `/v1/apps/${appId}/inAppPurchasesV2?limit=200`;
  while (url) {
    const r = await asc(url);
    if (!r.ok) throw new Error(`fetchAllIaps: ${r.status} ${JSON.stringify(r.body)}`);
    for (const item of r.body.data) {
      all.push({
        id: item.id,
        productId: item.attributes?.productId,
        name: item.attributes?.name,
        state: item.attributes?.state,
      });
    }
    const next = r.body.links?.next;
    url = next ? next.replace(API_ROOT, '') : null;
  }
  return all;
}
async function fetchLocalizations(iapId) {
  const r = await asc(`/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=50`);
  if (!r.ok) throw new Error(`fetchLocalizations ${iapId}: ${r.status}`);
  return (r.body.data || []).map(d => ({
    id: d.id,
    locale: d.attributes?.locale,
    name: d.attributes?.name,
    description: d.attributes?.description,
    state: d.attributes?.state,
  }));
}

// Apple's v1/inAppPurchaseLocalizations PATCH returns 409 UNMODIFIABLE
// once the IAP has been submitted once (including in the REJECTED state).
// Workaround that mirrors what the ASC web UI does internally: PATCH first,
// and if that fails with 409, DELETE the localization and re-POST a fresh
// one. DELETE+POST is allowed in every state except "In Review".
async function updateLocalization(iapId, loc, newDescription) {
  // Try PATCH first — cheapest path.
  const patchPayload = {
    data: {
      type: 'inAppPurchaseLocalizations',
      id: loc.id,
      attributes: { description: newDescription },
    },
  };
  if (DRY_RUN) return { ok: true, dryRun: true };

  const patch = await asc(`/v1/inAppPurchaseLocalizations/${loc.id}`, { method: 'PATCH', body: patchPayload });
  if (patch.ok) return patch;

  const bodyStr = JSON.stringify(patch.body);
  const isUnmodifiable = patch.status === 409 && /UNMODIFIABLE/i.test(bodyStr);
  if (!isUnmodifiable) return patch;

  // Fall back to DELETE + POST
  const del = await asc(`/v1/inAppPurchaseLocalizations/${loc.id}`, { method: 'DELETE' });
  if (!del.ok && del.status !== 204) {
    return { status: del.status, ok: false, body: `delete failed: ${JSON.stringify(del.body).slice(0, 150)}` };
  }
  await sleep(150);

  const createPayload = {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: { locale: loc.locale, name: loc.name, description: newDescription },
      relationships: {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
      },
    },
  };
  const create = await asc('/v1/inAppPurchaseLocalizations', { method: 'POST', body: createPayload });
  return create;
}

// --- Main ---
(async () => {
  console.log(`\n=== ASC rename IAP descriptions ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Bundle: ${BUNDLE_ID}\n`);

  const appId = await fetchAppId();
  const iaps = await fetchAllIaps(appId);
  const targets = ONLY_IDS ? iaps.filter(i => ONLY_IDS.has(i.productId)) : iaps;
  console.log(`IAPs in scope: ${targets.length} of ${iaps.length} total\n`);

  let updated = 0, skipped = 0, failed = 0, ignored = 0;

  for (const iap of targets) {
    const cat = categoryOf(iap.productId);
    const en = DESC_EN_BY_CATEGORY[cat];
    const it = DESC_IT_BY_CATEGORY[cat];
    if (!en || !it) {
      // Not a cosmetic IAP — skip. Covers e.g. the premium subscription
      // which uses a different localization shape anyway.
      console.log(`${iap.productId}  (unknown category "${cat}", skipping)`);
      ignored++;
      continue;
    }
    console.log(`${iap.productId}  (${cat})`);

    const locs = await fetchLocalizations(iap.id);
    for (const loc of locs) {
      const target = loc.locale === 'it' ? it : (loc.locale === 'en-US' ? en : null);
      if (!target) {
        console.log(`  · ${loc.locale}: no template, skipping`);
        skipped++;
        continue;
      }
      if (loc.description === target) {
        console.log(`  · ${loc.locale}: already up-to-date`);
        skipped++;
        continue;
      }
      console.log(`  → ${loc.locale}: "${loc.description}"`);
      console.log(`             -> "${target}"`);
      const res = await updateLocalization(iap.id, loc, target);
      if (res.ok) {
        console.log(`    ✓ updated${res.dryRun ? ' (dry run)' : ''}`);
        updated++;
      } else {
        console.error(`    ✖ ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
        failed++;
      }
      await sleep(200);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  updated: ${updated}`);
  console.log(`  skipped (already correct or other locale): ${skipped}`);
  console.log(`  ignored (non-cosmetic IAPs): ${ignored}`);
  console.log(`  failed: ${failed}`);
  if (DRY_RUN) console.log('\n(Dry run — nothing was actually changed.)');
})().catch(e => { console.error('\n✖', e); process.exit(1); });
