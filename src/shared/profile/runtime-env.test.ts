import { describe, expect, it } from "vitest";
import { parseRuntimeEnvText } from "./runtime-env.js";

describe("parseRuntimeEnvText", () => {
  it("parses KEY=VALUE lines and keeps equals signs in values", () => {
    expect(parseRuntimeEnvText([
      "HTTP_PROXY=http://127.0.0.1:10808",
      "TOKEN=part=two=three",
      "",
      " NO_PROXY =localhost,127.0.0.1",
    ].join("\r\n"))).toEqual({
      values: {
        HTTP_PROXY: "http://127.0.0.1:10808",
        TOKEN: "part=two=three",
        NO_PROXY: "localhost,127.0.0.1",
      },
      invalidLineNumbers: [],
    });
  });

  it("uses the last duplicate value and reports invalid non-empty lines", () => {
    expect(parseRuntimeEnvText([
      "MODE=first",
      "missing separator",
      "=missing key",
      "MODE=last",
    ].join("\n"))).toEqual({
      values: { MODE: "last" },
      invalidLineNumbers: [2, 3],
    });
  });

  it("treats special object property names as literal environment keys", () => {
    const result = parseRuntimeEnvText("__proto__=literal");

    expect(Object.hasOwn(result.values, "__proto__")).toBe(true);
    expect(result.values.__proto__).toBe("literal");
  });
});
