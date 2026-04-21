/**
 * Генерирует миниатюру видео из первого кадра (0.5 сек).
 */
export async function generateVideoThumbnail(videoBase64: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoBase64;
    video.muted = true;
    video.playsInline = true;
    video.currentTime = 0.5;
    
    const timeout = setTimeout(() => {
      video.src = "";
      resolve(null);
    }, 5000);

    video.onloadeddata = () => {
      clearTimeout(timeout);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, 320, 180);
        const thumb = canvas.toDataURL('image/jpeg', 0.7);
        video.src = "";
        resolve(thumb);
      } else {
        video.src = "";
        resolve(null);
      }
    };
    video.onerror = () => {
      clearTimeout(timeout);
      video.src = "";
      resolve(null);
    };
  });
}

/**
 * Оценивает размер base64 строки в байтах.
 */
export const estimateBase64Size = (b64: string): number => {
  if (!b64.includes('base64,')) return b64.length;
  const content = b64.split('base64,')[1];
  return (content.length * 3) / 4;
};
