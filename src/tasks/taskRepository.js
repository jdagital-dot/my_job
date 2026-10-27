import {
  collection, doc, onSnapshot, setDoc, updateDoc, getDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore'

// TaskRepository の契約（Firestore 実装と Fake で共通）
//   subscribe(uid, onData(tasks), onError(err)) -> unsubscribe
//   create(uid, task)                          -> revision 1 で新規作成
//   update(uid, id, changes, baseRevision)     -> revision を baseRevision + 1 にして更新
//   get(uid, id)                               -> task | null
// 失敗時は { code } を持つエラーを投げる（permission-denied / unavailable など）。

const TIMESTAMP_FIELDS = ['dueAt', 'completedAt', 'createdAt', 'updatedAt']

function toMillis(value) {
  if (value == null) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value === 'number') return value
  return new Date(value).getTime()
}

export function fromFirestore(data) {
  const task = { ...data }
  for (const f of TIMESTAMP_FIELDS) task[f] = toMillis(data[f])
  return task
}

function toFirestoreValues(values) {
  const out = { ...values }
  for (const f of ['dueAt', 'completedAt']) {
    if (f in out) out[f] = out[f] == null ? null : Timestamp.fromMillis(out[f])
  }
  delete out.createdAt
  delete out.updatedAt
  return out
}

export function createFirestoreTaskRepository(db) {
  const tasksCol = (uid) => collection(db, 'users', uid, 'tasks')

  return {
    subscribe(uid, onData, onError) {
      return onSnapshot(
        tasksCol(uid),
        (snap) => onData(snap.docs.map(d => fromFirestore(d.data()))),
        (err) => onError(err),
      )
    },

    async create(uid, task) {
      await setDoc(doc(tasksCol(uid), task.id), {
        ...toFirestoreValues(task),
        revision: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: 'quickmemo',
      })
    },

    async update(uid, id, changes, baseRevision) {
      await updateDoc(doc(tasksCol(uid), id), {
        ...toFirestoreValues(changes),
        revision: baseRevision + 1,
        updatedAt: serverTimestamp(),
        updatedBy: 'quickmemo',
      })
    },

    async get(uid, id) {
      const snap = await getDoc(doc(tasksCol(uid), id))
      return snap.exists() ? fromFirestore(snap.data()) : null
    },
  }
}
