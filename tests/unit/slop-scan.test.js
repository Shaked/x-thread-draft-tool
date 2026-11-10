import { describe, expect, it } from 'vitest'
import { scan } from '../../scripts/slop-scan.mjs'

const rules = (text) => scan(text, 'fixture.js').map((f) => f.rule)

describe('slop-scan marker rule', () => {
  it('flags work-in-progress markers on any line, case-insensitively', () => {
    expect(rules('const a = 1 // TODO: tidy up')).toEqual(['marker'])
    expect(rules('fixme later')).toEqual(['marker'])
    expect(rules('const x = 2 // xxx')).toEqual(['marker'])
    expect(rules('hack around the bug')).toEqual(['marker'])
    expect(rules('const t = "Lorem Ipsum dolor"')).toEqual(['marker'])
  })

  it('does not flag words that only contain a marker', () => {
    expect(rules('const todos = []\nconst prefix = "xxxl"')).toEqual([])
  })

  it('reports the line number', () => {
    expect(scan('a\nb\nTODO c', 'f.js')).toEqual([{ file: 'f.js', line: 3, rule: 'marker' }])
  })
})

describe('slop-scan commented-code rule', () => {
  it('flags three or more consecutive comment lines that look like code', () => {
    const text = [
      'const a = 1',
      '// const b = compute(a);',
      '// if (b) {',
      '// }',
      'const c = 3'
    ].join('\n')
    expect(scan(text, 'f.js')).toEqual([{ file: 'f.js', line: 2, rule: 'commented-code' }])
  })

  it('does not flag two code-like comment lines or prose comments', () => {
    expect(rules('// const b = 1;\n// const c = 2;\nconst a = 1')).toEqual([])
    expect(rules('// explain the next block\n// over three lines\n// of prose\nx()')).toEqual([])
  })
})

describe('slop-scan empty-catch rule', () => {
  it('flags catch blocks with nothing inside', () => {
    expect(rules('try { x() } catch (e) {}')).toEqual(['empty-catch'])
    expect(rules('try { x() } catch {}')).toEqual(['empty-catch'])
    expect(rules('try { x() } catch (e) {\n   \n}')).toEqual(['empty-catch'])
  })

  it('does not flag catch blocks that do something', () => {
    expect(rules('try { x() } catch (e) { console.error(e) }')).toEqual([])
  })
})

describe('slop-scan slop-ok marker', () => {
  it('skips a line that ends with a reason of three or more words', () => {
    expect(rules('const a = 1 // TODO // slop-ok: tracked in the planning doc')).toEqual([])
    expect(rules('try { x() } catch (e) {} // slop-ok: error is expected and ignored')).toEqual([])
  })

  it('does not skip a line whose reason is too short', () => {
    expect(rules('const a = 1 // TODO // slop-ok: short')).toEqual(['marker'])
  })
})

describe('slop-scan on clean code', () => {
  it('returns no findings for ordinary code', () => {
    const text = 'export function add(a, b) {\n  // adds two numbers\n  return a + b\n}\n'
    expect(scan(text, 'f.js')).toEqual([])
  })
})
