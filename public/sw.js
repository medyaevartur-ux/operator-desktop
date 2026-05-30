// c:\Users\Medya\Projects\operator-desktop\public\sw.js
/**
 * Service Worker для Живая Сказка Operator.
 * Реализует кэширование статических ресурсов по стратегии Stale-While-Revalidate,
 * позволяя приложению мгновенно загружаться и полноценно работать в оффлайн-режиме.
 */

// Версия берётся из query-параметра регистрации (`/sw.js?v=<версия приложения>`),
// поэтому каждый релиз создаёт новое имя кэша, а старые удаляются на этапе activate.
const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_NAME = `zs-operator-cache-${SW_VERSION}`;

// Базовые ресурсы для кэширования при установке
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/logo.svg",
  "/vite.svg",
  "/tauri.svg",
  "/sounds/new_message.mp3",
  "/sounds/new_visitor.mp3",
  "/sounds/system_alert.mp3"
];

// Установка Service Worker и предварительное кэширование
self.addEventListener("install", (event) => {
  console.log("[Service Worker] Установка...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Предварительное кэширование ресурсов...");
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Активация и удаление старых кэшей
self.addEventListener("activate", (event) => {
  console.log("[Service Worker] Активация...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log(`[Service Worker] Удаление старого кэша: ${cache}`);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: Stale-While-Revalidate для локальных запросов статики
self.addEventListener("fetch", (event) => {
  // Полностью игнорируем любые запросы в среде Tauri для исключения конфликтов с кастомными протоколами
  if (
    self.location.origin.includes("tauri.localhost") ||
    self.location.protocol === "tauri:"
  ) {
    return;
  }

  const url = new URL(event.request.url);

  // Не перехватываем API запросы, WebSocket соединения и Tauri-специфичные схемы
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io") ||
    event.request.method !== "GET" ||
    !event.request.url.startsWith(self.location.origin)
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Если ответ успешный, сохраняем/обновляем его в кэше
          if (networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch((err) => {
          console.warn(`[Service Worker] Сетевой запрос к ${event.request.url} не удался (оффлайн режим):`, err);
        });

        // Возвращаем кэшированную версию сразу, если она есть, иначе ждем ответа сети
        return cachedResponse || fetchPromise;
      });
    })
  );
});
