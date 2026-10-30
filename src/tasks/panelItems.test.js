import { describe, it, expect } from 'vitest'
import { buildPanelItems, extractNoteDeadlineLines, filterChips, matchesChip, sectionOf, sourceLabel } from './panelItems'

const NOW = new Date(2026, 9, 28, 9, 0, 0).getTime()
const due = (m, d) => new Date(2026, m - 1, d, 23, 59, 59).getTime()

function note(id, title, lines) {
  const ops = [{ insert: `${title}\n` }]
  for (const l of lines) {
    ops.push({ insert: `${l.text} ` })
    if (l.deadline) ops.push({ insert: l.deadline, attributes: { tag: 'deadline' } })
    ops.push({ insert: '\n', attributes: { list: l.checked ? 'checked' : 'unchecked', ...(l.taskid ? { taskid: l.taskid } : {}) } })
  }
  return { id, title, content: JSON.stringify({ ops }) }
}

const task = (over) => ({
  id: 't', title: 'タスク', domain: 'personal', status: 'not_started', priority: 3,
  dueAt: null, estimatedMinutes: null, source: 'quickmemo', sourceNoteId: null, syncState: 'synced', ...over,
})

describe('extractNoteDeadlineLines', () => {
  it('期限タグ付きの行を、チェック状態と taskid とともに取り出す', () => {
    const lines = extractNoteDeadlineLines([note('n1', '練習', [
      { text: '体育館の予約', deadline: '10月30日', taskid: 'a' },
      { text: '期限なし' },
      { text: 'ボール購入', deadline: '11月1日', checked: true },
    ])])
    expect(lines.map(l => [l.title, l.month, l.day, l.checked, l.taskId])).toEqual([
      ['体育館の予約', 10, 30, false, 'a'],
      ['ボール購入', 11, 1, true, null],
    ])
  })

  it('削除済みのメモや壊れた本文は無視する', () => {
    expect(extractNoteDeadlineLines([{ ...note('n', 'x', [{ text: 'a', deadline: '1月1日' }]), deleted: true }, { id: 'b', content: '{' }])).toEqual([])
  })
})

describe('buildPanelItems', () => {
  const notes = [note('n1', '練習メモ', [
    { text: '体育館の予約', deadline: '10月30日', taskid: 'linked' },
    { text: '会場に連絡', deadline: '10月29日' },
  ])]
  const tasks = [
    task({ id: 'linked', title: '体育館の予約', sourceNoteId: 'n1', dueAt: due(10, 30), domain: 'table-tennis' }),
    task({ id: 'ai', title: '大会要項を確認', source: 'ai_secretary', dueAt: due(10, 31) }),
    task({ id: 'orphan', title: '元メモが消えたタスク', sourceNoteId: 'deleted-note' }),
    task({ id: 'direct', title: 'タスクノートで追加', dueAt: due(11, 9) }),
    task({ id: 'done', title: '終わったタスク', source: 'ai_secretary', status: 'completed', completedAt: 5 }),
  ]

  it('AI秘書のタスク・メモに紐づくタスク・メモだけの行をまとめ、二重に出さない', () => {
    const { open, completed } = buildPanelItems({ tasks, notes, now: NOW })
    expect(open.map(i => [i.kind, i.title, i.category])).toEqual([
      ['note', '会場に連絡', 'note'],
      ['task', '体育館の予約', 'note'],
      ['task', '大会要項を確認', 'ai'],
      ['task', 'タスクノートで追加', 'direct'],
      ['task', '元メモが消えたタスク', 'unlinked'],
    ])
    expect(open.filter(i => i.title === '体育館の予約')).toHaveLength(1)
    expect(open.find(i => i.id === 'linked')).toMatchObject({ noteId: 'n1', noteTitle: '練習メモ' })
    expect(open.find(i => i.id === 'ai').noteId).toBeNull()
    expect(completed.map(i => i.title)).toEqual(['終わったタスク'])
  })

  it('対応するタスクがまだ届いていない行はメモの行として出す', () => {
    const { open } = buildPanelItems({ tasks: [], notes, now: NOW })
    expect(open.map(i => [i.kind, i.title])).toEqual([['note', '会場に連絡'], ['note', '体育館の予約']])
  })

  it('競合・保存不可のタスクを先頭に出す', () => {
    const { open } = buildPanelItems({ tasks: [...tasks, task({ id: 'c', title: '競合中', syncState: 'conflict' })], notes, now: NOW })
    expect(open[0].title).toBe('競合中')
  })

  it('絞り込みチップ', () => {
    const { open } = buildPanelItems({ tasks, notes, now: NOW })
    expect(filterChips(open).map(c => c.label)).toEqual(['AI秘書', 'タスクノート', '元ノートなし', '練習メモ'])
    expect(open.filter(i => matchesChip(i, 'direct')).map(i => i.title)).toEqual(['タスクノートで追加'])
    expect(open.filter(i => matchesChip(i, 'ai')).map(i => i.title)).toEqual(['大会要項を確認'])
    expect(open.filter(i => matchesChip(i, 'note:n1')).map(i => i.title)).toEqual(['会場に連絡', '体育館の予約'])
  })
})

describe('sectionOf / sourceLabel', () => {
  const now = new Date(2026, 9, 30, 9, 0, 0).getTime()
  it('同期の確認 → 期限超過 → 今日 → 今後 → 期限なし → 完了済みに分ける', () => {
    expect(sectionOf({ kind: 'task', syncState: 'conflict', status: 'completed', dueAt: null }, now)).toBe('problem')
    expect(sectionOf({ kind: 'task', syncState: 'synced', status: 'not_started', dueAt: due(10, 29) }, now)).toBe('overdue')
    expect(sectionOf({ kind: 'task', syncState: 'synced', status: 'in_progress', dueAt: due(10, 30) }, now)).toBe('today')
    expect(sectionOf({ kind: 'note', checked: false, dueAt: due(11, 2) }, now)).toBe('upcoming')
    expect(sectionOf({ kind: 'task', syncState: 'pending', status: 'not_started', dueAt: null }, now)).toBe('nodue')
    expect(sectionOf({ kind: 'note', checked: true, dueAt: due(10, 1) }, now)).toBe('completed')
  })
  it('作成元の表示', () => {
    expect(sourceLabel({ kind: 'task', category: 'ai' })).toBe('AI秘書')
    expect(sourceLabel({ kind: 'task', category: 'note', noteTitle: '練習メモ' })).toBe('練習メモ')
    expect(sourceLabel({ kind: 'task', category: 'unlinked' })).toBe('元ノートなし')
    expect(sourceLabel({ kind: 'task', category: 'direct' })).toBe('タスクノート')
    expect(sourceLabel({ kind: 'note' })).toBe('メモ未紐付け')
  })
})
