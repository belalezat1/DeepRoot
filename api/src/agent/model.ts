/**
 * One chat completion against the Azure AI Foundry deployment. Teammate 1 implements this: send
 * `system` and `user` as the two messages, temperature 0, and JSON output mode
 * (response_format: { type: "json_object" }), and return the assistant message text unchanged.
 * Throw on any service failure; the agent turns that into a clean INTEGRATION_UNAVAILABLE error.
 */
export interface ChatModel {
  complete(req: ChatModelRequest): Promise<string>;
}

export type ChatModelRequest = {
  system: string;
  user: string;
  maxTokens: number;
};
