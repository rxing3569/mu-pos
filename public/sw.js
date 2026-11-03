const CACHE = 'mu-pos-shell-v3'
const BASE = new URL('./', self.location.href).pathname
const pages = [BASE, `${BASE}orders`, `${BASE}accounts`, `${BASE}settings`, `${BASE}backup`]
const staticFiles = ['manifest.webmanifest', 'favicon.ico', 'icon-192.png', 'icon-512.png'].map(file => `${BASE}${file}`)

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  await cache.addAll([...pages, ...staticFiles])
  for (const page of pages) {
    const html = await (await cache.match(page)).text()
    const assets = [...html.matchAll(/(?:src|href)="([^"?#]*\/_nuxt\/[^"?#]+)(?:\?[^\"]*)?"/g)].map(match => match[1])
    await Promise.all([...new Set(assets)].map(asset => cache.add(asset).catch(() => {})))
  }
})()))

self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))))

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(event.request, copy))
    }
    return response
  }).catch(() => caches.match(event.request, {ignoreSearch:true}).then(cached => cached || (event.request.mode === 'navigate' ? caches.match(BASE) : Response.error()))))
})
