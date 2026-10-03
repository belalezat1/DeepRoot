export type ModelProvider = "gemini" | "azure" | "stub";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateTextRequest = {
  messages: ChatMessage[];
  /** JSON Schema for the reply. When set, the reply text is a JSON document matching it. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
};

export type GenerateTextResult = {
  text: string;
  provider: ModelProvider;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export type TextGenerator = {
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
};
