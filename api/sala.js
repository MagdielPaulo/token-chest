'use strict';
// Contador do squad com partidas isoladas.
// Guarda o estado ao vivo num hash do Redis (Upstash) e o histórico de partidas fechadas numa lista.
//
// GET  /api/sala?id=CODIGO           -> estado ao vivo (pequeno)
// GET  /api/sala?id=CODIGO&hist=1    -> últimas 60 partidas fechadas
// POST /api/sala {id, acao, jogador, tipo, th}
//   acao: bau | desfazer | abrir | fechar | token | zerar
//
// Campos do hash:
//   v                 versão (sobe a cada mudança)
//   partida, aberta   número da partida atual e se está aberta ('1' / '0')
//   m{k}:inicio, m{k}:ult, m{k}:baus, m{k}:th, m{k}:p:{nome}, m{k}:tipo:{tipo}   partida aberta
//   t:baus, t:th, t:p:{nome}, t:tipo:{tipo}       totais da caçada (todos os baús)
//   t:fechadas, t:tempo, t:bf                     partidas fechadas, tempo somado (ms), baús nelas
//   rs, rs:k                                      recorde do squad numa partida
//   t:jog:{nome}, t:pf:{nome}, t:rec:{nome}, t:mvp:{nome}   por jogador: partidas, baús em partidas fechadas, recorde, MVPs
//   u:{nome}, ult, ultima, achou                  desfazer, último evento, resumo da última partida, token achado

const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24 * 60; // a sala é apagada depois de 60 dias sem uso
const TIPOS = ['normal', 'raro', 'enterrado', 'sprite'];
const AUTO_FECHAR_MS = 40 * 60 * 1000; // partida sem baú há 40 min é fechada sozinha no próximo baú

async function redis(cmds) {
  const r = await fetch(BASE.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis http ' + r.status);
  const out = await r.json();
  out.forEach((x) => { if (x && x.error) throw new Error('redis ' + x.error); });
  return out.map((x) => x.result);
}

const paraObj = (arr) => {
  const o = {};
  for (let i = 0; i + 1 < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};
const salaOk = (s) => /^[a-z0-9-]{3,32}$/.test(s);
const limparNome = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const num = (v) => Number(v || 0);
const lerJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };

function responder(res, status, obj, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(obj));
}

async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const partes = [];
  for await (const c of req) partes.push(c);
  const txt = Buffer.concat(partes).toString('utf8');
  return txt ? JSON.parse(txt) : {};
}

module.exports = async (req, res) => {
  if (!BASE || !TOKEN) return responder(res, 503, { erro: 'sem_banco' });
  try {
    const url = new URL(req.url, 'http://local');

    if (req.method === 'GET') {
      const id = (url.searchParams.get('id') || '').toLowerCase();
      if (!salaOk(id)) return responder(res, 400, { erro: 'sala_invalida' });
      const cache = 'public, max-age=0, s-maxage=2, stale-while-revalidate=1';
      if (url.searchParams.get('hist')) {
        const [lista] = await redis([['LRANGE', `sala:${id}:hist`, '-60', '-1']]);
        return responder(res, 200, { hist: (lista || []).map(lerJSON).filter(Boolean) }, cache);
      }
      const [h] = await redis([['HGETALL', 'sala:' + id]]);
      return responder(res, 200, { dados: paraObj(h), agora: Date.now() }, cache);
    }
    if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo' });

    const b = await lerCorpo(req);
    const id = String(b.id || '').toLowerCase();
    if (!salaOk(id)) return responder(res, 400, { erro: 'sala_invalida' });
    const chave = 'sala:' + id;
    const chaveHist = chave + ':hist';
    const nome = limparNome(b.jogador);
    const quem = nome || 'alguém';
    const acao = String(b.acao || '');
    const agora = Date.now();

    const [h0] = await redis([['HGETALL', chave]]);
    const atual = paraObj(h0);
    const cmds = [];
    const inc = (campo, por = 1) => cmds.push(['HINCRBY', chave, campo, String(por)]);
    const nada = () => responder(res, 200, { dados: atual, agora, aviso: 'nada_a_fazer' });
    let k = num(atual.partida);
    let aberta = atual.aberta === '1';
    let resumo = null;

    const fechar = (fim) => {
      const pre = `m${k}:`;
      const jog = {};
      const tipos = {};
      Object.keys(atual).forEach((f) => {
        if (f.startsWith(pre + 'p:')) jog[f.slice(pre.length + 2)] = num(atual[f]);
        else if (f.startsWith(pre + 'tipo:')) tipos[f.slice(pre.length + 5)] = num(atual[f]);
      });
      const baus = num(atual[pre + 'baus']);
      const campos = Object.keys(atual).filter((f) => f.startsWith(pre));
      if (campos.length) cmds.push(['HDEL', chave, ...campos]);
      if (baus <= 0) {
        // partida sem nenhum baú: descarta e devolve o número
        cmds.push(['HSET', chave, 'aberta', '0', 'partida', String(Math.max(0, k - 1))]);
        k = Math.max(0, k - 1);
        aberta = false;
        return;
      }
      const inicio = num(atual[pre + 'inicio']) || fim;
      resumo = { k, inicio, fim, dur: Math.max(0, fim - inicio), baus, th: num(atual[pre + 'th']), p: jog, tipos };
      cmds.push(['RPUSH', chaveHist, JSON.stringify(resumo)]);
      cmds.push(['LTRIM', chaveHist, '-500', '-1']);
      inc('t:fechadas'); inc('t:tempo', resumo.dur); inc('t:bf', baus);
      if (baus > num(atual['rs'])) cmds.push(['HSET', chave, 'rs', String(baus), 'rs:k', String(k)]);
      const max = Math.max(0, ...Object.values(jog));
      Object.entries(jog).forEach(([n, v]) => {
        if (v <= 0) return;
        inc('t:jog:' + n); inc('t:pf:' + n, v);
        if (v > num(atual['t:rec:' + n])) cmds.push(['HSET', chave, 't:rec:' + n, String(v)]);
        if (v === max) inc('t:mvp:' + n);
      });
      cmds.push(['HSET', chave, 'aberta', '0', 'ultima', JSON.stringify(resumo)]);
      aberta = false;
    };
    const abrir = (ts) => {
      k += 1;
      cmds.push(['HSET', chave, 'partida', String(k), 'aberta', '1', `m${k}:inicio`, String(ts)]);
      aberta = true;
    };
    const parada = () => aberta && agora - Math.max(num(atual[`m${k}:inicio`]), num(atual[`m${k}:ult`])) > AUTO_FECHAR_MS;
    const fimDaParada = () => Math.max(num(atual[`m${k}:inicio`]), num(atual[`m${k}:ult`])) || agora;

    if (acao === 'zerar') {
      cmds.push(['DEL', chave, chaveHist]);
      cmds.push(['HSET', chave, 'v', String(num(atual.v) + 1), 'aberta', '0', 'partida', '0', 'ult', `${quem}|zerou|${agora}`]);
    } else {
      if (acao === 'bau') {
        if (!nome) return responder(res, 400, { erro: 'sem_nome' });
        if (parada()) fechar(fimDaParada());
        if (!aberta) abrir(agora);
        const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'normal';
        const th = b.th === true;
        const pre = `m${k}:`;
        inc('t:baus'); inc('t:p:' + nome); inc('t:tipo:' + tipo);
        inc(pre + 'baus'); inc(pre + 'p:' + nome); inc(pre + 'tipo:' + tipo);
        if (th) { inc('t:th'); inc(pre + 'th'); }
        cmds.push(['HSET', chave, pre + 'ult', String(agora), 'u:' + nome, `${tipo}|${th ? 1 : 0}|${k}`, 'ult', `${nome}|${tipo}|${agora}|${k}`]);
      } else if (acao === 'desfazer') {
        if (!nome) return responder(res, 400, { erro: 'sem_nome' });
        const [tipoU, thU, kU] = String(atual['u:' + nome] || '').split('|');
        const pre = `m${k}:`;
        if (!aberta || num(kU) !== k || num(atual[pre + 'p:' + nome]) <= 0) return nada();
        const tipo = TIPOS.includes(tipoU) ? tipoU : 'normal';
        inc('t:baus', -1); inc('t:p:' + nome, -1); inc('t:tipo:' + tipo, -1);
        inc(pre + 'baus', -1); inc(pre + 'p:' + nome, -1); inc(pre + 'tipo:' + tipo, -1);
        if (thU === '1') { inc('t:th', -1); inc(pre + 'th', -1); }
        cmds.push(['HDEL', chave, 'u:' + nome]);
        cmds.push(['HSET', chave, 'ult', `${nome}|desfez|${agora}|${k}`]);
      } else if (acao === 'abrir') {
        if (aberta && !parada()) return nada();
        if (parada()) fechar(fimDaParada());
        abrir(agora);
        cmds.push(['HSET', chave, 'ult', `${quem}|abriu|${agora}|${k}`]);
      } else if (acao === 'fechar') {
        if (!aberta) return nada();
        const kFechada = k;
        fechar(agora);
        cmds.push(['HSET', chave, 'ult', `${quem}|${resumo ? 'fim' : 'descartou'}|${agora}|${kFechada}`]);
      } else if (acao === 'token') {
        cmds.push(['HSET', chave, 'achou', `${quem}|${agora}`, 'ult', `${quem}|token|${agora}`]);
      } else {
        return responder(res, 400, { erro: 'acao_invalida' });
      }
      inc('v');
    }
    cmds.push(['EXPIRE', chave, String(TTL)]);
    cmds.push(['EXPIRE', chaveHist, String(TTL)]);
    cmds.push(['HGETALL', chave]);
    const out = await redis(cmds);
    return responder(res, 200, { dados: paraObj(out[out.length - 1]), agora, resumo });
  } catch (e) {
    return responder(res, 500, { erro: 'falha', detalhe: String((e && e.message) || e).slice(0, 120) });
  }
};
