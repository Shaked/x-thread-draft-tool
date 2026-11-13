import { describe, expect, it } from 'vitest'
import { exportAsNumberedText } from '../../src/utils/exportFormats.js'

// The loop the UI used before it shared this function (ExportOptions "Copy (Numbered)").
function uiNumbered(posts) {
  let text = ''
  posts.forEach((post, index) => {
    text += `${index + 1}/${posts.length}\n`
    text += post.text
    if (index < posts.length - 1) text += '\n\n'
  })
  return text
}

describe('exportAsNumberedText', () => {
  it('matches the UI numbered copy for the same posts', () => {
    const posts = [{ text: 'first' }, { text: '' }, { text: 'third post' }]
    expect(exportAsNumberedText(posts)).toBe(uiNumbered(posts))
    expect(exportAsNumberedText([{ text: 'only' }])).toBe('1/1\nonly')
  })
})
