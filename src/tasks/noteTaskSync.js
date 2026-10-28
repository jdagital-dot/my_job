// メモの行と正式タスクをつなぐ変換処理（Quill に依存しない純粋関数）。
//
// タスクの入力: チェックボックス行にタスクを書いて Enter → 期限 → 時間 → タグ（分野）を順に入力する。
// 確定すると行末に期限・時間・タグのバッジを付け、行の改行に付く行属性 `taskid` でタスクと対応づける。
// 登録後は、その行の編集・チェックの付け外しをタスクへ反映する。

const DAY = 24 * 60 * 60 * 1000
// NoteListPanel の期限ソートと同じ規則: 今年の日付が60日より前なら翌年とみなす
const PAST_WINDOW_DAYS = 60

// 行に付けるタグ（分野）。表示名は利用者が使う呼び方に合わせる。
export const DOMAIN_TAGS = {
  'table-tennis': '卓球',
  business: '副業',
  personal: 'プライベート',
  school: '学校',
}
const DOMAIN_BY_TAG = Object.fromEntries(Object.entries(DOMAIN_TAGS).map(([k, v]) => [v, k]))

export function inferDueAt(month, day, now = Date.now()) {
  const year = new Date(now).getFullYear()
  const thisYear = new Date(year, month - 1, day, 23, 59, 59).getTime()
  const target = now - thisYear > PAST_WINDOW_DAYS * DAY ? year + 1 : year
  return new Date(target, month - 1, day, 23, 59, 59, 0).getTime()
}

function validMonthDay(month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1)) return false
  return day <= new Date(2024, month, 0).getDate() // うるう年を含めた最大日数
}

// 期限の入力: 「1030」「10/30」「10-30」「10月30日」。空欄は期限なし。
// 戻り値: { month, day } / null（なし） / undefined（読めない）
export function parseDeadlineInput(text) {
  const value = (text ?? '').trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (!value) return null
  const m = value.match(/^(\d{1,2})[/\-.月](\d{1,2})日?$/) ?? value.match(/^(\d{2})(\d{2})$/) ?? value.match(/^(\d)(\d{2})$/)
  if (!m) return undefined
  const month = parseInt(m[1])
  const day = parseInt(m[2])
  return validMonthDay(month, day) ? { month, day } : undefined
}

// 時間の入力: 「30」「30m」「30分」「1h」「1時間」「1h30m」「1.5h」。空欄は時間なし。
// 戻り値: 分 / null（なし） / undefined（読めない）
export function parseDurationInput(text) {
  const value = (text ?? '').trim().toLowerCase().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (!value) return null
  let m = value.match(/^(\d+(?:\.\d+)?)\s*(h|時間)$/)
  if (m) return Math.round(parseFloat(m[1]) * 60)
  m = value.match(/^(\d+)\s*(m|分)?$/)
  if (m) return parseInt(m[1])
  m = value.match(/^(\d+)\s*(?:h|時間)\s*(\d+)\s*(?:m|分)?$/)
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2])
  return undefined
}

export function formatDeadlineTag(month, day) {
  return `${month}月${day}日`
}

// 「1時間30分」「45分」「2時間」（エディタの @1h30m タグと同じ表記）
export function formatDurationTag(minutes) {
  const h = Math.floor(minutes / 60)
  const min = minutes % 60
  return (h ? `${h}時間` : '') + (min ? `${min}分` : '') || '0分'
}

export function parseTimeTag(text) {
  const m = text?.match(/^(?:(\d+)時間)?(?:(\d+)分)?$/)
  if (!m || (!m[1] && !m[2])) return null
  return (m[1] ? parseInt(m[1]) * 60 : 0) + (m[2] ? parseInt(m[2]) : 0)
}

// 1行分の ops（改行を除く）と行属性から、タスクに必要な情報を取り出す
export function parseTaskLine(ops, lineFormats = {}) {
  let text = ''
  let deadlineText = null
  let timeText = null
  let domainText = null
  for (const op of ops) {
    if (typeof op.insert !== 'string') continue
    const tag = op.attributes?.tag
    if (tag === 'deadline') { deadlineText ??= op.insert.trim(); continue }
    if (tag === 'time') { timeText ??= op.insert.trim(); continue }
    if (tag === 'domain') { domainText ??= op.insert.trim(); continue }
    if (tag) continue
    text += op.insert
  }
  const title = text.replace(/\s+/g, ' ').trim()
  const m = deadlineText?.match(/(\d+)月(\d+)日/)
  return {
    title,
    month: m ? parseInt(m[1]) : null,
    day: m ? parseInt(m[2]) : null,
    estimatedMinutes: parseTimeTag(timeText),
    domain: DOMAIN_BY_TAG[domainText] ?? null,
    checked: lineFormats.list === 'checked',
    isChecklist: lineFormats.list === 'unchecked' || lineFormats.list === 'checked',
    taskId: lineFormats.taskid ?? null,
  }
}

// 入力欄で決めた内容から、新しいタスクの入力値を作る
export function entryToTaskInput({ title, deadline, minutes, domain, noteId, now = Date.now() }) {
  return {
    title: title.slice(0, 200),
    domain,
    schoolNonConfidentialConfirmed: domain === 'school',
    dueAt: deadline ? inferDueAt(deadline.month, deadline.day, now) : null,
    estimatedMinutes: minutes ?? null,
    status: 'not_started',
    sourceNoteId: noteId,
  }
}

function sameMonthDay(ms, month, day) {
  if (ms == null) return false
  const d = new Date(ms)
  return d.getMonth() + 1 === month && d.getDate() === day
}

// 登録済みタスクへの変更。利用者がその行で変えた部分だけを反映する。
//   textChanged: 行の文字（タスク名・期限・時間）を編集した
//   checkToggled: チェックを付け外しした
export function lineChanges(line, task, { textChanged, checkToggled, now = Date.now() }) {
  const changes = {}
  if (textChanged) {
    const title = line.title.slice(0, 200)
    if (title && title !== task.title) changes.title = title
    if (line.month == null) {
      if (task.dueAt != null) changes.dueAt = null
    } else if (!sameMonthDay(task.dueAt, line.month, line.day)) {
      changes.dueAt = inferDueAt(line.month, line.day, now)
    }
    if ((line.estimatedMinutes ?? null) !== (task.estimatedMinutes ?? null)) {
      changes.estimatedMinutes = line.estimatedMinutes ?? null
    }
  }
  if (checkToggled) {
    if (line.checked && task.status !== 'completed') changes.status = 'completed'
    if (!line.checked && task.status === 'completed') changes.status = 'not_started'
  }
  return changes
}

// 同じ taskid が複数行にある場合（Enter で行属性が引き継がれた等）、
// 残す1行以外から外す行の位置を返す。文字のある行を優先して残す。
export function duplicateTaskIdLines(lines) {
  const byId = new Map()
  lines.forEach((line, index) => {
    if (!line.taskId) return
    if (!byId.has(line.taskId)) byId.set(line.taskId, [])
    byId.get(line.taskId).push(index)
  })
  const strip = []
  for (const indexes of byId.values()) {
    if (indexes.length < 2) continue
    const keep = indexes.find(i => lines[i].hasText) ?? indexes[0]
    for (const i of indexes) if (i !== keep) strip.push(i)
  }
  return strip
}

const LAST_DOMAIN_KEY = 'qm_last_task_domain'

export function loadLastDomain(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(LAST_DOMAIN_KEY)
    if (value && value in DOMAIN_TAGS) return value
  } catch { /* 既定値を使う */ }
  return 'personal'
}

export function saveLastDomain(domain, storage = globalThis.localStorage) {
  try { storage?.setItem(LAST_DOMAIN_KEY, domain) } catch { /* 保存できなくても続ける */ }
}
