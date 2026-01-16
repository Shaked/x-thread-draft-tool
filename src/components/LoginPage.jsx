import { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleGitHubLogin = async () => {
    try {
      setLoading(true)
      setError(null)

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin
        }
      })

      if (error) throw error
    } catch (err) {
      console.error('Login error:', err)
      setError(err.message || 'Failed to login')
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>X Thread Draft Tool</h1>
          <p>Compose, manage, and export Twitter/X threads with ease</p>
        </div>

        <div className="login-features">
          <div className="feature">
            <span className="feature-icon">✍️</span>
            <span>Compose multi-tweet threads</span>
          </div>
          <div className="feature">
            <span className="feature-icon">📷</span>
            <span>Add images and embed tweets</span>
          </div>
          <div className="feature">
            <span className="feature-icon">💾</span>
            <span>Auto-save and cloud sync</span>
          </div>
          <div className="feature">
            <span className="feature-icon">🔗</span>
            <span>Share drafts with unique links</span>
          </div>
          <div className="feature">
            <span className="feature-icon">📤</span>
            <span>Export to JSON or Markdown</span>
          </div>
        </div>

        <div className="login-action">
          <button
            className="github-login-btn"
            onClick={handleGitHubLogin}
            disabled={loading}
          >
            {loading ? (
              'Redirecting...'
            ) : (
              <>
                <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Sign in with GitHub
              </>
            )}
          </button>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}
        </div>

        <div className="login-footer">
          <p>No sign-up required. Just authenticate with GitHub to start drafting threads.</p>
        </div>
      </div>
    </div>
  )
}
