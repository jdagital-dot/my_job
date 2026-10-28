import { useState, useMemo } from 'react'
import { STATUSES, completionChanges } from './tasks/taskModel'
import { DOMAIN_TAGS, formatDurationTag } from './tasks/noteTaskSync'
import { CATEGORY_LABELS, buildPanelItems, filterChips, matchesChip } from './tasks/panelItems'

const SYNC_LABELS = { pending: '同期待ち', conflict: '競合', rejected: '保存できません' }

function formatDue(ms, now) {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const date = sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  const timed = !(d.getHours() === 23 && d.getMinutes() === 59)
  return timed ? `${date} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : date
}

function TaskRow({ item, now, onToggle, onOpenNote, onOpenSyncIssues }) {
  const done = item.status === 'completed'
  const problem = item.syncState === 'conflict' || item.syncState === 'rejected'
  const overdue = !done && item.dueAt != null && item.dueAt < now
  const openNote = item.noteId ? () => onOpenNote(item.noteId) : undefined
  return (
    <div className={`nlp-item nlp-task${done ? ' done' : ''}${openNote ? '' : ' no-note'}`} onClick={openNote}>
      <button type="button" role="checkbox" aria-checked={done} disabled={problem}
        className={`nlp-check${done ? ' checked' : ''}`}
        aria-label={done ? `「${item.title}」の完了を取り消す` : `「${item.title}」を完了にする`}
        onClick={(e) => { e.stopPropagation(); onToggle(item) }}>
        {done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className="nlp-body">
        <div className="nlp-item-title">{item.title}</div>
        <div className="nlp-item-meta">
          <span className={`nlp-source nlp-source-${item.category}`}>
            {item.category === 'note' ? item.noteTitle : CATEGORY_LABELS[item.category]}
          </span>
          {item.dueAt != null && (
            <span data-tag-type="deadline" className={overdue ? 'nlp-overdue' : undefined}>{formatDue(item.dueAt, now)}</span>
          )}
          {item.estimatedMinutes != null && <span data-tag-type="time">{formatDurationTag(item.estimatedMinutes)}</span>}
          {DOMAIN_TAGS[item.domain] && <span data-tag-type="domain">{DOMAIN_TAGS[item.domain]}</span>}
          {item.status !== 'not_started' && item.status !== 'completed' && (
            <span className="nlp-status">{STATUSES[item.status]}</span>
          )}
          {SYNC_LABELS[item.syncState] && (
            <span className={`nlp-sync nlp-sync-${item.syncState}`} role={problem ? 'alert' : undefined}>
              {SYNC_LABELS[item.syncState]}
            </span>
          )}
          {problem && (
            <button type="button" className="nlp-resolve"
              onClick={(e) => { e.stopPropagation(); onOpenSyncIssues() }}>確認する</button>
          )}
        </div>
      </div>
    </div>
  )
}

function NoteLineRow({ item, now, onOpenNote }) {
  const overdue = !item.checked && item.dueAt < now
  return (
    <div className="nlp-item nlp-line" onClick={() => onOpenNote(item.noteId)}>
      <span className="nlp-line-mark" aria-hidden="true">{item.checked ? '☑' : '☐'}</span>
      <div className="nlp-body">
        <div className="nlp-item-title">{item.title}</div>
        <div className="nlp-item-meta">
          <span className="nlp-source nlp-source-note">{item.noteTitle}</span>
          <span data-tag-type="deadline" className={overdue ? 'nlp-overdue' : undefined}>{item.deadlineText}</span>
        </div>
      </div>
    </div>
  )
}

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

  const toggle = (item) => {
    if (!actions) return
    // 既存の同期キュー（オフライン再送・競合検出）を通して更新する
    const result = actions.updateTask(item.id, completionChanges(item.status !== 'completed'))
    if (!result.ok) onToast?.(result.errors[0])
  }

  const renderItem = (item) => item.kind === 'task'
    ? <TaskRow key={item.key} item={item} now={now} onToggle={toggle} onOpenNote={openNote} onOpenSyncIssues={onOpenSyncIssues} />
    : <NoteLineRow key={item.key} item={item} now={now} onOpenNote={openNote} />

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
