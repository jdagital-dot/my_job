import { useState, useEffect } from 'react'
import { auth, googleProvider } from './firebase'
import { signInWithRedirect, signInWithPopup, getRedirectResult, signOut, onAuthStateChanged } from 'firebase/auth'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      if (err.code !== 'auth/no-auth-event') {
        setAuthError('ログインに失敗しました。もう一度お試しください。')
      }
    })
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signIn = async () => {
    setAuthError(null)
    try {
      if (typeof window !== 'undefined' && window.electron?.isElectron) {
        return await signInWithPopup(auth, googleProvider)
      }
      const ua = navigator.userAgent
      const isWebView = /wv|WebView/.test(ua) ||
        (ua.includes('iPhone') && !ua.includes('Safari')) ||
        ua.includes('FBAN') || ua.includes('FBAV')
      if (isWebView) {
        return await signInWithRedirect(auth, googleProvider)
      }
      return await signInWithPopup(auth, googleProvider)
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setAuthError('ログインに失敗しました。もう一度お試しください。')
      }
    }
  }
  const signOutUser = () => signOut(auth)

  return { user, loading, authError, signIn, signOut: signOutUser }
}
