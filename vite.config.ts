import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the build work under any GitHub Pages path (https://<user>.github.io/<repo>/)
export default defineConfig({
  plugins: [react()],
  base: "./",
});
