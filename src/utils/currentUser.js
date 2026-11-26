import { createContext, useContext } from 'react'

// The signed-in user from GET /api/auth/me (null when signed out). `user.admin` is true only for the admin (#368):
// the changelog link and page exist only for that user. The server still answers 404 to everyone else.
export const CurrentUserContext = createContext(null)

export const useCurrentUser = () => useContext(CurrentUserContext)

// The one place that decides what the browser shows to the admin (#285). The server still answers 404 to everyone else.
export const isAdmin = (user) => user?.role === 'admin'
