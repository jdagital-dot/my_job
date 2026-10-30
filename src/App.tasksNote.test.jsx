import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

// 認証・メモ・資料箱は差し替え、タスクは本物の同期キュー＋Fake リポジトリで動かす
const h = vi.hoisted(() => ({ repo: null, initialNotes: [], calls: [], setNotes: null }))

vi.mock('./firebase', () => ({ db: {}, auth: {}, googleProvider: {} }))
vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, loading: false, authError: null, signIn: () => {}, signOut: () => {} }),
}))
vi.mock('./useResources', () => ({
  useResources: () => ({
    resources: [], allTags: [], isElectron: false, hasFSAccess: false, supported: false,
    addFiles() {}, addFolder() {}, addFromDataTransfer() {}, updateResource() {}, removeResource() {},
    openResource: async () => ({ ok: true }), showInFolder() {}, downloadResource() {}, getResource: () => null,
  }),
}))
vi.mock('./useNotes', () => ({
  useNotes: () => {
    const [notes, setNotes] = useState(h.initialNotes)
    h.setNotes = setNotes
    return {
      notes, loading: false, firestoreOk: true,
      createNote: async () => {
        const id = `new-${h.calls.length}`
        h.calls.push(['create', id])
        setNotes(prev => [{ id, title: '無題', content: JSON.stringify({ ops: [{ insert: '\n' }] }) }, ...prev])
        return id
      },
      updateNote: async (id, values) => {
        h.calls.push(['update', id, values.title])
        setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...values } : n)))
      },
      deleteNote: async (id) => {
        h.calls.push(['delete', id])
        setNotes(prev => prev.map(n => (n.id === id ? { ...n, deleted: true } : n)))
      },
      restoreNote: async () => {}, permanentDeleteNote: async () => {},
      getHistory: () => [], saveHistory: () => {},
    }
  },
}))
vi.mock('./useTasks', async (importOriginal) => {
  const mod = await importOriginal()
  return { useTasks: (uid) => mod.useTasks(uid, h.repo) }
})

import App from './App'
import { createFakeTaskRepository } from './tasks/fakeTaskRepository'
import { buildTask } from './tasks/taskModel'
import { TASKS_NOTE_ID } from './tasks/virtualNote'

const note = (id, title, body = '') => ({
  id, title, updatedAt: '2026-10-30T09:00:00Z',
  content: JSON.stringify({ ops: [{ insert: title }, { insert: '\n', attributes: { header: 1 } }, ...(body ? [{ insert: `${body}\n` }] : [])] }),
})

beforeEach(() => {
  h.repo = createFakeTaskRepository()
  h.calls = []
  h.initialNotes = [note('n1', '練習メモ', '土曜の練習'), note('n2', '買い物')]
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.repo.remoteWrite('u1', {
    ...buildTask({ id: 'ai-1', title: '請求書を送る', domain: 'business' }),
    source: 'ai_secretary', sourceNoteId: null, updatedBy: 'ai_secretary',
  })
})

const sidebar = () => screen.getByRole('complementary', { name: 'メモ一覧' })
const tasksItem = () => within(sidebar()).getByRole('button', { name: /^タスク（未完了/ })

describe('ノート一覧の仮想ノート「タスク」', () => {
  it('一覧の先頭に表示し、選ぶとエディタの代わりにタスクを表示する（削除ボタンはない）', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(document.querySelector('.ql-editor')).not.toBeNull())
    expect(sidebar().querySelector('.note-item').textContent).toContain('タスク') // 一覧の先頭
    expect(within(tasksItem()).queryByRole('button', { name: /を削除/ })).not.toBeInTheDocument()
    expect(tasksItem()).toHaveAccessibleName('タスク（未完了 1件）')

    await user.click(tasksItem())
    const region = screen.getByRole('region', { name: 'タスク' })
    expect(within(region).getByText('請求書を送る')).toBeInTheDocument()
    expect(document.querySelector('.ql-editor')).toBeNull()
    expect(document.getElementById('qm-toolbar')).not.toBeVisible() // 書式ツールバーは使わない
    expect(localStorage.getItem('qm_last_note')).toBe(TASKS_NOTE_ID)
  })

  it('メモ一覧が変わっても、仮想ノートの選択を通常ノートへ戻さない', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(tasksItem())
    act(() => h.setNotes(prev => [...prev, note('n3', '別端末で追加したメモ')]))
    expect(screen.getByRole('region', { name: 'タスク' })).toBeInTheDocument()
  })

  it('前回「タスク」を開いていれば、起動時に「タスク」を開く', () => {
    localStorage.setItem('qm_last_note', TASKS_NOTE_ID)
    render(<App />)
    expect(screen.getByRole('region', { name: 'タスク' })).toBeInTheDocument()
  })

  it('仮想ノートで完了にしたタスクは右上の一覧にも反映され、タスクを新しく作らない', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(tasksItem())
    const region = screen.getByRole('region', { name: 'タスク' })
    await user.click(within(region).getByRole('checkbox', { name: '「請求書を送る」を完了にする' }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(h.repo.raw('u1', 'ai-1').status).toBe('completed')

    const panel = screen.getByLabelText('ノート一覧', { selector: '.note-list-panel' })
    await user.click(within(panel).getByRole('button', { name: '完了済み（1）を表示' }))
    expect(within(panel).getByRole('checkbox', { name: '「請求書を送る」の完了を取り消す' })).toBeInTheDocument()
    expect(h.repo.state.calls.filter(c => c.type === 'create')).toEqual([])
    expect(h.calls.filter(c => c[0] === 'create')).toEqual([]) // ノートも作らない
  })
})

describe('仮想ノート「タスク」から追加', () => {
  it('タスク名 → 期限 → 時間 → タグで正式タスクを1件だけ作り、メモは作らない', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(tasksItem())
    const region = screen.getByRole('region', { name: 'タスク' })

    await user.type(within(region).getByLabelText('追加するタスク名'), '名簿を更新する{Enter}')
    const bar = screen.getByRole('dialog', { name: 'タスクの入力' })
    expect(within(bar).getByLabelText('期限')).toHaveFocus()
    await user.keyboard('1105{Enter}30m{Enter}2')
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const creates = h.repo.state.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(1)
    const created = h.repo.raw('u1', creates[0].id)
    expect(created).toMatchObject({
      title: '名簿を更新する', domain: 'business', estimatedMinutes: 30,
      source: 'quickmemo', sourceNoteId: null, status: 'not_started', revision: 1,
    })
    expect(new Date(created.dueAt).getMonth() + 1).toBe(11)
    expect(h.calls.filter(c => c[0] === 'create')).toEqual([]) // ノートは作らない

    const row = within(region).getByText('名簿を更新する').closest('.nlp-item')
    expect(within(row).getByText('タスクノート')).toBeInTheDocument()
    expect(within(region).getByLabelText('追加するタスク名')).toHaveValue('')
    expect(within(region).getByLabelText('追加するタスク名')).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: 'タスクの入力' })).not.toBeInTheDocument()
  })

  it('入力欄を閉じるとタスクを作らず、書いた名前は残す', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(tasksItem())
    const region = screen.getByRole('region', { name: 'タスク' })
    await user.type(within(region).getByLabelText('追加するタスク名'), '途中のタスク{Enter}')
    await user.keyboard('{Escape}')
    expect(h.repo.state.calls.filter(c => c.type === 'create')).toEqual([])
    expect(within(region).getByLabelText('追加するタスク名')).toHaveValue('途中のタスク')
  })
})

describe('通常ノートの操作は従来どおり', () => {
  it('選択・新規作成・削除ができる', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(tasksItem())
    await user.click(within(sidebar()).getByText('買い物'))
    await waitFor(() => expect(document.querySelector('.ql-editor')?.textContent).toContain('買い物'))
    expect(localStorage.getItem('qm_last_note')).toBe('n2')

    await user.click(screen.getByRole('button', { name: '新規メモを作成' }))
    await waitFor(() => expect(h.calls).toContainEqual(['create', 'new-0']))
    expect(localStorage.getItem('qm_last_note')).toBe('new-0')

    await user.click(within(sidebar()).getByRole('button', { name: '「練習メモ」を削除' }))
    await user.click(within(screen.getByRole('dialog', { name: 'メモを削除' })).getByRole('button', { name: '削除' }))
    await waitFor(() => expect(h.calls).toContainEqual(['delete', 'n1']))
  })

  it('本文を編集すると保存される', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(within(sidebar()).getByText('買い物'))
    await waitFor(() => expect(document.querySelector('.ql-editor')?.textContent).toContain('買い物'))
    const editor = document.querySelector('.ql-editor')
    await user.click(editor)
    await user.type(editor, 'リスト')
    await waitFor(() => expect(h.calls.some(c => c[0] === 'update' && c[1] === 'n2')).toBe(true), { timeout: 4000 })
  })
})
