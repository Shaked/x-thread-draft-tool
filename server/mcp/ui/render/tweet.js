// One renderer per capability (#292): the embedded tweet card with its "Open on X" button. Same rules as images.js.
/* global el, linkButton, tr, tweetFrom */

/** The card of a post's embedded tweet; null when the post has none or its URL is not https. */
export function tweetNode(post, open) {
  const tweet = post && typeof post.embeddedTweet === 'string' ? tweetFrom(post.embeddedTweet) : null
  if (!tweet) return null
  return el('section', {}, [el('p', {}, [tweet.label]), linkButton(tr('thread', 'open_on_x'), tweet.href, open)])
}
