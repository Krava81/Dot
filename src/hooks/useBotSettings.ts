import { useState, useCallback, useEffect } from 'react';
import { storage } from '../services/storage';

export function useBotSettings(isStandalone: boolean) {
  const [botToken, setBotToken] = useState('');
  const [tempChatId, setTempChatId] = useState('');

  const loadSettings = useCallback(async () => {
    if (isStandalone) {
      const token = await storage.getSecure('bot_token');
      if (token) setBotToken(token);

      const chatId = await storage.getSetting('chat_id');
      if (chatId) setTempChatId(chatId);
    } else {
      const token = localStorage.getItem('server_bot_token');
      if (token) setBotToken(token);
      
      const chatId = localStorage.getItem('server_chat_id');
      if (chatId) setTempChatId(chatId);
    }
  }, [isStandalone]);

  const updateSetting = useCallback(async (key: string, value: string) => {
    if (key.includes('bot_token')) {
      setBotToken(value);
      if (isStandalone) {
        await storage.setSecure('bot_token', value);
      } else {
        localStorage.setItem('server_bot_token', value);
      }
    }
    
    if (key === 'chat_id') {
      setTempChatId(value);
      if (isStandalone) {
        await storage.setSetting(key, value);
      } else {
        localStorage.setItem('server_chat_id', value);
      }
    }
  }, [isStandalone]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return {
    botToken,
    tempChatId,
    updateSetting,
    loadSettings
  };
}
