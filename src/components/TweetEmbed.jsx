import { useEffect, useRef, useState } from 'react'

export default function TweetEmbed({ url }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Extract tweet ID from URL (derived during render, no effect needed)
  const tweetIdMatch = url ? url.match(/status\/(\d+)/) : null
  const tweetId = tweetIdMatch ? tweetIdMatch[1] : null
  const displayError = url && !tweetId ? 'Invalid tweet URL' : error

  useEffect(() => {
    if (!tweetId) return

    const container = containerRef.current
    let isMounted = true

    // Load Twitter widget script if not already loaded
    if (!window.twttr) {
      const script = document.createElement('script')
      script.src = 'https://platform.twitter.com/widgets.js'
      script.async = true
      script.onload = () => {
        if (isMounted) {
          renderTweet(tweetId)
        }
      }
      script.onerror = () => {
        if (isMounted) {
          setError('Failed to load Twitter widget')
          setLoading(false)
        }
      }
      document.body.appendChild(script)
    } else {
      renderTweet(tweetId)
    }

    function renderTweet(id) {
      if (containerRef.current && isMounted) {
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
          if (isMounted) {
            if (el) {
              setLoading(false)
              setError(null)
            } else {
              setError('Tweet not found or unable to load')
              setLoading(false)
            }
          }
        }).catch((err) => {
          if (isMounted) {
            console.error('Error embedding tweet:', err)
            setError('Failed to embed tweet')
            setLoading(false)
          }
        })
      }
    }

    // Cleanup function
    return () => {
      isMounted = false
      if (container) {
        container.innerHTML = ''
      }
    }
  }, [tweetId])

  if (!url) return null

  if (displayError) {
    return (
      <div className="tweet-embed-error">
        <p>{displayError}</p>
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
