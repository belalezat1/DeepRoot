/**
 * The analysis model. Implemented by the Azure teammate (Azure-hosted Gemini deployment); the agent
 * only needs this one call. See docs/AZURE_INTEGRATION.md.
 *
 * - Send `system` as the system instruction and `user` as the single user message.
 * - Use temperature 0 and JSON output mode; return the reply text unchanged (a markdown fence is tolerated).
 * - Throw on any service failure (after any retries you choose). The agent turns a throw into
 *   INTEGRATION_UNAVAILABLE (503) and never shows the error text to the user.
 */
export interface ChatModel {
  complete(req: ChatModelRequest): Promise<string>;
}

export type ChatModelRequest = {
  system: string;
  user: string; // contains the account's records as JSON: never log it in full
  maxTokens: number;
};
