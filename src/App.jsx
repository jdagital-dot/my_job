import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from './useAuth'
import { useNotes } from './useNotes'
import Editor from './Editor'
import Sidebar from './Sidebar'
import './App.css'

const LAST_NOTE_KEY = 'qm_last_note'
const SAVE_DELAY = 1500

export default function App() {
  const { user, loading: authLoading, signIn, signOut } = useAuth()
  const { notes, loading: notesLoading, firestoreOk, createNote, updateNote, deleteNote } = useNotes(user?.uid)

  const [currentNoteId, setCurrentNoteId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [preview, setPreview] = useState(false)

  const editorRef = useRef(null)
  const currentNoteIdRef = useRef(currentNoteId)

  // Keep bottom toolbar above virtual keyboard using visualViewport API
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.offsetTop - vv.height)
      document.documentElement.style.setProperty('--keyboard-height', `${offset}px`)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--keyboard-height')
    }
  }, [])
  const pendingContentRef = useRef(null)
  const saveTimerRef = useRef(null)
  const isSavingRef = useRef(false)

  useEffect(() => { currentNoteIdRef.current = currentNoteId }, [currentNoteId])

  const currentNote = notes.find(n => n.id === currentNoteId) ?? null

  // On notes loaded: restore last note, or wait then create new one
  useEffect(() => {
    if (notesLoading || !user) return

    // Already on a valid note — nothing to do
    if (currentNoteId && notes.find(n => n.id === currentNoteId)) return

    const lastId = localStorage.getItem(LAST_NOTE_KEY)
    if (lastId && notes.find(n => n.id === lastId)) {
      setCurrentNoteId(lastId)
      return
    }
    if (notes.length > 0) {
      setCurrentNoteId(notes[0].id)
      return
    }

    // Notes are empty — wait 2s for Firestore before creating a blank note
    const timer = setTimeout(() => {
      createNote().then(id => {
        setCurrentNoteId(id)
        localStorage.setItem(LAST_NOTE_KEY, id)
      })
    }, 2000)
    return () => clearTimeout(timer)
  }, [notesLoading, user?.uid, notes.length])

  useEffect(() => {
    if (currentNoteId) localStorage.setItem(LAST_NOTE_KEY, currentNoteId)
  }, [currentNoteId])

  const doSave = useCallback(async (content) => {
    const id = currentNoteIdRef.current
    if (!id || isSavingRef.current) return
    isSavingRef.current = true
    try {
      let title = '無題'
      try {
        const ops = JSON.parse(content).ops ?? []
        for (const op of ops) {
          if (typeof op.insert === 'string') {
            const line = op.insert.split('\n')[0].trim()
            if (line) { title = line; break }
          }
        }
      } catch {}
      await updateNote(id, { title, content })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2000)
    } finally {
      isSavingRef.current = false
    }
  }, [updateNote])

  const handleContentChange = useCallback((content) => {
    pendingContentRef.current = content
    clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(() => doSave(content), SAVE_DELAY)
  }, [doSave])

  const flushSave = useCallback(() => {
    if (pendingContentRef.current) {
      clearTimeout(saveTimerRef.current)
      doSave(pendingContentRef.current)
      pendingContentRef.current = null
    }
  }, [doSave])

  const handleSelectNote = (id) => {
    flushSave()
    setCurrentNoteId(id)
    setSidebarOpen(false)
    setPreview(false)
  }

  const handleNewNote = async () => {
    flushSave()
    const id = await createNote()
    setCurrentNoteId(id)
    setSidebarOpen(false)
    setPreview(false)
  }

  const handleDeleteNote = async (id) => {
    await deleteNote(id)
    if (currentNoteId === id) {
      const remaining = notes.filter(n => n.id !== id)
      if (remaining.length > 0) {
        setCurrentNoteId(remaining[0].id)
      } else {
        const newId = await createNote()
        setCurrentNoteId(newId)
      }
    }
  }

  if (authLoading) {
    return <div className="splash"><span className="splash-logo">QuickMemo</span></div>
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">📝</div>
          <h1>QuickMemo</h1>
          <p>起動後すぐにメモを取れる、シンプルなメモアプリ</p>
          <button className="google-btn" onClick={signIn}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Googleでログイン
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}

      <Sidebar
        open={sidebarOpen}
        notes={notes}
        currentNoteId={currentNoteId}
        onSelect={handleSelectNote}
        onNew={handleNewNote}
        onDelete={handleDeleteNote}
      />

      <div className="main">
        {!firestoreOk && (
          <div className="firestore-warn">
            ⚠️ クラウド同期が無効です（このデバイスにのみ保存）。Firebase Firestoreを有効にしてください。
          </div>
        )}
        <header className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(v => !v)} aria-label="メニュー">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span className="app-name">QuickMemo</span>
          <div className="save-status">
            {saveStatus === 'saving' && <span className="status-saving">● 保存中</span>}
            {saveStatus === 'saved'  && <span className="status-saved">● 保存済</span>}
          </div>
          <button className="icon-btn" onClick={signOut} title="サインアウト">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </header>

        <div className="editor-area">
          {currentNote ? (
            <>
              <div
                id="qm-editor"
                style={{ display: preview ? 'none' : 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}
              >
                <Editor
                  ref={editorRef}
                  key={currentNoteId}
                  noteId={currentNoteId}
                  content={currentNote.content}
                  onChange={handleContentChange}
                />
              </div>
              {preview && (
                <div
                  className="preview-area ql-editor"
                  dangerouslySetInnerHTML={{
                    __html: document.querySelector('#qm-editor .ql-editor')?.innerHTML ?? ''
                  }}
                />
              )}
            </>
          ) : (
            <div className="loading">読み込み中...</div>
          )}
        </div>
        {/* Bottom toolbar */}
        <div id="qm-toolbar" className="bottom-toolbar">
          <button className="ql-bold tb-btn" title="太字">
            <b>B</b>
          </button>
          <button className="ql-header tb-btn" value="1" title="見出し">
            H1
          </button>
          <button className="ql-list tb-btn" value="bullet" title="箇条書き">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
          </button>
          <button className="ql-list tb-btn" value="ordered" title="番号リスト">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">1.</text><text x="2" y="14" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">2.</text><text x="2" y="20" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">3.</text></svg>
          </button>
          <button className="tb-btn" onClick={() => editorRef.current?.insertCheckbox()} title="チェックボックス">
            ☑
          </button>
          <div className="tb-divider" />
          <button
            className={`tb-btn tb-preview${preview ? ' active' : ''}`}
            onClick={() => setPreview(v => !v)}
            title={preview ? '編集モード' : 'プレビュー'}
          >
            {preview ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
