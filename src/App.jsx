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
  const { notes, loading: notesLoading, createNote, updateNote, deleteNote } = useNotes(user?.uid)

  const [currentNoteId, setCurrentNoteId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [preview, setPreview] = useState(false)

  const editorRef = useRef(null)
  const currentNoteIdRef = useRef(currentNoteId)
  const pendingContentRef = useRef(null)
  const saveTimerRef = useRef(null)
  const isSavingRef = useRef(false)

  useEffect(() => { currentNoteIdRef.current = currentNoteId }, [currentNoteId])

  const currentNote = notes.find(n => n.id === currentNoteId) ?? null

  // On notes loaded: restore last note or create new one
  useEffect(() => {
    if (notesLoading || !user) return
    const lastId = localStorage.getItem(LAST_NOTE_KEY)
    if (lastId && notes.find(n => n.id === lastId)) {
      setCurrentNoteId(lastId)
    } else if (notes.length > 0) {
      setCurrentNoteId(notes[0].id)
    } else {
      createNote().then(id => {
        setCurrentNoteId(id)
        localStorage.setItem(LAST_NOTE_KEY, id)
      })
    }
  }, [notesLoading, user?.uid])

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

        {/* Custom Quill toolbar */}
        <div id="qm-toolbar" className="toolbar">
          <button className="ql-bold" title="太字"><b>B</b></button>
          <button onClick={() => editorRef.current?.insertCheckbox()} title="チェックボックス">☑</button>
          <button className="ql-list" value="bullet" title="箇条書き">—</button>
          <button
            className={`preview-btn${preview ? ' active' : ''}`}
            onClick={() => setPreview(v => !v)}
          >{preview ? '編集' : 'プレビュー'}</button>
        </div>

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
      </div>
    </div>
  )
}
