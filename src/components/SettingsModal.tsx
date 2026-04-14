import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, X, Smartphone, Globe, RefreshCw, Activity, Save, CheckCircle2, AlertCircle, Key } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isStandalone: boolean;
  setIsStandalone: (val: boolean) => void;
  tempBaseUrl: string;
  setTempBaseUrl: (val: string) => void;
  setBaseUrl: (val: string) => void;
  botToken: string;
  updateSetting: (key: string, value: string) => void;
  serverStatus: any;
  getCleanBaseUrl: (url?: string) => string | null;
  universalFetch: any;
  submitMsg: { type: 'success' | 'error', text: string } | null;
  isSubmitting: boolean;
  isTestingConnection: boolean;
  testConnection: () => void;
  isTestingNet: boolean;
  testNetwork: () => void;
  netTestResult: string | null;
  handleSaveSettings: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, isStandalone, setIsStandalone, tempBaseUrl, setTempBaseUrl, setBaseUrl,
  botToken, updateSetting,
  serverStatus, getCleanBaseUrl, universalFetch, submitMsg, isSubmitting,
  isTestingConnection, testConnection, isTestingNet, testNetwork, netTestResult, handleSaveSettings
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><div className="p-2 bg-blue-500/10 rounded-lg"><Settings className="text-blue-500" size={20} /></div><h3 className="text-xl font-bold">Настройки</h3></div>
            <button onClick={onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-500"><X size={20} /></button>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2"><Smartphone size={10} /> Режим работы</label>
              <div className="flex bg-neutral-800 p-1 rounded-xl border border-neutral-700">
                <button onClick={() => { setIsStandalone(true); localStorage.setItem('setting_is_standalone', 'true'); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${isStandalone ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'text-neutral-500 hover:text-neutral-300'}`}>Standalone (Phone)</button>
                <button onClick={() => { setIsStandalone(false); localStorage.setItem('setting_is_standalone', 'false'); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${!isStandalone ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'text-neutral-500 hover:text-neutral-300'}`}>Server (Web Test)</button>
              </div>
              <p className="text-[10px] text-neutral-500 px-1">
                {isStandalone 
                  ? "Прямое подключение (для телефона). В браузере может блокироваться CORS." 
                  : "Использование сервера как прокси. Подходит для тестирования в AI Studio."}
              </p>
            </div>

            {!isStandalone && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">URL Сервера</label>
                <input type="url" value={tempBaseUrl} onChange={e => { setTempBaseUrl(e.target.value); setBaseUrl(e.target.value); }} placeholder="https://your-app.run.app" className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                <p className="text-[10px] text-neutral-500 px-1">Нужен только для синхронизации фото с ПК и работы в браузере.</p>
              </div>
            )}

            <div className="space-y-4 border-t border-neutral-800 pt-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                  <Key size={10} /> Токен бота
                  {botToken && <span className="ml-auto text-emerald-500 font-mono">Превью: {botToken.substring(0, 5)}...</span>}
                </label>
                <input type="password" value={botToken} onChange={e => updateSetting(isStandalone ? 'standalone_bot_token' : 'server_bot_token', e.target.value)} placeholder="Введите токен бота..." className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm focus:outline-none font-mono" />
              </div>
            </div>
          </div>

          <AnimatePresence>
            {submitMsg && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`p-4 rounded-xl text-sm flex items-center gap-3 ${submitMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {submitMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{submitMsg.text}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col gap-3">
            {!isStandalone && (
              <button onClick={testConnection} disabled={isTestingConnection || !tempBaseUrl} className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 border border-neutral-700">
                {isTestingConnection ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} />} Проверить соединение
              </button>
            )}
            <button onClick={testNetwork} disabled={isTestingNet} className="w-full px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 border border-neutral-700">
              {isTestingNet ? <RefreshCw size={18} className="animate-spin" /> : <Activity size={18} />}
              {netTestResult || 'Тест интернета'}
            </button>
            <button onClick={handleSaveSettings} disabled={isSubmitting} className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20">
              {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
              {isSubmitting ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
