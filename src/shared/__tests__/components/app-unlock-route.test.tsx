// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../../../App.jsx";

describe("App unlock route", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("should render the unlock screen on the first paint for the unlock route", () => {
    window.history.replaceState(null, "", "/#/unlock");

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="unlock-screen"');
    expect(html).toContain("Skills Manager");
    expect(html).not.toContain("AI CLI 工具统一管理");
  });

  it("should not force the unlock screen outside the unlock route on the first paint", () => {
    window.history.replaceState(null, "", "/");

    const html = renderToStaticMarkup(<App />);

    expect(html).not.toContain('class="unlock-screen"');
    expect(html).toContain("AI CLI 工具统一管理");
  });
});
