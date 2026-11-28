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
  publish: 'M4 12l16-8-6 16-3-7z',
  // Editor posts (plan Task 9): the drag handle, the toolbar and the add-post buttons.
  drag: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  emoji: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  plus: 'M12 5v14M5 12h14',
  // Image carousel (plan Task 10): previous and next. `mirror` flips them in right-to-left text.
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  // Sign-in and loading screens (plan Task 11): the feature list.
  compose: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  // A private area: the view-as lock (#385).
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  sync: 'M20 12a8 8 0 0 1-14.9 4M4 12a8 8 0 0 1 14.9-4M20 4v4h-4M4 20v-4h4'
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
