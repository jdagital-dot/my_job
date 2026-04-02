import { useState, useEffect } from 'react'
import { db } from './firebase'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'

const LS_KEY = 'qm_notes_local'

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function saveLocal(notes) {
  localStorage.setItem(LS_KEY, JSON.stringify(notes))
}

export function useNotes(userId) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [firestoreOk, setFirestoreOk] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    const q = query(
      collection(db, 'notes'),
      where('userId', '==', userId),
      orderBy('updatedAt', 'desc')
    )

    const unsubscribe = onSnapshot(q,
      (snap) => {
        const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setNotes(fetched)
        saveLocal(fetched)
        setFirestoreOk(true)
        setLoading(false)
      },
      (err) => {
        console.warn('Firestore error, falling back to localStorage:', err)
        setFirestoreOk(false)
        const local = loadLocal()
        setNotes(local)
        setLoading(false)
      }
    )

    return unsubscribe
  }, [userId])

  const createNote = async () => {
    const now = new Date().toISOString()
    const newNote = {
      userId,
      title: '無題',
      content: JSON.stringify({ ops: [{ insert: '\n' }] }),
      createdAt: now,
      updatedAt: now,
    }

    if (firestoreOk) {
      try {
        const ref = await addDoc(collection(db, 'notes'), {
          ...newNote,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        return ref.id
      } catch (err) {
        console.warn('Firestore createNote failed, using local:', err)
      }
    }

    // localStorage fallback
    const id = 'local_' + Date.now()
    const note = { id, ...newNote }
    const updated = [note, ...loadLocal()]
    saveLocal(updated)
    setNotes(updated)
    return id
  }

  const updateNote = async (id, { title, content }) => {
    const now = new Date().toISOString()

    // Always update local cache immediately
    setNotes(prev => {
      const next = prev.map(n => n.id === id ? { ...n, title, content, updatedAt: now } : n)
      saveLocal(next)
      return next
    })

    if (firestoreOk && !id.startsWith('local_')) {
      try {
        await updateDoc(doc(db, 'notes', id), {
          title,
          content,
          updatedAt: serverTimestamp(),
        })
      } catch (err) {
        console.warn('Firestore updateNote failed, saved locally only:', err)
      }
    }
  }

  const deleteNote = async (id) => {
    setNotes(prev => {
      const next = prev.filter(n => n.id !== id)
      saveLocal(next)
      return next
    })

    if (firestoreOk && !id.startsWith('local_')) {
      try {
        await deleteDoc(doc(db, 'notes', id))
      } catch (err) {
        console.warn('Firestore deleteNote failed:', err)
      }
    }
  }

  return { notes, loading, firestoreOk, createNote, updateNote, deleteNote }
}
