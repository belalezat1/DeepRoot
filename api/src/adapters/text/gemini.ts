import { AdapterError, postJson } from "../http.js";
import type { GenerateTextResult, TextGenerator } from "./types.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiPart = { text?: string; thought?: boolean };

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
};

export function createGeminiTextGenerator(config: {
  apiKey: string;
  model: string;
  /** Gemini 3 reasoning depth: minimal, low, medium or high. Hidden reasoning adds latency and uses output tokens. */
  thinkingLevel?: string;
}): TextGenerator {
  return {
    async generateText(request): Promise<GenerateTextResult> {
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const contents = request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        }));

      const body = {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          ...(config.thinkingLevel ? { thinkingConfig: { thinkingLevel: config.thinkingLevel } } : {}),
          ...(request.responseSchema
            ? { responseMimeType: "application/json", responseJsonSchema: request.responseSchema }
            : {}),
        },
      };

      // The key goes in a header so it never appears in URLs or error messages.
      const data = (await postJson(
        "Gemini",
        `${GEMINI_BASE_URL}/models/${encodeURIComponent(config.model)}:generateContent`,
        { "x-goog-api-key": config.apiKey },
        body,
      )) as GeminiResponse;

      const candidate = data.candidates?.[0];
      // A cut-off reply would be passed on as if complete, and cut-off JSON fails to parse.
      if (candidate?.finishReason === "MAX_TOKENS") {
        throw new AdapterError("Gemini reply was cut off at maxOutputTokens", "Gemini");
      }
      const text = (candidate?.content?.parts ?? [])
        .filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("");
      if (!text) {
        const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown";
        throw new AdapterError(`Gemini returned no text (reason: ${reason})`, "Gemini");
      }

      return {
        text,
        provider: "gemini",
        model: data.modelVersion ?? config.model,
        usage: data.usageMetadata && {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}
