export default function ThreadPreview({ tweets }) {
  if (!tweets || tweets.length === 0) {
    return (
      <div className="thread-preview">
        <h2>Preview</h2>
        <p className="preview-empty">Start composing to see preview</p>
      </div>
    );
  }

  return (
    <div className="thread-preview">
      <h2>Preview</h2>
      <div className="preview-tweets">
        {tweets.map((tweet, index) => (
          <div
            key={tweet.id}
            className={`preview-tweet ${tweet.isRTL ? 'rtl' : 'ltr'}`}
            dir={tweet.isRTL ? 'rtl' : 'ltr'}
          >
            <div className="preview-tweet-header">
              <span className="preview-tweet-number">{index + 1}/{tweets.length}</span>
              <span className="preview-char-count">{tweet.text.length}/280</span>
            </div>
            <div className="preview-tweet-content">
              {tweet.text || <span className="preview-placeholder">Empty tweet</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
