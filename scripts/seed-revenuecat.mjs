#!/usr/bin/env node
// Seeds the RevenueCat catalog for FantaF1 2026 cosmetics.
//
// Creates, via the RevenueCat V2 REST API:
//   - 32 non-consumable products (8 emblems + 10 helmets + 6 suits + 6 colors + 1 bundle + 1 pass)
//     × N platforms (whatever APP_ID_* env vars you provide)
//   - 1 entitlement `cosmetic_pass_2026`
//   - Attaches the season pass product to that entitlement
//
// The existing `premium` entitlement (ad-removal) is left untouched.
//
// --- Usage ---
//
// 1. Obtain a V2 secret key from RevenueCat Dashboard → Project Settings → API keys → V2 API keys.
//    (This is NOT the SDK keys `appl_*` / `goog_*`. It starts with `sk_`.)
//
// 2. Run once with --list-projects to find your project id:
//      node scripts/seed-revenuecat.mjs --list-projects
//    Env needed for this step: REVENUECAT_V2_API_KEY
//
// 3. Run with --list-apps once you have the project id:
//      REVENUECAT_V2_API_KEY=sk_... REVENUECAT_PROJECT_ID=proj_... \
//        node scripts/seed-revenuecat.mjs --list-apps
//
// 4. Dry-run (prints every POST body without sending):
//      REVENUECAT_V2_API_KEY=sk_... REVENUECAT_PROJECT_ID=proj_... \
//      APP_ID_IOS=app_... APP_ID_ANDROID=app_... \
//        node scripts/seed-revenuecat.mjs --dry-run
//
// 5. For real:
//      (same env) node scripts/seed-revenuecat.mjs
//
// Safe to re-run: `already exists` errors (409) are logged and skipped.
//
// --- API reference ---
// https://www.revenuecat.com/docs/api-v2
//
// If the API shape has drifted, this script prints the exact response body
// on every failure — copy it to me and we'll adjust.

const API = 'https://api.revenuecat.com/v2';

const CATALOG = [
  // Emblems (€0.99)
  { id: 'fantaf1.cosmetic.emblem.lightning', name: 'Lightning Crest' },
  { id: 'fantaf1.cosmetic.emblem.mountain', name: 'Summit Crest' },
  { id: 'fantaf1.cosmetic.emblem.wave', name: 'Wave Crest' },
  { id: 'fantaf1.cosmetic.emblem.compass', name: 'Compass Star' },
  { id: 'fantaf1.cosmetic.emblem.flame', name: 'Flame Crest' },
  { id: 'fantaf1.cosmetic.emblem.wolf', name: 'Wolf Head' },
  { id: 'fantaf1.cosmetic.emblem.checkered', name: 'Checkered Shield' },
  { id: 'fantaf1.cosmetic.emblem.octane', name: 'Octane Drop' },
  // Helmets (€1.99)
  { id: 'fantaf1.cosmetic.helmet.carbon', name: 'Carbon Raw' },
  { id: 'fantaf1.cosmetic.helmet.storm', name: 'Storm Grey' },
  { id: 'fantaf1.cosmetic.helmet.gold', name: 'Gold Leaf' },
  { id: 'fantaf1.cosmetic.helmet.chrome', name: 'Chrome Mirror' },
  { id: 'fantaf1.cosmetic.helmet.midnight', name: 'Midnight Matte' },
  { id: 'fantaf1.cosmetic.helmet.rainbow', name: 'Rainbow Fade' },
  { id: 'fantaf1.cosmetic.helmet.fire', name: 'Fire Gradient' },
  { id: 'fantaf1.cosmetic.helmet.ocean', name: 'Ocean Deep' },
  { id: 'fantaf1.cosmetic.helmet.forest', name: 'Forest Hex' },
  { id: 'fantaf1.cosmetic.helmet.volcano', name: 'Volcano Red' },
  // Suits (€1.99)
  { id: 'fantaf1.cosmetic.suit.monochrome', name: 'Classic Monochrome' },
  { id: 'fantaf1.cosmetic.suit.retro70', name: 'Retro 70s Stripes' },
  { id: 'fantaf1.cosmetic.suit.mosaic', name: 'Geometric Mosaic' },
  { id: 'fantaf1.cosmetic.suit.sunrise', name: 'Gradient Sunrise' },
  { id: 'fantaf1.cosmetic.suit.digicamo', name: 'Digital Camo' },
  { id: 'fantaf1.cosmetic.suit.tuxedo', name: 'Tuxedo Formal' },
  // Colors (€0.99)
  { id: 'fantaf1.cosmetic.color.electric', name: 'Electric Blue' },
  { id: 'fantaf1.cosmetic.color.emerald', name: 'Emerald Green' },
  { id: 'fantaf1.cosmetic.color.royal', name: 'Royal Purple' },
  { id: 'fantaf1.cosmetic.color.molten', name: 'Molten Orange' },
  { id: 'fantaf1.cosmetic.color.rosegold', name: 'Rose Gold' },
  { id: 'fantaf1.cosmetic.color.pure', name: 'Pure White' },
  // Bundle (€7.99)
  { id: 'fantaf1.cosmetic.bundle.starter', name: 'Starter Aesthetic Bundle' },
  // Season Pass (€19.99) — will be attached to the cosmetic_pass_2026 entitlement
  { id: 'fantaf1.cosmetic.pass.season2026', name: 'Season Aesthetic Pass 2026' },
];

const PASS_PRODUCT_ID = 'fantaf1.cosmetic.pass.season2026';

const ENTITLEMENT = {
  lookup_key: 'cosmetic_pass_2026',
  display_name: 'Season Aesthetic Pass 2026',
};

// ---------------------------------------------------------------------------

const apiKey = process.env.REVENUECAT_V2_API_KEY;
const projectId = process.env.REVENUECAT_PROJECT_ID;
const appIdIos = process.env.APP_ID_IOS;
const appIdAndroid = process.env.APP_ID_ANDROID;

const args = new Set(process.argv.slice(2));
const isListProjects = args.has('--list-projects');
const isListApps = args.has('--list-apps');
const isDryRun = args.has('--dry-run');

function die(msg, code = 1) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(code);
}

if (!apiKey) {
  die('Missing REVENUECAT_V2_API_KEY env var. Get one from Dashboard → Project Settings → API keys → V2 API keys.');
}

async function rc(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: res.status, ok: res.ok, body: json ?? text };
}

function log(icon, msg) { console.log(`${icon} ${msg}`); }

// ---------------------------------------------------------------------------

async function listProjects() {
  log('→', 'GET /projects');
  const { status, ok, body } = await rc('/projects');
  if (!ok) die(`Failed: ${status} ${JSON.stringify(body)}`);
  const items = body?.items ?? body?.data ?? body;
  if (Array.isArray(items)) {
    console.log('\nProjects:');
    for (const p of items) {
      console.log(`  ${p.id}  ${p.name ?? ''}`);
    }
  } else {
    console.log('Raw response:', JSON.stringify(body, null, 2));
  }
}

async function listApps() {
  if (!projectId) die('Set REVENUECAT_PROJECT_ID to use --list-apps.');
  log('→', `GET /projects/${projectId}/apps`);
  const { status, ok, body } = await rc(`/projects/${projectId}/apps`);
  if (!ok) die(`Failed: ${status} ${JSON.stringify(body)}`);
  const items = body?.items ?? body?.data ?? body;
  if (Array.isArray(items)) {
    console.log('\nApps:');
    for (const a of items) {
      console.log(`  ${a.id}  type=${a.type ?? a.platform ?? '?'}  name=${a.name ?? ''}`);
    }
    console.log('\nSet these as env:');
    const ios = items.find((a) => (a.type ?? a.platform) === 'app_store' || (a.type ?? '').toLowerCase() === 'ios');
    const android = items.find((a) => (a.type ?? a.platform) === 'play_store' || (a.type ?? '').toLowerCase() === 'android');
    if (ios) console.log(`  APP_ID_IOS=${ios.id}`);
    if (android) console.log(`  APP_ID_ANDROID=${android.id}`);
  } else {
    console.log('Raw response:', JSON.stringify(body, null, 2));
  }
}

async function ensureEntitlement() {
  log('→', `POST /projects/${projectId}/entitlements (${ENTITLEMENT.lookup_key})`);
  if (isDryRun) {
    console.log('  DRY-RUN body:', JSON.stringify(ENTITLEMENT));
    return { id: `DRYRUN_${ENTITLEMENT.lookup_key}` };
  }
  const { status, ok, body } = await rc(`/projects/${projectId}/entitlements`, {
    method: 'POST',
    body: ENTITLEMENT,
  });
  if (ok) {
    log('✔', `Created entitlement ${body.id ?? ENTITLEMENT.lookup_key}`);
    return body;
  }
  if (status === 409 || (typeof body === 'object' && /exist/i.test(body?.message ?? ''))) {
    log('·', 'Entitlement already exists — fetching…');
    const list = await rc(`/projects/${projectId}/entitlements`);
    if (!list.ok) die(`Could not list entitlements: ${list.status} ${JSON.stringify(list.body)}`);
    const items = list.body?.items ?? [];
    const found = items.find((e) => e.lookup_key === ENTITLEMENT.lookup_key);
    if (!found) die('Entitlement exists but could not be located by lookup_key.');
    return found;
  }
  die(`Entitlement create failed: ${status} ${JSON.stringify(body)}`);
}

async function createProductForApp(appId, appLabel, product) {
  const payload = {
    store_identifier: product.id,
    app_id: appId,
    type: 'non_consumable',
    display_name: product.name,
  };
  log('→', `[${appLabel}] POST products ${product.id}`);
  if (isDryRun) {
    console.log('  DRY-RUN body:', JSON.stringify(payload));
    return { id: `DRYRUN_${appLabel}_${product.id}` };
  }
  const { status, ok, body } = await rc(`/projects/${projectId}/products`, {
    method: 'POST',
    body: payload,
  });
  if (ok) return body;
  if (status === 409 || /exist/i.test(body?.message ?? '')) {
    log('·', `[${appLabel}] already exists, skipping`);
    return null;
  }
  console.error(`  ✖ [${appLabel}] ${status} ${JSON.stringify(body)}`);
  return null;
}

async function attachPassToEntitlement(entitlementId, createdProducts) {
  const passIds = createdProducts
    .filter((p) => p && p.store_identifier === PASS_PRODUCT_ID && p.id)
    .map((p) => p.id);

  if (passIds.length === 0) {
    log('·', `No pass product IDs to attach (either dry-run or all already linked).`);
    return;
  }
  log('→', `Attach ${passIds.length} product(s) to entitlement ${entitlementId}`);
  if (isDryRun) {
    console.log('  DRY-RUN body:', JSON.stringify({ product_ids: passIds }));
    return;
  }
  const { status, ok, body } = await rc(
    `/projects/${projectId}/entitlements/${entitlementId}/actions/attach_products`,
    { method: 'POST', body: { product_ids: passIds } },
  );
  if (!ok) console.error(`  ✖ attach failed: ${status} ${JSON.stringify(body)}`);
  else log('✔', `Attached pass products to ${ENTITLEMENT.lookup_key}`);
}

async function main() {
  if (isListProjects) return listProjects();
  if (isListApps) return listApps();

  if (!projectId) die('Set REVENUECAT_PROJECT_ID (or run with --list-projects first).');
  if (!appIdIos && !appIdAndroid) {
    die('Set at least one of APP_ID_IOS / APP_ID_ANDROID (run with --list-apps first).');
  }

  console.log(`\n=== RevenueCat seed ${isDryRun ? '(DRY RUN)' : ''} ===`);
  console.log(`Project: ${projectId}`);
  if (appIdIos) console.log(`iOS app: ${appIdIos}`);
  if (appIdAndroid) console.log(`Android app: ${appIdAndroid}`);
  console.log(`Catalog: ${CATALOG.length} products\n`);

  const entitlement = await ensureEntitlement();
  const created = [];

  for (const product of CATALOG) {
    if (appIdIos) {
      const r = await createProductForApp(appIdIos, 'iOS', product);
      if (r) created.push({ ...r, store_identifier: product.id });
    }
    if (appIdAndroid) {
      const r = await createProductForApp(appIdAndroid, 'Android', product);
      if (r) created.push({ ...r, store_identifier: product.id });
    }
  }

  await attachPassToEntitlement(entitlement.id, created);

  console.log('\n=== Done ===');
  console.log(`Created/verified ~${created.length} products.`);
  console.log('Next: set store prices in App Store Connect + Play Console, then run the seed for those stores (see scripts/google-play-products.csv + Apple manual).');
}

main().catch((e) => {
  console.error('\n✖ Unexpected error:', e);
  process.exit(1);
});
