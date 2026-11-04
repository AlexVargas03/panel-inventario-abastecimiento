/* Asistente IA al lado del dashboard.
 * - Muestra el chat, los insights automáticos, tablas y gráficos que manda Python.
 * - Envía cada pregunta a Python (Streamlit) junto con el estado actual del dashboard.
 * - Aplica las acciones del asistente sobre el dashboard (pestaña, filtros, planificador, gráfico). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var st = { chat: [], busy: false, pending: null, iaOk: false, insights: null, insPedido: false, vistoKey: '', acciones: {}, abierto: true, error: null };
  try { st.acciones = JSON.parse(sessionStorage.getItem('ia_acc') || '{}'); } catch (e) { st.acciones = {}; }
  try { st.abierto = localStorage.getItem('ia_open') !== '0'; } catch (e) { /* nada */ }

  var RAPIDAS = [
    ['Top proveedores', 'Muéstrame el top 10 de proveedores por venta de los últimos 3 meses con su margen, y llévame a esa vista en el dashboard.'],
    ['Margen por mes', 'Grafica la venta y el margen % por mes y dime qué mes fue el peor y por qué.'],
    ['Obsoleto', '¿Qué proveedores concentran el inventario obsoleto? Muéstrame la tabla y filtra el dashboard en obsoletos.'],
    ['Almacenes', '¿Qué almacén está más lleno? ¿Cuánto espacio libre queda y cuánto ocuparía liberar el obsoleto?']
  ];
  var ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';

  /* ---------- Estructura ---------- */
  var panel = $('#ia-panel');
  panel.innerHTML =
    '<div class="ia-hd"><div class="ia-logo">' + ICO + '</div>' +
    '<div class="ia-tt"><b>Asistente IA <span class="ia-badge">Claude</span></b><small>Conectado a los datos del panel</small></div>' +
    '<button class="ia-ico" id="ia-new" title="Nueva conversación">⟲</button><button class="ia-ico" id="ia-x" title="Cerrar panel">✕</button></div>' +
    '<p class="ia-warn" id="ia-warn" hidden></p>' +
    '<div id="ia-msgs" aria-live="polite"></div>' +
    '<div class="ia-ft"><div class="ia-quick" id="ia-quick"><span>Preguntas rápidas:</span></div>' +
    '<div class="ia-in"><textarea id="ia-txt" rows="1" placeholder="Pregunta por ventas, inventario, almacenes…" aria-label="Pregunta al asistente"></textarea>' +
    '<button class="ia-send" id="ia-send" title="Enviar" aria-label="Enviar">↑</button></div>' +
    '<div class="ia-meta"><span id="ia-model">Claude</span><span id="ia-ctx"></span></div></div>';
  RAPIDAS.forEach(function (q) {
    var b = document.createElement('button'); b.className = 'ia-chip'; b.textContent = q[0]; b.title = q[1];
    b.onclick = function () { preguntar(q[1]); }; $('#ia-quick').appendChild(b);
  });
  var msgs = $('#ia-msgs'), txt = $('#ia-txt'), btn = $('#ia-send');
  var tip = document.createElement('div'); tip.className = 'ia-tip'; tip.hidden = true; document.body.appendChild(tip);

  function abrir(v) {
    st.abierto = v; document.body.classList.toggle('ia-closed', !v);
    $('#ia-handle').textContent = v ? '»' : '«';
    try { localStorage.setItem('ia_open', v ? '1' : '0'); } catch (e) { /* nada */ }
    setTimeout(function () { window.dispatchEvent(new Event('resize')); try { dash.refresh(); } catch (e) { /* nada */ } }, 280);
  }
  $('#ia-handle').onclick = function () { abrir(!st.abierto); };
  $('#ia-x').onclick = function () { abrir(false); };
  $('#ia-new').onclick = function () { if (!st.busy) { window.stSend('streamlit:setComponentValue', { value: { id: nuevoId(), tipo: 'reiniciar' }, dataType: 'json' }); } };
  abrir(st.abierto);

  /* Botón en la cabecera roja del dashboard */
  var hd = $('.ax-hd-top') || $('.ax-hd');
  if (hd) {
    var hb = document.createElement('button'); hb.className = 'ia-hd-btn'; hb.innerHTML = ICO.replace('<svg', '<svg width="16" height="16"') + 'Asistente IA';
    hb.onclick = function () { abrir(!st.abierto); if (st.abierto) txt.focus(); };
    hd.appendChild(hb);
  }

  txt.addEventListener('input', function () { txt.style.height = 'auto'; txt.style.height = Math.min(120, txt.scrollHeight) + 'px'; });
  txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(txt.value); } });
  btn.onclick = function () { preguntar(txt.value); };

  /* ---------- Envío a Python ---------- */
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function contexto() {
    var pg = ['pn', 'po', 'alm', 'pl'].find(function (n) { var e = document.getElementById('pg-' + n); return e && !e.hidden; }) || 'pn';
    var cb = document.querySelector('#pl-crit button[aria-selected="true"]');
    var v = function (id) { var e = document.getElementById(id); return e ? e.value : null; };
    return { params: dash.params(), pestana: pg, criterio_obsoleto: cb ? cb.dataset.c : null, buscar_obsoleto: v('pl-oq') || '',
             planificador: { meta_venta_mes: v('pl-meta'), meses: v('pl-mes'), margen_pct: v('pl-mg'), dias_cierre: v('pl-dd') } };
  }
  function enviar(tipo, extra) {
    var id = nuevoId();
    window.stSend('streamlit:setComponentValue', { value: Object.assign({ id: id, tipo: tipo, contexto: contexto() }, extra || {}), dataType: 'json' });
    return id;
  }
  function preguntar(t) {
    t = String(t || '').trim();
    if (!t || st.busy) return;
    if (!st.iaOk) { st.error = 'El asistente no está configurado: falta ANTHROPIC_API_KEY en los Secrets de la app.'; pintar(true); return; }
    txt.value = ''; txt.style.height = 'auto';
    st.chat = st.chat.concat([{ id: 'local', role: 'user', texto: t }]);
    st.busy = true; st.error = null;
    st.pending = enviar('preguntar', { texto: t });
    pintar(true);
  }

  /* ---------- Formatos ---------- */
  var F = {
    money: function (v) { return 'S/ ' + d3.format(',.0f')(v); },
    money2: function (v) { return 'S/ ' + d3.format(',.2f')(v); },
    pct: function (v) { return d3.format('.1%')(v); },
    dec1: function (v) { return d3.format(',.1f')(v); },
    int: function (v) { return d3.format(',.0f')(v); },
    auto: function (v) { return Number.isInteger(v) ? d3.format(',')(v) : d3.format(',.2f')(v); }
  };
  function fmt(v, f) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'number') return String(v);
    if (f === 'money' && Math.abs(v) < 100 && !Number.isInteger(v)) return F.money2(v);
    return (F[f] || F.auto)(v);
  }
  function corto(v, f) {
    if (v == null) return '';
    if (f === 'pct') return d3.format('.0%')(v);
    var s = d3.format('~s')(v).replace('G', 'B');
    return f === 'money' ? 'S/ ' + s : s;
  }

  /* ---------- Markdown mínimo ---------- */
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function md(s) {
    var L = String(s || '').split(/\r?\n/), out = [], i = 0;
    while (i < L.length) {
      var l = L[i];
      if (/^\s*\|/.test(l)) {
        var rows = [];
        while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++; }
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
        var body = rows.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r.replace(/\|/g, ' ').trim() ? r : ''); });
        body = rows.filter(function (r) { return !/^[\s|:-]+$/.test(r); });
        var h = cells(body[0] || '');
        out.push('<table class="md"><tr>' + h.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr>' +
          body.slice(1).map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>');
        continue;
      }
      if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
        var ol = /^\s*\d+\./.test(l), items = [];
        while (i < L.length && /^\s*([-*•]|\d+\.)\s+/.test(L[i])) { items.push(L[i].replace(/^\s*([-*•]|\d+\.)\s+/, '')); i++; }
        out.push((ol ? '<ol>' : '<ul>') + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + (ol ? '</ol>' : '</ul>'));
        continue;
      }
      var hm = l.match(/^\s*#{1,6}\s+(.*)/);
      if (hm) { out.push('<h4>' + inline(hm[1]) + '</h4>'); i++; continue; }
      if (l.trim()) out.push('<p>' + inline(l) + '</p>');
      i++;
    }
    return out.join('');
  }

  /* ---------- Tablas ---------- */
  function tablaCsv(b) {
    var q = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + [b.cols.map(q).join(',')].concat(b.rows.map(function (r) { return r.map(q).join(','); })).join('\r\n');
  }
  function bloqueTabla(b) {
    var el = document.createElement('div'); el.className = 'ia-blk';
    var num = b.cols.map(function (c, j) { return b.rows.some(function (r) { return typeof r[j] === 'number'; }); });
    var head = '<div class="ia-blk-h"><span>▦ ' + esc(b.titulo) + '</span><button type="button">CSV</button></div>';
    var th = b.cols.map(function (c, j) { return '<th class="' + (num[j] ? 'n' : '') + '">' + esc(c.replace(/_/g, ' ')) + '</th>'; }).join('');
    var tb = b.rows.map(function (r) {
      return '<tr>' + r.map(function (v, j) {
        var f = (b.fmts || {})[b.cols[j]] || 'auto';
        return '<td class="' + (num[j] ? 'n' : '') + (typeof v === 'number' && v < 0 ? ' neg' : '') + '" title="' + esc(v) + '">' + esc(fmt(v, f)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var nota = (b.total_filas > b.rows.length ? b.rows.length + ' de ' + d3.format(',')(b.total_filas) + ' filas' : b.rows.length + ' filas') + (b.nota ? ' · ' + b.nota : '');
    el.innerHTML = head + '<div class="ia-tw"><table class="ia-t"><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div><div class="ia-nota">' + esc(nota) + '</div>';
    $('button', el).onclick = function () { window.descargar((b.titulo || 'tabla').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.csv', tablaCsv(b)); };
    return el;
  }

  /* ---------- Gráficos (d3) ---------- */
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 28) + 'px'; }
  function hideTip() { tip.hidden = true; }
  function bloqueGrafico(b, enDash) {
    var el = document.createElement('div'); el.className = 'ia-blk';
    el.innerHTML = '<div class="ia-blk-h"><span>📈 ' + esc(b.titulo) + '</span></div><div class="ia-ch"></div><div class="ia-leg"></div>';
    requestAnimationFrame(function () { try { dibujar($('.ia-ch', el), $('.ia-leg', el), b, enDash); } catch (e) { console.error(e); $('.ia-ch', el).textContent = 'No pude dibujar el gráfico.'; } });
    return el;
  }
  function dibujar(box, leg, b, enDash) {
    var W = Math.max(260, box.clientWidth || 340), H = enDash ? 280 : 220, f = b.formato || 'num', C = dash.colors;
    var svg = d3.select(box).append('svg').attr('viewBox', '0 0 ' + W + ' ' + H);
    var series = (b.series || []).filter(function (s) { return s && s.values; });
    var tipo = b.chart_type;
    var legend = function (names) { leg.innerHTML = names.length > 1 ? names.map(function (n, i) { return '<span><i style="background:' + C[i % C.length] + '"></i>' + esc(n) + '</span>'; }).join('') : ''; };
    if (tipo === 'pie') {
      var s0 = series[0] || { values: [] }, data = (b.labels || []).map(function (l, i) { return { l: l, v: Math.max(0, +s0.values[i] || 0) }; }).filter(function (d) { return d.v > 0; });
      var tot = d3.sum(data, function (d) { return d.v; }) || 1, R = Math.min(W * 0.4, H) / 2 - 6;
      var g = svg.append('g').attr('transform', 'translate(' + (R + 10) + ',' + H / 2 + ')');
      var arcs = d3.pie().sort(null).value(function (d) { return d.v; })(data);
      g.selectAll('path').data(arcs).join('path').attr('d', d3.arc().innerRadius(R * 0.58).outerRadius(R)).attr('fill', function (d, i) { return C[i % C.length]; })
        .attr('stroke', '#fff').on('mousemove', function (e, d) { showTip(e, esc(d.data.l) + '<br>' + fmt(d.data.v, f) + ' · ' + d3.format('.1%')(d.data.v / tot)); }).on('mouseleave', hideTip);
      var lx = R * 2 + 30;
      svg.selectAll('.lg').data(data.slice(0, 10)).join('g').attr('transform', function (d, i) { return 'translate(' + lx + ',' + (16 + i * 19) + ')'; }).each(function (d, i) {
        var t = d3.select(this); t.append('rect').attr('width', 9).attr('height', 9).attr('y', -8).attr('rx', 2).attr('fill', C[i % C.length]);
        t.append('text').attr('x', 14).text((d.l.length > 26 ? d.l.slice(0, 25) + '…' : d.l) + ' · ' + d3.format('.0%')(d.v / tot));
      });
      leg.innerHTML = '';
      return;
    }
    if (tipo === 'heatmap') {
      var xs = b.x || [], ys = b.y || [], z = b.z || [], m = { t: 6, r: 6, b: 34, l: 90 };
      var x = d3.scaleBand().domain(xs).range([m.l, W - m.r]).padding(0.04), y = d3.scaleBand().domain(ys).range([m.t, H - m.b]).padding(0.04);
      var vals = [].concat.apply([], z).filter(function (v) { return v != null; });
      var col = d3.scaleSequential(d3.interpolateReds).domain([d3.min(vals) || 0, d3.max(vals) || 1]);
      ys.forEach(function (yy, i) {
        xs.forEach(function (xx, j) {
          var v = (z[i] || [])[j];
          svg.append('rect').attr('x', x(xx)).attr('y', y(yy)).attr('width', x.bandwidth()).attr('height', y.bandwidth()).attr('rx', 3)
            .attr('fill', v == null ? '#f1f1ef' : col(v)).on('mousemove', function (e) { showTip(e, esc(yy) + ' · ' + esc(xx) + '<br>' + fmt(v, f)); }).on('mouseleave', hideTip);
        });
      });
      svg.append('g').attr('transform', 'translate(0,' + (H - m.b) + ')').call(d3.axisBottom(x).tickSize(0)).call(function (g) { g.select('.domain').remove(); })
        .selectAll('text').attr('transform', xs.length > 6 ? 'rotate(-30)' : null).style('text-anchor', xs.length > 6 ? 'end' : 'middle');
      svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).tickSize(0).tickFormat(function (d) { return d.length > 14 ? d.slice(0, 13) + '…' : d; })).call(function (g) { g.select('.domain').remove(); });
      leg.innerHTML = '';
      return;
    }
    if (tipo === 'scatter') {
      var pts = (b.points || []).filter(function (p) { return p.x != null && p.y != null; }), ms = { t: 8, r: 10, b: 30, l: 52 };
      var sx = d3.scaleLinear().domain(d3.extent(pts, function (p) { return +p.x; })).nice().range([ms.l, W - ms.r]);
      var sy = d3.scaleLinear().domain(d3.extent(pts, function (p) { return +p.y; })).nice().range([H - ms.b, ms.t]);
      svg.append('g').attr('transform', 'translate(0,' + (H - ms.b) + ')').call(d3.axisBottom(sx).ticks(5).tickFormat(function (v) { return corto(v, 'num'); }));
      svg.append('g').attr('transform', 'translate(' + ms.l + ',0)').call(d3.axisLeft(sy).ticks(5).tickFormat(function (v) { return corto(v, f); }));
      svg.selectAll('circle').data(pts).join('circle').attr('cx', function (p) { return sx(+p.x); }).attr('cy', function (p) { return sy(+p.y); }).attr('r', 4)
        .attr('fill', C[0]).attr('opacity', 0.75).on('mousemove', function (e, p) { showTip(e, esc(p.label) + '<br>' + esc(b.x_label || 'x') + ': ' + fmt(+p.x, 'auto') + '<br>' + esc(b.y_label || 'y') + ': ' + fmt(+p.y, f)); }).on('mouseleave', hideTip);
      leg.innerHTML = '<span>' + esc(b.x_label || '') + ' → · ' + esc(b.y_label || '') + ' ↑</span>';
      return;
    }
    var labels = (b.labels || []).map(String);
    legend(series.map(function (s) { return s.name; }));
    var all = [].concat.apply([], series.map(function (s) { return s.values.map(Number).filter(isFinite); }));
    var lo = Math.min(0, d3.min(all) || 0), hi = Math.max(0, d3.max(all) || 1);
    var horiz = tipo === 'bar' && (labels.length > 8 || d3.max(labels, function (l) { return l.length; }) > 12);
    if (horiz) {
      var mh = { t: 4, r: 54, b: 4, l: Math.min(150, 8 + 6 * d3.max(labels, function (l) { return Math.min(l.length, 24); })) };
      H = Math.max(120, labels.length * 22 * Math.max(1, series.length * 0.7) + 10); svg.attr('viewBox', '0 0 ' + W + ' ' + H);
      var yb = d3.scaleBand().domain(labels).range([mh.t, H - mh.b]).padding(0.2), yi = d3.scaleBand().domain(series.map(function (s, i) { return i; })).range([0, yb.bandwidth()]).padding(0.05);
      var xb = d3.scaleLinear().domain([lo, hi]).nice().range([mh.l, W - mh.r]);
      series.forEach(function (s, k) {
        svg.selectAll('.b' + k).data(s.values).join('rect').attr('y', function (v, i) { return yb(labels[i]) + yi(k); }).attr('height', yi.bandwidth())
          .attr('x', function (v) { return xb(Math.min(0, v)); }).attr('width', function (v) { return Math.abs(xb(v) - xb(0)); }).attr('rx', 2)
          .attr('fill', function (v) { return v < 0 ? '#c8202c' : C[k % C.length]; }).on('mousemove', function (e, v) { var i = s.values.indexOf(v); showTip(e, esc(labels[i]) + '<br>' + esc(s.name) + ': ' + fmt(v, f)); }).on('mouseleave', hideTip);
        if (series.length === 1) svg.selectAll('.t' + k).data(s.values).join('text').attr('y', function (v, i) { return yb(labels[i]) + yb.bandwidth() / 2 + 3; })
          .attr('x', function (v) { return xb(Math.max(0, v)) + 4; }).text(function (v) { return corto(v, f); });
      });
      svg.append('g').attr('transform', 'translate(' + mh.l + ',0)').call(d3.axisLeft(yb).tickSize(0).tickFormat(function (l) { return l.length > 24 ? l.slice(0, 23) + '…' : l; })).call(function (g) { g.select('.domain').remove(); });
      return;
    }
    var mg = { t: 10, r: series.length > 1 && tipo === 'line' ? 12 : 8, b: 26, l: 54 };
    var xp = tipo === 'line' ? d3.scalePoint().domain(labels).range([mg.l + 6, W - mg.r - 6]) : d3.scaleBand().domain(labels).range([mg.l, W - mg.r]).padding(0.22);
    var yp = d3.scaleLinear().domain([lo, hi]).nice().range([H - mg.b, mg.t]);
    svg.append('g').attr('transform', 'translate(' + mg.l + ',0)').call(d3.axisLeft(yp).ticks(5).tickSize(-(W - mg.l - mg.r)).tickFormat(function (v) { return corto(v, f); }))
      .call(function (g) { g.select('.domain').remove(); g.selectAll('line').attr('stroke', 'rgba(11,11,11,.08)'); });
    var step = Math.ceil(labels.length / Math.max(1, Math.floor((W - 60) / 46)));
    svg.append('g').attr('transform', 'translate(0,' + (H - mg.b) + ')').call(d3.axisBottom(xp).tickSize(0).tickFormat(function (l, i) { return i % step ? '' : (l.length > 9 ? l.slice(0, 8) + '…' : l); }))
      .call(function (g) { g.select('.domain').attr('stroke', 'rgba(11,11,11,.2)'); });
    if (tipo === 'line') {
      series.forEach(function (s, k) {
        var pts = s.values.map(function (v, i) { return [xp(labels[i]), v == null ? null : yp(+v), v, labels[i]]; }).filter(function (p) { return p[1] != null; });
        svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', C[k % C.length]).attr('stroke-width', 2).attr('d', d3.line().x(function (p) { return p[0]; }).y(function (p) { return p[1]; }));
        svg.selectAll('.p' + k).data(pts).join('circle').attr('cx', function (p) { return p[0]; }).attr('cy', function (p) { return p[1]; }).attr('r', 3.2).attr('fill', C[k % C.length])
          .on('mousemove', function (e, p) { showTip(e, esc(p[3]) + '<br>' + esc(s.name) + ': ' + fmt(p[2], f)); }).on('mouseleave', hideTip);
      });
    } else {
      var xi = d3.scaleBand().domain(series.map(function (s, i) { return i; })).range([0, xp.bandwidth()]).padding(0.06);
      series.forEach(function (s, k) {
        svg.selectAll('.r' + k).data(s.values).join('rect').attr('x', function (v, i) { return xp(labels[i]) + xi(k); }).attr('width', xi.bandwidth())
          .attr('y', function (v) { return yp(Math.max(0, v)); }).attr('height', function (v) { return Math.abs(yp(v) - yp(0)); }).attr('rx', 2)
          .attr('fill', function (v) { return v < 0 ? '#c8202c' : C[k % C.length]; })
          .on('mousemove', function (e, v) { var i = s.values.indexOf(v); showTip(e, esc(labels[i]) + '<br>' + esc(s.name) + ': ' + fmt(v, f)); }).on('mouseleave', hideTip);
      });
    }
  }

  /* ---------- Acciones sobre el dashboard ---------- */
  function fijar(id, v) { var e = document.getElementById(id); if (e && v != null && v !== '') { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } return e; }
  function destacar(el) {
    if (!el) return;
    var card = el.closest('section, .ax-card, .pw-card, [class*="card"]') || el;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('ia-flash'); void card.offsetWidth; card.classList.add('ia-flash');
  }
  function tarjetaDashboard(spec) {
    var card = $('#ia-card');
    if (!card) {
      card = document.createElement('div'); card.id = 'ia-card';
      var hdr = $('.ax-hd'); (hdr && hdr.parentNode ? hdr.parentNode : $('#ia-main')).insertBefore(card, hdr ? hdr.nextSibling : null);
    }
    card.replaceChildren();
    var x = document.createElement('button'); x.className = 'ia-ico'; x.textContent = '✕'; x.title = 'Quitar'; x.style.float = 'right'; x.onclick = function () { card.remove(); };
    var t = document.createElement('div'); t.style.cssText = 'font-size:.7rem;color:var(--color-fg-muted);margin-bottom:.2rem'; t.textContent = '✨ Análisis de IA';
    card.append(x, t, bloqueGrafico(spec, true));
    return card;
  }
  function aplicar(acc) {
    if (!acc || !acc.id || st.acciones[acc.id]) return;
    st.acciones[acc.id] = 1;
    try { sessionStorage.setItem('ia_acc', JSON.stringify(st.acciones)); } catch (e) { /* nada */ }
    var foco = null;
    try {
      if (acc.reset) dash.resetParams();
      if (acc.params) dash.setParams(acc.params);
      if (acc.pestana && typeof showPage === 'function') showPage(acc.pestana);
      if (acc.params) {
        var k = Object.keys(acc.params);
        if (k.some(function (n) { return /^so_/.test(n); })) foco = document.getElementById('so-vtitle') || document.getElementById('so-ptitle');
        if (k.indexOf('so_n') >= 0) foco = document.getElementById('so-ptitle');
        if (k.indexOf('abc_emp') >= 0) foco = document.getElementById('mx-title');
      }
      if (acc.obsoleto) {
        if (acc.obsoleto.criterio) { var bc = document.querySelector('#pl-crit button[data-c="' + acc.obsoleto.criterio + '"]'); if (bc) bc.click(); }
        if (acc.obsoleto.buscar != null) fijar('pl-oq', acc.obsoleto.buscar === '' ? ' ' : acc.obsoleto.buscar);
        if (acc.obsoleto.buscar === '') fijar('pl-oq', '');
        foco = document.getElementById('pl-otb') || foco;
      }
      if (acc.planificador) {
        var p = acc.planificador;
        fijar('pl-meta', p.meta_venta_mes); fijar('pl-mes', p.meses); fijar('pl-mg', p.margen_pct); fijar('pl-dd', p.dias_cierre);
        foco = document.getElementById('pl-pres') || foco;
      }
      if (acc.grafico) foco = tarjetaDashboard(acc.grafico);
      if (!foco && acc.pestana) foco = document.getElementById('pg-' + acc.pestana);
      if (foco) setTimeout(function () { destacar(foco); }, 250);
    } catch (e) { console.error('Acción del asistente', e); }
    resumenFiltros();
  }

  /* ---------- Pintar el chat ---------- */
  function burbuja(role) {
    var m = document.createElement('div'); m.className = 'ia-m ' + role;
    if (role !== 'user') { var av = document.createElement('div'); av.className = 'ia-av'; av.textContent = 'IA'; m.appendChild(av); }
    var b = document.createElement('div'); b.className = 'ia-b'; m.appendChild(b);
    return { m: m, b: b };
  }
  function bienvenida() {
    var x = burbuja('assistant');
    var items = (st.insights && st.insights.items) || [];
    x.b.innerHTML = '<h4>Insights automáticos</h4><p>Hola, estoy conectado a los datos del panel (sell out, inventario, ABC-XYZ y almacenes). Esto es lo que más llama la atención hoy:</p>';
    var ul = document.createElement('ul'); ul.className = 'ia-ins';
    items.forEach(function (it) {
      var li = document.createElement('li'); li.className = it.nivel || 'info'; li.title = it.pregunta ? 'Preguntar: ' + it.pregunta : '';
      li.innerHTML = '<i></i><span>' + inline(it.texto) + '</span>';
      if (it.pregunta) li.onclick = function () { preguntar(it.pregunta); };
      ul.appendChild(li);
    });
    if (!items.length) { var li0 = document.createElement('li'); li0.textContent = 'Calculando…'; ul.appendChild(li0); }
    x.b.appendChild(ul);
    var src = document.createElement('div'); src.className = 'ia-src';
    src.textContent = st.insights && st.insights.fuente === 'ia' ? 'Generados por Claude con los datos actuales · clic para profundizar' :
      (st.insights && st.insights.fuente === 'cargando' ? 'Claude está preparando su análisis…' : 'Calculados con reglas sobre los datos actuales · clic para profundizar');
    x.b.appendChild(src);
    var chips = document.createElement('div'); chips.className = 'ia-chips';
    [['📊 ¿Qué explica la venta del último mes?', '¿Qué explica la variación de la venta del último mes frente al anterior? Muéstrame los proveedores que más suben y bajan.'],
     ['🧾 Resumen para gerencia', 'Prepárame un resumen ejecutivo de 5 puntos del estado de ventas, margen, inventario y almacenes, con una tabla de los indicadores clave.']].forEach(function (q) {
      var c = document.createElement('button'); c.className = 'ia-chip'; c.textContent = q[0]; c.onclick = function () { preguntar(q[1]); }; chips.appendChild(c);
    });
    x.b.appendChild(chips);
    return x.m;
  }
  function mensaje(m) {
    var x = burbuja(m.role);
    if (m.role === 'user') { x.b.textContent = m.texto; return x.m; }
    x.b.innerHTML = md(m.texto);
    (m.bloques || []).forEach(function (b) { x.b.appendChild(b.type === 'table' ? bloqueTabla(b) : bloqueGrafico(b, false)); });
    if (m.accion_desc && m.accion_desc.length) {
      var a = document.createElement('div'); a.className = 'ia-act'; a.textContent = '✓ Dashboard: ' + m.accion_desc.join(' · '); x.b.appendChild(a);
    }
    if (m.consultas && m.consultas.length) {
      var d = document.createElement('details'); d.className = 'ia-q';
      d.innerHTML = '<summary>' + m.consultas.length + ' consulta(s) a los datos</summary>' + m.consultas.map(function (q) { return '<pre>' + esc(q.herramienta + ': ' + q.detalle) + '</pre>'; }).join('');
      x.b.appendChild(d);
    }
    if (m.error) { x.b.style.borderColor = '#e8b4b4'; }
    return x.m;
  }
  function pintar(forzar) {
    var key = st.chat.length + '|' + (st.chat.length ? st.chat[st.chat.length - 1].id : '') + '|' + st.busy + '|' + (st.insights ? st.insights.fuente + st.insights.items.length : '') + '|' + (st.error || '');
    if (!forzar && key === st.vistoKey) return;
    st.vistoKey = key;
    var abajo = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    msgs.replaceChildren(bienvenida());
    st.chat.forEach(function (m) { msgs.appendChild(mensaje(m)); });
    if (st.busy) {
      var t = burbuja('assistant'); t.m.classList.add('ia-typing'); t.b.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:.35rem">Analizando los datos…</span>'; msgs.appendChild(t.m);
    }
    if (st.error) { var e = burbuja('assistant'); e.b.style.borderColor = '#e8b4b4'; e.b.textContent = st.error; msgs.appendChild(e.m); }
    btn.disabled = st.busy; txt.disabled = st.busy;
    if (abajo || forzar || st.busy) msgs.scrollTop = msgs.scrollHeight;
    if (!st.busy) txt.focus({ preventScroll: true });
  }
  function resumenFiltros() {
    var p = dash.params(), partes = [];
    if (p.so_d) partes.push(p.so_d === p.so_h ? p.so_d : p.so_d + '→' + p.so_h);
    if (p.so_v) partes.push('1 proveedor');
    if (p.abc_emp && p.abc_emp !== 'ALFA') partes.push('ABC ' + p.abc_emp);
    $('#ia-ctx').textContent = partes.length ? 'Filtros: ' + partes.join(' · ') : 'Sin filtros';
  }
  dash.onData(resumenFiltros);

  /* ---------- Lo que manda Python ---------- */
  window.iaRender = function (a) {
    st.iaOk = !!a.ia_ok;
    $('#ia-model').textContent = a.modelo ? 'Claude · ' + a.modelo : 'Claude';
    var w = $('#ia-warn');
    w.hidden = !!a.ia_ok; w.textContent = a.ia_ok ? '' : '⚠ Falta configurar ANTHROPIC_API_KEY en los Secrets de la app: el chat está desactivado (los insights usan reglas).';
    if (a.insights) st.insights = a.insights;
    if (Array.isArray(a.chat)) {
      var srv = a.chat;
      if (st.busy && a.respondido !== st.pending) {
        // aún no llega la respuesta: mantener la pregunta local
        if (srv.length >= st.chat.length - 1) st.chat = srv.concat(st.chat.slice(-1).filter(function (m) { return m.id === 'local'; }));
      } else {
        st.chat = srv;
        if (st.busy && a.respondido === st.pending) { st.busy = false; st.pending = null; }
      }
    }
    if (a.reiniciado) { st.busy = false; st.pending = null; }
    pintar(false);
    if (a.accion) aplicar(a.accion);
    if (a.pedir_insights && st.iaOk && !st.insPedido && !st.busy) {
      st.insPedido = true;
      setTimeout(function () { if (!st.busy) enviar('insights'); }, 1500);
    }
  };
  document.body.classList.add('ia-on');
  pintar(true);
})();
