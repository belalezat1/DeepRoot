import { useState } from 'react';
export function CopyButton({ text, label = 'Copy text' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('');
  return <span className="copy-control"><button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setStatus('Copied')).catch(() => setStatus('Copy unavailable. Select the text manually.')); if (!navigator.clipboard) setStatus('Copy unavailable. Select the text manually.'); }}>{label} ↗</button><small role="status">{status}</small></span>;
}
