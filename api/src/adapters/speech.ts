// Speech adapter: Azure AI Speech fast transcription with speaker diarization.
// Implements the TranscribeAudio contract that api/src/ingest/meeting.ts consumes.
import type { TranscriptSegment } from "@deeproot/shared";
import type { TranscribeAudio } from "../ingest/meeting.js";
import { AdapterError, requestJson } from "./http.js";

const API_VERSION = "2024-11-15";

type FastTranscriptionResponse = {
  phrases?: Array<{ offsetMilliseconds: number; durationMilliseconds: number; text: string; speaker?: number }>;
};

export function createAzureSpeechTranscriber(config: {
  region: string;
  key: string;
  locale?: string;
  /** Upper bound for diarization; the demo meeting has two speakers. */
  maxSpeakers?: number;
}): TranscribeAudio {
  const url = `https://${config.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${API_VERSION}`;
  const definition = JSON.stringify({
    locales: [config.locale ?? "en-US"],
    diarization: { enabled: true, maxSpeakers: config.maxSpeakers ?? 2 },
  });

  return async (audio) => {
    const form = new FormData();
    // Copied so the Blob gets a plain ArrayBuffer (the input may be a view on shared memory).
    form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "meeting.wav");
    form.append("definition", definition);

    const data = (await requestJson(
      "Azure Speech",
      url,
      { method: "POST", headers: { "Ocp-Apim-Subscription-Key": config.key }, body: form },
      { timeoutMs: 30_000, retries: 1 },
    )) as FastTranscriptionResponse;

    if (!data.phrases) throw new AdapterError("Azure Speech returned no phrases", "Azure Speech");
    return data.phrases.map(
      (phrase): TranscriptSegment => ({
        startMs: phrase.offsetMilliseconds,
        endMs: phrase.offsetMilliseconds + phrase.durationMilliseconds,
        // Speech numbers speakers from 1; the demo maps "1" and "2" to names.
        ...(phrase.speaker === undefined ? {} : { speaker: String(phrase.speaker) }),
        text: phrase.text,
      }),
    );
  };
}

/** Offline transcriber. With no segments, ingest falls back to the account's prepared transcript. */
export function createStubTranscriber(segments: TranscriptSegment[] = []): TranscribeAudio {
  return async () => structuredClone(segments);
}
