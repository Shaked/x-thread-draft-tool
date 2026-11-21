import './Page.css'

// The one page wrapper of a route. Pages pass a width; they never set their own layout.
export default function Page({ width = 'default', children }) {
  return <main className={`ui-page ui-page--${width}`}>{children}</main>
}
