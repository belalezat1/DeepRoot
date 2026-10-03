// Sends one plain and one structured request through the configured model.
// Run: npm run smoke:generate -w api   (reads api/.env; set MODEL_PROVIDER to compare providers)
import { createTextGenerator } from "../src/adapters/text/index.js";

const generator = createTextGenerator();

const plainStart = Date.now();
const plain = await generator.generateText({
  messages: [
    { role: "system", content: "You are a concise assistant." },
    { role: "user", content: "In one sentence, what is a payroll export?" },
  ],
  maxOutputTokens: 1000,
});
console.log(`plain      ${plain.provider} ${plain.model}  ${Date.now() - plainStart} ms`);
console.log(`           ${plain.text.trim()}`);

const structuredStart = Date.now();
const structured = await generator.generateText({
  messages: [
    { role: "system", content: "Extract commitments. Use null for unknown owners or dates. Never invent them." },
    { role: "user", content: "Rep: We will have the export ready for you by Friday." },
  ],
  responseSchema: {
    type: "object",
    properties: {
      commitments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            owner: { type: ["string", "null"] },
            dueDate: { type: ["string", "null"] },
          },
          required: ["text", "owner", "dueDate"],
        },
      },
    },
    required: ["commitments"],
  },
  temperature: 0,
});
const parsed: unknown = JSON.parse(structured.text);
console.log(`structured ${structured.provider} ${structured.model}  ${Date.now() - structuredStart} ms`);
console.log(`           ${JSON.stringify(parsed)}`);
