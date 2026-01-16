export default function ExportOptions({ draft }) {
  const posts = draft?.posts || []

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
    const totalPosts = posts.length
    let text = ''

    posts.forEach((post, index) => {
      if (includeNumbers) {
        text += `${index + 1}/${totalPosts}\n`
      }
      text += post.text
      if (index < posts.length - 1) {
        text += '\n\n'
      }
    })

    try {
      await navigator.clipboard.writeText(text)
      alert(includeNumbers ? 'Thread copied with numbers!' : 'Thread copied!')
    } catch (error) {
      console.error('Copy failed:', error)
      alert('Failed to copy to clipboard')
    }
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="export-options">
        <h2>Export Options</h2>
        <p className="empty-message">No content to export</p>
      </div>
    )
  }

  return (
    <div className="export-options">
      <h2>Export</h2>
      <div className="export-actions">
        <button onClick={exportAsJSON} className="btn btn-secondary">
          📄 JSON
        </button>
        <button onClick={exportAsMarkdown} className="btn btn-secondary">
          📝 Markdown
        </button>
        <button onClick={() => copyToClipboard(false)} className="btn btn-primary">
          📋 Copy
        </button>
        <button onClick={() => copyToClipboard(true)} className="btn btn-primary">
          🔢 Copy (Numbered)
        </button>
      </div>
    </div>
  )
}
