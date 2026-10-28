import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskEntryBar from './TaskEntryBar'

function setup(props = {}) {
  const onFinish = vi.fn(() => ({ ok: true }))
  const onCancel = vi.fn()
  render(
    <TaskEntryBar entry={{ title: '体育館の予約', ...props.entry }} defaultDomain={props.defaultDomain ?? 'personal'}
      onFinish={props.onFinish ?? onFinish} onCancel={onCancel} />,
  )
  return { onFinish: props.onFinish ?? onFinish, onCancel, user: userEvent.setup() }
}

describe('タスクの入力欄', () => {
  it('期限 → 時間 → タグを Enter で進めて登録する', async () => {
    const { onFinish, user } = setup()
    expect(screen.getByText('体育館の予約')).toBeInTheDocument()
    await user.type(screen.getByLabelText('期限'), '1030{Enter}')
    await user.type(screen.getByLabelText('時間'), '1h{Enter}')
    expect(screen.getByRole('radio', { name: /プライベート/ })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowLeft}{ArrowLeft}{Enter}')
    expect(onFinish).toHaveBeenCalledWith({ deadline: { month: 10, day: 30 }, minutes: 60, domain: 'table-tennis' })
  })

  it('空欄の Enter で期限・時間を省略し、ボタンや数字キーでも選べる', async () => {
    const { onFinish, user } = setup()
    await user.type(screen.getByLabelText('期限'), '{Enter}')
    await user.click(screen.getByRole('button', { name: '30分' }))
    await user.keyboard('2')
    expect(onFinish).toHaveBeenCalledWith({ deadline: null, minutes: 30, domain: 'business' })
  })

  it('すでに書かれていた期限・時間タグを初期値にする', async () => {
    const { onFinish, user } = setup({ entry: { deadlineText: '11月2日', durationText: '1時間30分' } })
    expect(screen.getByLabelText('期限')).toHaveValue('11月2日')
    await user.keyboard('{Enter}{Enter}{Enter}')
    expect(onFinish).toHaveBeenCalledWith({ deadline: { month: 11, day: 2 }, minutes: 90, domain: 'personal' })
  })

  it('読めない期限・時間は先へ進まずに知らせる', async () => {
    const { onFinish, user } = setup()
    await user.type(screen.getByLabelText('期限'), '13月{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('1030 や 10/30')
    await user.clear(screen.getByLabelText('期限'))
    await user.type(screen.getByLabelText('期限'), '10/30{Enter}')
    await user.type(screen.getByLabelText('時間'), 'すぐ{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('30m、1h')
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('学校は非機密の確認をしてから登録する', async () => {
    const { onFinish, user } = setup()
    await user.click(screen.getByRole('button', { name: 'なし' }))
    await user.click(screen.getByRole('button', { name: 'なし' }))
    await user.click(screen.getByRole('radio', { name: /学校/ }))
    expect(onFinish).not.toHaveBeenCalled()
    expect(screen.getByText(/生徒名・成績・健康・出欠・連絡先・家庭状況・学校内部資料を含まない/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '確認して登録' }))
    expect(onFinish).toHaveBeenCalledWith({ deadline: null, minutes: null, domain: 'school' })
  })

  it('登録できなかった理由を表示する', async () => {
    const { user } = setup({ onFinish: () => ({ ok: false, errors: ['学校の個人情報を含む可能性があります'] }) })
    expect(screen.getByLabelText('期限')).toHaveFocus()
    await user.type(screen.getByLabelText('期限'), '{Enter}')
    await user.type(screen.getByLabelText('時間'), '{Enter}')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('学校の個人情報')
  })

  it('Esc や ✕ でタスクにせずに閉じる', async () => {
    const { onCancel, onFinish, user } = setup()
    await user.type(screen.getByLabelText('期限'), '{Escape}')
    await user.click(screen.getByRole('button', { name: 'タスクにしない' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onFinish).not.toHaveBeenCalled()
  })
})
