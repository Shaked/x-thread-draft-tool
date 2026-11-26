import { describe, expect, it } from 'vitest'
import { idsFromTheirs, mergeDraftEdits } from '../../src/utils/draftMerge.js'

const post = (id, text, extra = {}) => ({ id, text, images: [], embeddedTweet: null, ...extra })
const draft = (posts, title = 'T') => ({ id: 'd', title, version: 1, posts })
const BASE = draft([post('a', 'A'), post('b', 'B'), post('c', 'C')])
const withText = (d, id, text) => ({ ...d, posts: d.posts.map((p) => (p.id === id ? { ...p, text } : p)) })

describe('mergeDraftEdits (#474)', () => {
  it('keeps both edits when the two sides changed different posts', () => {
    const merged = mergeDraftEdits(BASE, withText(BASE, 'a', 'A mine'), withText(BASE, 'c', 'C theirs'))
    expect(merged.posts.map((p) => p.text)).toEqual(['A mine', 'B', 'C theirs'])
    expect(merged.title).toBe('T')
  })

  it('refuses when both sides changed the same post, even to the same text', () => {
    expect(mergeDraftEdits(BASE, withText(BASE, 'b', 'x'), withText(BASE, 'b', 'y'))).toBeNull()
    expect(mergeDraftEdits(BASE, withText(BASE, 'b', 'same'), withText(BASE, 'b', 'same'))).toBeNull()
  })

  it('compares images and the embedded tweet too, not only the text', () => {
    const mineImages = { ...BASE, posts: [post('a', 'A', { images: [{ url: '/u/1' }] }), BASE.posts[1], BASE.posts[2]] }
    const theirImages = { ...BASE, posts: [post('a', 'A', { embeddedTweet: 'https://x.com/a/status/1' }), BASE.posts[1], BASE.posts[2]] }
    expect(mergeDraftEdits(BASE, mineImages, theirImages)).toBeNull()
    const merged = mergeDraftEdits(BASE, mineImages, withText(BASE, 'c', 'C theirs'))
    expect(merged.posts[0].images).toEqual([{ url: '/u/1' }])
    expect(merged.posts[2].text).toBe('C theirs')
  })

  it('merges one title change with an edit of a post, from either side', () => {
    expect(mergeDraftEdits(BASE, { ...BASE, title: 'Mine' }, withText(BASE, 'b', 'B theirs'))).toMatchObject({ title: 'Mine' })
    expect(mergeDraftEdits(BASE, withText(BASE, 'b', 'B mine'), { ...withText(BASE, 'c', 'C theirs'), title: 'Theirs' })).toMatchObject({
      title: 'Theirs'
    })
  })

  it('refuses when both sides changed the title', () => {
    expect(mergeDraftEdits(BASE, { ...BASE, title: 'Mine' }, { ...BASE, title: 'Theirs' })).toBeNull()
    expect(mergeDraftEdits(BASE, { ...BASE, title: 'Same' }, { ...BASE, title: 'Same' })).toBeNull()
  })

  it('refuses when both sides moved, added or removed posts', () => {
    const swapped = { ...BASE, posts: [BASE.posts[1], BASE.posts[0], BASE.posts[2]] }
    const reversed = { ...BASE, posts: [...BASE.posts].reverse() }
    expect(mergeDraftEdits(BASE, swapped, reversed)).toBeNull()
    expect(mergeDraftEdits(BASE, { ...BASE, posts: [...BASE.posts, post('m', 'M')] }, { ...BASE, posts: [...BASE.posts, post('t', 'T')] })).toBeNull()
    expect(mergeDraftEdits(BASE, { ...BASE, posts: BASE.posts.slice(1) }, { ...BASE, posts: BASE.posts.slice(0, 2) })).toBeNull()
  })

  it('merges a post their side added with my edit of another post, in their order', () => {
    const theirs = { ...BASE, posts: [BASE.posts[0], post('n', 'New'), BASE.posts[1], BASE.posts[2]] }
    const merged = mergeDraftEdits(BASE, withText(BASE, 'c', 'C mine'), theirs)
    expect(merged.posts.map((p) => [p.id, p.text])).toEqual([['a', 'A'], ['n', 'New'], ['b', 'B'], ['c', 'C mine']])
  })

  it('merges a post I added or moved with their edit of another post, in my order', () => {
    const mine = { ...BASE, posts: [BASE.posts[2], BASE.posts[0], BASE.posts[1], post('n', 'New')] }
    const merged = mergeDraftEdits(BASE, mine, withText(BASE, 'b', 'B theirs'))
    expect(merged.posts.map((p) => [p.id, p.text])).toEqual([['c', 'C'], ['a', 'A'], ['b', 'B theirs'], ['n', 'New']])
  })

  it('refuses when one side removed a post the other side edited', () => {
    expect(mergeDraftEdits(BASE, { ...BASE, posts: BASE.posts.slice(0, 2) }, withText(BASE, 'c', 'C theirs'))).toBeNull()
    expect(mergeDraftEdits(BASE, withText(BASE, 'c', 'C mine'), { ...BASE, posts: BASE.posts.slice(0, 2) })).toBeNull()
  })

  it('merges a removal with an edit of a different post', () => {
    const merged = mergeDraftEdits(BASE, withText(BASE, 'a', 'A mine'), { ...BASE, posts: BASE.posts.slice(0, 2) })
    expect(merged.posts.map((p) => [p.id, p.text])).toEqual([['a', 'A mine'], ['b', 'B']])
  })

  it('refuses a draft whose posts have no id or a repeated id', () => {
    const noId = { ...BASE, posts: [{ text: 'x' }, BASE.posts[1]] }
    expect(mergeDraftEdits(noId, noId, noId)).toBeNull()
    const repeated = { ...BASE, posts: [BASE.posts[0], BASE.posts[0]] }
    expect(mergeDraftEdits(BASE, repeated, BASE)).toBeNull()
    expect(mergeDraftEdits(null, BASE, BASE)).toBeNull()
  })

  it('never loses a changed post: every post either side changed is in the result with that side text', () => {
    const mine = withText(withText(BASE, 'a', 'A mine'), 'b', 'B mine')
    const theirs = withText(BASE, 'c', 'C theirs')
    expect(mergeDraftEdits(BASE, mine, theirs).posts.map((p) => p.text)).toEqual(['A mine', 'B mine', 'C theirs'])
  })

  it('names the posts that came from the other app', () => {
    const theirs = withText(BASE, 'c', 'C theirs')
    const merged = mergeDraftEdits(BASE, withText(BASE, 'a', 'A mine'), theirs)
    expect(idsFromTheirs(BASE, theirs, merged)).toEqual(['c'])
  })
})
