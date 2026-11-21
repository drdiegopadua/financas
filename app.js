/* Minhas Finanças — PWA de controle financeiro pessoal (dados salvos no aparelho) */
'use strict';

const KEY = 'financas.v1';
const APP_VERSION = '11';
const DEFAULT_CATS = [
  { id: 'moradia', name: 'Moradia', icon: '🏠', color: '#60a5fa' },
  { id: 'alimentacao', name: 'Alimentação', icon: '🍽️', color: '#f97316' },
  { id: 'mercado', name: 'Mercado', icon: '🛒', color: '#facc15' },
  { id: 'transporte', name: 'Transporte', icon: '🚗', color: '#a78bfa' },
  { id: 'saude', name: 'Saúde', icon: '💊', color: '#f87171' },
  { id: 'educacao', name: 'Educação', icon: '📚', color: '#2dd4bf' },
  { id: 'lazer', name: 'Lazer', icon: '🎉', color: '#f472b6' },
  { id: 'contas', name: 'Contas', icon: '💡', color: '#38bdf8' },
  { id: 'cartao', name: 'Cartão', icon: '💳', color: '#fb7185' },
  { id: 'compras', name: 'Compras', icon: '🛍️', color: '#c084fc' },
  { id: 'impostos', name: 'Impostos', icon: '🧾', color: '#94a3b8' },
  { id: 'outros', name: 'Outros', icon: '📦', color: '#64748b' },
];
const DEFAULT_SETTINGS = { notify: false, daysBefore: 1 };

/* ---------- dados ---------- */
function fresh() {
  return { expenses: [], incomes: [], receivables: [], goals: [], cats: JSON.parse(JSON.stringify(DEFAULT_CATS)), settings: { ...DEFAULT_SETTINGS }, notified: {} };
}
function normalize(d) {
  const db = Object.assign(fresh(), d);
  db.settings = Object.assign({ ...DEFAULT_SETTINGS }, db.settings);
  db.notified = db.notified || {};
  return db;
}
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && typeof d === 'object') return normalize(d); } catch (e) { /* ignora */ }
  return fresh();
}
let db = load();
function save() {
  db.updatedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Não foi possível salvar'); }
  syncReminders();
  if (syncOn()) { sync.dirty = true; saveSync(); schedulePush(); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = v => brl.format(v || 0);
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const money0 = v => brl0.format(v || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cents = v => Math.round((Number(v) || 0) * 100);

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return iso(new Date(y, m - 1, d + n)); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
const ymOf = date => date.slice(0, 7);
const curYM = () => ymOf(today());
function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
function diffMonths(a, b) { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (ya - yb) * 12 + (ma - mb); }
function dateIn(ym, day) { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(Math.min(day, new Date(y, m, 0).getDate()))}`; }
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ymLabel = (ym, long) => { const [y, m] = ym.split('-').map(Number); return long ? `${MESES_L[m - 1]} ${y}` : `${MESES[m - 1]}/${String(y).slice(2)}`; };
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const fmtDM = d => d ? `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}` : '';
const cat = id => db.cats.find(c => c.id === id) || { id, name: 'Sem categoria', icon: '❔', color: '#64748b' };
function whenTxt(date) {
  const d = daysBetween(today(), date);
  if (d === 0) return 'vence hoje';
  if (d === 1) return 'vence amanhã';
  if (d > 1) return `vence em ${d} dias`;
  return d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- regras de negócio ---------- */
function installmentValue(e, k) {
  if (e.mode !== 'parcelada') return cents(e.amount);
  const total = cents(e.amount), n = e.n || 1, base = Math.floor(total / n);
  return k === n - 1 ? total - base * (n - 1) : base;
}
// data em que foi paga (string) ou '' se a data não foi registrada; undefined se não paga
function paidInfo(e, ym) {
  const v = e.paid && e.paid[ym];
  if (!v) return undefined;
  return typeof v === 'string' ? v : '';
}

function expensesIn(ym) {
  const out = [];
  for (const e of db.expenses) {
    const start = ymOf(e.start), k = diffMonths(ym, start), day = Number(e.start.slice(8, 10));
    let ok = false;
    if (e.mode === 'unica') ok = k === 0;
    else if (e.mode === 'parcelada') ok = k >= 0 && k < (e.n || 1);
    else if (e.mode === 'fixa') ok = k >= 0 && (!e.end || ym <= e.end);
    if (!ok) continue;
    const pi = paidInfo(e, ym);
    out.push({ e, k, ym, value: installmentValue(e, k) / 100, date: dateIn(ym, day), paid: pi !== undefined, paidAt: pi || '' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function incomesIn(ym) {
  const out = [];
  for (const i of db.incomes) {
    const k = diffMonths(ym, ymOf(i.date)), day = Number(i.date.slice(8, 10));
    const ok = i.recurring ? k >= 0 && (!i.end || ym <= i.end) : k === 0;
    if (ok) out.push({ i, value: Number(i.amount) || 0, date: dateIn(ym, day) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const receivedIn = ym => db.receivables.filter(r => r.received && r.receivedAt && ymOf(r.receivedAt) === ym);

function summary(ym) {
  const exps = expensesIn(ym), incs = incomesIn(ym), recs = receivedIn(ym);
  const sum = (arr, f) => arr.reduce((s, x) => s + cents(f(x)), 0) / 100;
  const despesas = sum(exps, x => x.value), pago = sum(exps.filter(x => x.paid), x => x.value);
  const renda = sum(incs, x => x.value), recebido = sum(recs, x => x.amount), entradas = renda + recebido;
  const byCat = {};
  for (const x of exps) byCat[x.e.cat] = (byCat[x.e.cat] || 0) + x.value;
  return { exps, incs, recs, despesas, pago, aPagar: despesas - pago, renda, recebido, entradas, sobra: entradas - despesas, byCat };
}

// contas não pagas que vencem até (hoje + dias de antecedência), incluindo atrasadas dos últimos 6 meses
function dueAlerts() {
  const limit = addDays(today(), Number(db.settings.daysBefore) || 0), out = [];
  // ignora meses anteriores ao cadastro (já estavam pagos antes de usar o app)
  for (let i = -6; i <= 1; i++) for (const x of expensesIn(addMonths(curYM(), i))) if (!x.paid && x.date <= limit && !(x.e.created && x.ym < ymOf(x.e.created))) out.push(x);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const recAlerts = () => db.receivables.filter(r => !r.received && r.due && r.due <= today());

/* ---------- lembretes / notificações ---------- */
async function swReg() { return 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : null; }

async function notifyDue() {
  if (!db.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const t = today(), pend = dueAlerts().filter(x => db.notified[`${x.e.id}|${x.ym}`] !== t);
  if (!pend.length) return;
  const reg = await swReg();
  const show = (title, opts) => reg ? reg.showNotification(title, opts) : new Notification(title, opts);
  const base = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './' } };
  if (pend.length > 3) {
    const tot = pend.reduce((a, x) => a + x.value, 0);
    show(`💸 ${pend.length} contas para pagar`, { ...base, tag: 'resumo', body: `Total ${money(tot)} — ${pend.slice(0, 3).map(x => x.e.desc).join(', ')}…` });
  } else {
    for (const x of pend) show(`💸 ${x.e.desc} — ${money(x.value)}`, { ...base, tag: `${x.e.id}|${x.ym}`, body: `${whenTxt(x.date)} (${fmtDate(x.date)}). Toque para marcar como paga.` });
  }
  pend.forEach(x => { db.notified[`${x.e.id}|${x.ym}`] = t; });
  for (const k in db.notified) if (db.notified[k] < addDays(t, -40)) delete db.notified[k];
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignora */ }
}

// guarda a lista de próximas contas para o service worker avisar em segundo plano (Android/Chrome)
async function syncReminders() {
  updateBell();
  if (!('caches' in window)) return;
  const items = [];
  for (let i = -2; i <= 2; i++) for (const x of expensesIn(addMonths(curYM(), i))) if (!x.paid) items.push({ key: `${x.e.id}|${x.ym}`, desc: x.e.desc, value: money(x.value), date: x.date });
  try {
    const c = await caches.open('financas-data');
    await c.put('reminders.json', new Response(JSON.stringify({ notify: db.settings.notify, daysBefore: Number(db.settings.daysBefore) || 0, items }), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { /* ignora */ }
}

async function enableNotifications() {
  if (!('Notification' in window)) { toast('Este navegador não suporta avisos'); return false; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Permissão de aviso negada'); return false; }
  db.settings.notify = true; save();
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) await reg.periodicSync.register('check-bills', { minInterval: 12 * 3600 * 1000 });
  } catch (e) { /* nem todo navegador permite */ }
  notifyDue();
  toast('Lembretes ativados 🔔');
  return true;
}

function exportICS() {
  const d = Number(db.settings.daysBefore) || 0, now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const trig = d === 0 ? 'PT9H' : `-PT${d * 24 - 9}H`;
  const escI = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Minhas Financas//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Contas a pagar'];
  let n = 0;
  for (let i = 0; i < 12; i++) for (const x of expensesIn(addMonths(curYM(), i))) {
    if (x.paid || x.date < today()) continue;
    const ds = x.date.replace(/-/g, ''), de = addDays(x.date, 1).replace(/-/g, '');
    const parc = x.e.mode === 'parcelada' ? ` (${x.k + 1}/${x.e.n})` : '';
    lines.push('BEGIN:VEVENT', `UID:${x.e.id}-${x.ym}@minhas-financas`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${ds}`, `DTEND;VALUE=DATE:${de}`,
      `SUMMARY:${escI(`💸 Pagar ${x.e.desc}${parc} - ${money(x.value)}`)}`, `DESCRIPTION:${escI(`${cat(x.e.cat).name} · ${money(x.value)}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(`Pagar ${x.e.desc} - ${money(x.value)}`)}`, `TRIGGER:${trig}`, 'END:VALARM', 'END:VEVENT');
    n++;
  }
  lines.push('END:VCALENDAR');
  if (!n) return toast('Nenhuma conta futura em aberto');
  download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), 'contas-a-pagar.ics');
  toast(`${n} lembretes exportados`);
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- Google Planilhas (banco de dados) ---------- */
const SYNC_KEY = 'financas.sync';
let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })();
function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) { /* ignora */ } }
function syncOn() { return !!(sync.url && sync.chave); }
function newKey() { const a = new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a, b => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join(''); }

const FORMA = { unica: 'única', parcelada: 'parcelada', fixa: 'fixa' };
const FORMA_R = { 'única': 'unica', unica: 'unica', 'à vista': 'unica', parcelada: 'parcelada', fixa: 'fixa', 'fixa mensal': 'fixa' };
const simnao = b => b ? 'sim' : 'não';
const isSim = v => v === true || /^(sim|s|true|1|x)$/i.test(String(v ?? '').trim());

function toTables(d = db) {
  return {
    Despesas: d.expenses.map(e => ({ id: e.id, descricao: e.desc, tipo: cat(e.cat).name, tipo_id: e.cat, forma: FORMA[e.mode], valor: Number(e.amount) || 0, parcelas: e.n || 1, data: e.start, fim: e.end || '', pagamentos: JSON.stringify(e.paid || {}), obs: e.note || '', criado: e.created || '' })),
    Entradas: d.incomes.map(i => ({ id: i.id, descricao: i.desc, valor: Number(i.amount) || 0, data: i.date, mensal: simnao(i.recurring), fim: i.end || '' })),
    AReceber: d.receivables.map(r => ({ id: r.id, quem: r.who || '', descricao: r.desc, valor: Number(r.amount) || 0, previsao: r.due || '', recebido: simnao(r.received), recebido_em: r.receivedAt || '', obs: r.note || '' })),
    Tipos: d.cats.map(c => ({ id: c.id, nome: c.name, icone: c.icon, cor: c.color })),
    Metas: (d.goals || []).map(g => ({ id: g.id, nome: g.name, icone: g.icon, valor_meta: Number(g.target) || 0, por_mes: Number(g.monthly) || 0, inicio: g.start, obs: g.note || '' })),
    Depositos: (d.goals || []).flatMap(g => (g.deposits || []).map(x => ({ id: x.id, meta_id: g.id, meta: g.name, data: x.date, valor: Number(x.amount) || 0, obs: x.note || '' }))),
    Config: [{ chave: 'atualizado_em', valor: d.updatedAt || '' }, { chave: 'avisar_dias_antes', valor: String(d.settings.daysBefore) }],
  };
}
// converte o que veio da planilha para o formato do app (aceita linhas digitadas à mão, sem id)
function fromTables(t) {
  const s = v => v == null ? '' : String(v).trim();
  // aceita 1500 · "1500.5" · "1.500,50" (digitado no formato brasileiro)
  const num = v => typeof v === 'number' ? v : (s(v).includes(',') ? Number(s(v).replace(/\./g, '').replace(',', '.')) : Number(s(v).replace(/[^\d.-]/g, ''))) || 0;
  let generated = false;
  const id = v => { if (s(v)) return s(v); generated = true; return uid(); };
  const cfg = Object.fromEntries((t.Config || []).map(r => [s(r.chave), s(r.valor)]));
  const cats = (t.Tipos || []).filter(r => s(r.id) || s(r.nome)).map(r => ({ id: id(r.id), name: s(r.nome) || 'Sem nome', icon: s(r.icone) || '🏷️', color: s(r.cor) || '#64748b' }));
  const catByName = n => (cats.find(c => c.name.toLowerCase() === n.toLowerCase()) || {}).id;
  const data = {
    cats: cats.length ? cats : JSON.parse(JSON.stringify(DEFAULT_CATS)),
    expenses: (t.Despesas || []).filter(r => s(r.descricao) && s(r.data)).map(r => {
      let paid = {}; try { paid = JSON.parse(s(r.pagamentos) || '{}') || {}; } catch (e) { /* ignora */ }
      const mode = FORMA_R[s(r.forma).toLowerCase()] || 'unica';
      return { id: id(r.id), desc: s(r.descricao), cat: s(r.tipo_id) || catByName(s(r.tipo)) || 'outros', mode, amount: num(r.valor), n: mode === 'parcelada' ? Math.max(2, parseInt(r.parcelas) || 2) : 1, start: s(r.data).slice(0, 10), end: s(r.fim).slice(0, 7) || null, paid, note: s(r.obs), created: s(r.criado).slice(0, 10) };
    }),
    incomes: (t.Entradas || []).filter(r => s(r.descricao) && s(r.data)).map(r => ({ id: id(r.id), desc: s(r.descricao), amount: num(r.valor), date: s(r.data).slice(0, 10), recurring: isSim(r.mensal), end: s(r.fim).slice(0, 7) || null })),
    receivables: (t.AReceber || []).filter(r => s(r.descricao) || s(r.quem)).map(r => ({ id: id(r.id), who: s(r.quem), desc: s(r.descricao) || s(r.quem), amount: num(r.valor), due: s(r.previsao).slice(0, 10), received: isSim(r.recebido), receivedAt: isSim(r.recebido) ? (s(r.recebido_em).slice(0, 10) || today()) : null, note: s(r.obs) })),
  };
  data.goals = (t.Metas || []).filter(r => s(r.nome)).map(r => ({ id: id(r.id), name: s(r.nome), icon: s(r.icone) || '🎯', target: num(r.valor_meta), monthly: num(r.por_mes), start: s(r.inicio).slice(0, 7) || curYM(), note: s(r.obs), deposits: [] }));
  for (const r of (t.Depositos || [])) {
    const g = data.goals.find(x => x.id === s(r.meta_id)) || data.goals.find(x => x.name.toLowerCase() === s(r.meta).toLowerCase());
    if (g && s(r.data)) g.deposits.push({ id: id(r.id), date: s(r.data).slice(0, 10), amount: num(r.valor), note: s(r.obs) });
  }
  data.goals.forEach(g => g.deposits.sort((a, b) => a.date.localeCompare(b.date)));
  return { data, updatedAt: cfg.atualizado_em || '', daysBefore: cfg.avisar_dias_antes, generated };
}
const canon = d => JSON.stringify(['expenses', 'incomes', 'receivables', 'cats', 'goals'].map(k => d[k] || []));
const hasData = d => d.expenses.length + d.incomes.length + d.receivables.length + (d.goals || []).length > 0;

async function gsCall(acao, url = sync.url, chave = sync.chave) {
  const body = { chave, acao };
  if (acao === 'gravar') body.dados = toTables();
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  let j; try { j = await r.json(); } catch (e) { throw new Error('Resposta inválida — confira a URL e se o acesso está como "Qualquer pessoa"'); }
  if (j.erro) throw new Error(j.erro);
  if (j.planilha) sync.sheetUrl = j.planilha;
  return j;
}

function applyRemote(remote) {
  const keep = { settings: db.settings, notified: db.notified };
  db = normalize({ ...remote.data, settings: keep.settings, notified: keep.notified, updatedAt: remote.updatedAt });
  if (remote.daysBefore !== undefined && remote.daysBefore !== '') db.settings.daysBefore = Number(remote.daysBefore) || 0;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignora */ }
  syncReminders();
}

let pushTimer = null, syncing = false, syncAgain = false;
function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 1200); }

async function syncNow(manual) {
  if (!syncOn()) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { sync.status = 'offline'; saveSync(); return; }
  syncing = true; sync.status = 'syncing'; refreshSyncUI();
  try {
    const remote = fromTables((await gsCall('ler')).dados);
    const local = fromTables(toTables());
    const remoteChanged = canon(remote.data) !== canon(local.data);
    if (sync.dirty && remoteChanged && remote.updatedAt > (db.updatedAt || '')) {
      applyRemote(remote); sync.dirty = false; render(); // planilha mais nova (outro aparelho)
    } else if (sync.dirty) {
      await gsCall('gravar'); sync.dirty = false;
    } else if (remoteChanged) {
      applyRemote(remote); render();
      if (remote.generated) await gsCall('gravar'); // grava ids das linhas digitadas na planilha
    }
    sync.last = new Date().toISOString(); sync.status = 'ok'; sync.error = '';
    if (manual) toast('Sincronizado com a planilha ✓');
  } catch (e) {
    sync.status = 'error'; sync.error = e.message || 'Falha de conexão';
    if (manual) toast('Erro: ' + sync.error);
  } finally {
    syncing = false; saveSync(); refreshSyncUI();
    if (syncAgain) { syncAgain = false; syncNow(); }
  }
}

async function connectSheets(url, chave) {
  url = url.trim(); chave = chave.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return toast('Cole a URL do app da Web (script.google.com)');
  if (chave.length < 8) return toast('Informe a chave');
  toast('Conectando…');
  try {
    const remote = fromTables((await gsCall('ler', url, chave)).dados);
    sync.url = url; sync.chave = chave; delete sync.pendingKey;
    if (hasData(remote.data) && hasData(db)) {
      if (confirm('A planilha já tem dados.\n\nOK = usar os dados da PLANILHA neste aparelho\nCancelar = enviar os dados DESTE aparelho para a planilha')) { applyRemote(remote); sync.dirty = false; }
      else sync.dirty = true;
    } else if (hasData(remote.data)) { applyRemote(remote); sync.dirty = !!remote.generated; }
    else sync.dirty = true;
    if (sync.dirty && !db.updatedAt) { db.updatedAt = new Date().toISOString(); localStorage.setItem(KEY, JSON.stringify(db)); }
    saveSync();
    await syncNow();
    render(); toast(sync.status === 'ok' ? 'Planilha conectada ✓' : 'Erro: ' + sync.error);
  } catch (e) { toast('Não conectou: ' + (e.message || 'verifique a URL')); }
}

// link de conexão: .../financas/#conectar=<base64url de {"u":url,"k":chave}>
// (a parte depois do # nunca é enviada a servidor nenhum)
function parseConnect(str) {
  const m = String(str || '').match(/conectar=([A-Za-z0-9_\-+/=]+)/);
  if (!m) return null;
  try { const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); return j.u && j.k ? j : null; } catch (e) { return null; }
}
function connectLink() {
  const b = btoa(JSON.stringify({ u: sync.url, k: sync.chave })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#conectar=${b}`;
}
async function connectFromText(txt) {
  const c = parseConnect(txt);
  if (!c) return toast('Link de conexão inválido');
  await connectSheets(c.u, c.k);
}

async function copyScript() {
  if (!sync.chave && !sync.pendingKey) { sync.pendingKey = newKey(); saveSync(); }
  const key = sync.chave || sync.pendingKey;
  let code;
  try { code = (await (await fetch('apps-script.gs', { cache: 'no-store' })).text()).replace('__CHAVE__', key); }
  catch (e) { return toast('Sem internet para baixar o script'); }
  try { await navigator.clipboard.writeText(code); toast('Código copiado ✓ — cole no Apps Script'); }
  catch (e) {
    openModal(`${head('Código do script')}<p class="muted" style="color:var(--ink2);margin:0">Selecione tudo e copie:</p>
      <label class="f"><textarea rows="12" readonly style="font:12px monospace">${esc(code)}</textarea></label>`);
  }
}

function syncLabel() {
  if (!syncOn()) return 'Não conectado — dados só neste aparelho';
  const when = sync.last ? new Date(sync.last).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  return { syncing: 'Sincronizando…', offline: 'Sem internet — envia quando voltar', error: `⚠️ ${sync.error}` }[sync.status] || `Conectado ✓ · última sincronização ${when}`;
}
function refreshSyncUI() {
  const el = $('#syncStatus'); if (el) el.textContent = syncLabel();
  const dot = $('#syncDot');
  if (dot) { dot.hidden = !syncOn(); dot.dataset.s = sync.status || 'ok'; }
}

function updateBell() {
  const n = dueAlerts().length + recAlerts().length, b = $('#bellBadge');
  b.hidden = !n; b.textContent = n > 9 ? '9+' : n;
}

/* ---------- estado ---------- */
const state = { tab: 'dash', ym: curYM(), catFilter: null, recFilter: 'pend', despFilter: 'all' };

/* ---------- componentes ---------- */
function setPaid(e, ym, on, date) {
  e.paid = e.paid || {};
  if (on) e.paid[ym] = date || today(); else delete e.paid[ym];
}

function billCard(x) {
  const c = cat(x.e.cat), late = !x.paid && x.date < today();
  const parc = x.e.mode === 'parcelada' ? ` · ${x.k + 1}/${x.e.n}` : x.e.mode === 'fixa' ? ' · fixa' : '';
  return `<div class="bill ${x.paid ? 'paid' : ''} ${late ? 'late' : ''}" data-edit-exp="${x.e.id}" data-ym="${x.ym}" role="button">
    <div class="top"><div class="ic" style="color:${c.color}">${c.icon}</div>
      <button class="chk ${x.paid ? 'on' : ''}" data-pay="${x.e.id}" data-ym="${x.ym}" aria-label="${x.paid ? 'Desmarcar pagamento' : 'Marcar como paga'}">✓</button></div>
    <div class="t">${esc(x.e.desc)}</div>
    <div class="sub" style="font-size:11px;color:var(--ink2)">${esc(c.name)}${parc}</div>
    <div class="ft"><span>${x.paid ? `Pago ${x.paidAt ? fmtDM(x.paidAt) : ''}` : late ? `Venceu ${fmtDM(x.date)}` : fmtDM(x.date)}</span><b>${money(x.value)}</b></div>
  </div>`;
}

function expRow(x) {
  const c = cat(x.e.cat), late = !x.paid && x.date < today(), soon = !x.paid && !late && daysBetween(today(), x.date) <= (Number(db.settings.daysBefore) || 0);
  return `<div class="row ${x.paid ? 'done' : ''}" data-edit-exp="${x.e.id}" data-ym="${x.ym}">
    <div class="ic" style="color:${c.color}">${c.icon}</div>
    <div class="mid"><div class="t">${esc(x.e.desc)}</div>
      <div class="sub">${x.paid ? `<span class="tag ok">pago ${x.paidAt ? fmtDate(x.paidAt) : ''}</span>` : `<span class="tag ${late ? 'late' : soon ? 'soon' : ''}">${whenTxt(x.date)}</span>`}<span>${money(x.value)}</span></div></div>
    ${x.paid ? `<button class="pay ok" data-pay="${x.e.id}" data-ym="${x.ym}">✓ Pago</button>` : `<button class="pay" data-pay="${x.e.id}" data-ym="${x.ym}">Pagar</button>`}
  </div>`;
}

// linha de despesa no estilo da lista de entradas (valor à direita + ✓ para pagar)
function despRow(x) {
  const c = cat(x.e.cat), late = !x.paid && x.date < today(), soon = !x.paid && !late && daysBetween(today(), x.date) <= (Number(db.settings.daysBefore) || 0);
  const parc = x.e.mode === 'parcelada' ? `<span class="tag">${x.k + 1}/${x.e.n}</span>` : x.e.mode === 'fixa' ? '<span class="tag">fixa</span>' : '';
  const when = x.paid ? `<span class="tag ok">pago ${x.paidAt ? fmtDM(x.paidAt) : ''}</span>`
    : late || soon ? `<span class="tag ${late ? 'late' : 'soon'}">${whenTxt(x.date)}</span>` : `<span>dia ${fmtDate(x.date).slice(0, 5)}</span>`;
  return `<div class="row ${x.paid ? 'done' : ''}" data-edit-exp="${x.e.id}" data-ym="${x.ym}">
    <div class="ic" style="color:${c.color}">${c.icon}</div>
    <div class="mid"><div class="t">${esc(x.e.desc)}</div><div class="sub"><span>${esc(c.name)}</span>${parc}${when}</div></div>
    <div class="amt">${money(x.value)} <span class="arrow-up">↗</span></div>
    <button class="chk ${x.paid ? 'on' : ''}" data-pay="${x.e.id}" data-ym="${x.ym}" aria-label="${x.paid ? 'Desmarcar pagamento' : 'Marcar como paga'}">✓</button>
  </div>`;
}

function recRow(r) {
  const late = !r.received && r.due && r.due < today();
  return `<div class="row ${r.received ? 'done' : ''}" data-edit-rec="${r.id}">
    <div class="ic">🤝</div>
    <div class="mid"><div class="t">${esc(r.who || r.desc)}</div>
      <div class="sub">${r.who ? `<span>${esc(r.desc)}</span>` : ''}${r.received ? `<span class="tag ok">recebido ${fmtDate(r.receivedAt)}</span>` : r.due ? `<span class="tag ${late ? 'late' : ''}">${late ? 'atrasado · ' : ''}${fmtDate(r.due)}</span>` : ''}</div></div>
    <div class="amt">${money(r.amount)} <span class="arrow-dn">↙</span></div>
    ${r.received ? '' : `<button class="pay recv" data-recv="${r.id}">Recebi</button>`}
  </div>`;
}

function lineChart(points, sel) {
  const W = 320, H = 170, L = 38, R = 8, T = 34, B = 24;
  const vals = points.map(p => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 100; max += 100; }
  const padv = (max - min) * .15; min -= padv; max += padv;
  const X = i => L + i * (W - L - R) / (points.length - 1), Y = v => T + (max - v) / (max - min) * (H - T - B);
  const pts = points.map((p, i) => [X(i), Y(p.v)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const ticks = [0, 1, 2, 3].map(i => min + (max - min) * (i + .5) / 4);
  const zero = min < 0 && max > 0 ? `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,120,120,.5)" stroke-dasharray="2 4"/>` : '';
  const [sx, sy] = pts[sel];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sobra por mês">
    <defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<text x="0" y="${Y(t) + 3}" fill="#a9bad3" font-size="9">${compact(t)}</text>`).join('')}
    ${zero}
    <line x1="${L}" x2="${W - R}" y1="${sy}" y2="${sy}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 4"/>
    <path d="${d} L${pts.at(-1)[0]},${H - B} L${pts[0][0]},${H - B} Z" fill="url(#ar)"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <line x1="${sx}" x2="${sx}" y1="${sy}" y2="${H - B}" stroke="rgba(255,255,255,.55)" stroke-dasharray="3 4"/>
    <circle cx="${sx}" cy="${sy}" r="5.5" fill="#cbd5e1" stroke="#fff" stroke-width="2"/>
    ${points.map((p, i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" fill="${i === sel ? '#fff' : '#a9bad3'}" font-size="9.5" font-weight="${i === sel ? 600 : 400}">${p.label}</text>`).join('')}
  </svg><div class="tip" style="left:${sx / W * 100}%;top:${(sy - 10) / H * 100}%">${money(points[sel].v).replace(',00', '')}<small>${points[sel].sub}</small></div></div>`;
}
function compact(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1000) return `${s}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return `${s}${Math.round(a)}`;
}

function donut(cats, total) {
  const r = 46, c = 2 * Math.PI * r; let off = 0;
  const segs = cats.map(([id, v]) => {
    const len = total ? v / total * c : 0;
    const s = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${cat(id).color}" stroke-width="16" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len; return s;
  }).join('');
  return `<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Gastos por categoria">${segs}
    <text x="60" y="56" text-anchor="middle" fill="#a9bad3" font-size="9">Total</text>
    <text x="60" y="71" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">${money(total).replace('R$', '').trim()}</text></svg>`;
}

/* ---------- telas ---------- */
function render() {
  $('#monthLabel').textContent = ymLabel(state.ym, true);
  $('#monthNav').style.visibility = ['rec', 'cfg', 'meta'].includes(state.tab) ? 'hidden' : 'visible';
  $('#fab').classList.toggle('hide', state.tab === 'cfg');
  $('#fabTxt').textContent = { dash: 'Adicionar', desp: 'Nova despesa', rec: 'Novo a receber', ent: 'Nova entrada', meta: 'Nova meta' }[state.tab] || '';
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#view').innerHTML = ({ dash: viewDash, desp: viewDesp, rec: viewRec, ent: viewEnt, meta: viewMetas, cfg: viewCfg })[state.tab]();
  updateBell(); refreshSyncUI();
}

function alertBar() {
  const late = dueAlerts().filter(x => x.date < today()), todayN = dueAlerts().length - late.length;
  if (!late.length && !todayN) return '';
  const parts = [];
  if (late.length) parts.push(`<b>${late.length} conta${late.length > 1 ? 's' : ''} atrasada${late.length > 1 ? 's' : ''}</b>`);
  if (todayN) parts.push(`<b>${todayN}</b> vencendo`);
  return `<button class="alertbar" data-act="alerts">🔔 <span>${parts.join(' · ')} — toque para ver</span></button>`;
}

function viewDash() {
  const s = summary(state.ym);
  const pendRec = db.receivables.filter(r => !r.received);
  const totalRec = pendRec.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const h = new Date().getHours(), hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const usedPct = s.entradas > 0 ? Math.round(s.despesas / s.entradas * 100) : 0;

  let out = alertBar() + `
  <section class="hero">
    <div class="greet"><div class="hi">${hello}! <b>👋</b></div><div class="big">Vamos ver suas finanças</div></div>
    <div class="pcard ${s.sobra < 0 ? 'neg' : ''}"><span class="chip-ic">▦</span>
      <div class="lbl">${s.sobra < 0 ? 'Faltando em' : 'Sobrando em'}</div><div class="nm" style="text-transform:capitalize">${ymLabel(state.ym, true)}</div>
      <div class="amt">${money(Math.abs(s.sobra))}</div>
      <div class="delta">${usedPct}% da renda gasta</div>${plannedSavings(state.ym) > 0 ? `<div class="delta">🐷 guardar ${money0(plannedSavings(state.ym))} · livre ${money0(s.sobra - plannedSavings(state.ym))}</div>` : ''}</div>
  </section>
  <section class="pills">
    <button class="pill" data-act="newexp"><span class="circ">↗</span><b>Despesa</b></button>
    <div class="pill split"><div><div class="k">Entradas</div><div class="v">${money0(s.entradas)}</div></div><div><div class="k">Despesas</div><div class="v">${money0(s.despesas)}</div></div></div>
  </section>`;

  const unpaid = s.exps.filter(x => !x.paid);
  out += `<h2>Contas a pagar <button class="add-btn" data-act="newexp"><i>+</i>Adicionar</button></h2>`;
  out += `<section class="sheet">${unpaid.length ? unpaid.slice(0, 6).map(despRow).join('') : `<div class="empty"><b>✅</b>${s.exps.length ? 'Tudo pago neste mês!' : 'Nenhuma conta neste mês'}</div>`}
    ${unpaid.length > 6 ? `<div class="row" data-tab-go="desp" role="button" style="justify-content:center;font-weight:600">Ver mais ${unpaid.length - 6} em Despesas ›</div>` : ''}</section>`;

  out += `<h2>Painel</h2><div class="glass">`;
  const pts = Array.from({ length: 6 }, (_, i) => { const m = addMonths(state.ym, i - 2); return { v: summary(m).sobra, label: ymLabel(m).split('/')[0], sub: `sobra ${ymLabel(m)}` }; });
  out += lineChart(pts, 2);
  out += `<div class="balance"><span>A receber</span><b>${money(totalRec)}</b></div>
    <div class="balance" style="margin-top:8px"><span>Falta pagar no mês</span><b class="${s.aPagar > 0 ? 'warn' : 'pos'}">${money(s.aPagar)}</b></div></div>`;

  out += `<section class="sheet" style="margin-top:24px"><h2>Quem me deve <button class="link" data-tab-go="rec">Ver todos ›</button></h2>
    <div class="cols"><span>Pessoas</span><span>Valor</span></div>`;
  out += pendRec.length ? pendRec.sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 4).map(recRow).join('') : '<div class="empty"><b>🤝</b>Ninguém te deve no momento</div>';
  out += `</section>`;

  if ((db.goals || []).length) out += `<h2>Metas <button class="link" data-tab-go="meta">Ver todas ›</button></h2><div class="glass">${db.goals.map(g => { const sv = goalSaved(g), p = g.target ? Math.min(100, sv / g.target * 100) : 0; return `<div class="mini-goal" data-tab-go="meta"><div><span>${esc(g.icon)} ${esc(g.name)}</span><b>${money0(sv)} de ${money0(g.target)}</b></div><div class="goal-bar"><i style="width:${p.toFixed(1)}%"></i></div></div>`; }).join('')}</div>`;
  out += `<h2>Resumo de ${ymLabel(state.ym)}</h2><div class="grid">
    <div class="stat"><div class="lbl">Já pago</div><div class="val pos">${money(s.pago)}</div></div>
    <div class="stat"><div class="lbl">Parcelas futuras</div><div class="val">${money(futureInstallmentsTotal())}</div><div class="muted">após este mês</div></div></div>`;

  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) out += `<h2>Gastos por tipo</h2><div class="glass donut-wrap">${donut(cats, s.despesas)}<div class="legend">${cats.slice(0, 6).map(([id, v]) => { const c = cat(id); return `<div><i class="dot" style="background:${c.color}"></i><span class="n">${c.icon} ${esc(c.name)}</span><b>${money(v)}</b></div>`; }).join('')}${cats.length > 6 ? `<div class="muted">+${cats.length - 6} outros</div>` : ''}</div></div>`;
  return out;
}

function futureInstallmentsTotal() {
  let t = 0;
  for (const e of db.expenses) {
    if (e.mode !== 'parcelada') continue;
    const k0 = diffMonths(state.ym, ymOf(e.start));
    for (let k = Math.max(0, k0 + 1); k < (e.n || 1); k++) t += installmentValue(e, k);
  }
  return t / 100;
}

function viewDesp() {
  const s = summary(state.ym);
  const used = [...new Set(s.exps.map(x => x.e.cat))];
  if (state.catFilter && !used.includes(state.catFilter)) state.catFilter = null;
  let list = s.exps.filter(x => !state.catFilter || x.e.cat === state.catFilter);
  const tot = list.reduce((a, x) => a + x.value, 0), paid = list.filter(x => x.paid).reduce((a, x) => a + x.value, 0);
  const nPend = list.filter(x => !x.paid).length;
  if (state.despFilter === 'pend') list = list.filter(x => !x.paid);
  if (state.despFilter === 'paid') list = list.filter(x => x.paid);
  let h = `<div class="title">Despesas</div><div class="grid">
    <div class="stat"><div class="lbl">Total do mês</div><div class="val">${money(tot)}</div></div>
    <div class="stat"><div class="lbl">Falta pagar</div><div class="val ${tot - paid > 0 ? 'warn' : 'pos'}">${money(tot - paid)}</div></div></div>
    <div class="seg" style="margin:14px 0 12px">${[['all', 'Todas'], ['pend', `A pagar (${nPend})`], ['paid', 'Pagas']].map(([k, l]) => `<button class="${state.despFilter === k ? 'on' : ''}" data-despf="${k}">${l}</button>`).join('')}</div>`;
  if (used.length > 1) h += `<div class="chips"><button class="chip ${!state.catFilter ? 'on' : ''}" data-cat="">Todos os tipos</button>${used.map(id => `<button class="chip ${state.catFilter === id ? 'on' : ''}" data-cat="${id}">${cat(id).icon} ${esc(cat(id).name)}</button>`).join('')}</div>`;
  h += `<section class="sheet"><h2>${ymLabel(state.ym, true).replace(/^./, c => c.toUpperCase())}</h2>
    ${list.length ? list.map(despRow).join('') : `<div class="empty"><b>💸</b>Nada por aqui em ${ymLabel(state.ym, true)}.</div>`}</section>`;
  return h;
}

function viewRec() {
  const pend = db.receivables.filter(r => !r.received), done = db.receivables.filter(r => r.received);
  const tp = pend.reduce((a, r) => a + (Number(r.amount) || 0), 0), td = done.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const list = (state.recFilter === 'pend' ? pend : done).sort((a, b) => state.recFilter === 'pend' ? (a.due || '9').localeCompare(b.due || '9') : (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  return `<div class="title">A receber</div><div class="grid">
    <div class="stat"><div class="lbl">Para receber</div><div class="val" style="color:var(--blue)">${money(tp)}</div></div>
    <div class="stat"><div class="lbl">Já recebido</div><div class="val pos">${money(td)}</div></div></div>
    <div class="seg" style="margin:14px 0"><button class="${state.recFilter === 'pend' ? 'on' : ''}" data-recf="pend">Pendentes (${pend.length})</button><button class="${state.recFilter === 'done' ? 'on' : ''}" data-recf="done">Recebidos (${done.length})</button></div>
    <section class="sheet"><div class="cols" style="margin-top:0"><span>Quem deve</span><span>Valor</span></div>
    ${list.length ? list.map(recRow).join('') : `<div class="empty"><b>🤝</b>${state.recFilter === 'pend' ? 'Ninguém te deve nada por aqui.' : 'Nenhum recebimento ainda.'}</div>`}</section>`;
}

/* ---------- metas (guardar dinheiro) ---------- */
const goalSaved = g => (g.deposits || []).reduce((a, d) => a + cents(d.amount), 0) / 100;
const goalSavedIn = (g, ym) => (g.deposits || []).filter(d => ymOf(d.date) === ym).reduce((a, d) => a + cents(d.amount), 0) / 100;
const goalDone = g => goalSaved(g) >= Number(g.target) - 0.005;
// mês previsto para concluir, guardando o valor mensal a partir do próximo mês ainda não guardado
function goalEnd(g) {
  const left = Number(g.target) - goalSaved(g);
  if (left <= 0) return null;
  if (!(Number(g.monthly) > 0)) return '';
  let m = g.start > curYM() ? g.start : curYM();
  if (goalSavedIn(g, m) >= Number(g.monthly)) m = addMonths(m, 1);
  return addMonths(m, Math.ceil(left / Number(g.monthly)) - 1);
}
// quanto as metas pedem para guardar em um mês (planejado)
const plannedSavings = ym => (db.goals || []).filter(g => !goalDone(g) && g.start <= ym).reduce((a, g) => a + (Number(g.monthly) || 0), 0);
// média da sobra mensal (entradas − despesas) nos próximos meses
function avgSobra(fromYM, n = 12) {
  let t = 0; for (let i = 0; i < n; i++) t += summary(addMonths(fromYM, i)).sobra;
  return t / n;
}
function savingOptions(target, fromYM) {
  const media = avgSobra(fromYM), menor = Math.min(...Array.from({ length: 12 }, (_, i) => summary(addMonths(fromYM, i)).sobra));
  const opts = [[.2, 'Tranquilo'], [.3, 'Equilibrado'], [.4, 'Acelerado'], [.5, 'Puxado']].map(([p, label]) => {
    const v = Math.max(50, Math.round(media * p / 50) * 50);
    const meses = Math.ceil(target / v);
    return { v, label, pct: Math.round(p * 100), meses, fim: addMonths(fromYM, meses - 1), aperta: v > menor };
  });
  return { media, menor, opts };
}

function goalCard(g) {
  const saved = goalSaved(g), target = Number(g.target) || 0, pct = target ? Math.min(100, saved / target * 100) : 0;
  const end = goalEnd(g), cm = curYM(), inMonth = goalSavedIn(g, cm), started = g.start <= cm;
  let status;
  if (goalDone(g)) status = '<span class="tag ok">🎉 Meta alcançada!</span>';
  else if (!started) status = `<span class="tag">começa em ${ymLabel(g.start, true)}</span>`;
  else if (inMonth >= Number(g.monthly)) status = `<span class="tag ok">✓ ${money(inMonth)} guardado em ${ymLabel(cm)}</span>`;
  else status = `<span class="tag soon">falta guardar ${money(Number(g.monthly) - inMonth)} em ${ymLabel(cm)}</span>`;
  const last = (g.deposits || []).slice(-4).reverse();
  return `<section class="goal" data-edit-goal="${g.id}">
    <div class="goal-top"><div class="goal-ic">${esc(g.icon || '🎯')}</div>
      <div class="mid"><div class="t">${esc(g.name)}</div><div class="sub">${money(Number(g.monthly) || 0)}/mês${end ? ` · conclui em ${ymLabel(end, true)}` : ''}</div></div>
      ${goalDone(g) ? '' : `<button class="pay" data-save-goal="${g.id}">Guardar</button>`}</div>
    <div class="goal-amt"><b>${money(saved)}</b> <span>de ${money(target)}</span></div>
    <div class="goal-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="goal-foot"><span>${pct.toFixed(0)}%</span>${status}</div>
    ${last.length ? `<div class="goal-hist">${last.map(d => `<div><span>${fmtDate(d.date)}${d.note ? ` · ${esc(d.note)}` : ''}</span><b class="${d.amount < 0 ? 'neg-t' : 'pos'}">${d.amount < 0 ? '−' : '+'} ${money(Math.abs(d.amount))}</b></div>`).join('')}</div>` : ''}
  </section>`;
}

function viewMetas() {
  const goals = db.goals || [];
  const total = goals.reduce((a, g) => a + goalSaved(g), 0), plano = plannedSavings(curYM());
  let h = `<div class="title">Metas</div>`;
  if (!goals.length) {
    const s = savingOptions(10000, addMonths(curYM(), 1));
    return h + `<div class="glass"><div class="empty"><b>🐷</b>Junte dinheiro para seus objetivos: viagem, reserva de emergência, carro…<br><br>
      Pelas suas contas, sobram em média <b style="display:inline;font-size:inherit">${money(s.media)}</b> por mês.</div>
      <div class="actions"><button class="btn primary" data-act="newgoal">+ Criar meta</button></div></div>`;
  }
  h += `<div class="grid"><div class="stat"><div class="lbl">Total guardado</div><div class="val pos">${money(total)}</div></div>
    <div class="stat"><div class="lbl">Plano deste mês</div><div class="val">${money(plano)}</div></div></div>`;
  return h + goals.map(goalCard).join('');
}

function goalForm(g) {
  const isNew = !g;
  g = g || { name: '', icon: '✈️', target: '', monthly: '', start: addMonths(curYM(), 1), note: '', deposits: [] };
  let icon = g.icon;
  const ICONS = ['✈️', '🏖️', '🛟', '🚗', '🏠', '🎓', '💍', '🎮', '🐷', '🎯'];
  openModal(`${head(isNew ? 'Nova meta' : 'Editar meta')}
    <label class="f">Para que é?<input name="name" required maxlength="40" placeholder="Ex.: Viagem, Reserva de emergência" value="${esc(g.name)}"></label>
    <div class="f">Ícone<div class="icons">${ICONS.map(i => `<button type="button" data-i="${i}" class="${i === icon ? 'on' : ''}">${i}</button>`).join('')}</div></div>
    <div class="row2">
      <label class="f">Quanto quer juntar (R$)<input name="target" type="number" step="0.01" min="1" inputmode="decimal" required value="${g.target}"></label>
      <label class="f">Começar a guardar em<input name="start" type="month" required value="${g.start}"></label>
    </div>
    <div class="box"><div class="hd">💡 Sugestão pelo que você recebe</div><div id="sugBox"></div></div>
    <label class="f">Quanto guardar por mês (R$)<input name="monthly" type="number" step="0.01" min="1" inputmode="decimal" required value="${g.monthly}"></label>
    <div class="preview" id="goalPrev"></div>
    <label class="f">Observação<input name="note" maxlength="100" value="${esc(g.note || '')}"></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar meta</button></div>
    ${isNew ? '' : '<div class="actions"><button type="button" class="btn danger" data-del>Excluir meta</button></div>'}
  `, () => {
    const f = form;
    const upd = () => {
      const target = Number(f.target.value) || 0, start = f.start.value || curYM(), saved = isNew ? 0 : goalSaved(g);
      const left = Math.max(0, target - saved);
      if (target > 0) {
        const s = savingOptions(left || target, start);
        $('#sugBox', f).innerHTML = `<p class="muted" style="margin:0;color:var(--ink2)">Sobra média de <b>${money(s.media)}</b>/mês (o mês mais apertado sobra ${money(s.menor)}). Toque para escolher:</p>
          <div class="sugs">${s.opts.map(o => `<button type="button" data-v="${o.v}" class="${Number(f.monthly.value) === o.v ? 'on' : ''}"><b>${money(o.v)}</b><span>${o.label} · ${o.pct}% da sobra</span><span>${o.meses} meses → ${ymLabel(o.fim, true)}${o.aperta ? ' ⚠️' : ''}</span></button>`).join('')}</div>
          ${s.opts.some(o => o.aperta) ? '<p class="muted" style="margin:6px 0 0;color:var(--ink2)">⚠️ = maior que a sobra do mês mais apertado</p>' : ''}`;
      } else $('#sugBox', f).innerHTML = '<p class="muted" style="margin:0;color:var(--ink2)">Informe quanto quer juntar.</p>';
      const m = Number(f.monthly.value) || 0;
      if (target > 0 && m > 0) {
        const meses = Math.ceil(left / m);
        $('#goalPrev', f).innerHTML = left ? `Guardando <b>${money(m)}</b>/mês, você junta ${money(left)} em <b>${meses} ${meses > 1 ? 'meses' : 'mês'}</b> — <b>${ymLabel(addMonths(start > curYM() ? start : curYM(), meses - 1), true)}</b>.` : 'Meta já alcançada 🎉';
      } else $('#goalPrev', f).textContent = '';
    };
    $('.icons', f).onclick = ev => { const b = ev.target.closest('button'); if (b) { icon = b.dataset.i; $$('.icons button', f).forEach(x => x.classList.toggle('on', x === b)); } };
    f.addEventListener('click', ev => { const b = ev.target.closest('.sugs button'); if (b) { f.monthly.value = b.dataset.v; upd(); } });
    f.oninput = upd; f.onchange = upd; upd();
    f.onsubmit = ev => {
      ev.preventDefault();
      const data = { name: f.name.value.trim(), icon, target: Number(f.target.value), monthly: Number(f.monthly.value), start: f.start.value, note: f.note.value.trim() };
      if (!(data.target > 0) || !(data.monthly > 0)) return toast('Informe os valores');
      if (isNew) { db.goals = db.goals || []; db.goals.push({ id: uid(), deposits: [], ...data }); }
      else Object.assign(db.goals.find(x => x.id === g.id), data);
      save(); closeModal(); state.tab = 'meta'; render(); toast(isNew ? 'Meta criada 🎯' : 'Meta atualizada');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => { if (!confirm(`Excluir a meta "${g.name}" e todo o histórico (${money(goalSaved(g))} guardados)?`)) return; db.goals = db.goals.filter(x => x.id !== g.id); save(); closeModal(); render(); toast('Meta excluída'); };
  });
}

function depositForm(g) {
  const falta = Math.max(0, (Number(g.monthly) || 0) - goalSavedIn(g, curYM()));
  let kind = 'in';
  openModal(`${head(`${esc(g.icon || '🎯')} ${esc(g.name)}`)}
    <div class="seg" id="segDep"><button type="button" data-k="in" class="on">Guardar</button><button type="button" data-k="out">Retirar</button></div>
    <div class="row2">
      <label class="f">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${falta || g.monthly}"></label>
      <label class="f">Data<input name="date" type="date" required value="${today()}"></label>
    </div>
    <label class="f">Observação<input name="note" maxlength="60" placeholder="Ex.: poupança Nubank"></label>
    <p class="muted" style="margin:0;color:var(--ink2)">Guardado até agora: <b>${money(goalSaved(g))}</b> de ${money(g.target)}</p>
    <div class="actions"><button type="submit" class="btn primary" id="depBtn">Guardar</button></div>
  `, () => {
    const f = form;
    $('#segDep', f).onclick = ev => { const b = ev.target.closest('button'); if (!b) return; kind = b.dataset.k; $$('#segDep button', f).forEach(x => x.classList.toggle('on', x === b)); $('#depBtn', f).textContent = kind === 'in' ? 'Guardar' : 'Retirar'; };
    f.onsubmit = ev => {
      ev.preventDefault();
      const v = Number(f.amount.value);
      if (!(v > 0)) return toast('Informe o valor');
      const obj = db.goals.find(x => x.id === g.id);
      obj.deposits = obj.deposits || [];
      obj.deposits.push({ id: uid(), date: f.date.value || today(), amount: kind === 'in' ? v : -v, note: f.note.value.trim() });
      obj.deposits.sort((a, b) => a.date.localeCompare(b.date));
      save(); closeModal(); render();
      toast(kind === 'in' ? (goalDone(obj) ? 'Meta alcançada! 🎉' : `Guardado ${money(v)} 🐷`) : `Retirado ${money(v)}`);
    };
  });
}

// mês vazio: avisa se há entradas em outro mês (ex.: salário que começa no mês seguinte)
function emptyIncome() {
  for (let i = 1; i <= 12; i++) {
    const m = addMonths(state.ym, i);
    if (incomesIn(m).length) return `<div class="empty"><b>📅</b>Nenhuma entrada em ${ymLabel(state.ym, true)}.<br>Suas entradas começam em <b style="display:inline;font-size:inherit">${ymLabel(m, true)}</b>.
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-goto="${m}">Ver ${ymLabel(m, true)} ›</button></div></div>`;
  }
  return '<div class="empty"><b>💰</b>Cadastre seu salário e outras rendas para o app calcular quanto sobra.</div>';
}

function viewEnt() {
  const s = summary(state.ym);
  const rows = s.incs.map(x => `<div class="row" data-edit-inc="${x.i.id}"><div class="ic">💰</div>
      <div class="mid"><div class="t">${esc(x.i.desc)}</div><div class="sub">${x.i.recurring ? '<span class="tag">mensal</span>' : ''}<span>dia ${fmtDate(x.date).slice(0, 5)}</span></div></div>
      <div class="amt">${money(x.value)} <span class="arrow-dn">↙</span></div></div>`)
    .concat(s.recs.map(r => `<div class="row" data-edit-rec="${r.id}"><div class="ic">🤝</div>
      <div class="mid"><div class="t">${esc(r.desc)}</div><div class="sub"><span class="tag ok">recebido</span>${r.who ? `<span>${esc(r.who)}</span>` : ''}</div></div>
      <div class="amt">${money(r.amount)}</div></div>`));
  return `<div class="title">Entradas</div><div class="grid">
    <div class="stat"><div class="lbl">Renda do mês</div><div class="val pos">${money(s.renda)}</div></div>
    <div class="stat"><div class="lbl">Recebidos no mês</div><div class="val" style="color:var(--blue)">${money(s.recebido)}</div></div></div>
    <section class="sheet" style="margin-top:16px"><h2>${ymLabel(state.ym, true).replace(/^./, c => c.toUpperCase())}</h2>
    ${rows.length ? rows.join('') : emptyIncome()}</section>`;
}

function viewCfg() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const on = db.settings.notify && perm === 'granted';
  const key = sync.chave || sync.pendingKey || (sync.pendingKey = newKey(), saveSync(), sync.pendingKey);
  const gs = syncOn() ? `
    <div class="cfg-row"><span class="n">Status<br><span class="muted" id="syncStatus">${esc(syncLabel())}</span></span>
      <button class="btn sm primary" data-act="gs-sync">↻ Sincronizar</button></div>
    <div class="cfg-row"><span class="n">Chave (use no outro aparelho)<br><span class="muted" style="font-family:monospace;user-select:all">${esc(sync.chave)}</span></span></div>
    <div class="cfg-row"><span class="n">Conectar outro aparelho<br><span class="muted">Copie o link e abra no outro aparelho</span></span>
      <button class="btn sm" data-act="gs-link">🔗 Copiar link</button></div>
    <div class="actions" style="margin-top:8px">${sync.sheetUrl ? `<a class="btn" style="text-align:center;text-decoration:none" href="${esc(sync.sheetUrl)}" target="_blank" rel="noopener">📄 Abrir planilha</a>` : ''}<button class="btn danger" data-act="gs-off">Desconectar</button></div>`
    : `
    <p style="margin:0 0 6px;font-weight:600">Já tem a planilha? Cole o link de conexão:</p>
    <label class="f gsf" style="margin-top:0"><input id="gsLink" placeholder="https://drdiegopadua.github.io/financas/#conectar=…" autocomplete="off"></label>
    <div class="actions" style="margin:10px 0 18px"><button class="btn primary" data-act="gs-paste">Conectar com o link</button></div>
    <p class="muted" style="margin-top:0">Ou crie uma planilha nova (faça uma vez):</p>
    <ol class="steps">
      <li>Crie uma planilha em branco: <a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a> (dê o nome "Minhas Finanças").</li>
      <li>Na planilha: <b>Extensões → Apps Script</b>. Apague o que tiver e cole o código: <button class="btn sm primary" data-act="gs-copy">📋 Copiar código</button></li>
      <li>Salve 💾 e clique <b>Implantar → Nova implantação</b> → ⚙️ <b>App da Web</b>. Executar como: <b>Eu</b> · Quem pode acessar: <b>Qualquer pessoa</b> → <b>Implantar</b> e autorize.</li>
      <li>Copie a <b>URL do app da Web</b> e cole aqui:</li>
    </ol>
    <label class="f gsf">URL do app da Web<input id="gsUrl" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
    <label class="f gsf">Chave (já está no código copiado; em outro aparelho, use a mesma)<input id="gsKey" value="${esc(key)}" autocomplete="off"></label>
    <div class="actions" style="margin-top:10px"><button class="btn primary" data-act="gs-connect">Conectar planilha</button></div>`;
  return `<div class="title">Ajustes</div>
  <h2>📊 Google Planilhas</h2><div class="glass">${gs}</div>
  <h2>🔔 Lembretes de pagamento</h2><div class="glass">
    <div class="cfg-row"><span class="n">Avisar</span><select data-setting="daysBefore">${[[0, 'no dia do vencimento'], [1, '1 dia antes'], [2, '2 dias antes'], [3, '3 dias antes'], [5, '5 dias antes'], [7, '7 dias antes']].map(([v, l]) => `<option value="${v}" ${Number(db.settings.daysBefore) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="cfg-row"><span class="n">Notificações no celular<br><span class="muted">${on ? 'Ativadas ✓' : perm === 'denied' ? 'Bloqueadas nas configurações do navegador' : perm === 'unsupported' ? 'Não suportado aqui — use o calendário' : 'Desativadas'}</span></span>
      ${on ? '<button class="btn sm" data-act="notifyoff">Desativar</button>' : perm !== 'unsupported' && perm !== 'denied' ? '<button class="btn sm primary" data-act="notifyon">Ativar</button>' : ''}</div>
    <div class="cfg-row"><span class="n">Lembretes na agenda<br><span class="muted">Adiciona as contas em aberto (12 meses) com alarme no calendário do celular — funciona mesmo com o app fechado.</span></span>
      <button class="btn sm primary" data-act="ics">📅 Exportar</button></div>
    <p class="muted" style="margin:8px 0 0">No iPhone, as notificações só funcionam com o app instalado na tela de início. O app avisa sempre que é aberto; com o app fechado, o calendário é o jeito mais garantido.</p>
  </div>
  <h2>Tipos de despesa</h2><div class="glass">${db.cats.map(c => `
    <div class="cfg-row"><span class="dot" style="background:${c.color}"></span><span style="font-size:20px">${c.icon}</span><span class="n">${esc(c.name)}</span>
    <button class="btn sm" data-cat-edit="${c.id}">Editar</button></div>`).join('')}
    <div class="actions" style="margin-top:8px"><button class="btn" data-act="newcat">+ Novo tipo</button></div></div>
  <h2>Backup</h2><div class="glass">
    <p class="muted" style="margin-top:0">Seus dados ficam salvos só neste aparelho. Faça backup de vez em quando.</p>
    <div class="actions"><button class="btn primary" data-act="export">⬇ Exportar</button><button class="btn" data-act="import">⬆ Importar</button></div>
    <input type="file" id="importFile" accept="application/json,.json" hidden></div>
  <h2>App</h2><div class="glass">
    ${deferredInstall ? '<div class="actions" style="margin-bottom:10px"><button class="btn primary" data-act="install">📲 Instalar app</button></div>' : ''}
    <p class="muted" style="margin-top:0">${db.expenses.length} despesas · ${db.incomes.length} entradas · ${db.receivables.length} a receber<br>Versão do app: <b>${APP_VERSION}</b></p>
    <div class="actions"><button class="btn danger" data-act="wipe">Apagar todos os dados</button></div></div>`;
}

/* ---------- modal ---------- */
const modal = $('#modal'), form = $('#modalForm');
function openModal(html, onReady) { form.innerHTML = html; form.onsubmit = null; form.oninput = null; modal.showModal(); onReady && onReady(); }
const closeModal = () => modal.close();
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
const head = t => `<div class="mhead"><h3>${t}</h3><button type="button" class="icon-btn" data-close>✕</button></div>`;

function alertsModal() {
  const a = dueAlerts(), r = recAlerts();
  openModal(`${head('🔔 Lembretes')}
    ${a.length ? `<div class="sheet" style="padding:10px 14px;box-shadow:none">${a.map(expRow).join('')}</div>` : '<div class="empty"><b>✅</b>Nenhuma conta vencendo</div>'}
    ${r.length ? `<div class="mhead"><h3 style="font-size:15px">Para cobrar</h3></div><div class="sheet" style="padding:10px 14px;box-shadow:none">${r.map(recRow).join('')}</div>` : ''}
    ${db.settings.notify ? '' : '<div class="actions"><button type="button" class="btn primary" data-act="notifyon">Ativar notificações no celular</button></div>'}`);
}

function expenseForm(e, ym) {
  const isNew = !e;
  e = e || { desc: '', amount: '', cat: db.cats[0]?.id, mode: 'unica', n: 2, start: dateIn(state.ym, new Date().getDate()), note: '', paid: {} };
  let mode = e.mode, selCat = e.cat;
  const occYM = () => isNew ? ymOf(form.start.value || today()) : (ym || ymOf(e.start));
  const pi = isNew ? undefined : paidInfo(e, occYM());
  openModal(`${head(isNew ? 'Nova despesa' : 'Editar despesa')}
    <label class="f">Descrição<input name="desc" required maxlength="80" placeholder="Ex.: Aluguel, Geladeira, Farmácia" value="${esc(e.desc)}"></label>
    <div class="f">Tipo de despesa
      <div class="cats">${db.cats.map(c => `<button type="button" data-c="${c.id}" class="${c.id === selCat ? 'on' : ''}"><span>${c.icon}</span>${esc(c.name)}</button>`).join('')}</div></div>
    <div class="f">Forma de pagamento
      <div class="seg" id="segMode"><button type="button" data-m="unica">À vista / única</button><button type="button" data-m="parcelada">Parcelada</button><button type="button" data-m="fixa">Fixa mensal</button></div></div>
    <div id="parcBox" class="row2">
      <label class="f">Nº de parcelas<input name="n" type="number" min="2" max="120" inputmode="numeric" value="${e.n > 1 ? e.n : 2}"></label>
      <label class="f">O valor é<select name="valueIs"><option value="total">Total da compra</option><option value="parcela">De cada parcela</option></select></label>
    </div>
    <div class="row2">
      <label class="f" id="amtLbl">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required placeholder="0,00" value="${e.amount}"></label>
      <label class="f" id="dateLbl">Data de pagamento<input name="start" type="date" required value="${e.start}"></label>
    </div>
    <div class="preview" id="preview"></div>
    <div class="box"><div class="hd" id="payHd"></div>
      <label class="cb"><input type="checkbox" name="paidNow" ${pi !== undefined ? 'checked' : ''}> Já está paga</label>
      <label class="f" id="paidAtBox">Pago em<input name="paidAt" type="date" value="${pi || today()}"></label>
    </div>
    <label class="f">Observação<textarea name="note" rows="2" maxlength="300">${esc(e.note || '')}</textarea></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : `<div class="actions">${e.mode === 'fixa' && !e.end ? '<button type="button" class="btn" data-end>Encerrar a partir deste mês</button>' : ''}<button type="button" class="btn danger" data-del>Excluir</button></div>`}
  `, () => {
    const f = form;
    const upd = () => {
      $$('#segMode button', f).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      $('#parcBox', f).style.display = mode === 'parcelada' ? '' : 'none';
      $('#amtLbl', f).firstChild.textContent = mode === 'fixa' ? 'Valor mensal (R$)' : mode === 'parcelada' ? (f.valueIs.value === 'total' ? 'Valor total (R$)' : 'Valor da parcela (R$)') : 'Valor (R$)';
      $('#dateLbl', f).firstChild.textContent = mode === 'parcelada' ? 'Pagar 1ª parcela em' : mode === 'fixa' ? 'Pagar todo mês a partir de' : 'Data de pagamento';
      $('#paidAtBox', f).style.display = f.paidNow.checked ? '' : 'none';
      const k = diffMonths(occYM(), ymOf(f.start.value || today()));
      $('#payHd', f).textContent = mode === 'unica' || isNew ? 'Pagamento' : `Pagamento de ${ymLabel(occYM(), true)}${mode === 'parcelada' ? ` (parcela ${k + 1})` : ''}`;
      const v = Number(f.amount.value) || 0, n = Math.max(1, parseInt(f.n.value) || 1);
      let p;
      if (mode === 'parcelada') {
        const total = f.valueIs.value === 'total' ? v : v * n;
        p = `<b>${n}x de ${money(total / n)}</b> = ${money(total)} · última em ${ymLabel(addMonths(ymOf(f.start.value || today()), n - 1), true)}`;
      } else if (mode === 'fixa') p = `Repete todo mês: <b>${money(v)}</b> (${money(v * 12)} por ano)`;
      else p = `Pagamento único de <b>${money(v)}</b>`;
      $('#preview', f).innerHTML = p + `<br>🔔 Aviso ${Number(db.settings.daysBefore) ? `${db.settings.daysBefore} dia(s) antes` : 'no dia'} do pagamento`;
    };
    $('#segMode', f).onclick = ev => { const b = ev.target.closest('button'); if (b) { mode = b.dataset.m; upd(); } };
    $('.cats', f).onclick = ev => { const b = ev.target.closest('button'); if (b) { selCat = b.dataset.c; $$('.cats button', f).forEach(x => x.classList.toggle('on', x === b)); } };
    f.oninput = upd; f.onchange = upd;
    upd();
    f.onsubmit = ev => {
      ev.preventDefault();
      const v = Number(f.amount.value), n = Math.max(2, Math.min(120, parseInt(f.n.value) || 2));
      if (!(v > 0)) return toast('Informe um valor');
      if (!f.start.value) return toast('Informe a data de pagamento');
      const data = { desc: f.desc.value.trim(), cat: selCat, mode, start: f.start.value, note: f.note.value.trim() };
      if (mode === 'parcelada') { data.n = n; data.amount = f.valueIs.value === 'total' ? v : Math.round(v * n * 100) / 100; }
      else { data.n = 1; data.amount = v; }
      let obj;
      if (isNew) { obj = { id: uid(), paid: {}, end: null, created: today(), ...data }; db.expenses.push(obj); }
      else {
        obj = db.expenses.find(x => x.id === e.id);
        Object.assign(obj, data);
        if (mode !== 'fixa') obj.end = null;
        if (mode === 'unica') { const keep = Object.values(obj.paid || {})[0]; obj.paid = keep ? { [ymOf(obj.start)]: keep } : {}; }
      }
      const key = mode === 'unica' ? ymOf(obj.start) : occYM();
      setPaid(obj, key, f.paidNow.checked, f.paidAt.value);
      save(); closeModal(); render(); toast(isNew ? 'Despesa cadastrada' : 'Despesa atualizada');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => {
      if (!confirm(`Excluir "${e.desc}"${e.mode !== 'unica' ? ' e todas as parcelas/meses' : ''}?`)) return;
      db.expenses = db.expenses.filter(x => x.id !== e.id); save(); closeModal(); render(); toast('Despesa excluída');
    };
    const end = $('[data-end]', f);
    if (end) end.onclick = () => {
      const obj = db.expenses.find(x => x.id === e.id), m = addMonths(state.ym, -1);
      obj.end = m < ymOf(obj.start) ? ymOf(obj.start) : m;
      save(); closeModal(); render(); toast(`Encerrada: última em ${ymLabel(obj.end, true)}`);
    };
  });
}

function incomeForm(i) {
  const isNew = !i;
  i = i || { desc: '', amount: '', date: dateIn(state.ym, 5), recurring: true };
  openModal(`${head(isNew ? 'Nova entrada' : 'Editar entrada')}
    <label class="f">Descrição<input name="desc" required maxlength="80" placeholder="Ex.: Salário, Freela" value="${esc(i.desc)}"></label>
    <div class="row2">
      <label class="f">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${i.amount}"></label>
      <label class="f">Data<input name="date" type="date" required value="${i.date}"></label>
    </div>
    <label class="cb"><input type="checkbox" name="recurring" ${i.recurring ? 'checked' : ''}> Repete todo mês (ex.: salário)</label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : `<div class="actions">${i.recurring && !i.end ? '<button type="button" class="btn" data-end>Encerrar a partir deste mês</button>' : ''}<button type="button" class="btn danger" data-del>Excluir</button></div>`}
  `, () => {
    const f = form;
    f.onsubmit = ev => {
      ev.preventDefault();
      const data = { desc: f.desc.value.trim(), amount: Number(f.amount.value), date: f.date.value, recurring: f.recurring.checked };
      if (!(data.amount > 0)) return toast('Informe um valor');
      if (isNew) db.incomes.push({ id: uid(), end: null, ...data }); else Object.assign(db.incomes.find(x => x.id === i.id), data);
      save(); closeModal(); render(); toast('Entrada salva');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => { if (!confirm(`Excluir "${i.desc}"?`)) return; db.incomes = db.incomes.filter(x => x.id !== i.id); save(); closeModal(); render(); };
    const end = $('[data-end]', f);
    if (end) end.onclick = () => { const o = db.incomes.find(x => x.id === i.id), m = addMonths(state.ym, -1); o.end = m < ymOf(o.date) ? ymOf(o.date) : m; save(); closeModal(); render(); toast('Entrada encerrada'); };
  });
}

function recForm(r) {
  const isNew = !r;
  r = r || { desc: '', who: '', amount: '', due: '', received: false, note: '' };
  openModal(`${head(isNew ? 'Dinheiro a receber' : 'Editar a receber')}
    <label class="f">Quem vai pagar<input name="who" maxlength="60" placeholder="Nome da pessoa / empresa" value="${esc(r.who)}"></label>
    <label class="f">Referente a<input name="desc" required maxlength="80" placeholder="Ex.: Empréstimo, Venda do celular" value="${esc(r.desc)}"></label>
    <div class="row2">
      <label class="f">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${r.amount}"></label>
      <label class="f">Previsão<input name="due" type="date" value="${r.due || ''}"></label>
    </div>
    <div class="box"><label class="cb"><input type="checkbox" name="received" ${r.received ? 'checked' : ''}> Já recebi</label>
      <label class="f" id="recAtBox">Recebido em<input name="receivedAt" type="date" value="${r.receivedAt || today()}"></label></div>
    <label class="f">Observação<textarea name="note" rows="2" maxlength="300">${esc(r.note || '')}</textarea></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : '<div class="actions"><button type="button" class="btn danger" data-del>Excluir</button></div>'}
  `, () => {
    const f = form, upd = () => { $('#recAtBox', f).style.display = f.received.checked ? '' : 'none'; };
    f.onchange = upd; upd();
    f.onsubmit = ev => {
      ev.preventDefault();
      const data = { desc: f.desc.value.trim(), who: f.who.value.trim(), amount: Number(f.amount.value), due: f.due.value, note: f.note.value.trim(), received: f.received.checked };
      if (!(data.amount > 0)) return toast('Informe um valor');
      data.receivedAt = data.received ? (f.receivedAt.value || today()) : null;
      if (isNew) db.receivables.push({ id: uid(), ...data }); else Object.assign(db.receivables.find(x => x.id === r.id), data);
      save(); closeModal(); render(); toast('Salvo');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => { if (!confirm(`Excluir "${r.desc}"?`)) return; db.receivables = db.receivables.filter(x => x.id !== r.id); save(); closeModal(); render(); };
  });
}

function catForm(c) {
  const isNew = !c;
  c = c || { name: '', icon: '🏷️', color: '#4f86e8' };
  const inUse = !isNew && db.expenses.some(e => e.cat === c.id);
  openModal(`${head(isNew ? 'Novo tipo de despesa' : 'Editar tipo')}
    <div class="row2">
      <label class="f">Ícone (emoji)<input name="icon" maxlength="4" value="${esc(c.icon)}"></label>
      <label class="f">Cor<input name="color" type="color" value="${c.color}" style="height:46px;padding:4px"></label>
    </div>
    <label class="f">Nome<input name="name" required maxlength="24" value="${esc(c.name)}" placeholder="Ex.: Pets"></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : `<div class="actions"><button type="button" class="btn danger" data-del ${inUse ? 'disabled' : ''}>${inUse ? 'Em uso — não pode excluir' : 'Excluir'}</button></div>`}
  `, () => {
    const f = form;
    f.onsubmit = ev => {
      ev.preventDefault();
      const data = { name: f.name.value.trim(), icon: f.icon.value.trim() || '🏷️', color: f.color.value };
      if (isNew) db.cats.push({ id: uid(), ...data }); else Object.assign(db.cats.find(x => x.id === c.id), data);
      save(); closeModal(); render();
    };
    const del = $('[data-del]', f);
    if (del && !inUse) del.onclick = () => { db.cats = db.cats.filter(x => x.id !== c.id); save(); closeModal(); render(); };
  });
}

function addMenu() {
  openModal(`${head('Adicionar')}
    <div class="sheet" style="padding:6px 14px;box-shadow:none">
      <div class="row" data-new="exp" role="button"><div class="ic">💸</div><div class="mid"><div class="t">Despesa</div><div class="sub">Única, parcelada ou fixa mensal</div></div><span>›</span></div>
      <div class="row" data-new="rec" role="button"><div class="ic">🤝</div><div class="mid"><div class="t">Dinheiro a receber</div><div class="sub">Alguém te deve / valor previsto</div></div><span>›</span></div>
      <div class="row" data-new="inc" role="button"><div class="ic">💰</div><div class="mid"><div class="t">Entrada / renda</div><div class="sub">Salário e outras receitas</div></div><span>›</span></div>
      <div class="row" data-new="goal" role="button"><div class="ic">🐷</div><div class="mid"><div class="t">Meta para guardar dinheiro</div><div class="sub">Viagem, reserva, carro…</div></div><span>›</span></div>
    </div>`);
}

/* ---------- eventos ---------- */
$('.tabbar').onclick = e => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); } };
$('#monthNav').onclick = e => {
  const b = e.target.closest('[data-month]'); if (!b) return;
  const d = Number(b.dataset.month); state.ym = d === 0 ? curYM() : addMonths(state.ym, d); render();
};
$('#bell').onclick = alertsModal;
$('#fab').onclick = () => ({ rec: recForm, ent: incomeForm, desp: () => expenseForm(), meta: () => goalForm() })[state.tab]?.() ?? addMenu();

function handleClick(e) {
  const t = e.target;
  if (t.closest('[data-close]')) return closeModal();
  const pay = t.closest('[data-pay]');
  if (pay) {
    const ex = db.expenses.find(x => x.id === pay.dataset.pay), ym = pay.dataset.ym;
    const on = paidInfo(ex, ym) === undefined;
    setPaid(ex, ym, on);
    save(); render(); if (modal.open && $('.mhead h3', form)?.textContent.includes('Lembretes')) alertsModal();
    toast(on ? `Paga em ${fmtDate(today())} ✓` : 'Pagamento desmarcado'); return;
  }
  const recv = t.closest('[data-recv]');
  if (recv) {
    const r = db.receivables.find(x => x.id === recv.dataset.recv);
    r.received = !r.received; r.receivedAt = r.received ? today() : null;
    save(); render(); if (modal.open && $('.mhead h3', form)?.textContent.includes('Lembretes')) alertsModal();
    toast(r.received ? 'Recebido ✓' : 'Voltou para pendente'); return;
  }
  const nw = t.closest('[data-new]'); if (nw) { closeModal(); return ({ exp: () => expenseForm(), rec: () => recForm(), inc: () => incomeForm(), goal: () => goalForm() })[nw.dataset.new](); }
  const chip = t.closest('[data-cat]'); if (chip) { state.catFilter = chip.dataset.cat || null; return render(); }
  const rf = t.closest('[data-recf]'); if (rf) { state.recFilter = rf.dataset.recf; return render(); }
  const df = t.closest('[data-despf]'); if (df) { state.despFilter = df.dataset.despf; return render(); }
  const gm = t.closest('[data-goto]'); if (gm) { state.ym = gm.dataset.goto; return render(); }
  const go = t.closest('[data-tab-go]'); if (go) { state.tab = go.dataset.tabGo; render(); return window.scrollTo(0, 0); }
  const sg = t.closest('[data-save-goal]'); if (sg) return depositForm(db.goals.find(x => x.id === sg.dataset.saveGoal));
  const eg = t.closest('[data-edit-goal]'); if (eg) return goalForm(db.goals.find(x => x.id === eg.dataset.editGoal));
  const ee = t.closest('[data-edit-exp]'); if (ee) { closeModal(); return expenseForm(db.expenses.find(x => x.id === ee.dataset.editExp), ee.dataset.ym); }
  const er = t.closest('[data-edit-rec]'); if (er) { closeModal(); return recForm(db.receivables.find(x => x.id === er.dataset.editRec)); }
  const ei = t.closest('[data-edit-inc]'); if (ei) return incomeForm(db.incomes.find(x => x.id === ei.dataset.editInc));
  const ce = t.closest('[data-cat-edit]'); if (ce) return catForm(db.cats.find(x => x.id === ce.dataset.catEdit));
  const act = t.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'alerts') alertsModal();
  if (a === 'newexp') expenseForm();
  if (a === 'newcat') catForm();
  if (a === 'newgoal') goalForm();
  if (a === 'notifyon') enableNotifications().then(ok => { if (ok) { closeModal(); render(); } });
  if (a === 'notifyoff') { db.settings.notify = false; save(); render(); toast('Notificações desativadas'); }
  if (a === 'ics') exportICS();
  if (a === 'gs-copy') copyScript();
  if (a === 'gs-connect') connectSheets($('#gsUrl').value, $('#gsKey').value);
  if (a === 'gs-sync') syncNow(true);
  if (a === 'gs-paste') connectFromText($('#gsLink').value);
  if (a === 'gs-link') {
    const l = connectLink();
    navigator.clipboard.writeText(l).then(() => toast('Link copiado ✓'), () => openModal(`${head('Link de conexão')}<label class="f"><textarea rows="4" readonly>${esc(l)}</textarea></label>`));
  }
  if (a === 'gs-off' && confirm('Desconectar da planilha? Os dados continuam na planilha e neste aparelho.')) { sync = {}; saveSync(); render(); toast('Planilha desconectada'); }
  if (a === 'export') download(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), `financas-backup-${today()}.json`);
  if (a === 'import') {
    const inp = $('#importFile');
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await inp.files[0].text());
        if (!Array.isArray(d.expenses)) throw 0;
        if (!confirm('Substituir os dados atuais pelo backup?')) return;
        db = normalize(d); save(); render(); toast('Backup importado');
      } catch (err) { toast('Arquivo inválido'); }
      inp.value = '';
    };
    inp.click();
  }
  if (a === 'wipe' && confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) { db = fresh(); save(); render(); toast('Dados apagados'); }
  if (a === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); }
}
$('#view').addEventListener('click', handleClick);
form.addEventListener('click', handleClick);
$('#view').addEventListener('change', e => {
  const s = e.target.closest('[data-setting]'); if (!s) return;
  db.settings[s.dataset.setting] = Number(s.value); db.notified = {}; save(); render(); toast('Preferência salva');
});

/* ---------- sem zoom com os dedos (o iPhone ignora user-scalable=no) ---------- */
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
// no iPhone a pinça começa no toque com 2 dedos: cancela já no início e durante o movimento
['touchstart', 'touchmove'].forEach(ev => document.addEventListener(ev, e => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false, capture: true }));

/* ---------- PWA ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (state.tab === 'cfg') render(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  // quando chega uma versão nova do app, recarrega uma vez para já usar ela
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller; // na 1ª visita não recarrega
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', ev => { if (ev.data === 'open-alerts') alertsModal(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); notifyDue(); syncNow(); } });
window.addEventListener('online', () => syncNow());
if (location.hash === '#lembretes') setTimeout(alertsModal, 300);

render();
syncReminders();
notifyDue();
const autoConnect = parseConnect(location.hash);
if (autoConnect) {
  history.replaceState(null, '', location.pathname); // tira a chave da barra de endereço
  state.tab = 'cfg'; render();
  connectSheets(autoConnect.u, autoConnect.k);
} else syncNow();
