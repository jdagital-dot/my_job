import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'

const Inline = Quill.import('blots/inline')

class TagBlot extends Inline {
  static blotName = 'tag'
  static tagName = 'span'

  static create(value) {
    const node = super.create()
    node.setAttribute('data-tag-type', value)
    return node
  }

  static formats(node) {
    return node.getAttribute('data-tag-type')
  }

  format(name, value) {
    if (name === 'tag' && value) {
      this.domNode.setAttribute('data-tag-type', value)
    } else {
      super.format(name, value)
    }
  }
}

Quill.register(TagBlot)

function formatTagDisplay(tagText, type) {
  if (type === 'time') {
    const m = tagText.match(/^@(?:(\d+)h)?(?:(\d+)m)?$/)
    const h = m[1] ? parseInt(m[1]) : 0
    const min = m[2] ? parseInt(m[2]) : 0
    return (h ? `${h}時間` : '') + (min ? `${min}分` : '')
  }
  const m = tagText.match(/^\/(\d{2})(\d{2})$/)
  return `${parseInt(m[1])}月${parseInt(m[2])}日`
}

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

const Editor = forwardRef(function Editor({ noteId, content, onChange, readOnly = false, onResourceClick, onTaskComplete }, ref) {
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

      quill.on('text-change', (delta, oldDelta, source) => {
        if (source !== Quill.sources.USER) return

        // 空のノートで最初の入力 → 1行目をH1に自動フォーマット
        if (oldDelta.length() === 1 && !quill.getFormat(0, 1).header) {
          quill.formatLine(0, 1, { header: 1 }, Quill.sources.API)
        }

        // 通常テキスト行（H1でもリストでもない）の末尾でEnter → チェックボックスを自動挿入
        const ops = delta.ops
        let retainCount = 0
        let isEnter = false
        if (ops.length === 1 && ops[0].insert === '\n') {
          isEnter = true
        } else if (ops.length === 2 && ops[0].retain != null && typeof ops[1].insert === 'string' && ops[1].insert === '\n') {
          retainCount = ops[0].retain
          isEnter = true
        }
        if (!isEnter || retainCount === 0) return

        // 新しい行が空 = Enterが行末で押された（行中途は除外）
        const [newLine] = quill.getLine(retainCount + 1)
        if (!newLine || newLine.length() !== 1) return

        // H1行またはリスト行の後はチェックボックス自動化しない
        const prevLineFmt = quill.getFormat(retainCount - 1)
        if (prevLineFmt.header || prevLineFmt.list) return

        quill.formatLine(retainCount + 1, 1, { list: 'unchecked' }, Quill.sources.API)
      })

      quill.on('text-change', (delta, _old, source) => {
        if (source !== Quill.sources.USER) return

        const ops = delta.ops
        let pos = 0
        let triggered = false
        if (ops.length === 1 && (ops[0].insert === ' ' || ops[0].insert === '\n')) {
          triggered = true
        } else if (ops.length === 2 && ops[0].retain != null &&
                   (ops[1].insert === ' ' || ops[1].insert === '\n')) {
          pos = ops[0].retain
          triggered = true
        }
        if (!triggered || pos === 0) return

        const fullText = quill.getText(0, pos)
        const lineText = fullText.includes('\n')
          ? fullText.slice(fullText.lastIndexOf('\n') + 1)
          : fullText

        const match = lineText.match(/(@(?:\d+h\d+m|\d+h|\d+m)|\/\d{4})$/)
        if (!match) return

        const tagText = match[0]
        const tagStart = pos - tagText.length
        const type = tagText.startsWith('@') ? 'time' : 'deadline'
        const displayText = formatTagDisplay(tagText, type)

        quill.deleteText(tagStart, tagText.length, Quill.sources.API)
        quill.insertText(tagStart, displayText, { tag: type }, Quill.sources.API)
      })

      quill.on('text-change', (delta, _old, source) => {
        if (source !== Quill.sources.USER) return

        const hasCheckOn = delta.ops.some(op => op.attributes?.list === 'checked')
        if (!hasCheckOn) return

        const lines = quill.getLines(0, quill.getLength())
        const lineInfos = lines.map(line => {
          const idx = quill.getIndex(line)
          const len = line.length()
          const fmt = line.formats()
          const lineDelta = quill.getContents(idx, len)
          const hasDeadline = lineDelta.ops.some(op => op.attributes?.tag === 'deadline')
          return { idx, len, isList: !!fmt.list, isChecked: fmt.list === 'checked', hasDeadline }
        })

        const groups = []
        let i = 0
        while (i < lineInfos.length) {
          const line = lineInfos[i]
          if (!line.isList && line.hasDeadline) {
            const items = []
            let j = i + 1
            while (j < lineInfos.length && lineInfos[j].isList) {
              items.push(j)
              j++
            }
            if (items.length > 0) groups.push({ header: i, items })
            i = j
          } else {
            i++
          }
        }

        const completed = groups.filter(g => g.items.every(idx => lineInfos[idx].isChecked))
        completed.reverse().forEach(g => {
          const first = lineInfos[g.header]
          const last = lineInfos[g.items[g.items.length - 1]]
          const deleteLen = last.idx + last.len - first.idx
          const groupOps = quill.getContents(first.idx, deleteLen).ops
          onTaskComplete?.(groupOps)
          quill.deleteText(first.idx, deleteLen, Quill.sources.API)
        })
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

    return () => {
      quill.disable()
      quillRef.current = null
    }
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
