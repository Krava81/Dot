import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/storage';

export function useLinkPresets(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [linkPresets, setLinkPresets] = useState<string[]>([]);

  const loadLinkPresets = useCallback(async () => {
    try {
      if (isStandalone) {
        console.log("[useLinkPresets] Loading presets (standalone)...");
        const data = await storage.loadJson('link_presets.json', []);
        console.log(`[useLinkPresets] Loaded ${data.length} presets`);
        setLinkPresets(Array.isArray(data) ? data : []);
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
    try {
      console.log(`[useLinkPresets] Saving ${newPresets.length} presets (standalone: ${isStandalone})`);
      setLinkPresets(newPresets);
      if (isStandalone) {
        await storage.saveJson('link_presets.json', newPresets);
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
