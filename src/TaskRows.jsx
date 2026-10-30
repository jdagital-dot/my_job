import { STATUSES, completionChanges } from './tasks/taskModel'
import { DOMAIN_TAGS, formatDurationTag } from './tasks/noteTaskSync'
import { sourceLabel } from './tasks/panelItems'

// 右上の一覧（NoteListPanel）と仮想ノート「タスク」で共通の1件分の表示

const SYNC_LABELS = { pending: '同期待ち', conflict: '競合', rejected: '保存できません' }

export function formatDue(ms, now) {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const date = sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  const timed = !(d.getHours() === 23 && d.getMinutes() === 59)
  return timed ? `${date} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : date
}

// 完了・完了の取り消し。既存の同期キュー（オフライン再送・競合検出）を通す。
export function toggleTaskCompletion(actions, item, onToast) {
  if (!actions) return
  const result = actions.updateTask(item.id, completionChanges(item.status !== 'completed'))
  if (!result.ok) onToast?.(result.errors[0])
}

export function TaskRow({ item, now, onToggle, onOpenNote, onOpenSyncIssues }) {
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
          <span className={`nlp-source nlp-source-${item.category}`}>{sourceLabel(item)}</span>
          {item.dueAt != null && (
            <span data-tag-type="deadline" className={overdue ? 'nlp-overdue' : undefined}>{formatDue(item.dueAt, now)}</span>
          )}
          {item.estimatedMinutes != null && <span data-tag-type="time">{formatDurationTag(item.estimatedMinutes)}</span>}
          {DOMAIN_TAGS[item.domain] && <span data-tag-type="domain">{DOMAIN_TAGS[item.domain]}</span>}
          <span className="nlp-status">{STATUSES[item.status]}</span>
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

// 正式タスクに未登録のメモの行。二重のタスク化を避けるため完了操作はせず、選ぶと元のメモを開く。
export function NoteLineRow({ item, now, onOpenNote }) {
  const overdue = !item.checked && item.dueAt < now
  return (
    <div className="nlp-item nlp-line" role="button" tabIndex={0}
      aria-label={`「${item.title}」を元のメモ（${item.noteTitle}）で開く`}
      onClick={() => onOpenNote(item.noteId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenNote(item.noteId) } }}>
      <span className="nlp-line-mark" aria-hidden="true">{item.checked ? '☑' : '☐'}</span>
      <div className="nlp-body">
        <div className="nlp-item-title">{item.title}</div>
        <div className="nlp-item-meta">
          <span className="nlp-source nlp-source-unregistered">{sourceLabel(item)}</span>
          <span className="nlp-source nlp-source-note">{item.noteTitle}</span>
          <span data-tag-type="deadline" className={overdue ? 'nlp-overdue' : undefined}>{item.deadlineText}</span>
        </div>
      </div>
    </div>
  )
}

export function renderTaskItem(item, { now, onToggle, onOpenNote, onOpenSyncIssues }) {
  return item.kind === 'task'
    ? <TaskRow key={item.key} item={item} now={now} onToggle={onToggle} onOpenNote={onOpenNote} onOpenSyncIssues={onOpenSyncIssues} />
    : <NoteLineRow key={item.key} item={item} now={now} onOpenNote={onOpenNote} />
}
