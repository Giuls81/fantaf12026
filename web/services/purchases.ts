import { Purchases, LOG_LEVEL, PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';
import { REVENUECAT_API_KEYS, ENTITLEMENT_ID } from '../constants_iap';

export const initializePurchases = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG }); // Set to INFO/WARN in prod

    if (Capacitor.getPlatform() === 'ios') {
      await Purchases.configure({ apiKey: REVENUECAT_API_KEYS.ios });
    } else if (Capacitor.getPlatform() === 'android') {
      await Purchases.configure({ apiKey: REVENUECAT_API_KEYS.android });
    }
  } catch (e) {
    console.warn("Purchases init failed", e);
  }
};

export const checkPremiumStatus = async (): Promise<boolean> => {
   if (Capacitor.getPlatform() === 'web') return false;
   try {
     const customerInfo = await Purchases.getCustomerInfo();
     if (typeof customerInfo.customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined") {
       return true;
     }
   } catch (e) {
     console.warn("Check premium failed", e);
   }
   return false;
};

export const getOfferings = async (): Promise<PurchasesPackage | null> => {
  if (Capacitor.getPlatform() === 'web') return null;
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
      return offerings.current.availablePackages[0]; // Assuming only one annual package
    }
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
