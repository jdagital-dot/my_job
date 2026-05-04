import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

// 旧形式 {"insert":{"checkbox":true/false}} を Quill ネイティブの list: unchecked/checked に変換
function migrateLegacyCheckbox(ops) {
  if (!Array.isArray(ops)) return ops
  const result = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.insert && typeof op.insert === 'object' && 'checkbox' in op.insert) {
      const listType = op.insert.checkbox ? 'unchecked' : 'checked'
      const next = ops[i + 1]
      if (next && typeof next.insert === 'string') {
        const text = next.insert
        const nlIdx = text.indexOf('\n')
        if (nlIdx !== -1) {
          const before = text.slice(0, nlIdx + 1)
          const after = text.slice(nlIdx + 1)
          result.push({ insert: before, attributes: { ...(next.attributes ?? {}), list: listType } })
          if (after) result.push({ insert: after, ...(next.attributes ? { attributes: next.attributes } : {}) })
          i += 2
          continue
        }
      }
      i++
      continue
    }
    result.push(op)
    i++
  }
  return result
}

const Editor = forwardRef(function Editor({ noteId, content, onChange, readOnly = false, onResourceClick }, ref) {
  const containerRef = useRef(null)
  const quillRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onResourceClickRef = useRef(onResourceClick)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onResourceClickRef.current = onResourceClick }, [onResourceClick])

  useImperativeHandle(ref, () => ({
    getHTML() {
      return quillRef.current?.root.innerHTML ?? ''
    },
    format(name, value) {
      quillRef.current?.format(name, value)
    },
    getFormat() {
      return quillRef.current?.getFormat() ?? {}
    },
    focus() {
      quillRef.current?.focus()
    },
    getSelection() {
      return quillRef.current?.getSelection() ?? null
    },
    restoreSelection(range) {
      if (range && quillRef.current) {
        quillRef.current.setSelection(range.index, range.length)
      }
    },
    insertLink(text, url, range) {
      const q = quillRef.current
      if (!q) return
      const idx = range?.index ?? (q.getSelection()?.index ?? q.getLength() - 1)
      q.insertText(idx, text, 'link', url, Quill.sources.USER)
      q.setSelection(idx + text.length, 0)
    },
  }))

  // Initialize Quill once
  useEffect(() => {
    if (quillRef.current) return

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: { toolbar: false },
      readOnly,
      placeholder: readOnly ? '' : '書き始めましょう…',
    })

    if (!readOnly) {
      quill.on('text-change', () => {
        onChangeRef.current(JSON.stringify(quill.getContents()))
      })
    }

    // qmres: リンクのクリックをインターセプト
    quill.root.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="qmres:"]')
      if (!a) return
      e.preventDefault()
      const id = a.getAttribute('href').slice('qmres:'.length)
      onResourceClickRef.current?.(id)
    })

    quillRef.current = quill
  }, [])

  // Load content when note changes
  useEffect(() => {
    const quill = quillRef.current
    if (!quill || content == null) return
    try {
      const delta = JSON.parse(content)
      const ops = migrateLegacyCheckbox(delta.ops ?? delta)
      quill.setContents(ops, Quill.sources.SILENT)
    } catch {
      quill.setText(content, Quill.sources.SILENT)
    }
    quill.setSelection(quill.getLength(), 0, Quill.sources.SILENT)
  }, [noteId])

  return <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} />
})

export default Editor
