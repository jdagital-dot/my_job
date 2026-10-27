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

export const ASSIGNEES = { self: '自分', ai: 'AI', joint: '共同' }

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

// 期限: 日付のみの場合はその日の 23:59:59（ローカル時刻）として保存する
export function toDueAt(dateStr, timeStr) {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(Number)
    return new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
  }
  return new Date(y, m - 1, d, 23, 59, 59, 0).getTime()
}

export function isDateOnly(ms) {
  if (ms == null) return false
  const d = new Date(ms)
  return d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59
}

function pad(n) { return String(n).padStart(2, '0') }

export function splitDueAt(ms) {
  if (ms == null) return { date: '', time: '' }
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return { date, time: isDateOnly(ms) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export function formatDue(ms, now = Date.now()) {
  if (ms == null) return ''
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const date = sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  return isDateOnly(ms) ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

// ── 表示切替 ───────────────────────────────

function endOfToday(now) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
}

export const VIEWS = {
  today: '今日',
  soon: '期限間近',
  all: 'すべて',
  completed: '完了済み',
}

export const DUE_SOON_DAYS = 3

export function filterTasks(tasks, { view = 'all', domain = '', status = '' } = {}, now = Date.now()) {
  const todayEnd = endOfToday(now)
  const soonEnd = todayEnd + DUE_SOON_DAYS * 24 * 60 * 60 * 1000
  return tasks
    .filter(t => {
      if (view === 'completed') { if (t.status !== 'completed') return false }
      else if (t.status === 'completed') return false
      if (view === 'today' && !(t.dueAt != null && t.dueAt <= todayEnd)) return false
      if (view === 'soon' && !(t.dueAt != null && t.dueAt <= soonEnd)) return false
      if (domain && t.domain !== domain) return false
      if (status && t.status !== status) return false
      return true
    })
    .sort((a, b) => {
      if (view === 'completed') return (b.completedAt ?? 0) - (a.completedAt ?? 0)
      const da = a.dueAt ?? Infinity
      const dbb = b.dueAt ?? Infinity
      if (da !== dbb) return da - dbb
      return a.priority - b.priority
    })
}

// ── 旧形式の期限タグ（/MMDD）───────────────────

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function legacyFingerprint(noteId, taskText, deadlineText) {
  return `legacy-v1:${noteId}:${fnv1a(`${taskText}\n${deadlineText}`)}`
}

// メモ本文（Quill Delta）から期限タグ付きの行を抽出する。年は確定しない。
export function extractLegacyDeadlineItems(notes) {
  const items = []
  const seen = new Map()
  for (const note of notes) {
    if (!note.content || note.deleted) continue
    let ops
    try {
      const parsed = JSON.parse(note.content)
      ops = parsed.ops ?? parsed
    } catch { continue }
    if (!Array.isArray(ops)) continue

    let text = ''
    let deadlines = []
    const flushLine = (lineAttrs) => {
      for (const deadline of deadlines) {
        const taskText = text.trim() || '（タスク名なし）'
        const m = deadline.match(/(\d+)月(\d+)日/)
        items.push({
          noteId: note.id,
          noteTitle: note.title || '無題',
          taskText,
          deadlineText: deadline,
          month: m ? parseInt(m[1]) : null,
          day: m ? parseInt(m[2]) : null,
          checked: lineAttrs?.list === 'checked',
          fingerprint: (() => {
            const base = legacyFingerprint(note.id, taskText, deadline)
            const n = seen.get(base) ?? 0
            seen.set(base, n + 1)
            return n === 0 ? base : `${base}:${n}`
          })(),
        })
      }
      text = ''
      deadlines = []
    }

    for (const op of ops) {
      if (typeof op.insert !== 'string') continue
      if (op.attributes?.tag === 'deadline') { deadlines.push(op.insert); continue }
      if (op.attributes?.tag) continue
      const parts = op.insert.split('\n')
      for (let i = 0; i < parts.length; i++) {
        text += parts[i]
        if (i < parts.length - 1) flushLine(op.attributes)
      }
    }
    if (deadlines.length) flushLine(null)
  }
  return items
}
