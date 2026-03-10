import React from 'react'
import ReactDOM from 'react-dom/client'
import 'react-diff-view/style/index.css'
import './monaco'
import App from './App'
import { DiffWindow } from './components/DiffWindow'
import './index.css'

const isDiffWindow = window.location.hash.startsWith('#diff')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDiffWindow ? <DiffWindow /> : <App />}
  </React.StrictMode>
)
