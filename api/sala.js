'use strict';
// Contador do squad: guarda os números de cada sala num hash do Redis (Upstash, ligado pela Vercel).
// GET  /api/sala?id=CODIGO            -> estado da sala
// POST /api/sala {id, acao, jogador, tipo, th}
//   acao: bau | desfazer | partida | nova_sessao | token | zerar

const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL = 60 * 60 * 24 * 60; // a sala é apagada depois de 60 dias sem uso
const TIPOS = ['normal', 'raro', 'enterrado', 'sprite'];

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
      const [h] = await redis([['HGETALL', 'sala:' + id]]);
      // cache de 2 s na CDN: os 4 celulares dividem a mesma resposta e o plano grátis rende mais
      return responder(res, 200, { dados: paraObj(h), agora: Date.now() }, 'public, max-age=0, s-maxage=2, stale-while-revalidate=1');
    }
    if (req.method !== 'POST') return responder(res, 405, { erro: 'metodo' });

    const b = await lerCorpo(req);
    const id = String(b.id || '').toLowerCase();
    if (!salaOk(id)) return responder(res, 400, { erro: 'sala_invalida' });
    const chave = 'sala:' + id;
    const nome = limparNome(b.jogador);
    const acao = String(b.acao || '');
    const agora = Date.now();

    const [h0] = await redis([['HGETALL', chave]]);
    const atual = paraObj(h0);
    const n0 = num(atual.sessao);
    let n = n0;
    const cmds = [];
    const inc = (campo, por = 1) => cmds.push(['HINCRBY', chave, campo, String(por)]);
    const quem = nome || 'alguém';

    if (acao === 'zerar') {
      cmds.push(['DEL', chave]);
      cmds.push(['HSET', chave, 'v', String(num(atual.v) + 1), 'sessao', '1', 's1:inicio', String(agora), 'ult', `${quem}|zerou|${agora}`]);
    } else {
      if (n0 === 0) { n = 1; cmds.push(['HSET', chave, 'sessao', '1', 's1:inicio', String(agora)]); }

      if (acao === 'bau') {
        if (!nome) return responder(res, 400, { erro: 'sem_nome' });
        const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'normal';
        const th = b.th === true;
        inc('t:baus'); inc('t:p:' + nome); inc('t:tipo:' + tipo);
        inc(`s${n}:baus`); inc(`s${n}:p:${nome}`);
        if (th) { inc('t:th'); inc(`s${n}:th`); }
        cmds.push(['HSET', chave, 'u:' + nome, `${tipo}|${th ? 1 : 0}|${n}`, 'ult', `${nome}|${tipo}|${agora}`]);
      } else if (acao === 'desfazer') {
        if (!nome) return responder(res, 400, { erro: 'sem_nome' });
        const [tipoU, thU, snU] = String(atual['u:' + nome] || `normal|0|${n}`).split('|');
        const s = num(snU) || n;
        if (num(atual[`s${s}:p:${nome}`]) <= 0 || num(atual['t:p:' + nome]) <= 0) {
          return responder(res, 200, { dados: atual, agora, aviso: 'nada_a_desfazer' });
        }
        const tipo = TIPOS.includes(tipoU) ? tipoU : 'normal';
        inc('t:baus', -1); inc('t:p:' + nome, -1); inc('t:tipo:' + tipo, -1);
        inc(`s${s}:baus`, -1); inc(`s${s}:p:${nome}`, -1);
        if (thU === '1') { inc('t:th', -1); inc(`s${s}:th`, -1); }
        cmds.push(['HDEL', chave, 'u:' + nome]);
        cmds.push(['HSET', chave, 'ult', `${nome}|desfez|${agora}`]);
      } else if (acao === 'partida') {
        inc('t:partidas'); inc(`s${n}:partidas`);
        cmds.push(['HSET', chave, 'ult', `${quem}|partida|${agora}`]);
      } else if (acao === 'nova_sessao') {
        if (n0 > 0) n = n0 + 1;
        cmds.push(['HSET', chave, 'sessao', String(n), `s${n}:inicio`, String(agora), 'ult', `${quem}|sessao|${agora}`]);
      } else if (acao === 'token') {
        cmds.push(['HSET', chave, 'achou', `${quem}|${agora}`, 'ult', `${quem}|token|${agora}`]);
      } else {
        return responder(res, 400, { erro: 'acao_invalida' });
      }
      inc('v');
    }
    cmds.push(['EXPIRE', chave, String(TTL)]);
    cmds.push(['HGETALL', chave]);
    const out = await redis(cmds);
    return responder(res, 200, { dados: paraObj(out[out.length - 1]), agora });
  } catch (e) {
    return responder(res, 500, { erro: 'falha', detalhe: String((e && e.message) || e).slice(0, 120) });
  }
};
