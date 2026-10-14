/**
 * Round-trip check for the profile installer.
 *
 * Runs `tools/install.mjs` against a throwaway profile in the OS temp directory:
 * the first run links the package and adds the Loader row, a second run changes
 * nothing, the package resolves as DSH would resolve it, a bundle-style install
 * is left alone, and uninstall restores the profile byte for byte.
 *
 * Usage: node tools/test-install.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const installScript = join(root, 'tools', 'install.mjs')

const failures = []
const check = (condition, description) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${description}`)
  if (!condition) failures.push(description)
}

const scratch = await mkdtemp(join(tmpdir(), 'dsh-locale-ja-install-test-'))
const profile = join(scratch, 'profile')
const patchPath = join(profile, 'cordis.patch.yml')
const linkPath = join(profile, 'node_modules', 'dsh-locale-ja')

const originalManifest = {
  name: 'dsh-profile-scratch',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: [] } },
}
const originalPatch = '# scratch profile patch\n[]\n'

/** Run the installer against the scratch profile. */
function install(...args) {
  const result = spawnSync(process.execPath, [installScript, '--profile', profile, ...args], {
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`install failed (${result.status}): ${result.stderr}`)
  return `${result.stdout}${result.stderr}`
}

const readPatch = () => readFile(patchPath, 'utf8')
const readManifest = async () => JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))

try {
  await mkdir(profile, { recursive: true })
  await writeFile(patchPath, originalPatch)
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(originalManifest, null, 2)}\n`)

  // -- dry run changes nothing ----------------------------------------------
  const dryRun = install('--dry-run')
  check(dryRun.includes('would link'), 'a dry run reports the link it would create')
  check(!existsSync(linkPath), 'a dry run creates no link')
  check((await readPatch()) === originalPatch, 'a dry run leaves the profile patch alone')

  // -- first install ---------------------------------------------------------
  install()
  check(existsSync(linkPath), 'install links the package into the profile')
  const installedPatch = await readPatch()
  check(
    installedPatch.includes('name: dsh-locale-ja') && installedPatch.includes('id: locale-ja'),
    'install adds the locale-ja Loader row',
  )
  check(installedPatch.startsWith(originalPatch), 'install appends instead of rewriting the profile patch')

  const require = createRequire(join(profile, 'package.json'))
  check(
    require.resolve('dsh-locale-ja/client') === join(root, 'lib', 'client.js'),
    'the profile resolves dsh-locale-ja/client as DSH would',
  )
  const manifest = await readManifest()
  check(Array.isArray(manifest.dsh.profile.bundles), 'install leaves the profile manifest otherwise untouched')

  // -- idempotence -----------------------------------------------------------
  install()
  check((await readPatch()) === installedPatch, 'a second install changes nothing')

  // -- bundle-style installs are left alone ---------------------------------
  const asBundle = { ...originalManifest, dependencies: { 'dsh-locale-ja': '^0.1.0' } }
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(asBundle, null, 2)}\n`)
  await writeFile(patchPath, originalPatch)
  const bundleRun = install()
  check(bundleRun.includes('already a profile dependency'), 'a bundle dependency suppresses the manual row')
  check((await readPatch()) === originalPatch, 'a bundle dependency leaves the profile patch alone')
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(originalManifest, null, 2)}\n`)
  install()

  // -- uninstall restores the profile ---------------------------------------
  install('--uninstall')
  check(!existsSync(linkPath), 'uninstall removes the link')
  check((await readPatch()) === originalPatch, 'uninstall restores the profile patch byte for byte')

  // -- a patch holding several entries keeps the others ---------------------
  const withOthers = `- id: ui-chat\n  config:\n    transcriptView: standard\n\n${installedPatch.slice(originalPatch.length)}- id: hmr\n  disabled: false\n`
  await writeFile(patchPath, withOthers)
  install()
  install('--uninstall')
  const remaining = await readPatch()
  check(
    remaining.includes('id: ui-chat') && remaining.includes('id: hmr') && !remaining.includes('locale-ja'),
    'uninstall removes only the managed row',
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nOK')
