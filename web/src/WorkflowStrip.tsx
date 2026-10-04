export function WorkflowStrip({ sourceCount, transcriptReady, reportReady, issueCreated, onSources, onMeeting, onReport }: {
  sourceCount: number; transcriptReady: boolean; reportReady: boolean; issueCreated: boolean;
  onSources: () => void; onMeeting: () => void; onReport: () => void;
}) {
  return <div className="workflow-strip" aria-label="Meeting to action workflow">
    <button type="button" onClick={onSources} className="workflow-node is-complete"><span className="workflow-symbol" aria-hidden="true">◎</span><span><strong>Gather</strong><small>{sourceCount} available sources</small></span></button>
    <span className="workflow-connector" aria-hidden="true" />
    <button type="button" onClick={onMeeting} className={`workflow-node ${transcriptReady ? 'is-complete' : ''}`}><span className="workflow-symbol" aria-hidden="true">≋</span><span><strong>Understand</strong><small>{transcriptReady ? 'Transcript ready' : 'Add your meeting'}</small></span></button>
    <span className="workflow-connector" aria-hidden="true" />
    <button type="button" disabled={!reportReady} onClick={onReport} className={`workflow-node ${reportReady ? 'is-complete' : ''}`}><span className="workflow-symbol" aria-hidden="true">✧</span><span><strong>Ground</strong><small>{reportReady ? 'Cited report ready' : 'Review the evidence'}</small></span></button>
    <span className="workflow-connector" aria-hidden="true" />
    <button type="button" disabled={!reportReady} onClick={onReport} className={`workflow-node ${issueCreated ? 'is-complete' : ''}`}><span className="workflow-symbol" aria-hidden="true">↗</span><span><strong>Act</strong><small>{issueCreated ? 'Created in Linear' : 'Approve a next step'}</small></span></button>
  </div>;
}
