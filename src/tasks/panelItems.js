import { inferDueAt } from './noteTaskSync'

// 右上パネル（NOTES）に出す一覧を組み立てる純粋関数。
// - Firebase の正式タスク（taskState.tasks）をすべて出す。メモに紐づかない AI 秘書のタスクも含む
// - メモ内の期限タグ付きの行のうち、正式タスクと対応づいていない行も出す
// - 行の taskid が正式タスクの ID と一致する場合は正式タスクとしてだけ出し、二重に出さない

export const CATEGORY_LABELS = {
  note: 'メモ',
  ai: 'AI秘書',
  direct: 'タスクノート',
  unlinked: '元ノートなし',
}

// メモ本文（Quill Delta）から、期限タグ付きの行を行単位で取り出す
export function extractNoteDeadlineLines(notes) {
  const lines = []
  for (const note of notes) {
    if (!note.content || note.deleted) continue
    let ops
    try {
      const parsed = JSON.parse(note.content)
      ops = parsed.ops ?? parsed
    } catch { continue }
    if (!Array.isArray(ops)) continue

    let text = ''
    let deadline = null
    let index = 0
    const flush = (attrs) => {
      const m = deadline?.match(/(\d+)月(\d+)日/)
      if (m) {
        lines.push({
          key: `${note.id}:${index}`,
          noteId: note.id,
          noteTitle: note.title || '無題',
          title: text.replace(/\s+/g, ' ').trim() || '（タスク名なし）',
          deadlineText: deadline.trim(),
          month: parseInt(m[1]),
          day: parseInt(m[2]),
          checked: attrs?.list === 'checked',
          taskId: attrs?.taskid ?? null,
        })
      }
      text = ''
      deadline = null
      index++
    }
    for (const op of ops) {
      if (typeof op.insert !== 'string') continue
      const tag = op.attributes?.tag
      if (tag === 'deadline') { deadline ??= op.insert; continue }
      if (tag) continue
      const parts = op.insert.split('\n')
      for (let i = 0; i < parts.length; i++) {
        text += parts[i]
        if (i < parts.length - 1) flush(op.attributes)
      }
    }
  }
  return lines
}

// note: 元ノートあり / ai: AI秘書が登録 / direct: 仮想ノート「タスク」で直接追加 / unlinked: 元ノートが削除された
function categoryOf(task, noteById) {
  if (task.sourceNoteId) return noteById.has(task.sourceNoteId) ? 'note' : 'unlinked'
  return task.source === 'ai_secretary' ? 'ai' : 'direct'
}

const PROBLEM_STATES = new Set(['conflict', 'rejected'])

function compareOpen(a, b) {
  const pa = PROBLEM_STATES.has(a.syncState) ? 0 : 1
  const pb = PROBLEM_STATES.has(b.syncState) ? 0 : 1
  if (pa !== pb) return pa - pb
  const da = a.dueAt ?? Infinity
  const db = b.dueAt ?? Infinity
  if (da !== db) return da - db
  return (a.priority ?? 3) - (b.priority ?? 3)
}

export function buildPanelItems({ tasks, notes, now = Date.now() }) {
  const activeNotes = notes.filter(n => !n.deleted)
  const noteById = new Map(activeNotes.map(n => [n.id, n]))
  const taskIds = new Set(tasks.map(t => t.id))

  const taskItems = tasks.map(task => {
    const category = categoryOf(task, noteById)
    return {
      kind: 'task',
      key: `task:${task.id}`,
      id: task.id,
      title: task.title,
      dueAt: task.dueAt ?? null,
      estimatedMinutes: task.estimatedMinutes ?? null,
      domain: task.domain,
      status: task.status,
      priority: task.priority,
      completedAt: task.completedAt ?? null,
      syncState: task.syncState ?? 'synced',
      category,
      noteId: category === 'note' ? task.sourceNoteId : null,
      noteTitle: category === 'note' ? (noteById.get(task.sourceNoteId).title || '無題') : null,
    }
  })

  // 正式タスクと対応づいている行は出さない（同じタスクを二重に出さない）
  const lineItems = extractNoteDeadlineLines(activeNotes)
    .filter(line => !(line.taskId && taskIds.has(line.taskId)))
    .map(line => ({
      kind: 'note',
      key: `line:${line.key}`,
      title: line.title,
      deadlineText: line.deadlineText,
      dueAt: inferDueAt(line.month, line.day, now),
      checked: line.checked,
      category: 'note',
      noteId: line.noteId,
      noteTitle: line.noteTitle,
    }))

  const open = [
    ...taskItems.filter(t => t.status !== 'completed'),
    ...lineItems.filter(l => !l.checked),
  ].sort(compareOpen)

  const completed = [
    ...taskItems.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    ...lineItems.filter(l => l.checked),
  ]

  return { open, completed }
}

// 絞り込みチップ: すべて / AI秘書 / メモ未紐付け / メモごと
export function filterChips(items) {
  const chips = []
  const seenNotes = new Set()
  for (const category of ['ai', 'direct', 'unlinked']) {
    if (items.some(i => i.category === category)) chips.push({ id: category, label: CATEGORY_LABELS[category] })
  }
  for (const item of items) {
    if (item.category !== 'note' || seenNotes.has(item.noteId)) continue
    seenNotes.add(item.noteId)
    chips.push({ id: `note:${item.noteId}`, label: item.noteTitle })
  }
  return chips
}

export function matchesChip(item, chipId) {
  if (!chipId) return true
  if (chipId in CATEGORY_LABELS) return item.category === chipId
  return item.category === 'note' && `note:${item.noteId}` === chipId
}

// ── 表示区分（右上の一覧と仮想ノート「タスク」で共通） ──

export const SECTION_ORDER = ['problem', 'overdue', 'today', 'upcoming', 'nodue', 'completed']
export const SECTION_LABELS = {
  problem: '同期の確認が必要',
  overdue: '期限超過',
  today: '今日が期限',
  upcoming: '今後の期限',
  nodue: '期限なし',
  completed: '完了済み',
}

function endOfDay(now) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
}
function startOfDay(now) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function sectionOf(item, now = Date.now()) {
  if (item.kind === 'task' && PROBLEM_STATES.has(item.syncState)) return 'problem'
  if (item.kind === 'task' ? item.status === 'completed' : item.checked) return 'completed'
  if (item.dueAt == null) return 'nodue'
  if (item.dueAt < startOfDay(now)) return 'overdue'
  if (item.dueAt <= endOfDay(now)) return 'today'
  return 'upcoming'
}

// 一覧を表示区分ごとにまとめる。区分内は buildPanelItems の並び（期限順）を保つ。
export function groupBySection({ open, completed }, now = Date.now()) {
  const groups = Object.fromEntries(SECTION_ORDER.map(s => [s, []]))
  for (const item of [...open, ...completed]) groups[sectionOf(item, now)].push(item)
  return SECTION_ORDER.filter(s => groups[s].length).map(s => ({ section: s, label: SECTION_LABELS[s], items: groups[s] }))
}

// 項目に小さく出す作成元
//   AI秘書 / 元ノート名 / タスクノート / メモ未紐付け（正式タスクに未登録のメモの行） / 元ノートなし
export function sourceLabel(item) {
  if (item.kind === 'note') return 'メモ未紐付け'
  if (item.category === 'note') return item.noteTitle
  return CATEGORY_LABELS[item.category]
}
