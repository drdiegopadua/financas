const CACHE = 'financas-v2';
const DATA = 'financas-data';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// rede primeiro (pega atualizações), cache como reserva offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

/* ---- lembretes em segundo plano (Chrome/Android com app instalado) ---- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function checkBills() {
  const c = await caches.open(DATA);
  const res = await c.match('reminders.json');
  if (!res) return;
  const data = await res.json();
  if (!data.notify) return;
  const now = new Date(), today = iso(now);
  const lim = new Date(now); lim.setDate(lim.getDate() + (data.daysBefore || 0));
  const due = data.items.filter(x => x.date <= iso(lim));
  if (!due.length) return;
  const sentRes = await c.match('sent.json');
  const sent = sentRes ? await sentRes.json() : {};
  const pend = due.filter(x => sent[x.key] !== today);
  if (!pend.length) return;
  const base = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#lembretes' } };
  if (pend.length > 3) {
    await self.registration.showNotification(`💸 ${pend.length} contas para pagar`, { ...base, tag: 'resumo', body: pend.slice(0, 3).map(x => x.desc).join(', ') + '…' });
  } else {
    for (const x of pend) {
      const late = x.date < today;
      await self.registration.showNotification(`💸 ${x.desc} — ${x.value}`, { ...base, tag: x.key, body: `${late ? 'Venceu' : 'Vence'} em ${x.date.slice(8, 10)}/${x.date.slice(5, 7)}. Toque para marcar como paga.` });
    }
  }
  pend.forEach(x => { sent[x.key] = today; });
  await c.put('sent.json', new Response(JSON.stringify(sent)));
}
self.addEventListener('periodicsync', e => { if (e.tag === 'check-bills') e.waitUntil(checkBills()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const w of list) { w.focus(); w.postMessage('open-alerts'); return; }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
