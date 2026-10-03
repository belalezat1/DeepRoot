import type { ChatModel } from "../../agent/model.js";
import { createTextGenerator } from "./index.js";
import type { TextGenerator } from "./types.js";

/** The analysis agent's ChatModel on top of the configured TextGenerator (Gemini, with Azure OpenAI as fallback). */
export function createChatModel(generator: TextGenerator = createTextGenerator()): ChatModel {
  return {
    async complete(req) {
      const result = await generator.generateText({
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: 0,
        maxOutputTokens: req.maxTokens,
        responseSchema: { type: "object" },
      });
      return result.text;
    },
  };
}
