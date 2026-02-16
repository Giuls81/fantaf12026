
import { AdMob, BannerAdSize, BannerAdPosition, AdOptions, AdLoadInfo, InterstitialAdPluginEvents, RewardAdOptions, RewardAdPluginEvents, AdMobRewardItem } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { ADMOB_IDS, IS_TEST_MODE } from '../constants_ads';

export const initializeAdMob = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    // Request tracking authorization before initialization
    await AdMob.requestTrackingAuthorization();

    await AdMob.initialize({
      testingDevices: IS_TEST_MODE ? ['YOUR_DEVICE_ID'] : undefined, // Add test devices if needed
      initializeForTesting: IS_TEST_MODE,
    });
    console.log('AdMob initialized');
    
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

  const adId = Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.BANNER : ADMOB_IDS.IOS.BANNER;
  
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
  
  const adId = Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.INTERSTITIAL : ADMOB_IDS.IOS.INTERSTITIAL;

  try {
    await AdMob.prepareInterstitial({
      adId,
      isTesting: IS_TEST_MODE,
    });
  } catch (e) {
     console.error('Prepare Interstitial failed', e);
  }
};

export const showInterstitial = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await AdMob.showInterstitial();
    await prepareInterstitial();
  } catch (e) {
    console.error('Show Interstitial failed', e);
    await prepareInterstitial();
  }
};

export const prepareAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    
    const adId = Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.APP_OPEN : ADMOB_IDS.IOS.APP_OPEN;
    console.log(`Preparing App Open Ad with ID: ${adId}`);

    try {
        // Many versions of the community plugin use prepareInterstitial for App Open IDs if not explicit
        // But we must use the correct slot ID to maximize monetization
        await AdMob.prepareInterstitial({
            adId: adId || (Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.INTERSTITIAL : ADMOB_IDS.IOS.INTERSTITIAL),
            isTesting: IS_TEST_MODE,
        });
    } catch (e) {
        console.error('Prepare App Open failed', e);
    }
}

export const showAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    try {
        console.log('Attempting to show App Open (Interstitial Slot)');
        await AdMob.showInterstitial();
        // Prepare for next time
        await prepareAppOpen();
    } catch (e) {
        console.error('Show App Open failed', e);
        await prepareAppOpen();
    }
}

export const showInterstitialWithProbability = async (probability: number = 0.5) => {
    if (Capacitor.getPlatform() === 'web') return;
    if (Math.random() < probability) {
        console.log(`Probability ${probability} hit, showing interstitial`);
        await showInterstitial();
    } else {
        console.log(`Probability ${probability} missed, skipping interstitial`);
        // Always prepare for next time
        await prepareInterstitial();
    }
}

export const prepareRewardVideo = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.REWARDED : ADMOB_IDS.IOS.REWARDED;

  try {
    await AdMob.prepareRewardVideoAd({
      adId,
      isTesting: IS_TEST_MODE,
    });
  } catch (e) {
    console.error('Prepare Reward Video failed', e);
  }
};

export const showRewardVideo = async (): Promise<AdMobRewardItem | null> => {
  if (Capacitor.getPlatform() === 'web') {
      // Simulate reward for web
      return { type: 'coin', amount: 10 }; 
  }

  return new Promise(async (resolve, reject) => {
      try {
          // Listener for Reward
          const onReward = await AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward: AdMobRewardItem) => {
              resolve(reward);
          });
          
          // Listener for Close/Fail (Cleanup)
          const onDismiss = await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
             // If dismissed without reward?
             // We can't easily detect "not rewarded" unless we track state.
             // But usually 'Rewarded' fires before 'Dismissed'.
             // Making sure we clean up listeners.
             onReward.remove();
             onDismiss.remove();
          });

          await AdMob.showRewardVideoAd();
      } catch (e) {
          console.error('Show Reward Video failed', e);
          // Try to prepare again
          await prepareRewardVideo();
          resolve(null);
      }
  });
};
