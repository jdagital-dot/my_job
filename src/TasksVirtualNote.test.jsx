import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('./firebase', () => ({ db: {} }))

import TasksVirtualNote from './TasksVirtualNote'
import SyncIssueDialog from './SyncIssueDialog'
import { useTasks } from './useTasks'
import { createFakeTaskRepository } from './tasks/fakeTaskRepository'
import { buildTask } from './tasks/taskModel'

const UID = 'u1'
const NOW = new Date(2026, 9, 30, 9, 0, 0).getTime()
const at = (m, d) => new Date(2026, m - 1, d, 23, 59, 59).getTime()

function Harness({ repo, notes = [], onOpenNote = () => {} }) {
  const taskState = useTasks(UID, repo)
  const [issuesOpen, setIssuesOpen] = useState(false)
  return (
    <>
      <TasksVirtualNote notes={notes} taskState={taskState} now={NOW}
        onOpenNote={onOpenNote} onOpenSyncIssues={() => setIssuesOpen(true)} />
      <SyncIssueDialog open={issuesOpen} taskState={taskState} onClose={() => setIssuesOpen(false)} />
    </>
  )
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

const aiTask = (over) => ({
  ...buildTask({ domain: 'business', ...over }),
  source: 'ai_secretary', sourceNoteId: null, updatedBy: 'ai_secretary', ...over,
})
const noteTask = (over) => buildTask({ domain: 'table-tennis', sourceNoteId: 'note-1', ...over })

// 通常ノート: 正式タスクに登録済みの行（taskid 付き）と、未登録の期限付きの行
const practiceNote = {
  id: 'note-1', title: '練習メモ',
  content: JSON.stringify({ ops: [
    { insert: '練習メモ\n' },
    { insert: '体育館の予約 ' }, { insert: '10月30日', attributes: { tag: 'deadline' } },
    { insert: '\n', attributes: { list: 'unchecked', taskid: 'n-today' } },
    { insert: '会場に連絡 ' }, { insert: '11月3日', attributes: { tag: 'deadline' } },
    { insert: '\n', attributes: { list: 'unchecked' } },
  ] }),
}

let repo
beforeEach(() => {
  repo = createFakeTaskRepository()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const titlesIn = (sectionName) => {
  const heading = screen.getByRole('heading', { name: new RegExp(`^${sectionName}`) })
  return within(heading.parentElement).queryAllByText((_, el) => el?.classList?.contains('nlp-item-title')).map(e => e.textContent)
}

describe('仮想ノート「タスク」', () => {
  it('通常ノートのタスク・AI秘書のタスク・未登録のメモの行を作成元で分けずに期限の区分順で表示する', () => {
    repo.remoteWrite(UID, aiTask({ id: 'ai-over', title: '請求書を送る', dueAt: at(10, 28) }))
    repo.remoteWrite(UID, noteTask({ id: 'n-today', title: '体育館の予約', dueAt: at(10, 30) }))
    repo.remoteWrite(UID, aiTask({ id: 'ai-next', title: '大会要項を確認する', dueAt: at(11, 5), estimatedMinutes: 30 }))
    repo.remoteWrite(UID, aiTask({ id: 'ai-none', title: '資料を整理する' }))
    repo.remoteWrite(UID, noteTask({ id: 'n-done', title: 'ボール購入', status: 'completed', completedAt: 1 }))
    render(<Harness repo={repo} notes={[practiceNote]} />)

    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent.replace(/\d+$/, ''))
    expect(headings).toEqual(['期限超過', '今日が期限', '今後の期限', '期限なし'])
    expect(titlesIn('期限超過')).toEqual(['請求書を送る'])
    expect(titlesIn('今日が期限')).toEqual(['体育館の予約'])
    expect(titlesIn('今後の期限')).toEqual(['会場に連絡', '大会要項を確認する'])
    expect(titlesIn('期限なし')).toEqual(['資料を整理する'])

    // 作成元を小さく表示する
    const row = (title) => screen.getByText(title).closest('.nlp-item')
    expect(within(row('請求書を送る')).getByText('AI秘書')).toBeInTheDocument()
    expect(within(row('体育館の予約')).getByText('練習メモ')).toBeInTheDocument()
    expect(within(row('会場に連絡')).getByText('メモ未紐付け')).toBeInTheDocument()
    expect(within(row('大会要項を確認する')).getByText('30分')).toBeInTheDocument()
    expect(within(row('大会要項を確認する')).getByText('副業')).toBeInTheDocument()
    expect(within(row('大会要項を確認する')).getByText('未着手')).toBeInTheDocument()

    // 同じタスクを二重に出さない（taskid 付きの行は正式タスクとして1件だけ）
    expect(screen.getAllByText('体育館の予約')).toHaveLength(1)
    // 完了済みは下部で開閉
    expect(screen.queryByText('ボール購入')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完了済み（1）を表示' })).toBeInTheDocument()
  })

  it('通常ノート由来・AI秘書由来とも同じチェックで完了・未完了を切り替え、同期キューを通す', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask({ id: 'ai-1', title: '請求書を送る' }))
    repo.remoteWrite(UID, noteTask({ id: 'n-1', title: '体育館の予約' }))
    render(<Harness repo={repo} notes={[practiceNote]} />)

    await user.click(screen.getByRole('checkbox', { name: '「請求書を送る」を完了にする' }))
    await user.click(screen.getByRole('checkbox', { name: '「体育館の予約」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 'ai-1')).toMatchObject({ status: 'completed', revision: 2, updatedBy: 'quickmemo' })
    expect(repo.raw(UID, 'n-1')).toMatchObject({ status: 'completed', revision: 2 })

    await user.click(screen.getByRole('button', { name: '完了済み（2）を表示' }))
    await user.click(screen.getByRole('checkbox', { name: '「請求書を送る」の完了を取り消す' }))
    await flush()
    expect(repo.raw(UID, 'ai-1')).toMatchObject({ status: 'not_started', completedAt: null, revision: 3 })
    // 表示専用: タスクやノートを新しく作らない
    expect(repo.state.calls.filter(c => c.type === 'create')).toEqual([])
  })

  it('未登録のメモの行は完了操作できず、選ぶと元のメモを開く', async () => {
    const user = userEvent.setup()
    const onOpenNote = vi.fn()
    render(<Harness repo={repo} notes={[practiceNote]} onOpenNote={onOpenNote} />)
    const row = screen.getByText('会場に連絡').closest('.nlp-item')
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '「会場に連絡」を元のメモ（練習メモ）で開く' }))
    expect(onOpenNote).toHaveBeenCalledWith('note-1')
    expect(repo.state.calls).toEqual([])
  })

  it('同期競合中は操作できず、「確認する」から同期の確認を開ける', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask({ id: 'ai-1', title: '請求書を送る' }))
    render(<Harness repo={repo} />)
    repo.state.offline = true
    await user.click(screen.getByRole('checkbox', { name: '「請求書を送る」を完了にする' }))
    await flush()
    repo.state.offline = false
    act(() => repo.remoteWrite(UID, { id: 'ai-1', priority: 1 }))
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await flush()

    expect(screen.getByRole('heading', { name: /^同期の確認が必要/ })).toBeInTheDocument()
    const row = screen.getByText('請求書を送る').closest('.nlp-item')
    expect(within(row).getByRole('checkbox')).toBeDisabled()
    expect(repo.raw(UID, 'ai-1').status).toBe('not_started')
    await user.click(within(row).getByRole('button', { name: '確認する' }))
    expect(screen.getByRole('dialog', { name: '同期の確認' })).toBeInTheDocument()
  })

  it('タスクの追加・更新・完了がリアルタイムで表示に反映される', async () => {
    render(<Harness repo={repo} />)
    act(() => repo.remoteWrite(UID, aiTask({ id: 'ai-1', title: 'AI秘書から追加', dueAt: at(11, 1) })))
    expect(screen.getByText('AI秘書から追加')).toBeInTheDocument()
    act(() => repo.remoteWrite(UID, { id: 'ai-1', title: 'AI秘書で名前を変更' }))
    expect(screen.getByText('AI秘書で名前を変更')).toBeInTheDocument()
    act(() => repo.remoteWrite(UID, { id: 'ai-1', status: 'completed', completedAt: 1 }))
    expect(screen.queryByText('AI秘書で名前を変更')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完了済み（1）を表示' })).toBeInTheDocument()
  })

  it('タスクが0件でも表示する', () => {
    render(<Harness repo={repo} />)
    expect(screen.getByRole('heading', { name: 'タスク' })).toBeInTheDocument()
    expect(screen.getByText('タスクはありません')).toBeInTheDocument()
  })

  it('学校タスクは確認済みなら完了でき、個人情報を含む可能性がある内容は更新を止める', async () => {
    const user = userEvent.setup()
    repo.remoteWrite(UID, aiTask({ id: 's-1', title: '授業準備', domain: 'school', schoolNonConfidentialConfirmed: true }))
    repo.remoteWrite(UID, aiTask({ id: 's-2', title: '成績処理', domain: 'school', schoolNonConfidentialConfirmed: true }))
    render(<Harness repo={repo} />)
    await user.click(screen.getByRole('checkbox', { name: '「授業準備」を完了にする' }))
    await user.click(screen.getByRole('checkbox', { name: '「成績処理」を完了にする' }))
    await flush()
    expect(repo.raw(UID, 's-1').status).toBe('completed')
    expect(repo.raw(UID, 's-2').status).toBe('not_started')
  })
})
