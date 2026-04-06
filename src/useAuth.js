import { useState, useEffect } from 'react'
import { auth, googleProvider } from './firebase'
import { signInWithRedirect, signInWithPopup, getRedirectResult, signOut, onAuthStateChanged } from 'firebase/auth'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRedirectResult(auth).catch(() => {})
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signIn = () => {
    // Electron 環境では常に signInWithPopup を使う
    if (typeof window !== 'undefined' && window.electron?.isElectron) {
      return signInWithPopup(auth, googleProvider)
    }
    const ua = navigator.userAgent
    const isWebView = /wv|WebView/.test(ua) ||
      (ua.includes('iPhone') && !ua.includes('Safari')) ||
      ua.includes('FBAN') || ua.includes('FBAV')
    if (isWebView) {
      return signInWithRedirect(auth, googleProvider)
    }
    return signInWithPopup(auth, googleProvider)
  }
  const signOutUser = () => signOut(auth)

  return { user, loading, signIn, signOut: signOutUser }
}
