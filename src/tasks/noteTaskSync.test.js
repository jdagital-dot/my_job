import { describe, it, expect } from 'vitest'
import {
  inferDueAt, parseTimeTag, parseTaskLine, lineToTaskInput, lineChanges,
  duplicateTaskIdLines, loadAutoTaskSettings, saveAutoTaskSettings,
} from './noteTaskSync'

const NOW = new Date(2026, 9, 28, 9, 0, 0).getTime() // 2026-10-28

describe('inferDueAt', () => {
  it('今年の日付が60日以内の過去か未来なら今年', () => {
    expect(new Date(inferDueAt(10, 30, NOW)).getFullYear()).toBe(2026)
    expect(new Date(inferDueAt(9, 1, NOW)).getFullYear()).toBe(2026)
  })
  it('60日より前なら翌年', () => {
    expect(new Date(inferDueAt(4, 21, NOW)).getFullYear()).toBe(2027)
  })
  it('その日の 23:59:59', () => {
    const d = new Date(inferDueAt(10, 30, NOW))
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 30, 23, 59])
  })
})

describe('parseTimeTag', () => {
  it('時間・分を分に直す', () => {
    expect(parseTimeTag('1時間30分')).toBe(90)
    expect(parseTimeTag('45分')).toBe(45)
    expect(parseTimeTag('2時間')).toBe(120)
    expect(parseTimeTag('')).toBeNull()
    expect(parseTimeTag(null)).toBeNull()
  })
})

describe('parseTaskLine', () => {
  const ops = [
    { insert: '大会案内を作る ' },
    { insert: '1時間', attributes: { tag: 'time' } },
    { insert: ' ' },
    { insert: '10月30日', attributes: { tag: 'deadline' } },
  ]

  it('チェック行＋期限タグはタスク化の対象', () => {
    const line = parseTaskLine(ops, { list: 'unchecked' })
    expect(line).toMatchObject({
      title: '大会案内を作る', month: 10, day: 30, estimatedMinutes: 60,
      checked: false, taskId: null, qualifies: true,
    })
  })

  it('期限タグがない・チェック行でない・タスク名がない行は対象外', () => {
    expect(parseTaskLine([{ insert: '大会案内を作る' }], { list: 'unchecked' }).qualifies).toBe(false)
    expect(parseTaskLine(ops, {}).qualifies).toBe(false)
    expect(parseTaskLine(ops, { list: 'bullet' }).qualifies).toBe(false)
    expect(parseTaskLine([{ insert: '10月30日', attributes: { tag: 'deadline' } }], { list: 'unchecked' }).qualifies).toBe(false)
  })

  it('チェック済みと taskid を読む', () => {
    expect(parseTaskLine(ops, { list: 'checked', taskid: 't1' })).toMatchObject({ checked: true, taskId: 't1' })
  })
})

describe('lineToTaskInput / lineChanges', () => {
  const line = parseTaskLine([
    { insert: '体育館の予約' }, { insert: '11月2日', attributes: { tag: 'deadline' } },
  ], { list: 'unchecked' })

  it('新規タスクの入力値', () => {
    const input = lineToTaskInput(line, { noteId: 'n1', domain: 'table-tennis', now: NOW })
    expect(input).toMatchObject({ title: '体育館の予約', domain: 'table-tennis', status: 'not_started', sourceNoteId: 'n1' })
    expect(new Date(input.dueAt).getDate()).toBe(2)
  })

  const task = { title: '体育館の予約', dueAt: inferDueAt(11, 2, NOW), estimatedMinutes: null, status: 'not_started' }

  it('変更がなければ空', () => {
    expect(lineChanges(line, task, { textChanged: true, checkToggled: true, now: NOW })).toEqual({})
  })

  it('文字を編集したときだけタスク名・期限を反映する', () => {
    const edited = { ...line, title: '体育館の予約を確認', month: 11, day: 5 }
    expect(lineChanges(edited, task, { textChanged: false, checkToggled: false, now: NOW })).toEqual({})
    const changes = lineChanges(edited, task, { textChanged: true, checkToggled: false, now: NOW })
    expect(changes.title).toBe('体育館の予約を確認')
    expect(new Date(changes.dueAt).getDate()).toBe(5)
  })

  it('チェックを付け外ししたときだけ状態を反映する（一覧で完了済みでも文字編集では戻さない）', () => {
    const done = { ...task, status: 'completed' }
    expect(lineChanges(line, done, { textChanged: true, checkToggled: false, now: NOW })).toEqual({})
    expect(lineChanges(line, done, { textChanged: false, checkToggled: true, now: NOW })).toEqual({ status: 'not_started' })
    expect(lineChanges({ ...line, checked: true }, task, { textChanged: false, checkToggled: true })).toEqual({ status: 'completed' })
  })

  it('一覧で変えた期限は、同じ月日の行を編集しても上書きしない', () => {
    const moved = { ...task, dueAt: inferDueAt(11, 2, NOW) + 3600_000 * -5 } // 同じ日の別時刻
    expect(lineChanges(line, moved, { textChanged: true, checkToggled: false, now: NOW })).toEqual({})
  })
})

describe('duplicateTaskIdLines', () => {
  it('同じ taskid の行は文字のある1行だけ残す', () => {
    const lines = [
      { taskId: 'a', hasText: true },
      { taskId: 'a', hasText: false },  // Enter で引き継がれた空行
      { taskId: null, hasText: true },
      { taskId: 'b', hasText: false },
      { taskId: 'b', hasText: true },
    ]
    expect(duplicateTaskIdLines(lines).sort()).toEqual([1, 3])
  })
})

describe('自動登録の設定', () => {
  it('既定はオン・プライベート。学校は既定にできない', () => {
    expect(loadAutoTaskSettings()).toEqual({ enabled: true, domain: 'personal' })
    saveAutoTaskSettings({ enabled: false, domain: 'business' })
    expect(loadAutoTaskSettings()).toEqual({ enabled: false, domain: 'business' })
    saveAutoTaskSettings({ enabled: true, domain: 'school' })
    expect(loadAutoTaskSettings()).toEqual({ enabled: true, domain: 'personal' })
  })
})
