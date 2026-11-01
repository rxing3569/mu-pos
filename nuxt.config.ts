const baseURL = process.env.NUXT_APP_BASE_URL || "/";

export default defineNuxtConfig({
  devServer: { port: 3007 },
  compatibilityDate: "2026-10-29",
  css: ["~/assets/css/main.css"],
  app: {
    baseURL,
    head: {
      title: "Café POS",
      link: [{ rel: "icon", type: "image/x-icon", href: `${baseURL}favicon.ico` }, { rel: "manifest", href: `${baseURL}manifest.webmanifest` }],
      meta: [{ name: "theme-color", content: "#65452f" }, { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" }],
    },
  },
  nitro: { prerender: { routes: ["/", "/orders", "/accounts", "/settings"] } },
});
