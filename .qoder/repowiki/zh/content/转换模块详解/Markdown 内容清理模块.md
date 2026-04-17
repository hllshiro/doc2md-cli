# Markdown 内容清理模块

<cite>
**本文档引用的文件**
- [src/tasks/mdCleanup/index.ts](file://src/tasks/mdCleanup/index.ts)
- [src/tasks/mdCleanup/constants.ts](file://src/tasks/mdCleanup/constants.ts)
- [src/tasks/mdCleanup/helpers.ts](file://src/tasks/mdCleanup/helpers.ts)
- [src/tasks/mdCleanup/stateMachine.ts](file://src/tasks/mdCleanup/stateMachine.ts)
- [src/tasks/mdCleanup/task.ts](file://src/tasks/mdCleanup/task.ts)
- [src/tasks/mdCleanup/types.ts](file://src/tasks/mdCleanup/types.ts)
- [src/context.ts](file://src/context.ts)
- [src/main.ts](file://src/main.ts)
- [src/runner.ts](file://src/runner.ts)
- [src/logger.ts](file://src/logger.ts)
</cite>

## 更新摘要
**变更内容**
- 完成 Markdown 清理模块的模块化重构，从单一文件(mdCleanup.ts)拆分为六个专门文件
- 新增 constants.ts、helpers.ts、stateMachine.ts、task.ts、types.ts 等模块化组件
- 采用新的状态机实现和更好的模块化设计
- 保持原有功能不变，提升代码可维护性和可测试性

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本模块是 doc2md-cli 工作流中的关键后处理任务，负责清理由 pandoc 从 Word 文档转换而来的 Markdown 中的 HTML 遗留标记，将其规范化为标准 Markdown。经过模块化重构后，采用"状态机 + 正则扫描"的轻量实现，确保在单次线性扫描中完成所有清理规则，同时具备幂等性与顺序不变性。

重构后的模块实现了完整的错误处理机制，提供详细的日志记录和警告输出，支持多行图片处理机制，支持跨行闭合的图片标签，以及完整的属性清理功能。

## 项目结构
重构后的模块采用模块化架构，位于 src/tasks/mdCleanup/ 目录下，包含以下六个专门文件：

```mermaid
graph TB
subgraph "模块化架构"
INDEX["index.ts<br/>模块入口<br/>导出主要功能"]
CONST["constants.ts<br/>常量定义<br/>正则表达式与映射表"]
HELP["helpers.ts<br/>辅助函数<br/>工具方法"]
STATE["stateMachine.ts<br/>状态机实现<br/>核心清理逻辑"]
TASK["task.ts<br/>任务实现<br/>Listr2 任务封装"]
TYPES["types.ts<br/>类型定义<br/>接口与枚举"]
end
subgraph "CLI 主程序"
MAIN["src/main.ts<br/>注册任务序列"]
RUNNER["src/runner.ts<br/>Listr2 Runner"]
LOGGER["src/logger.ts<br/>日志系统"]
end
subgraph "转换阶段"
DOCX["docxConvert<br/>DOCX → Markdown(gfm)"]
MEDIA["mediaConvert<br/>EMF/WMF → JPG + 路径修正"]
end
subgraph "清理阶段"
CLEAN["mdCleanup<br/>HTML 标记清理<br/>状态机解析"]
end
MAIN --> RUNNER
RUNNER --> LOGGER
RUNNER --> DOCX --> MEDIA --> CLEAN
```

**图表来源**
- [src/tasks/mdCleanup/index.ts:1-16](file://src/tasks/mdCleanup/index.ts#L1-L16)
- [src/tasks/mdCleanup/constants.ts:1-41](file://src/tasks/mdCleanup/constants.ts#L1-L41)
- [src/tasks/mdCleanup/helpers.ts:1-82](file://src/tasks/mdCleanup/helpers.ts#L1-L82)
- [src/tasks/mdCleanup/stateMachine.ts:1-347](file://src/tasks/mdCleanup/stateMachine.ts#L1-L347)
- [src/tasks/mdCleanup/task.ts:1-72](file://src/tasks/mdCleanup/task.ts#L1-L72)
- [src/tasks/mdCleanup/types.ts:1-50](file://src/tasks/mdCleanup/types.ts#L1-L50)

**章节来源**
- [src/tasks/mdCleanup/index.ts:1-16](file://src/tasks/mdCleanup/index.ts#L1-L16)
- [src/tasks/mdCleanup/constants.ts:1-41](file://src/tasks/mdCleanup/constants.ts#L1-L41)
- [src/tasks/mdCleanup/helpers.ts:1-82](file://src/tasks/mdCleanup/helpers.ts#L1-L82)
- [src/tasks/mdCleanup/stateMachine.ts:1-347](file://src/tasks/mdCleanup/stateMachine.ts#L1-L347)
- [src/tasks/mdCleanup/task.ts:1-72](file://src/tasks/mdCleanup/task.ts#L1-L72)
- [src/tasks/mdCleanup/types.ts:1-50](file://src/tasks/mdCleanup/types.ts#L1-L50)

## 核心组件
重构后的模块由以下核心组件构成：

### 模块入口 (index.ts)
- 导出主要功能：`cleanMarkdown` 和 `mdCleanupTask`
- 导出常量：`HEADING_MAP` 供外部使用
- 导出类型：`State`、`CleanContext`、`WarnFn`

### 常量定义 (constants.ts)
- 标题级别映射：中文序号 → ATX 前缀
- 正则表达式模式：HTML 标签匹配模式
- 属性清理模式：ID、Class、Style 属性清理

### 辅助函数 (helpers.ts)
- 行首块引用标记去除
- 图片路径到 alt 文本转换
- 内联图片标签处理
- 行内容处理与状态检测

### 状态机实现 (stateMachine.ts)
- 状态枚举：NORMAL、IN_ZHENGWEN、IN_HEADING、IN_FIGURE、IN_TABLE、IN_IMG、IN_DATA_CUSTOM_STYLE、IN_CUSTOM_STYLE
- 状态处理器映射表
- 清理上下文管理
- 未闭合块处理

### 任务实现 (task.ts)
- Listr2 任务封装
- 文件读写操作
- 错误处理与日志记录
- 输出上下文管理

### 类型定义 (types.ts)
- 状态枚举定义
- 清理上下文接口
- 警告回调函数类型
- 处理器函数类型

**章节来源**
- [src/tasks/mdCleanup/index.ts:7-15](file://src/tasks/mdCleanup/index.ts#L7-L15)
- [src/tasks/mdCleanup/constants.ts:4-40](file://src/tasks/mdCleanup/constants.ts#L4-L40)
- [src/tasks/mdCleanup/helpers.ts:4-81](file://src/tasks/mdCleanup/helpers.ts#L4-L81)
- [src/tasks/mdCleanup/stateMachine.ts:4-49](file://src/tasks/mdCleanup/stateMachine.ts#L4-L49)
- [src/tasks/mdCleanup/task.ts:11-71](file://src/tasks/mdCleanup/task.ts#L11-L71)
- [src/tasks/mdCleanup/types.ts:4-49](file://src/tasks/mdCleanup/types.ts#L4-L49)

## 架构总览
重构后的 mdCleanup 作为 Listr2 任务，串联在 docxConvert 与 mediaConvert 之后，负责最终输出干净的 Markdown 文件。其数据流如下：

```mermaid
sequenceDiagram
participant Main as "主程序(main.ts)"
participant Runner as "Runner(runner.ts)"
participant Logger as "Logger(logger.ts)"
participant Clean as "mdCleanupTask"
participant FS as "文件系统"
Main->>Runner : 创建 Runner(AppContext)
Runner->>Logger : 初始化日志系统
Runner->>Clean : 执行 mdCleanup 任务
Clean->>FS : 读取源文件
Clean->>Clean : cleanMarkdown(source, warn)
Clean->>Logger : 记录清理过程
Clean->>FS : 写入 out/mdCleanup/*.md
Clean-->>Runner : 更新 AppContext.lastContext
```

**图表来源**
- [src/main.ts:26-31](file://src/main.ts#L26-L31)
- [src/runner.ts:4-9](file://src/runner.ts#L4-L9)
- [src/logger.ts:78-96](file://src/logger.ts#L78-L96)
- [src/tasks/mdCleanup/task.ts:13-71](file://src/tasks/mdCleanup/task.ts#L13-L71)

## 详细组件分析

### 状态机设计与实现
重构后的状态机采用模块化设计，每个状态都有专门的处理器函数：

```mermaid
stateDiagram-v2
[*] --> NORMAL
NORMAL --> IN_ZHENGWEN : 匹配"正文段落"打开
NORMAL --> IN_HEADING : 匹配"N级标题"打开
NORMAL --> IN_FIGURE : 匹配<figure>打开
NORMAL --> IN_TABLE : 匹配<table>打开
NORMAL --> IN_DATA_CUSTOM_STYLE : 匹配 data-custom-style 打开
NORMAL --> IN_CUSTOM_STYLE : 匹配 custom-style 打开
NORMAL --> IN_IMG : 行内出现<img且未闭合
IN_ZHENGWEN --> NORMAL : 匹配"正文段落"关闭
IN_HEADING --> NORMAL : 匹配"N级标题"关闭
IN_FIGURE --> NORMAL : 匹配</figure>关闭
IN_TABLE --> NORMAL : 匹配</table>关闭
IN_DATA_CUSTOM_STYLE --> NORMAL : 匹配</div>关闭
IN_CUSTOM_STYLE --> NORMAL : 匹配</div>关闭
IN_IMG --> NORMAL : 匹配<img/>或>闭合
IN_IMG --> IN_IMG : 多行图片继续
```

**图表来源**
- [src/tasks/mdCleanup/types.ts:4-13](file://src/tasks/mdCleanup/types.ts#L4-L13)
- [src/tasks/mdCleanup/stateMachine.ts:52-203](file://src/tasks/mdCleanup/stateMachine.ts#L52-L203)

**章节来源**
- [src/tasks/mdCleanup/types.ts:4-13](file://src/tasks/mdCleanup/types.ts#L4-L13)
- [src/tasks/mdCleanup/stateMachine.ts:52-203](file://src/tasks/mdCleanup/stateMachine.ts#L52-L203)

### HTML 标记清理算法
重构后的算法保持原有功能，但代码结构更加清晰：

- **正文段落包装器移除**
  - 打开与关闭标签分别在进入/退出 IN_ZHENGWEN 时丢弃
  - 保留内部文本与空白行
- **中文标题映射**
  - 从列表项行提取中文序号，查表得到 ATX 前缀
  - 收集标题文本，去除空行后输出为 ATX 标题
- **figure 块转 Markdown 图片**
  - 收集内部行，抽取 src 与 caption 文本
  - 若无 src，发出警告并丢弃；否则输出标准 Markdown 图片
- **表格块透传**
  - 将 table 及其子树原样输出
- **内联图片替换**
  - 单行内完整 <img .../> 或 <img ...> 替换为 ![alt](src)
  - 若无 src，保留原样并发出警告
- **多行图片处理**
  - 记录起始行前缀与中间行，直到遇到闭合标签
  - 闭合后若存在尾随文本，先替换其中的完整内联图片，再决定是否继续留在 IN_IMG 状态
- **属性清理**
  - 最终清理：删除所有标签的 id、class、style 属性

**章节来源**
- [src/tasks/mdCleanup/stateMachine.ts:52-109](file://src/tasks/mdCleanup/stateMachine.ts#L52-L109)
- [src/tasks/mdCleanup/stateMachine.ts:114-138](file://src/tasks/mdCleanup/stateMachine.ts#L114-L138)
- [src/tasks/mdCleanup/stateMachine.ts:143-166](file://src/tasks/mdCleanup/stateMachine.ts#L143-L166)
- [src/tasks/mdCleanup/stateMachine.ts:171-183](file://src/tasks/mdCleanup/stateMachine.ts#L171-L183)
- [src/tasks/mdCleanup/stateMachine.ts:208-262](file://src/tasks/mdCleanup/stateMachine.ts#L208-L262)
- [src/tasks/mdCleanup/stateMachine.ts:340-346](file://src/tasks/mdCleanup/stateMachine.ts#L340-L346)

### 中文标题映射机制
- **映射表定义**
  - "一"到"六"分别映射为"#"到"######"
- **规则应用**
  - 在进入 IN_HEADING 时，从匹配的样式字符串中提取首个汉字序号
  - 查表得到 ATX 前缀；未知样式发出警告并回退为直通输出
- **输出行为**
  - 成功映射：输出形如"### 标题文本"的 ATX 标题
  - 未知样式：输出收集到的标题文本（不带 ATX 前缀）

**章节来源**
- [src/tasks/mdCleanup/constants.ts:4-11](file://src/tasks/mdCleanup/constants.ts#L4-L11)
- [src/tasks/mdCleanup/stateMachine.ts:58-71](file://src/tasks/mdCleanup/stateMachine.ts#L58-L71)
- [src/tasks/mdCleanup/stateMachine.ts:124-138](file://src/tasks/mdCleanup/stateMachine.ts#L124-L138)

### 图像标签优化策略
- **单行内联图片**
  - 使用正则一次性替换完整 <img .../> 或 <img ...> 为 Markdown 语法
  - 从 src 属性提取 alt 文本（文件名去扩展名）
- **多行图片处理**
  - 记录起始行前缀与中间行，直至闭合
  - 闭合后若存在尾随文本，先处理尾随文本中的内联图片，再决定状态转移
- **错误处理**
  - 无 src 的图片：保留原样并发出警告
  - 未闭合的多行图片：保留原样并发出警告
- **figure 块中的图片**
  - 从内部行抽取 src 与 caption 文本，输出标准 Markdown 图片
- **属性清理**
  - 删除所有标签的 id、class、style 属性

**章节来源**
- [src/tasks/mdCleanup/helpers.ts:34-43](file://src/tasks/mdCleanup/helpers.ts#L34-L43)
- [src/tasks/mdCleanup/helpers.ts:57-81](file://src/tasks/mdCleanup/helpers.ts#L57-L81)
- [src/tasks/mdCleanup/stateMachine.ts:208-262](file://src/tasks/mdCleanup/stateMachine.ts#L208-L262)
- [src/tasks/mdCleanup/stateMachine.ts:143-166](file://src/tasks/mdCleanup/stateMachine.ts#L143-L166)
- [src/tasks/mdCleanup/constants.ts:36-40](file://src/tasks/mdCleanup/constants.ts#L36-L40)

### 清理规则优先级与执行顺序
- **规则顺序**
  1) 进入正文段落块：丢弃包装器，保留内部文本
  2) 进入标题块：提取中文序号映射为 ATX 前缀，收集标题文本
  3) 进入 figure 块：抽取 src 与 caption，输出 Markdown 图片
  4) 进入 table 块：原样透传
  5) 进入 data-custom-style/div 块：处理自定义样式
  6) 进入 custom-style/div 块：处理自定义样式
  7) 其余行：先剥离引用块前缀，再替换内联图片，最后检测未闭合的 <img>
- **优先级说明**
  - 块级规则（正文、标题、figure、table、自定义样式）优先于行内替换
  - 行内替换按"完整内联图片 → 未闭合跨行图片"顺序处理
  - 未知标题样式与无 src 图片会发出警告但不中断流程
  - 最终属性清理在所有处理完成后执行

**章节来源**
- [src/tasks/mdCleanup/stateMachine.ts:52-109](file://src/tasks/mdCleanup/stateMachine.ts#L52-L109)
- [src/tasks/mdCleanup/stateMachine.ts:171-183](file://src/tasks/mdCleanup/stateMachine.ts#L171-L183)
- [src/tasks/mdCleanup/stateMachine.ts:208-262](file://src/tasks/mdCleanup/stateMachine.ts#L208-L262)

### 配置选项与可扩展点
- **中文标题映射表**
  - 可通过修改 constants.ts 中的 HEADING_MAP 扩展更多中文序号到 ATX 级别的映射
- **正则模式**
  - 可根据 pandoc 输出变化调整 constants.ts 中的匹配模式
- **属性清理规则**
  - 可通过修改 ATTR_CLEANUP_PATTERNS 扩展更多属性清理规则
- **警告回调**
  - 通过 warn 回调统一记录清理过程中的异常与风险提示
- **输出路径**
  - 任务自动写入 out/mdCleanup/ 目录，文件名与上一阶段一致

**章节来源**
- [src/tasks/mdCleanup/constants.ts:4-11](file://src/tasks/mdCleanup/constants.ts#L4-L11)
- [src/tasks/mdCleanup/constants.ts:36-40](file://src/tasks/mdCleanup/constants.ts#L36-L40)
- [src/tasks/mdCleanup/task.ts:44-48](file://src/tasks/mdCleanup/task.ts#L44-L48)

### 性能优化策略
- **正则表达式优化**
  - 使用锚定与非贪婪匹配，减少回溯
  - 对重复使用的模式进行常量化，避免重复构造
- **扫描策略**
  - 单次线性扫描，按行处理，内存占用低
  - 小缓冲区处理多行块，避免一次性加载整文件
- **批量处理**
  - 逐行替换内联图片，减少多次遍历
- **模块化优势**
  - 按需导入，减少不必要的模块加载
  - 提高代码复用性和可维护性
- **幂等性**
  - cleanMarkdown 为纯函数，重复应用不会改变结果，适合重试与调试

**章节来源**
- [src/tasks/mdCleanup/helpers.ts:34-43](file://src/tasks/mdCleanup/helpers.ts#L34-L43)
- [src/tasks/mdCleanup/stateMachine.ts:327-346](file://src/tasks/mdCleanup/stateMachine.ts#L327-L346)

### 日志记录与错误处理
- **日志系统集成**
  - 使用 ProcessLogger 单例管理日志输出
  - 支持 DEBUG/INFO/WARN/ERROR 四种日志级别
  - 自动创建带时间戳的日志文件
- **错误处理机制**
  - 文件读取失败时提供详细错误信息
  - 清理过程中发现的问题通过 warn 回调报告
  - 任务执行异常时记录完整错误堆栈
- **警告统计**
  - 统计清理过程中的警告数量
  - 在任务输出中标记警告信息

**章节来源**
- [src/tasks/mdCleanup/task.ts:25-35](file://src/tasks/mdCleanup/task.ts#L25-L35)
- [src/tasks/mdCleanup/task.ts:44-48](file://src/tasks/mdCleanup/task.ts#L44-L48)
- [src/logger.ts:78-96](file://src/logger.ts#L78-L96)

## 依赖关系分析
重构后的模块具有清晰的依赖关系：

```mermaid
graph LR
INDEX["index.ts"]
CONST["constants.ts"]
HELP["helpers.ts"]
STATE["stateMachine.ts"]
TASK["task.ts"]
TYPES["types.ts"]
INDEX --> STATE
INDEX --> TASK
INDEX --> CONST
STATE --> CONST
STATE --> HELP
STATE --> TYPES
TASK --> STATE
TASK --> TYPES
TASK --> CONST
HELP --> CONST
HELP --> TYPES
```

**图表来源**
- [src/tasks/mdCleanup/index.ts:8-15](file://src/tasks/mdCleanup/index.ts#L8-L15)
- [src/tasks/mdCleanup/stateMachine.ts:1-24](file://src/tasks/mdCleanup/stateMachine.ts#L1-L24)
- [src/tasks/mdCleanup/task.ts:1-7](file://src/tasks/mdCleanup/task.ts#L1-L7)

- **模块内聚**
  - 每个文件职责明确，功能单一
  - constants.ts 专注常量定义
  - helpers.ts 专注工具函数
  - stateMachine.ts 专注核心逻辑
  - task.ts 专注任务实现
- **外部依赖**
  - Listr2：任务编排与进度输出
  - Node fs/promises：文件读写
  - 日志系统：ProcessLogger 单例
- **上下文耦合**
  - 依赖 AppContext.lastContext 提供上一阶段输出路径
  - 依赖 OutputContext 结构传递文件名、输出路径、媒体路径

**章节来源**
- [src/tasks/mdCleanup/index.ts:8-15](file://src/tasks/mdCleanup/index.ts#L8-L15)
- [src/context.ts:4-21](file://src/context.ts#L4-L21)
- [src/main.ts:26-31](file://src/main.ts#L26-L31)
- [src/runner.ts:4-9](file://src/runner.ts#L4-L9)
- [src/logger.ts:78-96](file://src/logger.ts#L78-L96)

## 性能考虑
- **时间复杂度**
  - 单次线性扫描 O(n)，每行最多一次正则匹配与替换
  - 模块化设计减少不必要的函数调用
- **空间复杂度**
  - 输出数组累积，最坏 O(n)；状态机缓冲区较小，近似 O(1)
  - 按需导入模块，减少内存占用
- **I/O**
  - 仅在任务入口与出口进行文件读写，避免频繁小块 I/O
- **可靠性**
  - EOF 时对未闭合块进行兜底输出，避免数据丢失
  - 属性清理在所有处理完成后执行，确保完整性

**章节来源**
- [src/tasks/mdCleanup/stateMachine.ts:327-346](file://src/tasks/mdCleanup/stateMachine.ts#L327-L346)
- [src/tasks/mdCleanup/stateMachine.ts:301-322](file://src/tasks/mdCleanup/stateMachine.ts#L301-L322)

## 故障排查指南
- **无法读取源文件**
  - 现象：任务抛出错误并终止
  - 处理：检查上一阶段输出路径是否正确，确认文件存在且可读
- **未知标题样式**
  - 现象：输出中标题未带 ATX 前缀并伴随警告
  - 处理：检查 pandoc 输出的标题样式字符串是否符合预期
- **figure 块无图片**
  - 现象：警告"Figure 块不含 <img> 标签 — 块移除"
  - 处理：确认 figure 内是否包含有效图片标签
- **多行图片无 src**
  - 现象：警告"多行 <img> 无 src — 保持原样"
  - 处理：检查图片标签是否包含 src 属性
- **未闭合的多行图片**
  - 现象：警告"未闭合多行 <img> 无 src — 保持原样"
  - 处理：修复 HTML 标签闭合问题
- **文件写入失败**
  - 现象：清理完成后无法写入输出文件
  - 处理：检查输出目录权限，确认磁盘空间充足
- **模块导入错误**
  - 现象：运行时报模块找不到错误
  - 处理：检查 TypeScript 编译配置，确认模块路径正确

**章节来源**
- [src/tasks/mdCleanup/task.ts:25-35](file://src/tasks/mdCleanup/task.ts#L25-L35)
- [src/tasks/mdCleanup/stateMachine.ts:157-162](file://src/tasks/mdCleanup/stateMachine.ts#L157-L162)
- [src/tasks/mdCleanup/stateMachine.ts:251-258](file://src/tasks/mdCleanup/stateMachine.ts#L251-L258)

## 结论
重构后的 mdCleanup 模块通过模块化架构和清晰的状态机实现，在保持原有功能的基础上显著提升了代码的可维护性和可测试性。模块化的六个专门文件各司其职，constants.ts 提供稳定的配置，helpers.ts 提供实用的工具函数，stateMachine.ts 实现核心清理逻辑，task.ts 提供完整的任务封装，types.ts 确保类型安全。

新架构支持多行图片处理机制，支持跨行闭合的图片标签，实现了完整的属性清理功能，并提供了详细的日志记录和错误处理系统。其纯函数设计便于测试与维护，结合 warn 回调和完整的日志系统提供了良好的可观测性。

建议在后续版本中进一步扩展配置选项，支持更多自定义映射表和过滤规则，以适配更多 pandoc 输出风格。

## 附录
- **设计文档要点**
  - 规则覆盖：正文段落、标题、figure、table、内联图片、自定义样式
  - 正确性性质：内容顺序不变、幂等性、无包装器标签残留
  - 属性清理：删除所有标签的 id、class、style 属性
- **实施计划**
  - 扩展上下文类型、实现 cleanMarkdown、注册任务、集成测试
  - 模块化重构已完成，包含所有设计要求的功能
- **当前实现状态**
  - 模块已完全重构为模块化架构
  - 集成了完整的日志记录和错误处理系统
  - 通过了所有基本功能测试

**章节来源**
- [src/tasks/mdCleanup/index.ts:1-16](file://src/tasks/mdCleanup/index.ts#L1-L16)
- [src/tasks/mdCleanup/constants.ts:1-41](file://src/tasks/mdCleanup/constants.ts#L1-L41)
- [src/tasks/mdCleanup/helpers.ts:1-82](file://src/tasks/mdCleanup/helpers.ts#L1-L82)
- [src/tasks/mdCleanup/stateMachine.ts:1-347](file://src/tasks/mdCleanup/stateMachine.ts#L1-L347)
- [src/tasks/mdCleanup/task.ts:1-72](file://src/tasks/mdCleanup/task.ts#L1-L72)
- [src/tasks/mdCleanup/types.ts:1-50](file://src/tasks/mdCleanup/types.ts#L1-L50)