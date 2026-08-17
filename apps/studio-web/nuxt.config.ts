const defaultControlApiOrigin = "http://127.0.0.1:3032";
const developmentControlApiOrigin = process.env.CONTROL_API_ORIGIN ?? defaultControlApiOrigin;
const localBuildDirectory = process.env.STUDIO_NUXT_BUILD_DIR ?? ".nuxt";
const localNitroOutputDirectory = process.env.STUDIO_NITRO_OUTPUT_DIR ?? ".output";
const localDemoMode = process.env.STUDIO_LOCAL_DEMO_MODE === "true";

export default defineNuxtConfig({
  srcDir: "app/",
  buildDir: localBuildDirectory,
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
  nitro: {
    output: {
      dir: localNitroOutputDirectory,
    },
  },
  runtimeConfig: {
    controlApiOrigin: defaultControlApiOrigin,
    public: {
      localDemoMode,
    },
  },
  compatibilityDate: "2025-05-15"
});
