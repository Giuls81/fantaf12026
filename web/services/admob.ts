import {
  AdMob,
  AdmobConsentStatus,
  AdMobRewardItem,
  BannerAdPosition,
  BannerAdSize,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { ADMOB_IDS, ADS_DEBUG_LOGS, ADS_ENABLED, IS_TEST_MODE } from '../constants_ads';

type AdType = 'BANNER' | 'INTERSTITIAL' | 'REWARDED' | 'APP_OPEN';
type InterstitialSlot = 'APP_OPEN' | 'INTERSTITIAL' | null;
type PluginListener = { remove: () => void | Promise<void> };

const TEST_IDS = {
  ANDROID: {
    BANNER: 'ca-app-pub-3940256099942544/6300978111',
    INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
    REWARDED: 'ca-app-pub-3940256099942544/5224354917',
    APP_OPEN: 'ca-app-pub-3940256099942544/9257395923',
  },
  IOS: {
    BANNER: 'ca-app-pub-3940256099942544/2934735716',
    INTERSTITIAL: 'ca-app-pub-3940256099942544/4411468910',
    REWARDED: 'ca-app-pub-3940256099942544/1712485313',
    APP_OPEN: 'ca-app-pub-3940256099942544/5575463023',
  },
} as const;

let currentInterstitialSlot: InterstitialSlot = null;
let isAdMobInitialized = false;
let initializePromise: Promise<boolean> | null = null;
let canRequestAds = true;

const isNativeAdsEnabled = () => ADS_ENABLED && Capacitor.getPlatform() !== 'web';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const adLog = (...args: unknown[]) => {
  if (ADS_DEBUG_LOGS) {
    console.log(...args);
  }
};

const getAdId = (type: AdType) => {
  const platform = Capacitor.getPlatform() === 'android' ? 'ANDROID' : 'IOS';
  if (IS_TEST_MODE) return TEST_IDS[platform][type];
  return ADMOB_IDS[platform][type];
};

const ensureAdMobInitialized = async (): Promise<boolean> => {
  if (!isNativeAdsEnabled()) return false;
  if (isAdMobInitialized) return true;
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    try {
      adLog('AdMob: Initializing...');
      await AdMob.initialize({ initializeForTesting: IS_TEST_MODE });
      isAdMobInitialized = true;
      adLog('AdMob: Initialized. Test Mode:', IS_TEST_MODE);
    } catch (e) {
      console.error('AdMob: initialize failed', e);
      isAdMobInitialized = false;
      return false;
    }

    // ATT prompt should never block SDK init.
    try {
      await AdMob.requestTrackingAuthorization();
    } catch (e) {
      console.warn('AdMob: tracking authorization request failed', e);
    }

    // EEA/UK: request/update consent state before requesting ads.
    try {
      let consentInfo = await AdMob.requestConsentInfo();
      canRequestAds = consentInfo.canRequestAds;

      if (
        consentInfo.status === AdmobConsentStatus.REQUIRED &&
        consentInfo.isConsentFormAvailable &&
        !consentInfo.canRequestAds
      ) {
        consentInfo = await AdMob.showConsentForm();
        canRequestAds = consentInfo.canRequestAds;
      }

      adLog('AdMob: consent status', consentInfo.status, 'canRequestAds:', consentInfo.canRequestAds);
    } catch (e) {
      // Fail-open to avoid blocking ads if consent API transiently fails.
      console.warn('AdMob: consent flow failed, continuing', e);
      canRequestAds = true;
    }

    return true;
  })().finally(() => {
    initializePromise = null;
  });

  return initializePromise;
};

const canUseAds = async (): Promise<boolean> => {
  const initialized = await ensureAdMobInitialized();
  if (!initialized) return false;
  if (!IS_TEST_MODE && !canRequestAds) {
    adLog('AdMob: consent not granted, skipping ad request');
    return false;
  }
  return true;
};

export const initializeAdMob = async () => {
  if (!isNativeAdsEnabled()) return;

  const ready = await ensureAdMobInitialized();
  if (!ready) return;

  // Keep startup inventory warm.
  await prepareAppOpen();
  await prepareRewardVideo();
};

export const showBanner = async () => {
  if (!(await canUseAds())) return;

  const adId = getAdId('BANNER');
  try {
    adLog('AdMob: Showing banner (TOP)', adId);
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      // iOS notch/safe-area keeps banner visible.
      margin: Capacitor.getPlatform() === 'ios' ? 52 : 0,
      isTesting: IS_TEST_MODE,
    });
  } catch (e) {
    console.error('AdMob: show banner failed', e);
  }
};

export const hideBanner = async () => {
  if (!isNativeAdsEnabled()) return;

  try {
    await AdMob.hideBanner();
    await AdMob.removeBanner();
  } catch (e) {
    console.error('AdMob: hide banner failed', e);
  }
};

export const prepareInterstitial = async () => {
  if (!(await canUseAds())) return;

  const adId = getAdId('INTERSTITIAL');
  try {
    adLog('AdMob: Preparing interstitial', adId);
    await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
    currentInterstitialSlot = 'INTERSTITIAL';
    adLog('AdMob: Interstitial ready');
  } catch (e) {
    console.error('AdMob: prepare interstitial failed', e);
    currentInterstitialSlot = null;
  }
};

export const showInterstitial = async () => {
  if (!(await canUseAds())) return;

  try {
    if (currentInterstitialSlot !== 'INTERSTITIAL') {
      adLog('AdMob: Interstitial not loaded, preparing...');
      await prepareInterstitial();
      if (currentInterstitialSlot !== 'INTERSTITIAL') return;
      await sleep(900);
    }

    adLog('AdMob: Showing interstitial');
    await AdMob.showInterstitial();
    currentInterstitialSlot = null;
    await prepareInterstitial();
  } catch (e) {
    console.error('AdMob: show interstitial failed', e);
    currentInterstitialSlot = null;
    await prepareInterstitial();
  }
};

export const prepareAppOpen = async () => {
  if (!(await canUseAds())) return;

  const appOpenAdId = getAdId('APP_OPEN');
  adLog('AdMob: Preparing app-open ad', appOpenAdId);
  try {
    await AdMob.prepareInterstitial({ adId: appOpenAdId, isTesting: IS_TEST_MODE });
    currentInterstitialSlot = 'APP_OPEN';
    adLog('AdMob: App-open ad ready');
  } catch (e) {
    // Plugin exposes interstitial API only; fallback to interstitial unit for "app-open moment".
    console.error('AdMob: prepare app-open ad failed, trying interstitial fallback', e);
    const fallbackAdId = getAdId('INTERSTITIAL');
    if (fallbackAdId === appOpenAdId) {
      currentInterstitialSlot = null;
      return;
    }
    try {
      await AdMob.prepareInterstitial({ adId: fallbackAdId, isTesting: IS_TEST_MODE });
      currentInterstitialSlot = 'APP_OPEN';
      adLog('AdMob: App-open fallback ready with interstitial unit');
    } catch (fallbackError) {
      console.error('AdMob: app-open fallback failed', fallbackError);
      currentInterstitialSlot = null;
    }
  }
};

export const showAppOpen = async () => {
  if (!(await canUseAds())) return;

  try {
    if (currentInterstitialSlot !== 'APP_OPEN') {
      adLog('AdMob: App-open ad not loaded, preparing...');
      await prepareAppOpen();
      if (currentInterstitialSlot !== 'APP_OPEN') return;
      await sleep(900);
    }

    adLog('AdMob: Showing app-open ad');
    await AdMob.showInterstitial();
    currentInterstitialSlot = null;
    await prepareInterstitial();
  } catch (e) {
    console.error('AdMob: app-open ad failed to show', e);
    currentInterstitialSlot = null;
    await prepareInterstitial();
  }
};

export const showInterstitialWithProbability = async (probability = 0.5) => {
  if (!(await canUseAds())) return;

  if (Math.random() < probability) {
    adLog('AdMob: Interstitial probability hit', probability);
    await showInterstitial();
    return;
  }

  if (currentInterstitialSlot !== 'INTERSTITIAL') {
    await prepareInterstitial();
  }
};

export const prepareRewardVideo = async () => {
  if (!(await canUseAds())) return;

  const adId = getAdId('REWARDED');
  try {
    await AdMob.prepareRewardVideoAd({ adId, isTesting: IS_TEST_MODE });
  } catch (e) {
    console.error('AdMob: prepare reward video failed', e);
  }
};

export const showRewardVideo = async (): Promise<AdMobRewardItem | null> => {
  if (Capacitor.getPlatform() === 'web') return { type: 'coin', amount: 10 };
  if (!(await canUseAds())) return null;

  return new Promise(async (resolve) => {
    let resolved = false;
    let earnedReward: AdMobRewardItem | null = null;
    let listeners: PluginListener[] = [];

    const cleanup = () => {
      listeners.forEach((listener) => listener.remove());
      listeners = [];
    };

    const preloadNext = () => {
      setTimeout(() => {
        adLog('AdMob: Preloading next reward video...');
        prepareRewardVideo().catch((e) => adLog('AdMob: reward preload failed', e));
      }, 1000);
    };

    const safeResolve = (value: AdMobRewardItem | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      clearTimeout(timeoutId);
      resolve(value);
      preloadNext();
    };

    const timeoutId = setTimeout(() => {
      adLog('AdMob: Reward video timeout reached');
      safeResolve(earnedReward);
    }, 70000);

    try {
      adLog('AdMob: Registering reward listeners...');

      listeners.push(
        await AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
          adLog('AdMob: Reward event fired', reward);
          earnedReward = reward;
        }),
      );

      listeners.push(
        await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          adLog('AdMob: Reward video dismissed. Earned:', earnedReward);
          safeResolve(earnedReward);
        }),
      );

      listeners.push(
        await AdMob.addListener(RewardAdPluginEvents.FailedToShow, (error) => {
          console.error('AdMob: reward video failed to show', error);
          safeResolve(null);
        }),
      );

      adLog('AdMob: Calling showRewardVideoAd...');
      await AdMob.showRewardVideoAd();
    } catch (e) {
      console.error('AdMob: show reward video exception', e);
      safeResolve(null);
    }
  });
};
