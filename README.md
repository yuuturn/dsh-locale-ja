# dsh-locale-ja

DSH（DeepSeek Harness）の Web GUI を日本語で使うための言語パック（クライアントプラグイン）です。

English: [README.en.md](README.en.md)

- **UI を日本語化** — 設定 → 一般 → 言語 に「日本語」を追加し、画面の文言を日本語にします。DSH `0.2.0-rc.2` が持つ **57 名前空間 / 2433 キーをすべて翻訳済み**（未訳キーは英語にフォールバック）
- **日本語フォントに切り替え** — 日本語を選んでいる間だけ、フォントを **Noto Sans JP**（未インストールなら Hiragino Sans / Yu Gothic UI）にします。DSH 同梱のテーマは CJK のフォールバックに中国語フォント（`PingFang SC`）を日本語より先に指定しているため、対策しないと日本語が中国語の字形で表示されます
- **DSH 本体のロケールは変更しません** — `ja` は外部言語として登録されるので、同梱の英語・中国語の表示はそのままです

## 動作要件

| 項目 | 要件 |
| --- | --- |
| DSH | `0.2.0-rc.2`（`@deepseek-ai/dsh-client-locale` の言語パック API を使用） |
| Node.js | 20 以上（インストールスクリプトとビルドに使用） |
| フォント | Noto Sans JP（任意。無い場合は OS の日本語フォントにフォールバック） |
| OS | macOS / Windows / Linux（DSH のデスクトップアプリ、または CLI の web プロファイル） |

## インストール

```sh
git clone https://github.com/yuuturn/dsh-locale-ja.git
cd dsh-locale-ja

node tools/install.mjs --dry-run   # 変更内容を確認
node tools/install.mjs             # 既定のプロファイル（~/.dsh/profiles/desktop）に組み込む
```

CLI の Web プロファイルなど、別のプロファイルに入れる場合:

```sh
node tools/install.mjs --profile web
# または環境変数で指定: DSH_PROFILE_DIR=/path/to/profile node tools/install.mjs
```

その後 **DSH を再起動**し、**設定 → 一般 → 言語** で **日本語** を選びます。

スクリプトが行う変更は 2 つだけで、何度実行しても結果は同じです。

1. `<profile>/node_modules/dsh-locale-ja` → このリポジトリへの symlink（Windows では junction）
2. `<profile>/cordis.patch.yml` に、目印コメント付きの `insert` 行を 1 つ追加

```yaml
# dsh-locale-ja: Japanese language pack (managed by tools/install.mjs)
- insert:
    - id: locale-ja
      name: dsh-locale-ja
```

### アンインストール

```sh
node tools/install.mjs --uninstall
```

### 別の方法（バンドルとして入れる）

このパッケージは DSH の bundle 定義（`dsh.bundle.patch`）も同梱しているので、プロファイルの `package.json` に依存として追加し、`dsh.profile.bundles` に `dsh-locale-ja` を加えても同じ行が組み込まれます（`dsh plugin --profile <name> add ...` や、アプリの Plugins ページから入れる場合はこちら）。`tools/install.mjs` は依存として入っていることを検出すると、行の二重挿入を避けるために何もしません。

## 日本語フォント

テーマにフォント名を指定するだけなので、**Noto Sans JP が無くても動作します**（macOS は Hiragino Sans、Windows は Yu Gothic UI / Meiryo にフォールバックし、中国語フォントには戻りません）。Noto Sans JP を使う場合:

```sh
# macOS
brew install --cask font-noto-sans-jp

# Windows / その他: Google Fonts から「Noto Sans JP」をインストール
# https://fonts.google.com/noto/specimen/Noto+Sans+JP
```

Chromium は起動時にシステムフォントを列挙するため、**インストール後は DSH の再起動が必要**です。

フォントの切り替えを望まない場合は `locale/ja/font.css` を削除して `node tools/build.mjs` を実行してください（翻訳はそのまま残ります）。上書きは `html:lang(ja)` に限定しているので、英語・中国語の表示には影響しません。

## DSH を更新したとき

DSH 側で文言やキーが変わった場合は、英語辞書を取り直して差分を翻訳します。

```sh
npm run refresh-reference   # インストール済み DSH から reference/en を取り直す
npm test                    # 未訳・余剰キー、プレースホルダの不一致を検出
# locale/ja/*.json を追記・修正して
npm run build               # lib/client.js を再生成
```

## 構成

| パス | 役割 |
| --- | --- |
| `lib/client.js` | DSH が `/plugins` 経由で配信するクライアントバンドル。**生成物**なので直接編集せず `npm run build` で作り直す |
| `lib/index.js` | ホスト側の入口（`apply()` は空。日本語化はブラウザ側の関心事） |
| `locale/ja/*.json` | 名前空間ごとの日本語辞書。ファイル名がそのまま名前空間（例: `settings.locale.json`） |
| `locale/ja/font.css` | 日本語ロケール時だけ適用するフォント上書き。削除するとフォント上書きなしでビルドされる |
| `locale/STYLE.md` | 翻訳スタイルガイド（用語集・表記ルール） |
| `reference/en/*.json` | 翻訳の基準にする、DSH 同梱の英語辞書のスナップショット |
| `cordis.patch.yml` | bundle としてインストールする場合のパッチ層 |
| `tools/` | 抽出・ビルド・検証・インストールのスクリプト |

## 開発

```sh
npm run build     # locale/ja/*.json + font.css から lib/client.js を生成
npm run verify    # キー集合・プレースホルダ・スタイル・バンドル契約を検証
npm test          # build --check + verify + インストーラの往復 + 実アプリに対する結合テスト
```

`npm test` の結合テストは、インストール済み DSH の `app.asar` から**本物のロケールサービス**を読み込み、「日本語」が選択肢に出ること、行の操作で実際に切り替わること、`<html lang>` とフォント上書きが有効になることを確認します。DSH が無い環境では自動的に skip します（`DSH_APP_ASAR` で場所を指定できます）。

翻訳の分担は `tools/translate-groups.json` に、辞書の抽出は `tools/extract-dicts.py` にあります。プルリクエストは歓迎します。DSH 側の英文が変わっている場合は `npm run refresh-reference` の結果も添えてください。

## 既知の制約

- **`command.token.*` は英語のまま**にしています。これは表示用の文言ではなく、スラッシュメニューでコマンドを選んだときに composer へ入る「入力綴り」で、入力された綴りを解決する別名表は DSH 同梱の `zh` / `en` 辞書からしか作られません（外部ロケールの綴りは登録されない）。日本語化するとコマンドとして解決できなくなるため、意図的に英語のままにしています
- 登録時に文言を固定する一部のテキスト（コマンドレジストリの説明など）は言語切替に追従しません（DSH 側の仕様）
- 翻訳は DSH `0.2.0-rc.2` 時点の辞書に基づきます。DSH は RC 版のため、更新でキーが増減する可能性があります（`npm test` が検出します）
- 設定の言語セレクタに出る「日本語」は、このパッケージが提供する外部言語です。選択中は `<html lang>` が `ja` になります

## ライセンス

MIT（[LICENSE](LICENSE)）。DSH の英語文字列の扱いと Noto Sans JP については [NOTICE](NOTICE) を参照してください（フォント本体は再配布していません）。
