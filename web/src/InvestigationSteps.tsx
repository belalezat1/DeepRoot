import type { InvestigationStep } from '@deeproot/shared';
export function InvestigationSteps({ steps }: { steps?: InvestigationStep[] }) {
  if (!steps?.length) return null;
  return <details className="investigation-steps"><summary>Evidence investigation · {steps.length} completed steps</summary><ol>{steps.map((step, i) => <li key={i}><span aria-hidden="true">✓</span> {step.label}{step.sourceCount !== undefined && <small> · {step.sourceCount} {step.action === 'verify' ? 'checks' : 'records'}</small>}</li>)}</ol></details>;
}
