import { describe, it, expect } from 'vitest'
import {
  inferDueAt, parseDeadlineInput, parseDurationInput, formatDeadlineTag, formatDurationTag,
  parseTimeTag, parseTaskLine, entryToTaskInput, lineChanges, duplicateTaskIdLines,
  loadLastDomain, saveLastDomain,
} from './noteTaskSync'

const NOW = new Date(2026, 9, 28, 9, 0, 0).getTime() // 2026-10-28

describe('inferDueAt', () => {
  it('今年の日付が60日以内の過去か未来なら今年、60日より前なら翌年', () => {
    expect(new Date(inferDueAt(10, 30, NOW)).getFullYear()).toBe(2026)
    expect(new Date(inferDueAt(9, 1, NOW)).getFullYear()).toBe(2026)
    expect(new Date(inferDueAt(4, 21, NOW)).getFullYear()).toBe(2027)
  })
})

describe('parseDeadlineInput', () => {
  it('いろいろな書き方を読む', () => {
    for (const text of ['1030', '10/30', '10-30', '10月30日', '１０３０']) {
      expect(parseDeadlineInput(text)).toEqual({ month: 10, day: 30 })
    }
    expect(parseDeadlineInput('105')).toEqual({ month: 1, day: 5 })
    expect(parseDeadlineInput('2/29')).toEqual({ month: 2, day: 29 })
  })
  it('空欄はなし、読めない・存在しない日付は undefined', () => {
    expect(parseDeadlineInput('')).toBeNull()
    expect(parseDeadlineInput('  ')).toBeNull()
    expect(parseDeadlineInput('abc')).toBeUndefined()
    expect(parseDeadlineInput('1340')).toBeUndefined()
    expect(parseDeadlineInput('4/31')).toBeUndefined()
  })
})

describe('parseDurationInput', () => {
  it('分・時間を読む', () => {
    expect(parseDurationInput('30')).toBe(30)
    expect(parseDurationInput('30m')).toBe(30)
    expect(parseDurationInput('45分')).toBe(45)
    expect(parseDurationInput('1h')).toBe(60)
    expect(parseDurationInput('1.5h')).toBe(90)
    expect(parseDurationInput('2時間')).toBe(120)
    expect(parseDurationInput('1h30m')).toBe(90)
    expect(parseDurationInput('1時間30分')).toBe(90)
  })
  it('空欄はなし、読めないものは undefined', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('すぐ')).toBeUndefined()
  })
})

describe('タグ表記', () => {
  it('期限と時間をエディタのタグと同じ表記にする', () => {
    expect(formatDeadlineTag(10, 30)).toBe('10月30日')
    expect(formatDurationTag(90)).toBe('1時間30分')
    expect(formatDurationTag(45)).toBe('45分')
    expect(formatDurationTag(120)).toBe('2時間')
    expect(parseTimeTag(formatDurationTag(90))).toBe(90)
  })
})

describe('parseTaskLine', () => {
  const ops = [
    { insert: '大会案内を作る ' },
    { insert: '10月30日', attributes: { tag: 'deadline' } },
    { insert: ' ' },
    { insert: '1時間', attributes: { tag: 'time' } },
    { insert: ' ' },
    { insert: '卓球', attributes: { tag: 'domain' } },
  ]

  it('タスク名・期限・時間・タグを読み分ける', () => {
    expect(parseTaskLine(ops, { list: 'unchecked', taskid: 't1' })).toMatchObject({
      title: '大会案内を作る', month: 10, day: 30, estimatedMinutes: 60,
      domain: 'table-tennis', checked: false, isChecklist: true, taskId: 't1',
    })
  })

  it('タグに空白が入っていても読める', () => {
    const spaced = parseTaskLine([
      { insert: '練習 ' }, { insert: '10月30日 ', attributes: { tag: 'deadline' } },
      { insert: '1時間 ', attributes: { tag: 'time' } }, { insert: '卓球', attributes: { tag: 'domain' } },
    ], { list: 'unchecked' })
    expect(spaced).toMatchObject({ title: '練習', month: 10, day: 30, estimatedMinutes: 60, domain: 'table-tennis' })
  })

  it('チェック行かどうか・チェック済みかを読む', () => {
    expect(parseTaskLine(ops, {}).isChecklist).toBe(false)
    expect(parseTaskLine(ops, { list: 'checked' }).checked).toBe(true)
  })
})

describe('entryToTaskInput', () => {
  it('入力欄の内容からタスクを作る', () => {
    const input = entryToTaskInput({ title: '体育館の予約', deadline: { month: 11, day: 2 }, minutes: 30, domain: 'table-tennis', noteId: 'n1', now: NOW })
    expect(input).toMatchObject({ title: '体育館の予約', domain: 'table-tennis', estimatedMinutes: 30, status: 'not_started', sourceNoteId: 'n1' })
    expect(new Date(input.dueAt).getDate()).toBe(2)
  })
  it('期限・時間は省略できる。学校は確認済みとして作る（入力欄で確認するため）', () => {
    const input = entryToTaskInput({ title: '授業準備', deadline: null, minutes: null, domain: 'school', noteId: 'n1' })
    expect(input).toMatchObject({ dueAt: null, estimatedMinutes: null, schoolNonConfidentialConfirmed: true })
  })
})

describe('lineChanges', () => {
  const line = parseTaskLine([
    { insert: '体育館の予約 ' }, { insert: '11月2日', attributes: { tag: 'deadline' } },
  ], { list: 'unchecked', taskid: 't1' })
  const task = { title: '体育館の予約', dueAt: inferDueAt(11, 2, NOW), estimatedMinutes: null, status: 'not_started' }

  it('変更がなければ空', () => {
    expect(lineChanges(line, task, { textChanged: true, checkToggled: true, now: NOW })).toEqual({})
  })

  it('文字を編集したときだけタスク名・期限を反映する', () => {
    const edited = { ...line, title: '体育館の予約を確認', month: 11, day: 5 }
    expect(lineChanges(edited, task, { textChanged: false, checkToggled: false })).toEqual({})
    const changes = lineChanges(edited, task, { textChanged: true, checkToggled: false, now: NOW })
    expect(changes.title).toBe('体育館の予約を確認')
    expect(new Date(changes.dueAt).getDate()).toBe(5)
  })

  it('期限・時間のタグを消すとタスクからも外す', () => {
    const removed = { ...line, month: null, day: null }
    expect(lineChanges(removed, { ...task, estimatedMinutes: 30 }, { textChanged: true, checkToggled: false }))
      .toEqual({ dueAt: null, estimatedMinutes: null })
  })

  it('チェックを付け外ししたときだけ状態を反映する', () => {
    const done = { ...task, status: 'completed' }
    expect(lineChanges(line, done, { textChanged: true, checkToggled: false, now: NOW })).toEqual({})
    expect(lineChanges(line, done, { textChanged: false, checkToggled: true })).toEqual({ status: 'not_started' })
    expect(lineChanges({ ...line, checked: true }, task, { textChanged: false, checkToggled: true })).toEqual({ status: 'completed' })
  })
})

describe('duplicateTaskIdLines', () => {
  it('同じ taskid の行は文字のある1行だけ残す', () => {
    const lines = [
      { taskId: 'a', hasText: true },
      { taskId: 'a', hasText: false },
      { taskId: null, hasText: true },
      { taskId: 'b', hasText: false },
      { taskId: 'b', hasText: true },
    ]
    expect(duplicateTaskIdLines(lines).sort()).toEqual([1, 3])
  })
})

describe('前回のタグ', () => {
  it('既定はプライベートで、選んだタグを覚える', () => {
    expect(loadLastDomain()).toBe('personal')
    saveLastDomain('table-tennis')
    expect(loadLastDomain()).toBe('table-tennis')
  })
})
