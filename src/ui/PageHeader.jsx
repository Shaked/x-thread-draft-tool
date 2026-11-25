import './PageHeader.css'
import AppBar from '../components/AppBar'
import AppMenu from '../components/AppMenu'
import Button from './Button'

// The top of a page: the menu and back link, the signed-in actions (AppBar), the title and a subtitle.
// `actions` go into the AppBar: in the header from 768 px, in the fixed bottom bar on phones.
export default function PageHeader({ title, subtitle, back, actions, menu = true, sticky = false, titleSlot, status }) {
  const className = sticky ? 'ui-page-header ui-page-header--sticky' : 'ui-page-header'
  return (
    <header className={className}>
      <div className="ui-page-header__bar">
        <div className="ui-page-header__nav">
          {menu && <AppMenu />}
          {back && (
            <Button variant="ghost" size="sm" to={back.to} onClick={back.onClick}>
              {back.label}
            </Button>
          )}
        </div>
        <AppBar>{actions}</AppBar>
      </div>
      {titleSlot ?? <h1 className="ui-page-header__title">{title}</h1>}
      {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
      {status}
    </header>
  )
}
