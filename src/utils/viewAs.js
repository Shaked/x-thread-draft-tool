import { createContext, useContext } from 'react'

// While the admin views the app as a user (#291), `me.view_as` is { login, user_id, expires_at }; otherwise null.
// App provides it once, so a control can disable itself without prop drilling.
export const ViewAsContext = createContext(null)

export const useViewAs = () => useContext(ViewAsContext)

/** The text of a disabled control while viewing, or undefined when not viewing. Pass it as `disabledReason`. */
export const viewAsReason = (viewAs) => (viewAs ? `Not available while viewing as ${viewAs.login}` : undefined)

export const useViewAsReason = () => viewAsReason(useViewAs())
