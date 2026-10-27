import { useEffect, useRef, useState } from 'react'
import {
  DOMAINS, STATUSES, SCHOOL_CONFIRM_TEXT, LIMITS,
  toDueAt, splitDueAt, validateTask, buildTask, sensitivityFor,
} from './tasks/taskModel'

const EDITABLE = [
  'title', 'domain', 'schoolNonConfidentialConfirmed', 'dueAt', 'priority',
  'estimatedMinutes', 'status', 'nextAction', 'description',
]

function toForm(task) {
  const { date, time } = splitDueAt(task?.dueAt ?? null)
  return {
    title: task?.title ?? '',
    domain: task?.domain ?? '',
    schoolNonConfidentialConfirmed: task?.schoolNonConfidentialConfirmed === true,
    dueDate: date,
    dueTime: time,
    priority: task?.priority ?? 3,
    estimatedMinutes: task?.estimatedMinutes == null ? '' : String(task.estimatedMinutes),
    status: task?.status ?? 'not_started',
    nextAction: task?.nextAction ?? '',
    description: task?.description ?? '',
  }
}

function fromForm(form) {
  const minutes = form.estimatedMinutes === '' ? null : Number(form.estimatedMinutes)
  return {
    title: form.title.trim(),
    domain: form.domain,
    schoolNonConfidentialConfirmed: form.domain === 'school' ? form.schoolNonConfidentialConfirmed : false,
    sensitivity: sensitivityFor(form.domain),
    dueAt: toDueAt(form.dueDate, form.dueTime),
    priority: form.priority,
    estimatedMinutes: minutes,
    status: form.status,
    nextAction: form.nextAction,
    description: form.description,
  }
}

// mode: 'create' | 'edit'。task は編集対象、または作成時の下書き（メモからタスク化など）。
export default function TaskEditor({ open, mode, task, sourceNoteTitle, onSave, onCancel }) {
  const [form, setForm] = useState(() => toForm(task))
  const [errors, setErrors] = useState([])
  const titleRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm(toForm(task))
    setErrors([])
    setTimeout(() => titleRef.current?.focus(), 50)
  }, [open, task])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const set = (field) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setForm(f => ({ ...f, [field]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const values = fromForm(form)
    if (!form.domain) { setErrors(['分野を選択してください']); return }
    if (values.estimatedMinutes != null && !Number.isInteger(values.estimatedMinutes)) {
      setErrors(['推定時間は分単位の整数で入力してください']); return
    }
    const merged = mode === 'edit' ? { ...task, ...values } : buildTask({ ...task, ...values })
    const localErrors = validateTask(merged)
    if (localErrors.length) { setErrors(localErrors); return }

    let payload = values
    if (mode === 'edit') {
      payload = {}
      for (const field of [...EDITABLE, 'sensitivity']) {
        if ((task[field] ?? null) !== (values[field] ?? null)) payload[field] = values[field]
      }
      if (Object.keys(payload).length === 0) { onCancel(); return }
    }
    const result = onSave(payload)
    if (result && !result.ok) setErrors(result.errors)
  }

  const isSchool = form.domain === 'school'

  return (
    <>
      <div className="overlay task-editor-overlay" onClick={onCancel} />
      <form className="task-editor" role="dialog" aria-modal="true"
        aria-label={mode === 'edit' ? 'タスクを編集' : 'タスクを追加'} onSubmit={handleSubmit}>
        <div className="task-editor-header">
          <span className="task-editor-title">{mode === 'edit' ? 'タスクを編集' : 'タスクを追加'}</span>
          {sourceNoteTitle && <span className="task-editor-source">メモ: {sourceNoteTitle}</span>}
        </div>

        <div className="task-editor-body">
          <label className="te-field">
            <span className="te-label">タスク名</span>
            <input ref={titleRef} className="te-input" value={form.title} onChange={set('title')}
              maxLength={LIMITS.title} placeholder="例: 大会案内を作る" required />
          </label>

          <label className="te-field">
            <span className="te-label">分野</span>
            <select className="te-input" value={form.domain} onChange={set('domain')} required>
              <option value="">選択してください</option>
              {Object.entries(DOMAINS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          {isSchool && (
            <label className="te-school-confirm">
              <input type="checkbox" checked={form.schoolNonConfidentialConfirmed}
                onChange={set('schoolNonConfidentialConfirmed')} />
              <span>{SCHOOL_CONFIRM_TEXT}</span>
            </label>
          )}

          <div className="te-row">
            <label className="te-field">
              <span className="te-label">期限</span>
              <input type="date" className="te-input" value={form.dueDate} onChange={set('dueDate')} />
            </label>
            <label className="te-field te-time">
              <span className="te-label">時刻（任意）</span>
              <input type="time" className="te-input" value={form.dueTime} onChange={set('dueTime')}
                disabled={!form.dueDate} />
            </label>
          </div>

          <div className="te-field">
            <span className="te-label" id="te-priority-label">優先度（1が最優先）</span>
            <div className="te-segment" role="radiogroup" aria-labelledby="te-priority-label">
              {[1, 2, 3, 4, 5].map(p => (
                <button key={p} type="button" role="radio" aria-checked={form.priority === p}
                  className={`te-seg-btn${form.priority === p ? ' active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, priority: p }))}>{p}</button>
              ))}
            </div>
          </div>

          <div className="te-row">
            <label className="te-field">
              <span className="te-label">推定時間（分）</span>
              <input type="number" inputMode="numeric" min="0" max={LIMITS.estimatedMinutes} step="5"
                className="te-input" value={form.estimatedMinutes} onChange={set('estimatedMinutes')} />
            </label>
            <label className="te-field">
              <span className="te-label">状態</span>
              <select className="te-input" value={form.status} onChange={set('status')}>
                {Object.entries(STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          <label className="te-field">
            <span className="te-label">次の行動</span>
            <input className="te-input" value={form.nextAction} onChange={set('nextAction')}
              maxLength={LIMITS.nextAction} />
          </label>

          <label className="te-field">
            <span className="te-label">メモ</span>
            <textarea className="te-input te-textarea" value={form.description} onChange={set('description')}
              maxLength={LIMITS.description} rows={3} />
          </label>

          {errors.length > 0 && (
            <ul className="te-errors" role="alert">
              {errors.map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="task-editor-actions">
          <button type="button" className="confirm-btn cancel" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="confirm-btn primary">保存</button>
        </div>
      </form>
    </>
  )
}
