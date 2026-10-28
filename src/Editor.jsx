import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import {
  parseTaskLine, duplicateTaskIdLines, formatDeadlineTag, formatDurationTag, DOMAIN_TAGS,
} from './tasks/noteTaskSync'

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

// 行とタスクの対応。改行に付く行属性として保存し、本文には何も書き込まない。
const Parchment = Quill.import('parchment')
const TaskIdAttribute = new Parchment.Attributor('taskid', 'data-task-id', { scope: Parchment.Scope.BLOCK })
Quill.register(TaskIdAttribute)

const TASK_LINE_DELAY = 1500

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

const Editor = forwardRef(function Editor({ noteId, content, onChange, readOnly = false, onResourceClick, onTaskComplete, onTaskLines, onTaskEnter, onUserFocus }, ref) {
  const containerRef = useRef(null)
  const quillRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onResourceClickRef = useRef(onResourceClick)
  const onTaskCompleteRef = useRef(onTaskComplete)
  const onTaskLinesRef = useRef(onTaskLines)
  const onTaskEnterRef = useRef(onTaskEnter)
  const onUserFocusRef = useRef(onUserFocus)
  useEffect(() => { onTaskEnterRef.current = onTaskEnter }, [onTaskEnter])
  useEffect(() => { onUserFocusRef.current = onUserFocus }, [onUserFocus])
  const noteIdRef = useRef(noteId)
  const touchedLinesRef = useRef(new Map()) // 行 blot -> { textChanged, checkToggled }
  const taskLineTimerRef = useRef(null)
  const flushTaskLinesRef = useRef(() => {})
  useEffect(() => { onTaskLinesRef.current = onTaskLines }, [onTaskLines])
  useEffect(() => { noteIdRef.current = noteId }, [noteId])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onResourceClickRef.current = onResourceClick }, [onResourceClick])
  // 初期化時の関数を使い続けると最新のメモ一覧（アーカイブノートの有無）を参照できないため ref 経由で呼ぶ
  useEffect(() => { onTaskCompleteRef.current = onTaskComplete }, [onTaskComplete])

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

      quill.on('text-change', async (delta, _old, source) => {
        if (source !== Quill.sources.USER) return

        const hasCheckOn = delta.ops.some(op => op.attributes?.list === 'checked')
        if (!hasCheckOn) return

        const lines = quill.getLines(0, quill.getLength())
        const lineInfos = lines.map(line => {
          const idx = quill.getIndex(line)
          const len = line.length()
          const fmt = line.formats()
          return { idx, len, isList: !!fmt.list, isChecked: fmt.list === 'checked' }
        })

        const groups = []
        let i = 0
        while (i < lineInfos.length) {
          const line = lineInfos[i]
          if (!line.isList) {
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
        for (const g of [...completed].reverse()) {
          const first = lineInfos[g.header]
          const last = lineInfos[g.items[g.items.length - 1]]
          const deleteLen = last.idx + last.len - first.idx
          const groupOps = quill.getContents(first.idx, deleteLen).ops
          const confirmed = await onTaskCompleteRef.current?.(groupOps)
          if (confirmed) {
            flushTaskLinesRef.current() // 移動する行の変更を先にタスクへ反映する
            quill.deleteText(first.idx, deleteLen, Quill.sources.API)
          }
        }
      })
    }

    // ── メモの行から正式タスクを自動登録・更新 ──
    // 利用者が触った行だけを記録し、入力が止まったらまとめて App に渡す
    const markLines = (index, length, flag) => {
      for (const line of quill.getLines(index, Math.max(1, length))) {
        const current = touchedLinesRef.current.get(line) ?? { textChanged: false, checkToggled: false }
        current[flag] = true
        touchedLinesRef.current.set(line, current)
      }
    }

    const dedupeTaskIds = () => {
      if (!quill.root.querySelector('[data-task-id]')) return
      const lines = quill.getLines(0, quill.getLength())
      const infos = lines.map(line => ({ taskId: line.formats().taskid ?? null, hasText: line.length() > 1 }))
      for (const i of duplicateTaskIdLines(infos)) {
        quill.formatLine(quill.getIndex(lines[i]), 1, { taskid: false }, Quill.sources.API)
      }
    }

    const flushTaskLines = () => {
      clearTimeout(taskLineTimerRef.current)
      const touched = touchedLinesRef.current
      touchedLinesRef.current = new Map()
      if (!onTaskLinesRef.current || touched.size === 0) return
      const entries = []
      for (const [line, flags] of touched) {
        if (!line.scroll || !line.domNode.isConnected) continue
        const index = quill.getIndex(line)
        const ops = quill.getContents(index, Math.max(0, line.length() - 1)).ops
        entries.push({
          line: parseTaskLine(ops, line.formats()),
          ...flags,
          assignTaskId: (id) => {
            if (!line.scroll || !line.domNode.isConnected) return
            quill.formatLine(quill.getIndex(line), 1, { taskid: id }, Quill.sources.API)
          },
        })
      }
      if (entries.length) onTaskLinesRef.current(noteIdRef.current, entries)
    }
    flushTaskLinesRef.current = flushTaskLines

    // 行末に期限・時間・タグのバッジを付け、行とタスクを対応づける
    const applyTaskEntry = (line, { deadline, minutes, domain, taskId }) => {
      if (!line.scroll || !line.domNode.isConnected) return
      const lineStart = quill.getIndex(line)
      // 既に書かれていたタグは入力欄の内容で置き換える
      let pos = lineStart
      const tagRanges = []
      for (const op of quill.getContents(lineStart, line.length() - 1).ops) {
        const len = typeof op.insert === 'string' ? op.insert.length : 1
        if (['deadline', 'time', 'domain'].includes(op.attributes?.tag)) tagRanges.push([pos, len])
        pos += len
      }
      for (const [at, len] of tagRanges.reverse()) quill.deleteText(at, len, Quill.sources.API)
      let end = quill.getIndex(line) + line.length() - 1
      const text = quill.getText(lineStart, end - lineStart)
      const trailing = text.length - text.trimEnd().length
      if (trailing) { quill.deleteText(end - trailing, trailing, Quill.sources.API); end -= trailing }
      const tags = []
      if (deadline) tags.push([formatDeadlineTag(deadline.month, deadline.day), 'deadline'])
      if (minutes != null) tags.push([formatDurationTag(minutes), 'time'])
      tags.push([DOMAIN_TAGS[domain], 'domain'])
      // 隣のタグに空白が取り込まれないよう、まとめて挿入してから範囲ごとに書式を付け直す
      const inserted = tags.map(([label]) => ` ${label}`).join('')
      quill.insertText(end, inserted, Quill.sources.API)
      quill.formatText(end, inserted.length, 'tag', false, Quill.sources.API)
      let at = end
      for (const [label, type] of tags) {
        quill.formatText(at + 1, label.length, 'tag', type, Quill.sources.API)
        at += 1 + label.length
      }
      quill.formatLine(quill.getIndex(line), 1, { taskid: taskId }, Quill.sources.API)
    }

    // 入力欄を閉じたあと、Enter で作られた次の行へカーソルを戻す
    const focusAfter = (line) => {
      if (!line.scroll || !line.domNode.isConnected) { quill.focus(); return }
      quill.focus()
      quill.setSelection(quill.getIndex(line) + line.length(), 0, Quill.sources.SILENT)
    }

    // チェックボックス行の末尾で Enter → タスクの入力（期限・時間・タグ）を始める。
    // Quill の標準の Enter 処理はエディタにフォーカスを戻すため、この場合だけ先に受け取り、
    // 改行を入れてから入力欄へフォーカスを移す（iPhone でキーボードを閉じないよう同じ操作内で行う）。
    if (!readOnly) {
      quill.keyboard.addBinding({ key: 'Enter' }, (range, context) => {
        const line = context.line
        if (!onTaskEnterRef.current || range.length > 0 || context.offset !== line.length() - 1) return true
        const formats = line.formats()
        if (formats.list !== 'unchecked' || formats.taskid) return true
        const ops = quill.getContents(quill.getIndex(line), line.length() - 1).ops
        const parsed = parseTaskLine(ops, formats)
        if (!parsed.title) return true
        quill.insertText(range.index, '\n', formats, Quill.sources.USER)
        const tagText = (type) => ops.find(op => op.attributes?.tag === type)?.insert ?? ''
        onTaskEnterRef.current({
          noteId: noteIdRef.current,
          title: parsed.title,
          deadlineText: tagText('deadline'),
          durationText: tagText('time'),
          apply: (values) => applyTaskEntry(line, values),
          focusAfter: () => focusAfter(line),
        })
        return false
      })
      const enterBindings = quill.keyboard.bindings.Enter
      enterBindings.unshift(enterBindings.pop())
    }

    quill.on('selection-change', (range, oldRange, source) => {
      if (range && !oldRange && source === Quill.sources.USER) onUserFocusRef.current?.()
    })

    if (!readOnly) {
      quill.on('text-change', (delta, _old, source) => {
        if (source !== Quill.sources.USER) return
        let index = 0
        let checkToggled = false
        for (const op of delta.ops) {
          if (typeof op.retain === 'number') {
            if (op.attributes && 'list' in op.attributes) {
              markLines(index, op.retain, 'checkToggled')
              checkToggled = true
            }
            index += op.retain
          } else if (op.insert != null) {
            const length = typeof op.insert === 'string' ? op.insert.length : 1
            markLines(index, length, 'textChanged')
            index += length
          } else if (op.delete) {
            markLines(index, 0, 'textChanged')
          }
        }
        dedupeTaskIds()
        clearTimeout(taskLineTimerRef.current)
        // チェックの付け外しはすぐ反映する（アーカイブで行が移動する前に完了にするため）
        if (checkToggled) flushTaskLines()
        else taskLineTimerRef.current = setTimeout(flushTaskLines, TASK_LINE_DELAY)
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
      // メモを切り替える前に、入力途中の行も登録・更新する
      flushTaskLinesRef.current()
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
