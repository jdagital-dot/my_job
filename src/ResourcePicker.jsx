import { useState, useMemo } from 'react'

export default function ResourcePicker({ open, resources, onClose, onSelect }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return resources
    return resources.filter(r => r.displayName.toLowerCase().includes(q) ||
      r.tags?.some(t => t.toLowerCase().includes(q)))
  }, [resources, query])

  if (!open) return null

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="resource-picker" role="dialog" aria-modal="true" aria-label="資料を選択">
        <div className="resource-picker-header">
          <span className="resource-picker-title">リンクする資料を選択</span>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <input
          className="resource-search"
          style={{ margin: '8px 16px', width: 'calc(100% - 32px)' }}
          type="text"
          placeholder="検索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        <div className="resource-picker-list">
          {filtered.length === 0 && (
            <p className="empty" style={{ padding: '16px' }}>資料がありません</p>
          )}
          {filtered.map(r => (
            <button
              key={r.id}
              className="resource-picker-item"
              onClick={() => { onSelect(r); setQuery('') }}
            >
              <span style={{ marginRight: 8, color: '#999' }}>
                {r.kind === 'folder' ? '📁' : '📄'}
              </span>
              <span className="resource-picker-name">{r.displayName}</span>
              {r.tags?.length > 0 && (
                <span className="resource-picker-tags">
                  {r.tags.map(t => `#${t}`).join(' ')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
