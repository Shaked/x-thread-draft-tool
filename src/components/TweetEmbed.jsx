import { useEffect, useRef, useState } from 'react'
import { resolvedTheme, THEME_CHANGE_EVENT } from '../utils/theme'

export default function TweetEmbed({ url }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Bumped when the device scheme changes under the 'system' theme, so the embed re-renders in the new theme.
  const [themeKey, setThemeKey] = useState(0)

  useEffect(() => {
    const onThemeChange = () => setThemeKey((key) => key + 1)
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange)
  }, [])

  // The tweet id comes from the URL during render. An invalid URL is shown as an error below, so no effect sets state for it.
  const tweetId = url ? (url.match(/status\/(\d+)/)?.[1] ?? null) : null
  const invalidUrl = Boolean(url) && !tweetId

  useEffect(() => {
    if (!url || !tweetId) return

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
            theme: resolvedTheme(),
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
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [url, tweetId, themeKey])

  if (!url) return null

  const shownError = invalidUrl ? 'Invalid tweet URL' : error
  if (shownError) {
    return (
      <div className="tweet-embed-error">
        <p>{shownError}</p>
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
