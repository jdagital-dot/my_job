// 普段のメモから正式タスクを自動登録・更新するための変換処理（Quill に依存しない純粋関数）。
//
// 対象: チェックボックス行（list: unchecked / checked）で、期限タグ（「10月30日」）を含む行。
// 行とタスクの対応は、行の改行に付く Quill の行属性 `taskid` で管理する（本文には書き込まない）。

const DAY = 24 * 60 * 60 * 1000
// NoteListPanel の期限ソートと同じ規則: 今年の日付が60日より前なら翌年とみなす
const PAST_WINDOW_DAYS = 60

export function inferDueAt(month, day, now = Date.now()) {
  const year = new Date(now).getFullYear()
  const thisYear = new Date(year, month - 1, day, 23, 59, 59).getTime()
  const target = now - thisYear > PAST_WINDOW_DAYS * DAY ? year + 1 : year
  return new Date(target, month - 1, day, 23, 59, 59, 0).getTime()
}

// 「1時間30分」「45分」「2時間」→ 分
export function parseTimeTag(text) {
  const m = text?.match(/^(?:(\d+)時間)?(?:(\d+)分)?$/)
  if (!m || (!m[1] && !m[2])) return null
  return (m[1] ? parseInt(m[1]) * 60 : 0) + (m[2] ? parseInt(m[2]) : 0)
}

// 1行分の ops（改行を除く）と行属性から、タスク化に必要な情報を取り出す
export function parseTaskLine(ops, lineFormats = {}) {
  let text = ''
  let deadlineText = null
  let timeText = null
  for (const op of ops) {
    if (typeof op.insert !== 'string') continue
    const tag = op.attributes?.tag
    if (tag === 'deadline') { deadlineText ??= op.insert; continue }
    if (tag === 'time') { timeText ??= op.insert; continue }
    text += op.insert
  }
  const title = text.replace(/\s+/g, ' ').trim()
  const m = deadlineText?.match(/(\d+)月(\d+)日/)
  const isChecklist = lineFormats.list === 'unchecked' || lineFormats.list === 'checked'
  return {
    title,
    deadlineText,
    month: m ? parseInt(m[1]) : null,
    day: m ? parseInt(m[2]) : null,
    estimatedMinutes: parseTimeTag(timeText),
    checked: lineFormats.list === 'checked',
    taskId: lineFormats.taskid ?? null,
    qualifies: isChecklist && !!m && title.length > 0,
  }
}

function sameMonthDay(ms, month, day) {
  if (ms == null) return false
  const d = new Date(ms)
  return d.getMonth() + 1 === month && d.getDate() === day
}

// 新しく登録するタスクの入力値
export function lineToTaskInput(line, { noteId, domain, now = Date.now() }) {
  return {
    title: line.title.slice(0, 200),
    domain,
    dueAt: inferDueAt(line.month, line.day, now),
    estimatedMinutes: line.estimatedMinutes,
    status: line.checked ? 'completed' : 'not_started',
    sourceNoteId: noteId,
  }
}

// 既存タスクへの変更。利用者がその行で変えた部分だけを反映する。
//   textChanged: 行の文字（タスク名・期限・所要時間）を編集した
//   checkToggled: チェックを付け外しした
export function lineChanges(line, task, { textChanged, checkToggled, now = Date.now() }) {
  const changes = {}
  if (textChanged) {
    const title = line.title.slice(0, 200)
    if (title && title !== task.title) changes.title = title
    if (!sameMonthDay(task.dueAt, line.month, line.day)) changes.dueAt = inferDueAt(line.month, line.day, now)
    if (line.estimatedMinutes != null && line.estimatedMinutes !== task.estimatedMinutes) {
      changes.estimatedMinutes = line.estimatedMinutes
    }
  }
  if (checkToggled) {
    if (line.checked && task.status !== 'completed') changes.status = 'completed'
    if (!line.checked && task.status === 'completed') changes.status = 'not_started'
  }
  return changes
}

// 同じ taskid が複数行にある場合（Enter で行属性が引き継がれた・コピーした等）、
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

export const AUTO_TASK_KEY = 'qm_auto_task_settings_v1'

export function loadAutoTaskSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(AUTO_TASK_KEY) || 'null')
    if (saved && typeof saved.enabled === 'boolean' && saved.domain && saved.domain !== 'school') return saved
  } catch { /* 既定値を使う */ }
  return { enabled: true, domain: 'personal' }
}

export function saveAutoTaskSettings(settings, storage = globalThis.localStorage) {
  try { storage?.setItem(AUTO_TASK_KEY, JSON.stringify(settings)) } catch { /* 保存できなくても動作は続ける */ }
}
