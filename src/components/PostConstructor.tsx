import React, { useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Edit2, X, Sparkles, ClipboardPaste, Loader2, Wand2, Plus, Trash2, FolderOpen, Folder, Smartphone, RefreshCw, Clock, Send, CheckCircle2, AlertCircle, EyeOff, Image, Hash, Save } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import MarkdownIt from 'markdown-it';
import MdEditor from 'react-markdown-editor-lite';
import 'react-markdown-editor-lite/lib/index.css';
import { PostButton, ParsedContent, DraftPost, ButtonTemplate } from '../types';

const mdParser = new MarkdownIt({
  breaks: true,
  html: true,
  linkify: true
});

// Custom spoiler rule for ||text||
mdParser.inline.ruler.before('text', 'spoiler', (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x7C || state.src.charCodeAt(start + 1) !== 0x7C) return false;
  
  const match = state.src.slice(start + 2).match(/^([\s\S]+?)\|\|/);
  if (!match) return false;
  
  if (!silent) {
    state.push('spoiler_open', 'tg-spoiler', 1);
    const t = state.push('text', '', 0);
    t.content = match[1];
    state.push('spoiler_close', 'tg-spoiler', -1);
  }
  state.pos += 4 + match[1].length;
  return true;
});

const renderPreview = (text: string) => {
  // Replace leading spaces with non-breaking spaces to preserve visual indents
  // without triggering Markdown code block formatting.
  const preprocessed = text.replace(/^[ \t]+/gm, (match) => '&nbsp;'.repeat(match.length));
  return mdParser.render(preprocessed);
};

interface SortableImageProps {
  id: string;
  url: string;
  isMain: boolean;
  onSelect: (url: string) => void;
  onSetMain: (url: string) => void;
  onEnlarge: (url: string) => void;
}

interface PostConstructorProps {
  isOpen: boolean;
  onClose: () => void;
  isConstructorOpen: boolean;
  setIsConstructorOpen: (val: boolean) => void;
  parsedContent: ParsedContent | null;
  setParsedContent: React.Dispatch<React.SetStateAction<ParsedContent | null>>;
  aiProcessedText: string;
  setAiProcessedText: (val: string) => void;
  selectedImages: string[];
  setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>;
  mainImage: string;
  setMainImage: (val: string) => void;
  postButtons: PostButton[];
  setPostButtons: React.Dispatch<React.SetStateAction<PostButton[]>>;
  originalText: string;
  setOriginalText: (val: string) => void;
  isProcessingAI: boolean;
  processAI: () => void;
  showTemplates: boolean;
  setShowTemplates: (val: boolean) => void;
  buttonTemplates: ButtonTemplate[];
  handleDeleteTemplate: (id: string) => void;
  saveButtonTemplate: () => void;
  templateName: string;
  setTemplateName: (val: string) => void;
  imagePath: string;
  setImagePath: (val: string) => void;
  openFolderBrowser: (path: string) => void;
  isBrowserLoading: boolean;
  saveImagePath: () => void;
  handleFolderSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  syncLocalImages: (shouldSavePath?: boolean, overridePath?: string) => void;
  isActionInProgress: boolean;
  sensors: ReturnType<typeof useSensors>;
  handleDragEnd: (event: any) => void;
  toggleImageSelection: (img: string) => void;
  scheduleDateTime: string;
  setScheduleDateTime: (val: string) => void;
  saveDraft: (type: 'draft' | 'scheduled') => void;
  handlePublish: () => void;
  submitMsg: { type: 'success' | 'error', text: string } | null;
  SortableImage: React.FC<SortableImageProps>;
  processedTextRef: React.RefObject<HTMLTextAreaElement | null>;
  onEnlarge: (url: string) => void;
}

export const PostConstructor: React.FC<PostConstructorProps> = (props) => {
  const [activeTab, setActiveTab] = React.useState<'text' | 'images' | 'buttons'>('text');

  const handleEditorChange = React.useCallback(
    ({ text }: { text: string }) => {
      props.setAiProcessedText(text);
    },
    [props.setAiProcessedText]
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-0 md:p-8"
    >
        <div className="bg-neutral-900 w-full max-w-5xl h-full md:h-auto md:max-h-[90vh] overflow-hidden rounded-none md:rounded-3xl border-0 md:border border-neutral-800 shadow-2xl flex flex-col">

          <div className="flex items-center justify-between p-6 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
            <div className="flex items-center gap-3"><Edit2 className="w-6 h-6 text-blue-500" /><h2 className="text-xl font-bold text-white">Конструктор поста</h2></div>
            <button onClick={props.onClose} className="p-2 hover:bg-neutral-800 rounded-full text-neutral-400"><X size={24} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {/* Tabs for Mobile/Desktop */}
            <div className="flex gap-2 border-b border-neutral-800 pb-4 overflow-x-auto no-scrollbar">
              <button onClick={() => setActiveTab('text')} className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'text' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
                <Edit2 size={14} /> Текст
              </button>
              <button onClick={() => setActiveTab('images')} className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'images' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
                <Image size={14} /> Изображения ({props.selectedImages.length})
              </button>
              <button onClick={() => setActiveTab('buttons')} className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'buttons' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
                <Hash size={14} /> Кнопки ({props.postButtons.length})
              </button>
            </div>

            {/* Main Layout Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              
              {/* Left Column: Editor & Preview */}
              <div className={`xl:col-span-8 space-y-6 ${activeTab !== 'text' ? 'hidden xl:block' : ''}`}>
                {/* AI block */}
                <div className="bg-blue-500/5 p-4 rounded-2xl border border-blue-500/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-blue-400 flex items-center gap-2 uppercase tracking-wider"><Sparkles size={14} /> ИИ Обработка</h3>
                    <button onClick={() => { navigator.clipboard.readText().then(text => props.setOriginalText(text)).catch(() => {}); }} className="text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase flex items-center gap-1"><ClipboardPaste size={12} /> Вставить</button>
                  </div>
                  <textarea className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-neutral-600 text-white min-h-[80px]" placeholder="Вставьте текст для обработки..." value={props.originalText} onChange={e => props.setOriginalText(e.target.value)} />
                  <button onClick={props.processAI} disabled={props.isProcessingAI || !props.originalText} className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all text-sm shadow-lg shadow-blue-600/20 active:scale-95">
                    {props.isProcessingAI ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                    {props.isProcessingAI ? 'Обработка...' : 'Обработать'}
                  </button>
                </div>

                {/* Editor Window */}
                <div className="bg-neutral-800/30 rounded-2xl border border-neutral-800 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-800/50">
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Редактор поста</label>
                      <button 
                        onClick={() => {
                          const elList = document.querySelectorAll('textarea');
                          let editor: HTMLTextAreaElement | null = null;
                          for (let i = 0; i < elList.length; i++) {
                            const el = elList[i] as HTMLTextAreaElement;
                            if (el.className.includes('input') || el.closest('.rc-md-editor')) {
                              editor = el;
                              break;
                            }
                          }
                          
                          if (editor) {
                            const start = editor.selectionStart || 0;
                            const end = editor.selectionEnd || 0;
                            const currentText = props.aiProcessedText;
                            
                            if (start !== end) {
                              // Wrap selected text
                              const before = currentText.substring(0, start);
                              const selected = currentText.substring(start, end);
                              const after = currentText.substring(end);
                              props.setAiProcessedText(before + '||' + selected + '||' + after);
                              
                              setTimeout(() => {
                                editor?.focus();
                                editor?.setSelectionRange(start, start + selected.length + 4);
                              }, 10);
                            } else {
                              // Insert placeholder
                              const before = currentText.substring(0, start);
                              const after = currentText.substring(start);
                              const spoiler = '|| ТЕКСТ ||';
                              props.setAiProcessedText(before + spoiler + after);
                              
                              setTimeout(() => {
                                editor?.focus();
                                editor?.setSelectionRange(start + 3, start + 8);
                              }, 10);
                            }
                          } else {
                            // Fallback if textarea not found
                            props.setAiProcessedText(props.aiProcessedText + '\n|| ТЕКСТ ||');
                          }
                        }}
                        className="text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase flex items-center gap-1 px-2 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20"
                      >
                        <EyeOff size={12} /> Спойлер
                      </button>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      props.aiProcessedText.length > 4096 
                      ? 'bg-red-500 text-white' 
                      : 'bg-neutral-700 text-neutral-400'
                    }`}>
                      {props.aiProcessedText.length} / 4096
                    </span>
                  </div>
                  <div className="h-[400px]">
                    <MdEditor
                      ref={(node: any) => (window as any).mdEditor = node}
                      value={props.aiProcessedText}
                      style={{ height: '100%', border: 'none' }}
                      renderHTML={renderPreview}
                      onChange={handleEditorChange}
                      config={{
                        view: { menu: true, md: true, html: true },
                        canView: { menu: true, md: true, html: true, fullScreen: false, hideMenu: false }
                      }}
                      plugins={['font-bold', 'font-italic', 'clear', 'logger', 'mode-toggle']}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Images & Buttons */}
              <div className={`xl:col-span-4 space-y-6 ${activeTab === 'text' ? 'hidden xl:block' : ''}`}>
                {/* Images Window */}
                <div className={`bg-neutral-800/30 rounded-2xl border border-neutral-800 overflow-hidden flex flex-col ${activeTab !== 'images' ? 'hidden xl:flex' : ''}`}>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-800/50">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Изображения ({props.selectedImages.length})</label>
                    <button onClick={() => props.syncLocalImages(true)} className="text-blue-400 hover:text-blue-300"><RefreshCw size={14} className={props.isActionInProgress ? 'animate-spin' : ''} /></button>
                  </div>
                  <div className="p-4 space-y-4 flex-1 overflow-y-auto min-h-0">
                    <div className="space-y-4">
                      <div className="bg-neutral-900/50 p-3 rounded-xl border border-neutral-800 space-y-2">
                        <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                          <Folder size={12} className="text-blue-500" /> Путь к папке
                        </label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={props.imagePath} 
                            onChange={e => props.setImagePath(e.target.value)} 
                            placeholder="DCIM/Camera" 
                            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/50 font-mono text-white" 
                          />
                          <button onClick={props.saveImagePath} className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg border border-neutral-700 transition-colors">
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <DndContext sensors={props.sensors} collisionDetection={closestCenter} onDragEnd={props.handleDragEnd}>
                          <SortableContext items={props.selectedImages} strategy={rectSortingStrategy}>
                            {props.selectedImages.map(img => (
                              <props.SortableImage 
                                key={img} 
                                id={img} 
                                url={img} 
                                isMain={props.mainImage === img} 
                                onSelect={props.toggleImageSelection} 
                                onSetMain={props.setMainImage} 
                                onEnlarge={props.onEnlarge} 
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                        <label htmlFor="image-upload-modal" className="aspect-square rounded-xl border-2 border-dashed border-neutral-800 hover:border-blue-500/50 hover:bg-blue-500/5 flex flex-col items-center justify-center gap-1 text-neutral-600 hover:text-blue-400 cursor-pointer transition-all">
                          <input type="file" accept="image/*" multiple className="hidden" id="image-upload-modal" onChange={e => {
                            if (!e.target.files) return;
                            Array.from(e.target.files as Iterable<File>).forEach(file => {
                              const reader = new FileReader();
                              reader.onload = ev => {
                                const b64 = ev.target?.result as string;
                                props.setParsedContent(prev => prev ? { ...prev, images: [...prev.images, b64] } : { title: '', text: '', images: [b64] });
                                props.setSelectedImages(prev => [...prev, b64]);
                                if (!props.mainImage) props.setMainImage(b64);
                              };
                              reader.readAsDataURL(file);
                            });
                          }} />
                          <Plus size={16} /><span className="text-[8px] font-bold uppercase">Файл</span>
                        </label>
                      </div>
                    </div>

                    {(props.parsedContent?.images?.length || 0) > 0 && (
                      <div className="pt-4 border-t border-neutral-800">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">Галерея ({props.parsedContent?.images.length})</div>
                          {props.isActionInProgress && <Loader2 size={12} className="animate-spin text-blue-500" />}
                        </div>
                        <div className="grid grid-cols-6 gap-1.5 max-h-[300px] overflow-y-auto pr-2">
                          {props.parsedContent?.images.map((img, idx) => {
                            const isSelected = props.selectedImages.includes(img);
                            return (
                              <div 
                                key={idx} 
                                onClick={() => props.toggleImageSelection(img)} 
                                className={`aspect-square rounded-lg border overflow-hidden cursor-pointer transition-all group relative ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-neutral-800 hover:border-neutral-600'}`}
                              >
                                <img src={img} alt="Available" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                {isSelected && (
                                  <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                    <div className="bg-blue-500 text-white rounded-full p-0.5"><CheckCircle2 size={10} /></div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Buttons Window */}
                <div className={`bg-neutral-800/30 rounded-2xl border border-neutral-800 overflow-hidden flex flex-col ${activeTab !== 'buttons' ? 'hidden xl:flex' : ''}`}>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-800/50">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Кнопки ({props.postButtons.length})</label>
                    <button onClick={() => props.setPostButtons([...props.postButtons, { id: Date.now().toString(), text: 'Кнопка', url: 'https://' }])} className="text-blue-400 hover:text-blue-300"><Plus size={16} /></button>
                  </div>
                  <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
                    {props.postButtons.map((btn, idx) => (
                      <div key={idx} className="flex gap-2 items-start bg-neutral-900/50 p-2 rounded-xl border border-neutral-800">
                        <div className="flex-1 space-y-1">
                          <input value={btn.text} onChange={e => { const nb = [...props.postButtons]; nb[idx].text = e.target.value; props.setPostButtons(nb); }} placeholder="Текст" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[10px] focus:outline-none text-white" />
                          <input value={btn.url} onChange={e => { const nb = [...props.postButtons]; nb[idx].url = e.target.value; props.setPostButtons(nb); }} placeholder="URL" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[9px] focus:outline-none font-mono text-blue-400" />
                        </div>
                        <button onClick={() => props.setPostButtons(props.postButtons.filter((_, i) => i !== idx))} className="p-1 text-neutral-600 hover:text-red-400"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {props.postButtons.length === 0 && <p className="text-center py-2 text-neutral-600 text-[10px] italic">Нет кнопок</p>}
                  </div>

                  {/* Templates Section */}
                  <div className="border-t border-neutral-800 p-4 space-y-3 bg-neutral-900/20">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                        <Save size={12} className="text-blue-500" /> Шаблоны кнопок
                      </label>
                      <button 
                        onClick={() => props.setShowTemplates(!props.showTemplates)} 
                        className="text-blue-400 text-[10px] font-bold uppercase hover:underline"
                      >
                        {props.showTemplates ? 'Скрыть' : 'Показать'}
                      </button>
                    </div>
                    
                    <AnimatePresence>
                      {props.showTemplates && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }} 
                          animate={{ height: 'auto', opacity: 1 }} 
                          exit={{ height: 0, opacity: 0 }} 
                          className="space-y-3 overflow-hidden"
                        >
                          <div className="flex gap-2 p-1">
                            <input 
                              value={props.templateName} 
                              onChange={e => props.setTemplateName(e.target.value)} 
                              placeholder="Название шаблона" 
                              className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none text-white focus:border-blue-500/50" 
                            />
                            <button 
                              onClick={props.saveButtonTemplate} 
                              disabled={!props.templateName || props.postButtons.length === 0} 
                              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 transition-colors shadow-lg shadow-blue-600/10"
                            >
                              Сохранить
                            </button>
                          </div>
                          
                          <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
                            {props.buttonTemplates.map(t => (
                              <div key={t.id} className="flex items-center justify-between bg-neutral-900/80 border border-neutral-800 p-2 rounded-lg group hover:border-neutral-700 transition-colors">
                                <span className="text-[10px] text-neutral-300 truncate font-medium">{t.name}</span>
                                <div className="flex gap-1">
                                  <button 
                                    onClick={() => props.setPostButtons(t.buttons)} 
                                    className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors"
                                    title="Применить"
                                  >
                                    <ClipboardPaste size={12} />
                                  </button>
                                  <button 
                                    onClick={() => props.handleDeleteTemplate(t.id)} 
                                    className="p-1.5 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                    title="Удалить"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                            {props.buttonTemplates.length === 0 && (
                              <p className="text-center py-4 text-neutral-600 text-[9px] uppercase tracking-wider">Нет сохраненных шаблонов</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-6 pt-6 border-t border-neutral-800">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Дата публикации</label>
                  <input type="datetime-local" value={props.scheduleDateTime} onChange={e => props.setScheduleDateTime(e.target.value)} className="bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2 text-sm focus:outline-none text-white" />
                </div>
                <button onClick={() => props.saveDraft('scheduled')} disabled={!props.scheduleDateTime || props.isActionInProgress} className="mt-5 px-6 py-2.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-bold rounded-xl flex items-center gap-2 disabled:opacity-50 text-sm"><Clock size={18} /> Запланировать</button>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => props.saveDraft('draft')} disabled={props.isActionInProgress} className="px-6 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl disabled:opacity-50 text-sm">В черновики</button>
                <button onClick={props.handlePublish} disabled={props.isActionInProgress} className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-2 disabled:opacity-50 text-sm shadow-lg shadow-emerald-500/20"><Send size={18} /> Опубликовать</button>
              </div>
            </div>

            {props.submitMsg && (
              <div className={`p-4 rounded-xl text-sm flex items-center gap-3 ${props.submitMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {props.submitMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                {props.submitMsg.text}
              </div>
            )}
          </div>
        </div>
      </motion.div>
  );
};
