import type { ChatModel } from "../../agent/model.js";
import { createTextGenerator } from "./index.js";
import type { TextGenerator } from "./types.js";

/** The analysis agent's ChatModel on top of the configured TextGenerator (Gemini, with Azure OpenAI as fallback). */
export function createChatModel(generator: TextGenerator = createTextGenerator()): ChatModel {
  return {
    async complete(req) {
      const start = Date.now();
      const result = await generator.generateText({
        signal: req.signal,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: 0,
        maxOutputTokens: req.maxTokens,
        responseSchema: { type: "object" },
      });
      // Shows in the Functions log which model answered (Gemini, or the fallback).
      console.info(`ChatModel answered by ${result.provider} ${result.model} in ${Date.now() - start} ms`);
      return result.text;
    },
  };
}
