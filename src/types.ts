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
}

export interface DraftPost {
  id: string;
  parsedContent?: ParsedContent;
  selectedImages: string[]; // Images selected from parsed content (max 10)
  selectedVideo?: string | null; // Single video allowed
  mainImage?: string; // Single image for the post
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