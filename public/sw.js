// Service Worker for AhsAnime - Offline video caching
const CACHE_NAME = 'ahsanime-v1';
const VIDEO_CACHE_NAME = 'ahsanime-videos-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== VIDEO_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== location.origin && !url.href.includes('streamfile')) {
    return;
  }

  // Video segments (.ts, .m4s) - cache in video cache
  if (request.url.includes('.ts') || request.url.includes('.m4s') || 
      request.url.includes('.m3u8') || request.url.includes('.mpd')) {
    event.respondWith(cacheVideoSegment(request));
    return;
  }

  // Static assets - cache first
  if (isStaticAsset(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API requests - network first, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML pages - network first, cache fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Default - network first
  event.respondWith(networkFirst(request));
});

// Cache video segments with size limit
async function cacheVideoSegment(request) {
  const cache = await caches.open(VIDEO_CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone response before caching
      const responseClone = response.clone();
      cache.put(request, responseClone);
      
      // Limit video cache size (500MB)
      await limitVideoCache(cache, 500 * 1024 * 1024);
    }
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

// Limit video cache size
async function limitVideoCache(cache, maxSize) {
  const keys = await cache.keys();
  let currentSize = 0;
  
  for (const key of keys) {
    const response = await cache.match(key);
    if (response) {
      const blob = await response.blob();
      currentSize += blob.size;
    }
  }

  if (currentSize > maxSize) {
    // Delete oldest entries (simple FIFO)
    const toDelete = keys.slice(0, Math.ceil(keys.length * 0.3));
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

// Cache-first strategy
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

// Check if request is for static asset
function isStaticAsset(request) {
  const url = new URL(request.url);
  return (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|ico)$/) ||
    url.pathname === '/manifest.json'
  );
}

// Handle messages from client
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'DOWNLOAD_VIDEO') {
    downloadVideoForOffline(event.data.payload);
  }
  
  if (event.data.type === 'CLEAR_VIDEO_CACHE') {
    clearVideoCache();
  }
});

// Download full video for offline viewing
async function downloadVideoForOffline(payload) {
  const { m3u8Url, title, episode } = payload;
  
  try {
    // Fetch m3u8 playlist
    const m3u8Response = await fetch(m3u8Url);
    const m3u8Text = await m3u8Response.text();
    
    // Parse m3u8 to get segment URLs
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const segmentUrls = parseM3U8(m3u8Text, baseUrl);
    
    const cache = await caches.open(VIDEO_CACHE_NAME);
    
    // Download all segments
    for (const segmentUrl of segmentUrls) {
      try {
        const response = await fetch(segmentUrl);
        if (response.ok) {
          await cache.put(segmentUrl, response.clone());
        }
      } catch (err) {
        console.error('Failed to download segment:', segmentUrl, err);
      }
    }
    
    // Notify client of completion
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DOWNLOAD_COMPLETE',
          payload: { title, episode, success: true }
        });
      });
    });
  } catch (error) {
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'DOWNLOAD_COMPLETE',
          payload: { title, episode, success: false, error: error.message }
        });
      });
    });
  }
}

// Parse m3u8 playlist
function parseM3U8(text, baseUrl) {
  const lines = text.split('\n');
  const segments = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      // Relative URL
      if (trimmed.startsWith('http')) {
        segments.push(trimmed);
      } else {
        segments.push(baseUrl + trimmed);
      }
    }
  }
  
  return segments;
}

// Clear video cache
async function clearVideoCache() {
  await caches.delete(VIDEO_CACHE_NAME);
}