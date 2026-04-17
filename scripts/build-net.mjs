import { cpSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const srcDir = resolve('module/MetafileConverter/MetafileConverter/bin/Release/net8.0')
const dstDir = resolve('dist/module')

// Step 1: 编译 .NET 项目
console.log('Building .NET project...')
execSync(
  'dotnet build module/MetafileConverter/MetafileConverter/MetafileConverter.csproj -c Release',
  { stdio: 'inherit' }
)
console.log('.NET build complete')

// Step 2: 清空并创建目标目录
mkdirSync(dstDir, { recursive: true })
rmSync(dstDir, { recursive: true, force: true })
mkdirSync(dstDir, { recursive: true })

// 必要文件：exe、托管程序集、运行时配置、依赖 dll
const files = [
  'MetafileConverter.exe',
  'MetafileConverter.dll',
  'MetafileConverter.runtimeconfig.json',
  'System.Drawing.Common.dll',
  'System.Private.Windows.Core.dll',
  'System.Private.Windows.GdiPlus.dll',
  'Microsoft.Win32.SystemEvents.dll',
]

for (const f of files) {
  copyFileSync(join(srcDir, f), join(dstDir, f))
}

// runtimes/win 下的平台特定实现（Windows 上 SystemEvents 的真正实现）
const runtimesDst = join(dstDir, 'runtimes/win/lib/net8.0')
mkdirSync(runtimesDst, { recursive: true })
copyFileSync(
  join(srcDir, 'runtimes/win/lib/net8.0/Microsoft.Win32.SystemEvents.dll'),
  join(runtimesDst, 'Microsoft.Win32.SystemEvents.dll')
)

console.log('Copied .NET build output → dist/module')
