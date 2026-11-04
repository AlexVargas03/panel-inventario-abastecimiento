/* Asistente IA al lado del dashboard.
 * - Muestra el chat, los insights automáticos, tablas y gráficos que manda Python.
 * - Envía cada pregunta a Python (Streamlit) junto con el estado actual del dashboard.
 * - Aplica las acciones del asistente sobre el dashboard (pestaña, filtros, planificador, gráfico). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var st = { chat: [], busy: false, pending: null, iaOk: false, insights: null, insPedido: false, vistoKey: '', acciones: {}, abierto: true, error: null, animados: {} };
  try { st.acciones = JSON.parse(sessionStorage.getItem('ia_acc') || '{}'); } catch (e) { st.acciones = {}; }
  try { st.abierto = localStorage.getItem('ia_open') !== '0'; } catch (e) { /* nada */ }

  /* Ideas puntuales de la bienvenida: [icono, título corto, pista, pregunta real] */
  var IDEAS;
  var ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>';

  /* Iconos de trazo: heredan el color del contenedor y escalan sin pixelarse (los emojis cambian según el sistema) */
  function svg(d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  }
  var IC = {
    trend: svg('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>'),
    barras: svg('<line x1="5" y1="21" x2="5" y2="10"/><line x1="12" y1="21" x2="12" y2="4"/><line x1="19" y1="21" x2="19" y2="14"/>'),
    caja: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>'),
    almacen: svg('<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/>'),
    tabla: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="9.5" y1="9.5" x2="9.5" y2="20"/>'),
    grafico: svg('<path d="M4 20V5"/><path d="M4 20h16"/><polyline points="7.5 15 11 11 14 14 19 8"/>'),
    nuevo: svg('<path d="M3 10a9 9 0 1 1 2.6 6.4"/><polyline points="3 4 3 10 9 10"/>'),
    cerrar: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    ok: svg('<polyline points="20 6 9 17 4 12"/>'),
    enviar: svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
    descarga: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')
  };

  IDEAS = [
    [IC.trend, 'Proveedores', 'Top 10 por venta y margen', 'Muéstrame el top 10 de proveedores por venta de los últimos 3 meses con su margen, y llévame a esa vista en el dashboard.'],
    [IC.barras, 'Margen', 'Evolución mes a mes', 'Grafica la venta y el margen % por mes y dime qué mes fue el peor y por qué.'],
    [IC.caja, 'Obsoleto', 'Quién lo concentra', '¿Qué proveedores concentran el inventario obsoleto? Muéstrame la tabla y filtra el dashboard en obsoletos.'],
    [IC.almacen, 'Almacenes', 'Ocupación y espacio libre', '¿Qué almacén está más lleno? ¿Cuánto espacio libre queda y cuánto ocuparía liberar el obsoleto?']
  ];

  /* ---------- Estructura ---------- */
  var panel = $('#ia-panel');
  panel.innerHTML =
    '<div class="ia-hd"><b class="ia-tt">Asistente<span class="ia-dot" id="ia-estado"></span></b>' +
    '<button class="ia-ico" id="ia-new" type="button" title="Nueva conversación" aria-label="Nueva conversación">' + IC.nuevo + '</button></div>' +
    '<p class="ia-warn" id="ia-warn" hidden></p>' +
    '<div id="ia-msgs" aria-live="polite"></div>' +
    '<div class="ia-ft"><div class="ia-quick" id="ia-quick"></div>' +
    '<div class="ia-in"><textarea id="ia-txt" rows="1" placeholder="Pregunta por ventas, inventario, almacenes…" aria-label="Pregunta al asistente"></textarea>' +
    '<button class="ia-send" id="ia-send" type="button" title="Enviar" aria-label="Enviar">' + IC.enviar + '</button></div>' +
    '<div class="ia-meta"><span id="ia-model">Claude</span><span id="ia-ctx"></span></div></div>';
  var msgs = $('#ia-msgs'), txt = $('#ia-txt'), btn = $('#ia-send');
  var tip = document.createElement('div'); tip.className = 'ia-tip'; tip.hidden = true; document.body.appendChild(tip);

  function abrir(v) {
    st.abierto = v; document.body.classList.toggle('ia-closed', !v);
    var h = $('#ia-handle');
    // Botón circular: dos iconos superpuestos que cruzan y giran (el CSS decide cuál se ve)
    if (!$('.ia-fab-i', h)) h.innerHTML = '<span class="ia-fab-i ia-fab-a">' + ICO + '</span><span class="ia-fab-i ia-fab-b">' + IC.cerrar + '</span>';
    h.setAttribute('aria-expanded', v ? 'true' : 'false');
    h.setAttribute('aria-label', v ? 'Cerrar el asistente' : 'Abrir el asistente');
    h.title = v ? 'Cerrar el asistente' : 'Abrir el asistente';
    try { localStorage.setItem('ia_open', v ? '1' : '0'); } catch (e) { /* nada */ }
    // al terminar la transición el dashboard ya tiene su ancho final: se redibujan los gráficos
    setTimeout(function () { window.dispatchEvent(new Event('resize')); try { dash.refresh(); } catch (e) { /* nada */ } }, 460);
  }
  $('#ia-handle').onclick = function () { abrir(!st.abierto); };
  $('#ia-new').onclick = function () { if (!st.busy) { window.stSend('streamlit:setComponentValue', { value: { id: nuevoId(), tipo: 'reiniciar' }, dataType: 'json' }); } };
  abrir(st.abierto);
  /* El panel se abre y se cierra solo con el botón circular: no se añade nada a la cabecera del dashboard */

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
  function xmlEsc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* Hoja de Excel en SpreadsheetML: sin librerias, y los numeros llegan como numeros (el CSV los manda como texto) */
  function tablaXls(b) {
    var filas = b.rows.map(function (r) {
      return '<Row>' + r.map(function (v) {
        return typeof v === 'number' && isFinite(v)
          ? '<Cell><Data ss:Type="Number">' + v + '</Data></Cell>'
          : '<Cell><Data ss:Type="String">' + xmlEsc(v) + '</Data></Cell>';
      }).join('') + '</Row>';
    }).join('');
    var cab = '<Row>' + b.cols.map(function (c) {
      return '<Cell ss:StyleID="h"><Data ss:Type="String">' + xmlEsc(c.replace(/_/g, ' ')) + '</Data></Cell>';
    }).join('') + '</Row>';
    var hoja = (b.titulo || 'Datos').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Datos';
    return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
      ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles><Style ss:ID="h"><Font ss:Bold="1" ss:Color="#FFFFFF"/>' +
      '<Interior ss:Color="#B3151F" ss:Pattern="Solid"/></Style></Styles>' +
      '<Worksheet ss:Name="' + xmlEsc(hoja) + '"><Table>' + cab + filas + '</Table></Worksheet></Workbook>';
  }

  function bloqueTabla(b) {
    var el = document.createElement('div'); el.className = 'ia-blk';
    var num = b.cols.map(function (c, j) { return b.rows.some(function (r) { return typeof r[j] === 'number'; }); });
    var head = '<div class="ia-blk-h">' + IC.tabla + '<span>' + esc(b.titulo) + '</span></div>';
    var th = b.cols.map(function (c, j) { return '<th class="' + (num[j] ? 'n' : '') + '">' + esc(c.replace(/_/g, ' ')) + '</th>'; }).join('');
    /* La primera columna numerica lleva barra de magnitud detras del numero: se escanea sin leer cifra a cifra */
    var jb = num.indexOf(true), tope = 0;
    if (jb >= 0) b.rows.forEach(function (r) { var v = Math.abs(+r[jb] || 0); if (v > tope) tope = v; });
    var tb = b.rows.map(function (r) {
      return '<tr>' + r.map(function (v, j) {
        var f = (b.fmts || {})[b.cols[j]] || 'auto';
        var cls = (num[j] ? 'n' : '') + (typeof v === 'number' && v < 0 ? ' neg' : '') + (j === 0 ? ' k' : '');
        var txt = esc(fmt(v, f));
        if (j === jb && tope > 0 && typeof v === 'number') {
          var pc = Math.max(2, Math.round(Math.abs(v) / tope * 100));
          return '<td class="' + cls + ' bar" style="--p:' + pc + '%" title="' + esc(v) + '"><span>' + txt + '</span></td>';
        }
        return '<td class="' + cls + '" title="' + esc(v) + '">' + txt + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var nota = (b.total_filas > b.rows.length ? b.rows.length + ' de ' + d3.format(',')(b.total_filas) + ' filas' : b.rows.length + ' filas') + (b.nota ? ' · ' + b.nota : '');
    el.innerHTML = head + '<div class="ia-tw"><table class="ia-t"><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>' +
      '<div class="ia-pie"><span class="ia-nota">' + esc(nota) + '</span>' +
      '<button type="button" class="ia-exp" title="Descargar en Excel">' + IC.descarga + '<span>Excel</span></button></div>';
    $('.ia-exp', el).onclick = function () {
      var nombre = (b.titulo || 'tabla').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
      window.descargar(nombre + '.xls', tablaXls(b), 'application/vnd.ms-excel;charset=utf-8');
    };
    return el;
  }

  /* ---------- Gráficos (d3) ---------- */
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 28) + 'px'; }
  function hideTip() { tip.hidden = true; }
  function bloqueGrafico(b, enDash) {
    var el = document.createElement('div'); el.className = 'ia-blk';
    el.innerHTML = '<div class="ia-blk-h">' + IC.grafico + '<span>' + esc(b.titulo) + '</span></div><div class="ia-ch"></div><div class="ia-leg"></div>';
    requestAnimationFrame(function () { try { dibujar($('.ia-ch', el), $('.ia-leg', el), b, enDash); } catch (e) { console.error(e); $('.ia-ch', el).textContent = 'No pude dibujar el gráfico.'; } });
    return el;
  }
  /* Extremo del dato redondeado (4px) y escuadra en la linea base; nunca las cuatro esquinas */
  function pathCol(x, y0, y1, w, r) {           // columna vertical
    var h = Math.abs(y1 - y0); if (h <= 0.5 || w <= 0) return '';
    r = Math.min(r, w / 2, h); var up = y1 <= y0, k = up ? r : -r;
    return 'M' + x + ',' + y0 + 'V' + (y1 + k) + 'q0,' + (-k) + ' ' + r + ',' + (-k) +
           'h' + (w - 2 * r) + 'q' + r + ',0 ' + r + ',' + k + 'V' + y0 + 'Z';
  }
  function pathBar(x0, x1, y, h, r) {           // barra horizontal
    var w = Math.abs(x1 - x0); if (w <= 0.5 || h <= 0) return '';
    r = Math.min(r, h / 2, w); var right = x1 >= x0, k = right ? r : -r;
    return 'M' + x0 + ',' + y + 'H' + (x1 - k) + 'q' + k + ',0 ' + k + ',' + r +
           'v' + (h - 2 * r) + 'q0,' + r + ' ' + (-k) + ',' + r + 'H' + x0 + 'Z';
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
        var gh = Math.min(24, yi.bandwidth()), oy = (yi.bandwidth() - gh) / 2;
        svg.selectAll('.b' + k).data(s.values).join('path').attr('class', 'creceh')
          .style('animation-delay', function (v, i) { return (i * 45) + 'ms'; })
          .attr('d', function (v, i) { return pathBar(xb(0), xb(v), yb(labels[i]) + yi(k) + oy, gh, 4); })
          .attr('fill', function (v) { return v < 0 ? '#c8202c' : C[k % C.length]; })
          .on('mousemove', function (e, v) { var i = s.values.indexOf(v); showTip(e, esc(labels[i]) + '<br>' + esc(s.name) + ': ' + fmt(v, f)); }).on('mouseleave', hideTip);
        if (series.length === 1) svg.selectAll('.t' + k).data(s.values).join('text').attr('class', 'v').attr('y', function (v, i) { return yb(labels[i]) + yb.bandwidth() / 2 + 3.5; })
          .attr('x', function (v) { return xb(Math.max(0, v)) + 6; }).text(function (v) { return corto(v, f); });
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
      .call(function (g) { g.select('.domain').attr('stroke', 'rgba(11,11,11,.12)'); });
    if (tipo === 'line') {
      series.forEach(function (s, k) {
        var pts = s.values.map(function (v, i) { return [xp(labels[i]), v == null ? null : yp(+v), v, labels[i]]; }).filter(function (p) { return p[1] != null; });
        svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', C[k % C.length]).attr('stroke-width', 2).attr('d', d3.line().x(function (p) { return p[0]; }).y(function (p) { return p[1]; }));
        svg.selectAll('.p' + k).data(pts).join('circle').attr('cx', function (p) { return p[0]; }).attr('cy', function (p) { return p[1]; }).attr('r', 4)
          .attr('fill', C[k % C.length]).attr('stroke', '#fff').attr('stroke-width', 2)
          .on('mousemove', function (e, p) { showTip(e, esc(p[3]) + '<br>' + esc(s.name) + ': ' + fmt(p[2], f)); }).on('mouseleave', hideTip);
      });
    } else {
      var hueco = series.length > 1 ? 2 : 0;                 // 2px de superficie entre barras contiguas
      var slot = xp.bandwidth() / series.length;
      var bw = Math.max(3, Math.min(24, slot - hueco));        // la barra nunca llena el hueco: el resto es aire
      series.forEach(function (s, k) {
        svg.selectAll('.r' + k).data(s.values).join('path').attr('class', 'crece')
          .style('animation-delay', function (v, i) { return (i * 55) + 'ms'; })
          .attr('d', function (v, i) { return pathCol(xp(labels[i]) + k * slot + (slot - bw) / 2, yp(0), yp(v), bw, 4); })
          .attr('fill', function (v) { return v < 0 ? '#c8202c' : C[k % C.length]; })
          .on('mousemove', function (e, v) { var i = s.values.indexOf(v); showTip(e, esc(labels[i]) + '<br>' + esc(s.name) + ': ' + fmt(v, f)); }).on('mouseleave', hideTip);
      });
      /* Etiqueta directa solo en el valor extremo: un numero en cada barra no se lee */
      if (series.length === 1) {
        var vs = series[0].values, im = 0;
        vs.forEach(function (v, i) { if (Math.abs(+v || 0) > Math.abs(+vs[im] || 0)) im = i; });
        if (vs[im] != null) svg.append('text').attr('class', 'v').attr('text-anchor', 'middle')
          .attr('x', xp(labels[im]) + slot / 2).attr('y', yp(Math.max(0, vs[im])) - 5).text(corto(vs[im], f));
      }
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
    var x = document.createElement('button'); x.className = 'ia-ico'; x.innerHTML = IC.cerrar; x.title = 'Quitar'; x.style.float = 'right'; x.onclick = function () { card.remove(); };
    var t = document.createElement('div'); t.style.cssText = 'font-size:.7rem;color:var(--color-fg-muted);margin-bottom:.2rem'; t.innerHTML = IC.grafico + '<span>Análisis de IA</span>'; t.style.cssText += ';display:flex;align-items:center;gap:.3rem'; t.querySelector('svg').style.cssText = 'width:13px;height:13px;color:var(--ia-red)';
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
  /* Escribe la respuesta de verdad: inserta el texto palabra a palabra y despues
   * cuelga cada bloque. La burbuja crece con el contenido en vez de nacer entera. */
  var SALTAR = { TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, PRE: 1, CODE: 1, svg: 1, DETAILS: 1, BUTTON: 1 };
  var PASO_PALABRA = 26, PAUSA_BLOQUE = 420;

  function alFondo(pegado) {
    if (pegado) msgs.scrollTop = msgs.scrollHeight;
  }

  function revelar(caja, piezas) {
    // Vacia los textos ya pintados y guarda sus palabras para irlas devolviendo
    var nodos = [], w = document.createTreeWalker(caja, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        for (var a = n.parentNode; a && a !== caja; a = a.parentNode) { if (SALTAR[a.nodeName]) return NodeFilter.FILTER_REJECT; }
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (w.nextNode()) nodos.push(w.currentNode);
    var plan = nodos.map(function (n) { var t = n.nodeValue.split(/(\s+)/); n.nodeValue = ''; return { n: n, t: t, i: 0 }; });

    var k = 0, bi = 0;
    var pegado = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    caja.classList.add('ia-escribiendo');

    function palabra() {
      if (!caja.isConnected) return;
      while (plan[k] && plan[k].i >= plan[k].t.length) k++;
      var t = plan[k];
      if (!t) { caja.classList.remove('ia-escribiendo'); return bloque(); }
      t.n.nodeValue += t.t[t.i++];
      if (t.i < t.t.length && /^\s+$/.test(t.t[t.i])) t.n.nodeValue += t.t[t.i++];
      alFondo(pegado);
      setTimeout(palabra, PASO_PALABRA);
    }

    function bloque() {
      if (!caja.isConnected || bi >= piezas.length) return;
      var el = piezas[bi++]();          // se crea aqui: el grafico ya mide el ancho real
      el.classList.add('ia-entra');
      caja.appendChild(el);
      alFondo(pegado);
      setTimeout(bloque, PAUSA_BLOQUE);
    }

    plan.length ? palabra() : bloque();
  }

  function burbuja(role) {
    var m = document.createElement('div'); m.className = 'ia-m ' + role;
    var b = document.createElement('div'); b.className = 'ia-b'; m.appendChild(b);
    return { m: m, b: b };
  }
  /* Bienvenida: saludo corto + ideas puntuales + lo que destaca hoy (sin párrafos largos) */
  function bienvenida() {
    var wrap = document.createElement('div');

    var hero = document.createElement('div'); hero.className = 'ia-hero';
    hero.innerHTML = '<div class="ia-emb">' + ICO + '</div><h3>Hola, soy tu asistente</h3>' +
      '<p>¿Qué quieres saber del panel?</p>';
    wrap.appendChild(hero);

    var grid = document.createElement('div'); grid.className = 'ia-ideas';
    IDEAS.forEach(function (q) {
      var b = document.createElement('button'); b.className = 'ia-idea'; b.type = 'button'; b.title = q[3];
      b.innerHTML = '<b>' + q[0] + '<span>' + esc(q[1]) + '</span></b><small>' + esc(q[2]) + '</small>';
      b.onclick = function () { preguntar(q[3]); };
      grid.appendChild(b);
    });
    wrap.appendChild(grid);

    var items = (st.insights && st.insights.items) || [];
    var hoy = document.createElement('div'); hoy.className = 'ia-today';
    hoy.innerHTML = '<h5>Hoy destaca</h5>';
    var ul = document.createElement('ul'); ul.className = 'ia-ins';
    items.forEach(function (it) {
      var li = document.createElement('li'); li.className = it.nivel || 'info'; li.title = it.pregunta ? 'Preguntar: ' + it.pregunta : '';
      li.innerHTML = '<i></i><span>' + inline(it.texto) + '</span>';
      if (it.pregunta) li.onclick = function () { preguntar(it.pregunta); };
      ul.appendChild(li);
    });
    if (!items.length) { var li0 = document.createElement('li'); li0.className = 'ia-load'; li0.textContent = 'Calculando…'; ul.appendChild(li0); }
    hoy.appendChild(ul);
    var src = document.createElement('div'); src.className = 'ia-src';
    src.textContent = st.insights && st.insights.fuente === 'ia' ? 'Claude · clic para profundizar' :
      (st.insights && st.insights.fuente === 'cargando' ? 'Claude está preparando su análisis…' : 'Reglas sobre los datos actuales · clic para profundizar');
    hoy.appendChild(src);
    wrap.appendChild(hoy);
    return wrap;
  }

  function mensaje(m) {
    var x = burbuja(m.role);
    if (m.role === 'user') { x.b.textContent = m.texto; return x.m; }
    x.b.innerHTML = md(m.texto);

    // Cada pieza es una fabrica: se construye en el momento de colgarla
    var piezas = (m.bloques || []).map(function (b) {
      return function () { return b.type === 'table' ? bloqueTabla(b) : bloqueGrafico(b, false); };
    });
    if (m.accion_desc && m.accion_desc.length) piezas.push(function () {
      var a = document.createElement('div'); a.className = 'ia-act';
      a.innerHTML = IC.ok + '<span>Dashboard: ' + esc(m.accion_desc.join(' · ')) + '</span>'; return a;
    });
    if (m.consultas && m.consultas.length) piezas.push(function () {
      var d = document.createElement('details'); d.className = 'ia-q';
      d.innerHTML = '<summary>' + m.consultas.length + ' consulta(s) a los datos</summary>' + m.consultas.map(function (q) { return '<pre>' + esc(q.herramienta + ': ' + q.detalle) + '</pre>'; }).join('');
      return d;
    });
    if (m.error) { x.b.style.borderColor = '#e8b4b4'; }

    // Se escribe solo la primera vez que llega el mensaje; en los repintados aparece entero
    if (m.id && !st.animados[m.id]) { st.animados[m.id] = 1; revelar(x.b, piezas); }
    else piezas.forEach(function (f) { x.b.appendChild(f()); });
    return x.m;
  }
  function pintar(forzar) {
    var key = st.chat.length + '|' + (st.chat.length ? st.chat[st.chat.length - 1].id : '') + '|' + st.busy + '|' + (st.insights ? st.insights.fuente + st.insights.items.length : '') + '|' + (st.error || '');
    if (!forzar && key === st.vistoKey) return;
    st.vistoKey = key;
    var abajo = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    msgs.replaceChildren();
    if (!st.chat.length) msgs.appendChild(bienvenida());   // desaparece con la primera pregunta
    st.chat.forEach(function (m) { msgs.appendChild(mensaje(m)); });
    if (st.busy) {
      var t = burbuja('assistant'); t.m.classList.add('ia-typing'); t.b.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:.35rem">Analizando…</span>'; msgs.appendChild(t.m);
    }
    if (st.error) { var e = burbuja('assistant'); e.b.style.borderColor = '#e8b4b4'; e.b.textContent = st.error; msgs.appendChild(e.m); }
    btn.disabled = st.busy; txt.disabled = st.busy;
    var es = $('#ia-estado');
    if (es) { es.title = !st.iaOk ? 'Sin clave de API' : (st.busy ? 'Analizando…' : 'En línea'); es.classList.toggle('off', !st.iaOk); }
    panel.classList.toggle('ia-working', st.busy);   // el anillo del logo late solo mientras trabaja
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
    w.hidden = !!a.ia_ok; w.textContent = a.ia_ok ? '' : '⚠ Falta ANTHROPIC_API_KEY en los Secrets: el chat está desactivado.';
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
