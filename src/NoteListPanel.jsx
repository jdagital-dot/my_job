import { useState, useMemo } from 'react'
import { fmtDate } from './dateUtils'

function extractBadges(content) {
  const badges = []
  try {
    const parsed = JSON.parse(content)
    const ops = parsed.ops ?? parsed
    for (const op of ops) {
      if (typeof op.insert === 'string' && op.attributes?.tag) {
        badges.push({ text: op.insert, type: op.attributes.tag })
      }
    }
  } catch {}
  return badges
}

export default function NoteListPanel({ open, onClose, notes, onNoteSelect }) {
  const [selectedId, setSelectedId] = useState(null)

  const sorted = useMemo(() =>
    [...notes]
      .filter(n => !n.deleted)
      .sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() ?? new Date(a.updatedAt).getTime()
        const tb = b.updatedAt?.toMillis?.() ?? new Date(b.updatedAt).getTime()
        return tb - ta
      }),
    [notes]
  )

  const filtered = selectedId ? sorted.filter(n => n.id === selectedId) : sorted

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
        {sorted.map(n => (
          <button
            key={n.id}
            className={`resource-tag-chip${selectedId === n.id ? ' active' : ''}`}
            onClick={() => setSelectedId(prev => prev === n.id ? null : n.id)}
          >
            {n.title || '無題'}
          </button>
        ))}
      </div>

      <div className="nlp-list">
        {filtered.length === 0
          ? <div className="empty">ノートがありません</div>
          : filtered.map(n => {
              const badges = extractBadges(n.content)
              return (
                <div key={n.id} className="nlp-item" onClick={() => { onNoteSelect(n.id); onClose() }}>
                  <div className="nlp-item-title">{n.title || '無題'}</div>
                  <div className="nlp-item-meta">
                    <span className="nlp-item-date">{fmtDate(n.updatedAt)}</span>
                    {badges.map((b, i) => (
                      <span key={i} data-tag-type={b.type}>{b.text}</span>
                    ))}
                  </div>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}
