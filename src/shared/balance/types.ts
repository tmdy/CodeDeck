export interface BalanceCheckItem {
  label: string;
  remaining: number | null;
  total: number | null;
  used: number | null;
  unit: string;
}

export interface BalanceCheckState {
  provider: string;
  profile_name: string;
  base_url: string;
  running: boolean;
  supported: boolean;
  success: boolean;
  message: string;
  items: BalanceCheckItem[];
  endpoint?: string;
  finished_at_display: string;
}

export function defaultBalanceCheckState(): BalanceCheckState {
  return {
    provider: "",
    profile_name: "",
    base_url: "",
    running: false,
    supported: false,
    success: false,
    message: "",
    items: [],
    endpoint: "",
    finished_at_display: "",
  };
}
