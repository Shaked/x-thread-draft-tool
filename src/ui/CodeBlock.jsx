import { useState } from 'react'
import Button from './Button'
import './CodeBlock.css'

// A button that copies `text` and says whether it worked ("Copied!" or "Copy failed").
export function CopyButton({ text, label = 'Copy', onFail }) {
  const [state, setState] = useState('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
      onFail?.()
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={copy}>
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  )
}

// A value the user reads or copies (a token, a command, an address). Long values break anywhere.
export default function CodeBlock({ code, copyLabel, onCopyFail }) {
  return (
    <div className="ui-codeblock">
      <code className="ui-codeblock__code" dir="ltr">{code}</code>
      {copyLabel && <CopyButton text={code} label={copyLabel} onFail={onCopyFail} />}
    </div>
  )
}
