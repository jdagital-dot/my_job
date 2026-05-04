import { useState, useEffect, useMemo } from 'react'
import ResourceItem from './ResourceItem'

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

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
    </svg>
  )
}

export default function Sidebar({
  open, notes, trashedNotes, currentNoteId,
  onSelect, onNew, onDelete,
  onRestore, onPermanentDelete,
  resources = [], allTags = [], resourcesSupported = false, isElectron = false,
  onAddFiles, onAddFolder,
  onOpenResource, onShowResourceInFolder, onDeleteResource, onEditResourceTags, onDownloadResource,
}) {
  const [trashOpen, setTrashOpen] = useState(false)
  const [resourceQuery, setResourceQuery] = useState('')
  const [activeTags, setActiveTags] = useState([])

  useEffect(() => {
    if (trashedNotes.length === 0) setTrashOpen(false)
  }, [trashedNotes.length])

  useEffect(() => {
    setActiveTags(prev => prev.filter(t => allTags.includes(t)))
  }, [allTags])

  const filteredResources = useMemo(() => {
    const q = resourceQuery.trim().toLowerCase()
    return resources.filter(r => {
      if (q && !r.displayName.toLowerCase().includes(q)) return false
      if (activeTags.length > 0 && !activeTags.every(t => r.tags?.includes(t))) return false
      return true
    })
  }, [resources, resourceQuery, activeTags])

  const toggleTag = (t) => {
    setActiveTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

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

      <div className="resource-section">
        <div className="resource-section-header">
          <span className="resource-section-title">資料箱 {resources.length > 0 && <em>{resources.length}</em>}</span>
          {resourcesSupported && (
            <>
              <button
                className="resource-add-btn"
                onClick={onAddFiles}
                aria-label="ファイルを追加"
                title="ファイルを追加"
              >＋ファイル</button>
              <button
                className="resource-add-btn"
                onClick={onAddFolder}
                aria-label="フォルダを追加"
                title="フォルダを追加"
              >＋フォルダ</button>
            </>
          )}
        </div>

        {!resourcesSupported && (
          <p className="empty">このブラウザでは資料箱機能は使えません<small>Chrome / Edge または デスクトップ版をご利用ください</small></p>
        )}

        {resourcesSupported && resources.length === 0 && (
          <p className="empty">資料がありません<small>＋ボタンまたは D&D で追加</small></p>
        )}

        {resourcesSupported && resources.length > 0 && (
          <>
            <input
              className="resource-search"
              type="text"
              placeholder="資料を検索…"
              value={resourceQuery}
              onChange={(e) => setResourceQuery(e.target.value)}
            />
            {allTags.length > 0 && (
              <div className="resource-tag-filter">
                {allTags.map(t => (
                  <button
                    key={t}
                    className={`resource-tag-chip${activeTags.includes(t) ? ' active' : ''}`}
                    onClick={() => toggleTag(t)}
                    aria-pressed={activeTags.includes(t)}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
            <div className="resource-list" role="list">
              {filteredResources.length === 0 && (
                <p className="empty small">該当する資料がありません</p>
              )}
              {filteredResources.map(r => (
                <ResourceItem
                  key={r.id}
                  item={r}
                  isElectron={isElectron}
                  onOpen={onOpenResource}
                  onShowInFolder={onShowResourceInFolder}
                  onDelete={onDeleteResource}
                  onEditTags={onEditResourceTags}
                  onDownload={onDownloadResource}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {trashedNotes.length > 0 && (
        <div className="trash-section">
          <button
            className="trash-toggle"
            onClick={() => setTrashOpen(v => !v)}
            aria-expanded={trashOpen}
          >
            <span className="trash-toggle-label">ゴミ箱 <em>{trashedNotes.length}</em></span>
            <span className={`trash-chevron${trashOpen ? ' open' : ''}`}>›</span>
          </button>
          {trashOpen && (
            <div className="trash-list" role="list">
              {trashedNotes.map(n => (
                <div key={n.id} className="note-item trash-item" role="listitem">
                  <div className="note-info">
                    <div className="note-title">{n.title || '無題'}</div>
                    <div className="note-date">{fmt(n.deletedAt)}</div>
                  </div>
                  <div className="trash-actions">
                    <button
                      className="trash-action-btn restore-btn"
                      onClick={() => onRestore(n.id)}
                      aria-label={`「${n.title || '無題'}」を復元`}
                    >
                      <RestoreIcon />
                    </button>
                    <button
                      className="trash-action-btn perm-delete-btn"
                      onClick={() => onPermanentDelete(n.id)}
                      aria-label={`「${n.title || '無題'}」を完全削除`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="new-note-btn" onClick={onNew} aria-label="新規メモを作成">
        ＋ 新規メモ
      </button>
    </aside>
  )
}
