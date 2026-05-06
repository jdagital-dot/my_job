import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'
import { useNotes } from './useNotes'
import { useResources } from './useResources'
import Editor from './Editor'
import Sidebar from './Sidebar'
import ConfirmDialog from './ConfirmDialog'
import ResourcePicker from './ResourcePicker'
import './App.css'
import { fmtDate } from './dateUtils'

const LAST_NOTE_KEY = 'qm_last_note'
const SAVE_DELAY = 1500

// Quill が生成する HTML に限定したサニタイザ
// script タグ・インラインハンドラ・javascript: URL を除去する
function sanitizeHTML(html) {
  if (typeof document === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  const toRemove = []
  let node = walker.currentNode
  while (node) {
    const el = node
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'IFRAME') {
      toRemove.push(el)
    } else {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
        else if (/javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
      }
    }
    node = walker.nextNode()
  }
  toRemove.forEach(el => el.remove())
  return doc.body.innerHTML
}

function extractTitle(content) {
  try {
    const ops = JSON.parse(content).ops ?? []
    for (const op of ops) {
      if (typeof op.insert === 'string') {
        const line = op.insert.split('\n')[0].trim()
        if (line) return line
      }
    }
  } catch {}
  return '無題'
}

export default function App() {
  const { user, loading: authLoading, authError, signIn, signOut } = useAuth()
  const {
    notes, loading: notesLoading, firestoreOk,
    createNote, updateNote, deleteNote,
    restoreNote, permanentDeleteNote,
    getHistory, saveHistory,
  } = useNotes(user?.uid)

  const {
    resources, allTags, isElectron, hasFSAccess, supported: resourcesSupported,
    addFiles, addFolder, addFromDataTransfer,
    updateResource, removeResource,
    openResource, showInFolder, downloadResource,
    getResource,
  } = useResources()

  const [currentNoteId, setCurrentNoteId] = useState(null)
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [saveStatus, setSaveStatus]       = useState('')
  const [saveStatus2, setSaveStatus2]     = useState('')
  const [preview, setPreview]             = useState(false)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const [historyEntries, setHistoryEntries]     = useState([])
  const [editorKey, setEditorKey]   = useState(0)
  const [splitMode, setSplitMode]   = useState(false)
  const [secondNoteId, setSecondNoteId] = useState(null)
  const [editorKey2, setEditorKey2] = useState(0)
  const [focusedPane, setFocusedPane] = useState('left')
  const [confirm, setConfirm]           = useState(null)
  const [pickerOpen, setPickerOpen]     = useState(false)
  const [toastMsg, setToastMsg]         = useState('')
  const savedSelectionRef = useRef(null)

  const editorRef  = useRef(null)
  const editorRef2 = useRef(null)
  const currentNoteIdRef  = useRef(currentNoteId)
  const secondNoteIdRef   = useRef(secondNoteId)
  const shortcutRef = useRef({})
  const touchStartX = useRef(null)

  const pendingContentRef  = useRef(null)
  const saveTimerRef       = useRef(null)
  const isSavingRef        = useRef(false)
  const pendingContentRef2 = useRef(null)
  const saveTimerRef2      = useRef(null)
  const isSavingRef2       = useRef(false)

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

  useEffect(() => { currentNoteIdRef.current = currentNoteId }, [currentNoteId])
  useEffect(() => { secondNoteIdRef.current  = secondNoteId  }, [secondNoteId])

  const activeNotes  = notes.filter(n => !n.deleted)
  const trashedNotes = notes.filter(n => n.deleted)
  const currentNote  = notes.find(n => n.id === currentNoteId) ?? null
  const secondNote   = notes.find(n => n.id === secondNoteId)  ?? null

  // On notes loaded: restore last note, or wait then create new one
  useEffect(() => {
    if (notesLoading || !user) return
    if (currentNoteId && notes.find(n => n.id === currentNoteId && !n.deleted)) return
    const lastId = localStorage.getItem(LAST_NOTE_KEY)
    if (lastId && notes.find(n => n.id === lastId && !n.deleted)) {
      setCurrentNoteId(lastId); return
    }
    if (activeNotes.length > 0) { setCurrentNoteId(activeNotes[0].id); return }
    const timer = setTimeout(() => {
      createNote().then(id => {
        setCurrentNoteId(id)
        localStorage.setItem(LAST_NOTE_KEY, id)
      })
    }, 8000)
    return () => clearTimeout(timer)
  }, [notesLoading, user?.uid, notes.length])

  useEffect(() => {
    if (currentNoteId) localStorage.setItem(LAST_NOTE_KEY, currentNoteId)
  }, [currentNoteId])

  // 共通セーブファクトリ（左右ペイン共用）
  const savedStatusTimerRef  = useRef(null)
  const savedStatusTimerRef2 = useRef(null)

  const makeSavePipeline = useCallback((idRef, isSavingRef, pendingRef, statusSetter, statusTimerRef) => {
    const doSave = async (content) => {
      const id = idRef.current
      if (!id || isSavingRef.current) return
      isSavingRef.current = true
      try {
        const title = extractTitle(content)
        await updateNote(id, { title, content })
        saveHistory(id, { content, title, savedAt: new Date().toISOString() })
        statusSetter('saved')
        clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => statusSetter(''), 2000)
      } finally {
        isSavingRef.current = false
        if (pendingRef.current) {
          const next = pendingRef.current
          pendingRef.current = null
          doSave(next)
        }
      }
    }
    const handleChange = (content) => {
      pendingRef.current = content
      statusSetter('saving')
    }
    const flush = (timerRef) => {
      if (pendingRef.current) {
        clearTimeout(timerRef.current)
        doSave(pendingRef.current)
        pendingRef.current = null
      }
    }
    return { doSave, handleChange, flush }
  }, [updateNote, saveHistory])

  const leftPipe  = useMemo(() => makeSavePipeline(
    currentNoteIdRef, isSavingRef, pendingContentRef, setSaveStatus, savedStatusTimerRef
  ), [makeSavePipeline])

  const rightPipe = useMemo(() => makeSavePipeline(
    secondNoteIdRef, isSavingRef2, pendingContentRef2, setSaveStatus2, savedStatusTimerRef2
  ), [makeSavePipeline])

  const handleContentChange = useCallback((content) => {
    leftPipe.handleChange(content)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => leftPipe.doSave(content), SAVE_DELAY)
  }, [leftPipe])

  const flushSave = useCallback(() => leftPipe.flush(saveTimerRef), [leftPipe])

  const handleContentChange2 = useCallback((content) => {
    rightPipe.handleChange(content)
    clearTimeout(saveTimerRef2.current)
    saveTimerRef2.current = setTimeout(() => rightPipe.doSave(content), SAVE_DELAY)
  }, [rightPipe])

  const flushSave2 = useCallback(() => rightPipe.flush(saveTimerRef2), [rightPipe])

  const showToast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }, [])

  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e) => {
    const startX = touchStartX.current
    if (startX === null) return
    const endX = e.changedTouches[0].clientX
    const dx = endX - startX
    if (!sidebarOpen && startX < 30 && dx > 60) {
      setSidebarOpen(true)
    } else if (sidebarOpen && dx < -60) {
      setSidebarOpen(false)
    }
    touchStartX.current = null
  }, [sidebarOpen])

  // Apply format to focused pane
  const applyFormat = useCallback((name, value) => {
    const editor = shortcutRef.current.focusedPane === 'right' ? editorRef2.current : editorRef.current
    if (!editor) return
    const current = editor.getFormat()
    editor.format(name, current[name] === value ? false : value)
    editor.focus()
  }, [])

  // Always keep shortcutRef current
  shortcutRef.current = { editorRef, editorRef2, setPreview, focusedPane, openHistory: null, openPicker: null }

  // Global keyboard shortcuts
  useEffect(() => {
    const isMac = /mac/i.test(navigator.platform)
    const handler = (e) => {
      const ctrl = isMac ? e.metaKey : e.ctrlKey
      if (!ctrl || !e.shiftKey) return
      const { editorRef, editorRef2, setPreview, focusedPane } = shortcutRef.current
      const editor = (focusedPane === 'right' ? editorRef2 : editorRef).current
      const fmt = (name, value) => {
        if (!editor) return
        const cur = editor.getFormat()
        editor.format(name, cur[name] === value ? false : value)
        editor.focus()
      }
      switch (e.key.toUpperCase()) {
        case 'H': e.preventDefault(); fmt('header', 1); break
        case 'U': e.preventDefault(); fmt('list', 'bullet'); break
        case 'O': e.preventDefault(); fmt('list', 'ordered'); break
        case 'X': e.preventDefault(); fmt('list', 'unchecked'); break
        case 'Y': e.preventDefault(); shortcutRef.current.openHistory?.(); break
        case 'L': e.preventDefault(); shortcutRef.current.openPicker?.(); break
        case 'P': e.preventDefault(); setPreview(v => !v); break
        default: break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSelectNote = (id) => {
    flushSave(); flushSave2()
    setCurrentNoteId(id)
    setEditorKey(k => k + 1)
    setSidebarOpen(false)
    setPreview(false)
    setHistoryPanelOpen(false)
  }

  const handleNewNote = async () => {
    try {
      flushSave(); flushSave2()
      const id = await createNote()
      if (!id) { showToast('メモの作成に失敗しました'); return }
      setCurrentNoteId(id)
      setEditorKey(k => k + 1)
      setSidebarOpen(false)
      setPreview(false)
    } catch {
      showToast('メモの作成に失敗しました')
    }
  }

  const handleDeleteNote = (id) => {
    const note = notes.find(n => n.id === id)
    setConfirm({
      title: 'メモを削除', danger: true,
      message: `「${note?.title || '無題'}」をゴミ箱に移動しますか？`,
      confirmLabel: '削除',
      onConfirm: async () => {
        await deleteNote(id)
        if (currentNoteId === id) {
          const remaining = activeNotes.filter(n => n.id !== id)
          if (remaining.length > 0) { setCurrentNoteId(remaining[0].id); setEditorKey(k => k + 1) }
          else { const newId = await createNote(); setCurrentNoteId(newId); setEditorKey(k => k + 1) }
        }
      },
    })
  }

  const handleToggleSplit = () => {
    setSplitMode(v => {
      if (!v && !secondNoteId) {
        const other = activeNotes.find(n => n.id !== currentNoteId)
        if (other) setSecondNoteId(other.id)
      }
      return !v
    })
  }

  const handleSelectSecondNote = (id) => {
    flushSave2()
    setSecondNoteId(id)
    setEditorKey2(k => k + 1)
  }

  const handleRestoreNote = async (id) => { await restoreNote(id) }

  const handlePermanentDeleteNote = (id) => {
    const note = notes.find(n => n.id === id)
    setConfirm({
      title: '完全削除', danger: true,
      message: `「${note?.title || '無題'}」を完全に削除しますか？この操作は取り消せません。`,
      confirmLabel: '完全削除',
      onConfirm: async () => {
        await permanentDeleteNote(id)
        if (currentNoteId === id) {
          if (activeNotes.length > 0) { setCurrentNoteId(activeNotes[0].id); setEditorKey(k => k + 1) }
          else { const newId = await createNote(); setCurrentNoteId(newId); setEditorKey(k => k + 1) }
        }
      },
    })
  }

  const handleOpenResourcePicker = useCallback(() => {
    const editor = (shortcutRef.current.focusedPane === 'right' ? editorRef2 : editorRef).current
    savedSelectionRef.current = editor?.getSelection() ?? null
    setPickerOpen(true)
  }, [])
  shortcutRef.current.openPicker = handleOpenResourcePicker

  const handlePickResource = (item) => {
    setPickerOpen(false)
    const editor = (shortcutRef.current.focusedPane === 'right' ? editorRef2 : editorRef).current
    if (editor) editor.insertLink(item.displayName, `qmres:${item.id}`, savedSelectionRef.current)
  }

  const handleResourceClick = useCallback(async (id) => {
    const item = getResource(id)
    if (!item) { showToast('この資料は削除されました'); return }
    const result = await openResource(item)
    if (!result?.ok) {
      if (result?.reason === 'folder-web-unsupported') showToast('フォルダはブラウザから直接開けません')
      else if (result?.reason === 'denied') showToast('ファイルへのアクセスが拒否されました')
      else showToast('ファイルを開けませんでした')
    }
  }, [getResource, openResource, showToast])

  const handleDeleteResource = (item) => {
    setConfirm({
      title: '資料を削除', danger: true,
      message: `「${item.displayName}」の参照を削除しますか？（ファイル本体は削除されません）`,
      confirmLabel: '削除',
      onConfirm: () => removeResource(item.id),
    })
  }

  const handleEditResourceTags = (item) => {
    const input = window.prompt('タグを編集（カンマ区切り）', (item.tags || []).join(', '))
    if (input === null) return
    const tags = input.split(',').map(t => t.trim()).filter(Boolean)
    updateResource(item.id, { tags })
  }

  const handleOpenHistory = () => {
    if (!currentNoteId) return
    setHistoryEntries(getHistory(currentNoteId))
    setHistoryPanelOpen(true)
  }
  shortcutRef.current.openHistory = handleOpenHistory

  const handleRestoreVersion = async (entry) => {
    if (!currentNoteId) { showToast('メモが選択されていません'); return }
    clearTimeout(saveTimerRef.current)
    pendingContentRef.current = null
    try {
      await updateNote(currentNoteId, { title: entry.title, content: entry.content })
      saveHistory(currentNoteId, { content: entry.content, title: entry.title, savedAt: new Date().toISOString() })
      setEditorKey(k => k + 1)
      setHistoryPanelOpen(false)
      showToast('復元しました')
    } catch {
      showToast('復元に失敗しました')
    }
  }

  if (authLoading) {
    return <div className="splash"><span className="splash-logo">QuickMemo</span></div>
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <h1>QuickMemo</h1>
          <p>起動後すぐにメモを取れる、シンプルなメモアプリ</p>
          {authError && <p className="auth-error">{authError}</p>}
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
    <div className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); addFromDataTransfer(e.dataTransfer) }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}
      {historyPanelOpen && <div className="overlay" onClick={() => setHistoryPanelOpen(false)} />}

      <Sidebar
        open={sidebarOpen}
        notes={activeNotes}
        trashedNotes={trashedNotes}
        currentNoteId={currentNoteId}
        onSelect={handleSelectNote}
        onNew={handleNewNote}
        onDelete={handleDeleteNote}
        onRestore={handleRestoreNote}
        onPermanentDelete={handlePermanentDeleteNote}
        resources={resources}
        allTags={allTags}
        resourcesSupported={resourcesSupported}
        isElectron={isElectron}
        onAddFiles={addFiles}
        onAddFolder={addFolder}
        onOpenResource={async (item) => {
          const r = await openResource(item)
          if (!r?.ok) {
            if (r?.reason === 'folder-web-unsupported') showToast('フォルダはブラウザから直接開けません')
            else if (r?.reason === 'denied') showToast('ファイルへのアクセスが拒否されました')
            else showToast('ファイルを開けませんでした')
          }
        }}
        onShowResourceInFolder={showInFolder}
        onDeleteResource={handleDeleteResource}
        onEditResourceTags={handleEditResourceTags}
        onDownloadResource={downloadResource}
      />

      {/* History panel */}
      <div className={`history-panel${historyPanelOpen ? ' open' : ''}`} aria-label="編集履歴">
        <div className="history-panel-header">
          <span className="history-panel-title">HISTORY</span>
          <button className="icon-btn" onClick={() => setHistoryPanelOpen(false)} aria-label="閉じる">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="history-list">
          {historyEntries.length === 0 && (
            <p className="empty">履歴がありません<br /><small>保存するたびに記録されます</small></p>
          )}
          {historyEntries.map((entry, i) => (
            <div key={i} className="history-item">
              <div className="note-info">
                <div className="note-title">{entry.title || '無題'}</div>
                <div className="note-date">{fmtDate(entry.savedAt)}</div>
              </div>
              <button className="history-restore-btn" onClick={() => handleRestoreVersion(entry)}
                aria-label={`「${entry.title || '無題'}」を復元`}>
                復元
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="main">
        {!firestoreOk && (
          <div className="firestore-warn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{display:'inline',verticalAlign:'-2px',marginRight:'6px'}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            クラウド同期が無効です（このデバイスにのみ保存）。Firebase Firestoreを有効にしてください。
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
          <button className={`icon-btn${splitMode ? ' active-btn' : ''}`} onClick={handleToggleSplit}
            aria-label="分割表示" aria-pressed={splitMode}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={signOut} aria-label="サインアウト">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </header>

        <div className={`editor-area${splitMode ? ' split' : ''}`}>
          {/* Left pane */}
          <div className={`editor-pane${focusedPane === 'left' && splitMode ? ' pane-focused' : ''}`}
            onFocus={() => setFocusedPane('left')}>
            {currentNote ? (
              <>
                <div id="qm-editor"
                  style={{ display: preview ? 'none' : 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
                  <Editor ref={editorRef} key={editorKey}
                    noteId={currentNoteId} content={currentNote.content}
                    onChange={handleContentChange}
                    onResourceClick={handleResourceClick} />
                </div>
                {preview && (
                  <div className="preview-area ql-editor"
                    dangerouslySetInnerHTML={{ __html: sanitizeHTML(editorRef.current?.getHTML() ?? '') }} />
                )}
              </>
            ) : (
              <div className="loading">読み込み中...</div>
            )}
          </div>

          {/* Right pane (split mode) */}
          {splitMode && (
            <div className={`editor-pane pane-right${focusedPane === 'right' ? ' pane-focused' : ''}`}
              onFocus={() => setFocusedPane('right')}>
              <div className="pane-header">
                <select className="pane-select" value={secondNoteId || ''}
                  onChange={e => handleSelectSecondNote(e.target.value)}
                  aria-label="右ペインのメモを選択">
                  <option value="">メモを選択...</option>
                  {activeNotes.map(n => (
                    <option key={n.id} value={n.id}>{n.title || '無題'}</option>
                  ))}
                </select>
                <span className="pane-save-status">
                  {saveStatus2 === 'saving' && <span className="status-saving">● 保存中</span>}
                  {saveStatus2 === 'saved'  && <span className="status-saved">● 保存済</span>}
                </span>
              </div>
              {secondNote ? (
                <Editor ref={editorRef2} key={editorKey2}
                  noteId={secondNoteId} content={secondNote.content}
                  onChange={handleContentChange2}
                  onResourceClick={handleResourceClick} />
              ) : (
                <div className="loading">メモを選択してください</div>
              )}
            </div>
          )}
        </div>

        {/* Bottom toolbar — programmatic (works for focused pane) */}
        <div id="qm-toolbar" className="bottom-toolbar" role="toolbar" aria-label="テキスト書式">
          <button className="tb-btn" onClick={() => applyFormat('bold', true)} aria-label="太字"><b>B</b></button>
          <button className="tb-btn" onClick={() => applyFormat('header', 1)} aria-label="見出し">H1</button>
          <button className="tb-btn" onClick={() => applyFormat('list', 'bullet')} aria-label="箇条書き">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
          </button>
          <button className="tb-btn" onClick={() => applyFormat('list', 'ordered')} aria-label="番号リスト">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">1.</text><text x="2" y="14" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">2.</text><text x="2" y="20" fontSize="7" fontWeight="bold" stroke="none" fill="currentColor">3.</text></svg>
          </button>
          <button className="tb-btn" onClick={() => applyFormat('list', 'unchecked')} aria-label="チェックボックス">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 20 6"/></svg>
          </button>
          <div className="tb-divider" />
          <button className="tb-btn tb-history" onClick={handleOpenHistory} aria-label="編集履歴">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button className={`tb-btn tb-preview${preview ? ' active' : ''}`}
            onClick={() => setPreview(v => !v)}
            aria-label={preview ? '編集モード' : 'プレビュー'} aria-pressed={preview}>
            {preview ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
      </div>

      <ResourcePicker
        open={pickerOpen}
        resources={resources}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickResource}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={() => { confirm?.onConfirm?.(); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
