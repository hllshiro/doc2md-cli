import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const dirsToClean = [
  'dist',
  'module/MetafileConverter/MetafileConverter/bin',
  'module/MetafileConverter/MetafileConverter/obj',
]

console.log('Cleaning temporary build directories...\n')

for (const dir of dirsToClean) {
  const fullPath = resolve(dir)
  try {
    rmSync(fullPath, { recursive: true, force: true })
    console.log(`✓ Cleaned: ${dir}`)
  } catch (err) {
    console.error(`✗ Failed to clean: ${dir} - ${err.message}`)
  }
}

console.log('\nClean complete!')
