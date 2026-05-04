import { useEffect, useState, useCallback, useMemo } from 'react'

const DB_NAME = 'quickmemo'
const STORE = 'resources'
const DB_VERSION = 1

const isElectron  = typeof window !== 'undefined' && !!window.electronAPI?.isElectron
const hasFSAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window
export const resourcesSupported = isElectron || hasFSAccess

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGetAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

async function dbPut(item) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbDelete(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Date.now().toString(36))

async function ensurePermission(handle, mode = 'read') {
  if (!handle?.queryPermission) return true
  const opts = { mode }
  const status = await handle.queryPermission(opts)
  if (status === 'granted') return true
  const req = await handle.requestPermission(opts)
  return req === 'granted'
}

export function useResources() {
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    dbGetAll()
      .then(items => {
        if (cancelled) return
        items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        setResources(items)
      })
      .catch(err => console.warn('Failed to load resources', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const allTags = useMemo(() => {
    const set = new Set()
    resources.forEach(r => r.tags?.forEach(t => set.add(t)))
    return [...set].sort()
  }, [resources])

  const persist = useCallback(async (item) => {
    await dbPut(item)
    setResources(prev => {
      const idx = prev.findIndex(r => r.id === item.id)
      if (idx === -1) return [item, ...prev]
      const next = [...prev]; next[idx] = item; return next
    })
  }, [])

  const addFiles = useCallback(async () => {
    if (isElectron) {
      const picked = await window.electronAPI.pickFiles()
      for (const p of picked) {
        await persist({
          id: newId(), kind: 'file', displayName: p.name, fileName: p.name,
          tags: [], createdAt: new Date().toISOString(), path: p.path,
        })
      }
      return
    }
    if (hasFSAccess) {
      let handles
      try { handles = await window.showOpenFilePicker({ multiple: true }) }
      catch { return }
      for (const h of handles) {
        await persist({
          id: newId(), kind: 'file', displayName: h.name, fileName: h.name,
          tags: [], createdAt: new Date().toISOString(), handle: h,
        })
      }
    }
  }, [persist])

  const addFolder = useCallback(async () => {
    if (isElectron) {
      const p = await window.electronAPI.pickFolder()
      if (!p) return
      await persist({
        id: newId(), kind: 'folder', displayName: p.name, fileName: p.name,
        tags: [], createdAt: new Date().toISOString(), path: p.path,
      })
      return
    }
    if (hasFSAccess) {
      let h
      try { h = await window.showDirectoryPicker() }
      catch { return }
      await persist({
        id: newId(), kind: 'folder', displayName: h.name, fileName: h.name,
        tags: [], createdAt: new Date().toISOString(), handle: h,
      })
    }
  }, [persist])

  const addFromDataTransfer = useCallback(async (dt) => {
    if (!dt) return
    const items = Array.from(dt.items || [])
    if (items.length && hasFSAccess && items[0].getAsFileSystemHandle) {
      for (const it of items) {
        if (it.kind !== 'file') continue
        const h = await it.getAsFileSystemHandle?.()
        if (!h) continue
        await persist({
          id: newId(),
          kind: h.kind === 'directory' ? 'folder' : 'file',
          displayName: h.name, fileName: h.name,
          tags: [], createdAt: new Date().toISOString(), handle: h,
        })
      }
      return
    }
    // Electron: D&D の File は file.path を持つ
    const files = Array.from(dt.files || [])
    for (const f of files) {
      const p = f.path
      if (isElectron && p) {
        await persist({
          id: newId(), kind: 'file', displayName: f.name, fileName: f.name,
          tags: [], createdAt: new Date().toISOString(), path: p,
        })
      }
    }
  }, [persist])

  const updateResource = useCallback(async (id, patch) => {
    const cur = resources.find(r => r.id === id)
    if (!cur) return
    await persist({ ...cur, ...patch })
  }, [resources, persist])

  const removeResource = useCallback(async (id) => {
    await dbDelete(id)
    setResources(prev => prev.filter(r => r.id !== id))
  }, [])

  const openResource = useCallback(async (item) => {
    if (!item) return { ok: false, reason: 'not-found' }
    if (isElectron && item.path) {
      return await window.electronAPI.openPath(item.path)
    }
    if (item.handle) {
      const ok = await ensurePermission(item.handle, 'read')
      if (!ok) return { ok: false, reason: 'denied' }
      if (item.handle.kind === 'directory') {
        return { ok: false, reason: 'folder-web-unsupported' }
      }
      try {
        const file = await item.handle.getFile()
        const url = URL.createObjectURL(file)
        window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: 'error', error: err?.message }
      }
    }
    return { ok: false, reason: 'no-ref' }
  }, [])

  const showInFolder = useCallback(async (item) => {
    if (isElectron && item?.path) {
      return await window.electronAPI.showInFolder(item.path)
    }
    return { ok: false, reason: 'unsupported' }
  }, [])

  const downloadResource = useCallback(async (item) => {
    if (!item?.handle || item.handle.kind !== 'file') return
    const ok = await ensurePermission(item.handle, 'read')
    if (!ok) return
    const file = await item.handle.getFile()
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url; a.download = item.displayName || file.name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, [])

  const getResource = useCallback((id) => resources.find(r => r.id === id) ?? null, [resources])

  return {
    resources, allTags, loading,
    isElectron, hasFSAccess, supported: resourcesSupported,
    addFiles, addFolder, addFromDataTransfer,
    updateResource, removeResource,
    openResource, showInFolder, downloadResource,
    getResource,
  }
}
