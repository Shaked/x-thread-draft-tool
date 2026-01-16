import { useState } from 'react'

export default function ShareButton({ draftId }) {
  const [copied, setCopied] = useState(false)

  const shareUrl = `${window.location.origin}/draft/${draftId}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = shareUrl
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (e) {
        console.error('Fallback copy failed:', e)
      }
      document.body.removeChild(textArea)
    }
  }

  return (
    <div className="share-button-container">
      <button
        className="share-btn"
        onClick={handleCopy}
        title="Copy shareable link"
      >
        {copied ? '✓ Copied!' : '🔗 Share'}
      </button>
      {copied && (
        <div className="share-tooltip">
          Link copied! Anyone with this link can view your draft.
        </div>
      )}
    </div>
  )
}
