# 权限测试说明

权限功能测试集中在单元测试、组件测试和启动计划测试。

## 单元测试

- `src/shared/__tests__/profile/permissions.test.ts` 验证预设规范化、旧字段迁移、有效权限解析和 provider 映射。
- `src/shared/__tests__/services/profile-service.test.ts` 验证 Profile 保存和克隆时权限结构随加密 Profile 数据持久化。

## 启动计划测试

- `src/shared/__tests__/services/launch-service-permissions.test.ts` 验证 Claude 参数、Codex 配置、临时覆盖和未确认全权限拦截。

## 组件测试

- `src/shared/__tests__/components/global-settings-panel.test.tsx` 验证全局设置页展示 5 个预设、通用保护开关和全权限确认。
- `src/shared/__tests__/components/profile-edit-form.test.tsx` 验证 Profile 权限卡片支持继承全局和切换自定义。
- `src/shared/__tests__/components/profiles-launch-panel.test.tsx` 验证启动区域显示权限摘要和临时启动入口。

## 不测试范围

首版不测试真实 Claude/Codex CLI 调用，不验证 Claude settings 文件合并，也不测试专家规则编辑器。当前测试只关注软件生成的命令参数、Codex 配置内容和 UI 行为。
