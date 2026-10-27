// Firestore Emulator でタスクのセキュリティルールと Firestore 実装を検証する。
// 実行: npm run test:rules（demo-quickmemo プロジェクト。本番には接続しない）
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, getDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { createFirestoreTaskRepository } from '../../src/tasks/taskRepository.js'
import { buildTask } from '../../src/tasks/taskModel.js'

let env

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-quickmemo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { await env?.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

const alice = () => env.authenticatedContext('alice').firestore()
const bob = () => env.authenticatedContext('bob').firestore()

function payload(overrides = {}) {
  const task = buildTask({ id: 't1', title: '大会案内を作る', domain: 'table-tennis', ...overrides })
  return {
    ...task,
    dueAt: null,
    completedAt: task.completedAt == null ? null : Timestamp.fromMillis(task.completedAt),
    revision: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: 'quickmemo',
    ...overrides,
  }
}

const taskRef = (db, uid = 'alice', id = 't1') => doc(db, 'users', uid, 'tasks', id)

describe('タスクのセキュリティルール', () => {
  it('本人は作成・読み取りできる', async () => {
    await assertSucceeds(setDoc(taskRef(alice()), payload()))
    await assertSucceeds(getDoc(taskRef(alice())))
  })

  it('他利用者のパスは読み書きできない', async () => {
    await assertSucceeds(setDoc(taskRef(alice()), payload()))
    await assertFails(getDoc(taskRef(bob(), 'alice')))
    await assertFails(setDoc(taskRef(bob(), 'alice', 't2'), payload({ id: 't2' })))
    await assertFails(updateDoc(taskRef(bob(), 'alice'), { priority: 1, revision: 2, updatedAt: serverTimestamp() }))
  })

  it('未ログインは読み書きできない', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(taskRef(anon)))
    await assertFails(setDoc(taskRef(anon), payload()))
  })

  it('不正なフィールド・値は拒否する', async () => {
    const db = alice()
    await assertFails(setDoc(taskRef(db), { ...payload(), extra: 'x' }))
    await assertFails(setDoc(taskRef(db), payload({ priority: 6 })))
    await assertFails(setDoc(taskRef(db), payload({ status: 'proposed' })))
    await assertFails(setDoc(taskRef(db), payload({ title: '' })))
    await assertFails(setDoc(taskRef(db), payload({ title: 'x'.repeat(201) })))
    await assertFails(setDoc(taskRef(db), payload({ id: 'other' })))
    await assertFails(setDoc(taskRef(db), payload({ revision: 2 })))
    await assertFails(setDoc(taskRef(db), payload({ estimatedMinutes: -1 })))
    await assertFails(setDoc(taskRef(db), payload({ status: 'completed', completedAt: null })))
  })

  it('confidential / restricted / uncertain は書き込めない', async () => {
    for (const sensitivity of ['confidential', 'restricted', 'uncertain']) {
      await assertFails(setDoc(taskRef(alice()), payload({ sensitivity })))
    }
  })

  it('学校タスクは非機密確認がなければ拒否する', async () => {
    const db = alice()
    await assertFails(setDoc(taskRef(db), payload({ domain: 'school', schoolNonConfidentialConfirmed: false })))
    await assertFails(setDoc(taskRef(db), payload({ domain: 'school', sensitivity: 'personal', schoolNonConfidentialConfirmed: true })))
    await assertSucceeds(setDoc(taskRef(db), payload({ domain: 'school', schoolNonConfidentialConfirmed: true })))
    // 更新で確認フラグを外すことも拒否
    await assertFails(updateDoc(taskRef(db), { schoolNonConfidentialConfirmed: false, revision: 2, updatedAt: serverTimestamp() }))
  })

  it('更新は revision を1つ進めた場合だけ許可する', async () => {
    const db = alice()
    await setDoc(taskRef(db), payload())
    await assertFails(updateDoc(taskRef(db), { priority: 1, revision: 1, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(taskRef(db), { priority: 1, revision: 3, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(taskRef(db), { priority: 1, revision: 2 })) // updatedAt 未更新
    await assertSucceeds(updateDoc(taskRef(db), { priority: 1, revision: 2, updatedAt: serverTimestamp() }))
  })

  it('createdAt と source は変更できない', async () => {
    const db = alice()
    await setDoc(taskRef(db), payload())
    await assertFails(updateDoc(taskRef(db), { source: 'ai_secretary', revision: 2, updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(taskRef(db), { createdAt: Timestamp.fromMillis(0), revision: 2, updatedAt: serverTimestamp() }))
  })

  it('物理削除はできない', async () => {
    const db = alice()
    await setDoc(taskRef(db), payload())
    await assertFails(deleteDoc(taskRef(db)))
  })

  it('既存の notes ルールは変わらない', async () => {
    const db = alice()
    await assertSucceeds(setDoc(doc(db, 'notes', 'n1'), { userId: 'alice', title: 'メモ', content: '' }))
    await assertFails(getDoc(doc(bob(), 'notes', 'n1')))
  })
})

describe('Firestore TaskRepository（Emulator 結合）', () => {
  it('作成・更新・購読・取得がルールを通る', async () => {
    const repo = createFirestoreTaskRepository(alice())
    const task = buildTask({ id: 'r1', title: '実装確認', domain: 'business', dueAt: Date.UTC(2026, 10, 1) })
    await repo.create('alice', task)

    const got = await repo.get('alice', 'r1')
    expect(got).toMatchObject({ id: 'r1', title: '実装確認', revision: 1, dueAt: Date.UTC(2026, 10, 1), updatedBy: 'quickmemo' })
    expect(got.createdAt).toEqual(expect.any(Number))

    await repo.update('alice', 'r1', { status: 'completed', completedAt: Date.now() }, 1)
    expect(await repo.get('alice', 'r1')).toMatchObject({ status: 'completed', revision: 2 })

    // 古い revision からの更新は拒否される（競合検出の前提）
    await expect(repo.update('alice', 'r1', { priority: 1 }, 1)).rejects.toMatchObject({ code: 'permission-denied' })

    const tasks = await new Promise((resolve, reject) => {
      const unsub = repo.subscribe('alice', (list) => { unsub(); resolve(list) }, reject)
    })
    expect(tasks.map(t => t.id)).toEqual(['r1'])
  })

  it('学校タスクの確認不足は Firestore 実装でも拒否される', async () => {
    const repo = createFirestoreTaskRepository(alice())
    const task = buildTask({ id: 's1', title: '授業準備', domain: 'school' })
    await expect(repo.create('alice', task)).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
