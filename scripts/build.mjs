import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { inject } from 'postject'

const outDir = 'dist'
const exeName = 'cli-task-tool.exe'

// Ensure dist directory exists
mkdirSync(outDir, { recursive: true })

// Step 1: Bundle src/main.ts → dist/bundle.cjs
console.log('Bundling with esbuild...')
await build({
  entryPoints: ['src/main.ts'],
  outfile: join(outDir, 'bundle.cjs'),
  platform: 'node',
  bundle: true,
  format: 'cjs',
  minify: true,
  banner: {
    js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__importMetaUrl',
  },
})
console.log('Bundle complete: dist/bundle.cjs')

// Step 2: Generate SEA blob
console.log('Generating SEA blob...')
execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' })
console.log('Blob generated: dist/sea-prep.blob')

// Step 3: Copy node executable
const outExe = resolve(outDir, exeName)
console.log(`Copying node executable to ${outExe}...`)
copyFileSync(process.execPath, outExe)

// Step 4: Inject blob via postject JS API
console.log('Injecting blob with postject...')
const blob = readFileSync(resolve(outDir, 'sea-prep.blob'))
await inject(outExe, 'NODE_SEA_BLOB', blob, {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
})
console.log(`Build complete: ${outExe}`)
