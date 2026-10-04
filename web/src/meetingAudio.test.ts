// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { combineTranscriptions, monoWave, prepareMeetingAudio, splitIntoWaveParts } from './meetingAudio';

describe('MP4 audio preparation', () => {
  it('writes valid mono PCM headers and downmixes/clamps stereo samples', () => {
    const wave = monoWave({ length: 3, sampleRate: 16000, numberOfChannels: 2, getChannelData: i => new Float32Array(i ? [1, -1, .5] : [1, -1, -.5]) });
    const bytes = new Uint8Array(wave), view = new DataView(wave);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1); expect(view.getUint32(24, true)).toBe(16000);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([32767, -32768, 0]);
  });
  it('rejects unsupported/empty input and oversized decoded audio', async () => {
    await expect(prepareMeetingAudio(new File([], 'meeting.mp4'))).rejects.toMatchObject({ status: 400 });
    await expect(prepareMeetingAudio(new File(['not MP4'], 'meeting.wav'))).rejects.toMatchObject({ status: 400 });
    expect(() => monoWave({ length: 14000000, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => new Float32Array() })).toThrow(/25 MB/);
  });
  it('has no MP4 size limit: a very large file is only checked for being a real MP4', async () => {
    const huge = Object.defineProperty(new File(['not MP4'], 'meeting.mp4'), 'size', { value: 5 * 1024 ** 3 });
    await expect(prepareMeetingAudio(huge)).rejects.toThrow(/not an MP4/);
  });
  it('splits long audio into parts that each fit one upload', () => {
    // 12 minutes at 16 kHz in 5-minute parts: 5 + 5 + 2 minutes.
    const samples = new Float32Array(12 * 60 * 16000);
    const parts = splitIntoWaveParts({ length: samples.length, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => samples });
    expect(parts.map((p) => (p.byteLength - 44) / 2 / 16000 / 60)).toEqual([5, 5, 2]);
    // A 2-hour recording still produces parts small enough for the 25 MB upload check.
    const long = new Float32Array(2 * 60 * 60 * 16000);
    const longParts = splitIntoWaveParts({ length: long.length, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => long });
    expect(longParts).toHaveLength(24);
    expect(Math.max(...longParts.map((p) => p.byteLength))).toBeLessThan(25 * 1024 * 1024);
  });
  it('joins part transcriptions with segment times shifted to the whole recording', () => {
    const part = (text: string, startMs: number) => ({ transcript: text, segments: [{ startMs, endMs: startMs + 1000, speaker: '1', text }], origin: 'azure-speech' as const });
    const joined = combineTranscriptions([part('Maya: first', 0), part('Sam: second', 500)], 300);
    expect(joined.transcript).toBe('Maya: first\nSam: second');
    expect(joined.segments.map((s) => s.startMs)).toEqual([0, 300_500]);
    expect(joined.origin).toBe('azure-speech');
  });
  it('treats a Speech failure on any part of a long recording as an error, not a prepared transcript', () => {
    const ok = { transcript: 'a', segments: [], origin: 'azure-speech' as const };
    const fallback = { transcript: 'prepared', segments: [], origin: 'prepared-fallback' as const };
    expect(() => combineTranscriptions([ok, fallback])).toThrow(/part of this recording/);
    expect(combineTranscriptions([fallback])).toBe(fallback);
  });
});
