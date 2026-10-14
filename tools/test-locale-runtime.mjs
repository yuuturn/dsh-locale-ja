/**
 * Integration check for the ja language pack against the *real* locale service
 * shipped by the installed DSH app.
 *
 * The unit checks in `tools/verify.mjs` only prove that this pack calls
 * `addLanguage` and `register`. This harness loads
 * `@deepseek-ai/dsh-client-locale`'s client bundle from the installed app.asar
 * in a VM — React and the UI primitives are stubbed, the locale service itself
 * is real — activates the pack against it, and asserts what a user sees:
 *
 *   - 日本語 appears in the selectable locale list (the Settings -> General row)
 *   - selecting it switches the active locale and `<html lang>`
 *   - namespace dictionaries resolve in Japanese
 *   - a key without a translation falls back to English, and a missing key
 *     still displays its own name
 *   - a browser asking for Japanese lands in Japanese before any preference
 *
 * Usage: node tools/test-locale-runtime.mjs
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { readAsarMember } from './asar.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const asarPath = process.env.DSH_APP_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const localeBundleMember = 'dsh/node_modules/@deepseek-ai/dsh-client-locale/lib/client.js'

// This check loads the real locale service from an installed DSH. CI and plain
// checkouts have none, so report a skip instead of failing.
if (!existsSync(asarPath)) {
  console.log(
    `skip: no DSH application bundle at ${asarPath}\n` +
      '      set DSH_APP_ASAR to an app.asar path to run the integration check.',
  )
  process.exit(0)
}

const failures = []
const check = (condition, description) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${description}`)
  if (!condition) failures.push(description)
}

/** A chainable stub for modules whose render-time behavior this harness ignores. */
function autoStub(name) {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === 'then') return undefined
      if (property === Symbol.toPrimitive) return () => `[${name}]`
      if (typeof property === 'symbol') return undefined
      return autoStub(`${name}.${String(property)}`)
    },
    apply: () => autoStub(`${name}()`),
    construct: () => ({}),
  })
}

const reactStub = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === 'useState') {
        return (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
      }
      if (property === 'useSyncExternalStore') return (_subscribe, getSnapshot) => getSnapshot()
      if (property === 'useEffect' || property === 'useLayoutEffect') return () => {}
      if (property === 'createElement') return (type, props, ...children) => ({ type, props, children })
      if (property === 'Fragment') return Symbol('Fragment')
      if (property === 'memo' || property === 'forwardRef') return (value) => value
      return autoStub(`react.${String(property)}`)
    },
  },
)

const moduleStubs = {
  react: reactStub,
  'react/jsx-runtime': {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: Symbol('Fragment'),
  },
  '@deepseek-ai/dsh-client-store': autoStub('store'),
  '@deepseek-ai/dsh-client-ui-primitives': autoStub('primitives'),
}

/**
 * The minimum DOM surface the client bundles touch while registering: enough to
 * record the stylesheets a plugin appends, so the font override can be checked.
 */
function createDocumentStub() {
  const styles = []
  const element = (tagName) => {
    const node = {
      tagName,
      dataset: {},
      style: {},
      sheet: null,
      textContent: '',
      setAttribute() {},
      appendChild() {},
      removeChild() {},
      remove() {
        const index = styles.indexOf(node)
        if (index >= 0) styles.splice(index, 1)
      },
    }
    return node
  }
  const head = element('head')
  head.appendChild = (child) => {
    styles.push(child)
  }
  return {
    documentElement: { lang: 'en' },
    head,
    body: element('body'),
    querySelector: (selector) => {
      const match = /style\[data-plugin-css="(.*)"\]/.exec(selector)
      if (match === null) return null
      return styles.find((node) => node.dataset.pluginCss === match[1]) ?? null
    },
    createElement: element,
    createTextNode: () => ({}),
    addEventListener() {},
    removeEventListener() {},
    /** Stylesheets appended so far, for assertions. */
    styles,
  }
}

/** Load one `window.__ModuleLoader__` bundle inside a VM context. */
function loadBundle(context, source, label) {
  const registrations = []
  context.window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) }
  vm.runInContext(source, context, { filename: label })
  if (registrations.length !== 1) throw new Error(`${label}: registered ${registrations.length} bundles`)
  const { factory, id } = registrations[0]
  const exports = factory((specifier) => {
    const stub = moduleStubs[specifier]
    if (stub === undefined) throw new Error(`${label}: bundle requested unsupported module ${specifier}`)
    return stub
  })
  return { id, exports }
}

const effectful = (callback) => {
  const disposer = callback()
  return typeof disposer === 'function' ? disposer : () => {}
}

/**
 * Boot a fresh browser world: the shipped locale service, then this pack.
 * @param languages - what the browser reports as its language preferences.
 */
async function createWorld(languages) {
  const sandbox = {
    console,
    document: createDocumentStub(),
    window: {},
    navigator: { languages, language: languages[0] },
  }
  vm.createContext(sandbox)

  const localeBundle = loadBundle(sandbox, readAsarMember(asarPath, localeBundleMember), 'dsh-client-locale')
  const jaBundle = loadBundle(sandbox, await readFile(join(root, 'lib', 'client.js'), 'utf8'), 'lib/client.js')

  const services = {}
  const slotRegistrations = []
  const events = []
  let installedFace
  await localeBundle.exports.apply({
    fiber: { uid: 1 },
    effect: effectful,
    on: () => () => {},
    emit: (name, ...args) => {
      events.push([name, args])
    },
    provide: (name, value) => {
      services[name] = value
    },
    configForms: { get: () => undefined },
    slots: {
      installLocale: (face) => { installedFace = face },
      inject: (_name, callback) => callback(),
      register: (registration) => {
        slotRegistrations.push(registration)
        return () => {}
      },
    },
  })

  const locale = services.locale
  if (locale === undefined) throw new Error('the shipped locale plugin provided no locale service')
  check(installedFace === locale, 'the locale service installed itself as the slot LocaleFace')

  jaBundle.exports.apply({ effect: effectful, locale })
  return { sandbox, locale, localeBundle, jaBundle, slotRegistrations, events }
}

// -- scenario A: an English browser, then an explicit switch to Japanese -----

console.log('# English browser')
const world = await createWorld(['en-US'])
const locale = world.locale

const initial = locale.getSnapshot()
check(
  initial.locales.length === 3 && initial.locales.map((l) => l.id).join(',') === 'zh,en,ja',
  `the catalog holds the built-ins plus ja (${initial.locales.map((l) => l.id).join(', ')})`,
)
check(
  initial.locales.some((language) => language.id === 'ja' && language.label === '日本語'),
  '日本語 is selectable in Settings -> General',
)
check(initial.active === 'en', `an English browser starts on ${initial.active}`)

// The Japanese font override this pack injects (see locale/ja/font.css).
const styles = world.sandbox.document.styles
const injected = () => styles.filter((node) => node.dataset.pluginCss === 'dsh-locale-ja/font.css')
const fontStyle = injected()[0]
check(fontStyle !== undefined, 'the pack injected its font stylesheet once')
check(
  fontStyle?.textContent.includes('Noto Sans JP'),
  'the font stack leads with Noto Sans JP',
)
check(
  fontStyle?.textContent.includes(':lang(ja)') === true,
  'the font override is scoped to the ja locale, leaving zh/en untouched',
)
check(
  (fontStyle?.textContent ?? '').includes('PingFang SC') === false,
  'the Chinese CJK fallbacks are gone from the ja stack',
)
check(injected().length === 1, `exactly one font stylesheet among ${styles.length} client stylesheets`)

// Re-running the injection (HMR, a second activation) must not duplicate the tag.
world.jaBundle.exports.applyFontOverride()
check(injected().length === 1, 're-injecting does not duplicate the font stylesheet')

// The Settings -> General row the user actually operates.
const row = world.slotRegistrations.find((registration) => registration.id === 'language')
check(row !== undefined, 'the Language row registered into the settings.general.item slot')
check(row?.locale === 'settings.locale', `the Language row reads its copy from ${row?.locale}`)
const rowActions = row?.inject({ sync: () => {} })
check(typeof rowActions?.setLocale === 'function', 'the Language row exposes a setLocale control')
rowActions?.setLocale('ja')
check(locale.getSnapshot().active === 'ja', 'operating that control selects 日本語')

const selected = locale.getSnapshot()
check(selected.active === 'ja', 'selecting 日本語 activates the ja locale')
check(
  world.events.some(([name, args]) => name === 'locale/change' && args[0]?.active === 'ja'),
  'the switch emitted locale/change so rendered copy follows',
)
check(selected.revision > initial.revision, 'the switch bumped the snapshot revision (rendered copy follows)')
check(world.sandbox.document.documentElement.lang === 'ja', `<html lang> became "${world.sandbox.document.documentElement.lang}"`)

check(locale.translate('settings.locale', 'language.title') === '言語', 'the Language row itself reads 言語')
check(locale.translate('settings', 'general.nav') === '一般', 'Settings navigation reads 一般')
check(locale.translate('common', 'cancel') === 'キャンセル', 'common.cancel reads キャンセル')
check(locale.bind('common')('save') === '保存', 'a bound common translator resolves through the ja dictionary')
check(
  locale.translate('conversation', 'hero.headline') !== 'Into the Unknown',
  'transcript copy comes from the ja dictionary',
)

locale.register('probe.namespace', 'en', { 'probe.key': 'English only' })
check(
  locale.translate('probe.namespace', 'probe.key') === 'English only',
  'a namespace with no ja dictionary falls back to English',
)
check(
  locale.translate('probe.namespace', 'probe.absent') === 'probe.absent',
  'a key no locale defines displays its own name',
)
check(locale.resolveText({ en: 'English', zh: '中文' }) === 'English', 'package text resolves through the en fallback')

locale.setLocale('en')
check(locale.translate('settings.locale', 'language.title') === 'Language', 'switching back to English restores English copy')

// -- scenario B: a Japanese browser before any preference arrives -------------

console.log('\n# Japanese browser')
const japanese = await createWorld(['ja-JP', 'en-US'])
check(
  japanese.locale.getSnapshot().active === 'ja',
  `a browser asking for ja-JP lands on ${japanese.locale.getSnapshot().active}`,
)
check(
  japanese.locale.translate('settings.locale', 'language.title') === '言語',
  'and reads Japanese copy with no preference stored',
)

// -- coverage summary --------------------------------------------------------

const dictionaries = jaBundleDictionaries(world.jaBundle)
const namespaces = Object.keys(dictionaries).length
const keys = Object.values(dictionaries).reduce((total, dictionary) => total + Object.keys(dictionary).length, 0)
console.log(`\nlocale service: ${world.localeBundle.id} (from the installed app)`)
console.log(`pack bundle:    ${world.jaBundle.id}`)
console.log(`registered:     ${namespaces} namespaces, ${keys} keys`)
console.log(`languages:      ${locale.getSnapshot().locales.map((language) => language.label).join(', ')}`)

function jaBundleDictionaries(bundle) {
  return bundle.exports.DICTIONARIES
}

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nOK')
