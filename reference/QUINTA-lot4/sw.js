/* QUINTA : fonctionnement hors ligne (cache d'abord, réseau en secours) */
var V='quinta-v5';
var CORE=['./','index.html','body.txt','woman.txt','manifest.webmanifest','icon.svg','vendor/three.min.js','vendor/GLTFLoader.js','vendor/RoomEnvironment.js','fonts/figtree-400-latin.woff2','fonts/figtree-400-latin-ext.woff2','fonts/youngserif-400-latin.woff2','fonts/youngserif-400-latin-ext.woff2','fonts/ibmplexmono-400-latin.woff2','fonts/ibmplexmono-400-latin-ext.woff2','fonts/ibmplexmono-500-latin.woff2','fonts/ibmplexmono-500-latin-ext.woff2','img/iss.jpg','img/mars.jpg','img/moon.jpg','img/rover.jpg','img/woman_n.jpg'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(V).then(function(c){return c.addAll(CORE);}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(n){return n!==V;}).map(function(n){return caches.delete(n);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(function(hit){
    var net=fetch(e.request).then(function(r){if(r&&(r.ok||r.type==='opaque')){var cp=r.clone();caches.open(V).then(function(c){c.put(e.request,cp);});}return r;}).catch(function(){return hit;});
    return hit||net;
  }));
});
