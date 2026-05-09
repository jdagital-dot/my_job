import { useState, useMemo } from 'react'

function parseDateSortKey(deadlineText) {
  const m = deadlineText.match(/(\d+)月(\d+)日/)
  if (!m) return Infinity
  const now = new Date()
  const year = now.getFullYear()
  const month = parseInt(m[1]) - 1
  const day = parseInt(m[2])
  const thisYear = new Date(year, month, day)
  if (now - thisYear > 60 * 24 * 60 * 60 * 1000) {
    return new Date(year + 1, month, day).getTime()
  }
  return thisYear.getTime()
}

function extractTasks(notes) {
  const tasks = []
  for (const note of notes) {
    if (!note.content || note.deleted) continue
    try {
      const ops = (JSON.parse(note.content).ops ?? JSON.parse(note.content))
      let lineText = ''
      for (const op of ops) {
        if (typeof op.insert !== 'string') continue
        if (op.attributes?.tag === 'deadline') {
          tasks.push({
            taskText: lineText.trim() || '（タスク名なし）',
            deadline: op.insert,
            noteId: note.id,
            noteTitle: note.title || '無題',
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

export default function NoteListPanel({ open, onClose, notes, onNoteSelect }) {
  const [selectedId, setSelectedId] = useState(null)

  const tasks = useMemo(() => extractTasks(notes), [notes])

  const noteChips = useMemo(() => {
    const seen = new Set()
    return tasks.filter(t => {
      if (seen.has(t.noteId)) return false
      seen.add(t.noteId)
      return true
    }).map(t => ({ id: t.noteId, title: t.noteTitle }))
  }, [tasks])

  const filtered = selectedId ? tasks.filter(t => t.noteId === selectedId) : tasks

  return (
    <div className={`note-list-panel${open ? ' open' : ''}`} aria-label="ノート一覧">
      <div className="note-list-panel-header">
        <span className="note-list-panel-title">NOTES</span>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="nlp-chips">
        <button
          className={`resource-tag-chip${!selectedId ? ' active' : ''}`}
          onClick={() => setSelectedId(null)}
        >すべて</button>
        {noteChips.map(c => (
          <button
            key={c.id}
            className={`resource-tag-chip${selectedId === c.id ? ' active' : ''}`}
            onClick={() => setSelectedId(prev => prev === c.id ? null : c.id)}
          >{c.title}</button>
        ))}
      </div>

      <div className="nlp-list">
        {filtered.length === 0
          ? <div className="empty">期限タグのあるタスクがありません</div>
          : filtered.map((t, i) => (
              <div key={i} className="nlp-item" onClick={() => { onNoteSelect(t.noteId); onClose() }}>
                <div className="nlp-item-title">{t.taskText}</div>
                <div className="nlp-item-meta">
                  <span className="nlp-item-note">{t.noteTitle}</span>
                  <span data-tag-type="deadline">{t.deadline}</span>
                </div>
              </div>
            ))
        }
      </div>
    </div>
  )
}
