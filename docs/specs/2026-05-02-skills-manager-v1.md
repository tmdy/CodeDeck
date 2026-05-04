# 技能管理桌面应用 V1 规格

## 摘要
构建一个仅面向本机使用的桌面应用，统一管理 `Codex` 与 `Claude` 的 skills。第一版采用“项目内中央托管仓 + 宿主启用目录”双区模型：未启用的 skill 存放在当前项目内，启用时真实移动到宿主目录，停用时再移回。应用必须先做扫描与迁移预览，不允许首次启动直接搬运现有目录。

技术方案默认定为 `Electron + React + TypeScript`。原因是第一版核心能力是本地目录扫描、批量移动、备份回滚、空间统计与桌面交互，Node 文件系统能力直接、开发成本低，避免为 v1 引入 Rust/Go 额外复杂度。

## 关键设计
### 1. 目录与数据模型
采用宿主隔离，不做跨宿主去重。相同 skill 名称在 `Codex` 与 `Claude` 中视为两条独立记录。

默认目录结构：
- 项目根目录下的 `library/codex/<skill-name>`：`Codex` 未启用 skill 托管区
- 项目根目录下的 `library/claude/<skill-name>`：`Claude` 未启用 skill 托管区
- 宿主运行目录固定为：
  - `%USERPROFILE%/.codex/skills`
  - `%USERPROFILE%/.claude/skills`
- 项目根目录下的 `app-data/manifest.json`：当前索引、状态、上次扫描结果
- 项目根目录下的 `app-data/operations/`：每次迁移/启停的操作日志与回滚清单
- 项目根目录下的 `app-data/backups/<timestamp>/`：执行前备份元数据与必要快照

每条 skill 记录至少包含这些字段：
- `host`: `codex | claude`
- `skillId`: `host + name` 组合键
- `directoryName`
- `displayName`
- `description`
- `summary`
- `tags`
- `hasSkillMd`
- `isSpecialDir`
- `status`: `active | inactive | unmanaged | conflict | readonly`
- `sourcePath`
- `expectedActivePath`
- `expectedLibraryPath`
- `sizeSkillMdBytes`
- `sizeBodyBytes`
- `sizeTotalBytes`
- `lastScannedAt`

### 2. skill 识别与展示规则
普通 skill：
- 目录下存在 `SKILL.md`
- 从 frontmatter 解析 `name`、`description`、`tags`
- “用处”展示分两层：
  - 主展示：`description`
  - 辅助展示：自动摘要增强版 `summary`
- `summary` 生成规则采用本地确定性逻辑，不接入远程 AI：
  - 优先基于 `description` 截断/规范化成一行摘要
  - 有 `tags` 时追加 1 到 3 个高价值标签
  - 无 `description` 时回退到目录名 + `SKILL.md` 首段标题或首句
  - 都缺失时显示“无可提取说明”

特殊目录：
- 像 `.system`、`_shared`、无 `SKILL.md` 的目录统一标记为 `readonly`
- 在界面展示，但不允许迁移、启用、停用
- 仍统计体积并计入宿主空间总览
- 这类目录的“用处”只做最低限度说明：
  - 优先读取目录中的说明文件
  - 否则显示“系统/共享目录，V1 不允许移动”

空间统计口径：
- `sizeSkillMdBytes`：仅 `SKILL.md`
- `sizeBodyBytes`：该 skill 目录内除 `SKILL.md` 外所有文件体积之和
- `sizeTotalBytes = sizeSkillMdBytes + sizeBodyBytes`
- 列表中显示三列：`说明体积`、`本体体积`、`总大小`

### 3. 首次迁移与日常操作
首次启动流程：
1. 扫描两个宿主目录。
2. 识别普通 skill 与特殊目录。
3. 生成迁移预览，不做任何真实移动。
4. 预览页按宿主展示：
   - 可迁移 skill 数量
   - 只读目录数量
   - 冲突数量
   - 预计迁入中央仓后的空间变化
5. 用户勾选要迁入中央仓的 skill。
6. 用户确认后才执行真实迁移。

迁移规则：
- 首次迁移是“从宿主目录移动到项目内 `library/<host>/...`”
- 迁移完成后，这些 skill 状态变为 `inactive`
- 不自动帮用户重新启用任何 skill
- 若目标库中已存在同名目录，状态标记为 `conflict`，阻止执行，要求用户处理

启用/停用规则：
- 启用：`library/<host>/<skill>` 移动到宿主目录
- 停用：宿主目录中的该 skill 移回 `library/<host>/<skill>`
- 批量操作允许，但同一批次必须先生成预览，再统一执行
- 若目标位置已有同名目录、路径缺失、权限异常、文件被占用，整条 skill 操作失败并记录原因，不做静默覆盖

回滚规则：
- 每次真实移动前生成一份操作清单，记录源路径、目标路径、时间戳、预期结果
- 执行失败时支持按该清单回滚本批次已成功项
- 提供“回滚上一次成功批次”入口
- V1 只要求支持“最近一次批次回滚”，不做多层历史图谱

## 界面与交互
主界面分四块：
- 顶部宿主概览：`Codex`、`Claude` 当前 active/inactive/readonly/conflict 数量与总占用
- 左侧筛选：宿主、状态、是否特殊目录、关键词搜索
- 中央表格：名称、宿主、状态、说明体积、本体体积、总大小、用途摘要、原路径
- 右侧详情：`description`、`tags`、完整路径、最近操作记录、异常信息

核心操作按钮：
- `重新扫描`
- `生成首次迁移预览`
- `迁入中央仓`
- `启用选中`
- `停用选中`
- `查看冲突`
- `回滚上一次批次`

交互限制：
- `readonly` 与 `conflict` 项不可加入执行批次
- 每次批量执行前必须弹出预览确认页
- 执行中禁止并发再发起另一批移动任务
- 不支持手工编辑 `SKILL.md`
- 不支持在 V1 中安装新 skill、下载 skill、跨宿主复制 skill

## 测试与验收
### 单元测试
- frontmatter 解析：
  - 正常 `SKILL.md`
  - 无 frontmatter
  - 只有 `description`
  - 含 `tags`
- 体积统计：
  - 只有 `SKILL.md`
  - `SKILL.md + scripts/assets`
  - 无 `SKILL.md` 特殊目录
- 分类逻辑：
  - 普通 skill
  - `readonly` 特殊目录
  - `conflict`
- 摘要生成：
  - 有 description
  - description 很长
  - 无 description 但有正文
  - 全缺失

### 集成测试
使用临时目录模拟：
- `%USERPROFILE%/.codex/skills`
- `%USERPROFILE%/.claude/skills`
- 项目内 `library`

验证场景：
- 首次扫描只生成预览，不改文件系统
- 选中若干 skill 迁入中央仓后，源目录消失、目标目录出现、状态变 `inactive`
- 从中央仓启用 skill 后，skill 出现在正确宿主目录、状态变 `active`
- 停用后移回中央仓
- 特殊目录只读展示，不可加入批次
- 目标重名时标记 `conflict`，不执行覆盖
- 中途失败时可回滚本批次已完成项
- 回滚上一次成功批次后，目录布局恢复到批次前状态

### 手工验收
- 应用首次启动能正确识别当前机器上约 `Codex 128`、`Claude 146` 个一级目录的真实规模，不崩溃
- 列表能清晰区分 `readonly` 项与普通 skill
- 对任意 skill，详情区能同时看到 `description`、自动摘要、`SKILL.md` 体积、本体体积
- 批量启停时有明确预览、进度、结果报告和失败原因
- 回滚后重新扫描，状态与目录布局一致

## 默认假设
- `cc` 在本需求中指 `Claude Code`，其宿主目录固定为 `%USERPROFILE%/.claude/skills`
- 第一版只支持 `Codex + Claude`，不接入 `.cursor/.gemini/.augment` 等其它宿主
- 第一版不做跨宿主去重，不比较目录内容哈希，不共享一份物理 skill 给两个宿主
- 第一版不通过链接或复制实现启用，启停都采用真实移动目录
- 第一版不自动修改宿主配置文件，只操作 skill 目录本身
- 第一版不依赖网络，不调用在线模型；“用途摘要增强”必须是本地确定性逻辑
- 建议将正式 spec 文档落到当前项目中的 `docs/specs/2026-05-02-skills-manager-v1.md`，后续再进入实现计划与代码阶段
