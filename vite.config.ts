import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:https` serves a self-signed HTTPS origin so a phone on your Wi-Fi
// gets a secure context (required for the microphone).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: { host: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
})) as any;
