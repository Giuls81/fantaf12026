
import React, { useEffect } from 'react';
import { showBanner, hideBanner } from '../services/admob';

interface AdBannerProps {
  isPremium: boolean;
}

export const AdBanner: React.FC<AdBannerProps> = ({ isPremium }) => {
  useEffect(() => {
    if (!isPremium) {
      showBanner();
    } else {
      hideBanner();
    }

    return () => {
      hideBanner();
    };
  }, [isPremium]);

  return null; // Banner is overlay, no DOM element needed
};
