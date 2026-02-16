
import { AdMob, BannerAdSize, BannerAdPosition, AdOptions, AdLoadInfo, InterstitialAdPluginEvents, RewardAdOptions, RewardAdPluginEvents, AdMobRewardItem } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { ADMOB_IDS, IS_TEST_MODE } from '../constants_ads';

// Official Google Test IDs
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
  }
};

const getAdId = (type: 'BANNER' | 'INTERSTITIAL' | 'REWARDED' | 'APP_OPEN') => {
  const platform = Capacitor.getPlatform() === 'android' ? 'ANDROID' : 'IOS';
  if (IS_TEST_MODE) {
    return TEST_IDS[platform][type];
  }
  return ADMOB_IDS[platform][type];
};

export const initializeAdMob = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    console.log('AdMob: Initializing...');
    await AdMob.requestTrackingAuthorization();
    await AdMob.initialize({
      initializeForTesting: IS_TEST_MODE,
    });
    console.log('AdMob: Initialized. Test Mode:', IS_TEST_MODE);
    
    // Pre-load ads
    await prepareAppOpen();
    await prepareRewardVideo();
    await prepareInterstitial();

  } catch (e) {
    console.error('AdMob init failed', e);
  }
};

export const showBanner = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('BANNER');
  try {
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: IS_TEST_MODE,
    });
  } catch (e) {
    console.error('Show Banner failed', e);
  }
};

export const hideBanner = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await AdMob.hideBanner();
    await AdMob.removeBanner();
  } catch (e) {
    console.error('Hide Banner failed', e);
  }
};

export const prepareInterstitial = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('INTERSTITIAL');
  try {
    console.log(`AdMob: Preparing Interstitial (${adId})`);
    await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
  } catch (e) {
     console.error('Prepare Interstitial failed', e);
  }
};

export const showInterstitial = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    console.log('AdMob: Showing Interstitial');
    await AdMob.showInterstitial();
    await prepareInterstitial();
  } catch (e) {
    console.error('Show Interstitial failed', e);
    await prepareInterstitial();
  }
};

export const prepareAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    const adId = getAdId('APP_OPEN');
    console.log(`AdMob: Preparing Startup Ad (ID: ${adId})`);
    try {
        await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
    } catch (e) {
        console.error('Prepare Startup Ad failed', e);
    }
}

export const showAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    try {
        console.log('AdMob: Attempting to show Startup Ad');
        await AdMob.showInterstitial();
        await prepareAppOpen();
    } catch (e) {
        console.warn('AdMob: Startup Ad not ready. Retrying prepare...');
        await prepareAppOpen();
    }
}

export const showInterstitialWithProbability = async (probability: number = 0.5) => {
    if (Capacitor.getPlatform() === 'web') return;
    if (Math.random() < probability) {
        console.log(`AdMob: Probability ${probability} hit`);
        await showInterstitial();
    } else {
        await prepareInterstitial();
    }
}

export const prepareRewardVideo = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('REWARDED');
  try {
    await AdMob.prepareRewardVideoAd({ adId, isTesting: IS_TEST_MODE });
  } catch (e) {
    console.error('Prepare Reward Video failed', e);
  }
};

export const showRewardVideo = async (): Promise<AdMobRewardItem | null> => {
  if (Capacitor.getPlatform() === 'web') return { type: 'coin', amount: 10 }; 
  return new Promise(async (resolve) => {
      try {
          const onReward = await AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => resolve(reward));
          const onDismiss = await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
              onReward.remove();
              onDismiss.remove();
          });
          await AdMob.showRewardVideoAd();
      } catch (e) {
          console.error('Show Reward Video failed', e);
          await prepareRewardVideo();
          resolve(null);
      }
  });
};
