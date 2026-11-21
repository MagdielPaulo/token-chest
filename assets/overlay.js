'use strict';
// Overlay compacto do contador do squad. Funciona no navegador e dentro do app de PC (window.tpDesktop).
(() => {
  const $ = (s) => document.querySelector(s);
  const NF0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const fDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const num = (v) => Number(v || 0);
  const int = (v) => NF0.format(v);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  };
  const limparNome = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const limparSala = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const MEDALHAS = ['🥇', '🥈', '🥉'];
  const desktop = window.tpDesktop || null;

  const params = new URLSearchParams(location.search);
  let sala = limparSala(params.get('sala') || LS.get('tp-sala', ''));
  let nome = limparNome(params.get('nome') || LS.get('tp-nome', ''));
  const opac = Number(params.get('opac'));
  if (opac > 0 && opac <= 1) document.documentElement.style.setProperty('--opac', String(opac));
  if (desktop) document.body.classList.add('desktop');

  let dados = {};
  let ultimoV = -1;
  let ultimaMudanca = Date.now();
  let timer = null;
  let enviando = 0;
  let agenda = [];
  let odds = { mult: 1.5 };
  let flashTimer = null;
  let fimArmado = 0;
  let atalhos = { bau: 'F7', desfazer: 'F8', fim: 'F9', mostrar: 'F10', mover: 'Ctrl+F10' };

  Promise.all([fetch('data/agenda.json').then((r) => r.json()), fetch('data/odds.json').then((r) => r.json())])
    .then(([ag, o]) => {
      agenda = ag;
      const t = o.find((r) => String(r.item).startsWith('Pirate Shop'));
      if (t) odds = { mult: t.mult_th };
      render();
    })
    .catch(() => {});

  // ---------- conexão ----------
  const dot = (tom) => { $('#dot').className = 'ov-dot' + (tom ? ' ' + tom : ''); };

  function receber(d) {
    const v = num(d.v);
    if (v < ultimoV) return;
    if (ultimoV >= 0 && v > ultimoV) flashDoUltimo(d);
    if (v !== ultimoV) ultimaMudanca = Date.now();
    ultimoV = v;
    dados = d;
    render();
  }

  async function puxar() {
    clearTimeout(timer);
    if (!sala || !nome) return;
    if (!enviando) {
      try {
        const r = await fetch('/api/sala?id=' + encodeURIComponent(sala));
        if (r.status === 503) { aviso('A sala compartilhada não está ligada no site.'); dot('bad'); }
        else if (!r.ok) throw new Error(String(r.status));
        else { const j = await r.json(); if (!enviando) receber(j.dados || {}); dot('ok'); aviso(''); }
      } catch {
        dot('bad');
      }
    }
    const parado = Date.now() - ultimaMudanca > 120000;
    timer = setTimeout(puxar, parado ? 10000 : 2500);
  }

  async function acionar(acao, extra = {}) {
    if (!sala || !nome) return;
    const th = !!thAgora();
    enviando += 1;
    try {
      const r = await fetch('/api/sala', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ id: sala, acao, jogador: nome, th: acao === 'bau' ? th : false }, extra)),
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      enviando -= 1;
      if (j.aviso === 'nada_a_fazer') flash(acao === 'desfazer' ? 'Nada para desfazer nesta partida' : 'Nada a fazer');
      receber(j.dados || {});
      dot('ok');
    } catch {
      enviando -= 1;
      dot('bad');
      flash('Não salvou. Aperte de novo.');
    }
    ultimaMudanca = Date.now();
    clearTimeout(timer);
    timer = setTimeout(puxar, 2500);
  }

  // ---------- feedback ----------
  function flash(txt) {
    const f = $('#ov-flash');
    f.textContent = txt;
    f.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => f.classList.remove('on'), 1600);
  }
  function aviso(txt) {
    const a = $('#ov-aviso');
    a.textContent = txt;
    a.hidden = !txt;
  }
  const rotulo = { normal: 'baú', raro: 'baú raro', enterrado: 'baú enterrado', sprite: 'baú de Sprite' };
  function flashDoUltimo(d) {
    const [q, o, , k] = String(d.ult || '').split('|');
    if (rotulo[o]) flash(`+1 ${rotulo[o]} · ${q === nome ? 'você' : q}`);
    else if (o === 'fim') flash(`Partida #${k} encerrada`);
    else if (o === 'desfez') flash(`${q === nome ? 'Você' : q} desfez um baú`);
    else if (o === 'token') flash('TOKEN!');
  }

  // ---------- tela ----------
  const thAgora = () => {
    const agora = Date.now();
    return agenda.find((r) => r.tipo === 'treasure_hour' && new Date(r.inicio).getTime() <= agora && new Date(r.fim).getTime() > agora) || null;
  };
  const proxTH = () => {
    const agora = Date.now();
    return agenda.filter((r) => r.tipo === 'treasure_hour' && new Date(r.inicio).getTime() > agora).sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0] || null;
  };
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  };
  const falta = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)} d ${h % 24} h`;
  };

  function render() {
    if (!sala || !nome) return;
    const d = dados;
    const agora = Date.now();
    const k = num(d.partida);
    const aberta = d.aberta === '1';
    const pre = `m${k}:`;

    $('#ov-partida').textContent = aberta ? `Partida #${k}` : `Sem partida aberta · próxima #${k + 1}`;
    $('#ov-tempo').textContent = aberta ? mmss(agora - num(d[pre + 'inicio'])) : '';
    $('#ov-baus').textContent = int(aberta ? num(d[pre + 'baus']) : 0);

    const jog = [];
    if (aberta) Object.entries(d).forEach(([f, v]) => { if (f.startsWith(pre + 'p:') && num(v) > 0) jog.push([f.slice(pre.length + 2), num(v)]); });
    jog.sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...jog.map((x) => x[1]));
    const ol = $('#ov-jog');
    ol.replaceChildren();
    jog.forEach(([n, v], i) => {
      const li = el('li', n === nome ? 'eu' : '');
      li.append(el('span', null, (i === 0 ? '👑 ' : '') + n), el('b', null, int(v)));
      const barra = el('i');
      const fill = el('span');
      fill.style.width = (v / max) * 100 + '%';
      barra.appendChild(fill);
      li.appendChild(barra);
      ol.appendChild(li);
    });

    const totais = [];
    Object.entries(d).forEach(([f, v]) => { const m = f.match(/^t:p:(.+)$/); if (m && num(v) > 0) totais.push([m[1], num(v)]); });
    totais.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const fech = num(d['t:fechadas']);
    $('#ov-total').textContent = `Caçada: ${int(num(d['t:baus']))} baús · ${int(fech)} ${fech === 1 ? 'partida' : 'partidas'}`;
    const top = totais.slice(0, 3).map(([n, v], i) => `${MEDALHAS[i]} ${n} ${int(v)}`);
    const pos = totais.findIndex(([n]) => n === nome);
    if (pos >= 3) top.push(`você ${pos + 1}º (${int(totais[pos][1])})`);
    $('#ov-rank').textContent = top.join(' · ');

    const th = thAgora();
    const thEl = $('#ov-th');
    thEl.classList.toggle('agora', !!th);
    if (th) thEl.textContent = `TREASURE HOUR ×${NF1.format(odds.mult)} até ${fHora.format(new Date(th.fim))}`;
    else {
      const p = proxTH();
      thEl.textContent = p ? `Próxima Treasure Hour: ${fDia.format(new Date(p.inicio))} (em ${falta(new Date(p.inicio).getTime() - agora)})` : '';
    }

    const tok = $('#ov-token');
    if (d.achou) { tok.hidden = false; tok.textContent = `${String(d.achou).split('|')[0]} achou o token! Ninguém sai da partida.`; }
    else tok.hidden = true;

    if (fimArmado && agora > fimArmado) fimArmado = 0;
  }

  function ajuda(on) {
    const a = $('#ov-ajuda');
    a.hidden = !on;
    if (!on) return;
    a.replaceChildren();
    const linhas = desktop
      ? [[atalhos.bau, '+1 baú'], [atalhos.desfazer, 'desfazer seu último'], [atalhos.fim, '2× = fim da partida'], [atalhos.mostrar, 'mostrar/ocultar'], [atalhos.mover, 'terminar de mover']]
      : [['B', '+1 baú'], ['D', 'desfazer'], ['F', '2× = fim da partida']];
    linhas.forEach(([tecla, oque]) => {
      const p = el('div');
      p.append(el('kbd', null, tecla), ' ' + oque);
      a.appendChild(p);
    });
    if (desktop) a.appendChild(el('div', null, 'Arraste para mover. Tamanho: ícone perto do relógio.'));
  }

  // ---------- comandos (atalhos do app ou teclado no navegador) ----------
  function comando(c) {
    if (c === 'bau') acionar('bau', { tipo: 'normal' });
    else if (c === 'desfazer') acionar('desfazer');
    else if (c === 'fim') {
      const aberta = dados.aberta === '1';
      if (!aberta) { flash('Nenhuma partida aberta'); return; }
      const agora = Date.now();
      if (fimArmado && agora <= fimArmado) { fimArmado = 0; acionar('fechar'); }
      else { fimArmado = agora + 2500; flash(`Aperte de novo para encerrar a partida #${num(dados.partida)}`); }
    }
  }

  if (desktop) {
    desktop.onAtalho(comando);
    desktop.onMover((on) => { document.body.classList.toggle('movendo', on); ajuda(on); });
    if (desktop.atalhos) desktop.atalhos().then((a) => { if (a) atalhos = a; }).catch(() => {});
  } else {
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'b') comando('bau');
      else if (k === 'd') comando('desfazer');
      else if (k === 'f') comando('fim');
      else if (k === '?' || k === 'h') ajuda($('#ov-ajuda').hidden);
    });
  }

  // ---------- início ----------
  function iniciar() {
    $('#ov-config').hidden = true;
    $('#painel').hidden = false;
    LS.set('tp-sala', sala);
    LS.set('tp-nome', nome);
    render();
    puxar();
  }
  if (sala && nome) iniciar();
  else {
    $('#painel').hidden = true;
    $('#ov-config').hidden = false;
    $('#cf-nome').value = nome;
    $('#cf-sala').value = sala;
    $('#ov-config').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = limparNome($('#cf-nome').value);
      const s = limparSala($('#cf-sala').value);
      if (!n || s.length < 3) return;
      nome = n;
      sala = s;
      iniciar();
    });
  }
  setInterval(render, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) puxar(); });
})();
