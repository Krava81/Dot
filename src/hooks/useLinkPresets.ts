import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/storage';

export function useLinkPresets(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [linkPresets, setLinkPresets] = useState<string[]>([]);

  const loadLinkPresets = useCallback(async () => {
    try {
      if (isStandalone) {
        const p = await storage.getSetting('link_presets');
        if (p) setLinkPresets(JSON.parse(p));
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/config/link-presets`);
        if (res.ok) {
          const d = await res.json();
          setLinkPresets(Array.isArray(d) ? d : []);
        }
      }
    } catch (e) {
      console.error('Failed to load link presets:', e);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  const saveLinkPresets = useCallback(async (newPresets: string[]) => {
    setLinkPresets(newPresets);
    try {
      if (isStandalone) {
        await storage.setSetting('link_presets', JSON.stringify(newPresets));
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/config/link-presets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { presets: newPresets }
        });
      }
    } catch (e) {
      console.error('Failed to save link presets:', e);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  useEffect(() => {
    loadLinkPresets();
  }, [loadLinkPresets]);

  return { linkPresets, saveLinkPresets, loadLinkPresets };
}
