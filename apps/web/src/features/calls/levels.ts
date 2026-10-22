/**
 * Кто сейчас говорит: уровень звука каждого потока раз в 200 мс. Подсветка
 * говорящего и «главный» участник в раскладке с боковой панелью.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

export const useSpeaking = create<{ ids: Record<string, boolean>; last: string | null }>(() => ({ ids: {}, last: null }));

let ctx: AudioContext | null = null;
const meters = new Map<string, { stream: MediaStream; analyser: AnalyserNode; source: MediaStreamAudioSourceNode; buf: Uint8Array<ArrayBuffer> }>();

function meter(id: string, stream: MediaStream) {
  const cur = meters.get(id);
  if (cur?.stream === stream) return;
  cur?.source.disconnect();
  if (!stream.getAudioTracks().length) return;
  try {
    ctx ??= new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    meters.set(id, { stream, analyser, source, buf: new Uint8Array(new ArrayBuffer(analyser.fftSize)) });
  } catch {
    // нет Web Audio — без подсветки
  }
}

/** Следить за потоками: id участника → поток с его звуком. */
export function useLevels(streams: Record<string, MediaStream | null | undefined>, on: boolean) {
  const key = Object.entries(streams)
    .map(([id, s]) => `${id}:${s?.id ?? ''}:${s?.getAudioTracks().length ?? 0}`)
    .join('|');
  useEffect(() => {
    if (!on) return;
    for (const [id, s] of Object.entries(streams)) if (s) meter(id, s);
    for (const id of [...meters.keys()]) {
      if (!streams[id]) {
        meters.get(id)?.source.disconnect();
        meters.delete(id);
      }
    }
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => {
      const ids: Record<string, boolean> = {};
      let loudest: [string, number] | null = null;
      for (const [id, m] of meters) {
        m.analyser.getByteTimeDomainData(m.buf);
        let sum = 0;
        for (const v of m.buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / m.buf.length);
        if (rms > 6) ids[id] = true;
        if (rms > 6 && (!loudest || rms > loudest[1])) loudest = [id, rms];
      }
      const prev = useSpeaking.getState();
      const changed = Object.keys(ids).length !== Object.keys(prev.ids).length || Object.keys(ids).some((id) => !prev.ids[id]);
      if (changed || (loudest && loudest[0] !== prev.last)) useSpeaking.setState({ ids, last: loudest?.[0] ?? prev.last });
    }, 200);
    return () => window.clearInterval(t);
  }, [on]);

  useEffect(
    () => () => {
      if (on) return;
      for (const m of meters.values()) m.source.disconnect();
      meters.clear();
    },
    [on],
  );
}
