import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

// Register checkbox blot once at module level
const Embed = Quill.import('blots/embed')
class CheckboxBlot extends Embed {
  static create(checked) {
    const node = super.create()
    node.dataset.checked = checked ? 'true' : 'false'
    node.textContent = checked ? '☑' : '☐'
    return node
  }
  static value(node) { return node.dataset.checked === 'true' }
}
CheckboxBlot.blotName = 'checkbox'
CheckboxBlot.tagName = 'span'
CheckboxBlot.className = 'ql-cb'
Quill.register(CheckboxBlot, true)

const Editor = forwardRef(function Editor({ noteId, content, onChange }, ref) {
  const containerRef = useRef(null)
  const quillRef = useRef(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Expose insertCheckbox to parent
  useImperativeHandle(ref, () => ({
    insertCheckbox() {
      const quill = quillRef.current
      if (!quill) return
      const range = quill.getSelection(true)
      const [, offset] = quill.getLine(range.index)
      const lineStart = range.index - offset
      quill.insertEmbed(lineStart, 'checkbox', false, Quill.sources.USER)
      quill.setSelection(lineStart + 1, Quill.sources.SILENT)
    }
  }))

  // Initialize Quill once
  useEffect(() => {
    if (quillRef.current) return // guard for React StrictMode

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: {
        toolbar: '#qm-toolbar',
        keyboard: {
          bindings: {
            checkboxEnter: {
              key: 'Enter',
              handler(range) {
                const [line, offset] = quill.getLine(range.index)
                const lineStart = range.index - offset
                const leaf = line.children?.head
                if (leaf?.domNode?.classList.contains('ql-cb')) {
                  if (line.length() <= 2) {
                    quill.deleteText(lineStart, 1, Quill.sources.USER)
                    quill.insertText(lineStart, '\n', Quill.sources.USER)
                    quill.setSelection(lineStart + 1, Quill.sources.SILENT)
                  } else {
                    quill.insertText(range.index, '\n', Quill.sources.USER)
                    quill.insertEmbed(range.index + 1, 'checkbox', false, Quill.sources.USER)
                    quill.setSelection(range.index + 2, Quill.sources.SILENT)
                  }
                  return false
                }
                return true
              }
            }
          }
        }
      },
      placeholder: '書き始めましょう…',
    })

    quill.on('text-change', () => {
      onChangeRef.current(JSON.stringify(quill.getContents()))
    })

    // Checkbox toggle (Quill 2 intercepts click, use pointerup)
    quill.root.addEventListener('pointerup', (e) => {
      const cb = e.target.closest('.ql-cb')
      if (cb) {
        const checked = cb.dataset.checked === 'true'
        cb.dataset.checked = String(!checked)
        cb.textContent = checked ? '☐' : '☑'
        onChangeRef.current(JSON.stringify(quill.getContents()))
      }
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
