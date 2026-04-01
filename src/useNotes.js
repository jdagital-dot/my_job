import { useState, useEffect } from 'react'
import { db } from './firebase'
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'

export function useNotes(userId) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    const q = query(
      collection(db, 'notes'),
      where('userId', '==', userId),
      orderBy('updatedAt', 'desc')
    )

    const unsubscribe = onSnapshot(q, (snap) => {
      setNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })

    return unsubscribe
  }, [userId])

  const createNote = async () => {
    const ref = await addDoc(collection(db, 'notes'), {
      userId,
      title: '無題',
      content: JSON.stringify({ ops: [{ insert: '\n' }] }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  }

  const updateNote = async (id, { title, content }) => {
    await updateDoc(doc(db, 'notes', id), {
      title,
      content,
      updatedAt: serverTimestamp(),
    })
  }

  const deleteNote = async (id) => {
    await deleteDoc(doc(db, 'notes', id))
  }

  return { notes, loading, createNote, updateNote, deleteNote }
}
