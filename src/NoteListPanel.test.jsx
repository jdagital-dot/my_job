import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('./firebase', () => ({ db: {} }))

import NoteListPanel from './NoteListPanel'
import SyncIssueDialog from './SyncIssueDialog'
import { useTasks } from './useTasks'
import { createFakeTaskRepository } from './tasks/fakeTaskRepository'
import { buildTask } from './tasks/taskModel'

const UID = 'u1'

// App.jsx と同じ組み合わせ（本物の同期キュー＋Fake リポジトリ）
function Harness({ repo, notes = [], onNoteSelect = () => {}, onToast = () => {} }) {
  const taskState = useTasks(UID, repo)
  const [issuesOpen, setIssuesOpen] = useState(false)
  return (
    <>
      <NoteListPanel open notes={notes} taskState={taskState} onClose={() => {}}
        onNoteSelect={onNoteSelect} onOpenSyncIssues={() => setIssuesOpen(true)} onToast={onToast} />
      <SyncIssueDialog open={issuesOpen} taskState={taskState} onClose={() => setIssuesOpen(false)} />
    </>
  )
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

// AI-Secretary が Firestore に書いたタスク（メモに紐づかない）
function aiTask(over = {}) {
  return {
    ...buildTask({ id: 'ai-1', title: '大会要項を確認する', domain: 'table-tennis', ...over }),
    source: 'ai_secretary', sourceNoteId: null, updatedBy: 'ai_secretary', ...over,
  }
}

function noteWithTaskLine(taskId) {
  return {
    id: 'note-1', title: '練習メモ',
    content: JSON.stringify({ ops: [
      { insert: '練習メモ\n' },
      { insert: '体育館の予約 ' }, { insert: '10月30日', attributes: { tag: 'deadline' } },
      { insert: '\n', attributes: { list: 'unchecked', taskid: taskId } },
      { insert: '会場に連絡 ' }, { insert: '10月29日', attributes: { tag: 'deadline' } },
      { insert: '\n', attributes: { list: 'unchecked' } },
    ] }),
  }
}

let repo
beforeEach(() => {
  repo = createFakeTaskRepository()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('NOTES パネルの正式タスク', () => {
  it('AI秘書が登録したメモに紐づかないタスクを表示する', () => {
    repo.remoteWrite(UID, aiTask({ dueAt: new Date(2026, 9, 31, 23, 59, 59).getTime(), estimatedMinutes: 30 }))
    render(<Harness repo={repo} />)
    const row = screen.getByText('大会要項を確認する').closest('.nlp-item')
    expect(within(row).getByText('AI秘書')).toBeInTheDocument()
    expect(within(row).getByText('10月31日')).toBeInTheDocument()
    expect(within(row).getByText('30分')).toBeInTheDocument()
    expect(within(row).getByText('卓球')).toBeInTheDocument()
  })

  it('QuickMemo で完了にでき、取り消せる（同期キュー経由で Firestore に反映）', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask())
    render(<Harness repo={repo} />)

    await user.click(screen.getByRole('checkbox', { name: '「大会要項を確認する」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 'ai-1')).toMatchObject({ status: 'completed', revision: 2, updatedBy: 'quickmemo' })
    expect(repo.raw(UID, 'ai-1').completedAt).toEqual(expect.any(Number))
    expect(screen.queryByText('大会要項を確認する')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '完了済み（1）を表示' }))
    await user.click(screen.getByRole('checkbox', { name: '「大会要項を確認する」の完了を取り消す' }))
    await flush()
    expect(repo.raw(UID, 'ai-1')).toMatchObject({ status: 'not_started', completedAt: null, revision: 3 })
  })

  it('メモに紐づくタスクは1件だけ表示し、選ぶと元のメモへ移動する', async () => {
    const user = userEvent.setup()
    const onNoteSelect = vi.fn()
    repo.remoteWrite(UID, { ...buildTask({ id: 'linked-1', title: '体育館の予約', domain: 'table-tennis', sourceNoteId: 'note-1' }) })
    render(<Harness repo={repo} notes={[noteWithTaskLine('linked-1')]} onNoteSelect={onNoteSelect} />)

    expect(screen.getAllByText('体育館の予約')).toHaveLength(1)
    const row = screen.getByText('体育館の予約').closest('.nlp-item')
    expect(within(row).getByRole('checkbox')).toBeInTheDocument() // 正式タスクとして表示
    await user.click(screen.getByText('体育館の予約'))
    expect(onNoteSelect).toHaveBeenCalledWith('note-1')

    // 正式タスクのない期限付きの行もメモの行として出し、選ぶとメモへ移動する
    await user.click(screen.getByText('会場に連絡'))
    expect(onNoteSelect).toHaveBeenLastCalledWith('note-1')
  })

  it('元のメモがないタスクは独立タスク（メモ未紐付け）として扱う', () => {
    repo.remoteWrite(UID, buildTask({ id: 'q-1', title: '元メモが消えたタスク', sourceNoteId: 'gone' }))
    render(<Harness repo={repo} />)
    const row = screen.getByText('元メモが消えたタスク').closest('.nlp-item')
    expect(within(row).getByText('メモ未紐付け')).toBeInTheDocument()
  })

  it('競合を利用者に表示し、自動で上書きせずに選んでもらう', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask())
    render(<Harness repo={repo} />)
    repo.state.offline = true
    await user.click(screen.getByRole('checkbox', { name: '「大会要項を確認する」を完了にする' }))
    await flush()
    repo.state.offline = false
    act(() => repo.remoteWrite(UID, { id: 'ai-1', priority: 1 })) // AI 秘書側でも更新
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await flush()

    expect(screen.getByText('同期の確認が必要なタスクが1件あります')).toBeInTheDocument()
    const row = screen.getByText('大会要項を確認する').closest('.nlp-item')
    expect(within(row).getByText('競合')).toBeInTheDocument()
    expect(within(row).getByRole('checkbox')).toBeDisabled()
    expect(repo.raw(UID, 'ai-1').status).toBe('not_started') // 上書きしていない

    await user.click(within(row).getByRole('button', { name: '確認する' }))
    const dialog = screen.getByRole('dialog', { name: '同期の確認' })
    await user.click(within(dialog).getByRole('button', { name: 'この端末の内容' }))
    await flush()
    expect(repo.raw(UID, 'ai-1')).toMatchObject({ status: 'completed', priority: 1 })
  })

  it('保存できなかった変更を利用者に表示する', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask())
    repo.update = async () => { const e = new Error('denied'); e.code = 'permission-denied'; throw e }
    repo.get = async (uid, id) => ({ ...repo.raw(uid, id) })
    render(<Harness repo={repo} />)
    await user.click(screen.getByRole('checkbox', { name: '「大会要項を確認する」を完了にする' }))
    await flush()
    expect(screen.getByText('同期の確認が必要なタスクが1件あります')).toBeInTheDocument()
    expect(screen.getByText('保存できません')).toBeInTheDocument()
  })

  it('学校タスクは非機密確認済みなら完了でき、個人情報を含む可能性がある内容は更新を止める', async () => {
    const user = userEvent.setup()
    const onToast = vi.fn()
    repo.remoteWrite(UID, aiTask({ id: 's-1', title: '授業準備', domain: 'school', schoolNonConfidentialConfirmed: true }))
    repo.remoteWrite(UID, aiTask({ id: 's-2', title: '成績処理', domain: 'school', schoolNonConfidentialConfirmed: true }))
    render(<Harness repo={repo} onToast={onToast} />)

    await user.click(screen.getByRole('checkbox', { name: '「授業準備」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 's-1').status).toBe('completed')

    await user.click(screen.getByRole('checkbox', { name: '「成績処理」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 's-2').status).toBe('not_started')
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('学校の個人情報を含む可能性'))
  })
})
