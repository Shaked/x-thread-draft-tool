import './SideLayout.css'

// A side column (a menu) next to the content: the column sits at the inline start from 768 px, above the content below that.
export default function SideLayout({ side, children }) {
  return (
    <div className="ui-side-layout">
      <div className="ui-side-layout__side">{side}</div>
      <div className="ui-side-layout__main">{children}</div>
    </div>
  )
}
