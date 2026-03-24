import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.newsbot.manager',
  appName: 'News Bot Manager',
  webDir: 'dist',
  server: {
    allowNavigation: ['*'],
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
