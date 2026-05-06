import { useEffect, useRef, useState } from 'react'

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

export default function ResourceItem({
  item, isElectron, onOpen, onShowInFolder, onDelete, onEditTags, onDownload,
}) {
  const [menu, setMenu] = useState(null) // { x, y } | null
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menu) return
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(null)
    }
    const closeOnScroll = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', closeOnScroll, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [menu])

  const handleContextMenu = (e) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const visibleTags = (item.tags || []).slice(0, 2)
  const moreTags = (item.tags?.length || 0) - visibleTags.length

  return (
    <>
      <div
        className="resource-item"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
        onContextMenu={handleContextMenu}
        title={item.path || item.fileName || item.displayName}
      >
        <span className="resource-icon">
          {item.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
        </span>
        <div className="resource-info">
          <div className="resource-name">{item.displayName}</div>
          {(visibleTags.length > 0 || moreTags > 0) && (
            <div className="resource-tags">
              {visibleTags.map(t => <span key={t} className="resource-tag-chip small">{t}</span>)}
              {moreTags > 0 && <span className="resource-tag-more">+{moreTags}</span>}
            </div>
          )}
        </div>
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="resource-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button onClick={() => { setMenu(null); onOpen(item) }}>開く</button>
          {isElectron && (
            <button onClick={() => { setMenu(null); onShowInFolder(item) }}>
              フォルダで表示
            </button>
          )}
          {!isElectron && item.handle?.kind === 'file' && (
            <button onClick={() => { setMenu(null); onDownload(item) }}>
              ダウンロード
            </button>
          )}
          <button onClick={() => { setMenu(null); onEditTags(item) }}>タグ編集</button>
          <button className="danger" onClick={() => { setMenu(null); onDelete(item) }}>削除</button>
        </div>
      )}
    </>
  )
}
