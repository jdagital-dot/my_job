import { useState, useMemo } from 'react'
import { buildPanelItems, filterChips, matchesChip } from './tasks/panelItems'
import { renderTaskItem, toggleTaskCompletion } from './TaskRows'

// 右上のリストアイコンで開く一覧。
// Firebase の正式タスク（AI 秘書が登録したメモに紐づかないタスクを含む）と、
// メモ内の期限タグ付きの行（正式タスクと対応づいていないもの）をまとめて表示する。
export default function NoteListPanel({
  open, onClose, notes, taskState, onNoteSelect, onOpenSyncIssues, onToast, now = Date.now(),
}) {
  const [selectedChip, setSelectedChip] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const tasks = taskState?.tasks ?? []
  const actions = taskState?.actions

  const items = useMemo(() => buildPanelItems({ tasks, notes, now }), [tasks, notes, now])
  const chips = useMemo(() => filterChips([...items.open, ...items.completed]), [items])
  const visibleOpen = items.open.filter(i => matchesChip(i, selectedChip))
  const visibleCompleted = items.completed.filter(i => matchesChip(i, selectedChip))
  const issueCount = (taskState?.conflicts.length ?? 0) + (taskState?.rejected.length ?? 0)

  const openNote = (noteId) => { onNoteSelect(noteId); onClose() }

  const toggle = (item) => toggleTaskCompletion(actions, item, onToast)
  const renderItem = (item) => renderTaskItem(item, { now, onToggle: toggle, onOpenNote: openNote, onOpenSyncIssues })

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

      {issueCount > 0 && (
        <button type="button" className="nlp-issue-banner" role="alert" onClick={onOpenSyncIssues}>
          同期の確認が必要なタスクが{issueCount}件あります
        </button>
      )}

      <div className="nlp-chips">
        <button
          className={`resource-tag-chip${!selectedChip ? ' active' : ''}`}
          onClick={() => setSelectedChip(null)}
        >すべて</button>
        {chips.map(c => (
          <button
            key={c.id}
            className={`resource-tag-chip${selectedChip === c.id ? ' active' : ''}`}
            onClick={() => setSelectedChip(prev => prev === c.id ? null : c.id)}
          >{c.label}</button>
        ))}
      </div>

      <div className="nlp-list">
        {visibleOpen.length === 0
          ? <div className="empty">未完了のタスクはありません</div>
          : visibleOpen.map(renderItem)}

        {visibleCompleted.length > 0 && (
          <button type="button" className="nlp-completed-toggle" aria-expanded={showCompleted}
            onClick={() => setShowCompleted(v => !v)}>
            {showCompleted ? '完了済みを隠す' : `完了済み（${visibleCompleted.length}）を表示`}
          </button>
        )}
        {showCompleted && visibleCompleted.map(renderItem)}
      </div>
    </div>
  )
}
