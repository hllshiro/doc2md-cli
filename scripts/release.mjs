import { execSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const zipName = `${pkg.name}-${pkg.version}.zip`

// release/<version>/<name>/  — unpack 目录
const unpackDir = resolve('release', pkg.version, pkg.name)
const zipPath = resolve('release', pkg.version, zipName)

// 发行必备文件
const artifacts = [
  resolve('dist/cli-task-tool.exe'),
  resolve('dist/module'),
]

for (const f of artifacts) {
  if (!existsSync(f)) {
    console.error(`Missing artifact: ${f}\nRun "pnpm build" first.`)
    process.exit(1)
  }
}

// 清理并重建 unpack 目录
if (existsSync(unpackDir)) rmSync(unpackDir, { recursive: true, force: true })
mkdirSync(unpackDir, { recursive: true })

// 拷贝发行文件到 unpack 目录
copyFileSync(resolve('dist/cli-task-tool.exe'), join(unpackDir, 'cli-task-tool.exe'))
cpSync(resolve('dist/module'), join(unpackDir, 'module'), { recursive: true })

// 清理旧 zip，重新打包
if (existsSync(zipPath)) rmSync(zipPath)
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${unpackDir}' -DestinationPath '${zipPath}'"`,
  { stdio: 'inherit' },
)

console.log(`Released: release/${pkg.version}/${zipName}`)
console.log(`Unpacked: release/${pkg.version}/${pkg.name}/`)
