/**
 * Minimal reader for Electron asar archives: enough to pull one member out by
 * path so the verification harness can load the bundles the app actually ships.
 */

import { readFileSync } from 'node:fs'

/**
 * Read a single member from an asar archive.
 * @param asarPath - absolute path to the `.asar` file.
 * @param memberPath - member path, with or without a leading slash.
 * @returns the member's text content.
 */
export function readAsarMember(asarPath, memberPath) {
  const buffer = readFileSync(asarPath)
  const headerSize = buffer.readUInt32LE(4)
  const jsonSize = buffer.readUInt32LE(12)
  const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString('utf8'))
  const dataStart = 8 + headerSize

  const parts = memberPath.split('/').filter(Boolean)
  let node = header
  for (const part of parts) {
    node = node.files?.[part]
    if (node === undefined) throw new Error(`asar: no member ${memberPath}`)
  }
  if (node.offset === undefined) throw new Error(`asar: ${memberPath} is a symlink entry, not a file`)
  return buffer.subarray(dataStart + Number(node.offset), dataStart + Number(node.offset) + node.size).toString('utf8')
}
