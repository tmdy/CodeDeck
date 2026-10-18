# Windows 性能复测

在仓库根目录的 PowerShell 执行。依赖现有 `node_modules`、Node、PowerShell 7；不安装依赖、不打安装器、不调用模型、不使用强制 GC。不要与构建、测试或其他性能测量同时运行。

## 模块负载

```powershell
node --import tsx "./scripts/performance/core-benchmark.ts" --output "./release/performance-audit/before-core.json" --runs 3
node --import tsx "./scripts/performance/core-benchmark.ts" --output "./release/performance-audit/before-settled.json" --runs 3 --settled
```

每轮独立 Node 进程，默认 8,000 个输出块，检查原始流 SHA256、状态快照序列化量、200 次关闭后的保留量、退出历史、4,000 页缓存和临时 20,000 条 Codex 索引。`--settled` 在输出前标记回合完成，默认 2,000 块。`--chunks 2000` 可缩短活动负载；前后必须一致。活动解析仍较慢，默认三轮约需数分钟。

修改后将输出文件名改成 `after-core.json` / `after-settled.json`。JSON 中的 OS/堆采样包含正常 GC 波动，不能将保留字符数当作实测物理内存。

## 完整 Electron 与 ConPTY

```powershell
node "./scripts/performance/electron-benchmark.mjs" --label before --output "./release/performance-audit/before-electron.json" --sample-ms 4000 --churn 20 --idle-ms 60000
```

仅将 TS、Renderer 构建到 `release/performance-audit/before/`，使用独立临时 USERPROFILE、userData、workspace 和确定性 Node CLI。真实 Main、preload、xterm、ConPTY、标题/身份/lifecycle 均参与运行。所有模拟会话只写临时 Home，不读取真实 Profile。真实 Claude/Codex 的联网回合不在此脚本覆盖范围。

场景依次为：启动无会话、空闲、最小化、隐藏、单终端、四终端、持续输出、切换、自然退出保留历史、关闭历史、连续创建关闭、隐藏后恢复。脚本保留当前 64k 重连窗口，不修改 xterm scrollback 或监控频率。

修改后用 `--label after` 和新输出文件名测量。`--reuse-build` 使用已有构建，不会重新编译，适合保留修复前产物做配对对照；只有显式接受旧构建时使用。输出中的 `build.sourceHashes` 是构建时源码身份。不要覆盖仍需比较的 label。

```powershell
node "./scripts/performance/electron-benchmark.mjs" --label before --reuse-build --output "./release/performance-audit/before-electron-recheck.json" --sample-ms 4000 --churn 20 --idle-ms 60000
node --import tsx "./scripts/performance/core-benchmark.ts" --compiled-build before --chunks 2000 --runs 3 --output "./release/performance-audit/before-compiled-core.json"
```

Windows 进程树采样自动输出 `<output>.processes.json`，stderr 完整保存为 `<output>.stderr.log`，末尾显示 `AttachConsole failed` 次数。主 JSON 必须为 `partial:false`，且所有终端 `outputComplete:true` 才是完整场景证据。失败会留下 partial 结果；不要把它计为通过。

**观察口径**：Electron 的 Browser/Tab/GPU/Utility 是应用进程，ConPTY Worker 线程包含在 Main 中。外部 Node fixture / shell 与 conhost / ConPTY helper 分组输出。工作集相加可能重复计算共享页；CIM transfer 包括管道和网络，不能当作纯磁盘吞吐。CPU 100% 代表一个逻辑核心，可因 Main 内多个线程而超过 100%。计数器采样到 0 不代表绝对无 CPU 活动。

检查 `renderers[].visibilityState`。本次自动化环境中的窗口虽然 `isVisible:true`，Chromium 仍报告 `hidden`，因此不能据此宣称前台帧率、光标闪烁或 RAF 布局开销已验证。前台验收时从已登录桌面的 PowerShell 运行并检查该字段；不要为了获得好看的数据修改产品后台节流设置。

长时间观察可将 `--idle-ms` 改成 `3600000`（一小时），最大十二小时；脚本等待期间每秒让出执行，CIM 采样有自身开销。一次短时空闲恢复不能证明长期无泄漏。测试保留临时目录用于诊断，最终控制台显示其路径；仅可清理本次脚本创建的精确目录。

## 现有安装包与数据的只读测量

```powershell
pwsh -NoProfile -File "./scripts/performance/measure-process-tree.ps1" -RootProcessId 12345 -DurationSeconds 30 -OutputPath "./release/performance-audit/existing-processes.json"
node --import tsx "./scripts/performance/inspect-existing-data.ts" --output "./release/performance-audit/existing-data.json"
```

将示例 PID 替换为实际 Main PID。进程采样不输出命令参数或凭据；会校验 PID 创建时间，防止复用。数据脚本只读 canonical Codex Home 与日志，只保存统计，不复制聊天正文。旧安装包、已有日志与当前源码不是同一个基线；真实数据列表耗时只覆盖服务函数，不包含主进程 IPC、catalog 合并和 UI。

## 汇总与验收

```powershell
node "./scripts/performance/summarize-benchmarks.mjs" --directory "./release/performance-audit" --output "./release/performance-audit/summary.json"
```

汇总识别 `before/after-core.json`、`before/after-settled.json`、`paired-N-before/after.json` 和 `before/after-electron[-suffix].json` 等本轮命名，可用 `--include "文件1.json,文件2.json"` 仅保留指定对照。原始结果保留在 release 中；重要对照应另存入任务证据目录，避免构建目录清理后失去基线。

回归应检查：关闭后 manager/缓冲/订阅/监控数量回到 0，退出历史仍在，原始流校验一致，所有 xterm 收到结束标记，缓存淘汰和并发失效正确。还要单独检查 `MessagePort`、`PipeWrap`、辅助进程与私有提交，不能用 manager Map 归零替代原生资源验收。本次发现的 node-pty 管道残留及控制台诊断记录在审计报告中。
