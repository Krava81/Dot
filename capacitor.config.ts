import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.newsbot.manager',
  appName: 'AI News Bot',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    Keyboard: {
      resize: 'body'
    }
  },
};

export default config;
