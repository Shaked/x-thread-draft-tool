import { allowFlags, setKit, setSkin } from '../../../src/utils/skin.js'

// Puts the test on the old purple look and the old components, as the admin's off switch does (#406). Use only in a test
// of the old controls; a test that checks the Rare UI control must not call it.
export function useOldLook() {
  allowFlags(true)
  setKit('default')
  setSkin('default')
}
