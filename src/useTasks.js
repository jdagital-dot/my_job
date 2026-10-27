import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { db } from './firebase'
import { createFirestoreTaskRepository } from './tasks/taskRepository'
import { createTaskStore } from './tasks/taskStore'

const RETRY_INTERVAL = 30_000
const EMPTY = { tasks: [], loaded: false, status: 'loading', pending: 0, conflicts: [], rejected: [] }
const noopSubscribe = () => () => {}

let defaultRepo = null
function getDefaultRepo() {
  defaultRepo ??= createFirestoreTaskRepository(db)
  return defaultRepo
}

// 正式タスクの購読・作成・更新・完了・再開を一か所に集約するフック
export function useTasks(uid, repo) {
  const store = useMemo(() => {
    if (!uid) return null
    return createTaskStore({
      repo: repo ?? getDefaultRepo(),
      uid,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    })
  }, [uid, repo])

  useEffect(() => {
    if (!store) return
    store.start()
    const onOnline = () => store.setOnline(true)
    const onOffline = () => store.setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const timer = setInterval(() => store.flush(), RETRY_INTERVAL)
    return () => {
      store.stop()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(timer)
    }
  }, [store])

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
  )
  return { ...snapshot, actions: store }
}
