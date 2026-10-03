import { AdapterError, postJson } from "../http.js";
import type { GenerateTextResult, TextGenerator } from "./types.js";

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function createAzureOpenAiTextGenerator(config: {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}): TextGenerator {
  const url =
    `${config.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(config.deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;

  return {
    async generateText(request): Promise<GenerateTextResult> {
      const body = {
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        ...(request.responseSchema
          ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: request.responseSchema } } }
          : {}),
      };

      const data = (await postJson("Azure OpenAI", url, { "api-key": config.apiKey }, body)) as ChatCompletionResponse;

      const choice = data.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new AdapterError("Azure OpenAI reply was cut off at maxOutputTokens", "Azure OpenAI");
      }
      const text = choice?.message?.content;
      if (!text) {
        const reason = choice?.message?.refusal ?? choice?.finish_reason ?? "unknown";
        throw new AdapterError(`Azure OpenAI returned no text (reason: ${reason})`, "Azure OpenAI");
      }

      return {
        text,
        provider: "azure",
        model: data.model ?? config.deployment,
        usage: data.usage && {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        },
      };
    },
  };
}
