import type { GenerateTextRequest, TextGenerator } from "./types.js";

/** Offline generator for development and tests. Pass `reply` to return fixture output. */
export function createStubTextGenerator(
  reply: (request: GenerateTextRequest) => string = (request) => (request.responseSchema ? "{}" : "Stub reply."),
): TextGenerator {
  return {
    async generateText(request) {
      return { text: reply(request), provider: "stub", model: "stub" };
    },
  };
}
