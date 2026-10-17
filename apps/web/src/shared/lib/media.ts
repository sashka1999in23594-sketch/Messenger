/**
 * Подготовка медиа на устройстве перед загрузкой:
 *  • фото уменьшаются и пережимаются (быстрее на мобильном интернете) —
 *    при этом удаляются EXIF-метаданные, включая GPS-координаты (приватность);
 *  • для видео считываются длительность/размеры и снимается кадр-обложка.
 */
import { uploadFile, type UploadOptions } from '../api/client';
import type { MediaItem } from '@omni/shared';

const MAX_SIDE = 2560;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  name: string;
}

export async function prepareImage(file: File, maxSide = MAX_SIDE): Promise<PreparedImage> {
  // GIF оставляем как есть (анимация)
  if (file.type === 'image/gif') {
    const bmp = await createImageBitmap(file);
    return { blob: file, width: bmp.width, height: bmp.height, name: file.name };
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = file.type === 'image/png' && file.size < 1_500_000 ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, 0.86),
  );
  return { blob, width, height, name: file.name.replace(/\.[^.]+$/, type === 'image/png' ? '.png' : '.jpg') };
}

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  poster: Blob | null;
}

export function readVideoMeta(file: File, at = 1): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const done = (meta: VideoMeta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    video.onerror = () => done({ duration: 0, width: 0, height: 0, poster: null });
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(at, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (poster) => done({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, poster }),
        'image/jpeg',
        0.82,
      );
    };
  });
}

/** Полный цикл загрузки файла любого типа (с обработкой фото и обложкой для видео). */
export async function uploadAny(file: File, opts: Pick<UploadOptions, 'onProgress' | 'signal'> = {}): Promise<MediaItem> {
  if (file.type.startsWith('image/')) {
    const img = await prepareImage(file);
    return uploadFile(img.blob, img.name, { ...opts, width: img.width, height: img.height });
  }
  if (file.type.startsWith('video/')) {
    const meta = await readVideoMeta(file);
    let posterId: string | undefined;
    if (meta.poster) posterId = (await uploadFile(meta.poster, 'poster.jpg')).id;
    return uploadFile(file, file.name, { ...opts, width: meta.width, height: meta.height, duration: meta.duration, posterId });
  }
  return uploadFile(file, file.name, opts);
}
