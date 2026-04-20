import { useState, useCallback } from 'react';
import { storage } from '../services/storage';
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

  const deletePublishedPost = useCallback(async (id: string) => {
    try {
      setPublishedPosts(prev => prev.filter(p => p.id !== id));
      if (isStandalone) {
        const current = await storage.loadJson('published.json', []);
        await storage.saveJson('published.json', current.filter((p: any) => p.id !== id));
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (cleanUrl) await universalFetch(`${cleanUrl}/api/posts/published/${id}`, { method: 'DELETE' });
      }
    } catch (e) { console.error(e); }
  }, [isStandalone, getCleanBaseUrl, universalFetch]);

  const savePublishedPost = useCallback(async (post: DraftPost) => {
    try {
      if (isStandalone) {
        const current = await storage.loadJson('published.json', []);
        const updated = [post, ...current].slice(0, 50); // limit to 50
        await storage.saveJson('published.json', updated);
        setPublishedPosts(updated);
      } else {
        // Сервер обычно сам сохраняет при публикации, но если нужно:
        const cleanUrl = getCleanBaseUrl();
        if (cleanUrl) {
          await universalFetch(`${cleanUrl}/api/posts/published`, {
            method: 'POST',
            body: post
          });
        }
      }
      loadPublishedPosts();
    } catch (e) {
      console.error('Failed to save published post:', e);
    }
  }, [isStandalone, getCleanBaseUrl, universalFetch, loadPublishedPosts]);

  return {
    publishedPosts,
    setPublishedPosts,
    loading,
    loadPublishedPosts,
    savePublishedPost,
    deletePublishedPost
  };
}
