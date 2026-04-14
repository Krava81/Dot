import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/standaloneService';
import { DraftPost } from '../types';

export function useDrafts(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      if (isStandalone) {
        const data = await storage.loadJson('drafts.json', []);
        setDrafts(data);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/posts/drafts`);
        if (res.ok) {
          const d = await res.json();
          setDrafts(Array.isArray(d) ? d : []);
        }
      }
    } catch (error) {
      console.error('Failed to load drafts:', error);
    } finally {
      setLoading(false);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  const saveDraft = useCallback(async (draft: DraftPost) => {
    try {
      if (isStandalone) {
        const currentDrafts = await storage.loadJson('drafts.json', []);
        const exists = currentDrafts.find((d: DraftPost) => d.id === draft.id);
        if (exists) {
          await storage.saveJson('drafts.json', currentDrafts.map((d: DraftPost) => d.id === draft.id ? draft : d));
        } else {
          await storage.saveJson('drafts.json', [...currentDrafts, draft]);
        }
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/drafts`, {
          method: 'POST',
          body: JSON.stringify(draft)
        });
      }
      await loadDrafts();
    } catch (error) {
      console.error('Failed to save draft:', error);
      throw error;
    }
  }, [isStandalone, loadDrafts, getCleanBaseUrl, universalFetch]);

  const deleteDraft = useCallback(async (draftId: string) => {
    try {
      if (isStandalone) {
        const currentDrafts = await storage.loadJson('drafts.json', []);
        await storage.saveJson('drafts.json', currentDrafts.filter((d: DraftPost) => d.id !== draftId));
        
        const currentScheduled = await storage.loadJson('scheduled.json', []);
        await storage.saveJson('scheduled.json', currentScheduled.filter((d: DraftPost) => d.id !== draftId));
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/drafts/${draftId}`, { method: 'DELETE' });
      }
      await loadDrafts();
    } catch (error) {
      console.error('Failed to delete draft:', error);
    }
  }, [isStandalone, loadDrafts, getCleanBaseUrl, universalFetch]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  return {
    drafts,
    setDrafts,
    loading,
    saveDraft,
    deleteDraft,
    reload: loadDrafts
  };
}
