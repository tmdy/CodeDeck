import { describe, expect, it } from "vitest";
import {
  buildManagementAuthorizationCandidates,
  buildManagementCookieCandidates,
} from "../../services/management-auth.js";

describe("management auth candidates", () => {
  it("builds raw and Bearer authorization variants", () => {
    expect(buildManagementAuthorizationCandidates("access-token")).toEqual([
      { mode: "raw", headerValue: "access-token" },
      { mode: "bearer", headerValue: "Bearer access-token" },
    ]);
  });

  it("preserves a Bearer input and never double-prefixes it", () => {
    expect(buildManagementAuthorizationCandidates("Bearer access-token")).toEqual([
      { mode: "bearer", headerValue: "Bearer access-token" },
      { mode: "raw", headerValue: "access-token" },
    ]);
  });

  it("builds all Metapi-compatible variants for named cookies", () => {
    expect(buildManagementCookieCandidates("token=cookie-value")).toEqual([
      { mode: "raw", headerValue: "token=cookie-value" },
      { mode: "session_wrapped", headerValue: "session=token=cookie-value" },
      { mode: "token_wrapped", headerValue: "token=token=cookie-value" },
    ]);
  });

  it("keeps Base64 padding while building raw and wrapped cookie variants", () => {
    expect(buildManagementCookieCandidates("encoded-value==")).toEqual([
      { mode: "raw", headerValue: "encoded-value==" },
      { mode: "session_wrapped", headerValue: "session=encoded-value==" },
      { mode: "token_wrapped", headerValue: "token=encoded-value==" },
    ]);
  });

  it("uses wrapped cookie variants for opaque values", () => {
    expect(buildManagementCookieCandidates("opaque-cookie-value")).toEqual([
      { mode: "session_wrapped", headerValue: "session=opaque-cookie-value" },
      { mode: "token_wrapped", headerValue: "token=opaque-cookie-value" },
    ]);
  });
});
