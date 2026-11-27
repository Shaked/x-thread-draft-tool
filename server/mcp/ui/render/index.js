// The renderers (#292), in the order the views copy them. A client improvement that changes how one part looks is a
// change to one file here; a new part is a new file and one line below.
import { imagesNode } from './images.js'
import { tweetNode } from './tweet.js'
import { endLine, numberNode, startLine } from './divider.js'

export const RENDERERS = [imagesNode, tweetNode, numberNode, startLine, endLine]
