/**
 * Определение типа файла по сигнатуре содержимого («магическим байтам»),
 * а не по расширению или заголовку клиента — их легко подделать.
 */
import type { MediaKind } from '@omni/shared';

export interface Sniffed {
  mime: string;
  kind: MediaKind;
  ext: string;
}

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

export function sniff(head: Buffer): Sniffed | null {
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', kind: 'image', ext: 'jpg' };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: 'image/png', kind: 'image', ext: 'png' };
  if (/^GIF8[79]a/.test(ascii(head, 0, 6))) return { mime: 'image/gif', kind: 'image', ext: 'gif' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'image', ext: 'webp' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return { mime: 'audio/wav', kind: 'audio', ext: 'wav' };
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', ext: 'mov' };
    if (/^(M4A |M4B )/.test(brand)) return { mime: 'audio/mp4', kind: 'audio', ext: 'm4a' };
    if (/^(heic|heix|mif1|msf1|avif)/.test(brand)) return null; // HEIC/AVIF — конвертируется на клиенте
    return { mime: 'video/mp4', kind: 'video', ext: 'mp4' };
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return { mime: 'video/webm', kind: 'video', ext: 'webm' };
  if (ascii(head, 0, 4) === 'OggS') return { mime: 'audio/ogg', kind: 'audio', ext: 'ogg' };
  if (ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0))
    return { mime: 'audio/mpeg', kind: 'audio', ext: 'mp3' };
  if (ascii(head, 0, 5) === '%PDF-') return { mime: 'application/pdf', kind: 'file', ext: 'pdf' };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)
    return { mime: 'application/zip', kind: 'file', ext: 'zip' };
  return null;
}

/** Размеры изображения из заголовка файла (без декодирования). */
export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif' && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp' && buf.length >= 30) {
      const chunk = ascii(buf, 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    if (mime === 'image/jpeg') {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) return null;
        const marker = buf[off + 1]!;
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}
