import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Returns a styled (Y/n) or (y/N) string for inquirer confirm prompts,
 * highlighting the default answer in bold green and dimming the other.
 */
export function confirmDefaultAnswer(defaultYes: boolean): string {
  const yes = '\x1b[1;32mY\x1b[0m'
  const no = '\x1b[1;32mN\x1b[0m'
  const dimYes = '\x1b[2;37my\x1b[0m'
  const dimNo = '\x1b[2;37mn\x1b[0m'
  return defaultYes ? `(${yes}/${dimNo})` : `(${dimYes}/${no})`
}

const CACHE_DIR = join(homedir(), '.doc2xml-cli')
const CACHE_FILE = join(CACHE_DIR, 'cache.json')

export type InputCache = {
  docxInputPath?: string
  aiBaseURL?: string
  aiApiKey?: string
  aiModel?: string
  aiEnableValidation?: boolean
}

/**
 * Reads the persisted input cache from disk.
 * Returns an empty object if the file does not exist or is unreadable.
 */
export async function loadCache(): Promise<InputCache> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf-8')
    return JSON.parse(raw) as InputCache
  } catch {
    return {}
  }
}

/**
 * Merges the provided partial cache with the existing one and writes it to disk.
 */
export async function saveCache(partial: Partial<InputCache>): Promise<void> {
  try {
    const existing = await loadCache()
    const merged = { ...existing, ...partial }
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(merged, null, 2), 'utf-8')
  } catch {
    // 缓存写入失败不影响主流程，静默忽略
  }
}
