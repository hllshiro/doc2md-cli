# Implementation Plan: cli-task-tool

## Overview

基于 listr2 的交互式 CLI 任务流水线，将 Word 文档（.docx）转换为 Markdown。使用 TypeScript 编写，通过 esbuild + Node.js SEA 编译为单一可执行文件。

## Tasks

- [x] 1. 初始化项目配置
  - 更新 `package.json`：添加 `type: "module"`、`scripts`（`build`、`lint`、`format`、`test`）、`dependencies` 和 `devDependencies` 字段
  - 创建 `tsconfig.json`：启用 `strict`、`target: ES2022`、`module: NodeNext`、`moduleResolution: NodeNext`
  - 创建 `.eslintrc.json`（或 `eslint.config.js`）：配置 TypeScript ESLint 规则
  - 创建 `.prettierrc`：配置格式化规则（singleQuote、semi、printWidth 等）
  - 创建 `sea-config.json`：配置 Node.js SEA 打包参数（`main: dist/bundle.cjs`、`output: dist/sea-prep.blob`）
  - _Requirements: 6.1, 6.2, 6.3, 5.3_

- [x] 2. 安装依赖
  - 运行 `pnpm install` 安装 `listr2`、`@listr2/prompt-adapter-inquirer`、`@inquirer/prompts`
  - 安装 devDependencies：`typescript`、`@types/node`、`eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin`、`prettier`、`esbuild`、`vitest`、`fast-check`、`postject`
  - _Requirements: 6.1_

- [x] 3. 实现 AppContext 类型（`src/context.ts`）
  - 定义并导出 `AppContext` 接口：`docxPath: string`、`pandocPath: string`、`pandocArgs?: string[]`、`outputPath?: string`
  - 导出初始上下文工厂函数 `createContext(): AppContext`，返回 `{ docxPath: '', pandocPath: '' }`
  - _Requirements: 4.3_

- [x] 4. 实现 TaskRunner（`src/runner.ts`）
  - 导入 `Listr` 并创建 `createRunner(ctx: AppContext)` 函数，返回配置好的 `Listr<AppContext>` 实例
  - 配置 `rendererOptions: { collapseSubtasks: false }`
  - _Requirements: 4.1, 4.2, 4.4_

  - [ ]* 4.1 为任务顺序执行编写属性测试
    - **Property 8: 任务按注册顺序执行**
    - **Validates: Requirements 4.4**
    - 使用 fast-check 生成任意长度的任务序列，验证执行顺序与注册顺序一致，且前序任务写入 Context 的数据对后续任务可见

- [x] 5. 实现 Docx_Input_Task（`src/tasks/docxInput.ts`）
  - 提取并导出纯函数 `validateDocxPath(input: string): string | undefined`：空字符串或纯空白返回错误提示，否则返回 `undefined`
  - 实现 `docxInputTask: ListrTask<AppContext>`：
    - 使用 `@inquirer/prompts` 的 `input` 提示收集 `.docx` 路径，`validate` 调用 `validateDocxPath`
    - 使用 `confirm` 提示确认公式格式；用户拒绝时抛出 `Error('请先完成公式转换')`
    - 确认后将路径写入 `ctx.docxPath`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 5.1 为 `validateDocxPath` 编写属性测试
    - **Property 1: 空路径输入被拒绝**
    - **Validates: Requirements 1.5**
    - 使用 `fc.stringMatching(/^\s*$/)` 生成任意空白字符串，断言返回值不为 `undefined`

  - [ ]* 5.2 为有效路径写入 Context 编写属性测试
    - **Property 2: 有效路径写入 Context**
    - **Validates: Requirements 1.1, 1.3**
    - 使用 `fc.string({ minLength: 1 })` 过滤非空白字符串，验证写入 `ctx.docxPath` 后值与输入相等

  - [ ]* 5.3 为拒绝确认时流水线终止编写示例测试
    - **Property 3: 拒绝确认时流水线终止**
    - **Validates: Requirements 1.4**
    - Mock `confirm` 返回 `false`，断言任务抛出包含提示信息的 Error

- [x] 6. 实现 Pandoc_Check_Task（`src/tasks/pandocCheck.ts`）
  - 提取并导出纯函数 `resolvePandocDefault(execPath: string): string`：返回 `path.join(path.dirname(execPath), 'pandoc.exe')`
  - 实现 `pandocCheckTask: ListrTask<AppContext>`：
    - 使用 `which`（或 `child_process.execSync('pandoc --version')`）检测系统 PATH 中的 pandoc
    - 若存在，将路径写入 `ctx.pandocPath`
    - 若不存在，使用 `input` 提示用户输入，默认值为 `resolvePandocDefault(process.execPath)`，将结果写入 `ctx.pandocPath`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.2_

  - [ ]* 6.1 为 `resolvePandocDefault` 编写属性测试
    - **Property 5: exe 同目录 pandoc 默认值**
    - **Validates: Requirements 5.2**
    - 使用 `fc.string()` 生成任意 execPath，验证返回值等于 `path.join(path.dirname(execPath), 'pandoc.exe')`

  - [ ]* 6.2 为 pandocPath 非空编写属性测试
    - **Property 4: pandoc 路径始终非空**
    - **Validates: Requirements 2.2, 2.4**
    - 分别 mock pandoc 存在和不存在两种情况，验证任务完成后 `ctx.pandocPath` 为非空字符串

- [x] 7. 实现 Convert_Task（`src/tasks/convert.ts`）
  - 提取并导出纯函数 `buildPandocArgs(ctx: AppContext): string[]`：根据 `ctx.docxPath`、`ctx.pandocArgs` 构造 pandoc 参数数组
  - 实现 `convertTask: ListrTask<AppContext>`：
    - 使用 `child_process.spawn` 调用 `ctx.pandocPath`，传入 `buildPandocArgs(ctx)` 参数
    - 退出码为 0 时写入 `ctx.outputPath`，任务正常完成
    - 非零退出码或异常时，捕获 stderr 并抛出 `Error(stderr)`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 7.1 为转换成功编写属性测试
    - **Property 6: 转换成功时任务状态为完成**
    - **Validates: Requirements 3.1, 3.2**
    - Mock `spawn` 返回退出码 0，验证 `convertTask` 不抛出异常

  - [ ]* 7.2 为转换失败编写属性测试
    - **Property 7: 转换失败时错误被捕获**
    - **Validates: Requirements 3.3**
    - 使用 `fc.integer({ min: 1, max: 255 })` 生成任意非零退出码，mock `spawn`，验证任务抛出包含 stderr 内容的 Error

- [x] 8. 实现 main.ts 入口（`src/main.ts`）
  - 导入 `createContext`、`createRunner`、`docxInputTask`、`pandocCheckTask`、`convertTask`
  - 创建 `ctx`，实例化 runner，依次 `runner.add()` 注册三个任务
  - 调用 `runner.run()` 启动流水线，捕获顶层错误并以非零退出码退出
  - _Requirements: 4.1, 4.2, 4.4_

- [x] 9. 配置 esbuild 打包脚本
  - 创建 `scripts/build.mjs`（或在 `package.json` 的 `build` 脚本中内联）：
    - 使用 esbuild 将 `src/main.ts` 打包为 `dist/bundle.cjs`（`platform: node`、`bundle: true`、`format: cjs`）
    - 执行 `node --experimental-sea-config sea-config.json` 生成 blob
    - 复制 node 可执行文件并通过 `postject` 注入 blob，生成最终 exe
  - 在 `package.json` 中添加 `"build": "node scripts/build.mjs"` 脚本
  - _Requirements: 5.1, 5.3_

- [x] 10. 最终检查点 — 确保所有测试通过
  - 运行 `pnpm test --run` 确保所有单元测试和属性测试通过
  - 运行 `pnpm lint` 确保无 ESLint 错误
  - 如有问题，请向用户说明并等待确认后继续

## Notes

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务均引用具体需求条款以保证可追溯性
- 属性测试每次运行最少 100 次迭代（fast-check 默认值）
- 纯函数（`validateDocxPath`、`resolvePandocDefault`、`buildPandocArgs`）应从任务文件中提取导出，便于独立测试
