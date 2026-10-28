import { describe, it, expect } from 'vitest'
import { buildTask, validateTask, completionChanges, normalizeChanges } from './taskModel'

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
