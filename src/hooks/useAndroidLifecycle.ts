import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Хук для отслеживания жизненного цикла приложения на Android.
 * Позволяет выполнять действия при сворачивании и разворачивании приложения.
 */
export function useAndroidLifecycle(onPause?: () => void, onResume?: () => void) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Слушатель изменения состояния приложения
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        if (onResume) onResume();
      } else {
        if (onPause) onPause();
      }
    });

    // Слушатель кнопки "Назад" (опционально, можно расширить)
    const backListener = App.addListener('backButton', () => {
      // Можно добавить логику закрытия модалок
    });

    return () => {
      listener.then(l => l.remove());
      backListener.then(l => l.remove());
    };
  }, [onPause, onResume]);
}
