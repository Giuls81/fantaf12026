import { Purchases, LOG_LEVEL, PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';
import { REVENUECAT_API_KEYS, ENTITLEMENT_ID, isLikelyRevenueCatPublicKey } from '../constants_iap';

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
