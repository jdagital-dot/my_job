// ノート一覧に出す表示専用の仮想ノート「タスク」。
// notes コレクションには保存せず、タスクの正本は Firestore の /users/{uid}/tasks だけとする。
export const TASKS_NOTE_ID = 'virtual:tasks'
export const TASKS_NOTE_TITLE = 'タスク'

export function isVirtualNoteId(id) {
  return typeof id === 'string' && id.startsWith('virtual:')
}
