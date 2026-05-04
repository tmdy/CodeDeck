// 连接测试类型 — 翻译自 Go internal/domain/connectivity/

export interface ConnectivityResult {
  success: boolean;
  message: string;
  command_used: string;
}

export interface ConnectivityTestState {
  provider: string;
  profile_name: string;
  base_url: string;
  running: boolean;
  success: boolean;
  message: string;
  command_used: string;
  finished_at_display: string;
}

export function defaultTestState(): ConnectivityTestState {
  return {
    provider: "",
    profile_name: "",
    base_url: "",
    running: false,
    success: false,
    message: "",
    command_used: "",
    finished_at_display: "",
  };
}