import { Purchases, LOG_LEVEL, PurchasesPackage, PACKAGE_TYPE } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';
import { REVENUECAT_API_KEYS, ENTITLEMENT_ID } from '../constants_iap';

export const initializePurchases = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });

    if (Capacitor.getPlatform() === 'ios') {
      await Purchases.configure({ apiKey: REVENUECAT_API_KEYS.ios });
    } else if (Capacitor.getPlatform() === 'android') {
      await Purchases.configure({ apiKey: REVENUECAT_API_KEYS.android });
    }
  } catch (e) {
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
    if (offerings.current === null) return null;

    // Prefer explicit annual package from RevenueCat offering.
    if (offerings.current.annual) {
      return offerings.current.annual;
    }

    // Fallbacks for custom package setups that still map to a yearly subscription.
    const annualByType = offerings.current.availablePackages.find(
      (pkg) => pkg.packageType === PACKAGE_TYPE.ANNUAL,
    );
    if (annualByType) {
      return annualByType;
    }

    const annualByPeriod = offerings.current.availablePackages.find(
      (pkg) => pkg.product.subscriptionPeriod === 'P1Y',
    );
    if (annualByPeriod) {
      return annualByPeriod;
    }

    console.warn("No annual package found in current offering", offerings.current.identifier);
  } catch (e) {
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
