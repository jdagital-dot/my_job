// テスト用のメモリ内 TaskRepository。Firestore ルールの revision 検証を模倣する。

function fail(code) {
  const err = new Error(code)
  err.code = code
  return err
}

export function createFakeTaskRepository({ now = () => Date.now() } = {}) {
  const store = new Map() // `${uid}/${id}` -> task
  const listeners = new Set()
  const state = { offline: false, loseAck: false, calls: [] }

  const tasksOf = (uid) =>
    [...store.entries()]
      .filter(([key]) => key.startsWith(`${uid}/`))
      .map(([, task]) => ({ ...task }))

  const emit = () => {
    for (const l of listeners) l.onData(tasksOf(l.uid))
  }

  // 書き込み後に応答だけ失われた状況（再送の冪等性テスト用）
  const finish = () => {
    if (state.loseAck) throw fail('unavailable')
  }

  return {
    state,
    subscribe(uid, onData, onError) {
      const listener = { uid, onData, onError }
      listeners.add(listener)
      onData(tasksOf(uid))
      return () => listeners.delete(listener)
    },

    async create(uid, task) {
      state.calls.push({ type: 'create', id: task.id })
      if (state.offline) throw fail('unavailable')
      const key = `${uid}/${task.id}`
      if (store.has(key)) throw fail('permission-denied')
      const t = now()
      store.set(key, { ...task, revision: 1, createdAt: t, updatedAt: t, updatedBy: 'quickmemo' })
      emit()
      finish()
    },

    async update(uid, id, changes, baseRevision) {
      state.calls.push({ type: 'update', id, baseRevision })
      if (state.offline) throw fail('unavailable')
      const key = `${uid}/${id}`
      const current = store.get(key)
      if (!current || current.revision !== baseRevision) throw fail('permission-denied')
      store.set(key, { ...current, ...changes, revision: baseRevision + 1, updatedAt: now(), updatedBy: 'quickmemo' })
      emit()
      finish()
    },

    async get(uid, id) {
      if (state.offline) throw fail('unavailable')
      const task = store.get(`${uid}/${id}`)
      return task ? { ...task } : null
    },

    // 他端末・AI-Secretary からの更新を模倣する
    remoteWrite(uid, task) {
      const key = `${uid}/${task.id}`
      const current = store.get(key)
      store.set(key, {
        ...(current ?? {}),
        ...task,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: now(),
      })
      emit()
    },

    raw(uid, id) {
      const task = store.get(`${uid}/${id}`)
      return task ? { ...task } : null
    },
  }
}
