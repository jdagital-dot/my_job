import { useMemo, useRef, useState } from 'react'
import { buildPanelItems, groupBySection } from './tasks/panelItems'
import { TASKS_NOTE_TITLE } from './tasks/virtualNote'
import { renderTaskItem, toggleTaskCompletion } from './TaskRows'

// 仮想ノート「タスク」の本体。通常ノートのタスク・AI秘書のタスク・正式タスクに未登録の
// メモの期限行を、作成元で分けずに 同期の確認 → 期限超過 → 今日 → 今後 → 期限なし → 完了済み の順に表示する。
// 本文の編集・削除・名前変更はできない。操作は正式タスクの追加と、完了・未完了の切り替え。
// 追加はメモと同じ流れ（タスク名 → Enter → 期限 → 時間 → タグ）で、正式タスクだけを作る（メモは作らない）。
export default function TasksVirtualNote({
  notes, taskState, onOpenNote, onOpenSyncIssues, onToast, onStartTaskEntry, now = Date.now(),
}) {
  const [showCompleted, setShowCompleted] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const inputRef = useRef(null)
  const tasks = taskState?.tasks ?? []
  const actions = taskState?.actions

  const groups = useMemo(
    () => groupBySection(buildPanelItems({ tasks, notes, now }), now),
    [tasks, notes, now],
  )
  const openCount = groups.filter(g => g.section !== 'completed').reduce((n, g) => n + g.items.length, 0)
  const toggle = (item) => toggleTaskCompletion(actions, item, onToast)
  const handlers = { now, onToggle: toggle, onOpenNote, onOpenSyncIssues }

  // 画面下の入力欄（期限 → 時間 → タグ）を開く。iPhone でキーボードを閉じないよう、
  // Enter・ボタンの操作の中でそのまま呼ぶ。
  const startEntry = () => {
    const title = newTitle.replace(/\s+/g, ' ').trim()
    if (!title || !onStartTaskEntry || !actions) return
    onStartTaskEntry({
      noteId: null,
      title: title.slice(0, 200),
      deadlineText: '',
      durationText: '',
      apply: () => setNewTitle(''),
      focusAfter: () => inputRef.current?.focus(),
    })
  }

  return (
    <section className="tasks-note" aria-label={TASKS_NOTE_TITLE}>
      <header className="tasks-note-header">
        <h1 className="tasks-note-title">{TASKS_NOTE_TITLE}</h1>
        <span className="tasks-note-count">未完了 {openCount}件</span>
      </header>

      <div className="tasks-note-add">
        <span className="tasks-note-add-box" aria-hidden="true" />
        <input ref={inputRef} className="tasks-note-add-input" value={newTitle} maxLength={200}
          placeholder="タスクを追加" aria-label="追加するタスク名"
          enterKeyHint="next" autoComplete="off" disabled={!actions}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            startEntry()
          }} />
        <button type="button" className="tasks-note-add-btn" onClick={startEntry}
          disabled={!actions || !newTitle.trim()}>追加</button>
      </div>

      {!taskState?.loaded && groups.length === 0 && <p className="empty">読み込み中...</p>}
      {taskState?.loaded && groups.length === 0 && <p className="empty">タスクはありません</p>}

      {groups.map(group => (
        <div key={group.section} className={`tasks-note-section tasks-note-${group.section}`}>
          {group.section === 'completed' ? (
            <button type="button" className="nlp-completed-toggle" aria-expanded={showCompleted}
              onClick={() => setShowCompleted(v => !v)}>
              {showCompleted ? '完了済みを隠す' : `完了済み（${group.items.length}）を表示`}
            </button>
          ) : (
            <h2 className="tasks-note-section-title">{group.label}<span>{group.items.length}</span></h2>
          )}
          {(group.section !== 'completed' || showCompleted) && group.items.map(item => renderTaskItem(item, handlers))}
        </div>
      ))}
    </section>
  )
}
