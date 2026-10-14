# dsh-locale-ja

A Japanese (`ja`) UI locale and font pack for the [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) web GUI, shipped as a client plugin.

Japanese: [README.md](README.md)

- **Japanese UI** — adds **日本語** to Settings → General → Language and translates the interface. All **57 namespaces / 2433 keys** present in DSH `0.2.0-rc.2` are translated; anything untranslated falls back to English.
- **Japanese font** — while Japanese is selected, the UI uses **Noto Sans JP** (or Hiragino Sans / Yu Gothic UI when it is not installed). The theme DSH ships puts the Simplified-Chinese family `PingFang SC` ahead of any Japanese family, so without this override Japanese text is drawn with Chinese glyph shapes.
- **Leaves the built-in locales alone** — `ja` is registered as an external language, so the shipped English and Chinese UIs are untouched.

## Requirements

| Item | Requirement |
| --- | --- |
| DSH | `0.2.0-rc.2` (uses the `@deepseek-ai/dsh-client-locale` language-pack API) |
| Node.js | 20 or newer (for the install script and the build) |
| Font | Noto Sans JP (optional; falls back to the OS Japanese fonts) |
| OS | macOS / Windows / Linux (the DSH desktop app, or a CLI `web` profile) |

## Install

```sh
git clone https://github.com/yuuturn/dsh-locale-ja.git
cd dsh-locale-ja

node tools/install.mjs --dry-run   # show what would change
node tools/install.mjs             # install into ~/.dsh/profiles/desktop
```

For another profile, such as a CLI web profile:

```sh
node tools/install.mjs --profile web
# or point at it directly: DSH_PROFILE_DIR=/path/to/profile node tools/install.mjs
```

Then **restart DSH** and pick **日本語** in **Settings → General → Language**.

The script makes exactly two changes, and running it again is a no-op:

1. `<profile>/node_modules/dsh-locale-ja` → a symlink (junction on Windows) to this repository
2. one marked `insert` row in `<profile>/cordis.patch.yml`

```yaml
# dsh-locale-ja: Japanese language pack (managed by tools/install.mjs)
- insert:
    - id: locale-ja
      name: dsh-locale-ja
```

### Uninstall

```sh
node tools/install.mjs --uninstall
```

### Alternative: install it as a bundle

The package also declares a DSH bundle (`dsh.bundle.patch`), so adding it as a profile dependency and listing `dsh-locale-ja` in `dsh.profile.bundles` composes the same row (this is the route used by `dsh plugin --profile <name> add …` and the in-app Plugins page). When `tools/install.mjs` sees the package installed as a dependency, it leaves the profile patch alone so the row is not composed twice.

## The Japanese font

The pack only names fonts in a `font-family` stack, so it **works without Noto Sans JP** — the stack falls back to Hiragino Sans on macOS and Yu Gothic UI / Meiryo on Windows, never to a Chinese family. To use Noto Sans JP:

```sh
# macOS
brew install --cask font-noto-sans-jp

# Windows / others: install "Noto Sans JP" from Google Fonts
# https://fonts.google.com/noto/specimen/Noto+Sans+JP
```

Chromium enumerates system fonts at startup, so **restart DSH after installing the font**.

If you would rather keep DSH's original fonts, delete `locale/ja/font.css` and run `node tools/build.mjs`; the translations stay. The override is scoped to `html:lang(ja)`, so English and Chinese rendering is unaffected.

## Keeping up with DSH

When DSH changes its copy or key set, refresh the reference dictionaries and translate the difference:

```sh
npm run refresh-reference   # re-extract reference/en from the installed DSH
npm test                    # report untranslated, extra, or placeholder-mismatched keys
# edit locale/ja/*.json
npm run build               # regenerate lib/client.js
```

## Layout

| Path | Role |
| --- | --- |
| `lib/client.js` | The client bundle DSH serves over `/plugins`. **Generated** — edit `locale/ja/` and run `npm run build` instead |
| `lib/index.js` | Host half; `apply()` is empty because the pack is a browser-side concern |
| `locale/ja/*.json` | One Japanese dictionary per namespace; the file name is the namespace (`settings.locale.json`, …) |
| `locale/ja/font.css` | The font override applied while the document is Japanese; delete it to build without one |
| `locale/STYLE.md` | Translation style guide (glossary, punctuation, placeholders) |
| `reference/en/*.json` | Snapshot of DSH's shipped English dictionaries, used as the translation baseline |
| `cordis.patch.yml` | Patch layer for bundle-style installs |
| `tools/` | Extraction, build, verification and install scripts |

## Development

```sh
npm run build     # generate lib/client.js from locale/ja/*.json and font.css
npm run verify    # key sets, placeholders, style rules, bundle contract
npm test          # build --check + verify + integration against the real app
```

The integration test loads the **real locale service** out of an installed DSH `app.asar` and asserts that 日本語 is selectable, that operating the Language row switches the locale, and that `<html lang>` and the font override take effect. Without a DSH installation it reports a skip (`DSH_APP_ASAR` overrides the path). CI runs `build --check` and `verify`.

Translation work is split across `tools/translate-groups.json`; `tools/extract-dicts.py` performs the extraction. Pull requests are welcome — if the upstream English changed, please include the `npm run refresh-reference` result.

## Known limitations

- **`command.token.*` stays English.** Those values are not display copy: the slash menu inserts them as the *input spelling* of the picked command, and the alias table that resolves a typed spelling is built from DSH's shipped `zh` and `en` dictionaries only (an external locale's spelling is never registered). Translating them would make the inserted spelling unresolvable.
- Text captured at registration time outside the slot render path (for example the `/model` command description in the command registry) keeps the language it was registered under; that is a DSH-side behavior.
- The translation targets the DSH `0.2.0-rc.2` dictionaries. DSH is a release candidate, so keys may be added or removed upstream; `npm test` reports that.
- **日本語** in the language selector is an external language contributed by this package, and selecting it sets `<html lang>` to `ja`.

## License

MIT — see [LICENSE](LICENSE). See [NOTICE](NOTICE) for the DeepSeek Harness (MIT) attribution and the Noto Sans JP (SIL OFL 1.1) note; the font itself is not redistributed.
