import { memo, useCallback, useMemo, useState } from "react";
import type {
  BrowserIdentitySlot,
  SiteBalanceAuthKind,
  SiteBalanceSession,
} from "../../shared/balance/site-balance-sessions.js";
import { allocateBrowserSlot } from "../../shared/balance/site-balance-sessions.js";
import { GlassCard } from "../common/GlassCard.jsx";
import {
  cloneSiteCustomCompatibility,
  type CustomBalanceRule,
  type CustomCheckinRule,
  type CustomValueSource,
  type SiteCustomCompatibility,
} from "../../shared/services/custom-compatibility.js";
import type { CustomElementSelectorResult } from "../../shared/electron/custom-element-selector-service.js";

type CustomCompatibilityDraft = SiteCustomCompatibility | { enabled: false };
type CustomElementField =
  | "balance_remaining"
  | "balance_total"
  | "balance_used"
  | "checkin_action"
  | "checkin_success"
  | "checkin_already";

export interface SiteBalanceSessionPanelProps {
  siteBalanceSessions: SiteBalanceSession[];
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    auth_kind?: SiteBalanceAuthKind;
    browser_session_id?: string;
    browser_slot?: number;
    browser_origin?: string;
    refresh_token?: string;
    token_expires_at?: number;
    user_id: string;
    custom_compatibility?: CustomCompatibilityDraft;
  };
  onBalanceSessionSelectionChange: (value: string) => void;
  onBalanceSessionDraftChange: (
    field: "label" | "access_token" | "auth_kind" | "refresh_token" | "user_id",
    value: string,
  ) => void;
  onCustomCompatibilityChange?: (value: CustomCompatibilityDraft | undefined) => void;
  onSelectCustomElement?: (
    field: CustomElementField,
    pageUrl: string,
  ) => Promise<CustomElementSelectorResult | null>;
  onSaveBalanceSession?: () => void;
  onBrowserLogin?: () => void;
  onBrowserLogout?: () => void;
  browserIdentitySlots?: BrowserIdentitySlot[];
  browserSlotSelection?: string;
  onBrowserSlotSelectionChange?: (value: string) => void;
  browserAuthStatus?: "unknown" | "checking" | "ready" | "login_required" | "authenticating";
  onDeleteSiteBalanceSession: () => void;
  disabled?: boolean;
}

export const SiteBalanceSessionPanel = memo(function SiteBalanceSessionPanel({
  siteBalanceSessions,
  balanceSessionSelection,
  balanceSessionDraft,
  onBalanceSessionSelectionChange,
  onBalanceSessionDraftChange,
  onCustomCompatibilityChange,
  onSelectCustomElement,
  onSaveBalanceSession,
  onBrowserLogin,
  onBrowserLogout,
  browserIdentitySlots = [],
  browserSlotSelection = "new",
  onBrowserSlotSelectionChange,
  browserAuthStatus,
  onDeleteSiteBalanceSession,
  disabled,
}: SiteBalanceSessionPanelProps) {
  const [selectorBusy, setSelectorBusy] = useState<CustomElementField | null>(null);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [selectorPreview, setSelectorPreview] = useState<{
    field: CustomElementField;
    result: CustomElementSelectorResult;
  } | null>(null);
  const editingExistingBalanceSession = useMemo(
    () => Boolean(
      balanceSessionSelection
      && balanceSessionSelection !== "auto"
      && balanceSessionSelection !== "new",
    ),
    [balanceSessionSelection],
  );
  const editingBalanceSession = editingExistingBalanceSession || balanceSessionSelection === "new";
  const authKind = balanceSessionDraft.auth_kind
    ?? (balanceSessionSelection === "new" ? "browser_session" : "access_token");
  const browserStatusLabel = editingExistingBalanceSession
    ? browserAuthStatus === "login_required"
      ? "需重新登录"
      : browserAuthStatus === "checking"
        ? "检查中"
        : browserAuthStatus === "authenticating"
          ? "登录中"
          : browserAuthStatus === "ready"
            ? "已登录"
            : "未检查"
    : "待登录";
  const customCompatibility = balanceSessionDraft.custom_compatibility;
  const customEnabled = customCompatibility?.enabled === true;

  const changeCustom = useCallback((mutator: (current: SiteCustomCompatibility) => SiteCustomCompatibility) => {
    if (!onCustomCompatibilityChange) return;
    const current = customCompatibility?.enabled === true
      ? cloneSiteCustomCompatibility(customCompatibility)
      : createDefaultCustomCompatibility();
    if (!current) return;
    onCustomCompatibilityChange(mutator(current));
  }, [customCompatibility, onCustomCompatibilityChange]);

  const toggleCustomCompatibility = useCallback((enabled: boolean) => {
    if (!onCustomCompatibilityChange) return;
    if (!enabled) {
      onCustomCompatibilityChange({ enabled: false });
      return;
    }
    onCustomCompatibilityChange(
      customCompatibility?.enabled === true
        ? customCompatibility
        : createDefaultCustomCompatibility(),
    );
  }, [customCompatibility, onCustomCompatibilityChange]);

  const selectElement = useCallback(async (field: CustomElementField, pageUrl: string) => {
    if (!onSelectCustomElement || !pageUrl.trim()) {
      setSelectorError("请先填写页面 URL");
      return;
    }
    setSelectorError(null);
    setSelectorBusy(field);
    try {
      const result = await onSelectCustomElement(field, pageUrl.trim());
      if (result) setSelectorPreview({ field, result });
    } catch (error) {
      setSelectorError(error instanceof Error ? error.message : "元素选择失败");
    } finally {
      setSelectorBusy(null);
    }
  }, [onSelectCustomElement]);

  return (
    <>
      <GlassCard title="站点后台会话" className="site-balance-session-card">
        <div className="site-balance-session-panel">
          <label>
            后台会话
            <select
              value={balanceSessionSelection}
              onChange={(e) => onBalanceSessionSelectionChange(e.target.value)}
              disabled={disabled}
            >
              <option value="auto">API Key 自动</option>
              {siteBalanceSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
              <option value="new">新建会话</option>
            </select>
          </label>
          {editingBalanceSession && (
            <>
              {authKind !== "access_token" && (
                <div className="browser-session-login-card">
                  {balanceSessionSelection === "new" && (
                    <label className="browser-session-identity">
                      浏览器身份
                      <select
                        value={browserSlotSelection}
                        onChange={(event) => onBrowserSlotSelectionChange?.(event.target.value)}
                        disabled={disabled || !onBrowserSlotSelectionChange}
                      >
                        <option value="new">
                          新身份（账号{allocateBrowserSlot(browserIdentitySlots)}）
                        </option>
                        {browserIdentitySlots.map((slot) => (
                          <option key={slot.slot} value={`slot:${slot.slot}`}>
                            复用账号{slot.slot}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span className={`browser-auth-status status-${browserAuthStatus ?? "unknown"}`}>
                    {authKind === "session_cookie" ? "旧版账号需登录" : browserStatusLabel}
                  </span>
                  <button
                    type="button"
                    className="primary-button small"
                    onClick={onBrowserLogin}
                    disabled={disabled || !onBrowserLogin}
                  >
                    {editingExistingBalanceSession ? "重新登录" : "浏览器登录"}
                  </button>
                </div>
              )}
              <details className="site-balance-session-advanced" open={authKind === "access_token"}>
                <summary>高级兼容：PAT / Access Token</summary>
                <div className="site-balance-session-fields">
                  {authKind !== "access_token" && (
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => onBalanceSessionDraftChange("auth_kind", "access_token")}
                      disabled={disabled}
                    >
                      改用 PAT 兼容模式
                    </button>
                  )}
                  <label>
                    Access Token / PAT
                    <input
                      type="password"
                      value={balanceSessionDraft.access_token}
                      onChange={(e) => onBalanceSessionDraftChange("access_token", e.target.value)}
                      placeholder="输入后台 Access Token 或 PAT"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                  <label>
                    Refresh Token（Sub2API 可选）
                    <input
                      type="password"
                      value={balanceSessionDraft.refresh_token ?? ""}
                      onChange={(e) => onBalanceSessionDraftChange("refresh_token", e.target.value)}
                      placeholder="输入 Sub2API Refresh Token"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                  <label>
                    User ID（兼容旧站点，可留空）
                    <input
                      value={balanceSessionDraft.user_id}
                      onChange={(e) => onBalanceSessionDraftChange("user_id", e.target.value)}
                      placeholder="输入后台 User ID"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => onSaveBalanceSession?.()}
                  disabled={disabled || !onSaveBalanceSession || authKind !== "access_token"}
                >
                  保存 PAT 账号
                </button>
              </details>
              <details className="site-balance-session-advanced">
                <summary>自定义兼容规则（非标准站点）</summary>
                <div className="site-balance-session-fields custom-compatibility-fields">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={customEnabled}
                      onChange={(event) => toggleCustomCompatibility(event.target.checked)}
                      disabled={disabled || !onCustomCompatibilityChange}
                    />
                    启用自定义余额 / 签到规则
                  </label>
                  {customEnabled && customCompatibility && (
                    <>
                      <label>
                        管理 / 身份 origin（可选）
                        <input
                          value={customCompatibility.identity_origin ?? ""}
                          onChange={(event) => changeCustom((current) => ({
                            ...current,
                            ...(event.target.value.trim()
                              ? { identity_origin: event.target.value }
                              : { identity_origin: undefined }),
                          }))}
                          placeholder="https://登录或管理站点.example"
                          disabled={disabled}
                        />
                      </label>
                      <label>
                        浏览器登录 URL（用户确认身份模式必填）
                        <input
                          value={customCompatibility.login_url ?? ""}
                          onChange={(event) => changeCustom((current) => ({
                            ...current,
                            ...(event.target.value.trim()
                              ? { login_url: event.target.value }
                              : { login_url: undefined }),
                          }))}
                          placeholder="https://example.com/login"
                          disabled={disabled}
                        />
                      </label>
                      <label>
                        身份来源
                        <select
                          value={customCompatibility.identity_mode}
                          onChange={(event) => changeCustom((current) => ({
                            ...current,
                            identity_mode: event.target.value === "user_confirmed" ? "user_confirmed" : "standard",
                          }))}
                          disabled={disabled}
                        >
                          <option value="standard">标准后台身份验证</option>
                          <option value="user_confirmed">我已在浏览器确认当前身份</option>
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(customCompatibility.balance)}
                          onChange={(event) => changeCustom((current) => ({
                            ...current,
                            ...(event.target.checked
                              ? { balance: current.balance ?? createDefaultBalanceRule() }
                              : { balance: undefined }),
                          }))}
                          disabled={disabled}
                        />
                        启用余额规则
                      </label>
                      {customCompatibility.balance && (
                        <CustomBalanceRuleEditor
                          rule={customCompatibility.balance}
                          disabled={disabled}
                          onChange={(rule) => changeCustom((current) => ({
                            ...current,
                            ...(rule ? { balance: rule } : { balance: undefined }),
                          }))}
                          onSelectElement={selectElement}
                          selectorBusy={selectorBusy}
                        />
                      )}
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(customCompatibility.checkin)}
                          onChange={(event) => changeCustom((current) => ({
                            ...current,
                            ...(event.target.checked
                              ? { checkin: current.checkin ?? createDefaultCheckinRule() }
                              : { checkin: undefined }),
                          }))}
                          disabled={disabled}
                        />
                        启用签到规则
                      </label>
                      {customCompatibility.checkin && (
                        <CustomCheckinRuleEditor
                          rule={customCompatibility.checkin}
                          disabled={disabled}
                          onChange={(rule) => changeCustom((current) => ({
                            ...current,
                            ...(rule ? { checkin: rule } : { checkin: undefined }),
                          }))}
                          onSelectElement={selectElement}
                          selectorBusy={selectorBusy}
                        />
                      )}
                      <label className="custom-compatibility-warning">
                        <span>跨 origin 凭据转发只在你明确确认后生效；不要在请求体中填写 Token。</span>
                      </label>
                      {selectorPreview && (
                        <div className="custom-compatibility-preview">
                          已选择 {selectorPreview.result.selector}
                          {selectorPreview.result.previewText
                            ? ` · ${selectorPreview.result.previewText}`
                            : ""}
                        </div>
                      )}
                      {selectorError && <div className="form-error">{selectorError}</div>}
                    </>
                  )}
                </div>
              </details>
              <div className="inline-actions balance-session-actions">
                {editingExistingBalanceSession && authKind === "browser_session" && (
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={onBrowserLogout}
                    disabled={disabled || !onBrowserLogout}
                  >
                    退出登录
                  </button>
                )}
                {editingExistingBalanceSession && (
                  <button
                    type="button"
                    className="secondary-button small danger"
                    onClick={onDeleteSiteBalanceSession}
                    disabled={disabled}
                  >
                    删除当前会话
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </GlassCard>
    </>
  );
});

function createDefaultCustomCompatibility(): SiteCustomCompatibility {
  return {
    enabled: true,
    identity_mode: "standard",
  };
}

function createDefaultBalanceRule(): CustomBalanceRule {
  return {
    mode: "api",
    target_url: "",
    method: "GET",
    remaining: { kind: "json_path", path_or_selector: "" },
    credential_forwarding: "none",
  };
}

function createDefaultCheckinRule(): CustomCheckinRule {
  return {
    mode: "api",
    target_url: "",
    method: "POST",
    success: { kind: "json_path", path_or_selector: "" },
    credential_forwarding: "none",
  };
}

function CustomBalanceRuleEditor({
  rule,
  disabled,
  onChange,
  onSelectElement,
  selectorBusy,
}: {
  rule?: CustomBalanceRule;
  disabled?: boolean;
  onChange: (rule: CustomBalanceRule | undefined) => void;
  onSelectElement: (field: CustomElementField, pageUrl: string) => Promise<void>;
  selectorBusy: CustomElementField | null;
}) {
  const update = (patch: Partial<CustomBalanceRule>) => {
    onChange({
      ...(rule ?? createDefaultBalanceRule()),
      ...patch,
    });
  };
  const updateSource = (field: "remaining" | "total" | "used", patch: Partial<CustomValueSource>) => {
    const current = rule?.[field];
    update({
      [field]: {
        ...(current ?? { kind: rule?.mode === "page" ? "css_selector" : "json_path", path_or_selector: "" }),
        ...patch,
      },
    } as Partial<CustomBalanceRule>);
  };
  return (
    <fieldset className="custom-compatibility-rule">
      <legend>余额规则</legend>
      <label>
        读取方式
        <select value={rule?.mode ?? "api"} onChange={(event) => {
          const mode = event.target.value === "page" ? "page" : "api";
          update({
            mode,
            method: mode === "page" ? "GET" : (rule?.method ?? "GET"),
            ...(mode === "page"
              ? { remaining: toPageSource(rule?.remaining), total: toPageSource(rule?.total), used: toPageSource(rule?.used) }
              : { remaining: toJsonSource(rule?.remaining), total: toJsonSource(rule?.total), used: toJsonSource(rule?.used) }),
          });
        }} disabled={disabled}>
          <option value="api">API / JSON</option>
          <option value="page">网页元素</option>
        </select>
      </label>
      <label>余额目标 URL<input value={rule?.target_url ?? ""} onChange={(event) => update({ target_url: event.target.value })} disabled={disabled} /></label>
      {rule?.mode === "page" && <label>余额页面 URL<input value={rule.page_url ?? ""} onChange={(event) => update({ page_url: event.target.value })} disabled={disabled} /></label>}
      {rule?.mode === "api" && <label>请求方法<select value={rule.method ?? "GET"} onChange={(event) => update({ method: event.target.value as "GET" | "POST", request_body: event.target.value === "GET" ? undefined : rule.request_body })} disabled={disabled}><option value="GET">GET</option><option value="POST">POST</option></select></label>}
      {rule?.mode === "api" && rule.method === "POST" && <label>请求体（模板，不要填写 Token）<textarea value={rule.request_body ?? ""} onChange={(event) => update({ request_body: event.target.value })} disabled={disabled} /></label>}
      {(["remaining", "total", "used"] as const).map((field) => (
        <div className="custom-source-row" key={field}>
          <label>{field === "remaining" ? "剩余" : field === "total" ? "总额" : "已用"}字段
            <input value={rule?.[field]?.path_or_selector ?? ""} onChange={(event) => updateSource(field, { path_or_selector: event.target.value })} disabled={disabled} />
          </label>
          {rule?.mode === "page" && <label>属性（可选）<input value={rule[field]?.attribute ?? ""} onChange={(event) => updateSource(field, { attribute: event.target.value || undefined })} disabled={disabled} /></label>}
          <label>正则（可选）<input value={rule?.[field]?.regex ?? ""} onChange={(event) => updateSource(field, { regex: event.target.value || undefined })} disabled={disabled} /></label>
          {rule?.mode === "page" && <button type="button" className="secondary-button small" onClick={() => void onSelectElement(`balance_${field}`, rule.page_url ?? rule.target_url)} disabled={disabled || selectorBusy !== null}>{selectorBusy === `balance_${field}` ? "选择中…" : "打开元素选择器"}</button>}
        </div>
      ))}
      <label>单位<input value={rule?.unit ?? ""} onChange={(event) => update({ unit: event.target.value || undefined })} disabled={disabled} placeholder="USD / tokens" /></label>
      <CredentialForwardingEditor rule={rule} disabled={disabled} onChange={update} />
    </fieldset>
  );
}

function CustomCheckinRuleEditor({
  rule,
  disabled,
  onChange,
  onSelectElement,
  selectorBusy,
}: {
  rule?: CustomCheckinRule;
  disabled?: boolean;
  onChange: (rule: CustomCheckinRule | undefined) => void;
  onSelectElement: (field: CustomElementField, pageUrl: string) => Promise<void>;
  selectorBusy: CustomElementField | null;
}) {
  const update = (patch: Partial<CustomCheckinRule>) => onChange({
    ...(rule ?? createDefaultCheckinRule()),
    ...patch,
  });
  const updateSource = (field: "success" | "already_checked", patch: Partial<CustomValueSource>) => update({
    [field]: { ...(rule?.[field] ?? { kind: rule?.mode === "page" ? "css_selector" : "json_path", path_or_selector: "" }), ...patch },
  } as Partial<CustomCheckinRule>);
  return (
    <fieldset className="custom-compatibility-rule">
      <legend>签到规则</legend>
      <label>执行方式<select value={rule?.mode ?? "api"} onChange={(event) => { const mode = event.target.value === "page" ? "page" : "api"; update({ mode, method: mode === "page" ? "GET" : "POST", success: mode === "page" ? toPageSource(rule?.success) : toJsonSource(rule?.success), already_checked: mode === "page" ? toPageSource(rule?.already_checked) : toJsonSource(rule?.already_checked) }); }} disabled={disabled}><option value="api">API / JSON</option><option value="page">网页点击</option></select></label>
      <label>签到目标 URL<input value={rule?.target_url ?? ""} onChange={(event) => update({ target_url: event.target.value })} disabled={disabled} /></label>
      <label>签到页面 URL（可独立于目标）<input value={rule?.page_url ?? ""} onChange={(event) => update({ page_url: event.target.value })} disabled={disabled} /></label>
      {rule?.mode === "api" && <label>请求方法<select value={rule.method ?? "POST"} onChange={(event) => update({ method: event.target.value as "GET" | "POST", request_body: event.target.value === "GET" ? undefined : rule.request_body })} disabled={disabled}><option value="POST">POST</option><option value="GET">GET</option></select></label>}
      {rule?.mode === "api" && rule.method === "POST" && <label>请求体（模板，不要填写 Token）<textarea value={rule.request_body ?? ""} onChange={(event) => update({ request_body: event.target.value })} disabled={disabled} /></label>}
      {rule?.mode === "page" && <label>签到按钮 CSS selector<input value={rule.action_selector ?? ""} onChange={(event) => update({ action_selector: event.target.value })} disabled={disabled} /><button type="button" className="secondary-button small" onClick={() => void onSelectElement("checkin_action", rule.page_url ?? rule.target_url)} disabled={disabled || selectorBusy !== null}>{selectorBusy === "checkin_action" ? "选择中…" : "打开元素选择器"}</button></label>}
      {(["success", "already_checked"] as const).map((field) => (
        <label key={field}>{field === "success" ? "成功判定" : "已签到判定"}（CSS selector / JSON path）
          <input value={rule?.[field]?.path_or_selector ?? ""} onChange={(event) => updateSource(field, { path_or_selector: event.target.value })} disabled={disabled} />
          {rule?.mode === "page" && <button type="button" className="secondary-button small" onClick={() => void onSelectElement(field === "success" ? "checkin_success" : "checkin_already", rule.page_url ?? rule.target_url)} disabled={disabled || selectorBusy !== null}>{selectorBusy === (field === "success" ? "checkin_success" : "checkin_already") ? "选择中…" : "打开元素选择器"}</button>}
        </label>
      ))}
      <CredentialForwardingEditor rule={rule} disabled={disabled} onChange={update} />
    </fieldset>
  );
}

function CredentialForwardingEditor({
  rule,
  disabled,
  onChange,
}: {
  rule?: CustomBalanceRule | CustomCheckinRule;
  disabled?: boolean;
  onChange: (patch: Partial<CustomBalanceRule> | Partial<CustomCheckinRule>) => void;
}) {
  const explicit = rule?.credential_forwarding === "explicit_origin";
  return <>
    <label className="checkbox-label"><input type="checkbox" checked={explicit} onChange={(event) => onChange(event.target.checked ? { credential_forwarding: "explicit_origin", confirmed_at: new Date().toISOString() } : { credential_forwarding: "none", credential_source_origin: undefined, credential_target_origin: undefined, confirmed_at: undefined })} disabled={disabled} />明确确认向目标 origin 转发当前凭据</label>
    {explicit && <>
      <label>凭据来源 origin<input value={rule?.credential_source_origin ?? ""} onChange={(event) => onChange({ credential_source_origin: event.target.value })} disabled={disabled} /></label>
      <label>凭据目标 origin<input value={rule?.credential_target_origin ?? ""} onChange={(event) => onChange({ credential_target_origin: event.target.value })} disabled={disabled} /></label>
    </>}
  </>;
}

function toPageSource(source?: CustomValueSource): CustomValueSource | undefined {
  return source ? { ...source, kind: "css_selector" } : undefined;
}

function toJsonSource(source?: CustomValueSource): CustomValueSource | undefined {
  return source ? { ...source, kind: "json_path" } : undefined;
}
