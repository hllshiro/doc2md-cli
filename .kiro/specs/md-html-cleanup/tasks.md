# Implementation Plan: md-html-cleanup

## Overview

在现有 Listr2 流水线中新增 `mdCleanup` 任务，对 pandoc 输出的 Markdown 文件进行 HTML 清理，输出标准 Markdown。实现分三步：扩展上下文类型 → 实现核心清理逻辑 → 注册到流水线。

## Tasks

- [x] 1. 扩展 AppContext，添加 MdCleanupContext
  - 在 `src/context.ts` 中新增 `MdCleanupContext` 接口（含 `outputPath: string` 字段）
  - 在 `AppContext` 接口中添加可选字段 `mdCleanupContext?: MdCleanupContext`
  - _Requirements: 1.5_

- [x] 2. 实现 cleanMarkdown 纯函数
  - 在 `src/tasks/mdCleanup.ts` 中创建文件，定义 `HEADING_MAP` 常量
  - 实现状态机（NORMAL / IN_ZHENGWEN / IN_HEADING / IN_FIGURE / IN_TABLE）
  - 实现 `cleanMarkdown(source: string, warn: (msg: string) => void): string` 纯函数
  - 按设计文档中的正则模式处理各规则（Rule 1–7）
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 7.1, 7.2_

  - [ ]* 2.1 为 Rule 1（正文段落）编写属性测试
    - **Property 1: 正文段落内文本保留不变**
    - **Property 2: 输出中不含正文段落 div 标签**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 2.2 为 Rule 2（标题转换）编写属性测试
    - **Property 3: 标题级别正确性**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 2.3 为 Rule 3（Figure 转 Markdown 图片）编写属性测试
    - **Property 5: Figure 块转换为 Markdown 图片语法**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [ ]* 2.4 为 Rule 4/5/6/7（透传规则）编写属性测试
    - **Property 4: 独立 img 标签原样保留**
    - **Property 6: Table 块原样保留**
    - **Property 7: 内容顺序保持不变**
    - **Property 8: 幂等性（cleanMarkdown 应用两次结果相同）**
    - **Validates: Requirements 4.1, 6.1, 6.2, 7.1, 7.2**

- [x] 3. Checkpoint — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 4. 实现 mdCleanupTask（Listr2 任务）
  - 在 `src/tasks/mdCleanup.ts` 中实现 `mdCleanupTask: ListrTask<AppContext>`
  - 从 `ctx.docxConvertContext` 读取源文件路径（`out/mediaConvert/{filename}.md`）
  - 创建输出目录 `out/mdCleanup/`
  - 调用 `cleanMarkdown()` 并将结果写入 `out/mdCleanup/{filename}.md`
  - 将输出路径写入 `ctx.mdCleanupContext`
  - 源文件读取失败时 reject 并附带描述性错误信息
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 5. 在 main.ts 中注册 mdCleanupTask
  - 在 `src/main.ts` 中 import `mdCleanupTask`
  - 在 `mediaConvertTask` 之后调用 `runner.add(mdCleanupTask)`
  - _Requirements: 1.1_

- [x] 6. Final Checkpoint — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

## Notes

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 进度
- `cleanMarkdown` 为纯函数，便于独立单元测试
- 属性测试验证普遍正确性，单元测试验证具体示例和边界情况
- 每个任务均引用具体需求条款以保证可追溯性
