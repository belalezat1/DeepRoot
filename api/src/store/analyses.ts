import type { AgentAnalysis } from "@deeproot/shared";

/**
 * Stored agent analyses, implemented by the Azure teammate. The UI, morning brief, action items, and
 * Linear drafts read the latest one instead of calling the model again.
 *
 * - `save`: store the AgentAnalysis as given, keyed by `id`.
 * - `latest`: the newest (by `generatedAt`) for that account AND `createdBy` user, or null. It is
 *   scoped to the user because it was built from their sources. Cosmos example:
 *   SELECT TOP 1 * FROM c WHERE c.accountId = @a AND c.createdBy = @u ORDER BY c.generatedAt DESC
 * - Throw on failure. A failed `save` is logged and the analysis is still returned; a failed `latest`
 *   returns INTEGRATION_UNAVAILABLE (503).
 */
export interface AnalysisStore {
  save(analysis: AgentAnalysis): Promise<void>;
  latest(accountId: string, userId: string): Promise<AgentAnalysis | null>;
}

export class InMemoryAnalysisStore implements AnalysisStore {
  private readonly analyses: AgentAnalysis[] = [];

  async save(analysis: AgentAnalysis) {
    this.analyses.push(structuredClone(analysis));
  }

  async latest(accountId: string, userId: string) {
    const mine = this.analyses.filter((a) => a.accountId === accountId && a.createdBy === userId);
    const newest = mine.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
    return newest ? structuredClone(newest) : null;
  }
}
