// One renderer per capability (#292): the numbered divider of a post ("Draft 2/5") and the start and end lines of a
// thread. Same rules as images.js.
/* global el, tr */

/** The numbered divider at the top of a post: "Draft" and "n/total". */
export function numberNode(index, total) {
  return el('header', {}, [el('strong', {}, [tr('thread', 'draft')]), el('span', {}, [' ' + (index + 1) + '/' + total])])
}

/** The line before the first post. */
export function startLine() {
  return el('p', { dir: 'auto' }, [tr('thread', 'start')])
}

/** The line after the last post. */
export function endLine() {
  return el('p', { dir: 'auto' }, [tr('thread', 'end')])
}
