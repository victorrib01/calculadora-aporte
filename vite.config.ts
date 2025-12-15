import react from "@vitejs/plugin-react";
import type { UserConfig } from "vitest/config";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
const config: UserConfig = {
  plugins: [react()] as unknown as UserConfig["plugins"],
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
    },
  },
};

export default defineConfig(config);
