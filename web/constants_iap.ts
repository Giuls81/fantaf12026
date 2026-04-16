const getEnvValue = (key: 'VITE_REVENUECAT_IOS_API_KEY' | 'VITE_REVENUECAT_ANDROID_API_KEY') => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

// RevenueCat must use SDK public keys from environment variables:
// - iOS: appl_*
// - Android: goog_*
export const REVENUECAT_API_KEYS = {
  ios: getEnvValue('VITE_REVENUECAT_IOS_API_KEY'),
  android: getEnvValue('VITE_REVENUECAT_ANDROID_API_KEY'),
};

export const isLikelyRevenueCatPublicKey = (value: string): boolean => {
  const key = value.trim();
  return key.startsWith('appl_') || key.startsWith('goog_');
};

export const ENTITLEMENT_ID = 'premium'; // Set in RevenueCat Dashboard
