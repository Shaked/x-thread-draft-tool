import { HttpError } from './http.js'

export const SUSPENDED_MESSAGE = 'This account is suspended.'

/** Every caller object passes through here. A path that did not load the flag fails closed. */
export function admit(caller) {
  if (caller.suspended === true) throw new HttpError(403, SUSPENDED_MESSAGE)
  if (caller.suspended !== false) throw new Error('caller without a suspension flag')
  return caller
}
