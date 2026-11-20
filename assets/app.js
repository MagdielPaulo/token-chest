'use strict';
(() => {
  // ---------- formatação e utilidades ----------
  const NF0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const NF3 = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 2 });
  const NFM = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const int = (v) => (v === null || v === undefined ? '—' : NF0.format(v));
  const pct = (v) => NF1.format(v) + '%';
  const TZ = 'America/Sao_Paulo';
  const fDataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const COR = { 'Dupla A': 'var(--c0)', 'Dupla B': 'var(--c1)', Squad: 'var(--c2)' };
  const COR_CLS = { 'Dupla A': 'a', 'Dupla B': 'b', Squad: 's' };
  const METRICAS = { total: 'Total de baús', padrao: 'Baús padrão', enterrados: 'Baús enterrados', raros: 'Baús raros', cartazes: 'Cartazes de Procurado' };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } },
  };
  const POS_KEY = 'tp-posicoes-v1';
  const CALC_KEY = 'tp-calc-v1';
  const FUNDO_KEY = 'tp-fundo-v1';

  const state = {
    metric: 'total', selected: 'rubber-resort', route: 'r1',
    cartazes: false, marcos: true, ilha: true,
    calibrar: false, fundo: null, opacidade: 0.7,
    sort: { key: 'total', dir: -1 },
    calc: Object.assign({ ritmo: 120, horas: 3, th: true }, LS.get(CALC_KEY, {})),
  };
  let D = null;
  let posOriginais = {};

  // ---------- dados derivados ----------
  const poiById = (id) => D.pois.find((p) => p.id === id);
  const totalPoi = (p) => (p.padrao === null && p.enterrados === null && p.raros === null ? null : (p.padrao || 0) + (p.enterrados || 0) + (p.raros || 0));
  const valor = (p, m) => (m === 'total' ? totalPoi(p) : p[m]);
  const tokenOdds = () => {
    const t = D.odds.find((r) => r.item.startsWith('Pirate Shop'));
    const p = 1 / t.chance_1_em;
    return { p, pTH: p * t.mult_th, mult: t.mult_th, umEm: t.chance_1_em };
  };
  const fimMs = () => new Date(D.agenda.find((r) => r.tipo === 'fim').inicio).getTime();
  const sessoesRestantes = (agora) => D.agenda.filter((r) => r.tipo === 'treasure_hour' && new Date(r.fim).getTime() > agora && new Date(r.inicio).getTime() < fimMs());

  function simular(ritmo, horas, usarTH, agora = Date.now()) {
    const { p, pTH } = tokenOdds();
    const fim = fimMs();
    const dias = Math.max(0, (fim - agora) / 864e5);
    const porDia = new Map();
    D.agenda.filter((r) => r.tipo === 'treasure_hour').forEach((r) => {
      const ini = Math.max(new Date(r.inicio).getTime(), agora);
      const f = Math.min(new Date(r.fim).getTime(), fim);
      if (f <= ini) return;
      const dia = r.inicio.slice(0, 10);
      porDia.set(dia, (porDia.get(dia) || 0) + (f - ini) / 36e5);
    });
    const totalH = horas * dias;
    let thH = 0;
    if (usarTH) porDia.forEach((h) => { thH += Math.min(horas, h); });
    thH = Math.min(thH, totalH);
    const nN = ritmo * (totalH - thH);
    const nT = ritmo * thH;
    return { dias, totalH, baus: nN + nT, chance: 1 - Math.pow(1 - p, nN) * Math.pow(1 - pTH, nT) };
  }

  const rotaTotal = (r) => {
    if (r.baus_estimados) return r.baus_estimados;
    const vistos = new Set();
    let soma = 0;
    r.passos.forEach((s) => {
      if (s.poi && !vistos.has(s.poi)) { vistos.add(s.poi); soma += totalPoi(poiById(s.poi)) || 0; }
      if (!s.poi && s.baus) soma += s.baus;
    });
    return soma;
  };

  // ---------- tooltip ----------
  function showTip(box, tip, event, linhas) {
    tip.replaceChildren();
    tip.appendChild(el('b', null, linhas[0]));
    linhas.slice(1).filter(Boolean).forEach((t) => tip.appendChild(el('div', null, t)));
    tip.hidden = false;
    const r = box.getBoundingClientRect();
    const x = event.clientX - r.left;
    const y = event.clientY - r.top;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = x + 14;
    if (left + tw > r.width) left = Math.max(4, x - tw - 14);
    let top = y - th - 12;
    if (top < 4) top = y + 16;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = (tip) => { tip.hidden = true; };
  const textW = (sel, cls, textos, attrs = {}) => {
    let w = 0;
    textos.forEach((t) => {
      const n = sel.append('text').attr('class', cls).text(t);
      Object.entries(attrs).forEach(([k, v]) => n.attr(k, v));
      w = Math.max(w, n.node().getComputedTextLength());
      n.remove();
    });
    return Math.ceil(w);
  };

  // ---------- topo: números e contagem regressiva ----------
  function renderTopo() {
    const agora = Date.now();
    const o = tokenOdds();
    const plano = simular(state.calc.ritmo, state.calc.horas, state.calc.th, agora);
    const vals = {
      dias: int(Math.floor(Math.max(0, (fimMs() - agora) / 864e5))),
      sessoes: int(sessoesRestantes(agora).length),
      umEm: int(o.umEm),
      umEmTH: int(Math.round(1 / o.pTH)),
      mult: NFM.format(o.mult) + '×',
      b50: int(Math.round(Math.log(2) / -Math.log1p(-o.p))),
      b50th: int(Math.round(Math.log(2) / -Math.log1p(-o.pTH))),
      chancePlano: pct(Math.round(plano.chance * 1000) / 10),
    };
    $$('[data-k]').forEach((n) => { const k = n.getAttribute('data-k'); if (k in vals) n.textContent = vals[k]; });
  }

  function tick() {
    const agora = Date.now();
    const box = $('#countdown');
    const atual = D.agenda.find((r) => r.tipo === 'treasure_hour' && new Date(r.inicio).getTime() <= agora && new Date(r.fim).getTime() > agora);
    const prox = D.agenda.filter((r) => r.tipo === 'treasure_hour' && new Date(r.inicio).getTime() > agora).sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0];
    const fmtDur = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      const p2 = (n) => String(n).padStart(2, '0');
      return (d ? d + 'd ' : '') + p2(h) + ':' + p2(m) + ':' + p2(ss);
    };
    if (atual) {
      box.classList.add('is-live');
      $('#cd-label').textContent = 'Treasure Hour acontecendo agora';
      $('#cd-when').textContent = 'Termina às ' + fHora.format(new Date(atual.fim)) + ' · chance do token ' + NFM.format(tokenOdds().mult) + '×';
      $('#cd-timer').textContent = fmtDur(new Date(atual.fim).getTime() - agora);
    } else if (prox) {
      box.classList.remove('is-live');
      $('#cd-label').textContent = 'Próxima Treasure Hour';
      $('#cd-when').textContent = fDataHora.format(new Date(prox.inicio)) + ' – ' + fHora.format(new Date(prox.fim));
      $('#cd-timer').textContent = 'em ' + fmtDur(new Date(prox.inicio).getTime() - agora);
    } else {
      box.classList.remove('is-live');
      $('#cd-label').textContent = 'Treasure Hours';
      $('#cd-when').textContent = 'Não há mais sessões nesta mini-temporada';
      $('#cd-timer').textContent = '—';
    }
  }

  // ---------- mapa ----------
  const S = 1000;
  const ILHA = {
    principal: [[200, 150], [310, 95], [430, 72], [560, 82], [665, 112], [728, 180], [760, 260], [790, 340], [780, 430], [752, 520], [760, 600], [730, 690], [680, 760], [640, 840], [600, 915], [520, 945], [440, 925], [390, 870], [330, 860], [270, 830], [235, 760], [215, 680], [190, 600], [205, 520], [175, 440], [200, 360], [215, 290], [185, 220]],
    ilhas: [
      [[60, 95], [130, 70], [178, 108], [168, 172], [105, 192], [55, 160]],
      [[38, 410], [110, 395], [142, 450], [122, 515], [55, 522], [28, 470]],
      [[85, 730], [165, 712], [208, 770], [188, 842], [110, 852], [68, 800]],
      [[745, 88], [832, 78], [882, 128], [862, 196], [790, 212], [744, 160]],
      [[740, 758], [812, 742], [838, 790], [808, 838], [752, 832], [728, 795]],
      [[838, 818], [892, 808], [912, 853], [882, 892], [836, 880]],
      [[842, 468], [902, 462], [914, 505], [882, 532], [844, 516]],
    ],
    baias: [{ cx: 500, cy: 768, rx: 78, ry: 46 }, { cx: 268, cy: 250, rx: 62, ry: 44 }],
    ilhotas: [[250, 244, 13], [287, 262, 10], [300, 234, 8], [505, 770, 14]],
    pontes: [[[152, 160], [207, 205]], [[132, 456], [182, 450]], [[798, 205], [760, 250]]],
  };

  function desenharIlha(g) {
    const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
    g.selectAll('line.m-ponte').data(ILHA.pontes).join('line').attr('class', 'm-ponte')
      .attr('x1', (d) => d[0][0]).attr('y1', (d) => d[0][1]).attr('x2', (d) => d[1][0]).attr('y2', (d) => d[1][1]);
    g.append('path').attr('class', 'm-terra').attr('d', line(ILHA.principal));
    g.selectAll('path.ilha').data(ILHA.ilhas).join('path').attr('class', 'm-terra ilha').attr('d', (d) => line(d));
    g.selectAll('ellipse').data(ILHA.baias).join('ellipse').attr('class', 'm-baia')
      .attr('cx', (d) => d.cx).attr('cy', (d) => d.cy).attr('rx', (d) => d.rx).attr('ry', (d) => d.ry);
    g.selectAll('circle').data(ILHA.ilhotas).join('circle').attr('class', 'm-terra')
      .attr('cx', (d) => d[0]).attr('cy', (d) => d[1]).attr('r', (d) => d[2]);
  }

  const pontoPasso = (s) => { if (s.poi) { const p = poiById(s.poi); return [p.x * S, p.y * S]; } return [s.x * S, s.y * S]; };

  function renderMapa() {
    const svg = d3.select('#mapa-svg');
    const box = $('.map-box');
    const tip = $('#map-tip');
    svg.selectAll('*').remove();
    box.classList.toggle('calibrando', state.calibrar);
    const largura = svg.node().getBoundingClientRect().width || 700;
    const k = S / largura;
    const estreito = largura < 560;
    const fsLab = clamp(13 * k, 18, 40);
    const fsRef = clamp(11.5 * k, 16, 34);

    const defs = svg.append('defs');
    Object.entries(COR).forEach(([quem, cor]) => {
      defs.append('marker').attr('id', 'seta-' + COR_CLS[quem]).attr('viewBox', '0 0 10 10').attr('refX', 8).attr('refY', 5)
        .attr('markerWidth', 4).attr('markerHeight', 4).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0,0 L10,5 L0,10 z').style('fill', cor);
    });

    svg.append('rect').attr('class', 'm-agua').attr('width', S).attr('height', S);
    if (state.fundo) {
      svg.append('image').attr('href', state.fundo).attr('width', S).attr('height', S)
        .attr('preserveAspectRatio', 'none').style('opacity', state.opacidade);
    }
    if (state.ilha) desenharIlha(svg.append('g').style('opacity', state.fundo ? 0.3 : 1));

    if (state.marcos) {
      const g = svg.append('g');
      const rotaAtiva = D.rotas.find((r) => r.id === state.route);
      const perto = (m) => rotaAtiva && rotaAtiva.passos.some((s) => !s.poi && Math.hypot(s.x - m.x, s.y - m.y) < 0.03);
      D.marcos.referencias.forEach((m) => {
        g.append('circle').attr('class', 'm-ref-dot').attr('cx', m.x * S).attr('cy', m.y * S).attr('r', 4 * k / 1.4);
        if (perto(m) || estreito) return;
        const anc = m.ancora || 'start';
        g.append('text').attr('class', 'm-ref').attr('x', m.x * S + (anc === 'end' ? -6 : 6)).attr('y', m.y * S + fsRef * 1.1)
          .attr('text-anchor', anc).style('font-size', fsRef + 'px').text(m.nome);
      });
    }

    if (state.cartazes) {
      const g = svg.append('g');
      const rC = d3.scaleSqrt().domain([0, 4]).range([0, 16 * Math.max(1, k / 1.6)]);
      D.marcos.cartazes_estrada.forEach((c) => {
        const r = rC(c.n);
        const gg = g.append('g').attr('transform', `translate(${c.x * S},${c.y * S})`).style('cursor', 'help');
        gg.append('rect').attr('class', 'm-cartaz').attr('x', -r).attr('y', -r).attr('width', 2 * r).attr('height', 2 * r).attr('transform', 'rotate(45)');
        gg.append('text').attr('class', 'm-cartaz-t').attr('text-anchor', 'middle').attr('dy', '0.35em').style('font-size', fsRef + 'px').text(c.n);
        gg.on('pointermove', (ev) => showTip(box, tip, ev, ['Cartazes de Procurado na estrada', c.onde, c.n + (c.n === 1 ? ' ponto possível' : ' pontos possíveis')]))
          .on('pointerleave', () => hideTip(tip));
      });
    }

    const m = state.metric;
    const valores = D.pois.map((p) => valor(p, m)).filter((v) => v !== null);
    const rS = d3.scaleSqrt().domain([0, d3.max(valores) || 1]).range([6 * Math.max(1, k / 1.6), 38 * Math.max(1, k / 2)]);
    const raio = (p) => { const v = valor(p, m); return v === null ? 11 * Math.max(1, k / 1.6) : rS(v); };

    const rota = D.rotas.find((r) => r.id === state.route);
    if (rota) {
      const g = svg.append('g');
      const segs = [];
      let duplas = [];
      let prev = null;
      rota.passos.forEach((s) => {
        const pt = pontoPasso(s);
        const destR = s.poi ? raio(poiById(s.poi)) : 10;
        if (s.quem !== 'Squad') { duplas.push({ pt, quem: s.quem }); return; }
        if (duplas.length) { duplas.forEach((dp) => segs.push({ a: dp.pt, b: pt, quem: dp.quem, rB: destR })); duplas = []; }
        else if (prev) segs.push({ a: prev.pt, b: pt, quem: 'Squad', rA: prev.r, rB: destR });
        prev = { pt, r: destR };
      });
      segs.forEach((sg) => {
        const [x1, y1] = sg.a;
        const [x2, y2] = sg.b;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const sa = (sg.rA || 18) + 6;
        const sb = sg.rB + 12;
        const ax = x1 + ux * sa;
        const ay = y1 + uy * sa;
        const bx = x2 - ux * sb;
        const by = y2 - uy * sb;
        const cx = (ax + bx) / 2 - uy * len * 0.12;
        const cy = (ay + by) / 2 + ux * len * 0.12;
        g.append('path').attr('class', 'm-rota').style('stroke', COR[sg.quem]).attr('stroke-width', 6 * Math.max(1, k / 1.8))
          .attr('d', `M${ax},${ay} Q${cx},${cy} ${bx},${by}`).attr('marker-end', `url(#seta-${COR_CLS[sg.quem]})`);
      });
      rota.passos.forEach((s, i) => {
        if (s.volta) return;
        const [x, y] = pontoPasso(s);
        const off = (s.poi ? raio(poiById(s.poi)) : 8) * 0.75 + 10;
        const rb = 15 * Math.max(1, k / 1.6);
        const gg = g.append('g').attr('transform', `translate(${x - off},${y - off})`);
        gg.append('circle').attr('class', 'm-passo').attr('r', rb).style('fill', COR[s.quem]);
        gg.append('text').attr('class', 'm-passo-t').attr('text-anchor', 'middle').attr('dy', '0.35em').style('font-size', rb * 1.1 + 'px').text(i + 1);
        if (!s.poi) {
          gg.append('text').attr('class', 'm-ref').attr('x', rb + 6).attr('dy', '0.35em').style('font-size', fsRef + 'px').text(s.local);
        }
      });
    }

    const gP = svg.append('g');
    const nodes = gP.selectAll('g.m-poi').data(D.pois, (d) => d.id).join('g')
      .attr('class', (d) => 'm-poi' + (d.id === state.selected ? ' is-sel' : ''))
      .attr('transform', (d) => `translate(${d.x * S},${d.y * S})`)
      .attr('tabindex', 0).attr('role', 'button')
      .attr('aria-label', (d) => `${d.nome}: ${METRICAS[m]} ${int(valor(d, m))}`);
    nodes.append('circle').attr('class', (d) => 'm-dot' + (valor(d, m) === null ? ' vazio' : '')).attr('r', raio);
    nodes.append('text').attr('class', 'm-val').attr('text-anchor', 'middle').attr('dy', '0.35em')
      .style('font-size', (d) => Math.min(raio(d) * 0.85, fsLab) + 'px')
      .text((d) => { const v = valor(d, m); return v !== null && raio(d) >= fsLab * 0.9 ? NF0.format(v) : ''; });
    const lado = (d) => d.rotulo || (d.x > 0.7 ? 'e' : 'd');
    nodes.append('text').attr('class', 'm-lab').style('font-size', fsLab + 'px').attr('dy', '0.35em')
      .attr('x', (d) => ({ d: raio(d) + 8, e: -(raio(d) + 8) }[lado(d)] || 0))
      .attr('y', (d) => ({ b: raio(d) + fsLab * 0.85, c: -(raio(d) + fsLab * 0.7) }[lado(d)] || 0))
      .attr('text-anchor', (d) => ({ d: 'start', e: 'end' }[lado(d)] || 'middle'))
      .text((d) => (estreito ? d.curto : d.nome))
      .on('click', (ev, d) => { if (!state.calibrar) selecionar(d.id); });
    nodes.filter((d) => d.chefe).append('text').attr('class', 'm-boss').attr('text-anchor', 'middle')
      .attr('x', (d) => raio(d) * 0.75).attr('y', (d) => -raio(d) * 0.75)
      .style('font-size', fsLab * 1.1 + 'px').text('☠');

    nodes.on('click', (ev, d) => { if (!state.calibrar) selecionar(d.id); })
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selecionar(d.id); } })
      .on('pointermove', (ev, d) => {
        if (state.calibrar) return;
        showTip(box, tip, ev, [d.nome, `${METRICAS[m]}: ${int(valor(d, m))}`, d.chefe ? 'Chefe: ' + d.chefe : '', 'Toque para ver detalhes']);
      })
      .on('pointerleave', () => hideTip(tip));

    if (state.calibrar) {
      nodes.call(d3.drag()
        .on('start', function () { d3.select(this).classed('dragging', true).raise(); hideTip(tip); })
        .on('drag', function (ev, d) {
          d.x = clamp(ev.x / S, 0, 1);
          d.y = clamp(ev.y / S, 0, 1);
          d3.select(this).attr('transform', `translate(${d.x * S},${d.y * S})`);
        })
        .on('end', function () { d3.select(this).classed('dragging', false); salvarPosicoes(); renderMapa(); }));
    }

    const legenda = $('#map-legend');
    legenda.replaceChildren();
    const add = (html) => { const s = el('span'); s.append(...html); legenda.appendChild(s); };
    add(['Círculo = ' + METRICAS[m].toLowerCase()]);
    add(['☠ chefe']);
    if (rota) {
      ['Dupla A', 'Dupla B', 'Squad'].forEach((q) => {
        if (rota.passos.some((s) => s.quem === q)) { const sw = el('i', 'sw'); sw.style.background = COR[q]; add([sw, q]); }
      });
    }
  }

  function salvarPosicoes() {
    const pos = {};
    D.pois.forEach((p) => { pos[p.id] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3) }; });
    LS.set(POS_KEY, pos);
  }

  // ---------- painel do local ----------
  function renderPainel() {
    const p = poiById(state.selected);
    const box = $('#painel');
    box.replaceChildren();
    if (!p) return;
    box.appendChild(el('h3', null, p.nome));
    if (p.antes) box.appendChild(el('p', 'antes', 'Antes: ' + p.antes));
    box.appendChild(el('p', 'reg', p.regiao));
    const tot = totalPoi(p);
    if (tot === null) {
      box.appendChild(el('p', 'nota', 'Ainda sem contagem pública de baús para este local.'));
    } else {
      const stack = el('div', 'stack');
      [['padrao', 'var(--c0)'], ['enterrados', 'var(--c1)'], ['raros', 'var(--c2)']].forEach(([key, cor]) => {
        const v = p[key] || 0;
        if (!v) return;
        const s = el('span');
        s.style.width = (v / tot) * 100 + '%';
        s.style.background = cor;
        s.title = METRICAS[key] + ': ' + v;
        stack.appendChild(s);
      });
      box.appendChild(stack);
      const nums = el('div', 'nums');
      [['Padrão', p.padrao, 'var(--c0)'], ['Enterr.', p.enterrados, 'var(--c1)'], ['Raros', p.raros, 'var(--c2)'], ['Total', tot, null]].forEach(([l, v, cor]) => {
        const d = el('div');
        const b = el('b', null, int(v));
        const sm = el('small');
        if (cor) { const sw = el('i', 'sw'); sw.style.background = cor; sm.appendChild(sw); }
        sm.append(l);
        d.append(b, sm);
        nums.appendChild(d);
      });
      box.appendChild(nums);
    }
    const dl = el('dl', 'kv');
    const item = (dt, dd) => { dl.appendChild(el('dt', null, dt)); const x = el('dd'); if (typeof dd === 'string') x.textContent = dd; else x.appendChild(dd); dl.appendChild(x); };
    item('Cartazes de Procurado', p.cartazes === null ? 'Sem dados' : int(p.cartazes) + ' pontos possíveis');
    if (p.sprites.length) {
      const c = el('div', 'chips');
      p.sprites.forEach((s) => c.appendChild(el('span', 'chip', s)));
      item('Sprites Fortune', c);
    }
    if (p.chefe) {
      const ch = D.chefes.find((c) => c.poi === p.id);
      item('Chefe', p.chefe + (ch ? ' · drops: ' + ch.drops.join(', ') : ''));
    }
    if (p.capitaes) item('Capitães', p.capitaes);
    const rotas = D.rotas.filter((r) => r.passos.some((s) => s.poi === p.id));
    if (rotas.length) {
      const c = el('div', 'chips');
      rotas.forEach((r) => {
        const passo = r.passos.find((s) => s.poi === p.id);
        c.appendChild(el('span', 'chip ' + COR_CLS[passo.quem], r.nome.split(' · ')[0] + ' · ' + passo.quem));
      });
      item('Nas rotas', c);
    }
    box.appendChild(dl);
    if (p.nota) box.appendChild(el('p', 'nota', p.nota));
  }

  function selecionar(id) {
    state.selected = id;
    renderMapa();
    renderPainel();
    renderRanking();
    renderTabelaPois();
  }

  // ---------- rotas ----------
  function renderRotas() {
    const box = $('#routes');
    box.replaceChildren();
    D.rotas.forEach((r) => {
      const card = el('button', 'card route' + (r.id === state.route ? ' is-sel' : ''));
      card.type = 'button';
      card.setAttribute('aria-pressed', String(r.id === state.route));
      const top = el('div', 'route-top');
      top.append(el('h3', null, r.nome), el('span', 'tag', r.tag));
      card.appendChild(top);
      card.appendChild(el('p', 'route-sum', '≈ ' + int(rotaTotal(r)) + ' baús possíveis no caminho. ' + r.resumo));
      const ol = el('ol', 'steps');
      r.passos.forEach((s, i) => {
        const li = el('li', 'step');
        const n = el('span', 'step-n', String(i + 1));
        n.style.background = COR[s.quem];
        const body = el('div');
        const chip = el('span', 'chip ' + COR_CLS[s.quem], s.quem);
        const nome = el('b', null, ' ' + (s.poi ? poiById(s.poi).nome : s.local));
        body.append(chip, nome);
        const b = s.poi && !s.volta ? totalPoi(poiById(s.poi)) : s.baus;
        if (b) body.appendChild(el('span', 'step-b', ' · ' + int(b) + ' baús'));
        body.appendChild(el('p', null, s.acao));
        li.append(n, body);
        ol.appendChild(li);
      });
      card.appendChild(ol);
      card.addEventListener('click', () => {
        state.route = r.id;
        $('#sel-rota').value = r.id;
        renderRotas();
        renderMapa();
        $('#mapa').scrollIntoView();
      });
      box.appendChild(card);
    });
  }

  // ---------- estatísticas ----------
  function renderFatos() {
    const box = $('#facts');
    box.replaceChildren();
    D.fatos.forEach((f) => {
      const c = el('div', 'card');
      c.append(el('p', 'kpi-l', f.rotulo), el('p', 'kpi-v', int(f.valor)), el('p', 'kpi-n', f.nota));
      box.appendChild(c);
    });
  }

  function renderRanking() {
    const box = $('#chart-rank');
    const m = state.metric;
    const legend = $('#rank-legend');
    legend.replaceChildren();
    if (m === 'total') {
      [['Padrão', 'var(--c0)'], ['Enterrados', 'var(--c1)'], ['Raros', 'var(--c2)']].forEach(([l, c]) => {
        const li = el('li'); const sw = el('span', 'sw'); sw.style.background = c; li.append(sw, l); legend.appendChild(li);
      });
    }
    box.replaceChildren();
    const rows = D.pois.map((p) => ({ p, v: valor(p, m) })).sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
    const W = Math.max(280, box.clientWidth);
    const rowH = 30;
    const top = 4;
    const plotH = rows.length * rowH;
    const H = top + plotH + 26;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Ranking dos locais por ' + METRICAS[m].toLowerCase());
    const yl = svg.append('g').attr('class', 'yl');
    const labW = textW(yl, null, rows.map((r) => r.p.nome));
    yl.remove();
    const valW = textW(svg, 'vl', rows.map((r) => (r.v === null ? 'sem dados' : NF0.format(r.v))));
    const left = labW + 12;
    const right = valW + 12;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.v) || 1]).nice().range([left, W - right]);
    const y = d3.scaleBand().domain(rows.map((r) => r.p.id)).range([top, top + plotH]).padding(0.3);
    const nT = clamp(Math.floor((W - left - right) / 70), 2, 6);
    svg.append('g').attr('class', 'gr').selectAll('line').data(x.ticks(nT)).join('line')
      .attr('x1', (v) => x(v)).attr('x2', (v) => x(v)).attr('y1', top).attr('y2', top + plotH);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(0,${top + plotH})`)
      .call(d3.axisBottom(x).ticks(nT).tickSize(0).tickPadding(8).tickFormat((v) => NF0.format(v)))
      .call((g) => g.select('.domain').remove());
    svg.append('g').attr('class', 'yl').selectAll('text').data(rows).join('text')
      .attr('x', left - 8).attr('y', (r) => y(r.p.id) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
      .style('font-weight', (r) => (r.p.id === state.selected ? 700 : 400)).text((r) => r.p.nome);
    if (m === 'total') {
      const dados = rows.map((r) => ({ id: r.p.id, padrao: r.p.padrao || 0, enterrados: r.p.enterrados || 0, raros: r.p.raros || 0 }));
      const series = d3.stack().keys(['padrao', 'enterrados', 'raros'])(dados);
      svg.append('g').selectAll('g').data(series).join('g').style('fill', (s, i) => ['var(--c0)', 'var(--c1)', 'var(--c2)'][i])
        .selectAll('rect').data((s) => s).join('rect').attr('class', 'seg')
        .attr('x', (v) => x(v[0])).attr('width', (v) => Math.max(0, x(v[1]) - x(v[0])))
        .attr('y', (v) => y(v.data.id)).attr('height', y.bandwidth()).attr('rx', 2);
    } else {
      svg.append('g').selectAll('rect').data(rows.filter((r) => r.v !== null)).join('rect')
        .attr('class', (r) => 'bar' + (r.p.id === state.selected ? ' is-sel' : ''))
        .attr('x', left).attr('width', (r) => Math.max(0, x(r.v) - left))
        .attr('y', (r) => y(r.p.id)).attr('height', y.bandwidth()).attr('rx', 3).style('fill', 'var(--c0)');
    }
    svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'vl')
      .attr('x', (r) => (r.v === null ? left : x(r.v)) + 6).attr('y', (r) => y(r.p.id) + y.bandwidth() / 2).attr('dy', '0.35em')
      .text((r) => (r.v === null ? 'sem dados' : NF0.format(r.v)));
    const tip = el('div', 'tip');
    tip.hidden = true;
    box.appendChild(tip);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', 0).attr('width', W).attr('y', (r) => y(r.p.id) - (y.step() - y.bandwidth()) / 2).attr('height', y.step())
      .style('fill', 'transparent').style('cursor', 'pointer')
      .on('pointermove', (ev, r) => showTip(box, tip, ev, [r.p.nome,
        `Padrão ${int(r.p.padrao)} · Enterrados ${int(r.p.enterrados)} · Raros ${int(r.p.raros)}`,
        `Total ${int(totalPoi(r.p))} · Cartazes ${int(r.p.cartazes)}`, 'Toque para abrir no mapa']))
      .on('pointerleave', () => hideTip(tip))
      .on('click', (ev, r) => { selecionar(r.p.id); $('#mapa').scrollIntoView(); });
  }

  function renderTabelaPois() {
    const tb = $('#tabela-pois tbody');
    tb.replaceChildren();
    const { key, dir } = state.sort;
    const getV = (p) => (key === 'total' ? totalPoi(p) : p[key]);
    const rows = D.pois.slice().sort((a, b) => {
      const va = getV(a);
      const vb = getV(b);
      if (typeof va === 'string' || typeof vb === 'string') return dir * String(va).localeCompare(String(vb), 'pt-BR');
      return dir * ((va ?? -1) - (vb ?? -1));
    });
    rows.forEach((p) => {
      const tr = el('tr', 'clicavel' + (p.id === state.selected ? ' is-sel' : ''));
      const nome = el('td');
      nome.appendChild(el('b', null, p.nome));
      if (p.antes) nome.appendChild(el('div', 'muted', 'antes ' + p.antes));
      tr.appendChild(nome);
      [p.padrao, p.enterrados, p.raros, totalPoi(p), p.cartazes].forEach((v) => tr.appendChild(el('td', 'num', int(v))));
      tr.appendChild(el('td', null, p.sprites.join(', ') || '—'));
      tr.appendChild(el('td', null, p.chefe || '—'));
      tr.addEventListener('click', () => { selecionar(p.id); $('#mapa').scrollIntoView(); });
      tb.appendChild(tr);
    });
    $$('#tabela-pois th button').forEach((b) => {
      const k = b.getAttribute('data-sort');
      b.setAttribute('aria-sort', k === key ? (dir < 0 ? 'descending' : 'ascending') : 'none');
    });
  }

  function renderListas() {
    const lc = $('#lista-chefes');
    lc.replaceChildren();
    D.chefes.forEach((c) => {
      const li = el('li');
      li.appendChild(el('b', null, c.nome + ' · ' + poiById(c.poi).nome));
      li.appendChild(el('span', null, 'Desde ' + c.desde.split('-').reverse().slice(0, 2).join('/') + '. Drops: ' + c.drops.join(', ') + '.'));
      lc.appendChild(li);
    });
    const ls = $('#lista-sprites');
    ls.replaceChildren();
    const mapa = new Map();
    D.pois.forEach((p) => p.sprites.forEach((s) => { if (!mapa.has(s)) mapa.set(s, []); mapa.get(s).push(p.nome); }));
    [...mapa].sort((a, b) => a[0].localeCompare(b[0])).forEach(([s, locais]) => {
      const li = el('li');
      li.append(el('b', null, s), el('span', null, locais.join(' e ')));
      ls.appendChild(li);
    });
  }

  // ---------- chances ----------
  function cenarios() {
    const linhas = [];
    D.ritmos.forEach((r) => [2, 3, 4].forEach((h) => {
      const s = simular(r.baus_por_hora, h, true);
      linhas.push({ cenario: r.cenario, ritmo: r.baus_por_hora, horas: h, baus: Math.round(s.baus), chance: Math.round(s.chance * 1000) / 10 });
    }));
    return linhas;
  }

  function renderCenarios() {
    const rows = cenarios();
    const box = $('#chart-cenarios');
    box.replaceChildren();
    const grupos = [...new Set(rows.map((r) => r.cenario))];
    const horas = [2, 3, 4];
    const cores = ['var(--c0)', 'var(--c1)', 'var(--c2)'];
    const W = Math.max(280, box.clientWidth);
    const top = 4;
    const gH = horas.length * 18 + 20;
    const plotH = grupos.length * gH;
    const H = top + plotH + 26;
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Chance de token do squad até o fim para cada ritmo e 2, 3 ou 4 horas por dia');
    const yl = svg.append('g').attr('class', 'yl');
    const labW = textW(yl, null, grupos);
    yl.remove();
    const valW = textW(svg, 'vl', rows.map((r) => pct(r.chance)));
    const left = labW + 12;
    const right = valW + 12;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.chance) || 1]).nice().range([left, W - right]);
    const y0 = d3.scaleBand().domain(grupos).range([top, top + plotH]).paddingInner(0.2);
    const y1 = d3.scaleBand().domain(horas).range([0, y0.bandwidth()]).padding(0.14);
    const nT = clamp(Math.floor((W - left - right) / 70), 2, 6);
    svg.append('g').attr('class', 'gr').selectAll('line').data(x.ticks(nT)).join('line')
      .attr('x1', (v) => x(v)).attr('x2', (v) => x(v)).attr('y1', top).attr('y2', top + plotH);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(0,${top + plotH})`)
      .call(d3.axisBottom(x).ticks(nT).tickSize(0).tickPadding(8).tickFormat((v) => NF0.format(v) + '%'))
      .call((g) => g.select('.domain').remove());
    svg.append('g').attr('class', 'yl').selectAll('text').data(grupos).join('text')
      .attr('x', left - 8).attr('y', (g) => y0(g) + y0.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((g) => g);
    const by = (r) => y0(r.cenario) + y1(r.horas);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', left).attr('width', (r) => Math.max(0, x(r.chance) - left)).attr('y', by).attr('height', y1.bandwidth()).attr('rx', 3)
      .style('fill', (r) => cores[horas.indexOf(r.horas)]);
    svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'vl')
      .attr('x', (r) => x(r.chance) + 6).attr('y', (r) => by(r) + y1.bandwidth() / 2).attr('dy', '0.35em').text((r) => pct(r.chance));
    const tip = el('div', 'tip');
    tip.hidden = true;
    box.appendChild(tip);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', 0).attr('width', W).attr('y', by).attr('height', y1.step()).style('fill', 'transparent')
      .on('pointermove', (ev, r) => showTip(box, tip, ev, [`${r.cenario} · ${r.horas} h por dia`, `${int(r.ritmo)} baús por hora`, `${int(r.baus)} baús até o fim`, `Chance de token: ${pct(r.chance)}`]))
      .on('pointerleave', () => hideTip(tip));

    const tb = $('#tabela-cenarios tbody');
    tb.replaceChildren();
    rows.forEach((r) => {
      const tr = el('tr');
      [[r.cenario, ''], [int(r.ritmo), 'num'], [int(r.horas), 'num'], [int(r.baus), 'num'], [pct(r.chance), 'num']].forEach(([t, c]) => tr.appendChild(el('td', c, t)));
      tb.appendChild(tr);
    });
  }

  function renderCurva() {
    const box = $('#chart-curva');
    box.replaceChildren();
    const { p, pTH } = tokenOdds();
    const rows = [];
    for (let b = 0; b <= 300000; b += 5000) rows.push({ b, n: (1 - Math.pow(1 - p, b)) * 100, t: (1 - Math.pow(1 - pTH, b)) * 100 });
    const last = rows[rows.length - 1];
    const W = Math.max(280, box.clientWidth);
    const H = Math.round(clamp(W * 0.48, 240, 360));
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Chance de pelo menos um token conforme os baús abertos, normal e em Treasure Hour');
    const yW = textW(svg, 'tick-t', ['100%']);
    const endW = textW(svg, 'vl', [pct(last.n), pct(last.t)]);
    const left = yW + 10;
    const right = endW + 12;
    const top = 12;
    const bottom = 28;
    const x = d3.scaleLinear().domain([0, last.b]).range([left, W - right]);
    const y = d3.scaleLinear().domain([0, 100]).range([H - bottom, top]);
    const yT = [0, 25, 50, 75, 100];
    svg.append('g').attr('class', 'gr').selectAll('line').data(yT).join('line').attr('x1', left).attr('x2', W - right).attr('y1', y).attr('y2', y);
    svg.append('g').selectAll('text').data(yT).join('text').attr('class', 'tick-t').attr('x', left - 6).attr('y', y).attr('dy', '0.35em').attr('text-anchor', 'end').text((v) => v + '%');
    const nX = clamp(Math.floor((W - left - right) / 85), 2, 6);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(0,${H - bottom})`)
      .call(d3.axisBottom(x).ticks(nX).tickSize(0).tickPadding(8).tickFormat((v) => (v === 0 ? '0' : NF0.format(v / 1000) + ' mil baús')))
      .call((g) => g.select('.domain').remove());
    svg.append('line').attr('class', 'ref').attr('x1', left).attr('x2', W - right).attr('y1', y(50)).attr('y2', y(50));
    [['n', 'var(--c0)'], ['t', 'var(--c1)']].forEach(([k, c]) => {
      svg.append('path').datum(rows).attr('fill', 'none').attr('stroke-width', 2).style('stroke', c)
        .attr('d', d3.line().x((r) => x(r.b)).y((r) => y(r[k])));
    });
    let yN = y(last.n);
    let yTt = y(last.t);
    if (yN - yTt < 15) { const mid = (yN + yTt) / 2; yN = mid + 7.5; yTt = mid - 7.5; }
    svg.append('text').attr('class', 'vl').attr('x', W - right + 6).attr('y', yN).attr('dy', '0.35em').text(pct(last.n));
    svg.append('text').attr('class', 'vl').attr('x', W - right + 6).attr('y', yTt).attr('dy', '0.35em').text(pct(last.t));

    const plano = simular(state.calc.ritmo, state.calc.horas, state.calc.th);
    const vx = x(Math.min(plano.baus, last.b));
    svg.append('line').attr('class', 'ref').attr('x1', vx).attr('x2', vx).attr('y1', top).attr('y2', H - bottom);
    svg.append('circle').attr('cx', vx).attr('cy', y(plano.chance * 100)).attr('r', 5).style('fill', 'var(--fg)').style('stroke', 'var(--bg)').style('stroke-width', 2);
    const txt = `Seu plano: ${int(Math.round(plano.baus))} baús · ${pct(Math.round(plano.chance * 1000) / 10)}`;
    const tw = textW(svg, 'ref-t', [txt]);
    const lx = vx + 8 + tw > W - right ? vx - 8 : vx + 8;
    svg.append('text').attr('class', 'ref-t').attr('x', lx).attr('y', top + 12).attr('text-anchor', lx < vx ? 'end' : 'start').text(txt);

    const tip = el('div', 'tip');
    tip.hidden = true;
    box.appendChild(tip);
    const guia = svg.append('line').attr('class', 'ref').attr('y1', top).attr('y2', H - bottom).style('opacity', 0);
    const bis = d3.bisector((r) => r.b).center;
    svg.append('rect').attr('x', left).attr('width', W - left - right).attr('y', top).attr('height', H - top - bottom).style('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px] = d3.pointer(ev, svg.node());
        const r = rows[bis(rows, x.invert(px))];
        guia.attr('x1', x(r.b)).attr('x2', x(r.b)).style('opacity', 1);
        showTip(box, tip, ev, [`${int(r.b)} baús abertos`, `Chance normal: ${pct(Math.round(r.n * 10) / 10)}`, `Tudo em Treasure Hour: ${pct(Math.round(r.t * 10) / 10)}`]);
      })
      .on('pointerleave', () => { hideTip(tip); guia.style('opacity', 0); });
  }

  // ---------- calculadora ----------
  function renderCalc() {
    const c = state.calc;
    $('#i-ritmo').value = c.ritmo;
    $('#i-horas').value = c.horas;
    $('#i-th').checked = c.th;
    $('#o-ritmo').textContent = int(c.ritmo);
    $('#o-horas').textContent = int(c.horas);
    const s = simular(c.ritmo, c.horas, c.th);
    $('#r-baus').textContent = int(Math.round(s.baus));
    $('#r-chance').textContent = pct(Math.round(s.chance * 1000) / 10);
    $('#r-horas').textContent = int(Math.round(s.totalH));
    const b50 = Math.log(2) / -Math.log1p(-tokenOdds().p);
    $('#r-frase').textContent = `Nesse ritmo, chegar a 50% de chance pediria cerca de ${int(Math.round(b50 / c.ritmo))} horas de jogo na chance normal. Cada baú é um sorteio novo: a chance não "acumula" para quem está há mais tempo sem achar.`;
  }

  // ---------- agenda, prêmios e fontes ----------
  function renderAgenda() {
    const ol = $('#lista-agenda');
    ol.replaceChildren();
    const agora = Date.now();
    let marcou = false;
    D.agenda.slice().sort((a, b) => new Date(a.inicio) - new Date(b.inicio)).forEach((r) => {
      const ini = new Date(r.inicio);
      const fim = r.fim ? new Date(r.fim) : null;
      const passou = (fim || ini).getTime() < agora;
      const li = el('li', 'ag');
      if (passou) li.classList.add('past');
      else if (!marcou) { li.classList.add('next'); marcou = true; }
      const quando = r.tipo === 'fim' ? '5/12 (sáb.)' : fDataHora.format(ini) + (fim ? ' – ' + fHora.format(fim) : '');
      const o = el('div');
      o.append(el('span', 'ag-ev', r.evento), el('span', 'ag-det', r.detalhe));
      li.append(el('span', 'ag-when', quando), o);
      ol.appendChild(li);
    });
  }

  function renderOdds() {
    const tb = $('#tabela-odds tbody');
    tb.replaceChildren();
    D.odds.forEach((r) => {
      const tr = el('tr');
      const nome = el('td');
      nome.appendChild(r.item.startsWith('Pirate Shop') ? el('b', null, r.item) : document.createTextNode(r.item));
      tr.appendChild(nome);
      tr.appendChild(el('td', 'num', int(r.chance_1_em)));
      tr.appendChild(el('td', 'num', NF3.format(100 / r.chance_1_em) + '%'));
      tr.appendChild(el('td', 'num', r.mult_th === 1 ? 'igual' : NFM.format(r.mult_th) + '×'));
      tb.appendChild(tr);
    });
  }

  function renderFontes() {
    const ul = $('#lista-fontes');
    ul.replaceChildren();
    D.fontes.forEach((f) => {
      const li = el('li');
      li.append(f.tema + ': ');
      f.links.forEach(([nome, url], i) => {
        if (i) li.append(', ');
        if (/^https?:\/\//.test(url)) {
          const a = el('a', null, nome);
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          li.appendChild(a);
        } else li.append(nome);
      });
      ul.appendChild(li);
    });
  }

  // ---------- controles ----------
  function setMetric(m) {
    state.metric = m;
    $('#sel-metrica').value = m;
    $('#sel-metrica-2').value = m;
    renderMapa();
    renderRanking();
  }

  function ligarControles() {
    $('#sel-metrica').addEventListener('change', (e) => setMetric(e.target.value));
    $('#sel-metrica-2').addEventListener('change', (e) => setMetric(e.target.value));
    $('#sel-rota').addEventListener('change', (e) => { state.route = e.target.value; renderRotas(); renderMapa(); });
    $('#chk-cartazes').addEventListener('change', (e) => { state.cartazes = e.target.checked; renderMapa(); });
    $('#chk-marcos').addEventListener('change', (e) => { state.marcos = e.target.checked; renderMapa(); });
    $('#chk-ilha').addEventListener('change', (e) => { state.ilha = e.target.checked; renderMapa(); });
    $('#chk-calibrar').addEventListener('change', (e) => { state.calibrar = e.target.checked; renderMapa(); });
    $('#in-opac').addEventListener('input', (e) => { state.opacidade = Number(e.target.value); renderMapa(); });
    $('#in-fundo').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const leitor = new FileReader();
      leitor.onload = () => {
        state.fundo = leitor.result;
        LS.set(FUNDO_KEY, state.fundo);
        renderMapa();
      };
      leitor.readAsDataURL(f);
    });
    $('#btn-sem-fundo').addEventListener('click', () => { state.fundo = null; LS.del(FUNDO_KEY); renderMapa(); });
    $('#btn-exportar').addEventListener('click', () => {
      const pos = {};
      D.pois.forEach((p) => { pos[p.id] = { x: +p.x.toFixed(3), y: +p.y.toFixed(3) }; });
      const blob = new Blob([JSON.stringify(pos, null, 2)], { type: 'application/json' });
      const a = el('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'posicoes-pois.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
    $('#btn-reset-pos').addEventListener('click', () => {
      LS.del(POS_KEY);
      D.pois.forEach((p) => { p.x = posOriginais[p.id].x; p.y = posOriginais[p.id].y; });
      renderMapa();
    });
    const onCalc = () => {
      state.calc = { ritmo: Number($('#i-ritmo').value), horas: Number($('#i-horas').value), th: $('#i-th').checked };
      LS.set(CALC_KEY, state.calc);
      renderCalc();
      renderCurva();
      renderTopo();
    };
    ['#i-ritmo', '#i-horas', '#i-th'].forEach((s) => $(s).addEventListener('input', onCalc));
    $$('#tabela-pois th button').forEach((b) => b.addEventListener('click', () => {
      const k = b.getAttribute('data-sort');
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'nome' ? 1 : -1 };
      renderTabelaPois();
    }));
    let t;
    let ultimaLargura = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === ultimaLargura) return;
      ultimaLargura = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(() => { renderMapa(); renderRanking(); renderCenarios(); renderCurva(); }, 150);
    });
  }

  // ---------- início ----------
  async function iniciar() {
    const nomes = ['pois', 'marcos', 'chefes', 'rotas', 'odds', 'agenda', 'ritmos', 'fatos', 'fontes'];
    try {
      const res = await Promise.all(nomes.map((n) => fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(n); return r.json(); })));
      D = Object.fromEntries(nomes.map((n, i) => [n, res[i]]));
    } catch (err) {
      const aviso = el('p', 'card', 'Não foi possível carregar os dados (' + err.message + '). Se abriu o arquivo direto do computador, rode um servidor local: npx serve .');
      $('main').prepend(aviso);
      return;
    }
    D.pois.forEach((p) => { posOriginais[p.id] = { x: p.x, y: p.y }; });
    const salvas = LS.get(POS_KEY, null);
    if (salvas) D.pois.forEach((p) => { if (salvas[p.id]) { p.x = salvas[p.id].x; p.y = salvas[p.id].y; } });
    state.fundo = LS.get(FUNDO_KEY, null);

    ligarControles();
    $('#sel-rota').value = state.route;
    renderTopo();
    tick();
    setInterval(tick, 1000);
    setInterval(() => { renderTopo(); renderAgenda(); }, 60000);
    renderMapa();
    renderPainel();
    renderRotas();
    renderFatos();
    renderRanking();
    renderTabelaPois();
    renderListas();
    renderCenarios();
    renderCalc();
    renderCurva();
    renderAgenda();
    renderOdds();
    renderFontes();
  }

  iniciar();
})();
