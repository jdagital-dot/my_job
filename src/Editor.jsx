import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

const Editor = forwardRef(function Editor({ noteId, content, onChange }, ref) {
  const containerRef = useRef(null)
  const quillRef = useRef(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // チェックボックス行の挿入を親から呼べるようにする
  useImperativeHandle(ref, () => ({
    insertCheckbox() {
      const quill = quillRef.current
      if (!quill) return
      const range = quill.getSelection(true)
      quill.formatLine(range.index, 1, 'list', 'unchecked', Quill.sources.USER)
      quill.setSelection(range.index, Quill.sources.SILENT)
    }
  }))

  // Initialize Quill once
  useEffect(() => {
    if (quillRef.current) return

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: {
        toolbar: '#qm-toolbar',
      },
      placeholder: '書き始めましょう…',
    })

    quill.on('text-change', () => {
      onChangeRef.current(JSON.stringify(quill.getContents()))
    })

    quillRef.current = quill
  }, [])

  // Load content when note changes
  useEffect(() => {
    const quill = quillRef.current
    if (!quill || content == null) return
    try {
      const delta = JSON.parse(content)
      quill.setContents(delta.ops ?? delta, Quill.sources.SILENT)
    } catch {
      quill.setText(content, Quill.sources.SILENT)
    }
    quill.setSelection(quill.getLength(), 0, Quill.sources.SILENT)
  }, [noteId])

  return <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} />
})

export default Editor
