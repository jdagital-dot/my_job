import { useEffect, useRef } from 'react'

export default function ConfirmDialog({
  open, title, message,
  confirmLabel = 'OK', cancelLabel = 'キャンセル',
  danger = false,
  onConfirm, onCancel,
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <>
      <div className="overlay" onClick={onCancel} />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={title}>
        {title && <div className="confirm-title">{title}</div>}
        {message && <div className="confirm-message">{message}</div>}
        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            className={`confirm-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
