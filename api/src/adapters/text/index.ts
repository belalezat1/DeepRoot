// Model adapter used by the AI workflow. MODEL_PROVIDER chooses the backend:
//   gemini - Google Gemini API (default in deployed settings)
//   azure  - Azure OpenAI deployment
//   stub   - offline replies; used when MODEL_PROVIDER is unset, so no credentials are needed
// MODEL_FALLBACK names a second provider to use when the first is overloaded or unreachable.
import { AdapterError } from "../http.js";
import { createAzureOpenAiTextGenerator } from "./azureOpenAi.js";
import { withFallback } from "./fallback.js";
import { createGeminiTextGenerator } from "./gemini.js";
import { createStubTextGenerator } from "./stub.js";
import type { TextGenerator } from "./types.js";

export type * from "./types.js";
export { createAzureOpenAiTextGenerator, createGeminiTextGenerator, createStubTextGenerator, withFallback };

export function createTextGenerator(env: NodeJS.ProcessEnv = process.env): TextGenerator {
  const primary = createProvider(env.MODEL_PROVIDER ?? "stub", env);
  const fallback = env.MODEL_FALLBACK;
  if (!fallback || fallback === env.MODEL_PROVIDER) return primary;
  return withFallback(primary, createProvider(fallback, env));
}

function createProvider(provider: string, env: NodeJS.ProcessEnv): TextGenerator {
  switch (provider) {
    case "gemini":
      return createGeminiTextGenerator({
        apiKey: required(env, "GEMINI_API_KEY"),
        model: env.GEMINI_MODEL ?? "gemini-3.5-flash",
        thinkingLevel: env.GEMINI_THINKING_LEVEL ?? "low",
      });
    case "azure":
      return createAzureOpenAiTextGenerator({
        endpoint: required(env, "AZURE_OPENAI_ENDPOINT"),
        apiKey: required(env, "AZURE_OPENAI_API_KEY"),
        deployment: required(env, "AZURE_OPENAI_DEPLOYMENT"),
        apiVersion: env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
      });
    case "stub":
      return createStubTextGenerator();
    default:
      throw new AdapterError(`Unknown model provider '${provider}'; use gemini, azure or stub`, "config");
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new AdapterError(`${name} is not set`, "config");
  return value;
}
