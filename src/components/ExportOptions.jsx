import { useRef, useState } from 'react'
import { exportAsNumberedText, exportAsPlainText } from '../utils/exportFormats.js'
import { useDismiss } from '../utils/useDismiss'

/** Export: a button with a menu of copy and download actions for the whole thread. */
export default function ExportOptions({ draft }) {
  const posts = draft?.posts || []
  const [open, setOpen] = useState(false)
  const container = useRef(null)
  useDismiss(open, container, setOpen)

  const exportAsJSON = () => {
    const dataStr = JSON.stringify({
      title: draft.title,
      posts: posts,
      exportedAt: new Date().toISOString()
    }, null, 2)

    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${draft.title || 'thread'}-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportAsMarkdown = () => {
    const totalPosts = posts.length
    let markdown = `# ${draft.title || 'Thread'}\n\n`

    posts.forEach((post, index) => {
      markdown += `## ${index + 1}/${totalPosts}\n\n`
      markdown += `${post.text}\n\n`

      if (post.images && post.images.length > 0) {
        post.images.forEach((img, imgIndex) => {
          const imageUrl = typeof img === 'string' ? img : img.url
          const sourceUrl = typeof img === 'object' ? img.sourceUrl : null
          markdown += `![Image ${imgIndex + 1}](${imageUrl})\n`
          if (sourceUrl) {
            markdown += `<!-- Source: ${sourceUrl} -->\n`
          }
        })
        markdown += '\n'
      }

      if (post.embeddedTweet) {
        markdown += `> Embedded Tweet: ${post.embeddedTweet}\n\n`
      }
    })

    markdown += `---\n\n*Exported on ${new Date().toLocaleString()}*`

    const dataBlob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${draft.title || 'thread'}-${Date.now()}.md`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = async (includeNumbers = false) => {
    const text = includeNumbers ? exportAsNumberedText(posts) : exportAsPlainText(posts)

    try {
      await navigator.clipboard.writeText(text)
      alert(includeNumbers ? 'Thread copied with numbers!' : 'Thread copied!')
    } catch (error) {
      console.error('Copy failed:', error)
      alert('Failed to copy to clipboard')
    }
  }

  const ACTIONS = [
    ['Copy thread', () => copyToClipboard(false)],
    ['Copy with numbers', () => copyToClipboard(true)],
    ['Download Markdown', exportAsMarkdown],
    ['Download JSON', exportAsJSON]
  ]

  return (
    <div className="share-button-container" ref={container}>
      <button
        className="share-btn icon-btn"
        onClick={() => setOpen(!open)}
        disabled={posts.length === 0}
        aria-haspopup="dialog"
        aria-controls="export-menu"
        aria-expanded={open}
        title="Copy or download the whole thread"
        aria-label="Export"
      >
        <span className="btn-icon">⬇</span>
        <span className="btn-text">Export</span>
      </button>
      {open && (
        <div className="share-menu" id="export-menu" role="group" aria-label="Export">
          {ACTIONS.map(([label, run]) => (
            <button
              key={label}
              className="share-menu-item"
              onClick={() => {
                setOpen(false)
                run()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
