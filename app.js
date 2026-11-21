/* Minhas Finanças — PWA de controle financeiro pessoal (dados salvos no aparelho) */
'use strict';

const KEY = 'financas.v1';
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

/* ---------- dados ---------- */
function load() {
  const base = { expenses: [], incomes: [], receivables: [], cats: JSON.parse(JSON.stringify(DEFAULT_CATS)) };
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return Object.assign(base, d);
  } catch (e) { /* ignora */ }
  return base;
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Não foi possível salvar'); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = v => brl.format(v || 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cents = v => Math.round((Number(v) || 0) * 100);

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = date => date.slice(0, 7);
const curYM = () => ymOf(today());
function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
function diffMonths(a, b) { // a - b
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}
function dateIn(ym, day) { // mesmo dia em outro mês (ajusta fim de mês)
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${pad(Math.min(day, last))}`;
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_L = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ymLabel = (ym, long) => { const [y, m] = ym.split('-').map(Number); return long ? `${MESES_L[m - 1]} ${y}` : `${MESES[m - 1]}/${String(y).slice(2)}`; };
const fmtDate = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const cat = id => db.cats.find(c => c.id === id) || { id, name: 'Sem categoria', icon: '❔', color: '#64748b' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- regras de negócio ---------- */
// valor de cada parcela (em centavos), sobra do arredondamento vai na última
function installmentValue(e, k) {
  if (e.mode !== 'parcelada') return cents(e.amount);
  const total = cents(e.amount), n = e.n || 1, base = Math.floor(total / n);
  return k === n - 1 ? total - base * (n - 1) : base;
}

// todas as ocorrências de despesas em um mês
function expensesIn(ym) {
  const out = [];
  for (const e of db.expenses) {
    const start = ymOf(e.start), k = diffMonths(ym, start), day = Number(e.start.slice(8, 10));
    let ok = false;
    if (e.mode === 'unica') ok = k === 0;
    else if (e.mode === 'parcelada') ok = k >= 0 && k < (e.n || 1);
    else if (e.mode === 'fixa') ok = k >= 0 && (!e.end || ym <= e.end);
    if (!ok) continue;
    out.push({ e, k, ym, value: installmentValue(e, k) / 100, date: dateIn(ym, day), paid: !!(e.paid && e.paid[ym]) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// entradas (renda) de um mês + valores a receber que foram recebidos no mês
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
  const despesas = sum(exps, x => x.value);
  const pago = sum(exps.filter(x => x.paid), x => x.value);
  const renda = sum(incs, x => x.value);
  const recebido = sum(recs, x => x.amount);
  const entradas = renda + recebido;
  const byCat = {};
  for (const x of exps) byCat[x.e.cat] = (byCat[x.e.cat] || 0) + x.value;
  return { exps, incs, recs, despesas, pago, aPagar: despesas - pago, renda, recebido, entradas, sobra: entradas - despesas, byCat };
}

/* ---------- estado de navegação ---------- */
const state = { tab: 'dash', ym: curYM(), catFilter: null, recFilter: 'pend' };

/* ---------- renderização ---------- */
function render() {
  $('#monthLabel').textContent = ymLabel(state.ym, true);
  $('#monthNav').style.visibility = ['rec', 'cfg'].includes(state.tab) ? 'hidden' : 'visible';
  $('#fab').classList.toggle('hide', state.tab === 'cfg');
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const v = $('#view');
  v.innerHTML = ({ dash: viewDash, desp: viewDesp, rec: viewRec, ent: viewEnt, cfg: viewCfg })[state.tab]();
  window.scrollTo(0, 0);
}

function viewDash() {
  const s = summary(state.ym);
  const pendRec = db.receivables.filter(r => !r.received);
  const totalRec = pendRec.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const lateRec = pendRec.filter(r => r.due && r.due < today());
  const usedPct = s.entradas > 0 ? Math.min(100, s.despesas / s.entradas * 100) : (s.despesas > 0 ? 100 : 0);
  const futureInst = futureInstallmentsTotal();

  let h = `
  <div class="card hero ${s.sobra < 0 ? 'neg' : ''}">
    <div class="lbl">${s.sobra < 0 ? 'Faltando' : 'Sobrando'} em ${ymLabel(state.ym, true)}</div>
    <div class="big">${money(Math.abs(s.sobra))}</div>
    <div class="row"><span>⬆ Entradas ${money(s.entradas)}</span><span>⬇ Despesas ${money(s.despesas)}</span></div>
    <div class="bar"><i style="width:${usedPct.toFixed(1)}%"></i></div>
    <div class="row" style="margin-top:6px"><span>${usedPct.toFixed(0)}% da renda comprometida</span></div>
  </div>
  <div class="grid">
    <div class="stat"><div class="lbl">Já pago</div><div class="val pos">${money(s.pago)}</div></div>
    <div class="stat"><div class="lbl">Falta pagar</div><div class="val ${s.aPagar > 0 ? 'warn' : ''}">${money(s.aPagar)}</div></div>
    <div class="stat"><div class="lbl">A receber (total)</div><div class="val" style="color:var(--blue)">${money(totalRec)}</div>${lateRec.length ? `<div class="muted" style="color:var(--red)">${lateRec.length} atrasado(s)</div>` : `<div class="muted">${pendRec.length} pendente(s)</div>`}</div>
    <div class="stat"><div class="lbl">Parcelas futuras</div><div class="val">${money(futureInst)}</div><div class="muted">após este mês</div></div>
  </div>`;

  h += `<h2>Gastos por tipo</h2>`;
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  if (!cats.length) h += `<div class="empty"><b>🧾</b>Nenhuma despesa neste mês</div>`;
  else h += `<div class="card donut-wrap">${donut(cats, s.despesas)}<div class="legend">${cats.slice(0, 7).map(([id, v]) => { const c = cat(id); return `<div><i class="dot" style="background:${c.color}"></i><span class="n">${c.icon} ${esc(c.name)}</span><b>${money(v)}</b></div>`; }).join('')}${cats.length > 7 ? `<div class="muted">+${cats.length - 7} outros</div>` : ''}</div></div>`;

  h += `<h2>Próximos 6 meses</h2><div class="card">${projection()}</div>`;

  const pend = s.exps.filter(x => !x.paid);
  h += `<h2>Contas a pagar em ${ymLabel(state.ym)}</h2>`;
  h += pend.length ? `<div class="list">${pend.slice(0, 6).map(expItem).join('')}</div>${pend.length > 6 ? `<p class="muted" style="text-align:center">+${pend.length - 6} na aba Despesas</p>` : ''}`
    : `<div class="empty"><b>✅</b>Tudo pago neste mês</div>`;

  if (pendRec.length) {
    h += `<h2>Próximos recebimentos</h2><div class="list">${pendRec.sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 4).map(recItem).join('')}</div>`;
  }
  return h;
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

function donut(cats, total) {
  const r = 52, c = 2 * Math.PI * r; let off = 0;
  const segs = cats.map(([id, v]) => {
    const len = total ? v / total * c : 0;
    const s = `<circle r="${r}" cx="65" cy="65" fill="none" stroke="${cat(id).color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 65 65)"/>`;
    off += len; return s;
  }).join('');
  return `<svg viewBox="0 0 130 130" width="130" height="130" role="img" aria-label="Gastos por categoria">${segs}
    <text x="65" y="61" text-anchor="middle" fill="#8a9aab" font-size="10">Total</text>
    <text x="65" y="77" text-anchor="middle" fill="#e8eef4" font-size="13" font-weight="700">${money(total).replace('R$', '').trim()}</text></svg>`;
}

function projection() {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(state.ym, i));
  const data = months.map(m => { const s = summary(m); return { m, in: s.entradas, out: s.despesas, sobra: s.sobra }; });
  const max = Math.max(1, ...data.map(d => Math.max(d.in, d.out)));
  return `<div class="proj">${data.map((d, i) => `
    <div class="col ${i === 0 ? 'cur' : ''}">
      <div class="s ${d.sobra < 0 ? 'neg-t' : 'pos'}">${compact(d.sobra)}</div>
      <div class="bars"><i style="height:${d.in / max * 100}%;background:var(--green)"></i><i style="height:${d.out / max * 100}%;background:var(--red)"></i></div>
      <div class="m">${ymLabel(d.m)}</div>
    </div>`).join('')}</div>
    <div class="keys"><span><i class="dot" style="background:var(--green)"></i>Entradas</span><span><i class="dot" style="background:var(--red)"></i>Despesas</span><span>Topo: sobra</span></div>`;
}
function compact(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1000) return `${s}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return `${s}${Math.round(a)}`;
}

function expItem(x) {
  const c = cat(x.e.cat), late = !x.paid && x.date < today();
  const kind = x.e.mode === 'parcelada' ? `<span class="tag">${x.k + 1}/${x.e.n}</span>` : x.e.mode === 'fixa' ? '<span class="tag">fixa</span>' : '';
  return `<div class="item ${x.paid ? 'done' : ''}" data-edit-exp="${x.e.id}">
    <div class="ic" style="background:${c.color}22">${c.icon}</div>
    <div class="mid"><div class="t">${esc(x.e.desc)}</div>
      <div class="sub"><span>${esc(c.name)}</span>${kind}<span class="${late ? 'tag late' : ''}">${late ? 'venceu ' : 'vence '}${fmtDate(x.date).slice(0, 5)}</span></div></div>
    <div class="amt">${money(x.value)}</div>
    <button class="check ${x.paid ? 'on' : ''}" data-pay="${x.e.id}" data-ym="${x.ym}" aria-label="Marcar como pago">✓</button>
  </div>`;
}

function viewDesp() {
  const s = summary(state.ym);
  const used = [...new Set(s.exps.map(x => x.e.cat))];
  if (state.catFilter && !used.includes(state.catFilter)) state.catFilter = null;
  const list = s.exps.filter(x => !state.catFilter || x.e.cat === state.catFilter);
  const tot = list.reduce((a, x) => a + x.value, 0), paid = list.filter(x => x.paid).reduce((a, x) => a + x.value, 0);
  let h = `<div class="grid" style="margin-top:0">
    <div class="stat"><div class="lbl">Total do mês</div><div class="val">${money(tot)}</div></div>
    <div class="stat"><div class="lbl">Falta pagar</div><div class="val ${tot - paid > 0 ? 'warn' : 'pos'}">${money(tot - paid)}</div></div></div>`;
  if (used.length > 1) h += `<h2>Filtrar por tipo</h2><div class="chips"><button class="chip ${!state.catFilter ? 'on' : ''}" data-cat="">Todas</button>${used.map(id => `<button class="chip ${state.catFilter === id ? 'on' : ''}" data-cat="${id}">${cat(id).icon} ${esc(cat(id).name)}</button>`).join('')}</div>`;
  else h += '<h2>Despesas do mês</h2>';
  h += list.length ? `<div class="list">${list.map(expItem).join('')}</div>` : `<div class="empty"><b>💸</b>Nenhuma despesa em ${ymLabel(state.ym, true)}.<br>Toque em <b style="display:inline;font-size:inherit">+</b> para cadastrar.</div>`;
  return h;
}

function recItem(r) {
  const late = !r.received && r.due && r.due < today();
  return `<div class="item ${r.received ? 'done' : ''}" data-edit-rec="${r.id}">
    <div class="ic" style="background:#60a5fa22">🤝</div>
    <div class="mid"><div class="t">${esc(r.desc)}</div>
      <div class="sub">${r.who ? `<span>${esc(r.who)}</span>` : ''}${r.received ? `<span class="tag ok">recebido ${fmtDate(r.receivedAt)}</span>` : r.due ? `<span class="${late ? 'tag late' : ''}">${late ? 'atrasado · ' : 'previsto '}${fmtDate(r.due)}</span>` : '<span>sem data</span>'}</div></div>
    <div class="amt" style="color:var(--blue)">${money(r.amount)}</div>
    <button class="check ${r.received ? 'on' : ''}" data-recv="${r.id}" aria-label="Marcar como recebido">✓</button>
  </div>`;
}

function viewRec() {
  const pend = db.receivables.filter(r => !r.received), done = db.receivables.filter(r => r.received);
  const tp = pend.reduce((a, r) => a + (Number(r.amount) || 0), 0), td = done.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const list = (state.recFilter === 'pend' ? pend : done).sort((a, b) => state.recFilter === 'pend' ? (a.due || '9').localeCompare(b.due || '9') : (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  let h = `<div class="grid" style="margin-top:0">
    <div class="stat"><div class="lbl">Para receber</div><div class="val" style="color:var(--blue)">${money(tp)}</div></div>
    <div class="stat"><div class="lbl">Já recebido</div><div class="val pos">${money(td)}</div></div></div>
    <h2>Dinheiro a receber</h2>
    <div class="seg" style="margin-bottom:10px"><button class="${state.recFilter === 'pend' ? 'on' : ''}" data-recf="pend">Pendentes (${pend.length})</button><button class="${state.recFilter === 'done' ? 'on' : ''}" data-recf="done">Recebidos (${done.length})</button></div>`;
  h += list.length ? `<div class="list">${list.map(recItem).join('')}</div>` : `<div class="empty"><b>🤝</b>${state.recFilter === 'pend' ? 'Ninguém te deve nada por aqui.<br>Toque em + para cadastrar um valor a receber.' : 'Nenhum recebimento ainda.'}</div>`;
  return h;
}

function viewEnt() {
  const s = summary(state.ym);
  let h = `<div class="grid" style="margin-top:0">
    <div class="stat"><div class="lbl">Renda do mês</div><div class="val pos">${money(s.renda)}</div></div>
    <div class="stat"><div class="lbl">Recebidos no mês</div><div class="val" style="color:var(--blue)">${money(s.recebido)}</div></div></div>
    <h2>Entradas de ${ymLabel(state.ym, true)}</h2>`;
  const items = s.incs.map(x => `<div class="item" data-edit-inc="${x.i.id}">
      <div class="ic" style="background:#22c55e22">💰</div>
      <div class="mid"><div class="t">${esc(x.i.desc)}</div><div class="sub">${x.i.recurring ? '<span class="tag">mensal</span>' : ''}<span>dia ${fmtDate(x.date).slice(0, 5)}</span></div></div>
      <div class="amt pos">${money(x.value)}</div></div>`)
    .concat(s.recs.map(r => `<div class="item" data-edit-rec="${r.id}">
      <div class="ic" style="background:#60a5fa22">🤝</div>
      <div class="mid"><div class="t">${esc(r.desc)}</div><div class="sub"><span class="tag ok">valor recebido</span>${r.who ? `<span>${esc(r.who)}</span>` : ''}</div></div>
      <div class="amt" style="color:var(--blue)">${money(r.amount)}</div></div>`));
  h += items.length ? `<div class="list">${items.join('')}</div>` : `<div class="empty"><b>💰</b>Cadastre seu salário e outras rendas<br>para o app calcular quanto sobra.</div>`;
  return h;
}

function viewCfg() {
  return `<h2>Tipos de despesa</h2><div class="card">${db.cats.map(c => `
    <div class="cfg-row"><span class="dot" style="background:${c.color}"></span><span style="font-size:20px">${c.icon}</span><span class="n">${esc(c.name)}</span>
    <button class="btn sm" data-cat-edit="${c.id}">Editar</button></div>`).join('')}
    <div class="actions"><button class="btn" data-act="newcat">+ Novo tipo</button></div></div>
  <h2>Backup</h2><div class="card">
    <p class="muted" style="margin-top:0">Seus dados ficam salvos só neste aparelho. Faça backup de vez em quando para não perder nada.</p>
    <div class="actions"><button class="btn primary" data-act="export">⬇ Exportar</button><button class="btn" data-act="import">⬆ Importar</button></div>
    <input type="file" id="importFile" accept="application/json,.json" hidden></div>
  <h2>App</h2><div class="card">
    <div class="actions" id="installBox" ${deferredInstall ? '' : 'hidden'}><button class="btn primary" data-act="install">📲 Instalar app</button></div>
    <p class="muted">${db.expenses.length} despesas · ${db.incomes.length} entradas · ${db.receivables.length} valores a receber</p>
    <div class="actions"><button class="btn danger" data-act="wipe">Apagar todos os dados</button></div></div>`;
}

/* ---------- formulários (modal) ---------- */
const modal = $('#modal'), form = $('#modalForm');
function openModal(html, onReady) {
  form.innerHTML = html;
  modal.showModal();
  onReady && onReady();
}
const closeModal = () => modal.close();
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

function expenseForm(e) {
  const isNew = !e;
  e = e || { desc: '', amount: '', cat: db.cats[0]?.id, mode: 'unica', n: 2, start: dateIn(state.ym, new Date().getDate()), note: '', paid: {} };
  let mode = e.mode, valueIs = 'total', selCat = e.cat;
  openModal(`
    <div class="mhead"><h3>${isNew ? 'Nova despesa' : 'Editar despesa'}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
    <label class="f">Descrição<input name="desc" required maxlength="80" placeholder="Ex.: Aluguel, Geladeira, Farmácia" value="${esc(e.desc)}"></label>
    <div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)">Tipo de despesa
      <div class="cats">${db.cats.map(c => `<button type="button" data-c="${c.id}" class="${c.id === selCat ? 'on' : ''}"><span>${c.icon}</span>${esc(c.name)}</button>`).join('')}</div></div>
    <div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)">Forma de pagamento
      <div class="seg" id="segMode"><button type="button" data-m="unica">À vista / única</button><button type="button" data-m="parcelada">Parcelada</button><button type="button" data-m="fixa">Fixa mensal</button></div></div>
    <div id="parcBox" class="row2">
      <label class="f">Nº de parcelas<input name="n" type="number" min="2" max="120" inputmode="numeric" value="${e.n || 2}"></label>
      <label class="f">O valor é<select name="valueIs"><option value="total">Total da compra</option><option value="parcela">De cada parcela</option></select></label>
    </div>
    <div class="row2">
      <label class="f" id="amtLbl">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required placeholder="0,00" value="${e.amount}"></label>
      <label class="f" id="dateLbl">Vencimento<input name="start" type="date" required value="${e.start}"></label>
    </div>
    <div class="preview" id="preview"></div>
    <label class="cb" id="paidBox"><input type="checkbox" name="paidNow" ${isNew ? '' : (e.paid && e.paid[ymOf(e.start)] ? 'checked' : '')}> Já está paga</label>
    <label class="f">Observação<textarea name="note" rows="2" maxlength="300">${esc(e.note || '')}</textarea></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : `<div class="actions">${e.mode === 'fixa' && !e.end ? '<button type="button" class="btn" data-end>Encerrar a partir deste mês</button>' : ''}<button type="button" class="btn danger" data-del>Excluir</button></div>`}
  `, () => {
    const f = form;
    const upd = () => {
      $$('#segMode button', f).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      $('#parcBox', f).style.display = mode === 'parcelada' ? '' : 'none';
      $('#paidBox', f).style.display = mode === 'unica' ? '' : 'none';
      $('#amtLbl', f).firstChild.textContent = mode === 'fixa' ? 'Valor mensal (R$)' : mode === 'parcelada' ? (f.valueIs.value === 'total' ? 'Valor total (R$)' : 'Valor da parcela (R$)') : 'Valor (R$)';
      $('#dateLbl', f).firstChild.textContent = mode === 'parcelada' ? '1ª parcela vence em' : mode === 'fixa' ? 'Começa em (dia do venc.)' : 'Vencimento';
      const v = Number(f.amount.value) || 0, n = Math.max(1, parseInt(f.n.value) || 1);
      let p = '';
      if (mode === 'parcelada') {
        const total = f.valueIs.value === 'total' ? v : v * n;
        const end = addMonths(ymOf(f.start.value || today()), n - 1);
        p = `<b>${n}x de ${money(total / n)}</b> = ${money(total)} · última em ${ymLabel(end, true)}`;
      } else if (mode === 'fixa') p = `Repete todo mês: <b>${money(v)}</b> (${money(v * 12)} por ano)`;
      else p = `Pagamento único de <b>${money(v)}</b>`;
      $('#preview', f).innerHTML = p;
    };
    $('#segMode', f).onclick = ev => { const b = ev.target.closest('button'); if (b) { mode = b.dataset.m; upd(); } };
    $('.cats', f).onclick = ev => { const b = ev.target.closest('button'); if (b) { selCat = b.dataset.c; $$('.cats button', f).forEach(x => x.classList.toggle('on', x === b)); } };
    f.oninput = upd;
    upd();
    f.onsubmit = ev => {
      ev.preventDefault();
      const v = Number(f.amount.value), n = Math.max(2, Math.min(120, parseInt(f.n.value) || 2));
      if (!(v > 0)) return toast('Informe um valor');
      if (!f.start.value) return toast('Informe a data');
      const data = { desc: f.desc.value.trim(), cat: selCat, mode, start: f.start.value, note: f.note.value.trim() };
      if (mode === 'parcelada') { data.n = n; data.amount = f.valueIs.value === 'total' ? v : Math.round(v * n * 100) / 100; }
      else { data.n = 1; data.amount = v; }
      if (isNew) {
        const obj = { id: uid(), paid: {}, end: null, created: today(), ...data };
        if (mode === 'unica' && f.paidNow.checked) obj.paid[ymOf(obj.start)] = true;
        db.expenses.push(obj);
      } else {
        const obj = db.expenses.find(x => x.id === e.id);
        Object.assign(obj, data);
        if (mode === 'unica') obj.paid = f.paidNow.checked ? { [ymOf(obj.start)]: true } : {};
        if (mode !== 'fixa') obj.end = null;
      }
      save(); closeModal(); render(); toast(isNew ? 'Despesa cadastrada' : 'Despesa atualizada');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => {
      if (!confirm(`Excluir "${e.desc}"${e.mode !== 'unica' ? ' e todas as parcelas/meses' : ''}?`)) return;
      db.expenses = db.expenses.filter(x => x.id !== e.id); save(); closeModal(); render(); toast('Despesa excluída');
    };
    const end = $('[data-end]', f);
    if (end) end.onclick = () => {
      const obj = db.expenses.find(x => x.id === e.id);
      obj.end = addMonths(state.ym, -1) < ymOf(obj.start) ? ymOf(obj.start) : addMonths(state.ym, -1);
      save(); closeModal(); render(); toast(`Encerrada: última em ${ymLabel(obj.end, true)}`);
    };
  });
}

function incomeForm(i) {
  const isNew = !i;
  i = i || { desc: '', amount: '', date: dateIn(state.ym, 5), recurring: true };
  openModal(`
    <div class="mhead"><h3>${isNew ? 'Nova entrada' : 'Editar entrada'}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
    <label class="f">Descrição<input name="desc" required maxlength="80" placeholder="Ex.: Salário, Freela, Aluguel recebido" value="${esc(i.desc)}"></label>
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
      if (isNew) db.incomes.push({ id: uid(), end: null, ...data });
      else Object.assign(db.incomes.find(x => x.id === i.id), data);
      save(); closeModal(); render(); toast('Entrada salva');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => { if (!confirm(`Excluir "${i.desc}"?`)) return; db.incomes = db.incomes.filter(x => x.id !== i.id); save(); closeModal(); render(); };
    const end = $('[data-end]', f);
    if (end) end.onclick = () => { const o = db.incomes.find(x => x.id === i.id); const m = addMonths(state.ym, -1); o.end = m < ymOf(o.date) ? ymOf(o.date) : m; save(); closeModal(); render(); toast('Entrada encerrada'); };
  });
}

function recForm(r) {
  const isNew = !r;
  r = r || { desc: '', who: '', amount: '', due: '', received: false, note: '' };
  openModal(`
    <div class="mhead"><h3>${isNew ? 'Dinheiro a receber' : 'Editar a receber'}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
    <label class="f">Descrição<input name="desc" required maxlength="80" placeholder="Ex.: Empréstimo, Venda do celular" value="${esc(r.desc)}"></label>
    <label class="f">Quem vai pagar<input name="who" maxlength="60" placeholder="Nome da pessoa / empresa" value="${esc(r.who)}"></label>
    <div class="row2">
      <label class="f">Valor (R$)<input name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${r.amount}"></label>
      <label class="f">Previsão<input name="due" type="date" value="${r.due || ''}"></label>
    </div>
    <label class="cb"><input type="checkbox" name="received" ${r.received ? 'checked' : ''}> Já recebi</label>
    <label class="f">Observação<textarea name="note" rows="2" maxlength="300">${esc(r.note || '')}</textarea></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : '<div class="actions"><button type="button" class="btn danger" data-del>Excluir</button></div>'}
  `, () => {
    const f = form;
    f.onsubmit = ev => {
      ev.preventDefault();
      const data = { desc: f.desc.value.trim(), who: f.who.value.trim(), amount: Number(f.amount.value), due: f.due.value, note: f.note.value.trim(), received: f.received.checked };
      if (!(data.amount > 0)) return toast('Informe um valor');
      data.receivedAt = data.received ? (r.receivedAt || today()) : null;
      if (isNew) db.receivables.push({ id: uid(), ...data });
      else Object.assign(db.receivables.find(x => x.id === r.id), data);
      save(); closeModal(); render(); toast('Salvo');
    };
    const del = $('[data-del]', f);
    if (del) del.onclick = () => { if (!confirm(`Excluir "${r.desc}"?`)) return; db.receivables = db.receivables.filter(x => x.id !== r.id); save(); closeModal(); render(); };
  });
}

function catForm(c) {
  const isNew = !c;
  c = c || { name: '', icon: '🏷️', color: '#22c55e' };
  const inUse = !isNew && db.expenses.some(e => e.cat === c.id);
  openModal(`
    <div class="mhead"><h3>${isNew ? 'Novo tipo de despesa' : 'Editar tipo'}</h3><button type="button" class="icon-btn" data-close>✕</button></div>
    <div class="row2">
      <label class="f">Ícone (emoji)<input name="icon" maxlength="4" value="${esc(c.icon)}"></label>
      <label class="f">Cor<input name="color" type="color" value="${c.color}" style="height:46px;padding:4px"></label>
    </div>
    <label class="f">Nome<input name="name" required maxlength="24" value="${esc(c.name)}" placeholder="Ex.: Pets"></label>
    <div class="actions"><button type="submit" class="btn primary">Salvar</button></div>
    ${isNew ? '' : `<div class="actions"><button type="button" class="btn danger" data-del ${inUse ? 'disabled title="Em uso"' : ''}>${inUse ? 'Em uso — não pode excluir' : 'Excluir'}</button></div>`}
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

/* ---------- eventos ---------- */
form.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

$('.tabbar').onclick = e => { const b = e.target.closest('button'); if (b) { state.tab = b.dataset.tab; render(); } };
$('#monthNav').onclick = e => {
  const b = e.target.closest('[data-month]'); if (!b) return;
  const d = Number(b.dataset.month); state.ym = d === 0 ? curYM() : addMonths(state.ym, d); render();
};
$('#fab').onclick = () => {
  if (state.tab === 'rec') return recForm();
  if (state.tab === 'ent') return incomeForm();
  if (state.tab === 'desp') return expenseForm();
  openModal(`<div class="mhead"><h3>Adicionar</h3><button type="button" class="icon-btn" data-close>✕</button></div>
    <div class="list">
      <button type="button" class="item" data-new="exp"><div class="ic" style="background:#f8717122">💸</div><div class="mid"><div class="t">Despesa</div><div class="sub">Única, parcelada ou fixa mensal</div></div></button>
      <button type="button" class="item" data-new="rec"><div class="ic" style="background:#60a5fa22">🤝</div><div class="mid"><div class="t">Dinheiro a receber</div><div class="sub">Alguém te deve / valor previsto</div></div></button>
      <button type="button" class="item" data-new="inc"><div class="ic" style="background:#22c55e22">💰</div><div class="mid"><div class="t">Entrada / renda</div><div class="sub">Salário e outras receitas</div></div></button>
    </div>`, () => {
    form.querySelector('.list').onclick = ev => {
      const b = ev.target.closest('[data-new]'); if (!b) return;
      closeModal(); ({ exp: expenseForm, rec: recForm, inc: incomeForm })[b.dataset.new]();
    };
  });
};

$('#view').addEventListener('click', e => {
  const t = e.target;
  const pay = t.closest('[data-pay]');
  if (pay) {
    const ex = db.expenses.find(x => x.id === pay.dataset.pay), ym = pay.dataset.ym;
    ex.paid = ex.paid || {};
    if (ex.paid[ym]) delete ex.paid[ym]; else ex.paid[ym] = true;
    save(); render(); toast(ex.paid[ym] ? 'Marcada como paga ✓' : 'Desmarcada'); return;
  }
  const recv = t.closest('[data-recv]');
  if (recv) {
    const r = db.receivables.find(x => x.id === recv.dataset.recv);
    r.received = !r.received; r.receivedAt = r.received ? today() : null;
    save(); render(); toast(r.received ? 'Recebido ✓' : 'Voltou para pendente'); return;
  }
  const chip = t.closest('[data-cat]'); if (chip) { state.catFilter = chip.dataset.cat || null; render(); return; }
  const rf = t.closest('[data-recf]'); if (rf) { state.recFilter = rf.dataset.recf; render(); return; }
  const ee = t.closest('[data-edit-exp]'); if (ee) return expenseForm(db.expenses.find(x => x.id === ee.dataset.editExp));
  const er = t.closest('[data-edit-rec]'); if (er) return recForm(db.receivables.find(x => x.id === er.dataset.editRec));
  const ei = t.closest('[data-edit-inc]'); if (ei) return incomeForm(db.incomes.find(x => x.id === ei.dataset.editInc));
  const ce = t.closest('[data-cat-edit]'); if (ce) return catForm(db.cats.find(x => x.id === ce.dataset.catEdit));
  const act = t.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'newcat') catForm();
  if (a === 'export') {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `financas-backup-${today()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  if (a === 'import') {
    const inp = $('#importFile');
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await inp.files[0].text());
        if (!Array.isArray(d.expenses)) throw 0;
        if (!confirm('Substituir os dados atuais pelo backup?')) return;
        db = Object.assign({ expenses: [], incomes: [], receivables: [], cats: DEFAULT_CATS }, d); save(); render(); toast('Backup importado');
      } catch (err) { toast('Arquivo inválido'); }
      inp.value = '';
    };
    inp.click();
  }
  if (a === 'wipe' && confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) {
    db = { expenses: [], incomes: [], receivables: [], cats: JSON.parse(JSON.stringify(DEFAULT_CATS)) }; save(); render(); toast('Dados apagados');
  }
  if (a === 'install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); }
});

/* ---------- PWA ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (state.tab === 'cfg') render(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
