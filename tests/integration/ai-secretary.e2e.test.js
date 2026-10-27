// QuickMemo × AI-Secretary の結合テスト（Firestore Emulator 上のみ。本番には接続しない）
// 実行: AI_SECRETARY_DIR=/path/to/AI-Secretary npm run test:e2e
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { createFirestoreTaskRepository } from '../../src/tasks/taskRepository.js'
import { buildTask } from '../../src/tasks/taskModel.js'

const SECRETARY_DIR = process.env.AI_SECRETARY_DIR
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const UID = `e2e-${Date.now()}`
const enabled = !!SECRETARY_DIR && existsSync(join(SECRETARY_DIR ?? '', 'src', 'secretary'))

let env
let home
let qm

function secretary(...args) {
  const out = execFileSync('python3', ['-m', 'secretary', ...args], {
    cwd: SECRETARY_DIR,
    env: { ...process.env, PYTHONPATH: join(SECRETARY_DIR, 'src'), AI_SECRETARY_HOME: home },
    encoding: 'utf8',
  })
  const parsed = JSON.parse(out)
  if (!parsed.ok) throw new Error(`secretary ${args[0]} ${args[1] ?? ''} failed: ${parsed.error?.type}`)
  return parsed.result
}

describe.skipIf(!enabled)('QuickMemo × AI-Secretary（Emulator 結合）', () => {
  beforeAll(async () => {
    const [host, port] = EMULATOR.split(':')
    env = await initializeTestEnvironment({
      projectId: 'demo-quickmemo',
      firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
    })
    qm = createFirestoreTaskRepository(env.authenticatedContext(UID).firestore())

    // AI-Secretary を一時ディレクトリで動かす（利用者の実DB・設定には触れない）
    home = mkdtempSync(join(tmpdir(), 'ai-secretary-e2e-'))
    cpSync(join(SECRETARY_DIR, 'migrations'), join(home, 'migrations'), { recursive: true })
    mkdirSync(join(home, 'config'))
    writeFileSync(join(home, 'config', 'local.yaml'), JSON.stringify({
      task_sync: {
        provider: 'quickmemo_firestore', enabled: true, mode: 'bidirectional',
        project_id: 'demo-quickmemo', owner_uid: UID, emulator_host: EMULATOR,
      },
    }))
  })

  afterAll(async () => {
    await env?.cleanup()
    if (home) rmSync(home, { recursive: true, force: true })
  })

  it('作成→取り込み→AI更新→QuickMemo反映→完了→朝レビューまで一周する', async () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000

    // 1. QuickMemo で一般タスクを作成
    const task = buildTask({ title: '大会案内を作る', domain: 'table-tennis', priority: 1, dueAt: tomorrow, sourceNoteId: 'note-1' })
    await qm.create(UID, task)

    // 2-3. AI-Secretary で取り込み、SQLite で確認
    expect(secretary('task', 'sync').pulled_count).toBe(1)
    const local = secretary('task', 'list').find(t => t.id === task.id)
    expect(local).toMatchObject({ title: '大会案内を作る', source: 'quickmemo', source_note_id: 'note-1', priority: 1 })

    // 4. AI-Secretary で状態を更新して送信
    secretary('task', 'status', task.id, 'in_progress')
    expect(secretary('task', 'sync').pushed_count).toBe(1)

    // 5. QuickMemo に反映（AI が書いた文書もルールを満たすので QuickMemo から更新できる）
    const afterAi = await qm.get(UID, task.id)
    expect(afterAi).toMatchObject({ status: 'in_progress', revision: 2, updatedBy: 'ai_secretary', sourceNoteId: 'note-1' })
    expect(afterAi.dueAt).toBe(Math.floor(tomorrow / 1000) * 1000)

    // 6. QuickMemo で完了
    await qm.update(UID, task.id, { status: 'completed', completedAt: Date.now() }, afterAi.revision)

    // 7. 次の朝レビューに完了状態が反映される
    const morning = secretary('morning')
    expect(morning.task_sync).toMatchObject({ connected: true, attempted: true, pulled_count: 1, conflict_count: 0 })
    expect(morning.tasks.top_tasks.map(t => t.id)).not.toContain(task.id)
    const done = secretary('task', 'list', '--include-completed').find(t => t.id === task.id)
    expect(done.status).toBe('completed')
  })

  it('承認したタスクだけが QuickMemo に表示され、未承認の提案は出ない', async () => {
    const pending = secretary('task', 'propose', '--title', '未承認の提案', '--domain', 'business')
    const approved = secretary('task', 'propose', '--title', '承認する提案', '--domain', 'business')
    const created = secretary('task', 'approve', approved.id)
    secretary('task', 'sync')

    const remote = await qm.get(UID, created.id)
    expect(remote).toMatchObject({ title: '承認する提案', source: 'ai_secretary', revision: 1 })
    expect(await qm.get(UID, pending.id)).toBeNull()

    // QuickMemo から AI 作成タスクを更新できる（ルール適合の確認）
    await qm.update(UID, created.id, { priority: 2 }, 1)
    secretary('task', 'sync')
    expect(secretary('task', 'list').find(t => t.id === created.id).priority).toBe(2)
  })

  it('学校タスクは確認済みのものだけ同期され、未確認の AI 側タスクは送信されない', async () => {
    const school = buildTask({ title: '授業準備', domain: 'school', schoolNonConfidentialConfirmed: true })
    await qm.create(UID, school)
    const unconfirmed = secretary('task', 'add', '--title', '学年会の準備', '--domain', 'school')
    secretary('task', 'sync')

    expect(secretary('task', 'list', '--domain', 'school').map(t => t.id)).toContain(school.id)
    expect(await qm.get(UID, unconfirmed.id)).toBeNull()
    const status = secretary('task', 'sync-status')
    expect(status.errors).toContainEqual({ task_id: unconfirmed.id, last_error_code: 'school_confirmation_required' })

    secretary('task', 'update', unconfirmed.id, '--confirm-school-non-confidential')
    secretary('task', 'sync')
    expect(await qm.get(UID, unconfirmed.id)).toMatchObject({ schoolNonConfidentialConfirmed: true })
  })

  it('両側の変更は上書きせず競合になり、利用者の選択で解決できる', async () => {
    const task = buildTask({ title: '競合確認', domain: 'business' })
    await qm.create(UID, task)
    secretary('task', 'sync')
    secretary('task', 'update', task.id, '--priority', '1')
    await qm.update(UID, task.id, { priority: 5 }, 1)

    expect(secretary('task', 'sync').conflict_count).toBe(1)
    expect((await qm.get(UID, task.id)).priority).toBe(5)
    expect(secretary('task', 'sync-conflicts')[0]).toMatchObject({ task_id: task.id, differing_fields: ['priority'] })

    secretary('task', 'sync-resolve', task.id, '--prefer', 'local')
    expect((await qm.get(UID, task.id)).priority).toBe(1)
    expect(secretary('task', 'sync').conflict_count).toBe(0)
  })
})
