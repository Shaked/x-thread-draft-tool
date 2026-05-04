import { registerSW } from 'virtual:pwa-register'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register SW without auto-applying updates: new versions stay waiting
// until the user explicitly refreshes or accepts an update UI flow.
registerSW({
  immediate: true,
})
