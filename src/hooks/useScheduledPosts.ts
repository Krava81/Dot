import { useState, useCallback } from 'react';
import { storage } from '../services/storage';
import { DraftPost } from '../types';

export function useScheduledPosts(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [scheduledPosts, setScheduledPosts] = useState<DraftPost[]>([]);
  const [loading, setLoading] = useState(false);

  const loadScheduledPosts = useCallback(async () => {
    setLoading(true);
    try {
      if (isStandalone) {
        const s = await storage.loadJson('scheduled.json', []);
        setScheduledPosts(Array.isArray(s) ? s : []);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/posts/scheduled`);
        if (res.ok) {
          const d = await res.json();
          setScheduledPosts(Array.isArray(d) ? d : (Array.isArray(d?.scheduled) ? d.scheduled : []));
        }
      }
    } catch (error) {
      console.error('Failed to load scheduled posts:', error);
    } finally {
      setLoading(false);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  return {
    scheduledPosts,
    setScheduledPosts,
    loading,
    loadScheduledPosts
  };
}
