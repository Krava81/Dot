import { useState, useCallback } from 'react';
import { storage } from '../services/standaloneService';
import { DraftPost } from '../types';

export function usePublishedPosts(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [publishedPosts, setPublishedPosts] = useState<DraftPost[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPublishedPosts = useCallback(async () => {
    setLoading(true);
    try {
      if (isStandalone) {
        const p = await storage.loadJson('published.json', []);
        setPublishedPosts(Array.isArray(p) ? p : []);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        const res = await universalFetch(`${cleanUrl}/api/posts/published`);
        if (res.ok) {
          const d = await res.json();
          setPublishedPosts(Array.isArray(d) ? d : []);
        }
      }
    } catch (error) {
      console.error('Failed to load published posts:', error);
    } finally {
      setLoading(false);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  return {
    publishedPosts,
    setPublishedPosts,
    loading,
    loadPublishedPosts
  };
}
