import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fantaf1.app',
  appName: 'FantaGP',
  webDir: 'web/dist',
  plugins: {
    CapacitorUpdater: {
      autoUpdate: true,
      directUpdate: false,
      appReadyTimeout: 15000,
      periodCheckDelay: 600,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
    },
  },
};

export default config;
