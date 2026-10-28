import { useEffect } from 'react'

// タスク同期で、他の端末や AI 秘書と同じタスクを同時に変更した（競合）／保存を拒否された変更を
// 1件ずつ確認してもらうダイアログ。自動では上書きしない。

export default function SyncIssueDialog({ open, taskState, onClose }) {
  const { tasks, conflicts, rejected, actions } = taskState
  const conflictId = conflicts[0]
  const rejectedId = conflictId ? null : rejected[0]
  const done = !conflictId && !rejectedId

  // すべて解決したら閉じる
  useEffect(() => { if (open && done) onClose() }, [open, done, onClose])

  if (!open || done) return null
  const titleOf = (id) => tasks.find(t => t.id === id)?.title ?? 'タスク'

  return (
    <>
      <div className="overlay task-editor-overlay" onClick={onClose} />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="同期の確認">
        <div className="confirm-title">同期の確認</div>
        {conflictId ? (
          <>
            <div className="confirm-message">
              「{titleOf(conflictId)}」は、ほかの端末かAI秘書でも変更されています。どちらの内容を使いますか？
            </div>
            <div className="confirm-actions sync-issue-actions">
              <button className="confirm-btn cancel" onClick={onClose}>あとで</button>
              <button className="confirm-btn cancel" onClick={() => actions.resolveConflict(conflictId, 'remote')}>最新の内容</button>
              <button className="confirm-btn primary" onClick={() => actions.resolveConflict(conflictId, 'local')}>この端末の内容</button>
            </div>
          </>
        ) : (
          <>
            <div className="confirm-message">「{titleOf(rejectedId)}」への変更は保存できませんでした。この変更を取り消しますか？</div>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={onClose}>あとで</button>
              <button className="confirm-btn danger" onClick={() => actions.discardRejected(rejectedId)}>変更を取り消す</button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
