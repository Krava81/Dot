import { useState, useCallback } from 'react';
import { storage } from '../services/storage';
import { ButtonTemplate } from '../types';

export function useButtonTemplates(isStandalone: boolean, getCleanBaseUrl: () => string | null, universalFetch: any) {
  const [buttonTemplates, setButtonTemplates] = useState<ButtonTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const loadButtonTemplates = useCallback(async () => {
    setLoading(true);
    try {
      if (isStandalone) {
        let t = await storage.loadJson('templates.json', null);
        if (t === null) {
          t = [{
            id: 'default_template',
            name: 'Пример (Подписка)',
            buttons: [{ id: 'b1', text: '🔥 Подписаться', url: 'https://t.me/' }]
          }];
          await storage.saveJson('templates.json', t);
        }
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

  const saveButtonTemplate = useCallback(async (name: string, buttons: any[]) => {
    if (!name.trim() || buttons.length === 0) return;
    const newTemplate = { id: Date.now().toString(), name, buttons };
    const updated = [...buttonTemplates, newTemplate];
    setButtonTemplates(updated);
    
    try {
      if (isStandalone) {
        await storage.saveJson('templates.json', updated);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/templates/buttons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templates: updated })
        });
      }
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  }, [buttonTemplates, isStandalone, getCleanBaseUrl, universalFetch]);

  const deleteButtonTemplate = useCallback(async (id: string) => {
    const updated = buttonTemplates.filter(t => t.id !== id);
    setButtonTemplates(updated);
    
    try {
      if (isStandalone) {
        await storage.saveJson('templates.json', updated);
      } else {
        const cleanUrl = getCleanBaseUrl();
        if (!cleanUrl) return;
        await universalFetch(`${cleanUrl}/api/posts/templates/buttons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templates: updated })
        });
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  }, [buttonTemplates, isStandalone, getCleanBaseUrl, universalFetch]);

  return {
    buttonTemplates,
    setButtonTemplates,
    loading,
    loadButtonTemplates,
    saveButtonTemplate,
    deleteButtonTemplate
  };
}
