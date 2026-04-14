import { useState, useCallback } from 'react';
import { storage } from '../services/standaloneService';
import { ButtonTemplate } from '../types';

export function useButtonTemplates(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [buttonTemplates, setButtonTemplates] = useState<ButtonTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const loadButtonTemplates = useCallback(async () => {
    setLoading(true);
    try {
      if (isStandalone) {
        const t = await storage.loadJson('templates.json', []);
        setButtonTemplates(Array.isArray(t) ? t : []);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/posts/templates/buttons`);
        if (res.ok) {
          const d = await res.json();
          setButtonTemplates(Array.isArray(d) ? d : []);
        }
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  return {
    buttonTemplates,
    setButtonTemplates,
    loading,
    loadButtonTemplates
  };
}
