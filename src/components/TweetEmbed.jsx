import { useEffect, useRef, useState } from 'react'

export default function TweetEmbed({ url }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!url) return

    // Extract tweet ID from URL
    const tweetIdMatch = url.match(/status\/(\d+)/)
    if (!tweetIdMatch) {
      setError('Invalid tweet URL')
      setLoading(false)
      return
    }

    const tweetId = tweetIdMatch[1]

    // Load Twitter widget script if not already loaded
    if (!window.twttr) {
      const script = document.createElement('script')
      script.src = 'https://platform.twitter.com/widgets.js'
      script.async = true
      script.onload = () => {
        renderTweet(tweetId)
      }
      script.onerror = () => {
        setError('Failed to load Twitter widget')
        setLoading(false)
      }
      document.body.appendChild(script)
    } else {
      renderTweet(tweetId)
    }

    function renderTweet(id) {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''

        window.twttr.widgets.createTweet(
          id,
          containerRef.current,
          {
            theme: 'light',
            conversation: 'none',
            cards: 'visible',
            align: 'center'
          }
        ).then((el) => {
          if (el) {
            setLoading(false)
            setError(null)
          } else {
            setError('Tweet not found or unable to load')
            setLoading(false)
          }
        }).catch((err) => {
          console.error('Error embedding tweet:', err)
          setError('Failed to embed tweet')
          setLoading(false)
        })
      }
    }
  }, [url])

  if (!url) return null

  if (error) {
    return (
      <div className="tweet-embed-error">
        <p>{error}</p>
        <a href={url} target="_blank" rel="noopener noreferrer">
          View tweet on X/Twitter
        </a>
      </div>
    )
  }

  return (
    <div className="tweet-embed">
      {loading && (
        <div className="tweet-embed-loading">
          Loading tweet...
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
