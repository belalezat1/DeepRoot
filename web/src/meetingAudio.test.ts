// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { monoWave, prepareMeetingAudio } from './meetingAudio';

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
});
