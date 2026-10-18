const ANYROUTER_ORIGIN = "https://anyrouter.top";

export const ANYROUTER_CHECKIN_ENDPOINT = `${ANYROUTER_ORIGIN}/api/user/sign_in`;
export const ANYROUTER_CHECKIN_PAGE_URL = `${ANYROUTER_ORIGIN}/console/topup`;

export function isAnyRouterBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.origin === ANYROUTER_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}
