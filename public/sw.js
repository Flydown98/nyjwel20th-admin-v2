const CACHE='nyjwel-admin-v0.9.5-shell';
const SHELL=['/','/style.css?v=0.9.5','/app.js?v=0.9.5','/manifest.webmanifest','/icon-192.png','/icon-512.png','/seat-guide.html','/seat-guide.css?v=0.9.5','/seat-guide.js?v=0.9.5','/raffle-stage.html','/raffle-stage.css?v=0.9.5','/raffle-stage.js?v=0.9.5','/demo.html','/demo.css?v=0.9.5','/demo.js?v=0.9.5'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/relay/')) return;
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{
    const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;
  }).catch(()=>caches.match(e.request)));
});
