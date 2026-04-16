import { useState, useEffect } from 'react'
import { db } from './firebase'
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'

const LS_KEY = 'qm_notes_local'

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] }
}
function saveLocal(notes) {
  localStorage.setItem(LS_KEY, JSON.stringify(notes))
}

const HIST_MAX = 20
export function getHistory(noteId) {
  try { return JSON.parse(localStorage.getItem(`qm_hist_${noteId}`) || '[]') } catch { return [] }
}
export function saveHistory(noteId, entry) {
  const updated = [entry, ...getHistory(noteId)].slice(0, HIST_MAX)
  localStorage.setItem(`qm_hist_${noteId}`, JSON.stringify(updated))
}

export function useNotes(userId) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [firestoreOk, setFirestoreOk] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    const q = query(
      collection(db, 'notes'),
      where('userId', '==', userId)
    )

    const unsubscribe = onSnapshot(q,
      async (snap) => {
        const fetched = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.updatedAt?.toMillis?.() ?? new Date(a.updatedAt).getTime()
            const tb = b.updatedAt?.toMillis?.() ?? new Date(b.updatedAt).getTime()
            return tb - ta
          })

        // ローカルのみのメモを Firestore に移行（初回のみ）
        if (snap.empty) {
          const localNotes = loadLocal().filter(n => n.id.startsWith('local_'))
          for (const n of localNotes) {
            try {
              await addDoc(collection(db, 'notes'), {
                userId,
                title: n.title ?? '無題',
                content: n.content ?? '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            } catch (e) {
              console.warn('Migration failed for note:', n.id, e)
            }
          }
          if (localNotes.length > 0) return // onSnapshot が再発火して fetched に入る
        }

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
    const now = new Date().toISOString()

    // Soft-delete: mark as deleted in local state
    setNotes(prev => {
      const next = prev.map(n =>
        n.id === id ? { ...n, deleted: true, deletedAt: now } : n
      )
      saveLocal(next)
      return next
    })

    if (firestoreOk && !id.startsWith('local_')) {
      try {
        await updateDoc(doc(db, 'notes', id), {
          deleted: true,
          deletedAt: now,
        })
      } catch (err) {
        console.warn('Firestore soft-delete failed:', err)
      }
    }
  }

  const restoreNote = async (id) => {
    setNotes(prev => {
      const next = prev.map(n =>
        n.id === id ? { ...n, deleted: false, deletedAt: null } : n
      )
      saveLocal(next)
      return next
    })

    if (firestoreOk && !id.startsWith('local_')) {
      try {
        await updateDoc(doc(db, 'notes', id), {
          deleted: false,
          deletedAt: null,
        })
      } catch (err) {
        console.warn('Firestore restore failed:', err)
      }
    }
  }

  const permanentDeleteNote = async (id) => {
    localStorage.removeItem(`qm_hist_${id}`)

    setNotes(prev => {
      const next = prev.filter(n => n.id !== id)
      saveLocal(next)
      return next
    })

    if (firestoreOk && !id.startsWith('local_')) {
      try {
        await deleteDoc(doc(db, 'notes', id))
      } catch (err) {
        console.warn('Firestore permanent delete failed:', err)
      }
    }
  }

  return {
    notes, loading, firestoreOk,
    createNote, updateNote, deleteNote,
    restoreNote, permanentDeleteNote,
    getHistory, saveHistory,
  }
}
