import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config.js";

// Observability in the isolated benchmark bundle only. The production build never uses this plugin.
export default mergeConfig(base, defineConfig({
  plugins: [{
    name: "codedeck-performance-observer",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/TerminalApp.tsx")) return;
      const marker = "terminalRef.current = terminal;";
      if (!code.includes(marker)) throw new Error("TerminalApp observer insertion point changed");
      return code.replace(marker, `${marker}
        const observer = window as typeof window & { __codedeckPerf?: { terminal: Terminal; fits: number } };
        observer.__codedeckPerf = { terminal, fits: 0 };
        const originalFit = fitAddon.fit.bind(fitAddon);
        fitAddon.fit = () => { observer.__codedeckPerf!.fits += 1; originalFit(); };
      `);
    },
  }],
}));
