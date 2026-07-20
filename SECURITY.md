# 安全策略

## 支持范围

项目尚未发布稳定版本或正式 Release。安全修复目前以 `main` 分支为准，不承诺维护历史提交。

## 报告问题

优先使用 GitHub 的[私密安全报告](https://github.com/tmdy/CodeDeck/security/advisories/new)。如果该入口暂时不可用，可以先开一个不含漏洞细节的普通 Issue，请维护者提供私下沟通方式。

报告中可以包含受影响的提交、复现条件和影响范围。不要公开以下内容：

- 可用的 API Key、Token、Cookie 或加密口令；
- 未脱敏的 Profile、`app-data`、会话 JSONL 或日志；
- 能直接利用漏洞的完整攻击代码。

## 项目边界

CodeDeck 会启动本机 CLI、读写用户选择的目录，并访问 Profile 配置的外部站点。第三方 CLI、API 服务和中转站自身的漏洞应报告给对应维护者；如果 CodeDeck 的参数生成、凭据处理或文件权限放大了问题，也请同时报告给本项目。
