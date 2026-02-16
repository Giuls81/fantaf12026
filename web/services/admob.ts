
import { AdMob, BannerAdSize, BannerAdPosition, AdOptions, AdLoadInfo, InterstitialAdPluginEvents, RewardAdOptions, RewardAdPluginEvents, AdMobRewardItem } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { ADMOB_IDS, IS_TEST_MODE } from '../constants_ads';

// Official Google Test IDs — guaranteed to return ads
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

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: The plugin can only hold ONE prepared interstitial at a time.
// So we must NOT call prepareInterstitial AND prepareAppOpen simultaneously.
// We track which "slot" is currently loaded.
// ─────────────────────────────────────────────────────────────────────────────
let currentInterstitialSlot: 'APP_OPEN' | 'INTERSTITIAL' | null = null;

export const initializeAdMob = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    console.log('AdMob: Initializing...');
    await AdMob.requestTrackingAuthorization();
    await AdMob.initialize({
      initializeForTesting: IS_TEST_MODE,
    });
    console.log('AdMob: ✅ Initialized. Test Mode:', IS_TEST_MODE);
    
    // Pre-load ONLY the startup (App Open) interstitial.
    // Do NOT prepare a regular interstitial here — it would overwrite this one.
    await prepareAppOpen();
    await prepareRewardVideo();

  } catch (e) {
    console.error('AdMob: ❌ init failed', e);
  }
};

// ─── BANNER ──────────────────────────────────────────────────────────────────
// Moved to TOP_CENTER so it doesn't overlap the bottom tab bar.
export const showBanner = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('BANNER');
  try {
    console.log('AdMob: Showing Banner (TOP)', adId);
    await AdMob.showBanner({
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.TOP_CENTER,
      margin: 0,
      isTesting: IS_TEST_MODE,
    });
  } catch (e) {
    console.error('AdMob: Show Banner failed', e);
  }
};

export const hideBanner = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    await AdMob.hideBanner();
    await AdMob.removeBanner();
  } catch (e) {
    console.error('AdMob: Hide Banner failed', e);
  }
};

// ─── INTERSTITIAL (regular) ──────────────────────────────────────────────────
export const prepareInterstitial = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('INTERSTITIAL');
  try {
    console.log(`AdMob: Preparing Interstitial (${adId})`);
    await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
    currentInterstitialSlot = 'INTERSTITIAL';
    console.log('AdMob: ✅ Interstitial ready');
  } catch (e) {
     console.error('AdMob: Prepare Interstitial failed', e);
     currentInterstitialSlot = null;
  }
};

export const showInterstitial = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  try {
    if (currentInterstitialSlot !== 'INTERSTITIAL') {
      console.log('AdMob: No interstitial loaded, preparing first...');
      await prepareInterstitial();
      // Wait a moment for the ad to load
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log('AdMob: Showing Interstitial');
    await AdMob.showInterstitial();
    currentInterstitialSlot = null;
    // Prepare next one
    await prepareInterstitial();
  } catch (e) {
    console.error('AdMob: Show Interstitial failed', e);
    currentInterstitialSlot = null;
    await prepareInterstitial();
  }
};

// ─── APP OPEN (startup) ──────────────────────────────────────────────────────
// Uses the interstitial slot with a different ad ID (App Open test ID)
export const prepareAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    const adId = getAdId('APP_OPEN');
    console.log(`AdMob: Preparing Startup Ad (ID: ${adId})`);
    try {
        await AdMob.prepareInterstitial({ adId, isTesting: IS_TEST_MODE });
        currentInterstitialSlot = 'APP_OPEN';
        console.log('AdMob: ✅ Startup Ad ready');
    } catch (e) {
        console.error('AdMob: Prepare Startup Ad failed', e);
        currentInterstitialSlot = null;
    }
}

export const showAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    try {
        if (currentInterstitialSlot !== 'APP_OPEN') {
            console.log('AdMob: Startup Ad not loaded, preparing...');
            await prepareAppOpen();
            // Give it time to load the ad
            await new Promise(r => setTimeout(r, 3000));
        }
        console.log('AdMob: 🎬 Showing Startup Ad NOW');
        await AdMob.showInterstitial();
        currentInterstitialSlot = null;
        // After startup ad is shown, switch to regular interstitial for future use
        await prepareInterstitial();
    } catch (e) {
        console.warn('AdMob: ⚠️ Startup Ad failed to show', e);
        currentInterstitialSlot = null;
        // Prepare regular interstitial as fallback
        await prepareInterstitial();
    }
}

// ─── PROBABILITY ─────────────────────────────────────────────────────────────
export const showInterstitialWithProbability = async (probability: number = 0.5) => {
    if (Capacitor.getPlatform() === 'web') return;
    if (Math.random() < probability) {
        console.log(`AdMob: Probability ${probability} hit`);
        await showInterstitial();
    } else {
        // Just make sure one is ready for next time
        if (currentInterstitialSlot !== 'INTERSTITIAL') {
            await prepareInterstitial();
        }
    }
}

// ─── REWARD VIDEO ────────────────────────────────────────────────────────────
export const prepareRewardVideo = async () => {
  if (Capacitor.getPlatform() === 'web') return;
  const adId = getAdId('REWARDED');
  try {
    await AdMob.prepareRewardVideoAd({ adId, isTesting: IS_TEST_MODE });
  } catch (e) {
    console.error('AdMob: Prepare Reward Video failed', e);
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
          console.error('AdMob: Show Reward Video failed', e);
          await prepareRewardVideo();
          resolve(null);
      }
  });
};
