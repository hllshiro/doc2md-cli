# Requirements Document

## Introduction

本工具是一个基于 listr2 的交互式 CLI 任务流水线，用于将 Word 文档（.docx）转换为 Markdown 格式。工具通过有序的任务列表引导用户完成文档路径输入、环境检查、格式转换等步骤，架构设计支持后续扩展更多转换任务。

## Glossary

- **CLI_Tool**: 本 CLI 应用程序的主入口，负责编排和执行所有任务
- **Task_Runner**: 基于 listr2 的任务执行器，负责按序运行各个任务并展示进度
- **Task**: 任务流水线中的单个可执行单元，包含标题、执行逻辑和可选的子任务
- **Docx_Input_Task**: 负责收集用户输入的 .docx 文档路径的任务
- **Pandoc_Check_Task**: 负责检测系统 pandoc 可用性并执行文档转换的任务
- **Context**: 在任务之间共享数据的上下文对象，贯穿整个任务流水线
- **Pandoc**: 用于文档格式转换的命令行工具
- **Office_Math**: Word 文档中的原生数学公式格式（OMML）

## Requirements

### Requirement 1: 文档路径输入

**User Story:** 作为用户，我想要输入待转换的 .docx 文档路径，以便工具能够定位并处理目标文件。

#### Acceptance Criteria

1. WHEN Docx_Input_Task 启动时，THE CLI_Tool SHALL 通过交互式提示要求用户输入 .docx 文档的文件路径
2. WHEN 用户输入文件路径后，THE CLI_Tool SHALL 展示确认提示，提醒用户确保文档中所有公式已转换为 Office_Math 格式
3. WHEN 用户确认公式格式后，THE CLI_Tool SHALL 将文件路径保存至 Context 供后续任务使用
4. IF 用户拒绝确认公式格式，THEN THE CLI_Tool SHALL 终止当前任务流水线并输出提示信息，告知用户需先完成公式转换
5. IF 用户输入的路径为空字符串，THEN THE CLI_Tool SHALL 重新提示用户输入有效路径

### Requirement 2: Pandoc 环境检测

**User Story:** 作为用户，我想要工具自动检测系统中的 pandoc 可用性，以便在不同环境下都能正确调用转换工具。

#### Acceptance Criteria

1. WHEN Pandoc_Check_Task 启动时，THE CLI_Tool SHALL 尝试在系统 PATH 中查找并调用 pandoc 命令以验证其可用性
2. WHEN 系统 PATH 中存在可用的 pandoc 命令时，THE CLI_Tool SHALL 将 pandoc 可执行路径记录为系统默认路径并保存至 Context
3. IF 系统 PATH 中不存在可用的 pandoc 命令，THEN THE CLI_Tool SHALL 通过交互式提示要求用户输入 pandoc.exe 的完整路径，默认值为 `./pandoc.exe`
4. WHEN 用户提供自定义 pandoc 路径后，THE CLI_Tool SHALL 将该路径保存至 Context 供转换任务使用

### Requirement 3: Docx 转 Markdown 转换

**User Story:** 作为用户，我想要工具调用 pandoc 将 .docx 文件转换为 Markdown 格式，以便后续处理文档内容。

#### Acceptance Criteria

1. WHEN 转换任务启动时，THE CLI_Tool SHALL 使用 Context 中保存的 pandoc 路径和文档路径调用 pandoc 执行转换
2. WHEN pandoc 转换成功时，THE CLI_Tool SHALL 在任务列表中标记该任务为完成状态
3. IF pandoc 转换过程中发生错误，THEN THE CLI_Tool SHALL 捕获错误输出并在任务列表中标记该任务为失败状态，同时展示错误信息
4. THE CLI_Tool SHALL 支持通过 Context 传入自定义 pandoc 调用参数，以便用户灵活控制转换行为

### Requirement 4: 可扩展任务架构

**User Story:** 作为开发者，我想要任务架构易于扩展，以便未来能够方便地添加新的处理任务。

#### Acceptance Criteria

1. THE Task_Runner SHALL 以模块化方式组织各任务，每个任务定义在独立文件中
2. THE CLI_Tool SHALL 通过统一的任务注册接口将新任务添加到流水线，无需修改核心执行逻辑
3. THE Context SHALL 作为所有任务共享的数据载体，支持任意任务向其中读写数据
4. WHILE 任务流水线执行时，THE Task_Runner SHALL 按照注册顺序依次执行各任务，前序任务的输出可作为后续任务的输入

### Requirement 5: 编译为单一可执行文件

**User Story:** 作为用户，我想要将工具编译为单个可执行文件，以便在无 Node.js 环境的机器上直接运行。

#### Acceptance Criteria

1. THE CLI_Tool SHALL 支持通过构建命令编译为单一可执行文件（exe）
2. THE CLI_Tool SHALL 在运行时优先在可执行文件所在目录查找 `pandoc.exe`，以支持将 pandoc 与 exe 放置在同一目录下使用
3. THE CLI_Tool SHALL 提供 `build` 脚本，开发者执行一条命令即可完成编译

### Requirement 6: 代码质量与格式规范

**User Story:** 作为开发者，我想要项目配置好 TypeScript、ESLint 和 Prettier，以便保持代码质量和风格一致性。

#### Acceptance Criteria

1. THE CLI_Tool SHALL 使用 TypeScript 编写，并配置严格类型检查
2. THE CLI_Tool SHALL 配置 ESLint 规则，支持通过 `lint` 脚本执行代码检查
3. THE CLI_Tool SHALL 配置 Prettier 规则，支持通过 `format` 脚本执行代码格式化
4. WHEN 代码存在 ESLint 错误时，THE CLI_Tool SHALL 在 lint 检查时输出具体的错误位置和描述
