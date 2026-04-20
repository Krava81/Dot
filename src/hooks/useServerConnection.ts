import { useState, useEffect, useCallback } from 'react';
import { universalFetch } from '../services/http';

export interface ServerStatus {
  status: 'online' | 'offline';
  bot: 'active' | 'starting' | 'offline';
  botError?: string;
  hasDefaultChat: boolean;
  hasBotToken?: boolean;
  botTokenPreview?: string | null;
  defaultChatId?: string | number;
  preferredProvider?: string;
}

export function useServerConnection(baseUrl: string) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!baseUrl) {
      setLoading(false);
      return;
    }

    try {
      const response = await universalFetch(`${baseUrl}/api/status`);
      
      if (response.ok) {
        setStatus(await response.json() as ServerStatus);
        setError(null);
      } else {
        throw new Error(`Server error: ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, loading, error, refetch: fetchStatus };
}
