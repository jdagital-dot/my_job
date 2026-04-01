export default function Sidebar({ open, notes, currentNoteId, onSelect, onNew, onDelete }) {
  const fmt = (ts) => {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-label">NOTES {notes.length > 0 && <em>{notes.length}</em>}</span>
      </div>

      <div className="note-list">
        {notes.length === 0 && <p className="empty">メモがありません</p>}
        {notes.map(n => (
          <div
            key={n.id}
            className={`note-item${n.id === currentNoteId ? ' active' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            <span className="note-icon">📝</span>
            <div className="note-info">
              <div className="note-title">{n.title || '無題'}</div>
              <div className="note-date">{fmt(n.updatedAt)}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => { e.stopPropagation(); onDelete(n.id) }}
              title="削除"
            >✕</button>
          </div>
        ))}
      </div>

      <button className="new-note-btn" onClick={onNew}>＋ 新規メモ</button>
    </aside>
  )
}
