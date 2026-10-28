import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { SCHOOL_CONFIRM_TEXT } from './tasks/taskModel'
import {
  DOMAIN_TAGS, parseDeadlineInput, parseDurationInput, formatDurationTag,
} from './tasks/noteTaskSync'

const DOMAIN_ORDER = ['table-tennis', 'business', 'personal', 'school']
const DURATION_CHIPS = [15, 30, 60, 120]

function monthDayAfter(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return { month: d.getMonth() + 1, day: d.getDate() }
}

// メモでタスクを書いて Enter を押したあと、画面下に出す入力欄。
// 期限 → 時間 → タグ（分野）の順に Enter で進む。空欄の Enter はその項目を省略する。
// iPhone でキーボードを閉じずに続けられるよう、次の欄への切り替えとフォーカス移動を同じ操作内で行う。
const TaskEntryBar = forwardRef(function TaskEntryBar({ entry, defaultDomain, onFinish, onCancel }, ref) {
  const [step, setStep] = useState('deadline') // deadline | duration | domain | school
  const [deadlineText, setDeadlineText] = useState(entry?.deadlineText ?? '')
  const [durationText, setDurationText] = useState(entry?.durationText ?? '')
  const [domain, setDomain] = useState(defaultDomain)
  const [error, setError] = useState('')
  const valuesRef = useRef({ deadline: null, minutes: null })
  const deadlineRef = useRef(null)
  const durationRef = useRef(null)
  const domainRef = useRef(null)
  const schoolRef = useRef(null)

  const focusStep = (name) => {
    const target = { deadline: deadlineRef, duration: durationRef, domain: domainRef, school: schoolRef }[name]
    target.current?.focus()
  }

  const goTo = (name) => {
    flushSync(() => { setStep(name); setError('') })
    focusStep(name)
  }

  useImperativeHandle(ref, () => ({ focus: () => focusStep(step) }))

  const acceptDeadline = (value) => {
    const deadline = value === undefined ? parseDeadlineInput(deadlineText) : value
    if (deadline === undefined) { setError('期限は 1030 や 10/30 の形で入力してください'); return }
    valuesRef.current.deadline = deadline
    goTo('duration')
  }

  const acceptDuration = (value) => {
    const minutes = value === undefined ? parseDurationInput(durationText) : value
    if (minutes === undefined || (minutes != null && minutes > 10080)) {
      setError('時間は 30、30m、1h、1.5h などの形で入力してください'); return
    }
    valuesRef.current.minutes = minutes
    goTo('domain')
  }

  const finish = (chosen) => {
    const result = onFinish({ ...valuesRef.current, domain: chosen })
    if (result && !result.ok) setError(result.errors[0])
  }

  const acceptDomain = (chosen) => {
    setDomain(chosen)
    if (chosen === 'school') goTo('school')
    else finish(chosen)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (step === 'deadline') acceptDeadline()
    else if (step === 'duration') acceptDuration()
    else if (step === 'domain') acceptDomain(domain)
    else if (step === 'school') finish('school')
  }

  const onDomainKeyDown = (e) => {
    const index = DOMAIN_ORDER.indexOf(domain)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setDomain(DOMAIN_ORDER[(index + 1) % 4]) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setDomain(DOMAIN_ORDER[(index + 3) % 4]) }
    else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); acceptDomain(DOMAIN_ORDER[parseInt(e.key) - 1]) }
    else onKeyDown(e)
  }

  const stepLabel = { deadline: '期限', duration: '時間', domain: 'タグ', school: '学校の確認' }[step]

  return (
    <div className="task-entry-bar" role="dialog" aria-label="タスクの入力">
      <div className="teb-head">
        <span className="teb-step">{stepLabel}</span>
        <span className="teb-title">{entry?.title}</span>
        <button type="button" className="teb-close" onClick={onCancel} aria-label="タスクにしない">✕</button>
      </div>

      {step === 'deadline' && (
        <div className="teb-row">
          <input ref={deadlineRef} autoFocus className="teb-input" value={deadlineText} inputMode="numeric"
            placeholder="1030（空欄でなし）" aria-label="期限" autoComplete="off" enterKeyHint="next"
            onChange={e => setDeadlineText(e.target.value)} onKeyDown={onKeyDown} />
          <button type="button" className="teb-chip" onClick={() => acceptDeadline(monthDayAfter(0))}>今日</button>
          <button type="button" className="teb-chip" onClick={() => acceptDeadline(monthDayAfter(1))}>明日</button>
          <button type="button" className="teb-chip" onClick={() => acceptDeadline(null)}>なし</button>
        </div>
      )}

      {step === 'duration' && (
        <div className="teb-row">
          <input ref={durationRef} className="teb-input" value={durationText}
            placeholder="30m・1h（空欄でなし）" aria-label="時間" autoComplete="off" enterKeyHint="next"
            onChange={e => setDurationText(e.target.value)} onKeyDown={onKeyDown} />
          {DURATION_CHIPS.map(m => (
            <button key={m} type="button" className="teb-chip" onClick={() => acceptDuration(m)}>{formatDurationTag(m)}</button>
          ))}
          <button type="button" className="teb-chip" onClick={() => acceptDuration(null)}>なし</button>
        </div>
      )}

      {step === 'domain' && (
        <div ref={domainRef} className="teb-row" role="radiogroup" aria-label="タグ" tabIndex={-1} onKeyDown={onDomainKeyDown}>
          {DOMAIN_ORDER.map((key, i) => (
            <button key={key} type="button" role="radio" aria-checked={domain === key}
              className={`teb-chip teb-domain${domain === key ? ' active' : ''}`}
              onClick={() => acceptDomain(key)}>
              <span className="teb-key">{i + 1}</span>{DOMAIN_TAGS[key]}
            </button>
          ))}
        </div>
      )}

      {step === 'school' && (
        <div className="teb-row teb-school">
          <span className="teb-school-text">{SCHOOL_CONFIRM_TEXT}</span>
          <button ref={schoolRef} type="button" className="teb-chip active" onClick={() => finish('school')} onKeyDown={onKeyDown}>
            確認して登録
          </button>
          <button type="button" className="teb-chip" onClick={() => goTo('domain')}>戻る</button>
        </div>
      )}

      {error && <div className="teb-error" role="alert">{error}</div>}
    </div>
  )
})

export default TaskEntryBar
