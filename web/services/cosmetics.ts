// Client-side cosmetics service. Mirrors the server catalog in
// supabase/functions/fanta-api/index.ts (keep the two in sync when
// adding/removing SKUs). Also wraps the three /me/cosmetics endpoints.
//
// Added 2026-04-17 — Phase 4b.

import { apiGet, apiPost } from '../api';
import type {
  CosmeticCategory,
  CosmeticsState,
  EquippedCosmetics,
} from '../types';
import { purchaseCosmeticProduct } from './purchases';

// ---------------------------------------------------------------------------
// Catalog (must match COSMETIC_CATALOG in the Edge Function)
// ---------------------------------------------------------------------------

export interface CosmeticItem {
  productId: string;
  category: CosmeticCategory | 'bundle' | 'pass';
  displayName: string;
  priceEur: number; // Display fallback only — RevenueCat returns the actual store price at purchase time
  swatchHex?: string; // Only for category === 'color'
  containedProductIds?: string[]; // Only for bundle/pass
}

const mk = (
  productId: string,
  category: CosmeticCategory | 'bundle' | 'pass',
  displayName: string,
  priceEur: number,
  extras: Partial<CosmeticItem> = {},
): CosmeticItem => ({ productId, category, displayName, priceEur, ...extras });

export const COSMETIC_CATALOG: CosmeticItem[] = [
  // Emblems (€0.99)
  mk('fantaf1.cosmetic.emblem.lightning', 'emblem', 'Lightning Crest', 0.99),
  mk('fantaf1.cosmetic.emblem.mountain', 'emblem', 'Summit Crest', 0.99),
  mk('fantaf1.cosmetic.emblem.wave', 'emblem', 'Wave Crest', 0.99),
  mk('fantaf1.cosmetic.emblem.compass', 'emblem', 'Compass Star', 0.99),
  mk('fantaf1.cosmetic.emblem.flame', 'emblem', 'Flame Crest', 0.99),
  mk('fantaf1.cosmetic.emblem.wolf', 'emblem', 'Wolf Head', 0.99),
  mk('fantaf1.cosmetic.emblem.checkered', 'emblem', 'Checkered Shield', 0.99),
  mk('fantaf1.cosmetic.emblem.octane', 'emblem', 'Octane Drop', 0.99),

  // Helmets (€1.99)
  mk('fantaf1.cosmetic.helmet.carbon', 'helmet', 'Carbon Raw', 1.99),
  mk('fantaf1.cosmetic.helmet.storm', 'helmet', 'Storm Grey', 1.99),
  mk('fantaf1.cosmetic.helmet.gold', 'helmet', 'Gold Leaf', 1.99),
  mk('fantaf1.cosmetic.helmet.chrome', 'helmet', 'Chrome Mirror', 1.99),
  mk('fantaf1.cosmetic.helmet.midnight', 'helmet', 'Midnight Matte', 1.99),
  mk('fantaf1.cosmetic.helmet.rainbow', 'helmet', 'Rainbow Fade', 1.99),
  mk('fantaf1.cosmetic.helmet.fire', 'helmet', 'Fire Gradient', 1.99),
  mk('fantaf1.cosmetic.helmet.ocean', 'helmet', 'Ocean Deep', 1.99),
  mk('fantaf1.cosmetic.helmet.forest', 'helmet', 'Forest Hex', 1.99),
  mk('fantaf1.cosmetic.helmet.volcano', 'helmet', 'Volcano Red', 1.99),

  // Suits (€1.99)
  mk('fantaf1.cosmetic.suit.monochrome', 'suit', 'Classic Monochrome', 1.99),
  mk('fantaf1.cosmetic.suit.retro70', 'suit', 'Retro 70s Stripes', 1.99),
  mk('fantaf1.cosmetic.suit.mosaic', 'suit', 'Geometric Mosaic', 1.99),
  mk('fantaf1.cosmetic.suit.sunrise', 'suit', 'Gradient Sunrise', 1.99),
  mk('fantaf1.cosmetic.suit.digicamo', 'suit', 'Digital Camo', 1.99),
  mk('fantaf1.cosmetic.suit.tuxedo', 'suit', 'Tuxedo Formal', 1.99),

  // Colors (€0.99) — rendered from hex, no image asset required
  mk('fantaf1.cosmetic.color.electric', 'color', 'Electric Blue', 0.99, { swatchHex: '#00B7FF' }),
  mk('fantaf1.cosmetic.color.emerald', 'color', 'Emerald Green', 0.99, { swatchHex: '#00A676' }),
  mk('fantaf1.cosmetic.color.royal', 'color', 'Royal Purple', 0.99, { swatchHex: '#6A1B9A' }),
  mk('fantaf1.cosmetic.color.molten', 'color', 'Molten Orange', 0.99, { swatchHex: '#FF6A00' }),
  mk('fantaf1.cosmetic.color.rosegold', 'color', 'Rose Gold', 0.99, { swatchHex: '#B76E79' }),
  mk('fantaf1.cosmetic.color.pure', 'color', 'Pure White', 0.99, { swatchHex: '#FFFFFF' }),

  // Liveries (€2.99) — car paint schemes, rendered as a wide strip in the UI
  mk('fantaf1.cosmetic.livery.classic', 'livery', 'Classic Stripes', 2.99),
  mk('fantaf1.cosmetic.livery.stealth', 'livery', 'Stealth Matte', 2.99),
  mk('fantaf1.cosmetic.livery.racing', 'livery', 'Racing Red', 2.99),
  mk('fantaf1.cosmetic.livery.rainbow', 'livery', 'Rainbow Flow', 2.99),
  mk('fantaf1.cosmetic.livery.carbon', 'livery', 'Carbon Weave', 2.99),
  mk('fantaf1.cosmetic.livery.neon', 'livery', 'Neon Circuit', 2.99),

  // Bundle (€7.99)
  mk('fantaf1.cosmetic.bundle.starter', 'bundle', 'Starter Aesthetic Bundle', 7.99, {
    containedProductIds: [
      'fantaf1.cosmetic.emblem.lightning',
      'fantaf1.cosmetic.emblem.flame',
      'fantaf1.cosmetic.emblem.wave',
      'fantaf1.cosmetic.emblem.compass',
      'fantaf1.cosmetic.helmet.carbon',
      'fantaf1.cosmetic.helmet.storm',
      'fantaf1.cosmetic.helmet.gold',
      'fantaf1.cosmetic.helmet.ocean',
      'fantaf1.cosmetic.color.electric',
      'fantaf1.cosmetic.color.emerald',
    ],
  }),

  // Season Pass (€19.99) — unlocks all emblems/helmets/suits/colors/liveries
  mk('fantaf1.cosmetic.pass.season2026', 'pass', 'Season Aesthetic Pass 2026', 19.99),
];

export const COSMETIC_BY_ID: Record<string, CosmeticItem> = Object.fromEntries(
  COSMETIC_CATALOG.map((c) => [c.productId, c]),
);

export const getCosmeticById = (id: string | null | undefined): CosmeticItem | null =>
  id ? COSMETIC_BY_ID[id] ?? null : null;

export const getCosmeticsByCategory = (cat: CosmeticCategory): CosmeticItem[] =>
  COSMETIC_CATALOG.filter((c) => c.category === cat);

// ---------------------------------------------------------------------------
// API wrappers
// ---------------------------------------------------------------------------

export async function fetchMyCosmetics(): Promise<CosmeticsState> {
  return apiGet<CosmeticsState>('/me/cosmetics');
}

export async function equipCosmetic(
  teamId: string,
  category: CosmeticCategory,
  productId: string | null,
): Promise<{ ok: true; teamId: string; category: string; productId: string | null }> {
  return apiPost<{ ok: true; teamId: string; category: string; productId: string | null }>(
    '/me/cosmetics/equip',
    { teamId, category, productId },
  );
}

// ---------------------------------------------------------------------------
// Purchase orchestration
// ---------------------------------------------------------------------------
//
// Buying a cosmetic:
// 1. Call RevenueCat → receipt validated by stores
// 2. Server webhook inserts UserCosmetic rows
// 3. Client re-fetches /me/cosmetics to see new rows
//
// The webhook is asynchronous so the re-fetch may need a small retry. We
// try up to `maxAttempts` with exponential backoff to observe the new row.
export async function buyCosmeticAndRefresh(
  productId: string,
  maxAttempts = 6,
): Promise<
  | { ok: true; state: CosmeticsState }
  | { ok: false; reason: string; state?: CosmeticsState }
> {
  const purchaseResult = await purchaseCosmeticProduct(productId);
  if (!purchaseResult.ok) {
    return purchaseResult;
  }

  // Poll for webhook completion. Typical observed latency: 200ms–3s.
  let lastState: CosmeticsState | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const delayMs = Math.min(500 * Math.pow(1.5, attempt), 5000);
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const state = await fetchMyCosmetics();
      lastState = state;

      const catalogEntry = COSMETIC_BY_ID[productId];
      const expectedProductIds =
        catalogEntry?.containedProductIds ??
        (catalogEntry?.category === 'pass'
          ? COSMETIC_CATALOG.filter((c) => c.category !== 'bundle' && c.category !== 'pass').map(
              (c) => c.productId,
            )
          : [productId]);

      const ownedSet = new Set(state.owned.map((o) => o.productId));
      const allGranted = expectedProductIds.every((pid) => ownedSet.has(pid));
      if (allGranted) {
        return { ok: true, state };
      }
    } catch (e) {
      console.warn('fetchMyCosmetics poll failed', e);
    }
  }

  return {
    ok: false,
    reason: 'webhook_timeout',
    state: lastState ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export function findEquippedForTeam(
  state: CosmeticsState | null,
  teamId: string | null,
): EquippedCosmetics | null {
  if (!state || !teamId) return null;
  return state.equipped.find((e) => e.teamId === teamId) ?? null;
}

export function isOwned(state: CosmeticsState | null, productId: string): boolean {
  if (!state) return false;
  return state.owned.some((o) => o.productId === productId);
}
