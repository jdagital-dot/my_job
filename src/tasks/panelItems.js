import { inferDueAt } from './noteTaskSync'

// 右上パネル（NOTES）に出す一覧を組み立てる純粋関数。
// - Firebase の正式タスク（taskState.tasks）をすべて出す。メモに紐づかない AI 秘書のタスクも含む
// - メモ内の期限タグ付きの行のうち、正式タスクと対応づいていない行も出す
// - 行の taskid が正式タスクの ID と一致する場合は正式タスクとしてだけ出し、二重に出さない

export const CATEGORY_LABELS = {
  note: 'メモ',
  ai: 'AI秘書',
  unlinked: 'メモ未紐付け',
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

function categoryOf(task, noteById) {
  if (task.sourceNoteId && noteById.has(task.sourceNoteId)) return 'note'
  return task.source === 'ai_secretary' ? 'ai' : 'unlinked'
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
  if (items.some(i => i.category === 'ai')) chips.push({ id: 'ai', label: CATEGORY_LABELS.ai })
  if (items.some(i => i.category === 'unlinked')) chips.push({ id: 'unlinked', label: CATEGORY_LABELS.unlinked })
  for (const item of items) {
    if (item.category !== 'note' || seenNotes.has(item.noteId)) continue
    seenNotes.add(item.noteId)
    chips.push({ id: `note:${item.noteId}`, label: item.noteTitle })
  }
  return chips
}

export function matchesChip(item, chipId) {
  if (!chipId) return true
  if (chipId === 'ai' || chipId === 'unlinked') return item.category === chipId
  return item.category === 'note' && `note:${item.noteId}` === chipId
}
