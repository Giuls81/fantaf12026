#!/usr/bin/env node
// Seeds the App Store Connect in-app purchase catalog for FantaGP 2026
// cosmetics. Creates 38 non-consumable IAPs (36 cosmetics + Starter Bundle
// + Season Aesthetic Pass) with EN + IT localizations AND the territory
// availability resource so the IAP flips to READY_TO_SUBMIT once pricing
// + screenshot are set. Does NOT set pricing or review screenshots —
// those are handled by asc-pricing-and-screenshots.mjs.
//
// Idempotent: each POST returns 409 if the IAP already exists; the script
// resolves the existing id and continues. Safe to re-run.
//
// Apple gotchas (learned the hard way 2026-04-22):
//   - IAP without inAppPurchaseAvailability stays MISSING_METADATA even
//     with all other fields set. The web UI creates it automatically;
//     the API does not. The script now calls POST /v1/inAppPurchaseAvailabilities
//     after every create.
//   - Description max length is 55 characters; Apple returns 409
//     ENTITY_ERROR.ATTRIBUTE.INVALID.TOO_LONG. Earlier versions of this
//     script conflated every 409 with "already exists, skipping" and
//     silently left the IAP with zero localizations.
//   - Review screenshot must be 1290×2796 (iPhone 6.7"); 1242×2208 is
//     deprecated and produces MISSING_METADATA too. See generate-review-screenshots.mjs.
//
// --- Prerequisites ---
//
// 1. An App Store Connect API key with role "App Manager" or higher.
//    Use the existing one from Codemagic (key ID 7XRTBU8623,
//    issuer 4c4f8539-f816-4f20-89ec-83b73e49eee0) or create a new one
//    at https://appstoreconnect.apple.com/access/api
//
// 2. The .p8 private key file (Apple only lets you download it once at
//    creation). Save it anywhere on disk (outside the repo).
//
// 3. Set env vars:
//      ASC_KEY_ID=7XRTBU8623
//      ASC_ISSUER_ID=4c4f8539-f816-4f20-89ec-83b73e49eee0
//      ASC_PRIVATE_KEY_PATH=C:\path\to\AuthKey_7XRTBU8623.p8
//
// 4. Run:
//      node scripts/seed-appstore-connect.mjs --dry-run   (safe preview)
//      node scripts/seed-appstore-connect.mjs             (real)
//
// Idempotent: if an IAP already exists Apple returns 409 and we skip it.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const BUNDLE_ID = 'com.fantaf1.app';
const API_ROOT = 'https://api.appstoreconnect.apple.com';

const KEY_ID = process.env.ASC_KEY_ID;
const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_PATH = process.env.ASC_PRIVATE_KEY_PATH;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

if (!KEY_ID || !ISSUER_ID || !KEY_PATH) {
  console.error('Missing env vars. Required:');
  console.error('  ASC_KEY_ID');
  console.error('  ASC_ISSUER_ID');
  console.error('  ASC_PRIVATE_KEY_PATH');
  process.exit(1);
}

const privateKeyPem = readFileSync(KEY_PATH, 'utf8');

// --- Catalog ---------------------------------------------------------------

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
// Apple hard-limits each IAP localization description to 55 characters.
// Keep every entry above under that ceiling; a length check is applied at
// startup to fail fast if somebody adds an over-long description.
const MAX_DESCRIPTION_LEN = 55;
for (const [k, v] of Object.entries({ ...DESC_EN_BY_CATEGORY, ...DESC_IT_BY_CATEGORY })) {
  if (v.length > MAX_DESCRIPTION_LEN) {
    console.error(`Description too long (${v.length} > ${MAX_DESCRIPTION_LEN}): ${k}: "${v}"`);
    process.exit(1);
  }
}

const CATALOG = [
  // Emblems
  { productId: 'fantaf1.cosmetic.emblem.lightning', name: 'Lightning Crest', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.mountain', name: 'Summit Crest', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.wave', name: 'Wave Crest', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.compass', name: 'Compass Star', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.flame', name: 'Flame Crest', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.wolf', name: 'Wolf Head', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.checkered', name: 'Checkered Shield', cat: 'emblem' },
  { productId: 'fantaf1.cosmetic.emblem.octane', name: 'Octane Drop', cat: 'emblem' },
  // Helmets
  { productId: 'fantaf1.cosmetic.helmet.carbon', name: 'Carbon Raw', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.storm', name: 'Storm Grey', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.gold', name: 'Gold Leaf', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.chrome', name: 'Chrome Mirror', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.midnight', name: 'Midnight Matte', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.rainbow', name: 'Rainbow Fade', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.fire', name: 'Fire Gradient', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.ocean', name: 'Ocean Deep', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.forest', name: 'Forest Hex', cat: 'helmet' },
  { productId: 'fantaf1.cosmetic.helmet.volcano', name: 'Volcano Red', cat: 'helmet' },
  // Suits
  { productId: 'fantaf1.cosmetic.suit.monochrome', name: 'Classic Monochrome', cat: 'suit' },
  { productId: 'fantaf1.cosmetic.suit.retro70', name: 'Retro 70s Stripes', cat: 'suit' },
  { productId: 'fantaf1.cosmetic.suit.mosaic', name: 'Geometric Mosaic', cat: 'suit' },
  { productId: 'fantaf1.cosmetic.suit.sunrise', name: 'Gradient Sunrise', cat: 'suit' },
  { productId: 'fantaf1.cosmetic.suit.digicamo', name: 'Digital Camo', cat: 'suit' },
  { productId: 'fantaf1.cosmetic.suit.tuxedo', name: 'Tuxedo Formal', cat: 'suit' },
  // Colors
  { productId: 'fantaf1.cosmetic.color.electric', name: 'Electric Blue', cat: 'color' },
  { productId: 'fantaf1.cosmetic.color.emerald', name: 'Emerald Green', cat: 'color' },
  { productId: 'fantaf1.cosmetic.color.royal', name: 'Royal Purple', cat: 'color' },
  { productId: 'fantaf1.cosmetic.color.molten', name: 'Molten Orange', cat: 'color' },
  { productId: 'fantaf1.cosmetic.color.rosegold', name: 'Rose Gold', cat: 'color' },
  { productId: 'fantaf1.cosmetic.color.pure', name: 'Pure White', cat: 'color' },
  // Liveries
  { productId: 'fantaf1.cosmetic.livery.classic', name: 'Classic Stripes', cat: 'livery' },
  { productId: 'fantaf1.cosmetic.livery.stealth', name: 'Stealth Matte', cat: 'livery' },
  { productId: 'fantaf1.cosmetic.livery.racing', name: 'Racing Red', cat: 'livery' },
  { productId: 'fantaf1.cosmetic.livery.rainbow', name: 'Rainbow Flow', cat: 'livery' },
  { productId: 'fantaf1.cosmetic.livery.carbon', name: 'Carbon Weave', cat: 'livery' },
  { productId: 'fantaf1.cosmetic.livery.neon', name: 'Neon Circuit', cat: 'livery' },
  // Bundles + Pass — registered as plain NON_CONSUMABLE on Apple. The
  // "contains multiple cosmetics" semantics is expanded server-side by
  // expandCosmeticProduct() in fanta-api/index.ts when the RC webhook fires
  // on purchase, so from Apple's POV these are just normal single IAPs.
  { productId: 'fantaf1.cosmetic.bundle.starter', name: 'Starter Aesthetic Bundle', cat: 'bundle' },
  { productId: 'fantaf1.cosmetic.pass.season2026', name: 'Season Aesthetic Pass 2026', cat: 'pass' },
];

// --- JWT signing (ES256) ---------------------------------------------------

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateJWT() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  // `scope` is intentionally omitted — Apple rejects empty or malformed scope
  // arrays and treats its absence as "grant all scopes for the issuer".
  const payload = {
    iss: ISSUER_ID,
    iat: now,
    exp: now + 1200, // 20 minutes (Apple max)
    aud: 'appstoreconnect-v1',
  };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(signature)}`;
}

// --- ASC HTTP wrapper ------------------------------------------------------

async function asc(path, { method = 'GET', body = null } = {}) {
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

// --- Core actions ----------------------------------------------------------

async function fetchAppId() {
  console.log(`→ GET /v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const { status, ok, body } = await asc(
    `/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(BUNDLE_ID)}`,
  );
  if (!ok) throw new Error(`Could not fetch app: ${status} ${JSON.stringify(body)}`);
  const items = body?.data ?? [];
  const app = items.find((a) => a.attributes?.bundleId === BUNDLE_ID);
  if (!app) throw new Error(`App with bundleId ${BUNDLE_ID} not found`);
  console.log(`  app id = ${app.id} ("${app.attributes?.name}")`);
  return app.id;
}

async function createIap(appId, product) {
  const payload = {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: product.name,
        productId: product.productId,
        inAppPurchaseType: 'NON_CONSUMABLE',
      },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  };
  console.log(`→ POST /v2/inAppPurchases ${product.productId}`);
  if (DRY_RUN) {
    console.log('  DRY-RUN body:', JSON.stringify(payload));
    return { id: `DRYRUN_${product.productId}`, created: false };
  }
  const { status, ok, body } = await asc('/v2/inAppPurchases', {
    method: 'POST',
    body: payload,
  });
  if (ok) {
    const id = body?.data?.id;
    console.log(`  ✓ created id=${id}`);
    return { id, created: true };
  }
  const errMsg = JSON.stringify(body);
  if (status === 409 || /already exist/i.test(errMsg) || /DUPLICATE/i.test(errMsg)) {
    // Fetch existing IAP to get its id
    const existing = await asc(
      `/v1/apps/${appId}/inAppPurchasesV2?filter%5BproductId%5D=${encodeURIComponent(product.productId)}`,
    );
    const ex = existing.body?.data?.[0];
    if (ex) {
      console.log(`  · already exists id=${ex.id}`);
      return { id: ex.id, created: false };
    }
  }
  console.error(`  ✖ ${status} ${errMsg}`);
  return { id: null, created: false };
}

// Cached list of all ASC territory ids (fetched lazily on first call). An
// IAP that lacks an associated inAppPurchaseAvailability stays MISSING_METADATA
// even when price + localization + screenshot are all set, confirmed
// via ASC API diagnostic 2026-04-22.
let territoryIdsCache = null;
async function allTerritoryIds() {
  if (territoryIdsCache) return territoryIdsCache;
  const ids = [];
  let url = '/v1/territories?limit=200';
  while (url) {
    const r = await asc(url);
    for (const d of r.body?.data || []) ids.push(d.id);
    url = r.body?.links?.next ? r.body.links.next.replace(API_ROOT, '') : null;
  }
  territoryIdsCache = ids;
  return ids;
}

async function ensureAvailability(iapId) {
  // Skip if already present.
  const existing = await asc(`/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`);
  if (existing.ok && existing.body?.data) {
    console.log(`    · availability already set, skipping`);
    return { ok: true };
  }
  const territories = await allTerritoryIds();
  console.log(`    → POST availability (${territories.length} territories)`);
  if (DRY_RUN) return { ok: true };
  const r = await asc('/v1/inAppPurchaseAvailabilities', {
    method: 'POST',
    body: {
      data: {
        type: 'inAppPurchaseAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          availableTerritories: {
            data: territories.map((id) => ({ type: 'territories', id })),
          },
        },
      },
    },
  });
  if (r.ok) {
    console.log(`      ✓ availability created`);
    return { ok: true };
  }
  console.error(`      ✖ ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { ok: false };
}

async function addLocalization(iapId, locale, name, description) {
  const payload = {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: { locale, name, description },
      relationships: {
        inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
      },
    },
  };
  console.log(`  → POST loc ${locale} for ${iapId}`);
  if (DRY_RUN) {
    console.log('    DRY-RUN body:', JSON.stringify(payload));
    return { ok: true };
  }
  const { status, ok, body } = await asc('/v1/inAppPurchaseLocalizations', {
    method: 'POST',
    body: payload,
  });
  if (ok) {
    console.log(`    ✓ ${locale} localisation created`);
    return { ok: true };
  }
  const errMsg = JSON.stringify(body);
  // Only swallow the error if it is actually a duplicate. Previous versions
  // treated every 409 as "already exists", which hid real issues such as
  // description-too-long validation errors — those rejections left the
  // IAP with zero localizations and stuck in MISSING_METADATA.
  const isDuplicate = /already exist/i.test(errMsg) || /DUPLICATE/i.test(errMsg);
  if (isDuplicate) {
    console.log(`    · ${locale} localisation already exists, skipping`);
    return { ok: true };
  }
  console.error(`    ✖ ${status} ${errMsg}`);
  return { ok: false };
}

// --- Main ------------------------------------------------------------------

(async () => {
  console.log(`\n=== ASC IAP seed ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Bundle: ${BUNDLE_ID}`);
  console.log(`Products: ${CATALOG.length}\n`);

  const appId = await fetchAppId();

  for (const product of CATALOG) {
    const { id: iapId } = await createIap(appId, product);
    if (!iapId) {
      console.error(`  ✖ skipping localizations for ${product.productId} (no id)`);
      continue;
    }

    await ensureAvailability(iapId);
    await sleep(250);

    await addLocalization(
      iapId,
      'en-US',
      product.name,
      DESC_EN_BY_CATEGORY[product.cat],
    );
    await sleep(250);

    await addLocalization(
      iapId,
      'it',
      product.name,
      DESC_IT_BY_CATEGORY[product.cat],
    );
    await sleep(250);
  }

  console.log('\n=== Done ===');
  console.log('Next manual steps in App Store Connect:');
  console.log('  1. Pricing: select all IAPs → set default price per tier');
  console.log('     emblem €0.99, helmet/suit €1.99, livery €2.99, color €0.99');
  console.log('     bundle.starter €7.99, pass.season2026 €19.99');
  console.log('  2. Review Screenshot: use the same storefront screenshot for all');
  console.log('  3. Flip each to "Ready to Submit" (auto when metadata complete)');
})().catch((e) => {
  console.error('\n✖ Unexpected error:', e);
  process.exit(1);
});
