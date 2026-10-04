import { ApiError } from './model';

const MAX_BYTES = 25 * 1024 * 1024;
const SAMPLE_RATE = 16_000;
const MAX_SECONDS = Math.floor((MAX_BYTES - 44) / (SAMPLE_RATE * 2));

async function recordingDuration(file: File): Promise<number> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => finish(new ApiError('Could not read this MP4. Try another recording or import its transcript.', 400)), 15_000);
      const finish = (error?: ApiError) => { window.clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; error ? reject(error) : resolve(video.duration); };
      video.onloadedmetadata = () => finish();
      video.onerror = () => finish(new ApiError('This MP4 cannot be read by your browser. Try an MP4 with AAC audio or import its transcript.', 400));
      video.preload = 'metadata'; video.src = url;
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

/** Downmix and encode only the decoded audio; video frames never leave the browser. */
export function monoWave(buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>): ArrayBuffer {
  const size = 44 + buffer.length * 2;
  if (!buffer.length || !buffer.numberOfChannels) throw new ApiError('This recording has no usable audio track.', 400);
  if (size > MAX_BYTES) throw new ApiError('The extracted audio exceeds 25 MB. Split the meeting or import its transcript.', 400);
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

/** MP4 is the user-facing format; Azure receives normalized mono PCM without a server codec dependency. */
export async function prepareMeetingAudio(file: File): Promise<File> {
  if (!/\.mp4$/i.test(file.name)) throw new ApiError('Choose an MP4 meeting recording.', 400);
  if (!file.size || file.size > MAX_BYTES) throw new ApiError('Choose a non-empty MP4 recording under 25 MB.', 400);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength < 12 || String.fromCharCode(...new Uint8Array(bytes, 4, 4)) !== 'ftyp') throw new ApiError('This file is not an MP4 recording. Renaming another format does not convert it.', 400);
  const duration = await recordingDuration(file);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) throw new ApiError('Use a meeting clip under 13 minutes, or split the recording/import its transcript.', 400);
  if (typeof OfflineAudioContext === 'undefined') throw new ApiError('Audio extraction is unavailable in this browser. Use a current browser or import a transcript.', 400);
  try {
    const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
    return new File([monoWave(audio)], file.name.replace(/\.mp4$/i, '.wav'), { type: 'audio/wav' });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('No supported audio track could be extracted. Use an MP4 with AAC audio or import its transcript.', 400);
  }
}
