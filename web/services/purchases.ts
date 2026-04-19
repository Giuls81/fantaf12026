import { Purchases, LOG_LEVEL, PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';
import {
  REVENUECAT_API_KEYS,
  ENTITLEMENT_ID,
  COSMETIC_PASS_ENTITLEMENT_ID,
  isLikelyRevenueCatPublicKey,
} from '../constants_iap';

let purchasesInitIssue: string | null = null;

export const getPurchasesInitIssue = () => purchasesInitIssue;

export const initializePurchases = async () => {
  const platform = Capacitor.getPlatform();
  if (platform === 'web') return;

  purchasesInitIssue = null;

  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });

    const apiKey = platform === 'ios' ? REVENUECAT_API_KEYS.ios : REVENUECAT_API_KEYS.android;
    if (!apiKey) {
      purchasesInitIssue = `missing_${platform}_sdk_key`;
      console.warn("Purchases init skipped: missing RevenueCat API key", platform);
      return;
    }

    if (!isLikelyRevenueCatPublicKey(apiKey)) {
      purchasesInitIssue = `invalid_${platform}_sdk_key_format`;
      console.warn(
        "RevenueCat key format looks invalid (expected appl_/goog_). Check VITE_REVENUECAT_* env vars.",
        { platform }
      );
      return;
    }

    await Purchases.configure({ apiKey });
  } catch (e) {
    purchasesInitIssue = `purchases_configure_failed:${(e as Error)?.message || 'unknown_error'}`;
    console.warn("Purchases init failed", e);
  }
};

export const checkPremiumStatus = async (): Promise<boolean | null> => {
   if (Capacitor.getPlatform() === 'web') return false;
   try {
     const customerInfo = await Purchases.getCustomerInfo();
     if (typeof customerInfo.customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined") {
       return true;
     }
     return false;
   } catch (e) {
     console.warn("Check premium failed", e);
     return null;
   }
};

export const getOfferings = async (): Promise<PurchasesPackage | null> => {
  if (Capacitor.getPlatform() === 'web') return null;
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current === null) {
      purchasesInitIssue = purchasesInitIssue || 'no_current_offering';
      return null;
    }

    const getIdentifier = (pkg: PurchasesPackage) =>
      String((pkg as PurchasesPackage & { identifier?: string }).identifier ?? '').toLowerCase();

    const getPackageType = (pkg: PurchasesPackage) =>
      String((pkg as PurchasesPackage & { packageType?: string }).packageType ?? '').toLowerCase();

    const seasonHint = (pkg: PurchasesPackage) => {
      const packageIdentifier = String((pkg as unknown as { identifier?: string }).identifier ?? '').toLowerCase();
      const productIdentifier = String(pkg.product?.identifier ?? '').toLowerCase();
      const productTitle = String(pkg.product?.title ?? '').toLowerCase();
      const haystack = `${packageIdentifier} ${productIdentifier} ${productTitle}`;
      return (
        haystack.includes('season') ||
        haystack.includes('stagion') ||
        haystack.includes('pass') ||
        haystack.includes('annual') ||
        haystack.includes('annuale')
      );
    };

    const availablePackages = offerings.current.availablePackages || [];
    if (availablePackages.length === 0) return null;

    // Prefer an explicitly named season/annual pass package from RevenueCat offering.
    const seasonPackage = availablePackages.find(seasonHint);
    if (seasonPackage) {
      return seasonPackage;
    }

    // Fallback to the ANNUAL package type if defined.
    const annualPackage = availablePackages.find((pkg) => getPackageType(pkg) === 'annual');
    if (annualPackage) {
      return annualPackage;
    }

    // Last-resort fallback: if there is a single package, use it.
    if (availablePackages.length === 1) {
      return availablePackages[0];
    }

    console.warn(
      "No season pass package matched in current offering",
      offerings.current.identifier,
      availablePackages.map((pkg) => ({
        identifier: getIdentifier(pkg),
        productIdentifier: pkg.product?.identifier,
        productTitle: pkg.product?.title,
        packageType: getPackageType(pkg),
      }))
    );
  } catch (e) {
    purchasesInitIssue = `get_offerings_failed:${(e as Error)?.message || 'unknown_error'}`;
    console.error("Get offerings failed", e);
  }
  return null;
};

export const purchasePackage = async (pkg: PurchasesPackage): Promise<boolean> => {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
     const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
     if (typeof customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined") {
       return true;
     }
  } catch (e: any) {
    if (!e.userCancelled) {
      console.error("Purchase failed", e);
      alert("Purchase failed: " + e.message);
    }
  }
  return false;
};

export const restorePurchases = async (): Promise<boolean> => {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    if (typeof customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined") {
       return true;
    }
  } catch (e) {
     console.error("Restore failed", e);
     alert("Restore failed: " + (e as any).message);
  }
  return false;
};

// --- Cosmetics (Phase 4b, added 2026-04-17) -----------------------------
//
// RevenueCat treats the fantasy app's own User.id as `appUserID`. The
// server-side /revenuecat/webhook uses that value to grant UserCosmetic
// rows, so we MUST call logInUser(user.id) after the user authenticates
// (or signs up) and before any cosmetic purchase. Safe to call multiple
// times — RevenueCat de-dupes.
export const logInUser = async (userId: string): Promise<void> => {
  if (Capacitor.getPlatform() === 'web') return;
  if (!userId) return;
  try {
    await Purchases.logIn({ appUserID: userId });
  } catch (e) {
    console.warn('Purchases.logIn failed', e);
  }
};

export const logOutUser = async (): Promise<void> => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('Purchases.logOut failed', e);
  }
};

// Buy a cosmetic product by productId. Cosmetics aren't necessarily in the
// current offering (we keep the current offering reserved for the season
// ad-removal pass), so we purchase via the store product directly.
//
// Returns:
//   { ok: true, productId }                  on success
//   { ok: false, reason: 'user_cancelled' }  if user hit cancel
//   { ok: false, reason: 'unsupported_web' } if running in web preview
//   { ok: false, reason: 'not_found' }       if the store doesn't sell it
//   { ok: false, reason: string, error? }    on any other failure
export const purchaseCosmeticProduct = async (
  productId: string,
): Promise<{ ok: true; productId: string } | { ok: false; reason: string; error?: unknown }> => {
  if (Capacitor.getPlatform() === 'web') {
    return { ok: false, reason: 'unsupported_web' };
  }
  try {
    // v12 SDK: getProducts returns { products: StoreProduct[] }
    const { products } = await Purchases.getProducts({
      productIdentifiers: [productId],
    });
    const product = (products || []).find(
      (p) => (p as { identifier?: string }).identifier === productId,
    );
    if (!product) {
      return { ok: false, reason: 'not_found' };
    }

    // v12 SDK: purchaseStoreProduct({ product }) returns { customerInfo, ... }
    const result = await (Purchases as unknown as {
      purchaseStoreProduct: (args: { product: unknown }) => Promise<{
        customerInfo: { entitlements: { active: Record<string, unknown> } };
      }>;
    }).purchaseStoreProduct({ product });

    // Validate: either the cosmetic entitlement is now active (pass purchase),
    // or the customer info contains the product (individual purchase). The
    // webhook handles the DB grant regardless.
    const entitlements = result?.customerInfo?.entitlements?.active || {};
    if (
      productId === 'fantaf1.cosmetic.pass.season2026' &&
      typeof entitlements[COSMETIC_PASS_ENTITLEMENT_ID] === 'undefined'
    ) {
      console.warn(
        'Season pass purchased but cosmetic_pass_2026 entitlement not active yet. Webhook should grant it shortly.',
      );
    }
    return { ok: true, productId };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err?.userCancelled) {
      return { ok: false, reason: 'user_cancelled' };
    }
    console.error('purchaseCosmeticProduct failed', e);
    return { ok: false, reason: 'purchase_failed', error: e };
  }
};

// True if the authenticated RevenueCat user currently holds the season
// aesthetic pass entitlement. The pass grants instant access to every
// catalog item client-side even before the webhook populates UserCosmetic.
export const hasCosmeticPassActive = async (): Promise<boolean> => {
  if (Capacitor.getPlatform() === 'web') return false;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return typeof customerInfo.customerInfo.entitlements.active[COSMETIC_PASS_ENTITLEMENT_ID] !== 'undefined';
  } catch (e) {
    console.warn('hasCosmeticPassActive check failed', e);
    return false;
  }
};
