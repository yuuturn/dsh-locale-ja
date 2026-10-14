/**
 * Install (or remove) the `dsh-locale-ja` language pack in a DSH profile.
 *
 * Two filesystem changes, both idempotent:
 *   1. `<profile>/node_modules/dsh-locale-ja` -> this project (symlink), so the
 *      profile's Loader can resolve the package name.
 *   2. a marked `insert` row in `<profile>/cordis.patch.yml`, so the Loader
 *      composes the plugin. HMR applies this live in profiles that watch their
 *      configuration; otherwise restart the app.
 *
 * Usage:
 *   node tools/install.mjs [--profile <dir>] [--uninstall] [--dry-run]
 *
 * The profile directory defaults to $DSH_PROFILE_DIR, else
 * $DSH_HOME/profiles/$DSH_PROFILE, else ~/.dsh/profiles/desktop.
 */

import { lstat, mkdir, readFile, readlink, rm, symlink, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageName = 'dsh-locale-ja'
const entryId = 'locale-ja'
const marker = `# ${packageName}: Japanese language pack (managed by tools/install.mjs)`
const row = `${marker}
- insert:
    - id: ${entryId}
      name: ${packageName}
`

const args = process.argv.slice(2)
const uninstall = args.includes('--uninstall')
const dryRun = args.includes('--dry-run')
const profileFlag = args.indexOf('--profile')
const profileArg = profileFlag >= 0 ? args[profileFlag + 1] : process.env.DSH_PROFILE_DIR
const profile = profileArg
  ? resolve(profileArg)
  : join(
      process.env.DSH_HOME ?? join(homedir(), '.dsh'),
      'profiles',
      process.env.DSH_PROFILE ?? 'desktop',
    )

const linkPath = join(profile, 'node_modules', packageName)
const patchPath = join(profile, 'cordis.patch.yml')

/** Report and optionally apply one filesystem change. */
async function report(description, apply) {
  if (dryRun) {
    console.log(`would ${description}`)
    return
  }
  await apply()
  console.log(`did ${description}`)
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

if (!(await exists(profile))) {
  console.error(`install: profile directory not found: ${profile}`)
  process.exit(1)
}

const patch = (await exists(patchPath)) ? await readFile(patchPath, 'utf8') : ''
const installed = patch.includes(marker) && patch.includes(`name: ${packageName}`)

/**
 * Whether the profile already pulls this package in as a bundle/pnpm dependency.
 * That install path supplies its own Loader row (`cordis.patch.yml` in the
 * package), so adding the manual row here would compose the entry twice.
 */
async function installedAsDependency() {
  const manifestPath = join(profile, 'package.json')
  if (!(await exists(manifestPath))) return false
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    return (
      Object.keys(manifest.dependencies ?? {}).includes(packageName) ||
      (manifest.dsh?.profile?.bundles ?? []).includes(packageName)
    )
  } catch {
    return false
  }
}

if (uninstall) {
  if (await exists(linkPath)) {
    await report(`remove symlink ${linkPath}`, async () => {
      const stat = await lstat(linkPath)
      if (!stat.isSymbolicLink()) throw new Error(`${linkPath} is not a symlink; refusing to remove`)
      await rm(linkPath)
    })
  } else {
    console.log(`skip: no symlink at ${linkPath}`)
  }

  if (installed) {
    await report(`remove the ${entryId} row from ${patchPath}`, async () => {
      const lines = patch.split('\n')
      const start = lines.findIndex((line) => line.trim() === marker)
      if (start < 0) return
      // The managed block is the marker plus its `- insert:` entry: skip the
      // block's own first line before scanning for the next entry.
      let end = Math.min(start + 2, lines.length)
      while (end < lines.length && !/^- /.test(lines[end])) end += 1
      lines.splice(start, end - start)
      // Drop the blank line(s) the block introduced, then keep one final newline.
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      await writeFile(patchPath, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
    })
  } else {
    console.log(`skip: no managed row in ${patchPath}`)
  }
  console.log('\nRestart the app (or let HMR reload the profile) to unload the pack.')
} else {
  // Windows cannot create directory symlinks without elevation; a junction is
  // the equivalent that works for everyone.
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'

  if (await exists(linkPath)) {
    const stat = await lstat(linkPath)
    const target = stat.isSymbolicLink() ? await readlink(linkPath) : undefined
    if (target === root) console.log(`skip: ${linkType === 'junction' ? 'junction' : 'symlink'} already points at ${root}`)
    else console.log(`note: ${linkPath} already exists${target ? ` -> ${target}` : ''}; leaving it alone`)
  } else {
    await report(`link ${linkPath} -> ${root}`, async () => {
      await mkdir(dirname(linkPath), { recursive: true })
      await symlink(root, linkPath, linkType)
    })
  }

  if (installed) {
    console.log(`skip: ${patchPath} already carries the ${entryId} row`)
  } else if (await installedAsDependency()) {
    console.log(
      `skip: ${packageName} is already a profile dependency, so its bundle patch supplies the ${entryId} row`,
    )
  } else {
    await report(`add the ${entryId} row to ${patchPath}`, async () => {
      const text = patch.length === 0 ? '[]\n' : patch
      const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
      await writeFile(patchPath, `${text}${separator}${row}`)
    })
  }

  console.log(
    `\nProfile: ${profile}\n` +
      'Restart DSH (HMR-enabled profiles apply the row live, but a restart also\n' +
      'picks up newly installed fonts). Then open Settings -> General -> Language\n' +
      'and pick 日本語.',
  )
}
