import './Icon.css'

// Line icons, drawn with the current text colour.
const PATHS = {
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  agent: 'M12 4v3M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12v2M15 12v2',
  x: 'M5 4l14 16M19 4L5 20',
  export: 'M12 4v11M8 11l4 4 4-4M5 20h14',
  signout: 'M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  publish: 'M4 12l16-8-6 16-3-7z'
}

// Moved from src/components/Icon.jsx (plan task 2). `size` md is 20 px, lg is 24 px; `mirror` flips it in RTL.
export default function Icon({ name, size = 'md', mirror = false }) {
  const className = ['icon', 'ui-icon', `ui-icon--${size}`, mirror ? 'ui-icon--mirror' : ''].filter(Boolean).join(' ')
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
