import { buildTask, completionChanges, normalizeChanges, validateTask, newId } from './taskModel'

// タスクの状態管理と同期キュー。
// - 操作は先に端末内キュー（storage）へ保存し、Firestore へは冪等に再送する。
// - タスク ID と操作 ID は送信前に生成するため、再送しても二重作成されない。
// - 他端末で先に更新されていた場合は上書きせず「競合」として利用者に選ばせる。
// - エラー時にタスク本文をログへ出さない（エラーコードのみ）。

const NETWORK_CODES = new Set(['unavailable', 'deadline-exceeded', 'cancelled', 'resource-exhausted', 'internal'])
const REJECT_CODES = new Set(['permission-denied', 'failed-precondition', 'aborted', 'not-found', 'already-exists'])

export const queueKey = (uid) => `qm_task_queue_v1_${uid}`

function isNetworkError(err) {
  return !err?.code || NETWORK_CODES.has(err.code)
}

function sameValues(remote, values) {
  return Object.entries(values).every(([k, v]) => (remote[k] ?? null) === (v ?? null))
}

function resultingRevision(entry) {
  return entry.type === 'create' ? 1 : entry.baseRevision + 1
}

export function createTaskStore({ repo, uid, storage = globalThis.localStorage, online = true }) {
  let remote = new Map()
  let queue = loadQueue()
  let loaded = false
  let isOnline = online
  let networkError = false
  let loadError = null
  let flushing = null
  const inFlight = new Set()
  const listeners = new Set()
  let unsubscribe = null
  let snapshot = computeSnapshot()

  function loadQueue() {
    try { return JSON.parse(storage?.getItem(queueKey(uid)) || '[]') } catch { return [] }
  }
  function saveQueue() {
    try { storage?.setItem(queueKey(uid), JSON.stringify(queue)) } catch { /* 容量不足など */ }
  }

  function projectedTasks() {
    const tasks = new Map([...remote].map(([id, t]) => [id, { ...t, syncState: 'synced' }]))
    for (const entry of queue) {
      const current = tasks.get(entry.taskId)
      if (entry.state !== 'pending') {
        if (current) current.syncState = entry.state
        continue
      }
      if (entry.type === 'create') {
        tasks.set(entry.taskId, { ...(current ?? {}), ...entry.data, revision: current?.revision ?? 0, syncState: 'pending' })
      } else if (current) {
        tasks.set(entry.taskId, { ...current, ...entry.changes, syncState: current.syncState === 'synced' ? 'pending' : current.syncState })
      }
    }
    return [...tasks.values()]
  }

  function computeSnapshot() {
    const conflicts = queue.filter(e => e.state === 'conflict').map(e => e.taskId)
    const rejected = queue.filter(e => e.state === 'rejected').map(e => e.taskId)
    const pending = queue.filter(e => e.state === 'pending').length
    let status = 'synced'
    if (!loaded) status = loadError ? 'offline' : 'loading'
    if (pending > 0) status = 'saving'
    if (!isOnline || networkError) status = 'offline'
    if (rejected.length > 0) status = 'error'
    if (conflicts.length > 0) status = 'conflict'
    return { tasks: projectedTasks(), loaded, status, pending, conflicts, rejected }
  }

  function notify() {
    snapshot = computeSnapshot()
    for (const l of listeners) l(snapshot)
  }

  function findTask(id) {
    return snapshot.tasks.find(t => t.id === id) ?? null
  }

  function entriesOf(taskId) {
    return queue.filter(e => e.taskId === taskId)
  }

  function enqueue(taskId, values, type) {
    const entries = entriesOf(taskId)
    const last = entries[entries.length - 1]
    if (last && last.state === 'pending' && !inFlight.has(last.opId)) {
      if (last.type === 'create') last.data = { ...last.data, ...values }
      else last.changes = { ...last.changes, ...values }
    } else if (type === 'create') {
      queue.push({ opId: newId(), taskId, type: 'create', data: values, state: 'pending' })
    } else {
      const baseRevision = last ? resultingRevision(last) : remote.get(taskId)?.revision
      queue.push({ opId: newId(), taskId, type: 'update', changes: values, baseRevision, state: 'pending' })
    }
    saveQueue()
    notify()
    // オフラインと分かっている間は端末内に保持し、再接続・定期再試行で送る
    if (isOnline && !networkError) flush()
  }

  function removeEntry(opId) {
    queue = queue.filter(e => e.opId !== opId)
    saveQueue()
  }

  function markEntry(opId, fields) {
    queue = queue.map(e => (e.opId === opId ? { ...e, ...fields } : e))
    saveQueue()
  }

  async function send(entry) {
    inFlight.add(entry.opId)
    try {
      if (entry.type === 'create') await repo.create(uid, entry.data)
      else await repo.update(uid, entry.taskId, entry.changes, entry.baseRevision)
      removeEntry(entry.opId)
      return 'ok'
    } catch (err) {
      if (isNetworkError(err)) return 'network'
      if (!REJECT_CODES.has(err.code)) {
        markEntry(entry.opId, { state: 'rejected', errorCode: err.code })
        return 'rejected'
      }
      // 応答だけ失われた再送か、他端末の先行更新か、検証エラーかを判別する
      let current
      try {
        current = await repo.get(uid, entry.taskId)
      } catch (getErr) {
        if (isNetworkError(getErr)) return 'network'
        current = null
      }
      const values = entry.type === 'create' ? entry.data : entry.changes
      const expected = entry.type === 'create' ? 1 : entry.baseRevision + 1
      if (current && current.revision >= expected && sameValues(current, values)) {
        removeEntry(entry.opId)
        return 'ok'
      }
      if (current && (entry.type === 'create' || current.revision !== entry.baseRevision)) {
        markEntry(entry.opId, { state: 'conflict', remoteRevision: current.revision })
        return 'conflict'
      }
      markEntry(entry.opId, { state: 'rejected', errorCode: err.code })
      console.warn('タスクの保存が拒否されました:', err.code)
      return 'rejected'
    } finally {
      inFlight.delete(entry.opId)
    }
  }

  function flush() {
    if (flushing) return flushing
    flushing = (async () => {
      // 先に flushing を確定させ、送信中の通知から再入しないようにする
      await null
      try {
        let progressed = true
        while (progressed) {
          progressed = false
          const seen = new Set()
          const heads = []
          for (const entry of queue) {
            if (seen.has(entry.taskId)) continue
            seen.add(entry.taskId)
            if (entry.state === 'pending' && !inFlight.has(entry.opId)) heads.push(entry)
          }
          for (const entry of heads) {
            const result = await send(entry)
            if (result === 'network') {
              networkError = true
              notify()
              return
            }
            networkError = false
            progressed = true
            notify()
          }
        }
      } finally {
        flushing = null
      }
    })()
    return flushing
  }

  function rebase(taskId) {
    let base = remote.get(taskId)?.revision
    queue = queue.map(e => {
      if (e.taskId !== taskId || e.type !== 'update' || base == null) return e
      const next = { ...e, baseRevision: base }
      base += 1
      return next
    })
  }

  const api = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start() {
      unsubscribe = repo.subscribe(
        uid,
        (tasks) => {
          remote = new Map(tasks.map(t => [t.id, t]))
          loaded = true
          loadError = null
          notify()
          if (queue.some(e => e.state === 'pending')) flush()
        },
        (err) => {
          loadError = err?.code ?? 'unknown'
          console.warn('タスクの読み込みに失敗しました:', loadError)
          notify()
        },
      )
      if (queue.length) flush()
    },
    stop() {
      unsubscribe?.()
      unsubscribe = null
    },

    setOnline(value) {
      isOnline = value
      if (value) networkError = false
      notify()
      if (value) flush()
    },

    flush,

    createTask(input) {
      const task = buildTask(input)
      const errors = validateTask(task)
      if (errors.length) return { ok: false, errors }
      enqueue(task.id, task, 'create')
      return { ok: true, id: task.id }
    },

    updateTask(id, changes) {
      const current = findTask(id)
      if (!current) return { ok: false, errors: ['タスクが見つかりません'] }
      if (current.syncState === 'conflict' || current.syncState === 'rejected') {
        return { ok: false, errors: ['先に同期の問題を解決してください'] }
      }
      const normalized = normalizeChanges(changes)
      const errors = validateTask({ ...current, ...normalized })
      if (errors.length) return { ok: false, errors }
      enqueue(id, normalized, 'update')
      return { ok: true, id }
    },

    setCompleted(id, completed) {
      return api.updateTask(id, completionChanges(completed))
    },

    // prefer: 'local'（この端末の変更で上書き） / 'remote'（最新の内容を採用）
    resolveConflict(taskId, prefer) {
      const entries = entriesOf(taskId)
      if (!entries.length) return
      if (prefer === 'remote') {
        queue = queue.filter(e => e.taskId !== taskId)
      } else {
        let base = remote.get(taskId)?.revision
        if (base == null) return
        queue = queue.map(e => {
          if (e.taskId !== taskId) return e
          const { id: _id, source: _source, ...rest } = e.data ?? {}
          const next = e.type === 'create'
            ? { opId: e.opId, taskId, type: 'update', changes: rest, baseRevision: base, state: 'pending' }
            : { ...e, baseRevision: base, state: 'pending', remoteRevision: undefined }
          base += 1
          return next
        })
      }
      saveQueue()
      notify()
      flush()
    },

    // 保存を拒否された変更を破棄する
    discardRejected(taskId) {
      queue = queue.filter(e => !(e.taskId === taskId && e.state === 'rejected'))
      rebase(taskId)
      saveQueue()
      notify()
      flush()
    },
  }
  return api
}
