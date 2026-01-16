import { useMemo } from 'react'

const MAX_CHARS = 280;
const WARNING_THRESHOLD = 260; // Show warning when approaching limit

export default function CharacterCounter({ text }) {
  const charCount = useMemo(() => text?.length || 0, [text]);
  const isOverLimit = charCount > MAX_CHARS;
  const isWarning = charCount >= WARNING_THRESHOLD && !isOverLimit;

  return (
    <div className={`character-counter ${isOverLimit ? 'over-limit' : ''} ${isWarning ? 'warning' : ''}`}>
      <span className="char-count">{charCount}</span>
      <span className="char-limit">/{MAX_CHARS}</span>
    </div>
  );
}
