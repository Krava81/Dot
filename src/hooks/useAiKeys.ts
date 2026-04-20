import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/storage';

export function useAiKeys(isStandalone: boolean) {
    const [aiKeys, setAiKeys] = useState<Record<string, string>>({ github: '', openrouter: '', deepseek: '' });
  const [error, setError] = useState<string | null>(null);

  const loadAiKeys = useCallback(async () => {
    try {
      setError(null);
      if (isStandalone) {
        const [gemini, github, openrouter, deepseek] = await Promise.all([
          storage.getSetting('api_key_gemini'),
          storage.getSetting('api_key_github'),
          storage.getSetting('api_key_openrouter'),
          storage.getSetting('api_key_deepseek')
        ]);
        setAiKeys({
          github: github || '',
          openrouter: openrouter || '',
          deepseek: deepseek || ''
        });
      } else {
        setAiKeys({
          github: localStorage.getItem('server_api_key_github') || '',
          openrouter: localStorage.getItem('server_api_key_openrouter') || '',
          deepseek: localStorage.getItem('server_api_key_deepseek') || ''
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load AI keys');
    }
  }, [isStandalone]);

  const updateAiKey = useCallback(async (key: string, value: string) => {
    setAiKeys(prev => ({ ...prev, [key]: value }));
    if (isStandalone) {
      await storage.setSetting(`api_key_${key}`, value);
    } else {
      localStorage.setItem(`server_api_key_${key}`, value);
    }
  }, [isStandalone]);

  useEffect(() => {
    loadAiKeys();
  }, [loadAiKeys]);

  return {
    aiKeys,
    updateAiKey,
    loadAiKeys,
    error
  };
}
