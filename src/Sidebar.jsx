function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

export default function Sidebar({ open, notes, currentNoteId, onSelect, onNew, onDelete }) {
  const fmt = (ts) => {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="メモ一覧">
      <div className="sidebar-header">
        <span className="sidebar-label">NOTES {notes.length > 0 && <em>{notes.length}</em>}</span>
      </div>

      <div className="note-list" role="list">
        {notes.length === 0 && <p className="empty">メモがありません</p>}
        {notes.map(n => (
          <div
            key={n.id}
            className={`note-item${n.id === currentNoteId ? ' active' : ''}`}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id) } }}
            role="button"
            tabIndex={0}
            aria-pressed={n.id === currentNoteId}
          >
            <span className="note-icon"><NoteIcon /></span>
            <div className="note-info">
              <div className="note-title">{n.title || '無題'}</div>
              <div className="note-date">{fmt(n.updatedAt)}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(n.id) }}
              aria-label={`「${n.title || '無題'}」を削除`}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>

      <button className="new-note-btn" onClick={onNew} aria-label="新規メモを作成">
        ＋ 新規メモ
      </button>
    </aside>
  )
}
