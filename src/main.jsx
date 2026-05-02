import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initMetrics } from './utils/metrics'
import './styles/App.css'

initMetrics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
