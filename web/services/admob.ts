
import { AdMob, BannerAdSize, BannerAdPosition, AdOptions, AdLoadInfo, InterstitialAdPluginEvents } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { ADMOB_IDS, IS_TEST_MODE } from '../constants_ads';

export const initializeAdMob = async () => {
  if (Capacitor.getPlatform() === 'web') return;

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: true,
      testingDevices: IS_TEST_MODE ? ['YOUR_DEVICE_ID'] : undefined, // Add test devices if needed
      initializeForTesting: IS_TEST_MODE,
    });
    console.log('AdMob initialized');
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
  } catch (e) {
    console.error('Show Interstitial failed', e);
    // Try to prepare again for next time
    await prepareInterstitial();
  }
};

export const prepareAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    const adId = Capacitor.getPlatform() === 'android' ? ADMOB_IDS.ANDROID.APP_OPEN : ADMOB_IDS.IOS.APP_OPEN;
    
    try {
        await AdMob.prepareAppOpenAd({
            adId,
            isTesting: IS_TEST_MODE
        });
    } catch (e) {
        console.error('Prepare App Open failed', e);
    }
}

export const showAppOpen = async () => {
    if (Capacitor.getPlatform() === 'web') return;
    try {
        await AdMob.showAppOpenAd();
    } catch (e) {
        console.error('Show App Open failed', e);
    }
}
