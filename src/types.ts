export interface PostButton {
  id: string;
  text: string;
  url: string;
}

export interface ParsedContent {
  title: string;
  text: string;
  images: string[];
  video?: string | null;
  thumbnails?: string[]; // Small base64 thumbnails for UI
  mediaFiles?: { name: string, path: string, type: 'image' | 'video' }[];
}

export interface DraftPost {
  id: string;
  parsedContent?: ParsedContent;
  selectedImages: string[]; // These will be thumbnails/icons
  selectedVideo?: string | null;
  mediaPaths?: string[]; // Actual paths on disk
  videoPath?: string | null;
  mainImage?: string; // Thumbnail/icon
  text: string; // AI processed text, editable
  isMarkdown?: boolean;
  buttons: PostButton[];
  status: 'draft' | 'scheduled' | 'published';
  scheduledAt?: number; // Only timestamp
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ButtonTemplate {
  id: string;
  name: string;
  buttons: PostButton[];
}

export interface ScheduledPost extends DraftPost {
  scheduledAt: number;
  status: 'scheduled';
}

export const convertToTimestamp = (dateTime: string): number => {
  return new Date(dateTime).getTime();
};

export interface ServerConfigStatus {
  hasServerKey: boolean;
  serverKeyMasked: string | null;
  apiKeys: Record<string, boolean>;
  preferredProvider: string;
}

export interface PostConstructorProps {
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
  selectedVideo: string | null;
  setSelectedVideo: (val: string | null) => void;
  mainImage: string | null;
  setMainImage: (val: string | null) => void;
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
  openFolderBrowser: (path?: string) => void;
  isBrowserLoading: boolean;
  saveImagePath: () => void;
  handleFolderSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  syncLocalImages: (shouldSavePath?: boolean, overridePath?: string) => void;
  syncedImages: string[];
  mediaPaths: string[];
  setMediaPaths: React.Dispatch<React.SetStateAction<string[]>>;
  videoPath: string | null;
  setVideoPath: (val: string | null) => void;
  isActionInProgress: boolean;
  sensors: any;
  handleDragEnd: (event: any) => void;
  toggleImageSelection: (uri: string) => void;
  scheduleDateTime: string;
  setScheduleDateTime: (val: string) => void;
  saveDraft: (status: 'draft' | 'scheduled') => Promise<string | undefined>;
  handlePublish: () => void;
  submitMsg: { type: 'success' | 'error', text: string } | null;
  linkPresets: string[];
  saveLinkPresets: (presets: string[]) => void;
  SortableImage: React.FC<any>;
  onEnlarge: (url: string) => void;
}
