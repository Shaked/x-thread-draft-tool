// The thread as readable markdown (#352, Task G1): a second text part of the thread tools' results, after the JSON.
// It is the fallback for an app that shows no view or drops structuredContent and _meta: the model and the user read
// the posts here, and the thread view reads them back with textThread (client.js). Each post line is quoted ("> "), so
// no line of a post can look like a post marker or the copy block. The copy block is a fence longer than any backtick
// run in the text, so the text cannot close it.

import { MARKDOWN_LIMIT, fenced, imageLink, tweetLink } from './render/markdown.js'

const oneWord = (value) => typeof value === 'string' && /^\S+$/.test(value)
const textOf = (post) => (typeof post === 'string' ? post : typeof post?.text === 'string' ? post.text : '')

/** The markdown thread for posts (strings or { text, images, embeddedTweet }), a title, and the editor url when saved. */
export function threadText({ title, posts: all, url, saved }) {
  const total = all.length
  // #293: at most MARKDOWN_LIMIT characters. Show the most posts that fit; the rest become "... n more posts: <editor url>".
  let shown = total
  let text = render(shown)
  while (text.length > MARKDOWN_LIMIT && shown > 0) text = render(--shown)
  return text

  function render(count) {
    const posts = all.slice(0, count)
    const name = saved ? ` "${String(title || 'Untitled draft').replace(/\s+/g, ' ').trim()}"` : ''
    // The header counts the posts written, so the view's parser (client.js) reads a cut thread as it is; the cut says how many are left out.
    const lines = [`Thread${name}, ${count} ${count === 1 ? 'post' : 'posts'}, ${saved ? 'saved as a draft' : 'not saved yet'}.`]
    if (saved && typeof url === 'string') lines.push(`Open: ${url}`)
    posts.forEach((post, i) => {
      lines.push('', `**${i + 1}/${total}**`, ...textOf(post).split('\n').map((line) => (line ? `> ${line}` : '>')))
      // A URL goes in only as one word, so it cannot add a line of its own.
      const images = (Array.isArray(post?.images) ? post.images : []).map((image) => (typeof image === 'string' ? image : image?.url))
      images.filter(oneWord).forEach((image, n) => {
        // A non-Blob image is not written as a url, so the view's parser does not take it for one.
        const link = imageLink(image)
        lines.push(link === 'image' ? `Image ${n + 1} not shown` : `Image ${n + 1}: ${link}`)
      })
      if (tweetLink(post?.embeddedTweet)) lines.push(`Quoted post: ${post.embeddedTweet}`)
    })
    if (count < total) lines.push('', `... ${total - count} more posts: ${typeof url === 'string' ? url : 'open the draft in the editor'}`)
    const copy = posts.map(textOf).join('\n\n')
    lines.push('', 'Post text to copy:', fenced(copy))
    return lines.join('\n')
  }
}
