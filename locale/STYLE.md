# 日本語 UI 翻訳スタイルガイド

DSH（DeepSeek Harness）Web GUI の日本語ロケール（`ja`）を作るための共通ルール。
翻訳者はこのファイルの指示に従う。

## 出力形式

- 入力: `reference/en/<namespace>.json` — `{"zh": {...}, "en": {...}}` 形式。**`en` だけを使う**（`zh` は参考・無視してよい）。
- 出力: `locale/ja/<namespace>.json` — **フラットな** JSON オブジェクト。キーは英語辞書と完全に同一、値が日本語。
  - `ensure_ascii=false`（日本語はそのまま UTF-8 で書く）
  - インデント 2 スペース、キーは昇順ソート
  - コメント・末尾カンマ禁止
- キーは絶対に翻訳・改名・追加・削除しない。値だけを書く。

例:

```json
{
  "cancel": "キャンセル",
  "loading": "読み込み中…"
}
```

## 表記ルール

- 文体: ラベルは体言止め（「保存」「設定」）。説明文・エラー文は「です・ます」調。
- 文末に句点「。」を付けない（英語側が `.` で終わっていても、UI ラベルは付けない）。ただし複数文からなる長い説明では文間に「。」を使う。
- 括弧は全角「（）」を使う。コード・パス・プレースホルダを囲む場合は半角「()」。
- 三点リーダは英語側と同じ `…`（U+2026）を使う。`...` にはしない。
- 中黒は「・」。感嘆符・疑問符は使わない。
- 半角英数字と日本語の間にスペースは入れない（「モデルを選択」）。
- 英語側の大文字小文字の区別は日本語では気にしない。

## 用語集（必ず従う）

| 英語 | 日本語 |
| --- | --- |
| Agent | エージェント |
| Session | セッション |
| Workspace | ワークスペース |
| Skill | スキル |
| Plugin | プラグイン |
| Tool | ツール |
| Subagent | サブエージェント |
| Goal | ゴール |
| Plan | プラン |
| Job | ジョブ |
| Workflow | ワークフロー |
| Trajectory | トラジェクトリ |
| Turn | ターン |
| Message | メッセージ |
| Prompt | プロンプト |
| Model | モデル |
| Provider | プロバイダー |
| Permission | 権限 |
| Approval | 承認 |
| Sandbox | サンドボックス |
| Attachment | 添付ファイル |
| Deliverable | 成果物 |
| Terminal | ターミナル |
| Sidebar | サイドバー |
| Transcript | トランスクリプト |
| Token | トークン |
| Reasoning | 推論 |
| Reasoning effort | 推論の強度 |
| Streaming | ストリーミング |
| Retry | 再試行 |
| Reset | リセット |
| Default | デフォルト |
| Cancel | キャンセル |
| Save | 保存 |
| Copy | コピー |
| Close | 閉じる |
| Delete | 削除 |
| Edit | 編集 |
| Search | 検索 |
| Settings | 設定 |
| General | 一般 |
| Language | 言語 |
| Appearance / Theme | 外観 / テーマ |
| Account | アカウント |
| Version | バージョン |
| Update | アップデート |
| Shortcut | ショートカット |
| Command | コマンド |
| Slash command | スラッシュコマンド |
| Loading… | 読み込み中… |
| Saving… | 保存中… |
| Submitting… | 送信中… |
| Copy failed | コピーに失敗しました |
| Failed to load | 読み込みに失敗しました |

## そのまま残すもの

- 製品名・サービス名: DSH, DeepSeek, DeepSeek Harness, GitHub, npm, pnpm, Hugging Face, macOS, Windows, Linux, Electron
- 技術名・形式名: JSON, YAML, Markdown, HTML, PDF, Excel, Word, PowerPoint, CSV, URL, API, HTTP, HTTPS, LLM, MCP, SDK, CLI, ONNX, Cordis, React
- ファイル名・パス・拡張子・環境変数・キー名（例: `cordis.patch.yml`, `package.json`, `$DSH_HOME`, `Ctrl`, `Cmd`, `Enter`, `Esc`, `Tab`）
- コード片、コマンド例、URL

英語のまま残した語と日本語を並べるときは半角スペースを入れない（例: 「JSON をコピー」ではなく「JSONをコピー」）。

## プレースホルダ

`{name}` `{count}` `{total}` `{value}` `{version}` `{percent}` `{label}` `{action}` `{model}` `{path}` などの中括弧トークンは**すべてそのまま**残す。順序を変えてもよいが、削除・追加・綴り変更は禁止。
`\n`（改行エスケープ）や `%`、`…` も保持する。

## 品質基準

- 短いラベルは英語と同じくらいの長さに収める（レイアウト崩れ防止）。長すぎる場合は語を削る。
- 同じ概念には同じ訳語を使う（上記の用語集）。表記ゆれを出さない。
- 直訳調を避け、日本語の UI として自然な言い回しにする。
- 意味が曖昧な場合は英語の機能説明から推測し、一般的な日本語 UI 表現（例: 「有効にする」「無効にする」「詳細」）を選ぶ。
- 値が記号のみ・プレースホルダのみ・製品名のみの場合は、英語と同一の値をそのまま書いてよい。
