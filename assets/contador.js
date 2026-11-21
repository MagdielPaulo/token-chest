'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const NF0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const fDiaHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const num = (v) => Number(v || 0);
  const int = (v) => NF0.format(v);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };
  const K = { nome: 'tp-nome', sala: 'tp-sala', vibrar: 'tp-vibrar', rank: 'tp-rank', local: (s) => 'tp-local2-' + s, localHist: (s) => 'tp-local2-hist-' + s };
  const TIPOS = ['normal', 'raro', 'enterrado', 'sprite'];
  const AUTO_FECHAR_MS = 40 * 60 * 1000;
  const MEDALHAS = ['🥇', '🥈', '🥉'];
  const limparNome = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const limparSala = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const novaSala = () => 'squad-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  const lerJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

  let sala = null;
  let nome = null;
  let modoLocal = false;
  let servidor = {};
  let hist = [];
  let histChave = null;
  let pend = [];
  let ultimoV = -1;
  let ultimaMudanca = Date.now();
  let timer = null;
  let odds = { p: 1 / 137500, mult: 1.5 };
  let agenda = [];
  let wake = null;
  let festaVista = null;

  // ---------- mesma regra do servidor (api/sala.js): modo local e toque aparecendo na hora ----------
  function aplicarAcao(d0, a) {
    const d = Object.assign({}, d0);
    const inc = (f, por = 1) => { d[f] = String(num(d[f]) + por); };
    const quem = a.jogador || 'alguém';
    let k = num(d.partida);
    let aberta = d.aberta === '1';
    let resumo = null;
    const fechar = (fim) => {
      const pre = `m${k}:`;
      const jog = {};
      const tipos = {};
      Object.keys(d).forEach((f) => {
        if (f.startsWith(pre + 'p:')) jog[f.slice(pre.length + 2)] = num(d[f]);
        else if (f.startsWith(pre + 'tipo:')) tipos[f.slice(pre.length + 5)] = num(d[f]);
      });
      const baus = num(d[pre + 'baus']);
      const inicio = num(d[pre + 'inicio']) || fim;
      const th = num(d[pre + 'th']);
      Object.keys(d).forEach((f) => { if (f.startsWith(pre)) delete d[f]; });
      if (baus <= 0) { d.aberta = '0'; k = Math.max(0, k - 1); d.partida = String(k); aberta = false; return; }
      resumo = { k, inicio, fim, dur: Math.max(0, fim - inicio), baus, th, p: jog, tipos };
      inc('t:fechadas'); inc('t:tempo', resumo.dur); inc('t:bf', baus);
      if (baus > num(d['rs'])) { d['rs'] = String(baus); d['rs:k'] = String(k); }
      const max = Math.max(0, ...Object.values(jog));
      Object.entries(jog).forEach(([n, v]) => {
        if (v <= 0) return;
        inc('t:jog:' + n); inc('t:pf:' + n, v);
        if (v > num(d['t:rec:' + n])) d['t:rec:' + n] = String(v);
        if (v === max) inc('t:mvp:' + n);
      });
      d.aberta = '0';
      d.ultima = JSON.stringify(resumo);
      aberta = false;
    };
    const abrir = (ts) => { k += 1; d.partida = String(k); d.aberta = '1'; d[`m${k}:inicio`] = String(ts); aberta = true; };
    const ultAtiv = () => Math.max(num(d[`m${k}:inicio`]), num(d[`m${k}:ult`]));
    const parada = () => aberta && a.agora - ultAtiv() > AUTO_FECHAR_MS;

    if (a.acao === 'zerar') {
      const v = num(d.v) + 1;
      return { d: { v: String(v), aberta: '0', partida: '0', ult: `${quem}|zerou|${a.agora}` }, resumo: null, zerou: true };
    }
    if (a.acao === 'bau') {
      if (parada()) fechar(ultAtiv() || a.agora);
      if (!aberta) abrir(a.agora);
      const tipo = TIPOS.includes(a.tipo) ? a.tipo : 'normal';
      const pre = `m${k}:`;
      inc('t:baus'); inc('t:p:' + a.jogador); inc('t:tipo:' + tipo);
      inc(pre + 'baus'); inc(pre + 'p:' + a.jogador); inc(pre + 'tipo:' + tipo);
      if (a.th) { inc('t:th'); inc(pre + 'th'); }
      d[pre + 'ult'] = String(a.agora);
      d['u:' + a.jogador] = `${tipo}|${a.th ? 1 : 0}|${k}`;
      d.ult = `${a.jogador}|${tipo}|${a.agora}|${k}`;
    } else if (a.acao === 'desfazer') {
      const [tipoU, thU, kU] = String(d['u:' + a.jogador] || '').split('|');
      const pre = `m${k}:`;
      if (!aberta || num(kU) !== k || num(d[pre + 'p:' + a.jogador]) <= 0) return { d: d0, resumo: null, nada: true };
      const tipo = TIPOS.includes(tipoU) ? tipoU : 'normal';
      inc('t:baus', -1); inc('t:p:' + a.jogador, -1); inc('t:tipo:' + tipo, -1);
      inc(pre + 'baus', -1); inc(pre + 'p:' + a.jogador, -1); inc(pre + 'tipo:' + tipo, -1);
      if (thU === '1') { inc('t:th', -1); inc(pre + 'th', -1); }
      delete d['u:' + a.jogador];
      d.ult = `${a.jogador}|desfez|${a.agora}|${k}`;
    } else if (a.acao === 'abrir') {
      if (aberta && !parada()) return { d: d0, resumo: null, nada: true };
      if (parada()) fechar(ultAtiv() || a.agora);
      abrir(a.agora);
      d.ult = `${quem}|abriu|${a.agora}|${k}`;
    } else if (a.acao === 'fechar') {
      if (!aberta) return { d: d0, resumo: null, nada: true };
      const kF = k;
      fechar(a.agora);
      d.ult = `${quem}|${resumo ? 'fim' : 'descartou'}|${a.agora}|${kF}`;
    } else if (a.acao === 'token') {
      d.achou = `${quem}|${a.agora}`;
      d.ult = `${quem}|token|${a.agora}`;
    }
    inc('v');
    return { d, resumo };
  }
  const exibido = () => pend.reduce((d, x) => aplicarAcao(d, x.a).d, servidor);

  // ---------- dados do site ----------
  Promise.all([fetch('data/odds.json').then((r) => r.json()), fetch('data/agenda.json').then((r) => r.json())])
    .then(([o, ag]) => {
      const t = o.find((r) => String(r.item).startsWith('Pirate Shop'));
      if (t) odds = { p: 1 / t.chance_1_em, mult: t.mult_th };
      agenda = ag;
      render();
    })
    .catch(() => { /* segue com os valores padrão */ });
  const thAgora = () => {
    const agora = Date.now();
    return agenda.find((r) => r.tipo === 'treasure_hour' && new Date(r.inicio).getTime() <= agora && new Date(r.fim).getTime() > agora) || null;
  };

  function setStatus(txt, tom) {
    const p = $('#status');
    p.textContent = txt;
    p.className = 'pill' + (tom ? ' ' + tom : '');
  }

  // ---------- sincronização ----------
  const semApi = (s) => s === 503 || s === 404 || s === 405 || s === 501;

  function ativarLocal() {
    if (!modoLocal) {
      modoLocal = true;
      servidor = LS.get(K.local(sala), {});
      hist = LS.get(K.localHist(sala), []);
      pend = [];
    }
    clearTimeout(timer);
    setStatus('modo local', 'warn');
    render();
  }

  function receber(d) {
    const v = num(d.v);
    if (v < ultimoV) return;
    if (v !== ultimoV) ultimaMudanca = Date.now();
    ultimoV = v;
    servidor = d;
    const chave = `${num(d['t:fechadas'])}|${d.ultima || ''}`;
    if (chave !== histChave) { histChave = chave; puxarHist(); }
    render();
  }

  async function puxarHist() {
    if (modoLocal || !sala) return;
    try {
      const r = await fetch('/api/sala?hist=1&id=' + encodeURIComponent(sala));
      if (!r.ok) return;
      const j = await r.json();
      hist = Array.isArray(j.hist) ? j.hist : [];
      render();
    } catch { /* tenta de novo na próxima mudança */ }
  }

  function agendar() {
    clearTimeout(timer);
    if (modoLocal || !sala) return;
    const parado = Date.now() - ultimaMudanca > 120000;
    timer = setTimeout(puxar, parado ? 10000 : 3000);
  }

  async function puxar() {
    clearTimeout(timer);
    if (!sala || modoLocal || document.hidden) return;
    if (pend.length === 0) {
      try {
        const r = await fetch('/api/sala?id=' + encodeURIComponent(sala));
        if (semApi(r.status)) { ativarLocal(); return; }
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (pend.length === 0) receber(j.dados || {});
        setStatus('ao vivo', 'ok');
      } catch {
        setStatus('sem conexão', 'bad');
      }
    }
    agendar();
  }

  function aplicarLocal(a) {
    const r = aplicarAcao(servidor, a);
    if (r.nada) return;
    servidor = r.d;
    if (r.zerou) hist = [];
    if (r.resumo) { hist = hist.concat([r.resumo]).slice(-500); }
    LS.set(K.local(sala), servidor);
    LS.set(K.localHist(sala), hist);
    render();
  }

  async function acionar(acao, extra = {}) {
    if (!sala || !nome) return;
    const a = Object.assign({ acao, jogador: nome, agora: Date.now() }, extra);
    if (acao === 'bau') a.th = !!thAgora();
    ultimaMudanca = Date.now();
    if (modoLocal) { aplicarLocal(a); return; }
    const item = { a };
    pend.push(item);
    render();
    try {
      const r = await fetch('/api/sala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sala, acao, jogador: nome, tipo: a.tipo, th: a.th === true }),
      });
      if (semApi(r.status)) {
        pend = pend.filter((x) => x !== item);
        ativarLocal();
        aplicarLocal(a);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      pend = pend.filter((x) => x !== item);
      if (acao === 'zerar') { hist = []; histChave = null; }
      receber(j.dados || {});
      setStatus('ao vivo', 'ok');
    } catch {
      pend = pend.filter((x) => x !== item);
      setStatus('não salvou, toque de novo', 'bad');
      render();
    }
    agendar();
  }

  // ---------- leitura do estado ----------
  function ler(d) {
    const k = num(d.partida);
    const aberta = d.aberta === '1';
    const pre = `m${k}:`;
    const jogPartida = {};
    const tiposPartida = {};
    const jog = {};
    const pega = (n) => (jog[n] = jog[n] || { nome: n, total: 0, jogos: 0, pf: 0, rec: 0, mvp: 0 });
    Object.entries(d).forEach(([f, v]) => {
      let m;
      if (aberta && f.startsWith(pre + 'p:')) jogPartida[f.slice(pre.length + 2)] = num(v);
      else if (aberta && f.startsWith(pre + 'tipo:')) tiposPartida[f.slice(pre.length + 5)] = num(v);
      else if ((m = f.match(/^t:p:(.+)$/))) pega(m[1]).total = num(v);
      else if ((m = f.match(/^t:jog:(.+)$/))) pega(m[1]).jogos = num(v);
      else if ((m = f.match(/^t:pf:(.+)$/))) pega(m[1]).pf = num(v);
      else if ((m = f.match(/^t:rec:(.+)$/))) pega(m[1]).rec = num(v);
      else if ((m = f.match(/^t:mvp:(.+)$/))) pega(m[1]).mvp = num(v);
    });
    Object.values(jog).forEach((j) => { j.media = j.jogos ? j.pf / j.jogos : null; });
    return {
      k, aberta,
      inicio: aberta ? num(d[pre + 'inicio']) : 0,
      bausPartida: aberta ? num(d[pre + 'baus']) : 0,
      jogPartida, tiposPartida,
      tBaus: num(d['t:baus']), tTh: num(d['t:th']),
      fechadas: num(d['t:fechadas']), tempo: num(d['t:tempo']), bf: num(d['t:bf']),
      rec: num(d['rs']), recK: num(d['rs:k']),
      tipos: Object.fromEntries(TIPOS.map((t) => [t, num(d['t:tipo:' + t])])),
      jogadores: Object.values(jog),
      ultima: d.ultima ? lerJSON(d.ultima) : null,
      ult: d.ult, achou: d.achou,
    };
  }

  // ---------- tela ----------
  const txtUlt = {
    normal: 'abriu um baú', raro: 'abriu um baú raro', enterrado: 'desenterrou um baú', sprite: 'abriu um baú de Sprite',
    desfez: 'desfez o último baú', abriu: 'começou a partida', fim: 'encerrou a partida', descartou: 'descartou uma partida sem baú',
    token: 'marcou que achou o token!', zerou: 'zerou a sala',
  };
  const ha = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return 'agora';
    if (s < 60) return `há ${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `há ${m} min`;
    return `há ${Math.floor(m / 60)} h`;
  };
  const dur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  };
  const durCurta = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  };

  function listaBarras(ol, linhas, vazio) {
    ol.replaceChildren();
    if (!linhas.length) { ol.appendChild(el('li', 'small', vazio)); return; }
    const max = Math.max(1, ...linhas.map((x) => x.n));
    linhas.forEach((x, i) => {
      const li = el('li', 'ct-jog' + (x.nome === nome ? ' eu' : ''));
      li.append(el('span', 'ct-jog-nome', (i === 0 && x.n > 0 ? '👑 ' : '') + x.nome + (x.nome === nome ? ' (você)' : '')), el('span', 'ct-jog-n', int(x.n)));
      const barra = el('div', 'ct-jog-barra');
      const fill = el('span');
      fill.style.width = (x.n / max) * 100 + '%';
      barra.appendChild(fill);
      li.appendChild(barra);
      if (x.sub) li.appendChild(el('span', 'ct-jog-t', x.sub));
      ol.appendChild(li);
    });
  }

  function render() {
    if (!sala || $('#tela-sala').hidden) return;
    const d = exibido();
    const e = ler(d);
    const agora = Date.now();

    const th = thAgora();
    $('#aviso-th').hidden = !th;
    if (th) {
      $('#th-mult').textContent = NF1.format(odds.mult).replace(',0', '') + '×';
      $('#th-fim').textContent = fHora.format(new Date(th.fim));
    }
    $('#aviso-local').hidden = !modoLocal;
    const avTok = $('#aviso-token');
    if (e.achou) {
      const [q, ts] = String(e.achou).split('|');
      avTok.hidden = false;
      $('#token-quem').textContent = q;
      if (festaVista !== e.achou) {
        festaVista = e.achou;
        avTok.classList.remove('festa');
        void avTok.offsetWidth;
        avTok.classList.add('festa');
        if ($('#chk-vibrar').checked && navigator.vibrate && agora - num(ts) < 60000) navigator.vibrate([200, 100, 200, 100, 400]);
      }
    } else {
      avTok.hidden = true;
    }

    // placar da partida atual
    const placar = $('#placar');
    placar.classList.toggle('aberta', e.aberta);
    if (e.aberta) {
      $('#pa-titulo').textContent = `Partida #${e.k}`;
      $('#pa-sub').textContent = `Em andamento · ${dur(agora - e.inicio)}`;
      $('#pa-h2').textContent = `Nesta partida (#${e.k})`;
    } else {
      $('#pa-titulo').textContent = 'Sem partida aberta';
      $('#pa-sub').textContent = `O primeiro baú já abre a partida #${e.k + 1}`;
      $('#pa-h2').textContent = 'Nesta partida';
    }
    $('#pa-baus').textContent = int(e.bausPartida);
    $('#btn-fim').hidden = !e.aberta;
    $('#btn-abrir').hidden = e.aberta;
    $('#btn-desfazer').disabled = !e.aberta;

    const linhasPartida = Object.entries(e.jogPartida).map(([n, v]) => ({ nome: n, n: v })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    listaBarras($('#pa-jogadores'), linhasPartida, e.aberta ? 'Ninguém marcou baú nesta partida ainda.' : 'Toque no botão grande no primeiro baú da próxima partida.');
    const tp = e.tiposPartida;
    $('#pa-tipos').textContent = e.aberta && e.bausPartida ? `Normal ${int(tp.normal || 0)} · Raro ${int(tp.raro || 0)} · Enterrado ${int(tp.enterrado || 0)} · Sprite ${int(tp.sprite || 0)}` : '';

    // feed
    if (e.ult) {
      const [q, o, ts, kk] = String(e.ult).split('|');
      const extra = (o === 'fim' || o === 'abriu' || o === 'descartou') && kk ? ` #${kk}` : '';
      $('#feed').textContent = `${q === nome ? 'Você' : q} ${txtUlt[o] || o}${extra} · ${ha(num(ts))}`;
    } else {
      $('#feed').textContent = 'Toque no botão grande a cada baú aberto.';
    }

    // última partida
    const ul = e.ultima;
    $('#ultima').hidden = !ul;
    if (ul) {
      const linhas = Object.entries(ul.p || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const max = linhas.length ? linhas[0][1] : 0;
      const mvps = linhas.filter(([, v]) => v === max).map(([n]) => n);
      $('#ul-titulo').textContent = `Partida #${ul.k}: ${int(ul.baus)} baús em ${durCurta(ul.dur)} · MVP: ${mvps.join(' e ')}`;
      const ol = $('#ul-lista');
      ol.replaceChildren();
      linhas.forEach(([n, v]) => ol.appendChild(el('li', v === max ? 'mvp' : '', `${n} ${int(v)}`)));
    }

    renderHist();

    // geral
    $('#g-baus').textContent = int(e.tBaus);
    $('#g-tipos').textContent = `Normal ${int(e.tipos.normal)} · Raro ${int(e.tipos.raro)} · Enterrado ${int(e.tipos.enterrado)} · Sprite ${int(e.tipos.sprite)}`;
    $('#g-partidas').textContent = int(e.fechadas);
    $('#g-tempo').textContent = e.tempo ? `${durCurta(e.tempo)} de jogo somado` : 'Nenhuma partida fechada ainda';
    const media = e.fechadas ? e.bf / e.fechadas : null;
    $('#g-media').textContent = media === null ? '—' : NF1.format(media);
    const ritmo = e.tempo >= 5 * 60000 ? e.bf / (e.tempo / 36e5) : null;
    $('#g-ritmo').textContent = ritmo === null ? 'baús por hora: —' : `${int(Math.round(ritmo))} baús por hora`;
    $('#g-rec').textContent = e.rec ? int(e.rec) : '—';
    $('#g-rec-n').textContent = e.rec ? `baús na partida #${e.recK}` : 'Feche uma partida para ter recorde';
    const pTH = odds.p * odds.mult;
    const chance = 1 - Math.pow(1 - odds.p, e.tBaus - e.tTh) * Math.pow(1 - pTH, e.tTh);
    $('#g-chance').textContent = NF2.format(chance * 100) + '%';
    const b50 = Math.log(2) / -Math.log1p(-odds.p);
    const falta = Math.max(0, Math.round(b50 - (e.tBaus - e.tTh + e.tTh * odds.mult)));
    $('#g-chance-n').textContent = `Faltam ~${int(falta)} baús para 50%` + (ritmo ? ` (~${int(Math.round(falta / ritmo))} h no ritmo de vocês)` : '');

    renderRank(e);
  }

  function renderHist() {
    const lista = hist.slice().sort((a, b) => a.k - b.k);
    const temHist = lista.length > 0;
    $('#hist-vazio').hidden = temHist;
    $('#barras-wrap').hidden = !temHist;
    $('#hist-wrap').hidden = !temHist;
    if (!temHist) return;

    // barras: últimas 30 partidas
    const ult30 = lista.slice(-30);
    const max = Math.max(1, ...ult30.map((p) => p.baus));
    const recorde = Math.max(...lista.map((p) => p.baus));
    const caixa = $('#barras');
    const tip = $('#barras-tip');
    caixa.replaceChildren();
    ult30.forEach((p) => {
      const b = el('div', 'ct-barra' + (p.baus === recorde ? ' rec' : ''));
      b.style.height = Math.max(2, (p.baus / max) * 100) + '%';
      if (ult30.length <= 20 || p.baus === recorde) b.appendChild(el('b', null, int(p.baus)));
      b.addEventListener('pointermove', (ev) => {
        const linhas = Object.entries(p.p || {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
        tip.replaceChildren(el('b', null, `Partida #${p.k} · ${int(p.baus)} baús`));
        tip.appendChild(el('div', null, `${durCurta(p.dur)} · ${fDiaHora.format(new Date(p.inicio))}`));
        linhas.forEach(([n, v]) => tip.appendChild(el('div', null, `${n}: ${int(v)}`)));
        tip.hidden = false;
        const r = $('#barras-wrap').getBoundingClientRect();
        const x = ev.clientX - r.left;
        let left = x + 12;
        if (left + tip.offsetWidth > r.width) left = Math.max(4, x - tip.offsetWidth - 12);
        tip.style.left = left + 'px';
        tip.style.top = '0px';
      });
      b.addEventListener('pointerleave', () => { tip.hidden = true; });
      caixa.appendChild(b);
    });
    caixa.scrollLeft = caixa.scrollWidth;

    // tabela: mais recente primeiro
    const totais = {};
    lista.forEach((p) => Object.entries(p.p || {}).forEach(([n, v]) => { totais[n] = (totais[n] || 0) + v; }));
    const nomes = Object.keys(totais).sort((a, b) => totais[b] - totais[a]);
    const thead = $('#tabela-hist thead');
    const trh = el('tr');
    trh.append(el('th', null, '#'), el('th', null, 'Duração'));
    nomes.forEach((n) => trh.appendChild(el('th', 'num', n)));
    trh.appendChild(el('th', 'num', 'Squad'));
    thead.replaceChildren(trh);
    const tb = $('#tabela-hist tbody');
    tb.replaceChildren();
    lista.slice().reverse().forEach((p) => {
      const tr = el('tr');
      tr.append(el('td', null, String(p.k)), el('td', null, durCurta(p.dur)));
      const max2 = Math.max(0, ...Object.values(p.p || {}));
      nomes.forEach((n) => {
        const v = (p.p || {})[n] || 0;
        tr.appendChild(el('td', 'num' + (v > 0 && v === max2 ? ' mvp' : ''), v ? int(v) : '·'));
      });
      tr.appendChild(el('td', 'num', int(p.baus)));
      tb.appendChild(tr);
    });
  }

  function renderRank(e) {
    const crit = $('#sel-rank').value;
    const ol = $('#lista-rank');
    ol.replaceChildren();
    const jog = e.jogadores.filter((j) => j.total > 0 || j.jogos > 0);
    if (!jog.length) { ol.appendChild(el('li', 'small', 'O rank aparece quando alguém marcar o primeiro baú.')); return; }
    const valor = (j) => ({ total: j.total, media: j.media ?? -1, mvp: j.mvp, rec: j.rec })[crit];
    jog.sort((a, b) => valor(b) - valor(a) || b.total - a.total || a.nome.localeCompare(b.nome));
    const rotulo = { total: 'baús', media: 'por partida', mvp: 'vezes MVP', rec: 'recorde' }[crit];
    let pos = 0;
    let anterior = null;
    jog.forEach((j, i) => {
      const v = valor(j);
      if (v !== anterior) { pos = i; anterior = v; }
      const li = el('li', 'ct-rk' + (j.nome === nome ? ' eu' : ''));
      li.appendChild(el('span', 'ct-rk-pos', MEDALHAS[pos] || `${pos + 1}º`));
      li.appendChild(el('span', 'ct-rk-nome', j.nome + (j.nome === nome ? ' (você)' : '')));
      const val = el('span', 'ct-rk-val');
      const mostra = crit === 'media' ? (j.media === null ? '—' : NF1.format(j.media)) : int(v);
      val.append(el('span', null, mostra), el('small', null, rotulo));
      li.appendChild(val);
      li.appendChild(el('span', 'ct-rk-info', `${int(j.total)} baús · ${int(j.jogos)} partidas · média ${j.media === null ? '—' : NF1.format(j.media)} · recorde ${int(j.rec)} · MVP ${int(j.mvp)}×`));
      ol.appendChild(li);
    });
  }

  // ---------- entrar e trocar ----------
  function mostrarEntrar(s) {
    clearTimeout(timer);
    $('#tela-entrar').hidden = false;
    $('#tela-sala').hidden = true;
    $('#in-nome').value = nome || '';
    $('#in-sala').value = s || '';
    setStatus('fora da sala', '');
  }

  function entrarSala() {
    $('#tela-entrar').hidden = true;
    $('#tela-sala').hidden = false;
    $('#sala-codigo').textContent = sala;
    $('#voce-nome').textContent = nome;
    LS.set(K.sala, sala);
    LS.set(K.nome, nome);
    const url = new URL(location.href);
    url.searchParams.set('sala', sala);
    history.replaceState(null, '', url);
    servidor = {};
    hist = [];
    histChave = null;
    pend = [];
    ultimoV = -1;
    modoLocal = false;
    ultimaMudanca = Date.now();
    setStatus('conectando…', '');
    render();
    puxar();
  }

  $('#form-entrar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = limparNome($('#in-nome').value);
    if (!n) { $('#in-nome').focus(); return; }
    nome = n;
    let s = limparSala($('#in-sala').value);
    if (s.length < 3) s = novaSala();
    sala = s;
    entrarSala();
  });
  $('#btn-trocar').addEventListener('click', () => mostrarEntrar(sala));

  // ---------- botões ----------
  const vibrar = (ms) => { if ($('#chk-vibrar').checked && navigator.vibrate) navigator.vibrate(ms); };
  $$('[data-tipo]').forEach((b) => b.addEventListener('click', () => {
    vibrar(25);
    const grande = $('#btn-bau');
    grande.classList.add('pulso');
    setTimeout(() => grande.classList.remove('pulso'), 120);
    acionar('bau', { tipo: b.getAttribute('data-tipo') });
  }));
  $('#btn-desfazer').addEventListener('click', () => { vibrar(15); acionar('desfazer'); });
  $('#btn-abrir').addEventListener('click', () => { vibrar(15); acionar('abrir'); });
  $('#btn-fim').addEventListener('click', () => {
    const e = ler(exibido());
    if (window.confirm(`Encerrar a partida #${e.k}? (${int(e.bausPartida)} baús)`)) { vibrar([30, 60, 30]); acionar('fechar'); }
  });
  $('#btn-token').addEventListener('click', () => {
    if (window.confirm('Alguém do squad achou o token? Todos vão ver o aviso.')) acionar('token');
  });
  $('#btn-zerar').addEventListener('click', () => {
    if (window.confirm('Apagar TODOS os números desta sala, inclusive o histórico de partidas e o rank? Não dá para desfazer.')) acionar('zerar');
  });
  const selRank = $('#sel-rank');
  selRank.value = LS.get(K.rank, 'total');
  selRank.addEventListener('change', () => { LS.set(K.rank, selRank.value); render(); });

  $('#btn-copiar').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?sala=${sala}`;
    const b = $('#btn-copiar');
    try {
      await navigator.clipboard.writeText(link);
      b.textContent = 'Link copiado!';
    } catch {
      window.prompt('Copie o link da sala:', link);
    }
    setTimeout(() => { b.textContent = 'Copiar link'; }, 2000);
  });
  if (navigator.share) {
    const bs = $('#btn-share');
    bs.hidden = false;
    bs.addEventListener('click', () => {
      navigator.share({ title: 'Contador do squad', text: `Entra na sala ${sala} do contador de baús`, url: `${location.origin}${location.pathname}?sala=${sala}` }).catch(() => {});
    });
  }

  const chkVibrar = $('#chk-vibrar');
  chkVibrar.checked = LS.get(K.vibrar, true);
  chkVibrar.addEventListener('change', () => LS.set(K.vibrar, chkVibrar.checked));
  if (!navigator.vibrate) chkVibrar.closest('label').hidden = true;

  async function pedirTela() {
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch {
      $('#chk-tela').checked = false;
    }
  }
  if (!('wakeLock' in navigator)) $('#chk-tela').closest('label').hidden = true;
  $('#chk-tela').addEventListener('change', (ev) => {
    if (ev.target.checked) pedirTela();
    else if (wake) wake.release();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if ($('#chk-tela').checked && !wake) pedirTela();
    puxar();
  });
  setInterval(render, 1000);

  // ---------- início ----------
  const params = new URLSearchParams(location.search);
  const salaUrl = limparSala(params.get('sala') || '');
  nome = LS.get(K.nome, null);
  if (salaUrl && nome) { sala = salaUrl; entrarSala(); } else { mostrarEntrar(salaUrl || LS.get(K.sala, '')); }
})();
