import { useState } from 'react'

/** A button that copies `text` to the clipboard and says whether it worked. */
export default function CopyButton({ text, label = 'Copy' }) {
  const [state, setState] = useState('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <button type="button" className="copy-btn" onClick={copy}>
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

