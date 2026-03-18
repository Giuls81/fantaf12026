import {
  AdMob,
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

const isNativeAdsEnabled = () => ADS_ENABLED && Capacitor.getPlatform() !== 'web';

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

export const initializeAdMob = async () => {
  if (!isNativeAdsEnabled()) return;

  try {
    adLog('AdMob: Initializing...');
    await AdMob.requestTrackingAuthorization();
    await AdMob.initialize({ initializeForTesting: IS_TEST_MODE });
    adLog('AdMob: Initialized. Test Mode:', IS_TEST_MODE);

    // Keep app-open and reward ads ready at startup.
    await prepareAppOpen();
    await prepareRewardVideo();
  } catch (e) {
    console.error('AdMob: init failed', e);
  }
};

export const showBanner = async () => {
  if (!isNativeAdsEnabled()) return;

  const adId = getAdId('BANNER');
  try {
    adLog('AdMob: Showing banner (TOP)', adId);
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      margin: 0,
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
  if (!isNativeAdsEnabled()) return;

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
  if (!isNativeAdsEnabled()) return;

  try {
    if (currentInterstitialSlot !== 'INTERSTITIAL') {
      adLog('AdMob: Interstitial not loaded, preparing...');
      await prepareInterstitial();
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
  if (!isNativeAdsEnabled()) return;

  const adId = getAdId('APP_OPEN');
  adLog('AdMob: Preparing app-open ad', adId);
  try {
    await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
    currentInterstitialSlot = 'APP_OPEN';
    adLog('AdMob: App-open ad ready');
  } catch (e) {
    console.error('AdMob: prepare app-open ad failed', e);
    currentInterstitialSlot = null;
  }
};

export const showAppOpen = async () => {
  if (!isNativeAdsEnabled()) return;

  try {
    if (currentInterstitialSlot !== 'APP_OPEN') {
      adLog('AdMob: App-open ad not loaded, preparing...');
      await prepareAppOpen();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    adLog('AdMob: Showing app-open ad');
    await AdMob.showInterstitial();
    currentInterstitialSlot = null;
    await prepareInterstitial();
  } catch (e) {
    adLog('AdMob: app-open ad failed to show', e);
    currentInterstitialSlot = null;
    await prepareInterstitial();
  }
};

export const showInterstitialWithProbability = async (probability = 0.5) => {
  if (!isNativeAdsEnabled()) return;

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
  if (!isNativeAdsEnabled()) return;

  const adId = getAdId('REWARDED');
  try {
    await AdMob.prepareRewardVideoAd({ adId, isTesting: IS_TEST_MODE });
  } catch (e) {
    console.error('AdMob: prepare reward video failed', e);
  }
};

export const showRewardVideo = async (): Promise<AdMobRewardItem | null> => {
  if (Capacitor.getPlatform() === 'web') return { type: 'coin', amount: 10 };
  if (!isNativeAdsEnabled()) return null;

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
