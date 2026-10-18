# 实施与验证顺序

状态：in_progress。用户已在最终方案摘要之后明确同意实施，并确认目标为“高峰失败时自动输入继续”设置。

## 顺序

1. [x] 刷新目标文件 git diff 与工作区状态，记录已有修改范围；读取 curated implement/check context 与现有会话 / Bridge 契约。
2. [ ] 复用已完成的当前 CLI / 临时 Home startup OSC 实验证据，补齐 hint 等待文件落盘、metadata 核实和 lifecycle 关联测试，核实当前 CLI 最终失败 JSONL 格式及完整应用退出清理；如有与研究不同的重大限制，回到方案更新再审阅。不得对真实历史写入。
3. [x] 在 Codex builder / launch-service 统一注入受监控进程 title 参数，新增流式 OSC 解析和 UUID 唯一解析测试；main 将 provider 身份、lifecycle file 和 display title 分开关联，重试暂缺文件。
4. [x] 修复索引同 UUID 最新有效名称归并、避免 recent JSONL 覆盖索引名；绑定后持续同步 rename，终端退出 / 会话切换释放观察器。
5. [x] 为 manager 当前回合与权威完成建立边界；清历史活动证据，处理 late / duplicate 生命周期，保留必要稳定提示符 fallback。
6. [x] 将 Codex 自动继续绑定到当前最终可重试失败，完成 / 新输入取消待发送动作，并在 timer / renderer flush 前复验代次。保留次数预算设置；按需明确界面标签与简洁诊断。
7. [x] 增加下列具体回归，执行相关检查；只修本任务相关失败。
8. [x] 更新直接相关会话 / Bridge 契约，补充 task research 的实测结果与限制。检查最终差异无越界。没有用户提交 / 发布授权时不提交或发布。

实施与独立检查已完成，验证见 `research/implementation-evidence.md`、`research/check.md` 与 `research/integration-runtime.md`。第 2 项已完成当前 CLI 最终失败落盘和编译模块 ConPTY 集成验证；完整应用退出诊断及当前打包版 UI/任务栏现场验证尚未覆盖，因此保留该项未勾选。未执行提交、任务归档或更新正在运行的打包版。

## 必须覆盖的回归

- completed / failed 后旧 Working 重绘不 busy；新有效提交与 started 仍 busy。
- idle fallback 先到、权威 completed 后到：一次有效权威回调，无重复 Bridge 回传。
- 迟到旧 completed 不结束新输入对应回合；已关闭 / 已替换 watcher 不派发事件。
- OSC 0 / 2、BEL / ST、跨 chunk、标题生成 spinner、无效 UUID、完整 / 截断 UUID；0 / 多候选不绑定，metadata ID 与文件名不同、同 UUID 副本去重。
- 同 UUID 同时存在实际新增生命周期的活跃源和静态旧副本，选择已核实写入源；多个源均增长且无法归属时保持待关联、诊断，不选择首个 / 最新文件派发。
- 新 UUID 已有但标题未生成时可监控 completion；缺文件后出现可重试关联。
- 绑定后索引追加标题 / rename 更新，坏行 / 半行保留旧名；同目录并发终端标题与状态不串线；索引正式名优先于 JSONL 摘要。
- 普通回答引用默认错误词、用户回显、拆块 Reconnecting、不带真实失败的历史错误均不发送。
- 真正 retryable failed 按开关 / 关键词 / 次数 / 间隔发一次；非 retryable failed / interrupted 不发。
- timer 等待中成功、无 renderer 后成功再 attach、新回合开始和旧 timer 迟到均不写 PTY；预算累计上限继续有效。
- Claude、stable idle fallback、交互确认及 Agent Bridge 父子关联语义回归。

## 验证命令

根据实际改动选用下列已有测试；新的 identity helper 测试加入同一批。

```powershell
npm test -- src/shared/__tests__/electron/terminal-activity.test.ts src/shared/__tests__/electron/terminal-session-manager.test.ts src/shared/__tests__/electron/terminal-turn-lifecycle.test.ts src/shared/__tests__/electron/terminal-auto-continue.test.ts src/shared/__tests__/electron/terminal-taskbar.test.ts
npm test -- src/shared/__tests__/services/session-service.test.ts src/shared/__tests__/provider/codex/command-builder.test.ts src/shared/__tests__/services/launch-service.test.ts
npm test -- src/shared/__tests__/agent-bridge/task-manager.test.ts
npm run typecheck
git diff --check
```

不得把纯源码检查称为正在运行的安装包已修复。现场验证用可控新终端确认完整一次提交 / 完成 / 标题更新 / 重试；不得向用户正在进行的任务注入探测输入。必要时构建独立测试产物，不通过默认完整打包流程反复生成安装器。

## 风险文件与恢复

已有 dirty：`electron/main.ts`、`src/shared/electron/terminal-activity.ts`、`terminal-session-manager.ts`、`terminal-turn-lifecycle.ts`、对应 manager / parser 测试，以及其他无关 Profile / 签到工作。实施代理只拥有明确派发的文件范围，验证代理不能回退现有修改。更改用户真实数据或全局配置不属于本方案恢复手段。

方案重大改变、当前 CLI 无可用信号且需要新增侵入性配置方案时，停止相关实施并回到 planning；不能偷偷改为按目录猜会话。
