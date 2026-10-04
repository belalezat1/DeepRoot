import type { AgentAnalysis } from "@deeproot/shared";

/**
 * Stored agent analyses, implemented by the Azure teammate. The UI, morning brief, action items, and
 * Linear drafts read the latest one instead of calling the model again.
 *
 * - `save`: retain only the latest AgentAnalysis per account AND createdBy user.
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
  private readonly analyses = new Map<string, AgentAnalysis>();

  async save(analysis: AgentAnalysis) {
    const key = JSON.stringify([analysis.accountId, analysis.createdBy]);
    const current = this.analyses.get(key);
    if (!current || analysis.generatedAt >= current.generatedAt) this.analyses.set(key, structuredClone(analysis));
  }

  async latest(accountId: string, userId: string) {
    const newest = this.analyses.get(JSON.stringify([accountId, userId]));
    return newest ? structuredClone(newest) : null;
  }
}
