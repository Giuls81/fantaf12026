const getEnvValue = (key: 'VITE_REVENUECAT_IOS_API_KEY' | 'VITE_REVENUECAT_ANDROID_API_KEY') => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
};

// Prefer environment variables for official release builds.
// Legacy fallback values are kept to avoid breaking existing local setups.
export const REVENUECAT_API_KEYS = {
  ios: getEnvValue('VITE_REVENUECAT_IOS_API_KEY') || 'appae424649ff',
  android: getEnvValue('VITE_REVENUECAT_ANDROID_API_KEY') || 'app5d6f594588',
};

export const isLikelyRevenueCatPublicKey = (value: string): boolean => {
  const key = value.trim();
  return key.startsWith('appl_') || key.startsWith('goog_');
};

export const ENTITLEMENT_ID = 'premium'; // Set in RevenueCat Dashboard
