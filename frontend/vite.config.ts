import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative base so assets load correctly on GitHub Pages and custom domains.
  base: "./",
  plugins: [react()],
});
