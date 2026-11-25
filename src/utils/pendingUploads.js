// Image uploads in progress (#363). While one runs, the open editor does not take another app's version of the
// draft: the upload's result is written from the draft it started with, so a newer version would be overwritten.
let pending = 0

export function beginUpload() {
  pending += 1
}

export function endUpload() {
  pending = Math.max(0, pending - 1)
}

export function uploadsPending() {
  return pending > 0
}
