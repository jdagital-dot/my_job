import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyDoaLNz3cETyo_tiRvoTwXWa_XRT0ophVs",
  authDomain: "myjob-28bce.firebaseapp.com",
  projectId: "myjob-28bce",
  storageBucket: "myjob-28bce.firebasestorage.app",
  messagingSenderId: "1047779429851",
  appId: "1:1047779429851:web:7b871a82e97419e6b06bfe"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
