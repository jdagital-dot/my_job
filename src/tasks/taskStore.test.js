import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTaskStore, queueKey } from './taskStore'
import { createFakeTaskRepository } from './fakeTaskRepository'

const UID = 'user-1'

function setup({ storage = localStorage } = {}) {
  const repo = createFakeTaskRepository()
  const store = createTaskStore({ repo, uid: UID, storage })
  store.start()
  return { repo, store }
}

const byTitle = (store, title) => store.getSnapshot().tasks.find(t => t.title === title)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('taskStore', () => {
  it('タスクを追加すると Firestore に revision 1 で保存され、同期済みになる', async () => {
    const { repo, store } = setup()
    const result = store.createTask({ title: '大会案内', domain: 'table-tennis' })
    expect(result.ok).toBe(true)
    await store.flush()
    expect(repo.raw(UID, result.id)).toMatchObject({ id: result.id, title: '大会案内', revision: 1, source: 'quickmemo' })
    expect(store.getSnapshot().status).toBe('synced')
    expect(localStorage.getItem(queueKey(UID))).toBe('[]')
  })

  it('検証エラーは保存しない', () => {
    const { repo, store } = setup()
    const result = store.createTask({ title: '授業準備', domain: 'school' })
    expect(result.ok).toBe(false)
    expect(repo.state.calls).toHaveLength(0)
  })

  it('完了・再開できる', async () => {
    const { repo, store } = setup()
    const { id } = store.createTask({ title: 'a', domain: 'business' })
    await store.flush()
    store.setCompleted(id, true)
    await store.flush()
    expect(repo.raw(UID, id)).toMatchObject({ status: 'completed', revision: 2 })
    expect(repo.raw(UID, id).completedAt).toEqual(expect.any(Number))
    store.setCompleted(id, false)
    await store.flush()
    expect(repo.raw(UID, id)).toMatchObject({ status: 'not_started', completedAt: null, revision: 3 })
  })

  it('他端末の変更を購読で反映する', () => {
    const { repo, store } = setup()
    repo.remoteWrite(UID, { id: 't1', title: 'AIで承認', domain: 'business', status: 'not_started', priority: 2 })
    expect(byTitle(store, 'AIで承認')).toMatchObject({ id: 't1', revision: 1, syncState: 'synced' })
  })

  it('オフライン中の操作は端末内に残り、再接続後に重複なく同期される', async () => {
    const { repo, store } = setup()
    repo.state.offline = true
    const { id } = store.createTask({ title: 'オフライン作成', domain: 'business' })
    await store.flush()
    expect(store.getSnapshot().status).toBe('offline')
    expect(byTitle(store, 'オフライン作成').syncState).toBe('pending')

    store.updateTask(id, { priority: 1 })
    store.setCompleted(id, true)
    const persisted = JSON.parse(localStorage.getItem(queueKey(UID)))
    expect(persisted).toHaveLength(1) // 未送信の作成に変更をまとめる

    repo.state.offline = false
    store.setOnline(true)
    await store.flush()
    expect(repo.state.calls.filter(c => c.type === 'create' && c.id === id).length).toBeGreaterThan(0)
    expect(repo.raw(UID, id)).toMatchObject({ priority: 1, status: 'completed', revision: 1 })
    expect(store.getSnapshot().status).toBe('synced')
  })

  it('再起動後もキューから再送できる', async () => {
    const repo = createFakeTaskRepository()
    repo.state.offline = true
    const first = createTaskStore({ repo, uid: UID })
    first.start()
    const { id } = first.createTask({ title: '再起動前', domain: 'personal' })
    await first.flush()
    first.stop()

    repo.state.offline = false
    const second = createTaskStore({ repo, uid: UID })
    second.start()
    await second.flush()
    expect(repo.raw(UID, id)).toMatchObject({ title: '再起動前', revision: 1 })
  })

  it('書き込み後に応答が失われても再送で二重作成・二重更新しない', async () => {
    const { repo, store } = setup()
    repo.state.loseAck = true
    const { id } = store.createTask({ title: '応答喪失', domain: 'business' })
    await store.flush()
    expect(store.getSnapshot().pending).toBe(1)
    repo.state.loseAck = false
    store.setOnline(true)
    await store.flush()
    expect(store.getSnapshot().pending).toBe(0)
    expect(store.getSnapshot().status).toBe('synced')
    expect(repo.raw(UID, id).revision).toBe(1)

    repo.state.loseAck = true
    store.updateTask(id, { priority: 2 })
    await store.flush()
    repo.state.loseAck = false
    store.setOnline(true)
    await store.flush()
    expect(repo.raw(UID, id)).toMatchObject({ priority: 2, revision: 2 })
    expect(store.getSnapshot().status).toBe('synced')
  })

  it('他端末が先に更新していたら上書きせず競合にする', async () => {
    const { repo, store } = setup()
    const { id } = store.createTask({ title: '競合', domain: 'business' })
    await store.flush()
    repo.state.offline = true
    store.updateTask(id, { priority: 1 })
    await store.flush()
    repo.state.offline = false
    repo.remoteWrite(UID, { id, priority: 5 }) // revision 2
    await store.flush()

    expect(store.getSnapshot().status).toBe('conflict')
    expect(store.getSnapshot().conflicts).toEqual([id])
    expect(repo.raw(UID, id).priority).toBe(5)
    expect(store.updateTask(id, { title: 'x' }).ok).toBe(false)
  })

  it('競合はこの端末の内容でも最新の内容でも解決できる', async () => {
    const { repo, store } = setup()
    const { id } = store.createTask({ title: '競合解決', domain: 'business' })
    await store.flush()
    repo.state.offline = true
    store.updateTask(id, { priority: 1 })
    await store.flush()
    repo.state.offline = false
    repo.remoteWrite(UID, { id, priority: 5 })
    await store.flush()

    store.resolveConflict(id, 'local')
    await store.flush()
    expect(repo.raw(UID, id)).toMatchObject({ priority: 1, revision: 3 })
    expect(store.getSnapshot().status).toBe('synced')

    repo.state.offline = true
    store.updateTask(id, { priority: 2 })
    await store.flush()
    repo.state.offline = false
    repo.remoteWrite(UID, { id, priority: 4 })
    await store.flush()
    store.resolveConflict(id, 'remote')
    expect(byTitle(store, '競合解決').priority).toBe(4)
    expect(store.getSnapshot().status).toBe('synced')
  })

  it('エラーログにタスク本文を含めない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = createFakeTaskRepository()
    repo.update = async () => { const e = new Error('x'); e.code = 'permission-denied'; throw e }
    repo.get = async (uid, id) => ({ id, revision: 1, title: '秘密のタイトル' })
    const store = createTaskStore({ repo, uid: UID })
    store.start()
    repo.remoteWrite(UID, { id: 't', title: '秘密のタイトル', domain: 'business', status: 'not_started', priority: 3, sensitivity: 'general' })
    store.updateTask('t', { priority: 1 })
    await store.flush()
    expect(store.getSnapshot().status).toBe('error')
    for (const call of warn.mock.calls) expect(call.join(' ')).not.toContain('秘密のタイトル')
  })
})
