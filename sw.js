const CACHE_NAME='sat3d-pro-v1';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png',
'https://cdn.jsdelivr.net/npm/cesium@1.117.0/Build/Cesium/Cesium.js',
'https://cdn.jsdelivr.net/npm/cesium@1.117.0/Build/Cesium/Widgets/widgets.css',
'https://cdn.jsdelivr.net/npm/satellite.js@5.0.1/dist/satellite.min.js',
'https://cdn.jsdelivr.net/npm/suncalc@1.9.0/suncalc.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('./index.html'))))});
