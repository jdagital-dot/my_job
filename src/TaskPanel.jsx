import { useMemo } from 'react'

function parseDateSortKey(deadlineText) {
  const m = deadlineText.match(/(\d+)月(\d+)日/)
  if (!m) return Infinity
  const now = new Date()
  let year = now.getFullYear()
  const candidate = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]))
  if (candidate < now) year++
  return new Date(year, parseInt(m[1]) - 1, parseInt(m[2])).getTime()
}

function extractTasks(notes) {
  const tasks = []
  for (const note of notes) {
    if (!note.content || note.deleted) continue
    try {
      const parsed = JSON.parse(note.content)
      const ops = parsed.ops ?? parsed
      let lineText = ''
      for (const op of ops) {
        if (typeof op.insert !== 'string') continue
        if (op.attributes?.tag === 'deadline') {
          tasks.push({
            taskText: lineText.trim() || '（タスク名なし）',
            deadline: op.insert,
            noteId: note.id,
            sortKey: parseDateSortKey(op.insert),
          })
          lineText = ''
        } else {
          const nl = op.insert.lastIndexOf('\n')
          lineText = nl >= 0 ? op.insert.slice(nl + 1) : lineText + op.insert
        }
      }
    } catch {}
  }
  return tasks.sort((a, b) => a.sortKey - b.sortKey)
}

export default function TaskPanel({ open, onClose, notes, onNoteSelect }) {
  const tasks = useMemo(() => extractTasks(notes), [notes])

  return (
    <div className={`task-panel${open ? ' open' : ''}`} aria-label="タスク一覧">
      <div className="task-panel-header">
        <span className="task-panel-title">TASKS</span>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div className="task-list">
        {tasks.length === 0
          ? <div className="empty">期限タグのあるタスクがありません<br/><small>タスク行の末尾に /0421 と入力しスペースで追加できます</small></div>
          : tasks.map((t, i) => (
              <div key={i} className="task-item" onClick={() => { onNoteSelect(t.noteId); onClose() }}>
                <div className="task-item-text">{t.taskText}</div>
                <span data-tag-type="deadline">{t.deadline}</span>
              </div>
            ))
        }
      </div>
    </div>
  )
}
