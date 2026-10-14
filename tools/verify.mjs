/**
 * Verify the ja language pack: dictionary parity against the reference keys
 * extracted from the installed DSH bundles, and the built client bundle's
 * registration behavior.
 *
 * Usage: node tools/verify.mjs
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const jaDir = join(root, 'locale', 'ja')
const referenceDir = join(root, 'reference', 'en')

const problems = []
const warnings = []
const styleWarnings = []

/** Keys whose 。 is a medial sentence break because the value is a sentence prefix. */
const MEDIAL_PERIOD_KEYS = new Set(['workspace.toast.archived', 'workspace.toast.stoppedAndArchived'])

function placeholders(value) {
  return [...value.matchAll(/\{([A-Za-z0-9_.]+)\}/g)].map((m) => m[1]).sort()
}

/** Values that legitimately stay identical to English. */
const KEEP_AS_IS = new Set([
  'JSON',
  'OK',
  'DSH',
  'DSH Local Build',
  'DeepSeek Harness',
  'npm',
  'pnpm',
  'Markdown',
  'HTML',
  'URL',
  'API',
  'Mac',
  'Windows',
  'Linux',
  'Finder',
  'Hugging Face',
  'Bash',
  'Pwsh',
  'Props',
  'HTTP',
  'PDF',
  'TTFT',
  'EXP',
  'Anthropic Messages',
  'OpenAI Chat Completions',
  'OpenAI Responses',
  'Cron {expression} ({zone})',
  'dsh-plugin-whale-pet',
])

/**
 * Keys that must keep the canonical English spelling even though another locale
 * translates them.
 *
 * `command.token.*` is not display copy: the slash menu inserts it as the
 * *input spelling* of the picked command (`claimToken`), and the alias table
 * that resolves a typed spelling is built from the shipped `zh` and `en`
 * dictionaries only — an external locale's spelling is never registered there.
 * Keeping the canonical name is therefore what a `ja` user can actually type
 * back.
 */
const KEEP_KEY_AS_IS = new Set([
  'command.token.compact',
  'command.token.export',
  'command.token.feedback',
  'command.token.goal',
  'command.token.permission',
  'command.token.plan',
  'chat.message.compaction.commandTitle',
  'slash.menu.drill.key',
])

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

// -- 1. dictionary parity ---------------------------------------------------

const jaFiles = (await readdir(jaDir)).filter((name) => name.endsWith('.json') && !name.startsWith('_'))
const referenceFiles = (await readdir(referenceDir)).filter(
  (name) => name.endsWith('.json') && !name.startsWith('_'),
)

const missingNamespaces = referenceFiles.filter((name) => !jaFiles.includes(name))
if (missingNamespaces.length > 0) {
  problems.push(`no ja dictionary for: ${missingNamespaces.join(', ')}`)
}

let totalKeys = 0
let identical = 0
for (const name of jaFiles) {
  const ja = await readJson(join(jaDir, name))
  let en
  try {
    en = (await readJson(join(referenceDir, name))).en
  } catch {
    problems.push(`locale/ja/${name} has no matching reference/en/${name} (stale file?)`)
    continue
  }
  const jaKeys = Object.keys(ja)
  const enKeys = Object.keys(en)
  const missing = enKeys.filter((key) => !(key in ja))
  const extra = jaKeys.filter((key) => !(key in en))
  if (missing.length > 0) problems.push(`${name}: ${missing.length} untranslated key(s): ${missing.slice(0, 5).join(', ')}`)
  if (extra.length > 0) problems.push(`${name}: ${extra.length} key(s) absent from the reference: ${extra.slice(0, 5).join(', ')}`)

  for (const key of enKeys) {
    if (!(key in ja)) continue
    const value = ja[key]
    if (typeof value !== 'string') {
      problems.push(`${name}.${key}: value is not a string`)
      continue
    }
    totalKeys += 1
    const expected = placeholders(en[key])
    const actual = placeholders(value)
    if (expected.join(',') !== actual.join(',')) {
      problems.push(`${name}.${key}: placeholders ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`)
    }
    const expectedNewlines = (en[key].match(/\\n/g) ?? []).length
    const actualNewlines = (value.match(/\\n/g) ?? []).length
    if (expectedNewlines !== actualNewlines) {
      problems.push(`${name}.${key}: ${expectedNewlines} \\n escape(s) expected, found ${actualNewlines}`)
    }
    // Placeholder-only values ("{y}-{m}-{d}"), paths, URLs, and identifiers are
    // not copy: only warn when real English words survive a translation.
    const prose = value.replace(/\{[^}]*\}/g, '').trim()
    const identifierLike = /^[\w.-]+(\/[\w.-]+)*$/.test(prose) || prose.includes('://')
    if (
      value === en[key] &&
      /[A-Za-z]{3}/.test(prose) &&
      !identifierLike &&
      !KEEP_AS_IS.has(value) &&
      !KEEP_KEY_AS_IS.has(`${name.slice(0, -'.json'.length)}.${key}`)
    ) {
      identical += 1
      warnings.push(`${name}.${key}: still identical to English (${JSON.stringify(value)})`)
    }

    // Style rules from locale/STYLE.md, reported as warnings, not failures.
    const full = `${name.slice(0, -'.json'.length)}.${key}`
    if (value.endsWith('。') && !en[key].trimEnd().endsWith('.') && !MEDIAL_PERIOD_KEYS.has(full)) {
      styleWarnings.push(`${full}: ends with 。`)
    }
    if (value.includes('...') && en[key].includes('…')) {
      styleWarnings.push(`${full}: ASCII "..." where the source uses …`)
    }
    if (/[A-Za-z0-9] [\u3040-\u30ff\u4e00-\u9fff]/.test(value) && !/[A-Za-z0-9] [\u3040-\u30ff\u4e00-\u9fff]/.test(en[key])) {
      styleWarnings.push(`${full}: half-width space between Latin and Japanese`)
    }
    if (/[!?！？]$/.test(value) && !/[!?！？]$/.test(en[key])) {
      styleWarnings.push(`${full}: trailing exclamation or question mark`)
    }
  }
}

// -- 2. built bundle behavior ----------------------------------------------

const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')
const loaded = []
const sandbox = { window: { __ModuleLoader__: { load: (registration) => loaded.push(registration) } } }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

if (loaded.length !== 1) {
  problems.push(`lib/client.js registered ${loaded.length} bundles, expected 1`)
} else {
  const registration = loaded[0]
  if (registration.id !== 'dsh-locale-ja') problems.push(`bundle id is ${registration.id}, expected dsh-locale-ja`)
  const required = []
  const exported = registration.factory((specifier) => {
    required.push(specifier)
    throw new Error(`unexpected require(${specifier})`)
  })
  if (required.length > 0) problems.push(`bundle requested modules it should not need: ${required.join(', ')}`)
  if (typeof exported.apply !== 'function') problems.push('bundle exports no apply()')
  if (!Array.isArray(exported.inject) || exported.inject.join(',') !== 'locale') {
    problems.push(`bundle inject is ${JSON.stringify(exported.inject)}, expected ["locale"]`)
  }

  // Run the plugin body against a stub ctx that records locale traffic.
  const effects = []
  const languages = []
  const registrations = []
  const ctx = {
    effect: (callback, label) => {
      if (typeof callback !== 'function') problems.push(`effect without callback: ${label}`)
      effects.push([callback, label])
      return () => {}
    },
    locale: {
      addLanguage: (language) => {
        languages.push(language)
        return () => {}
      },
      register: (namespace, locale, dictionary) => {
        registrations.push({ namespace, locale, dictionary })
        return () => {}
      },
    },
  }
  exported.apply(ctx)
  for (const [callback] of effects) callback()

  // The font override must be exactly what locale/ja/font.css declares (the
  // bundle embeds it with comments stripped).
  let fontCssOnDisk
  try {
    fontCssOnDisk = (await readFile(join(jaDir, 'font.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').trim()
  } catch {
    fontCssOnDisk = undefined
  }
  if (fontCssOnDisk === undefined || fontCssOnDisk.length === 0) {
    if (exported.FONT_CSS !== undefined) problems.push('locale/ja/font.css is missing but the bundle injects a stylesheet')
  } else {
    if (exported.FONT_CSS !== fontCssOnDisk) {
      problems.push('the embedded font stylesheet differs from locale/ja/font.css; rebuild')
    }
    if (typeof exported.applyFontOverride !== 'function') {
      problems.push('the bundle does not export applyFontOverride()')
    }
    if (!/html:lang\(ja\)/.test(fontCssOnDisk)) problems.push('locale/ja/font.css must scope its override with html:lang(ja)')
    if (!/Noto Sans JP/.test(fontCssOnDisk)) problems.push('locale/ja/font.css must name Noto Sans JP')
    if (/PingFang SC|Hiragino Sans GB|Microsoft YaHei/.test(fontCssOnDisk)) {
      problems.push('locale/ja/font.css still falls back to a Simplified-Chinese family')
    }
  }

  if (languages.length !== 1) {
    problems.push(`addLanguage called ${languages.length} times, expected 1`)
  } else if (languages[0].id !== 'ja' || languages[0].label !== '日本語' || languages[0].fallback !== 'en') {
    problems.push(`addLanguage received ${JSON.stringify(languages[0])}`)
  }

  const byNamespace = new Map(registrations.map((entry) => [entry.namespace, entry]))
  if (byNamespace.size !== registrations.length) problems.push('a namespace was registered more than once')
  for (const entry of registrations) {
    if (entry.locale !== 'ja') problems.push(`${entry.namespace}: registered under locale ${entry.locale}`)
  }
  for (const file of jaFiles) {
    const namespace = file.slice(0, -'.json'.length)
    const entry = byNamespace.get(namespace)
    if (!entry) {
      problems.push(`bundle never registers namespace ${namespace}`)
      continue
    }
    const onDisk = await readJson(join(jaDir, file))
    if (JSON.stringify(entry.dictionary) !== JSON.stringify(onDisk)) {
      problems.push(`${namespace}: bundle dictionary differs from locale/ja/${file}`)
    }
  }
  console.log(
    `bundle: id=${registration.id} inject=${JSON.stringify(exported.inject)} ` +
      `language=${languages[0]?.id}/${languages[0]?.label} namespaces=${registrations.length}`,
  )
}

// -- 3. host-half and package contract -------------------------------------

const hostHalf = await readFile(join(root, 'lib', 'index.js'), 'utf8')
if (!/export\s*\{\s*apply\s*\}|export function apply/.test(hostHalf)) {
  problems.push('lib/index.js does not export apply()')
}
const manifest = await readJson(join(root, 'package.json'))
if (manifest.dsh?.client?.platform !== 'web') problems.push('package.json dsh.client.platform must be "web"')
if (manifest.exports?.['./client']?.default !== './lib/client.js') {
  problems.push('package.json exports["./client"] must resolve to ./lib/client.js')
}
if (!manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-locale')) {
  problems.push('package.json dsh.client.inject must list @deepseek-ai/dsh-client-locale')
}

// -- report ----------------------------------------------------------------

console.log(
  `dictionaries: ${jaFiles.length}/${referenceFiles.length} namespaces, ${totalKeys} keys, ` +
    `${identical} still matching English`,
)
for (const warning of warnings.slice(0, 60)) console.log(`  warn: ${warning}`)
if (warnings.length > 60) console.log(`  warn: ... ${warnings.length - 60} more`)
for (const warning of styleWarnings) console.log(`  style: ${warning}`)

if (problems.length > 0) {
  console.error(`\nFAILED (${problems.length}):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\nOK')
