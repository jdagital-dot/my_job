import { useEffect, useMemo, useState } from 'react'
import { DOMAINS, SCHOOL_CONFIRM_TEXT, extractLegacyDeadlineItems, toDueAt } from './tasks/taskModel'

function pad(n) { return String(n).padStart(2, '0') }

// 旧形式の期限タグ（/MMDD）のプレビューと選択取り込み。
// 自動移行はせず、年も推測で確定しない。元メモ・期限タグは変更しない。
export default function LegacyTagImport({ open, notes, tasks, onImport, onClose }) {
  const items = useMemo(() => (open ? extractLegacyDeadlineItems(notes) : []), [open, notes])
  const imported = useMemo(
    () => new Set(tasks.map(t => t.legacyFingerprint).filter(Boolean)),
    [tasks],
  )
  const [selected, setSelected] = useState({})   // fingerprint -> true
  const [years, setYears] = useState({})         // fingerprint -> year
  const [domain, setDomain] = useState('')
  const [schoolConfirmed, setSchoolConfirmed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [errors, setErrors] = useState([])

  useEffect(() => {
    if (!open) return
    setSelected({}); setYears({}); setDomain(''); setSchoolConfirmed(false)
    setConfirming(false); setErrors([])
  }, [open])

  if (!open) return null

  const thisYear = new Date().getFullYear()
  const yearOptions = [thisYear - 1, thisYear, thisYear + 1]
  const chosen = items.filter(i => selected[i.fingerprint] && !imported.has(i.fingerprint))
  const missingYear = chosen.some(i => !years[i.fingerprint])
  const canImport = chosen.length > 0 && !missingYear && domain &&
    (domain !== 'school' || schoolConfirmed)

  const toggle = (fp) => setSelected(s => ({ ...s, [fp]: !s[fp] }))

  const runImport = () => {
    const drafts = chosen.map(item => ({
      title: item.taskText,
      domain,
      schoolNonConfidentialConfirmed: domain === 'school' ? schoolConfirmed : false,
      dueAt: item.month ? toDueAt(`${years[item.fingerprint]}-${pad(item.month)}-${pad(item.day)}`, '') : null,
      status: item.checked ? 'completed' : 'not_started',
      sourceNoteId: item.noteId,
      legacyFingerprint: item.fingerprint,
    }))
    const failures = onImport(drafts)
    setConfirming(false)
    if (failures.length) setErrors(failures)
    else onClose()
  }

  return (
    <>
      <div className="overlay task-editor-overlay" onClick={onClose} />
      <div className="task-editor legacy-import" role="dialog" aria-modal="true" aria-label="旧形式の期限タグを確認">
        <div className="task-editor-header">
          <span className="task-editor-title">旧形式の期限タグを確認</span>
        </div>
        <div className="task-editor-body">
          <p className="legacy-note">
            メモ内の期限タグを一覧にしています。選んだ項目だけを正式タスクとして登録します。
            元のメモや期限タグは変更しません。年は項目ごとに選んでください。
          </p>

          {items.length === 0 && <div className="empty">期限タグのある行はありません</div>}

          <div className="legacy-list">
            {items.map(item => {
              const done = imported.has(item.fingerprint)
              return (
                <div key={item.fingerprint} className={`legacy-item${done ? ' imported' : ''}`}>
                  <input type="checkbox" checked={done || !!selected[item.fingerprint]} disabled={done}
                    onChange={() => toggle(item.fingerprint)} aria-label={`「${item.taskText}」を選択`} />
                  <div className="legacy-body">
                    <div className="legacy-title">{item.taskText}</div>
                    <div className="task-meta">
                      <span className="task-chip">メモ: {item.noteTitle}</span>
                      <span className="task-chip due">{item.deadlineText}</span>
                      {item.checked && <span className="task-chip">チェック済み→完了で登録</span>}
                      {done && <span className="task-chip">取り込み済み</span>}
                    </div>
                  </div>
                  {!done && item.month && (
                    <select className="legacy-year" value={years[item.fingerprint] ?? ''}
                      onChange={e => setYears(y => ({ ...y, [item.fingerprint]: e.target.value }))}
                      aria-label={`「${item.taskText}」の年`}>
                      <option value="">年を選択</option>
                      {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
                    </select>
                  )}
                </div>
              )
            })}
          </div>

          {items.length > 0 && (
            <label className="te-field">
              <span className="te-label">登録する分野</span>
              <select className="te-input" value={domain} onChange={e => setDomain(e.target.value)}>
                <option value="">選択してください</option>
                {Object.entries(DOMAINS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          {domain === 'school' && (
            <label className="te-school-confirm">
              <input type="checkbox" checked={schoolConfirmed} onChange={e => setSchoolConfirmed(e.target.checked)} />
              <span>選んだ項目はすべて、{SCHOOL_CONFIRM_TEXT}</span>
            </label>
          )}
          {missingYear && <p className="legacy-hint">選んだ項目の年を選択してください</p>}
          {errors.length > 0 && (
            <ul className="te-errors" role="alert">{errors.map(e => <li key={e}>{e}</li>)}</ul>
          )}
          {confirming && (
            <div className="legacy-confirm" role="alert">
              {chosen.length}件を正式タスクとして登録します。元のメモは変更しません。
            </div>
          )}
        </div>
        <div className="task-editor-actions">
          <button type="button" className="confirm-btn cancel" onClick={confirming ? () => setConfirming(false) : onClose}>
            {confirming ? '戻る' : '閉じる'}
          </button>
          {confirming
            ? <button type="button" className="confirm-btn primary" onClick={runImport}>登録する</button>
            : <button type="button" className="confirm-btn primary" disabled={!canImport}
                onClick={() => setConfirming(true)}>選択した{chosen.length}件を登録</button>}
        </div>
      </div>
    </>
  )
}
