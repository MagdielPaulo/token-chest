'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const NF0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const num = (v) => Number(v || 0);
  const int = (v) => NF0.format(v);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };
  const K = { nome: 'tp-nome', sala: 'tp-sala', vibrar: 'tp-vibrar', local: (s) => 'tp-local-' + s };
  const TIPOS = ['normal', 'raro', 'enterrado', 'sprite'];
  const limparNome = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const limparSala = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const novaSala = () => 'squad-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

  let sala = null;
  let nome = null;
  let modoLocal = false;
  let servidor = {};
  let pend = [];
  let ultimoV = -1;
  let ultimaMudanca = Date.now();
  let timer = null;
  let odds = { p: 1 / 137500, mult: 1.5 };
  let agenda = [];
  let wake = null;
  let festaVista = null;

  // ---------- mesma regra do servidor, para o modo local e para mostrar o toque na hora ----------
  function aplicarAcao(d0, a) {
    const d = Object.assign({}, d0);
    const inc = (k, por = 1) => { d[k] = String(num(d[k]) + por); };
    const quem = a.jogador || 'alguém';
    if (a.acao === 'zerar') {
      const v = num(d.v) + 1;
      Object.keys(d).forEach((k) => delete d[k]);
      Object.assign(d, { v: String(v), sessao: '1', 's1:inicio': String(a.agora), ult: `${quem}|zerou|${a.agora}` });
      return d;
    }
    const n0 = num(d.sessao);
    let n = n0;
    if (n0 === 0) { n = 1; d.sessao = '1'; d['s1:inicio'] = String(a.agora); }
    if (a.acao === 'bau') {
      const tipo = TIPOS.includes(a.tipo) ? a.tipo : 'normal';
      inc('t:baus'); inc('t:p:' + a.jogador); inc('t:tipo:' + tipo);
      inc(`s${n}:baus`); inc(`s${n}:p:${a.jogador}`);
      if (a.th) { inc('t:th'); inc(`s${n}:th`); }
      d['u:' + a.jogador] = `${tipo}|${a.th ? 1 : 0}|${n}`;
      d.ult = `${a.jogador}|${tipo}|${a.agora}`;
    } else if (a.acao === 'desfazer') {
      const [tipoU, thU, snU] = String(d['u:' + a.jogador] || `normal|0|${n}`).split('|');
      const s = num(snU) || n;
      if (num(d[`s${s}:p:${a.jogador}`]) <= 0 || num(d['t:p:' + a.jogador]) <= 0) return d0;
      const tipo = TIPOS.includes(tipoU) ? tipoU : 'normal';
      inc('t:baus', -1); inc('t:p:' + a.jogador, -1); inc('t:tipo:' + tipo, -1);
      inc(`s${s}:baus`, -1); inc(`s${s}:p:${a.jogador}`, -1);
      if (thU === '1') { inc('t:th', -1); inc(`s${s}:th`, -1); }
      delete d['u:' + a.jogador];
      d.ult = `${a.jogador}|desfez|${a.agora}`;
    } else if (a.acao === 'partida') {
      inc('t:partidas'); inc(`s${n}:partidas`);
      d.ult = `${quem}|partida|${a.agora}`;
    } else if (a.acao === 'nova_sessao') {
      if (n0 > 0) n = n0 + 1;
      d.sessao = String(n);
      d[`s${n}:inicio`] = String(a.agora);
      d.ult = `${quem}|sessao|${a.agora}`;
    } else if (a.acao === 'token') {
      d.achou = `${quem}|${a.agora}`;
      d.ult = `${quem}|token|${a.agora}`;
    }
    inc('v');
    return d;
  }
  const exibido = () => pend.reduce((d, x) => aplicarAcao(d, x.a), servidor);

  // ---------- dados do site (chance e Treasure Hours) ----------
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

  // ---------- status ----------
  function setStatus(txt, tom) {
    const p = $('#status');
    p.textContent = txt;
    p.className = 'pill' + (tom ? ' ' + tom : '');
  }

  // ---------- sincronização ----------
  function ativarLocal() {
    if (!modoLocal) {
      modoLocal = true;
      servidor = LS.get(K.local(sala), {});
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
    render();
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
        if (r.status === 503 || r.status === 404 || r.status === 405 || r.status === 501) { ativarLocal(); return; }
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

  async function acionar(acao, extra = {}) {
    if (!sala || !nome) return;
    const a = Object.assign({ acao, jogador: nome, agora: Date.now() }, extra);
    if (acao === 'bau') a.th = !!thAgora();
    ultimaMudanca = Date.now();
    if (modoLocal) {
      servidor = aplicarAcao(servidor, a);
      LS.set(K.local(sala), servidor);
      render();
      return;
    }
    const item = { a };
    pend.push(item);
    render();
    try {
      const r = await fetch('/api/sala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sala, acao, jogador: nome, tipo: a.tipo, th: a.th === true }),
      });
      if (r.status === 503 || r.status === 404 || r.status === 405 || r.status === 501) {
        pend = pend.filter((x) => x !== item);
        ativarLocal();
        servidor = aplicarAcao(servidor, a);
        LS.set(K.local(sala), servidor);
        render();
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      pend = pend.filter((x) => x !== item);
      receber(j.dados || {});
      setStatus('ao vivo', 'ok');
    } catch {
      pend = pend.filter((x) => x !== item);
      setStatus('não salvou, toque de novo', 'bad');
      render();
    }
    agendar();
  }

  // ---------- tela ----------
  const txtUlt = {
    normal: 'abriu um baú', raro: 'abriu um baú raro', enterrado: 'desenterrou um baú', sprite: 'abriu um baú de Sprite',
    partida: 'marcou +1 partida', desfez: 'desfez o último baú', sessao: 'começou uma nova sessão',
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
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  function render() {
    if (!sala || $('#tela-sala').hidden) return;
    const d = exibido();
    const n = num(d.sessao);
    const agora = Date.now();

    const th = thAgora();
    $('#aviso-th').hidden = !th;
    if (th) {
      $('#th-mult').textContent = NF1.format(odds.mult).replace(',0', '') + '×';
      $('#th-fim').textContent = fHora.format(new Date(th.fim));
    }
    $('#aviso-local').hidden = !modoLocal;

    const avTok = $('#aviso-token');
    if (d.achou) {
      const [q, ts] = String(d.achou).split('|');
      avTok.hidden = false;
      $('#token-quem').textContent = q;
      if (festaVista !== d.achou) {
        festaVista = d.achou;
        avTok.classList.remove('festa');
        void avTok.offsetWidth;
        avTok.classList.add('festa');
        if ($('#chk-vibrar').checked && navigator.vibrate && agora - num(ts) < 60000) navigator.vibrate([200, 100, 200, 100, 400]);
      }
    } else {
      avTok.hidden = true;
    }

    const sBaus = num(d[`s${n}:baus`]);
    const sPart = num(d[`s${n}:partidas`]);
    const inicio = num(d[`s${n}:inicio`]);
    const passou = inicio ? agora - inicio : 0;
    $('#s-baus').textContent = int(sBaus);
    $('#s-tempo').textContent = inicio ? dur(passou) : '—';
    const ritmo = passou >= 3 * 60000 ? sBaus / (passou / 36e5) : null;
    $('#s-ritmo').textContent = ritmo === null ? '—' : int(Math.round(ritmo));
    $('#s-partidas').textContent = `${int(sPart)} · ${sPart ? NF1.format(sBaus / sPart) : '—'}`;

    const jog = {};
    Object.entries(d).forEach(([k, v]) => {
      let m = k.match(/^t:p:(.+)$/);
      if (m) { (jog[m[1]] = jog[m[1]] || { s: 0, t: 0 }).t = num(v); return; }
      m = k.match(/^s(\d+):p:(.+)$/);
      if (m && Number(m[1]) === n) (jog[m[2]] = jog[m[2]] || { s: 0, t: 0 }).s = num(v);
    });
    const lista = Object.entries(jog).sort((a, b) => b[1].s - a[1].s || b[1].t - a[1].t);
    const max = Math.max(1, ...lista.map(([, x]) => x.s));
    const ol = $('#lista-jogadores');
    ol.replaceChildren();
    if (!lista.length) {
      const li = document.createElement('li');
      li.className = 'small';
      li.textContent = 'Ninguém marcou baú ainda. Toque no botão grande a cada baú aberto.';
      ol.appendChild(li);
    }
    lista.forEach(([quem, x]) => {
      const li = document.createElement('li');
      li.className = 'ct-jog' + (quem === nome ? ' eu' : '');
      const nm = document.createElement('span');
      nm.className = 'ct-jog-nome';
      nm.textContent = quem + (quem === nome ? ' (você)' : '');
      const nn = document.createElement('span');
      nn.className = 'ct-jog-n';
      nn.textContent = int(x.s);
      const barra = document.createElement('div');
      barra.className = 'ct-jog-barra';
      const fill = document.createElement('span');
      fill.style.width = (x.s / max) * 100 + '%';
      barra.appendChild(fill);
      const tt = document.createElement('span');
      tt.className = 'ct-jog-t';
      tt.textContent = `${int(x.t)} na caçada inteira`;
      li.append(nm, nn, barra, tt);
      ol.appendChild(li);
    });

    const tBaus = num(d['t:baus']);
    const tTh = num(d['t:th']);
    $('#t-baus').textContent = int(tBaus);
    $('#t-tipos').textContent = `Normal ${int(num(d['t:tipo:normal']))} · Raro ${int(num(d['t:tipo:raro']))} · Enterrado ${int(num(d['t:tipo:enterrado']))} · Sprite ${int(num(d['t:tipo:sprite']))}`;
    const pTH = odds.p * odds.mult;
    const chance = 1 - Math.pow(1 - odds.p, tBaus - tTh) * Math.pow(1 - pTH, tTh);
    $('#t-chance').textContent = NF2.format(chance * 100) + '%';
    const b50 = Math.log(2) / -Math.log1p(-odds.p);
    const efetivo = tBaus - tTh + tTh * odds.mult;
    const falta = Math.max(0, Math.round(b50 - efetivo));
    $('#t-chance-n').textContent = `Faltam ~${int(falta)} baús para 50%` + (ritmo ? ` (~${int(Math.round(falta / ritmo))} h no ritmo desta sessão)` : '');

    if (d.ult) {
      const [q, o, ts] = String(d.ult).split('|');
      $('#feed').textContent = `${q === nome ? 'Você' : q} ${txtUlt[o] || o} · ${ha(num(ts))}`;
    } else {
      $('#feed').textContent = 'Toque no botão grande a cada baú aberto.';
    }
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
    pend = [];
    ultimoV = -1;
    modoLocal = false;
    ultimaMudanca = Date.now();
    setStatus('conectando…', '');
    render();
    puxar();
  }

  $('#form-entrar').addEventListener('submit', (e) => {
    e.preventDefault();
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
  $('#btn-partida').addEventListener('click', () => { vibrar(15); acionar('partida'); });
  $('#btn-desfazer').addEventListener('click', () => { vibrar(15); acionar('desfazer'); });
  $('#btn-sessao').addEventListener('click', () => {
    if (window.confirm('Começar uma nova sessão? Os números da sessão voltam a zero; o total da caçada continua.')) acionar('nova_sessao');
  });
  $('#btn-token').addEventListener('click', () => {
    if (window.confirm('Alguém do squad achou o token? Todos vão ver o aviso.')) acionar('token');
  });
  $('#btn-zerar').addEventListener('click', () => {
    if (window.confirm('Apagar TODOS os números desta sala, inclusive o total da caçada? Não dá para desfazer.')) acionar('zerar');
  });

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
  $('#chk-tela').addEventListener('change', (e) => {
    if (e.target.checked) pedirTela();
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
