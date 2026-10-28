// 正式タスクのデータモデル。Firestore の /users/{uid}/tasks/{taskId} と
// AI-Secretary の SQLite tasks テーブルで同じ ID・同じ値を使う。
// 制約値は firestore.rules と AI-Secretary の tasksync と一致させること。

export const DOMAINS = {
  school: '学校',
  'table-tennis': '卓球クラブ',
  business: '副業・個人開発',
  personal: 'プライベート',
}

export const STATUSES = {
  not_started: '未着手',
  in_progress: '進行中',
  waiting_review: '確認待ち',
  completed: '完了',
  on_hold: '保留',
}

export const LIMITS = {
  title: 200,
  description: 2000,
  nextAction: 500,
  relatedSchedule: 500,
  relatedMaterial: 500,
  projectId: 100,
  sourceNoteId: 200,
  legacyFingerprint: 200,
  estimatedMinutes: 10080,
}

export const SCHOOL_CONFIRM_TEXT =
  '生徒名・成績・健康・出欠・連絡先・家庭状況・学校内部資料を含まない一般的な作業です'

// AI-Secretary の security/classification.py と同じ判定
const DIRECT_SECRET_PATTERNS = [
  /(?:生徒名|氏名)\s*[:：]\s*\S+/,
  /成績\s*[:：]\s*[0-9Ａ-ＺA-Z]/,
  /(?:電話番号|住所|診断名|個人番号|マイナンバー)\s*[:：]\s*\S+/,
]
const SCHOOL_REVIEW_TERMS = [
  '生徒', '成績', '健康', '出欠', '欠席', '保護者', '家庭状況', '個人票', '通知表', '内申', '診断',
]
const TEXT_FIELDS = ['title', 'description', 'nextAction', 'relatedSchedule', 'relatedMaterial']

export function newId() {
  return crypto.randomUUID()
}

export function sensitivityFor(domain) {
  return domain === 'personal' ? 'personal' : 'general'
}

// 保存前の内容確認。問題がなければ null、あれば利用者向けメッセージを返す。
// メッセージには入力本文を含めない。
export function checkContent(task) {
  const combined = TEXT_FIELDS.map(f => task[f] || '').join(' ')
  if (DIRECT_SECRET_PATTERNS.some(p => p.test(combined))) {
    return '個人を特定できる可能性がある記述が含まれるため保存できません'
  }
  if (task.domain === 'school' && SCHOOL_REVIEW_TERMS.some(t => combined.includes(t))) {
    return '学校の個人情報を含む可能性があります。一般的な作業名に書き換えてください'
  }
  return null
}

// 入力値の検証。エラーメッセージの配列を返す（空なら保存可能）。
export function validateTask(task) {
  const errors = []
  const title = (task.title || '').trim()
  if (!title) errors.push('タスク名を入力してください')
  for (const field of TEXT_FIELDS) {
    if ((task[field] || '').length > LIMITS[field]) errors.push('入力が長すぎます')
  }
  if (!(task.domain in DOMAINS)) errors.push('分野を選択してください')
  if (!(task.status in STATUSES)) errors.push('状態を選択してください')
  if (!Number.isInteger(task.priority) || task.priority < 1 || task.priority > 5) {
    errors.push('優先度は1〜5で指定してください')
  }
  if (task.estimatedMinutes != null &&
      (!Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 0 ||
       task.estimatedMinutes > LIMITS.estimatedMinutes)) {
    errors.push('推定時間は0〜10080分で指定してください')
  }
  if (!['general', 'personal'].includes(task.sensitivity)) {
    errors.push('機密・不明な情報はタスクとして保存できません')
  }
  if (task.domain === 'school') {
    if (task.sensitivity !== 'general' || task.schoolNonConfidentialConfirmed !== true) {
      errors.push('学校タスクは非機密であることの確認が必要です')
    }
  }
  const contentError = checkContent(task)
  if (contentError) errors.push(contentError)
  return [...new Set(errors)]
}

// 新規タスクの初期値。revision / createdAt / updatedAt はリポジトリ層で付与する。
export function buildTask(input) {
  const domain = input.domain ?? 'personal'
  const status = input.status ?? 'not_started'
  return {
    id: input.id ?? newId(),
    title: (input.title ?? '').trim(),
    description: input.description ?? '',
    domain,
    projectId: input.projectId ?? null,
    status,
    priority: input.priority ?? 3,
    dueAt: input.dueAt ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    assignee: input.assignee ?? 'self',
    nextAction: input.nextAction ?? '',
    relatedSchedule: input.relatedSchedule ?? '',
    relatedMaterial: input.relatedMaterial ?? '',
    sensitivity: input.sensitivity ?? sensitivityFor(domain),
    schoolNonConfidentialConfirmed: domain === 'school' ? input.schoolNonConfidentialConfirmed === true : false,
    source: 'quickmemo',
    sourceNoteId: input.sourceNoteId ?? null,
    legacyFingerprint: input.legacyFingerprint ?? null,
    completedAt: status === 'completed' ? (input.completedAt ?? Date.now()) : null,
  }
}

// 完了チェックの変更内容。再開時は元の状態を保持しない初期実装のため not_started に戻す。
export function completionChanges(completed, now = Date.now()) {
  return completed
    ? { status: 'completed', completedAt: now }
    : { status: 'not_started', completedAt: null }
}

// 状態変更時の completedAt の整合
export function normalizeChanges(changes, now = Date.now()) {
  const next = { ...changes }
  if ('status' in next) {
    next.completedAt = next.status === 'completed' ? (next.completedAt ?? now) : null
  }
  if ('domain' in next) {
    if (next.domain !== 'school') next.schoolNonConfidentialConfirmed = false
    if (!('sensitivity' in next)) next.sensitivity = sensitivityFor(next.domain)
  }
  if ('title' in next) next.title = next.title.trim()
  return next
}
