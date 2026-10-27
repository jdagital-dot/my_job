import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('./firebase', () => ({ db: {} }))

import TaskPanel from './TaskPanel'
import TaskEditor from './TaskEditor'
import LegacyTagImport from './LegacyTagImport'
import { useTasks } from './useTasks'
import { createFakeTaskRepository } from './tasks/fakeTaskRepository'

const UID = 'u1'

// App.jsx と同じ組み合わせ方をする最小のハーネス
function Harness({ repo, notes = [] }) {
  const taskState = useTasks(UID, repo)
  const [editor, setEditor] = useState(null)
  const [legacy, setLegacy] = useState(false)
  const save = (values) => {
    const r = editor.mode === 'edit'
      ? taskState.actions.updateTask(editor.task.id, values)
      : taskState.actions.createTask(values)
    if (r.ok) setEditor(null)
    return r
  }
  return (
    <>
      <TaskPanel open taskState={taskState} notes={notes} onClose={() => {}}
        onAdd={() => setEditor({ mode: 'create', task: null })}
        onEdit={(task) => setEditor({ mode: 'edit', task })}
        onOpenNote={() => {}} onOpenLegacyImport={() => setLegacy(true)} />
      <TaskEditor open={!!editor} mode={editor?.mode} task={editor?.task}
        onSave={save} onCancel={() => setEditor(null)} />
      <LegacyTagImport open={legacy} notes={notes} tasks={taskState.tasks}
        onImport={(drafts) => drafts.map(d => taskState.actions.createTask(d)).filter(r => !r.ok).map(r => r.errors[0])}
        onClose={() => setLegacy(false)} />
    </>
  )
}

let repo
beforeEach(() => {
  repo = createFakeTaskRepository()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function addTask(user, { title, domain }) {
  await user.click(screen.getByRole('button', { name: '＋タスク' }))
  const dialog = screen.getByRole('dialog', { name: 'タスクを追加' })
  await user.type(within(dialog).getByLabelText('タスク名'), title)
  await user.selectOptions(within(dialog).getByLabelText('分野'), domain)
  return dialog
}

describe('タスク画面', () => {
  it('＋タスクから追加でき、Firestore に同期される', async () => {
    const user = userEvent.setup()
    render(<Harness repo={repo} />)
    const dialog = await addTask(user, { title: '大会案内を作る', domain: 'table-tennis' })
    await user.click(within(dialog).getByRole('radio', { name: '1' }))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await flush()

    await user.click(screen.getByRole('tab', { name: 'すべて' }))
    expect(screen.getByText('大会案内を作る')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('同期済み')
  })

  it('一覧から完了・再開でき、完了済みは通常一覧から消える', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, { id: 't1', title: '授業準備', domain: 'business', status: 'not_started', priority: 3, sensitivity: 'general', dueAt: null, completedAt: null })
    render(<Harness repo={repo} />)
    await user.click(screen.getByRole('tab', { name: 'すべて' }))

    await user.click(screen.getByRole('checkbox', { name: '「授業準備」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 't1').status).toBe('completed')
    expect(screen.queryByText('授業準備')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '完了済み' }))
    await user.click(screen.getByRole('checkbox', { name: '「授業準備」を未完了に戻す' }))
    await flush()
    expect(repo.raw(UID, 't1').status).toBe('not_started')
  })

  it('学校タスクは非機密確認なしには保存できない', async () => {
    const user = userEvent.setup()
    render(<Harness repo={repo} />)
    const dialog = await addTask(user, { title: '授業準備', domain: 'school' })
    expect(within(dialog).getByText(/生徒名・成績・健康・出欠・連絡先・家庭状況・学校内部資料を含まない/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('学校タスクは非機密であることの確認が必要です')
    expect(repo.state.calls).toHaveLength(0)

    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await flush()
    expect(repo.state.calls).toHaveLength(1)
  })

  it('分野・状態で絞り込める', async () => {
    const user = userEvent.setup()
    const base = { status: 'not_started', priority: 3, sensitivity: 'general', dueAt: null, completedAt: null }
    repo.remoteWrite(UID, { ...base, id: 'a', title: '卓球の連絡', domain: 'table-tennis' })
    repo.remoteWrite(UID, { ...base, id: 'b', title: 'アプリ改修', domain: 'business', status: 'in_progress' })
    render(<Harness repo={repo} />)
    await user.click(screen.getByRole('tab', { name: 'すべて' }))
    await user.selectOptions(screen.getByLabelText('分野で絞り込み'), 'table-tennis')
    expect(screen.getByText('卓球の連絡')).toBeInTheDocument()
    expect(screen.queryByText('アプリ改修')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('分野で絞り込み'), '')
    await user.selectOptions(screen.getByLabelText('状態で絞り込み'), 'in_progress')
    expect(screen.getByText('アプリ改修')).toBeInTheDocument()
    expect(screen.queryByText('卓球の連絡')).not.toBeInTheDocument()
  })

  it('競合中のタスクは解決方法を選べる', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, { id: 'c', title: '競合タスク', domain: 'business', status: 'not_started', priority: 3, sensitivity: 'general', dueAt: null, completedAt: null })
    render(<Harness repo={repo} />)
    await user.click(screen.getByRole('tab', { name: 'すべて' }))
    repo.state.offline = true
    await user.click(screen.getByRole('checkbox', { name: '「競合タスク」を完了にする' }))
    await flush()
    repo.state.offline = false
    act(() => repo.remoteWrite(UID, { id: 'c', priority: 1 }))
    await flush()
    await user.click(screen.getByRole('tab', { name: '今日' }))
    expect(screen.getByRole('status')).toHaveTextContent('競合あり')
    expect(screen.getByText('競合タスク')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '最新の内容を使う' }))
    expect(screen.getByRole('status')).toHaveTextContent('同期済み')
    expect(repo.raw(UID, 'c').status).toBe('not_started')
  })
})

describe('旧形式の期限タグ', () => {
  const notes = [{
    id: 'n1', title: 'やること',
    content: JSON.stringify({ ops: [
      { insert: 'やること\n' },
      { insert: '書類提出' }, { insert: '4月21日', attributes: { tag: 'deadline' } },
      { insert: '\n', attributes: { list: 'unchecked' } },
    ] }),
  }]

  it('自動では移行せず、年と分野を選んだ項目だけ登録する', async () => {
    const user = userEvent.setup()
    render(<Harness repo={repo} notes={notes} />)
    await flush()
    expect(repo.state.calls).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '旧形式の期限タグを確認' }))
    const dialog = screen.getByRole('dialog', { name: '旧形式の期限タグを確認' })
    await user.click(within(dialog).getByLabelText('「書類提出」を選択'))
    const submit = within(dialog).getByRole('button', { name: '選択した1件を登録' })
    expect(submit).toBeDisabled()
    expect(within(dialog).getByText('選んだ項目の年を選択してください')).toBeInTheDocument()

    const year = new Date().getFullYear() + 1
    await user.selectOptions(within(dialog).getByLabelText('「書類提出」の年'), String(year))
    await user.selectOptions(within(dialog).getByLabelText('登録する分野'), 'business')
    await user.click(submit)
    await user.click(within(dialog).getByRole('button', { name: '登録する' }))
    await flush()

    const created = repo.state.calls.filter(c => c.type === 'create')
    expect(created).toHaveLength(1)
    const task = repo.raw(UID, created[0].id)
    expect(task).toMatchObject({ title: '書類提出', sourceNoteId: 'n1', status: 'not_started' })
    expect(task.legacyFingerprint).toMatch(/^legacy-v1:n1:/)
    expect(new Date(task.dueAt).getFullYear()).toBe(year)
    // 元メモは変更しない
    expect(notes[0].content).toContain('4月21日')

    await user.click(screen.getByRole('button', { name: '旧形式の期限タグを確認' }))
    const again = screen.getByRole('dialog', { name: '旧形式の期限タグを確認' })
    expect(within(again).getByText('取り込み済み')).toBeInTheDocument()
    expect(within(again).getByLabelText('「書類提出」を選択')).toBeDisabled()
  })
})
