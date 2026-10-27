import { describe, it, expect } from 'vitest'
import {
  buildTask, validateTask, filterTasks, toDueAt, splitDueAt, isDateOnly,
  completionChanges, normalizeChanges, extractLegacyDeadlineItems, legacyFingerprint,
} from './taskModel'

const NOW = new Date(2026, 9, 27, 9, 0, 0).getTime()

describe('validateTask', () => {
  it('一般タスクは保存できる', () => {
    expect(validateTask(buildTask({ title: '大会案内を作る', domain: 'table-tennis' }))).toEqual([])
  })

  it('タイトル必須・優先度範囲を検証する', () => {
    expect(validateTask(buildTask({ title: '  ' }))).toContain('タスク名を入力してください')
    expect(validateTask(buildTask({ title: 'a', priority: 6 }))).toContain('優先度は1〜5で指定してください')
  })

  it('学校タスクは非機密確認なしでは保存できない', () => {
    const task = buildTask({ title: '授業準備', domain: 'school' })
    expect(validateTask(task)).toContain('学校タスクは非機密であることの確認が必要です')
    expect(validateTask({ ...task, schoolNonConfidentialConfirmed: true })).toEqual([])
  })

  it('学校タスクに生徒情報らしい語があれば止める', () => {
    const task = buildTask({ title: '生徒の面談準備', domain: 'school', schoolNonConfidentialConfirmed: true })
    expect(validateTask(task).join()).toContain('一般的な作業名に書き換えてください')
  })

  it('個人を特定できる記述は分野を問わず止める', () => {
    const task = buildTask({ title: '連絡', description: '電話番号: 090-0000-0000' })
    expect(validateTask(task).join()).toContain('個人を特定できる')
  })

  it('confidential / uncertain は保存できない', () => {
    const task = buildTask({ title: 'x', sensitivity: 'confidential' })
    expect(validateTask(task)).toContain('機密・不明な情報はタスクとして保存できません')
  })
})

describe('buildTask', () => {
  it('分野から sensitivity を決め、学校以外は確認フラグを false にする', () => {
    expect(buildTask({ title: 'a', domain: 'personal' }).sensitivity).toBe('personal')
    expect(buildTask({ title: 'a', domain: 'business', schoolNonConfidentialConfirmed: true }).schoolNonConfidentialConfirmed).toBe(false)
  })

  it('完了状態で作ると completedAt を持つ', () => {
    expect(buildTask({ title: 'a', status: 'completed', completedAt: 5 }).completedAt).toBe(5)
    expect(buildTask({ title: 'a' }).completedAt).toBeNull()
  })
})

describe('期限', () => {
  it('日付のみは 23:59:59、時刻ありはその時刻', () => {
    const dateOnly = toDueAt('2026-10-30', '')
    expect(isDateOnly(dateOnly)).toBe(true)
    expect(splitDueAt(dateOnly)).toEqual({ date: '2026-10-30', time: '' })
    expect(splitDueAt(toDueAt('2026-10-30', '08:15'))).toEqual({ date: '2026-10-30', time: '08:15' })
  })
})

describe('完了・再開', () => {
  it('完了で completed、再開で not_started に戻る', () => {
    expect(completionChanges(true, 7)).toEqual({ status: 'completed', completedAt: 7 })
    expect(completionChanges(false)).toEqual({ status: 'not_started', completedAt: null })
  })

  it('状態変更時に completedAt を整える', () => {
    expect(normalizeChanges({ status: 'in_progress' }).completedAt).toBeNull()
    expect(normalizeChanges({ status: 'completed' }, 9).completedAt).toBe(9)
  })
})

describe('filterTasks', () => {
  const day = 24 * 60 * 60 * 1000
  const tasks = [
    buildTask({ id: 'today', title: '今日', domain: 'business', dueAt: NOW + 3600_000 }),
    buildTask({ id: 'overdue', title: '超過', domain: 'personal', dueAt: NOW - day }),
    buildTask({ id: 'soon', title: '2日後', domain: 'business', dueAt: NOW + 2 * day, priority: 1 }),
    buildTask({ id: 'later', title: '10日後', domain: 'table-tennis', dueAt: NOW + 10 * day }),
    buildTask({ id: 'nodue', title: '期限なし', domain: 'business', status: 'in_progress' }),
    buildTask({ id: 'done', title: '完了', domain: 'business', status: 'completed', completedAt: NOW }),
  ]
  const ids = (list) => list.map(t => t.id)

  it('今日は期限超過と当日分', () => {
    expect(ids(filterTasks(tasks, { view: 'today' }, NOW))).toEqual(['overdue', 'today'])
  })
  it('期限間近は3日以内', () => {
    expect(ids(filterTasks(tasks, { view: 'soon' }, NOW))).toEqual(['overdue', 'today', 'soon'])
  })
  it('すべては完了以外を期限順', () => {
    expect(ids(filterTasks(tasks, { view: 'all' }, NOW))).toEqual(['overdue', 'today', 'soon', 'later', 'nodue'])
  })
  it('完了済みは完了のみ', () => {
    expect(ids(filterTasks(tasks, { view: 'completed' }, NOW))).toEqual(['done'])
  })
  it('分野・状態で絞り込める', () => {
    expect(ids(filterTasks(tasks, { view: 'all', domain: 'business' }, NOW))).toEqual(['today', 'soon', 'nodue'])
    expect(ids(filterTasks(tasks, { view: 'all', status: 'in_progress' }, NOW))).toEqual(['nodue'])
  })
})

describe('extractLegacyDeadlineItems', () => {
  const note = {
    id: 'n1',
    title: '買い物',
    content: JSON.stringify({ ops: [
      { insert: '買い物\n', attributes: undefined },
      { insert: '牛乳を買う' },
      { insert: '4月21日', attributes: { tag: 'deadline' } },
      { insert: '\n', attributes: { list: 'checked' } },
      { insert: '書類提出 ' },
      { insert: '1時間', attributes: { tag: 'time' } },
      { insert: '12月3日', attributes: { tag: 'deadline' } },
      { insert: '\n', attributes: { list: 'unchecked' } },
      { insert: '期限なし\n' },
    ] }),
  }

  it('期限タグ付きの行を抽出し、年は確定しない', () => {
    const items = extractLegacyDeadlineItems([note])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ noteId: 'n1', taskText: '牛乳を買う', month: 4, day: 21, checked: true })
    expect(items[1]).toMatchObject({ taskText: '書類提出', month: 12, day: 3, checked: false })
    expect(items[0]).not.toHaveProperty('year')
  })

  it('指紋は内容から決定的に作られる', () => {
    const [a] = extractLegacyDeadlineItems([note])
    expect(a.fingerprint).toBe(legacyFingerprint('n1', '牛乳を買う', '4月21日'))
  })

  it('削除済みメモや壊れた本文は無視する', () => {
    expect(extractLegacyDeadlineItems([{ ...note, deleted: true }, { id: 'x', content: '{' }])).toEqual([])
  })
})
