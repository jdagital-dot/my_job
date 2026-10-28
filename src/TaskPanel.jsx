import { useMemo, useState } from 'react'
import { DOMAINS, STATUSES, VIEWS, filterTasks, formatDue } from './tasks/taskModel'

const SYNC_LABELS = {
  loading: '読み込み中',
  synced: '同期済み',
  saving: '保存中',
  offline: 'オフライン',
  conflict: '競合あり',
  error: '保存できない変更あり',
}

const ITEM_SYNC_LABELS = { pending: '同期待ち', conflict: '競合', rejected: '保存不可' }

function TaskItem({ task, now, noteExists, onToggle, onEdit, onOpenNote, onResolve, onDiscard }) {
  const done = task.status === 'completed'
  const overdue = !done && task.dueAt != null && task.dueAt < now
  return (
    <div className={`task-item task-entry${done ? ' done' : ''}`}>
      <button type="button" role="checkbox" aria-checked={done}
        className={`task-check${done ? ' checked' : ''}`}
        aria-label={done ? `「${task.title}」を未完了に戻す` : `「${task.title}」を完了にする`}
        onClick={() => onToggle(task)} disabled={task.syncState === 'conflict' || task.syncState === 'rejected'}>
        {done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className="task-body">
        <button type="button" className="task-item-text task-title-btn" onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <div className="task-meta">
          <span className="task-chip">{DOMAINS[task.domain] ?? task.domain}</span>
          <span className={`task-chip prio-${task.priority}`}>P{task.priority}</span>
          {task.dueAt != null && (
            <span className={`task-chip due${overdue ? ' overdue' : ''}`}>{formatDue(task.dueAt, now)}</span>
          )}
          {task.estimatedMinutes != null && <span className="task-chip">{task.estimatedMinutes}分</span>}
          {task.status !== 'not_started' && task.status !== 'completed' && (
            <span className="task-chip status">{STATUSES[task.status]}</span>
          )}
          {ITEM_SYNC_LABELS[task.syncState] && (
            <span className={`task-chip sync-${task.syncState}`}>{ITEM_SYNC_LABELS[task.syncState]}</span>
          )}
          {task.sourceNoteId && noteExists && (
            <button type="button" className="task-link" onClick={() => onOpenNote(task.sourceNoteId)}>メモを開く</button>
          )}
        </div>
        {task.syncState === 'conflict' && (
          <div className="task-resolve">
            <span>他の端末で先に変更されています。</span>
            <button type="button" onClick={() => onResolve(task.id, 'remote')}>最新の内容を使う</button>
            <button type="button" onClick={() => onResolve(task.id, 'local')}>この端末の変更で上書き</button>
          </div>
        )}
        {task.syncState === 'rejected' && (
          <div className="task-resolve">
            <span>この変更は保存できませんでした。</span>
            <button type="button" onClick={() => onDiscard(task.id)}>変更を破棄</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TaskPanel({
  open, onClose, taskState, notes, now = Date.now(),
  onAdd, onEdit, onOpenNote, onOpenLegacyImport, onToast,
  autoTask, onAutoTaskChange,
}) {
  const [view, setView] = useState('today')
  const [domain, setDomain] = useState('')
  const [status, setStatus] = useState('')
  const { tasks, status: syncStatus, actions } = taskState

  // 競合・保存不可のタスクは表示条件に関係なく先頭に出し、解決できるようにする
  const visible = useMemo(() => {
    const problems = tasks.filter(t => t.syncState === 'conflict' || t.syncState === 'rejected')
    const ids = new Set(problems.map(t => t.id))
    return [...problems, ...filterTasks(tasks, { view, domain, status }, now).filter(t => !ids.has(t.id))]
  }, [tasks, view, domain, status, now])
  const noteIds = useMemo(() => new Set(notes.filter(n => !n.deleted).map(n => n.id)), [notes])

  const handleToggle = (task) => {
    const result = actions?.setCompleted(task.id, task.status !== 'completed')
    if (result && !result.ok) onToast?.(result.errors[0])
  }

  const emptyMessage = {
    today: '今日が期限のタスクはありません',
    soon: '期限間近のタスクはありません',
    all: '未完了のタスクはありません',
    completed: '完了したタスクはありません',
  }[view]

  return (
    <div className={`task-panel${open ? ' open' : ''}`} aria-label="タスク一覧">
      <div className="task-panel-header">
        <span className="task-panel-title">TASKS</span>
        <span className={`task-sync task-sync-${syncStatus}`} role="status">{SYNC_LABELS[syncStatus]}</span>
        <button type="button" className="task-add-btn" onClick={onAdd} disabled={!actions}>＋タスク</button>
        <button className="icon-btn" onClick={onClose} aria-label="閉じる">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="task-views" role="tablist" aria-label="表示切替">
        {Object.entries(VIEWS).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key}
            className={`task-view-btn${view === key ? ' active' : ''}`} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="task-filters">
        <select value={domain} onChange={e => setDomain(e.target.value)} aria-label="分野で絞り込み">
          <option value="">すべての分野</option>
          {Object.entries(DOMAINS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="状態で絞り込み">
          <option value="">すべての状態</option>
          {Object.entries(STATUSES).filter(([v]) => v !== 'completed').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="task-list">
        {visible.length === 0
          ? <div className="empty">{taskState.loaded ? emptyMessage : '読み込み中...'}</div>
          : visible.map(task => (
              <TaskItem key={task.id} task={task} now={now}
                noteExists={noteIds.has(task.sourceNoteId)}
                onToggle={handleToggle}
                onEdit={onEdit}
                onOpenNote={(id) => { onOpenNote(id); onClose() }}
                onResolve={(id, prefer) => actions?.resolveConflict(id, prefer)}
                onDiscard={(id) => actions?.discardRejected(id)} />
            ))
        }
      </div>

      <div className="task-panel-footer">
        {autoTask && (
          <div className="task-auto">
            <label className="task-auto-toggle">
              <input type="checkbox" checked={autoTask.enabled}
                onChange={e => onAutoTaskChange({ ...autoTask, enabled: e.target.checked })} />
              <span>メモのチェック行（期限付き）を自動でタスクに</span>
            </label>
            <select value={autoTask.domain} disabled={!autoTask.enabled}
              onChange={e => onAutoTaskChange({ ...autoTask, domain: e.target.value })}
              aria-label="自動登録する分野">
              {Object.entries(DOMAINS).filter(([v]) => v !== 'school').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
        <button type="button" className="task-link" onClick={onOpenLegacyImport}>旧形式の期限タグを確認</button>
      </div>
    </div>
  )
}
