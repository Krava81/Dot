import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/standaloneService';
import { CapacitorHttp } from '@capacitor/core';

export function useImageSync(isStandalone: boolean, getCleanBaseUrl: () => string | null) {
  const [imagePath, setImagePath] = useState('');
  const [isActionInProgress, setIsActionInProgress] = useState(false);
  const [browserPath, setBrowserPath] = useState('');
  const [browserDirs, setBrowserDirs] = useState<{ name: string; path: string }[]>([]);
  const [browserParent, setBrowserParent] = useState<string | null>(null);

  useEffect(() => {
    const loadPath = async () => {
      if (isStandalone) {
        const savedPath = await storage.getSetting('standalone_image_path');
        if (savedPath) setImagePath(savedPath);
      }
    };
    loadPath();
  }, [isStandalone]);

  const saveImagePath = useCallback(async (path: string) => {
    setImagePath(path);
    if (isStandalone) {
      await storage.setSetting('standalone_image_path', path);
    }
  }, [isStandalone]);

  return {
    imagePath,
    setImagePath,
    isActionInProgress,
    browserPath,
    setBrowserPath,
    browserDirs,
    setBrowserDirs,
    browserParent,
    setBrowserParent,
    saveImagePath
  };
}
