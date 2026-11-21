// The thread as readable markdown (#352, Task G1): a second text part of the thread tools' results, after the JSON.
// It is the fallback for an app that shows no view or drops structuredContent and _meta: the model and the user read
// the posts here, and the thread view reads them back with textThread (client.js). Each post line is quoted ("> "), so
// no line of a post can look like a post marker or the copy block. The copy block is a fence longer than any backtick
// run in the text, so the text cannot close it.

const oneWord = (value) => typeof value === 'string' && /^\S+$/.test(value)
const textOf = (post) => (typeof post === 'string' ? post : typeof post?.text === 'string' ? post.text : '')

/** The markdown thread for posts (strings or { text, images, embeddedTweet }), a title, and the editor url when saved. */
export function threadText({ title, posts, url, saved }) {
  const total = posts.length
  const name = saved ? ` "${String(title || 'Untitled draft').replace(/\s+/g, ' ').trim()}"` : ''
  const lines = [`Thread${name}, ${total} ${total === 1 ? 'post' : 'posts'}, ${saved ? 'saved as a draft' : 'not saved yet'}.`]
  if (saved && typeof url === 'string') lines.push(`Open: ${url}`)
  posts.forEach((post, i) => {
    lines.push('', `**${i + 1}/${total}**`, ...textOf(post).split('\n').map((line) => (line ? `> ${line}` : '>')))
    // A URL goes in only as one word, so it cannot add a line of its own.
    const images = (Array.isArray(post?.images) ? post.images : []).map((image) => (typeof image === 'string' ? image : image?.url))
    images.filter(oneWord).forEach((image, n) => lines.push(`Image ${n + 1}: ${image}`))
    if (oneWord(post?.embeddedTweet)) lines.push(`Quoted post: ${post.embeddedTweet}`)
  })
  const copy = posts.map(textOf).join('\n\n')
  const longest = Math.max(0, ...(copy.match(/`+/g) || []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  lines.push('', 'Post text to copy:', `${fence}text`, copy, fence)
  return lines.join('\n')
}
