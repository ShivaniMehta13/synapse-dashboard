import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LoginPage from './LoginPage.jsx'

export function Root() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [loggedInEmail, setLoggedInEmail] = useState('')

  return loggedIn
    ? <App onLogout={() => {
        setLoggedIn(false)
        setLoggedInEmail('')
      }} loggedInEmail={loggedInEmail} />
    : <LoginPage onLoginSuccess={(email) => {
        setLoggedInEmail(email)
        setLoggedIn(true)
      }} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
