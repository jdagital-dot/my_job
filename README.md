# QuickMemo

起動後すぐにメモを取れるメモアプリです（React + Quill、Electron / ブラウザ / iPhone）。メモと正式タスクは Firebase（Authentication / Firestore）で端末間同期します。

## 開発

```bash
npm install
cp .env.example .env.local   # Firebase の設定値を入れる（Git 対象外）
npm run dev                  # ブラウザ
npm run electron:dev         # Electron
npm run build
```

## 正式タスク

右上のリストアイコンからタスク一覧を開きます（以前の NOTES パネルの位置。メモ内の期限タグ一覧は「旧形式の期限タグを確認」で見られます）。

- `＋タスク`: タスク名・分野（学校 / 卓球クラブ / 副業・個人開発 / プライベート）・期限（日付と任意の時刻）・優先度1〜5・推定時間・状態・次の行動・メモを登録する
- 一覧のチェックで完了にする。チェックを外すと「未着手」に戻る（元の状態は保持しない）
- 表示切替: 今日（期限超過を含む）/ 期限間近（3日以内）/ すべて（未完了）/ 完了済み。分野と状態で絞り込める
- メモのカーソル行を、下部ツールバーの「この行をタスクにする」でタスク化できる。元メモへの導線（`sourceNoteId`）だけを保存し、メモ本文には何も書き込まない
- 「旧形式の期限タグを確認」: メモ内の `/MMDD` 期限タグをプレビューし、選んだ項目だけを正式タスクに登録する。年は項目ごとに選ぶ。自動移行はしない。元メモと期限タグは変更しない。`legacyFingerprint` で二重登録を防ぐ

### メモのアーカイブとの関係

メモ内で、見出し行の下のチェック項目がすべて完了すると、確認ダイアログのあとでそのまとまりを「アーカイブ」メモへ移動します（正式タスクとは別の、メモ内チェックリストの機能です）。旧期限タグの指紋はメモIDを含まないため、アーカイブへ移動した行も取り込み済みとして判定されます。

### データと同期

タスクは `/users/{uid}/tasks/{taskId}` に保存します。タスクIDはクライアントで生成したUUIDで、AI-Secretary の SQLite でも同じIDを使います。

- 操作はまず端末内（localStorage の `qm_task_queue_v1_<uid>`）に保存し、Firestore へ冪等に再送します。オフライン中の操作は再接続時（オンライン復帰・30秒ごとの再試行）に送ります
- 更新のたびに `revision` を1つ進めます。他の端末や AI-Secretary が先に更新していた場合は上書きせず「競合」と表示し、「最新の内容を使う」か「この端末の変更で上書き」を選んでもらいます
- 一覧上部に同期状態（同期済み / 保存中 / オフライン / 競合あり / 保存できない変更あり）を表示します
- 初期段階では物理削除はしません
- エラー時のログにはエラーコードだけを出し、タスク本文は出しません

### 学校情報

Firestore は外部クラウドのため、学校の機密情報は保存しません。

- 学校タスクは「生徒名・成績・健康・出欠・連絡先・家庭状況・学校内部資料を含まない一般的な作業です」の確認が必須です（画面とセキュリティルールの両方で確認）
- 生徒・成績・出欠などの語を含む学校タスク、氏名・電話番号などの記述は保存前に止めます（AI-Secretary と同じ判定）
- `sensitivity` は `general` / `personal` だけを保存できます

### セキュリティルール

`firestore.rules` の `tasks` 部分で、次の場合だけ書き込みを許可します。

- 本人の UID のパスであること
- 許可されたフィールドだけを持ち、enum・文字数・優先度・推定時間が範囲内であること
- `revision` を1つ進め、`updatedAt` がサーバー時刻であること
- 学校タスクが非機密確認済みであること

物理削除は許可しません。`notes` のルールは変えていません。**本番への反映（`firebase deploy --only firestore:rules`）は、差分を確認して承認を得てから行ってください。**

## テスト

```bash
npm test             # 単体テスト・画面テスト（Vitest + React Testing Library、Fake リポジトリ）
npm run test:rules   # Firestore Emulator でのセキュリティルールと Firestore 実装のテスト
AI_SECRETARY_DIR=/Users/miyamotosoushi/AI-Secretary npm run test:e2e   # AI-Secretary との結合テスト
```

Emulator には Java 21 が必要です。このMacでは `~/.local/jre-21` に入っています。

```bash
export JAVA_HOME="$HOME/.local/jre-21/Contents/Home" PATH="$JAVA_HOME/bin:$PATH"
```

Emulator はプロジェクトID `demo-quickmemo` で動き、本番の Firebase には接続しません。画面を Emulator につないで試すには、次の2つを別のターミナルで実行します。

```bash
npm run emulators      # Firestore と Authentication の Emulator
npm run dev:emulator   # .env.emulator の設定で起動
```
