import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import { errorText, loadConfig } from './config'
const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<main className="startup" role="status"><span className="brand">Candles.</span><h1>Opening the market…</h1><p>Verifying deployment and contract interfaces.</p></main>)
loadConfig().then(config => root.render(<React.StrictMode><App config={config}/></React.StrictMode>)).catch(error => root.render(<main className="startup"><span className="brand">Candles.</span><h1>Unable to open the market</h1><p role="alert">{errorText(error)}</p><button onClick={() => location.reload()}>Reload page</button></main>))
