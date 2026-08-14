const defaultControlApiOrigin = "http://127.0.0.1:3032";
const developmentControlApiOrigin = process.env.CONTROL_API_ORIGIN ?? defaultControlApiOrigin;

export default defineNuxtConfig({
  srcDir: "app/",
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false
  },
  app: {
    head: {
      title: "AI 企业内容生产平台",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }]
    }
  },
  vite: {
    server: {
      proxy: {
        "/api/v1": { target: developmentControlApiOrigin, changeOrigin: true }
      }
    }
  },
  runtimeConfig: {
    controlApiOrigin: defaultControlApiOrigin,
  },
  compatibilityDate: "2025-05-15"
});
