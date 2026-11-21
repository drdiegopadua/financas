/**
 * Minhas Finanças — banco de dados no Google Planilhas
 *
 * Como usar:
 * 1. Na sua planilha: Extensões → Apps Script. Apague o que tiver e cole este código.
 * 2. Salve (ícone de disquete).
 * 3. Implantar → Nova implantação → engrenagem → "App da Web".
 *    Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa  → Implantar → Autorizar.
 * 4. Copie a URL do app da Web e cole no app (Ajustes → Google Planilhas).
 *
 * A CHAVE abaixo protege seus dados: só quem tem a URL + a chave consegue ler ou gravar.
 */
const CHAVE = '__CHAVE__';

const ABAS = {
  Despesas: ['id', 'descricao', 'tipo', 'tipo_id', 'forma', 'valor', 'parcelas', 'data', 'fim', 'pagamentos', 'obs', 'criado'],
  Entradas: ['id', 'descricao', 'valor', 'data', 'mensal', 'fim'],
  AReceber: ['id', 'quem', 'descricao', 'valor', 'previsao', 'recebido', 'recebido_em', 'obs'],
  Tipos: ['id', 'nome', 'icone', 'cor'],
  Config: ['chave', 'valor'],
};

function doGet() {
  return resposta({ ok: true, app: 'Minhas Finanças', msg: 'Script funcionando. Cole esta URL no app.' });
}

// o app sempre usa POST: { chave, acao: 'ler' | 'gravar', dados }
function doPost(e) {
  let corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return resposta({ erro: 'JSON inválido' }); }
  if (corpo.chave !== CHAVE) return resposta({ erro: 'Chave inválida' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (corpo.acao === 'gravar') gravarTudo(corpo.dados || {});
    return resposta({ ok: true, dados: lerTudo(), planilha: SpreadsheetApp.getActive().getUrl() });
  } finally {
    lock.releaseLock();
  }
}

function aba(nome) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    const cab = ABAS[nome];
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1e3a63').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function lerTudo() {
  const out = {};
  const tz = Session.getScriptTimeZone();
  Object.keys(ABAS).forEach(nome => {
    const sh = aba(nome), cab = ABAS[nome], n = sh.getLastRow() - 1;
    if (n < 1) { out[nome] = []; return; }
    const vals = sh.getRange(2, 1, n, cab.length).getValues();
    out[nome] = vals.filter(l => l.some(v => v !== '')).map(l => {
      const o = {};
      cab.forEach((c, i) => {
        let v = l[i];
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        o[c] = v;
      });
      return o;
    });
  });
  return out;
}

function gravarTudo(dados) {
  Object.keys(ABAS).forEach(nome => {
    if (!dados[nome]) return;
    const sh = aba(nome), cab = ABAS[nome], linhas = dados[nome];
    const n = Math.max(sh.getLastRow() - 1, 0);
    if (n) sh.getRange(2, 1, n, cab.length).clearContent();
    if (!linhas.length) return;
    // datas e textos como texto puro (evita o Sheets converter "2026-11" em data)
    cab.forEach((c, i) => {
      sh.getRange(2, i + 1, linhas.length, 1).setNumberFormat(c === 'valor' ? '#,##0.00' : c === 'parcelas' ? '0' : '@');
    });
    sh.getRange(2, 1, linhas.length, cab.length).setValues(linhas.map(o => cab.map(c => (o[c] === undefined || o[c] === null) ? '' : o[c])));
  });
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
