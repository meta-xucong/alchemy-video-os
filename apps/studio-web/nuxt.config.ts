const controlApiOrigin = process.env.CONTROL_API_ORIGIN ?? "http://127.0.0.1:3032";

export default defineNuxtConfig({
  srcDir: "app/",
  ssr: false,
  devtools: { enabled: false },
  experimental: {
    appManifest: false
  },
  app: {
    head: {
      title: "AI Enterprise Content Platform",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }]
    }
  },
  vite: {
    server: {
      proxy: {
        "/api/v1": { target: controlApiOrigin, changeOrigin: true }
      }
    }
  },
  compatibilityDate: "2025-05-15"
});
