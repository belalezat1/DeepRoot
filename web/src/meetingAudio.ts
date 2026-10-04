import type { TranscribeResponse } from '@deeproot/shared';
import { ApiError } from './model';

/** One upload; matches the backend's MAX_AUDIO_BYTES (api/src/ingest/meeting.ts). Each part stays far below it. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
/**
 * Recordings of any length are sent in parts this long (about 9.6 MB of WAV each), so every upload and
 * every Speech call stays small and finishes well inside the API's request time limit.
 */
export const PART_SECONDS = 5 * 60;

type AudioLike = Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>;

/** Downmix and encode only the decoded audio; video frames never leave the browser. */
export function monoWave(buffer: AudioLike): ArrayBuffer {
  const size = 44 + buffer.length * 2;
  if (!buffer.length || !buffer.numberOfChannels) throw new ApiError('This recording has no usable audio track.', 400);
  if (size > MAX_AUDIO_BYTES) throw new ApiError('The extracted audio exceeds 25 MB. Split the meeting or import its transcript.', 400);
  const bytes = new ArrayBuffer(size), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, size - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size - 44, true);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, c) => sum + c[i], 0) / channels.length));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return bytes;
}

/** Splits decoded audio into consecutive mono WAV parts of at most `partSeconds` each. */
export function splitIntoWaveParts(buffer: AudioLike, partSeconds = PART_SECONDS): ArrayBuffer[] {
  if (!buffer.length || !buffer.numberOfChannels) throw new ApiError('This recording has no usable audio track.', 400);
  const partLength = Math.floor(partSeconds * buffer.sampleRate);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const parts: ArrayBuffer[] = [];
  for (let start = 0; start < buffer.length; start += partLength) {
    const end = Math.min(start + partLength, buffer.length);
    parts.push(monoWave({
      length: end - start,
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      getChannelData: (i) => channels[i].subarray(start, end),
    }));
  }
  return parts;
}

/**
 * Joins the per-part transcriptions into one, shifting each part's segment times by where the part starts.
 * The prepared fallback transcript describes a whole meeting, so if Speech failed on any part of a
 * multi-part recording the result would be wrong: that is reported as an error to retry instead.
 */
export function combineTranscriptions(results: TranscribeResponse[], partSeconds = PART_SECONDS): TranscribeResponse {
  if (results.length === 1) return results[0];
  if (results.some((r) => r.origin !== 'azure-speech')) {
    throw new ApiError('Transcription was unavailable for part of this recording. Please try again or import a transcript.', 503);
  }
  const partMs = partSeconds * 1000;
  return {
    transcript: results.map((r) => r.transcript.trim()).filter(Boolean).join('\n'),
    segments: results.flatMap((r, i) =>
      r.segments.map((s) => ({ ...s, startMs: s.startMs + i * partMs, endMs: s.endMs + i * partMs }))),
    origin: 'azure-speech',
  };
}

/**
 * MP4 is the user-facing format, at any size or length; Azure receives normalized mono PCM, in parts,
 * without a server codec dependency. Only the browser's memory bounds how large a file it can decode.
 */
export async function prepareMeetingAudio(file: File): Promise<File[]> {
  if (!/\.mp4$/i.test(file.name)) throw new ApiError('Choose an MP4 meeting recording.', 400);
  if (!file.size) throw new ApiError('Choose a non-empty MP4 recording.', 400);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 12 || String.fromCharCode(...new Uint8Array(bytes, 4, 4)) !== 'ftyp') throw new ApiError('This file is not an MP4 recording. Renaming another format does not convert it.', 400);
  if (typeof OfflineAudioContext === 'undefined') throw new ApiError('Audio extraction is unavailable in this browser. Use a current browser or import a transcript.', 400);
  try {
    const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
    const base = file.name.replace(/\.mp4$/i, '');
    return splitIntoWaveParts(audio).map((wave, i, all) =>
      new File([wave], all.length === 1 ? `${base}.wav` : `${base}-part${i + 1}.wav`, { type: 'audio/wav' }));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('No supported audio track could be extracted. Use an MP4 with AAC audio or import its transcript.', 400);
  }
}
