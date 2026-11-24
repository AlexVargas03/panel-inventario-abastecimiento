/* Asistente IA al lado del dashboard.
 * - Muestra el chat, los insights automáticos, tablas y gráficos que manda Python.
 * - Envía cada pregunta a Python (Streamlit) junto con el estado actual del dashboard.
 * - Aplica las acciones del asistente sobre el dashboard (pestaña, filtros, planificador, gráfico). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var marca = 'alfa';
  try { if (localStorage.getItem('ia_marca') === 'toru') marca = 'toru'; } catch (e) { /* sin almacenamiento */ }
  if (marca === 'toru') document.body.classList.add('ia-toru');
  var st = { chat: [], busy: false, pending: null, iaOk: false, insights: null, insPedido: false, vistoKey: '', acciones: {}, abierto: false, error: null, animados: {} };
  try { st.acciones = JSON.parse(sessionStorage.getItem('ia_acc') || '{}'); } catch (e) { st.acciones = {}; }
  // Arranca siempre cerrado: el panel solo se abre pulsando la cabeza de abajo

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
    descarga: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    cambiar: svg('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
    clip: svg('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
    doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'),
    filtro: svg('<polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/>'),
    alerta: svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    critico: svg('<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
    sube: svg('<polyline points="6 15 12 9 18 15"/>'),
    baja: svg('<polyline points="6 9 12 15 18 9"/>'),
    flecha: svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>')
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
    '<div class="ia-hd"><span class="ia-cabeza" id="ia-cab" aria-hidden="true"><i></i><i></i><b class="ia-mej"></b><b class="ia-mej"></b></span>' +
    '<div class="ia-tt"><b>AlfaCorp Bot</b><small><span class="ia-dot" id="ia-estado"></span><span id="ia-sub">En línea</span></small></div>' +
    '<button class="ia-ico" id="ia-new" type="button" title="Nueva conversación" aria-label="Nueva conversación">' + IC.nuevo + '</button></div>' +
    '<p class="ia-warn" id="ia-warn" hidden></p>' +
    '<div id="ia-msgs" aria-live="polite"></div>' +
    '<div class="ia-ft"><div class="ia-quick" id="ia-quick"></div>' +
    '<div class="ia-in"><div class="ia-adjs" id="ia-adjs" hidden></div>' +
    '<textarea id="ia-txt" rows="1" placeholder="Escríbele a AlfaCorp Bot…" aria-label="Escríbele a AlfaCorp Bot"></textarea>' +
    '<div class="ia-bar"><button class="ia-clip" id="ia-clip" type="button" title="Adjuntar una imagen (o pégala con Ctrl+V)" aria-label="Adjuntar imagen">' + IC.clip + '</button>' +
    '<input type="file" id="ia-file" accept="image/png,image/jpeg,image/webp" multiple hidden>' +
    '<span class="ia-ctx" title="Filtros activos del dashboard">' + IC.filtro + '<span id="ia-ctx"></span></span>' +
    '<span class="ia-kbd" aria-hidden="true"><kbd>Enter</kbd> enviar · <kbd>Shift</kbd>+<kbd>Enter</kbd> línea</span>' +
    '<button class="ia-send" id="ia-send" type="button" title="Enviar" aria-label="Enviar">' + IC.enviar + '</button></div></div>' +
    '<div class="ia-meta"><span id="ia-model">Claude</span></div></div>' +
    '<button class="ia-lat" id="ia-lat" type="button" title="Cerrar el asistente" aria-label="Cerrar el asistente"><span></span></button>';
  var msgs = $('#ia-msgs'), txt = $('#ia-txt'), btn = $('#ia-send');
  var tip = document.createElement('div'); tip.className = 'ia-tip'; tip.hidden = true; document.body.appendChild(tip);

  /* Lanza una copia de la cabeza de un sitio a otro. Si no se puede medir
   * (panel oculto, navegador sin layout), no vuela: el cambio ocurre igual. */
  function medir(el) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect(), ojo = el.querySelector('i');
    return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height, ojo: (ojo && ojo.offsetWidth) || 6 } : null;
  }
  function volar(r1, destino, listo) {
    if (!r1 || !r1.width || !destino || !destino.ancho) { listo(); return; }
    var copia = document.createElement('div');
    copia.className = 'ia-vuela';
    copia.innerHTML = '<i></i><i></i>';   // sin cachetes: el vuelo dura medio segundo
    copia.style.cssText = 'left:' + r1.left + 'px;top:' + r1.top + 'px;width:' + r1.width + 'px;height:' + r1.height + 'px;' +
      '--ojo:' + r1.ojo + 'px;gap:' + Math.round(r1.ojo * 1.35) + 'px';
    document.body.appendChild(copia);
    var dx = destino.x - r1.left, dy = destino.y - r1.top, k = destino.ancho / r1.width;
    requestAnimationFrame(function () {
      copia.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')';
    });
    setTimeout(function () { copia.remove(); listo(); }, 460);
  }

  /* La cabeza del panel vive en la bienvenida mientras no hay conversación; despues, en la cabecera */
  function cabezaPanel() {
    var h = $('#ia-hcab');
    return h && h.isConnected ? h : $('#ia-cab');
  }
  /* Dónde quedará esa cabeza con el panel abierto, sin esperar a la transición */
  function sitio(el) {
    var panel = $('#ia-panel');
    if (!el || !panel || !panel.offsetWidth) return null;
    var r = el.getBoundingClientRect(), x = r.left;
    if (document.body.classList.contains('ia-closed')) {
      // el panel está fuera de pantalla: se traslada a su posición final
      // --ia-gap = aire entre el panel flotante y el borde de la ventana
      var gap = parseFloat(getComputedStyle(panel).getPropertyValue('--ia-gap')) || 0;
      x = r.left - panel.getBoundingClientRect().left + (window.innerWidth - panel.offsetWidth - gap);
    }
    return { x: x, y: r.top, ancho: el.offsetWidth || r.width };
  }

  function abrir(v, conVuelo) {
    var h = $('#ia-handle');
    if (!$('.ia-cara', h)) h.innerHTML = '<span class="ia-cara"><i></i><i></i><b class="ia-mej"></b><b class="ia-mej"></b></span>';
    h.setAttribute('aria-expanded', v ? 'true' : 'false');
    h.setAttribute('aria-label', v ? 'Cerrar el asistente' : 'Abrir el asistente');
    h.title = v ? 'Cerrar el asistente' : 'Abrir el asistente';

    function aplicar() {
      st.abierto = v;
      document.body.classList.toggle('ia-closed', !v);
      document.body.classList.toggle('ia-volando', false);
      // al terminar la transición el dashboard ya tiene su ancho final: se redibujan los gráficos
      setTimeout(function () { window.dispatchEvent(new Event('resize')); try { dash.refresh(); } catch (e) { /* nada */ } }, 460);
    }

    if (!conVuelo) { aplicar(); return; }
    var cab = cabezaPanel();
    if (v) {
      var destino = sitio(cab), origen = medir(h);
      document.body.classList.add('ia-volando');          // oculta botón y cabeza durante el vuelo
      document.body.classList.remove('ia-closed');        // el panel entra a la vez
      volar(origen, destino, function () { aplicar(); gesto('feliz', 1500); });
    } else {
      var r = h.getBoundingClientRect(), desde = medir(cab);
      document.body.classList.add('ia-volando');
      volar(desde, { x: r.left, y: r.top, ancho: r.width || 54 }, aplicar);
    }
  }
  $('#ia-handle').onclick = function () { abrir(!st.abierto, true); };
  $('#ia-lat').onclick = function () { abrir(false, true); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.abierto) abrir(false, true); });
  /* Marca del chat: al tocar la cabeza de AlfaCorp Bot se sacude y cambia de rojo (ALFA) a negro (TORU), y al revés */
  function ponerMarca(m) {
    marca = m === 'toru' ? 'toru' : 'alfa';
    document.body.classList.toggle('ia-toru', marca === 'toru');
    try { localStorage.setItem('ia_marca', marca); } catch (e) { /* sin almacenamiento */ }
    [].forEach.call(document.querySelectorAll('.ia-cabeza[role="button"]'), etiquetar);
    gesto('guino', 900);
  }
  function etiquetar(el) {
    var t = marca === 'toru' ? 'Tócame para volver a ALFA' : 'Tócame para cambiar a TORU';
    el.title = t; el.setAttribute('aria-label', t);
  }
  function tocar(el) {
    if (contarToque()) return;      // si la pican demasiado se molesta y no cambia de color
    el.classList.remove('ia-sacude'); void el.offsetWidth; el.classList.add('ia-sacude');
    setTimeout(function () { ponerMarca(marca === 'toru' ? 'alfa' : 'toru'); }, 220);   // cambia a mitad de la sacudida
    setTimeout(function () { el.classList.remove('ia-sacude'); }, 600);
  }
  function tocable(el) {
    if (!el) return;
    el.setAttribute('role', 'button'); el.tabIndex = 0; el.removeAttribute('aria-hidden'); etiquetar(el);
    el.onclick = function () { tocar(el); };
    el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocar(el); } };
  }
  tocable($('#ia-cab'));
  $('#ia-new').onclick = function () { if (!st.busy) { window.stSend('streamlit:setComponentValue', { value: { id: nuevoId(), tipo: 'reiniciar' }, dataType: 'json' }); } };

  /* ---------- Gestos de los ojos ----------
   * Estado de fondo (lo que esta haciendo) + gestos breves encima (lo que siente).
   *   pensando: mira arriba y de lado a lado mientras analiza
   *   atento:   mira hacia abajo, a lo que escribes
   *   sueno:    parpados a media asta si llevas rato sin mover el raton
   *   feliz:    ojos cerrados en arco y cabeza ladeada (al abrir, al llegar la respuesta, al pasar el raton)
   *   sorpresa: ojos grandes (al despertar)
   *   triste:   parpados caidos (si algo falla)
   *   izq/der/arriba: miradas sueltas cuando no pasa nada */
  var G = { breve: null, t: null, dormido: false, quieto: 0 };
  function base() {
    if (st.busy) return 'pensando';
    if (document.activeElement === txt && txt.value.trim()) return txt.value.indexOf('?') >= 0 ? 'curiosa' : 'atento';
    if (G.dormido && !st.abierto) return 'sueno';
    return '';
  }
  function animarCabeza(cls, ms) {
    document.body.classList.remove(cls); void document.body.offsetWidth; document.body.classList.add(cls);
    setTimeout(function () { document.body.classList.remove(cls); }, ms);
  }
  function pintarGesto() { document.body.setAttribute('data-gesto', G.breve || base()); }
  function gesto(nombre, ms) {
    clearTimeout(G.t);
    G.breve = nombre || null;
    pintarGesto();
    if (ms) G.t = setTimeout(function () { G.breve = null; pintarGesto(); }, ms);
  }
  pintarGesto();

  /* Parpadeo con ritmo irregular: a veces doble, de vez en cuando un guiño */
  function parpadear() {
    var g = document.body.getAttribute('data-gesto');
    if (g !== 'sueno' && g !== 'sorpresa' && g !== 'feliz') {
      var guino = Math.random() < 0.08, doble = !guino && Math.random() < 0.22;
      var cls = guino ? 'ia-guino' : 'ia-parpadea';
      document.body.classList.add(cls);
      setTimeout(function () { document.body.classList.remove(cls); }, guino ? 260 : 120);
      if (doble) setTimeout(function () {
        document.body.classList.add('ia-parpadea');
        setTimeout(function () { document.body.classList.remove('ia-parpadea'); }, 110);
      }, 240);
    }
    setTimeout(parpadear, 2200 + Math.random() * 4300);
  }
  setTimeout(parpadear, 1800);

  /* Miradas sueltas cuando nadie interactua; sueño tras 30 s sin mover el raton */
  function vagar() {
    G.quieto += 1;
    if (!G.dormido && !st.abierto && G.quieto >= 8) { G.dormido = true; pintarGesto(); }
    if (!G.breve && !base() && G.quieto >= 1 && Math.random() < 0.55) {
      gesto(['izq', 'der', 'arriba', 'izq', 'der', 'ladea'][Math.floor(Math.random() * 6)], 900 + Math.random() * 600);
    }
    setTimeout(vagar, 3500 + Math.random() * 1500);
  }
  setTimeout(vagar, 4000);
  document.addEventListener('mousemove', function () {
    G.quieto = 0;
    if (G.dormido) { G.dormido = false; gesto('sorpresa', 650); }
  }, { passive: true });
  $('#ia-handle').addEventListener('mouseenter', function () { if (!st.abierto) gesto('feliz', 1100); });
  txt.addEventListener('input', pintarGesto);
  txt.addEventListener('focus', pintarGesto);
  txt.addEventListener('blur', pintarGesto);

  /* Con el primer mensaje, la cabeza de la bienvenida sube a la cabecera */
  function subirCabeza(desde) {
    var cab = $('#ia-cab');
    if (!desde || !cab) return;
    var r = cab.getBoundingClientRect();
    document.body.classList.add('ia-subiendo');
    volar(desde, { x: r.left, y: r.top, ancho: cab.offsetWidth || r.width }, function () {
      document.body.classList.remove('ia-subiendo');
    });
  }

  /* Los ojos de TODAS las cabezas visibles (botón, cabecera del chat y bienvenida) siguen al
   * puntero. Se mueve el desplazamiento con la propiedad translate, que no pisa el parpadeo (scale).
   * El botón además ladea un poco la cabeza hacia donde mira. */
  var ALCANCE = { 'ia-handle': 3.2, 'ia-cab': 1.5, 'ia-hcab': 1.6 };   // px que se desplaza la pupila como máximo
  function cabezasVisibles() {
    return ['ia-handle', 'ia-cab', 'ia-hcab'].map(function (id) { return document.getElementById(id); })
      .filter(function (el) { return el && el.isConnected && el.getClientRects().length; });
  }
  function mirarA(x, y) {
    cabezasVisibles().forEach(function (h) {
      var r = h.getBoundingClientRect();
      if (!r.width) return;
      var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(1, d / 240) * (ALCANCE[h.id] || 1.5);
      h.style.setProperty('--ox', (dx / d * k).toFixed(2) + 'px');
      h.style.setProperty('--oy', (dy / d * k).toFixed(2) + 'px');
      if (h.id === 'ia-handle') h.style.setProperty('--tilt', (Math.max(-1, Math.min(1, dx / 500)) * 6).toFixed(1) + 'deg');
    });
  }
  function centrarMirada() {
    cabezasVisibles().forEach(function (h) { h.style.setProperty('--ox', '0px'); h.style.setProperty('--oy', '0px'); h.style.setProperty('--tilt', '0deg'); });
  }
  /* Mira a un elemento del dashboard durante un rato (cuando lo mueve o lo señala) */
  function mirarHacia(el, ms) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    G.fijo = Date.now() + (ms || 1600);
    mirarA(r.left + Math.min(r.width / 2, 160), r.top + Math.min(r.height / 2, 120));
  }
  document.addEventListener('mousemove', function (e) {
    if (document.body.classList.contains('ia-volando') || Date.now() < (G.fijo || 0)) return;
    mirarA(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('mouseleave', centrarMirada);

  /* Microsacadas: los ojos nunca se quedan del todo quietos. Cada poco hacen un saltito
   * mínimo; es lo que separa una mirada viva de una pegatina. Solo si no hay otro gesto. */
  function microsacada() {
    var g = document.body.getAttribute('data-gesto') || '';
    var libre = !G.breve && g !== 'pensando' && g !== 'sueno';
    document.body.style.setProperty('--sx', libre ? ((Math.random() * 2 - 1) * 0.7).toFixed(2) + 'px' : '0px');
    document.body.style.setProperty('--sy', libre ? ((Math.random() * 2 - 1) * 0.5).toFixed(2) + 'px' : '0px');
    setTimeout(microsacada, 700 + Math.random() * 1600);
  }
  if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(microsacada, 1200);

  /* Enojo: si la insultan o le pican la cabeza sin parar. Primero se molesta (¬¬), luego se enoja. */
  var INSULTO = /\b(tont[oa]|idiota|est[uú]pid[oa]|in[uú]til|no sirves|basura|porquer[ií]a|mierda|maldit[oa]|imb[eé]cil|bruta|burra|pesad[oa])\b/i;
  function enojarse(fuerte) {
    gesto(fuerte ? 'enojo' : 'molesta', fuerte ? 2200 : 1500);
    if (fuerte) animarCabeza('ia-bufa', 520);
  }
  var toques = [];
  function contarToque() {
    var ahora = Date.now();
    toques = toques.filter(function (t) { return ahora - t < 3000; }).concat(ahora);
    if (toques.length >= 6) { enojarse(true); toques = []; return true; }
    if (toques.length === 4) { enojarse(false); return true; }
    return false;
  }
  abrir(st.abierto);
  /* El panel se abre y se cierra solo con el botón circular: no se añade nada a la cabecera del dashboard */

  function lleno() { txt.parentNode.classList.toggle('lleno', !!txt.value.trim() || adjuntos.length > 0); }

  /* ---------- Imágenes adjuntas ----------
   * Se pegan (Ctrl+V), se arrastran o se eligen con el clip. Antes de enviarlas se reducen en el
   * navegador: 1568 px de lado para que AlfaCorp Bot las lea (y no cobre de más) y una miniatura para el chat. */
  var adjuntos = [], MAX_ADJ = 3, LADO = 1568, LADO_MINI = 360;
  var cajaAdj = $('#ia-adjs');
  function reducir(file, lado, calidad) {
    return new Promise(function (ok, mal) {
      var lector = new FileReader();
      lector.onerror = mal;
      lector.onload = function () {
        var img = new Image();
        img.onerror = mal;
        img.onload = function () {
          var k = Math.min(1, lado / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
          var g = c.getContext && c.getContext('2d');
          if (!g) return ok(lector.result);                     // sin canvas: se envía tal cual
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // fondo blanco para PNG transparentes
          g.drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL('image/jpeg', calidad));
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(file);
    });
  }
  function pintarAdjuntos() {
    cajaAdj.replaceChildren();
    adjuntos.forEach(function (a, i) {
      var s = document.createElement('span'); s.className = 'ia-adj';
      s.innerHTML = '<img alt="Imagen adjunta ' + (i + 1) + '"><button type="button" title="Quitar imagen" aria-label="Quitar imagen">' + IC.cerrar + '</button>';
      s.querySelector('img').src = a.mini;
      s.querySelector('button').onclick = function () { adjuntos.splice(i, 1); pintarAdjuntos(); lleno(); txt.focus(); };
      cajaAdj.appendChild(s);
    });
    cajaAdj.hidden = !adjuntos.length;
  }
  function agregarArchivos(files) {
    [].slice.call(files || []).filter(function (f) { return f && /^image\/(png|jpe?g|webp|gif)$/.test(f.type); })
      .slice(0, Math.max(0, MAX_ADJ - adjuntos.length)).forEach(function (f) {
        Promise.all([reducir(f, LADO, 0.85), reducir(f, LADO_MINI, 0.8)]).then(function (r) {
          if (adjuntos.length >= MAX_ADJ) return;
          var tipo = (r[0].match(/^data:(image\/[a-z+]+);/) || [])[1] || 'image/jpeg';
          adjuntos.push({ media_type: tipo, data: r[0].split(',')[1], mini: r[1] });
          pintarAdjuntos(); lleno();
        }).catch(function (e) { console.error('Imagen adjunta', e); });
      });
  }
  txt.addEventListener('paste', function (e) {
    var it = (e.clipboardData && e.clipboardData.items) || [];
    var fs = [].filter.call(it, function (x) { return x.kind === 'file'; }).map(function (x) { return x.getAsFile(); }).filter(Boolean);
    if (fs.length) { e.preventDefault(); agregarArchivos(fs); }
  });
  var cajaIn = txt.parentNode;
  cajaIn.addEventListener('dragover', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); cajaIn.classList.add('arrastrando'); } });
  cajaIn.addEventListener('dragleave', function () { cajaIn.classList.remove('arrastrando'); });
  cajaIn.addEventListener('drop', function (e) { cajaIn.classList.remove('arrastrando'); if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); agregarArchivos(e.dataTransfer.files); } });
  $('#ia-clip').onclick = function () { $('#ia-file').click(); };
  $('#ia-file').addEventListener('change', function () { agregarArchivos(this.files); this.value = ''; });
  txt.addEventListener('input', function () { txt.style.height = 'auto'; txt.style.height = Math.min(140, txt.scrollHeight) + 'px'; lleno(); });
  txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(txt.value); } });
  btn.onclick = function () { preguntar(txt.value); };

  /* ---------- Envío a Python ---------- */
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function contexto() {
    var pg = ['pn', 'po', 'alm', 'cc', 'sg'].find(function (n) { var e = document.getElementById('pg-' + n); return e && !e.hidden; }) || 'pn';
    var cb = document.querySelector('#pl-crit button[aria-selected="true"]');
    var v = function (id) { var e = document.getElementById(id); return e ? e.value : null; };
    var ventas = null;
    try { ventas = { empresa: typeof vcEmp !== 'undefined' ? vcEmp : null, vista: (document.querySelector('#sec-ventas .vc-flipb[aria-pressed="true"]') ? 'canal' : 'total'), mes: typeof vcSel !== 'undefined' ? vcSel : null }; } catch (e) { /* nada */ }
    var compras = null;
    try { if (typeof cvEmp !== 'undefined') compras = { empresa: cvEmp, desde: (typeof cvR !== 'undefined' && cvR) ? cvR.d : null, hasta: (typeof cvR !== 'undefined' && cvR) ? cvR.h : null }; } catch (e) { /* nada */ }
    return { params: dash.params(), pestana: pg, ventas: ventas, compras: compras, criterio_obsoleto: cb ? cb.dataset.c : null, buscar_obsoleto: v('pl-oq') || '',
             planificador: { meta_venta_mes: v('pl-meta'), meses: v('pl-mes'), margen_pct: v('pl-mg'), dias_cierre: v('pl-dd') } };
  }
  function enviar(tipo, extra) {
    var id = nuevoId();
    window.stSend('streamlit:setComponentValue', { value: Object.assign({ id: id, tipo: tipo, contexto: contexto() }, extra || {}), dataType: 'json' });
    return id;
  }
  function preguntar(t) {
    t = String(t || '').trim();
    if ((!t && !adjuntos.length) || st.busy) return;
    var imgs = adjuntos.slice();
    if (!t) t = '¿Me explicas lo que se ve en esta imagen del panel?';
    // Reacción inmediata a lo que mandas: se enoja si la insultan, se enternece si le agradeces; si no, asiente
    if (INSULTO.test(t)) enojarse(true);
    else if (/gracias|genial|excelente|buen[ií]sim|te quiero|crack|eres la mejor/i.test(t)) gesto('tierno', 1600);
    else animarCabeza('ia-asiente', 700);
    var subir = st.chat.length ? null : medir($('#ia-hcab'));
    if (!st.iaOk) { st.error = 'El asistente no está configurado: falta ANTHROPIC_API_KEY en los Secrets de la app.'; pintar(true); return; }
    txt.value = ''; txt.style.height = 'auto';
    adjuntos = []; pintarAdjuntos(); lleno();
    st.chat = st.chat.concat([{ id: 'local', role: 'user', texto: t, imagenes: imgs.map(function (a) { return a.mini; }) }]);
    st.busy = true; st.error = null;
    st.pending = enviar('preguntar', { texto: t, imagenes: imgs });
    pintar(true);
    subirCabeza(subir);
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
    var s = d3.format('.3~s')(v).replace('G', 'B');
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

  /* ---------- Tarjetas de KPI ----------
   * { type:'kpis', items:[{ label, valor, fmt, delta, bueno:'sube'|'baja', nota }] }
   * El delta lleva flecha y signo, no solo color: se entiende tambien sin distinguir verde de rojo. */
  /* Semáforo: el color nunca va solo, siempre con icono y palabra */
  var ESTADO = { bien: ['En meta', 'bien', 'ok'], atencion: ['Atención', 'atencion', 'alerta'], mal: ['Fuera de meta', 'mal', 'critico'] };
  function chipEstado(e) {
    var x = ESTADO[e]; if (!x) return '';
    return '<span class="ia-est e-' + x[1] + '">' + IC[x[2]] + x[0] + '</span>';
  }
  /* Mini tendencia: línea de los últimos periodos, con el último punto marcado */
  function sparkline(serie) {
    var v = (serie || []).filter(function (n) { return typeof n === 'number' && isFinite(n); });
    if (v.length < 3) return '';
    var W = 64, H = 18, lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = hi - lo || 1;
    var pts = v.map(function (n, i) { return [(i / (v.length - 1)) * (W - 4) + 2, H - 2 - ((n - lo) / r) * (H - 4)]; });
    var u = pts[pts.length - 1];
    return '<svg class="ia-spk" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<polyline points="' + pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>' +
      '<circle cx="' + u[0].toFixed(1) + '" cy="' + u[1].toFixed(1) + '" r="2"/></svg>';
  }
  function barraMeta(valor, meta, fmtK, bueno) {
    if (typeof meta !== 'number' || !meta) return '';
    var r = valor / meta, w = Math.max(0, Math.min(1, r)) * 100;
    // si lo bueno es bajar (ocupación, obsoleto), la referencia es un límite, no una meta a alcanzar;
    // si la cifra ya es un %, "102 % de 97 %" confunde: se dice "meta 97 %" y la barra muestra el avance
    var et = bueno === 'baja' ? 'límite ' + fmt(meta, fmtK)
      : fmtK === 'pct' ? 'meta ' + fmt(meta, fmtK)
      : d3.format('.0%')(r) + ' de ' + fmt(meta, fmtK);
    return '<div class="ia-meta"><div class="ia-meta-b"><i style="width:' + w.toFixed(1) + '%"></i></div>' +
      '<span>' + esc(et) + '</span></div>';
  }

  /* ---------- Tarjetas KPI ----------
   * { type:'kpis', items:[{ label, valor, fmt, delta?, bueno?, nota?, meta?, estado?, serie? }] } */
  function bloqueKpis(b) {
    var el = document.createElement('div'); el.className = 'ia-kpis';
    var items = (b.items || []).slice(0, 4);
    el.style.setProperty('--n', Math.min(items.length, 2) || 1);
    el.innerHTML = items.map(function (k) {
      var d = '';
      if (typeof k.delta === 'number' && isFinite(k.delta)) {
        var sube = k.delta >= 0, bien = (k.bueno || 'sube') === 'sube' ? sube : !sube;
        d = '<span class="ia-delta ' + (k.delta === 0 ? 'neu' : bien ? 'bien' : 'mal') + '">' + (sube ? IC.sube : IC.baja) +
          (sube ? '+' : '') + d3.format('.1%')(k.delta) + '</span>';
      }
      var e = ESTADO[k.estado] ? ' e-' + ESTADO[k.estado][1] : '';
      return '<div class="ia-kpi' + e + '"><small>' + esc(k.label) + '</small>' +
        '<div class="ia-kpi-v"><b>' + esc(fmt(k.valor, k.fmt)) + '</b>' + sparkline(k.serie) + '</div>' +
        barraMeta(k.valor, k.meta, k.fmt, k.bueno) +
        '<div class="ia-kpi-p">' + chipEstado(k.estado) + d + (k.nota ? '<span>' + esc(k.nota) + '</span>' : '') + '</div></div>';
    }).join('');
    return el;
  }

  /* ---------- Tablero ejecutivo ----------
   * { type:'scorecard', titulo, subtitulo, cuenta:{bien,atencion,mal},
   *   filas:[{ indicador, valor, fmt, ref, estado, nota?, serie? }] }
   * Lo peor arriba: primero lo que está fuera de meta. */
  var ORDEN_EST = { mal: 0, atencion: 1, bien: 2 };
  function bloqueScorecard(b) {
    var el = document.createElement('div'); el.className = 'ia-blk ia-sc';
    var c = b.cuenta || {};
    var pos = function (f) { return f.estado in ORDEN_EST ? ORDEN_EST[f.estado] : 3; };
    var filas = (b.filas || []).slice().sort(function (x, y) { return pos(x) - pos(y); });
    var resumen = ['mal', 'atencion', 'bien'].filter(function (k) { return c[k]; }).map(function (k) {
      return '<span class="e-' + k + '">' + c[k] + ' ' + (k === 'mal' ? 'fuera de meta' : k === 'atencion' ? 'en atención' : 'en meta') + '</span>';
    }).join('');
    el.innerHTML = '<div class="ia-blk-h">' + IC.trend + '<span>' + esc(b.titulo || 'Tablero ejecutivo') +
      (b.subtitulo ? '<small>' + esc(b.subtitulo) + '</small>' : '') + '</span></div>' +
      (resumen ? '<div class="ia-sc-res">' + resumen + '</div>' : '') +
      '<ul>' + filas.map(function (f) {
        var x = ESTADO[f.estado] || ['', 'neu', 'info'];
        return '<li class="e-' + x[1] + '"><i>' + (IC[x[2]] || '') + '</i>' +
          '<div class="ia-sc-n"><b>' + esc(f.indicador) + '</b>' + (f.nota ? '<span>' + esc(f.nota) + '</span>' : '') + '</div>' +
          '<div class="ia-sc-v"><b>' + esc(fmt(f.valor, f.fmt)) + '</b>' + sparkline(f.serie) +
          '<span>' + esc(f.ref || '') + '</span><em>' + esc(x[0]) + '</em></div></li>';
      }).join('') + '</ul>';
    return el;
  }

  /* ---------- Alertas ----------
   * { type:'alertas', titulo, items:[{ nivel:'critico'|'alerta'|'info', titulo, detalle }] }
   * Cada nivel lleva icono y palabra propios: el color nunca va solo. */
  var NIVEL = { critico: ['Crítico', 'critico'], alerta: ['Atención', 'alerta'], info: ['Info', 'info'] };
  function bloqueAlertas(b) {
    var el = document.createElement('div'); el.className = 'ia-blk ia-al';
    var items = b.items || [];
    var head = '<div class="ia-blk-h">' + IC.alerta + '<span>' + esc(b.titulo || 'Alertas') + '</span>' +
      '<em>' + items.length + '</em></div>';
    el.innerHTML = head + '<ul>' + items.map(function (a) {
      var n = NIVEL[a.nivel] || NIVEL.info;
      return '<li class="n-' + n[1] + '"><i>' + IC[n[1]] + '</i><div><b>' + esc(a.titulo) + '</b>' +
        (a.detalle ? '<span>' + esc(a.detalle) + '</span>' : '') + '</div><small>' + n[0] + '</small></li>';
    }).join('') + '</ul>';
    return el;
  }

  /* ---------- Ficha de producto ----------
   * { type:'ficha', titulo, sub, etiquetas:['A','X'], datos:[{ label, valor, fmt }], cobertura:{ dias, objetivo } } */
  function bloqueFicha(b) {
    var el = document.createElement('div'); el.className = 'ia-blk ia-fi';
    var tags = (b.etiquetas || []).map(function (t) { return '<span class="ia-tag">' + esc(t) + '</span>'; }).join('');
    var datos = (b.datos || []).map(function (d) {
      return '<div><small>' + esc(d.label) + '</small><b>' + esc(fmt(d.valor, d.fmt)) + '</b></div>';
    }).join('');
    var cob = '';
    if (b.cobertura && typeof b.cobertura.dias === 'number') {
      var dias = b.cobertura.dias, obj = b.cobertura.objetivo || 30;
      var tope = Math.max(obj * 2, dias), pc = Math.min(100, dias / tope * 100), po = obj / tope * 100;
      var est = dias < obj * 0.5 ? 'mal' : dias > obj * 1.8 ? 'alto' : 'bien';
      var txt = est === 'mal' ? 'Riesgo de quiebre' : est === 'alto' ? 'Sobrestock' : 'En rango';
      cob = '<div class="ia-cob ' + est + '"><div class="ia-cob-t"><small>Cobertura</small><b>' + d3.format(',.0f')(dias) +
        ' días</b><span>' + txt + '</span></div><div class="ia-cob-b"><i style="--p:' + (pc / 100).toFixed(3) + '"></i>' +
        '<u style="left:' + po.toFixed(1) + '%" title="Objetivo: ' + obj + ' días"></u></div></div>';
    }
    el.innerHTML = '<div class="ia-fi-h"><span class="ia-fi-ic">' + IC.caja + '</span><div><b>' + esc(b.titulo) + '</b>' +
      (b.sub ? '<small>' + esc(b.sub) + '</small>' : '') + '</div>' + (tags ? '<div class="ia-tags">' + tags + '</div>' : '') + '</div>' +
      (datos ? '<div class="ia-fi-d">' + datos + '</div>' : '') + cob;
    return el;
  }

  /* ---------- Botones de acción (siguiente paso) ----------
   * { type:'acciones', items:[{ texto, pregunta }] } — al pulsar se envía la pregunta tal cual */
  function bloqueAcciones(b) {
    var el = document.createElement('div'); el.className = 'ia-sig';
    (b.items || []).slice(0, 3).forEach(function (a) {
      var x = document.createElement('button'); x.type = 'button'; x.className = 'ia-chip';
      x.innerHTML = '<span>' + esc(a.texto) + '</span>' + IC.flecha;
      x.title = a.pregunta || a.texto;
      x.onclick = function () { preguntar(a.pregunta || a.texto); };
      el.appendChild(x);
    });
    return el;
  }

  /* ---------- Comparativa lado a lado ----------
   * { type:'comparativa', titulo, items:['Agosto','Enero'], metricas:[{ label, fmt, valores:[a,b], bueno }] }
   * Cada métrica tiene su propia escala (no se mezclan soles con %); la variación es la del primero frente al segundo.
   * Las cifras van en tinta, el color solo identifica a quién pertenece cada barra. */
  var CMP = ['#b3151f', '#9aa1ab', '#d39a2c'];
  function bloqueComparativa(b) {
    var el = document.createElement('div'); el.className = 'ia-blk ia-cmp';
    var items = (b.items || []).slice(0, 3);
    var ley = items.map(function (n, i) { return '<span><i style="background:' + CMP[i] + '"></i>' + esc(n) + '</span>'; }).join('');
    var filas = (b.metricas || []).map(function (m) {
      var vals = (m.valores || []).slice(0, items.length);
      var tope = Math.max.apply(null, vals.map(function (v) { return Math.abs(+v || 0); })) || 1;
      var d = '';
      if (typeof vals[0] === 'number' && typeof vals[1] === 'number') {
        var dif, sube, txt;
        if (m.fmt === 'pct') { dif = vals[0] - vals[1]; txt = (dif >= 0 ? '+' : '−') + d3.format('.1f')(Math.abs(dif) * 100) + ' pts'; }
        else if (vals[1] !== 0) { dif = vals[0] / vals[1] - 1; txt = (dif >= 0 ? '+' : '−') + d3.format('.1%')(Math.abs(dif)); }
        if (txt) {
          sube = dif >= 0;
          var bien = (m.bueno || 'sube') === 'sube' ? sube : !sube;
          d = '<span class="ia-delta ' + (Math.abs(dif) < 1e-9 ? 'neu' : bien ? 'bien' : 'mal') + '">' + (sube ? IC.sube : IC.baja) + txt + '</span>';
        }
      }
      var barras = vals.map(function (v, i) {
        var p = typeof v === 'number' ? Math.max(0.02, Math.abs(v) / tope) : 0;
        return '<div class="ia-cmp-v"><span class="ia-cmp-b"><i style="--p:' + p.toFixed(3) + ';background:' + CMP[i] + '"></i></span>' +
          '<b>' + esc(fmt(v, m.fmt)) + '</b></div>';
      }).join('');
      return '<div class="ia-cmp-r"><div class="ia-cmp-l"><span>' + esc(m.label) + '</span>' + d + '</div>' + barras + '</div>';
    }).join('');
    el.innerHTML = '<div class="ia-blk-h">' + IC.barras + '<span>' + esc(b.titulo || 'Comparativa') + '</span></div>' +
      '<div class="ia-cmp-ley">' + ley + '</div><div class="ia-cmp-c">' + filas + '</div>';
    return el;
  }

  /* ---------- Informe descargable en PDF ----------
   * { type:'informe', titulo, subtitulo, fecha, resumen:[], secciones:[{ titulo, texto, bloques:[] }], recomendaciones:[], nota }
   * En el chat se ve una tarjeta; al descargar se arma un documento A4 con los mismos bloques
   * y se abre el diálogo de impresión ("Guardar como PDF"). Los gráficos salen vectoriales. */
  function bloqueInforme(b) {
    var el = document.createElement('div'); el.className = 'ia-blk ia-inf';
    var secs = b.secciones || [];
    var nBloques = secs.reduce(function (a, s) { return a + (s.bloques || []).length; }, 0);
    var partes = ['Resumen ejecutivo'].concat(secs.map(function (s) { return s.titulo; }));
    if ((b.recomendaciones || []).length) partes.push('Recomendaciones');
    el.innerHTML = '<div class="ia-inf-h"><span class="ia-inf-ic">' + IC.doc + '</span><div><b>' + esc(b.titulo) + '</b>' +
      (b.subtitulo ? '<small>' + esc(b.subtitulo) + '</small>' : '') + '</div></div>' +
      '<ol class="ia-inf-s">' + partes.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>' +
      '<div class="ia-inf-f"><span>' + secs.length + ' secciones · ' + nBloques + ' gráficos y tablas</span>' +
      '<button type="button" class="ia-inf-btn">' + IC.descarga + '<span>Descargar PDF</span></button></div>';
    var boton = $('.ia-inf-btn', el);
    boton.onclick = function () {
      boton.disabled = true; boton.classList.add('cargando');
      imprimirInforme(b, function () { boton.disabled = false; boton.classList.remove('cargando'); });
    };
    return el;
  }

  var taller = null;    // lienzo fuera de pantalla donde se dibujan los gráficos del informe a su ancho final
  function bloqueParaInforme(x) {
    if (x.type === 'chart') {
      if (!taller) { taller = document.createElement('div'); taller.style.cssText = 'position:fixed;left:-10000px;top:0;width:700px'; document.body.appendChild(taller); }
      var el = document.createElement('div'); el.className = 'ia-blk';
      el.innerHTML = '<div class="ia-blk-h">' + IC.grafico + '<span>' + esc(x.titulo) + '</span></div><div class="ia-ch"></div><div class="ia-leg"></div>';
      taller.appendChild(el);
      try { dibujar($('.ia-ch', el), $('.ia-leg', el), x, true); } catch (e) { $('.ia-ch', el).textContent = 'No se pudo dibujar el gráfico.'; }
      var html = el.outerHTML; el.remove();
      return html;
    }
    var f = BLOQUES[x.type];
    if (!f) return '';
    var antes = v2Quieto; v2Quieto = true;          // en el PDF todo sale quieto y con su cifra final
    try { return f(x).outerHTML; } finally { v2Quieto = antes; }
  }

  var CSS_INFORME = [
    '@page{size:A4;margin:14mm 13mm 15mm}',
    '*{animation:none!important;transition:none!important}',
    'html,body{height:auto!important;overflow:visible!important;background:#fff!important}',
    'body.inf-doc{max-width:760px;margin:0 auto;padding:28px 24px;color:#1d1d1b;font-size:12.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '@media print{body.inf-doc{padding:0;max-width:none}}',
    '.inf-cab{border-radius:16px;padding:22px 24px 20px;color:#fff;margin-bottom:18px;background:radial-gradient(120% 140% at 0% 0%,rgba(255,255,255,.18),rgba(255,255,255,0) 45%),linear-gradient(135deg,#cf2430,#b3151f 55%,#8f0d16)}',
    '.inf-marca{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;opacity:.8}',
    '.inf-cab h1{margin:6px 0 3px;font-size:22px;line-height:1.2;letter-spacing:-.4px}',
    '.inf-cab p{margin:0;font-size:12px;opacity:.9}',
    '.inf-fecha{margin-top:12px;font-size:10px;opacity:.75}',
    '.inf-doc h2{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:14.5px;color:#b3151f;break-after:avoid}',
    '.inf-doc h2 span{display:inline-grid;place-items:center;min-width:22px;height:22px;border-radius:7px;background:#fbeff0;font-size:11px}',
    '.inf-res{background:#fcf8f8;border:1px solid #f1dcdd;border-radius:14px;padding:14px 18px;margin-bottom:20px;break-inside:avoid}',
    '.inf-res ul,.inf-txt ul,.inf-rec ol{margin:4px 0 6px;padding-left:18px}',
    '.inf-res li,.inf-txt li,.inf-rec li{margin:4px 0}',
    '.inf-txt p{margin:4px 0}',
    '.inf-sec{margin:0 0 20px}',
    '.inf-sec .ia-blk,.inf-sec .ia-kpis{break-inside:avoid;margin-top:10px;box-shadow:none}',
    '.inf-sec .ia-tw{max-height:none!important;overflow:visible!important}',
    '.inf-sec .ia-exp,.inf-sec .ia-sig{display:none!important}',
    '.inf-sec .v2{break-inside:avoid;margin-top:10px;box-shadow:none}',
    '.inf-sec .v2-tw{max-height:none!important;overflow:visible!important}',
    '.inf-rec{break-inside:avoid;border-left:3px solid #b3151f;padding:2px 0 2px 14px;margin-bottom:18px}',
    '.inf-nota{margin-top:22px;padding-top:10px;border-top:1px solid #e6e4e0;font-size:10px;color:#7a7873}'
  ].join('\n');

  function informeHTML(b) {
    var hojas = [].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).map(function (l) { return '<link rel="stylesheet" href="' + esc(l.href) + '">'; }).join('');
    var secs = (b.secciones || []).map(function (s, i) {
      return '<section class="inf-sec"><h2><span>' + (i + 1) + '</span>' + esc(s.titulo) + '</h2>' +
        (s.texto ? '<div class="inf-txt">' + md(s.texto) + '</div>' : '') +
        (s.bloques || []).map(bloqueParaInforme).join('') + '</section>';
    }).join('');
    var lista = function (xs, tag) { return '<' + tag + '>' + xs.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + tag + '>'; };
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(b.titulo) + '</title>' + hojas +
      '<style>' + CSS_INFORME + '</style></head><body class="inf-doc">' +
      '<header class="inf-cab"><div class="inf-marca">Tablero de control principal · ALFA / TORU</div>' +
      '<h1>' + esc(b.titulo) + '</h1>' + (b.subtitulo ? '<p>' + esc(b.subtitulo) + '</p>' : '') +
      '<div class="inf-fecha">Generado el ' + esc(b.fecha || '') + ' por el asistente IA</div></header>' +
      ((b.resumen || []).length ? '<section class="inf-res"><h2>Resumen ejecutivo</h2>' + lista(b.resumen, 'ul') + '</section>' : '') +
      secs +
      ((b.recomendaciones || []).length ? '<section class="inf-rec"><h2>Recomendaciones</h2>' + lista(b.recomendaciones, 'ol') + '</section>' : '') +
      (b.nota ? '<footer class="inf-nota">' + inline(b.nota) + '</footer>' : '') +
      '</body></html>';
  }

  /* Escribe el informe en un marco fuera de pantalla, espera a que carguen los estilos y abre
   * el diálogo de impresión. Si el navegador no deja imprimir, se descarga el informe en HTML. */
  function imprimirInforme(b, listo) {
    var html = informeHTML(b);
    var nombre = (b.titulo || 'informe').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'informe';
    var fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1100px;border:0';
    document.body.appendChild(fr);
    var fin = function () { listo && listo(); setTimeout(function () { fr.remove(); }, 1500); };
    try {
      var d = fr.contentDocument; d.open(); d.write(html); d.close();
      var t0 = Date.now();
      (function esperar() {
        var hojas = [].slice.call(d.querySelectorAll('link[rel="stylesheet"]'));
        var cargadas = hojas.every(function (l) { return !!l.sheet; });
        if (!cargadas && Date.now() - t0 < 3000) return setTimeout(esperar, 100);
        try { fr.contentWindow.focus(); fr.contentWindow.print(); }
        catch (e) { window.descargar(nombre + '.html', html, 'text/html;charset=utf-8'); }
        fin();
      })();
    } catch (e) {
      window.descargar(nombre + '.html', html, 'text/html;charset=utf-8');
      fin();
    }
  }

  /* =====================================================================================
   * Bloques con el estilo "Marca" (clases v2-*): cabecera con el degradado de la marca,
   * una cifra grande arriba, un solo color de foco y el resto en gris.
   * Los mensajes que ya se vieron se repintan quietos (v2Quieto): sin animar ni contar otra vez.
   * ===================================================================================== */
  var v2Quieto = false;
  var V2_REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var V2_HOY = (function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); })();
  var V2IC = {
    conteo: svg('<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>'),
    meta: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
    dona: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 5"/>'),
    lista: svg('<path d="M4 6h10M4 12h16M4 18h7"/>'),
    up: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5 10 8H2z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 9.5 2 4h8z" fill="currentColor"/></svg>',
    ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    alerta: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 4v5M8 12h.01"/></svg>',
    mal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>'
  };
  var V2_ESTADO = { bien: ['En meta', 'ok'], atencion: ['Atención', 'alerta'], mal: ['Fuera de meta', 'mal'] };

  /* cifra corta, como la dice gerencia: S/ 5.2 M · S/ 553 mil · 67.3% */
  function v2Corto(v, f) {
    if (v == null || !isFinite(v)) return '—';
    var s = v < 0 ? '−' : '', a = Math.abs(v);
    if (f === 'pct') return s + d3.format('.1%')(a);
    if (f === 'dec1') return s + d3.format(',.1f')(a);
    var n = a >= 1e6 ? d3.format('.1f')(a / 1e6) + ' M' : a >= 1e4 ? d3.format('.0f')(a / 1e3) + ' mil' : d3.format(a < 10 && !Number.isInteger(a) ? ',.2f' : ',.0f')(a);
    return s + (f === 'money' || f === 'money2' ? 'S/ ' + n : n);
  }
  function v2Fmt(v, f) { return typeof v === 'number' ? fmt(v, f).replace(/^-/, '−') : fmt(v, f); }
  /* en tarjetas angostas los montos grandes van cortos; el exacto queda en el title */
  function v2Num(v, f) { return typeof v === 'number' && (f === 'money' || f === 'int' || f === 'num' || f === 'auto') && Math.abs(v) >= 1e5 ? v2Corto(v, f) : v2Fmt(v, f); }
  function v2Frase(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  /* "UNILEVER ANDINA PERU S.A." -> "Unilever Andina Peru S.A." */
  function v2Nombre(s) {
    s = String(s == null ? '' : s);
    if (/[a-z]/.test(s) || !/[A-Z]{3}/.test(s)) return s;
    return s.split(' ').map(function (w) {
      if (/^(S\.?A\.?C?\.?|SAC|EIRL|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?)$/.test(w) || w.length <= 2) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    }).join(' ');
  }
  /* Meses: entiende '2026-01' y 'ene 2026'; si las etiquetas no son meses, devuelve tiempo=false */
  function v2Mes(l) {
    l = String(l == null ? '' : l).trim();
    var m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(l);
    if (m && +m[2] >= 1 && +m[2] <= 12) return { k: m[1] + '-' + m[2], t: MESES[+m[2] - 1], y: m[1] };
    m = /^([a-zA-Z]{3})[a-zA-Z]*\.?\s+(\d{4})$/.exec(l);
    if (m) { var i = MESES.indexOf(m[1].toLowerCase().replace('set', 'sep')); if (i >= 0) return { k: m[2] + '-' + ('0' + (i + 1)).slice(-2), t: MESES[i], y: m[2] }; }
    return null;
  }
  function v2Ejes(labels) {
    var info = labels.map(v2Mes), tiempo = labels.length >= 2 && info.every(Boolean);
    var anios = tiempo ? d3.group(info, function (x) { return x.y; }).size : 0;
    return {
      tiempo: tiempo, info: info,
      txt: function (i) { return tiempo ? info[i].t + (anios > 1 ? ' ' + info[i].y.slice(2) : '') : (labels[i].length > 10 ? labels[i].slice(0, 9) + '…' : labels[i]); },
      largo: function (i) { return tiempo ? info[i].t + ' ' + info[i].y : labels[i]; },
      curso: function (i) { return tiempo && info[i].k === V2_HOY; }
    };
  }

  function v2Pill(dir, bien, txt) {
    return '<span class="v2-pill ' + (dir === 0 ? 'neu' : bien ? 'bien' : 'mal') + '">' + (dir > 0 ? V2IC.up : dir < 0 ? V2IC.down : '') + esc(txt) + '</span>';
  }
  function v2Chip(e) { var x = V2_ESTADO[e]; return x ? '<span class="v2-chip e-' + e + '">' + V2IC[x[1]] + x[0] + '</span>' : ''; }
  function v2EsBueno(a, b, bueno) { var d = a - b; return bueno === 'baja' ? d < 0 : bueno === 'cero' ? Math.abs(a) < Math.abs(b) : d > 0; }
  /* Variación de a frente a b. Con base chica o cambio de signo se da la diferencia, no un % engañoso (2 → 0 no es "−100 %") */
  function v2Cambio(a, b, f, bueno) {
    if (typeof a !== 'number' || typeof b !== 'number' || !isFinite(a) || !isFinite(b)) return '';
    var d = a - b, dir = Math.abs(d) < 1e-9 ? 0 : d > 0 ? 1 : -1, txt;
    if (f === 'pct') txt = d3.format('.1f')(Math.abs(d) * 100) + ' pts';
    else if (Math.abs(b) >= 10 && a * b > 0) { var r = Math.abs(d / b); txt = d3.format(r < 0.1 ? '.1%' : '.0%')(r); }
    else txt = v2Corto(Math.abs(d), f);
    return v2Pill(dir, v2EsBueno(a, b, bueno), (dir > 0 ? '+' : dir < 0 ? '−' : '') + txt);
  }

  /* El número grande "cuenta" hasta su valor: el ojo va primero ahí */
  function v2Big(v, f, corto) {
    var txt = corto ? v2Corto(v, f) : v2Num(v, f);
    return '<b class="v2-big" title="' + esc(v2Fmt(v, f)) + '"' + (typeof v === 'number' && isFinite(v) ? ' data-cuenta="' + v + '" data-f="' + esc(f || '') + '"' + (corto ? ' data-corto="1"' : '') : '') + '>' + esc(txt) + '</b>';
  }
  function v2Contar(raiz) {
    if (v2Quieto || V2_REDUCE) return;
    [].forEach.call(raiz.querySelectorAll('[data-cuenta]'), function (el) {
      var to = +el.dataset.cuenta, f = el.dataset.f, corto = el.dataset.corto, fin = el.textContent;
      var dec = function (x) { return corto ? v2Corto(x, f) : v2Num(f === 'int' ? Math.round(x) : x, f); };
      var t0 = performance.now(), D = 650;
      (function paso(t) {
        var k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? dec(to * e) : fin;
        if (k < 1) requestAnimationFrame(paso);
      })(t0);
    });
  }
  function v2Tarjeta(cls, icono, titulo, extra) {
    var el = document.createElement('div');
    el.className = 'v2 ' + (cls || '') + (v2Quieto ? ' v2-quieto' : '');
    el.innerHTML = '<div class="v2-top"><div class="v2-h">' + icono + '<span title="' + esc(titulo) + '">' + esc(titulo) + '</span>' + (extra || '') + '</div></div><div class="v2-body"></div>';
    return el;
  }
  /* Los gráficos SVG se dibujan cuando el bloque ya está colgado y tiene ancho real */
  function v2Dibujar(el, box, fn) {
    var quieto = v2Quieto, n = 0;
    (function intento() {
      if (!box.clientWidth && n++ < 3) return requestAnimationFrame(intento);
      var antes = v2Quieto; v2Quieto = quieto;
      try { fn(box.clientWidth || 330); } catch (e) { console.error(e); box.textContent = 'No pude dibujar el gráfico.'; }
      v2Quieto = antes;
    })();
  }
  function v2Largo(sel) { var n = sel.node(); if (n && n.getTotalLength) n.style.setProperty('--len', Math.ceil(n.getTotalLength())); }
  function v2Spark(serie) {
    var v = (serie || []).filter(function (n) { return typeof n === 'number' && isFinite(n); });
    if (v.length < 3) return '';
    var W = 150, H = 30;
    var x = d3.scaleLinear().domain([0, v.length - 1]).range([2, W - 4]), ext = d3.extent(v);
    var y = d3.scaleLinear().domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1] + 1] : ext).range([H - 4, 5]);
    var id = 'v2g' + Math.random().toString(36).slice(2, 8);
    var area = d3.area().x(function (d, i) { return x(i); }).y0(H).y1(function (d) { return y(d); }).curve(d3.curveMonotoneX)(v);
    var line = d3.line().x(function (d, i) { return x(i); }).y(function (d) { return y(d); }).curve(d3.curveMonotoneX)(v);
    return '<svg class="v2-spk" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--v-spk);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--v-spk);stop-opacity:0"/></linearGradient></defs>' +
      '<path class="v2-fade" fill="url(#' + id + ')" d="' + area + '"/>' +
      '<path fill="none" style="stroke:var(--v-spk)" stroke-width="1.75" stroke-linecap="round" vector-effect="non-scaling-stroke" d="' + line + '"/></svg>';
  }

  /* ---------- Comparativa: tarjeta por métrica con su cambio y una mancuerna (antes ○ → ahora ●) ---------- */
  function v2Comparativa(b) {
    var items = (b.items || []).slice(0, 3).map(String);
    var el = v2Tarjeta('v2-cmp', V2IC.conteo, b.titulo || 'Comparativa');
    $('.v2-top', el).insertAdjacentHTML('beforeend', '<div class="v2-leyenda">' + items.map(function (n, i) {
      return '<span class="v2-lg"><i class="v2-mk m' + i + '"></i>' + esc(n) + '</span>';
    }).join('') + '</div>');
    var tiles = (b.metricas || []).map(function (m, k) {
      var v = (m.valores || []).slice(0, items.length), a = v[0], c = v[1];
      var vals = v.filter(function (x) { return typeof x === 'number' && isFinite(x); });
      var lo = Math.min.apply(null, [0].concat(vals)), hi = Math.max.apply(null, [0].concat(vals)), sp = hi - lo || 1;
      var pos = function (x) { return +((x - lo) / sp * 100).toFixed(2); };
      var tramo = '';
      if (typeof a === 'number' && typeof c === 'number') {
        var pa = pos(a), pc = pos(c), dir = a - c;
        tramo = '<i class="v2-db-s ' + (dir === 0 ? 'neu' : v2EsBueno(a, c, m.bueno) ? 'bien' : 'mal') + (pc <= pa ? '' : ' izq') + '" style="left:' + Math.min(pa, pc) + '%;width:' + Math.abs(pa - pc) +
          '%;animation-delay:' + (120 + k * 60) + 'ms"></i>';
      }
      var marcas = v.map(function (x, i) {
        return typeof x === 'number' ? '<i class="v2-mk m' + i + '" style="left:' + pos(x) + '%;animation-delay:' + (i === 0 ? 420 + k * 60 : 0) + 'ms" title="' + esc(items[i] + ': ' + v2Fmt(x, m.fmt)) + '"></i>' : '';
      }).reverse().join('');
      var antes = v.slice(1).map(function (x, i) { return esc(items[i + 1]) + ': <b>' + esc(v2Num(x, m.fmt)) + '</b>'; }).join(' · ');
      return '<div class="v2-tile" style="animation-delay:' + (k * 45) + 'ms"><small title="' + esc(m.label) + '">' + esc(m.label) + '</small>' +
        '<div class="v2-tv">' + v2Big(a, m.fmt) + v2Cambio(a, c, m.fmt, m.bueno) + '</div>' +
        '<div class="v2-db"><div class="v2-db-in"><i class="v2-db-t"></i>' + (lo < 0 ? '<i class="v2-db-0" style="left:' + pos(0) + '%"></i>' : '') + tramo + marcas + '</div></div>' +
        '<span class="v2-was">' + antes + '</span></div>';
    });
    $('.v2-body', el).innerHTML = '<div class="v2-tiles' + (tiles.length % 2 ? ' impar' : '') + '">' + tiles.join('') + '</div>';
    v2Contar(el);
    return el;
  }

  /* ---------- KPIs: cifra grande + anillo de meta (o barra de límite) + tendencia ---------- */
  function v2Anillo(v, meta, estado) {
    var R = 18, C = 2 * Math.PI * R, p = Math.max(0, Math.min(1, v)), m = Math.max(0, Math.min(1, meta));
    var ang = m * 2 * Math.PI - Math.PI / 2, c = function (r, f) { return (23 + f(ang) * r).toFixed(1); };
    return '<svg class="v2-ring e-' + estado + '" viewBox="0 0 46 46" width="40" height="40" aria-hidden="true">' +
      '<circle class="tr" cx="23" cy="23" r="' + R + '"/>' +
      '<circle class="pg" cx="23" cy="23" r="' + R + '" transform="rotate(-90 23 23)" style="stroke-dasharray:' + C.toFixed(2) + ';--c:' + C.toFixed(2) + ';--o:' + (C * (1 - p)).toFixed(2) + '"/>' +
      '<line class="mk" x1="' + c(R - 5, Math.cos) + '" y1="' + c(R - 5, Math.sin) + '" x2="' + c(R + 5, Math.cos) + '" y2="' + c(R + 5, Math.sin) + '"/></svg>';
  }
  function v2Bala(v, meta, estado, f, bueno) {
    var tope = Math.max(Math.abs(v), Math.abs(meta)) * 1.2 || 1, pv = Math.max(0, v) / tope, pm = Math.max(0, meta) / tope * 100;
    // si lo bueno es bajar es un límite; si la cifra ya es un %, "102 % de 97 %" confunde
    var et = bueno === 'baja' ? 'límite ' + v2Num(meta, f) : f === 'pct' ? 'meta ' + v2Fmt(meta, f) : d3.format('.0%')(meta ? v / meta : 0) + ' de ' + v2Num(meta, f);
    return '<div class="v2-bala e-' + estado + '"><div class="v2-bala-t"><i style="--p:' + Math.min(1, pv).toFixed(3) + '"></i><u style="left:' + pm.toFixed(1) + '%"></u></div>' +
      '<span>' + esc(et) + '</span></div>';
  }
  function v2Kpis(b) {
    var items = (b.items || []).slice(0, 4);
    var el = v2Tarjeta('v2-kpis', V2IC.meta, b.titulo || 'Indicadores clave', b.subtitulo ? '<em>' + esc(b.subtitulo) + '</em>' : '');
    $('.v2-body', el).innerHTML = '<div class="v2-kgrid' + (items.length === 1 ? ' uno' : items.length === 3 ? ' impar' : '') + '">' + items.map(function (k, i) {
      var e = V2_ESTADO[k.estado] ? k.estado : 'neu', hayMeta = typeof k.meta === 'number' && isFinite(k.meta) && k.meta !== 0;
      var anillo = hayMeta && k.fmt === 'pct' && k.bueno !== 'baja' && typeof k.valor === 'number' && k.valor <= 1.5 ? v2Anillo(k.valor, k.meta, e) : '';
      var bala = hayMeta && !anillo && typeof k.valor === 'number' ? v2Bala(k.valor, k.meta, e, k.fmt, k.bueno) : '';
      var d = '';
      if (typeof k.delta === 'number' && isFinite(k.delta)) {
        var dir = Math.abs(k.delta) < 1e-9 ? 0 : k.delta > 0 ? 1 : -1;
        d = v2Pill(dir, (k.bueno || 'sube') === 'baja' ? dir < 0 : dir > 0, (dir > 0 ? '+' : dir < 0 ? '−' : '') + d3.format('.1%')(Math.abs(k.delta)));
      }
      return '<div class="v2-kpi e-' + e + '" style="animation-delay:' + i * 50 + 'ms"><small>' + esc(k.label) + '</small>' +
        '<div class="v2-kpi-m">' + v2Big(k.valor, k.fmt) + anillo + '</div>' +
        '<div class="v2-kpi-s">' + v2Chip(k.estado) + d + '</div>' + bala +
        (k.nota ? '<span class="v2-kpi-n">' + esc(k.nota) + '</span>' : '') + v2Spark(k.serie) + '</div>';
    }).join('') + '</div>';
    v2Contar(el);
    return el;
  }

  /* ---------- Columnas: el mes que importa en color, el resto en gris ---------- */
  function v2Columnas(b) {
    var labels = (b.labels || []).map(String), f = b.formato || 'num', n = labels.length;
    var v = (((b.series || [])[0] || {}).values || []).map(function (x) { return x == null || x === '' ? null : +x; });
    var ej = v2Ejes(labels), ok = function (i) { return v[i] != null && isFinite(v[i]); };
    var iH, prev = -1;
    if (ej.tiempo) {
      iH = n - 1; while (iH > 0 && (ej.curso(iH) || !ok(iH))) iH--;
      prev = iH - 1; while (prev >= 0 && !ok(prev)) prev--;
    } else {
      iH = 0; v.forEach(function (x, i) { if (ok(i) && (!ok(iH) || x > v[iH])) iH = i; });
    }
    var completos = v.filter(function (x, i) { return ok(i) && !ej.curso(i); }), prom = ej.tiempo && completos.length >= 3 ? d3.mean(completos) : null;
    var el = v2Tarjeta('v2-col', IC.barras, b.titulo || 'Gráfico');
    $('.v2-top', el).insertAdjacentHTML('beforeend', '<div class="v2-hero">' + v2Big(v[iH], f, true) +
      (ej.tiempo ? (prev >= 0 ? v2Cambio(v[iH], v[prev], f, 'sube') + '<span class="v2-ctx">' + esc(ej.largo(iH).split(' ')[0]) + ' vs ' + esc(ej.largo(prev).split(' ')[0]) + '</span>' : '<span class="v2-ctx">' + esc(ej.largo(iH)) + '</span>')
        : '<span class="v2-ctx">el más alto: <b>' + esc(v2Nombre(labels[iH])) + '</b></span>') + '</div>');
    v2Contar(el);
    var box = $('.v2-body', el);
    v2Dibujar(el, box, function (W) {
      var H = 170, m = { t: 20, r: 2, b: 20, l: 2 };
      var vals = v.filter(function (x, i) { return ok(i); });
      var lo = Math.min(0, d3.min(vals) || 0), hi = Math.max(0, d3.max(vals) || 1);
      var svg = d3.select(box).append('svg').attr('class', 'v2-svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('role', 'img').attr('aria-label', b.titulo || '');
      var x = d3.scaleBand().domain(d3.range(n)).range([m.l, W - m.r]).padding(0.3);
      var y = d3.scaleLinear().domain([lo < 0 ? lo * 1.12 : 0, hi * 1.12 || 1]).range([H - m.b, m.t]);
      var marcas = y.ticks(3).filter(function (t) { return t !== 0; });
      marcas.forEach(function (t) { svg.append('line').attr('class', 'v2-grid').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t)); });
      var bw = Math.min(22, x.bandwidth()), cx = function (i) { return x(i) + x.bandwidth() / 2; };
      v.forEach(function (val, i) {
        if (!ok(i)) return;
        svg.append('path').attr('class', 'v2-bar v2-grow ' + (i === iH ? 'acc' : ej.curso(i) ? 'curso' : 'ctx') + (val < 0 ? ' abajo' : ''))
          .style('animation-delay', (i * 30) + 'ms').attr('d', pathCol(cx(i) - bw / 2, y(0), y(val), bw, 4));
      });
      if (lo < 0) svg.append('line').attr('class', 'v2-base').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0));
      marcas.forEach(function (t) { svg.append('text').attr('class', 'v2-tk').attr('x', m.l).attr('y', y(t) - 4).text(v2Corto(t, f)); });
      if (prom) svg.append('line').attr('class', 'v2-avg v2-fade').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(prom)).attr('y2', y(prom));
      var enCurso = labels.some(function (l, i) { return ej.curso(i); });
      box.insertAdjacentHTML('beforeend', '<div class="v2-clave">' + (prom ? '<span><i class="v2-k-avg"></i>Promedio ' + esc(v2Corto(prom, f)) + '</span>' : '') +
        (enCurso ? '<span><i class="v2-k-curso"></i>' + esc(MESES[+V2_HOY.slice(5) - 1]) + ' en curso</span>' : '') + '</div>');
      if (ok(iH)) svg.append('text').attr('class', 'v2-val v2-fade').attr('x', cx(iH)).attr('y', v[iH] < 0 ? y(v[iH]) + 13 : y(v[iH]) - 6).attr('text-anchor', 'middle').text(v2Corto(v[iH], f));
      var paso = Math.ceil(n / Math.max(1, Math.floor(W / (ej.tiempo ? 30 : 56))));
      labels.forEach(function (l, i) {
        if (i % paso && i !== iH) return;
        if (i !== iH && Math.abs(i - iH) < paso) return;          // que no choque con la etiqueta del foco
        svg.append('text').attr('class', 'v2-xl' + (i === iH ? ' on' : '')).attr('x', cx(i)).attr('y', H - 5).attr('text-anchor', 'middle').text(ej.txt(i));
      });
      labels.forEach(function (l, i) {          // zona de hover del ancho de la banda entera
        svg.append('rect').attr('class', 'v2-hit').attr('x', x(i) - x.step() * x.paddingInner() / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b)
          .on('mousemove', function (e) {
            showTip(e, '<b>' + esc(v2Nombre(ej.largo(i))) + (ej.curso(i) ? ' (en curso)' : '') + '</b><br>' + esc(v2Fmt(v[i], f)) +
              (prom && ok(i) ? '<br><span style="opacity:.75">' + d3.format('+.0%')(v[i] / prom - 1).replace('-', '−') + ' vs promedio</span>' : ''));
          })
          .on('mouseleave', hideTip);
      });
    });
    return el;
  }

  /* ---------- Línea: área con degradado, punto final con su cifra, cruz al pasar ---------- */
  function v2Linea(b) {
    var labels = (b.labels || []).map(String), f = b.formato || 'num', n = labels.length;
    var series = (b.series || []).filter(function (s) { return s && s.values; }).slice(0, 5).map(function (s) {
      return { name: String(s.name == null ? '' : s.name), v: s.values.map(function (x) { return x == null || x === '' ? null : +x; }) };
    });
    var multi = series.length > 1, ej = v2Ejes(labels);
    var ult = function (v, desde) { for (var i = desde; i >= 0; i--) if (v[i] != null && isFinite(v[i])) return i; return -1; };
    var el = v2Tarjeta('v2-lin', IC.trend, b.titulo || 'Gráfico');
    var top = $('.v2-top', el);
    if (!multi) {
      var v = series[0].v, iu = ult(v, n - 1), ip = ult(v, iu - 1);
      top.insertAdjacentHTML('beforeend', '<div class="v2-hero">' + v2Big(v[iu], f, true) +
        (ip >= 0 ? v2Cambio(v[iu], v[ip], f, 'sube') : '') +
        '<span class="v2-ctx">' + esc(ej.txt(iu)) + (ej.curso(iu) ? ' (en curso)' : '') + (ip >= 0 ? ' vs ' + esc(ej.txt(ip)) : '') + '</span></div>');
    } else {
      top.insertAdjacentHTML('beforeend', '<div class="v2-leyenda v2-ley-v">' + series.map(function (s, k) {
        var i = ult(s.v, n - 1);
        return '<span class="v2-lg"><i class="v2-sw s' + k + '"></i>' + esc(s.name) + (i >= 0 ? ' <b>' + esc(v2Corto(s.v[i], f)) + '</b>' : '') + '</span>';
      }).join('') + '<span class="v2-ctx">' + esc(ej.txt(n - 1)) + (ej.curso(n - 1) ? ' (en curso)' : '') + '</span></div>');
    }
    v2Contar(el);
    var box = $('.v2-body', el);
    v2Dibujar(el, box, function (W) {
      var H = 160, m = { t: 14, r: multi ? 8 : 14, b: 20, l: 2 };
      var all = [].concat.apply([], series.map(function (s) { return s.v.filter(function (x) { return x != null && isFinite(x); }); }));
      var ext = d3.extent(all), pad = (ext[1] - ext[0]) * 0.18 || Math.abs(ext[1]) * 0.1 || 1;
      var y = d3.scaleLinear().domain(f === 'pct' || !multi || ext[0] < 0 ? [ext[0] - pad, ext[1] + pad] : [0, ext[1] * 1.1]).range([H - m.b, m.t]);
      var x = d3.scalePoint().domain(d3.range(n)).range([m.l + 6, W - m.r - (multi ? 0 : 6)]);
      var svg = d3.select(box).append('svg').attr('class', 'v2-svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('role', 'img').attr('aria-label', b.titulo || '');
      var fy = f === 'pct' ? d3.format(ext[1] - ext[0] < 0.05 ? '.1%' : '.0%') : function (t) { return v2Corto(t, f); };
      y.ticks(3).forEach(function (t) {
        if (y(t) < m.t + 4 || y(t) > H - m.b - 2) return;
        svg.append('line').attr('class', 'v2-grid').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(t)).attr('y2', y(t));
        svg.append('text').attr('class', 'v2-tk').attr('x', m.l).attr('y', y(t) - 4).text(fy(t));
      });
      var paso = Math.ceil(n / Math.max(1, Math.floor(W / (ej.tiempo ? 30 : 56))));
      labels.forEach(function (l, i) {
        if ((i % paso === 0 && n - 1 - i >= paso) || i === n - 1)
          svg.append('text').attr('class', 'v2-xl' + (i === n - 1 ? ' on' : '')).attr('x', x(i)).attr('y', H - 5).attr('text-anchor', i === n - 1 && !multi ? 'end' : 'middle').text(ej.txt(i));
      });
      var def = function (p) { return p[1] != null && isFinite(p[1]); };
      series.forEach(function (s, k) {
        var pts = s.v.map(function (val, i) { return [x(i), val == null || !isFinite(val) ? null : y(val)]; });
        var col = 'var(--v-s' + k + ')';
        if (!multi) {
          var id = 'v2a' + Math.random().toString(36).slice(2, 8);
          var gr = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
          gr.append('stop').attr('offset', 0).style('stop-color', col).style('stop-opacity', .26);
          gr.append('stop').attr('offset', 1).style('stop-color', col).style('stop-opacity', 0);
          svg.append('path').attr('class', 'v2-fade').attr('fill', 'url(#' + id + ')')
            .attr('d', d3.area().defined(def).x(function (p) { return p[0]; }).y0(H - m.b).y1(function (p) { return p[1]; }).curve(d3.curveMonotoneX)(pts));
        }
        var ln = svg.append('path').attr('class', 'v2-line v2-draw').style('stroke', col).style('animation-delay', (k * 120) + 'ms')
          .attr('d', d3.line().defined(def).x(function (p) { return p[0]; }).y(function (p) { return p[1]; }).curve(d3.curveMonotoneX)(pts));
        v2Largo(ln);
        var iu = ult(s.v, n - 1); if (iu < 0) return;
        var e = pts[iu];
        if (!multi) svg.append('circle').attr('class', 'v2-halo').attr('cx', e[0]).attr('cy', e[1]).attr('r', 5).style('fill', col);
        svg.append('circle').attr('class', 'v2-end v2-pop').attr('cx', e[0]).attr('cy', e[1]).attr('r', 4.5).style('fill', col);
        if (!multi) {         // la última cifra en un globo junto al punto, sin salirse del gráfico
          var t = v2Corto(s.v[iu], f), tw = t.length * 6.4 + 12;
          var bx = Math.max(m.l, Math.min(e[0] - tw / 2, W - tw)), by = e[1] - 30 < 0 ? e[1] + 10 : e[1] - 30;
          var g = svg.append('g').attr('transform', 'translate(' + bx + ',' + by + ')').append('g').attr('class', 'v2-pop');
          g.append('rect').attr('class', 'v2-bub').attr('width', tw).attr('height', 20).attr('rx', 10);
          g.append('text').attr('class', 'v2-bubt').attr('x', tw / 2).attr('y', 14).attr('text-anchor', 'middle').text(t);
        }
      });
      var cruz = svg.append('line').attr('class', 'v2-cruz').attr('y1', m.t).attr('y2', H - m.b).style('opacity', 0);
      var dots = series.map(function (s, k) { return svg.append('circle').attr('class', 'v2-end').attr('r', 4).style('fill', 'var(--v-s' + k + ')').style('opacity', 0); });
      svg.append('rect').attr('class', 'v2-hit').attr('x', 0).attr('y', 0).attr('width', W).attr('height', H)
        .on('mousemove', function (ev) {
          var px = d3.pointer(ev)[0], i = d3.minIndex(d3.range(n), function (j) { return Math.abs(x(j) - px); });
          cruz.attr('x1', x(i)).attr('x2', x(i)).style('opacity', 1);
          dots.forEach(function (dd, k) { var val = series[k].v[i]; dd.attr('cx', x(i)).attr('cy', val == null ? -99 : y(val)).style('opacity', val == null ? 0 : 1); });
          showTip(ev, '<b>' + esc(ej.largo(i)) + (ej.curso(i) ? ' (en curso)' : '') + '</b>' + series.map(function (s, k) {
            return '<br><i class="v2-sw s' + k + '"></i>' + (multi ? esc(s.name) + ': ' : '') + esc(v2Fmt(s.v[i], f));
          }).join(''));
        })
        .on('mouseleave', function () { cruz.style('opacity', 0); dots.forEach(function (dd) { dd.style('opacity', 0); }); hideTip(); });
    });
    return el;
  }

  /* ---------- Ranking: lista con barra de fondo, se lee el nombre completo ---------- */
  function v2Ranking(b) {
    var labels = (b.labels || []).map(String).slice(0, 25), f = b.formato || 'num';
    var v = (((b.series || [])[0] || {}).values || []).slice(0, labels.length).map(function (x) { return x == null || x === '' ? 0 : +x || 0; });
    var tope = d3.max(v, function (x) { return Math.abs(x); }) || 1, tot = d3.sum(v);
    var orden = v.every(function (x, i) { return x >= 0 && (i === 0 || v[i - 1] >= x); }) && v.length > 1;
    var el = v2Tarjeta('v2-rank', V2IC.lista, v2Frase(b.titulo || 'Ranking'), '<em>' + (orden ? 'top ' : '') + labels.length + '</em>');
    if (orden && tot > 0) $('.v2-top', el).insertAdjacentHTML('beforeend', '<div class="v2-hero">' + v2Big(v[0], f, true) +
      '<span class="v2-ctx">lidera <b>' + esc(v2Nombre(labels[0])) + '</b> · ' + d3.format('.0%')(v[0] / tot) + ' de estos ' + labels.length + '</span></div>');
    $('.v2-body', el).innerHTML = '<div class="v2-bl">' + labels.map(function (l, i) {
      return '<div' + (orden && i === 0 ? ' class="on"' : '') + ' title="' + esc(l + ': ' + v2Fmt(v[i], f)) + '"><span class="v2-rk">' + (i + 1) + '</span>' +
        '<div class="v2-blb"><i style="--p:' + Math.max(0.03, Math.abs(v[i]) / tope).toFixed(3) + ';animation-delay:' + Math.min(i, 12) * 40 + 'ms"></i><span>' + esc(v2Nombre(l)) + '</span></div>' +
        '<b' + (v[i] < 0 ? ' class="neg"' : '') + '>' + esc(v2Corto(v[i], f)) + '</b></div>';
    }).join('') + '</div>';
    v2Contar(el);
    return el;
  }

  /* ---------- Dona: total al centro, leyenda con % y monto ---------- */
  function v2Dona(b) {
    var labels = (b.labels || []).map(String), f = b.formato || 'num';
    var v = (((b.series || [])[0] || {}).values || []).map(function (x) { return Math.max(0, +x || 0); });
    var data = labels.map(function (l, i) { return { l: v2Nombre(l), v: v[i] || 0 }; }).filter(function (d) { return d.v > 0; });
    if (data.length > 6) {          // más de 6 trozos no se leen: el resto va en "Otros"
      data.sort(function (a, c) { return c.v - a.v; });
      data = data.slice(0, 5).concat([{ l: 'Otros', v: d3.sum(data.slice(5), function (d) { return d.v; }), otros: true }]);
    }
    var tot = d3.sum(data, function (d) { return d.v; }) || 1;
    var cl = function (d, k) { return d.otros ? 'c5' : 'c' + k; };
    var el = v2Tarjeta('v2-dona', V2IC.dona, v2Frase(b.titulo || 'Distribución'));
    var box = $('.v2-body', el);
    box.innerHTML = '<div class="v2-dn"><div class="v2-dn-c"><svg viewBox="0 0 132 132" width="132" height="132" role="img" aria-label="' + esc(b.titulo || '') + '"></svg><div class="v2-dn-t">' + v2Big(tot, f, true) + '<small>total</small></div></div>' +
      '<div class="v2-dn-l">' + data.map(function (d, k) {
        return '<div style="animation-delay:' + (200 + k * 50) + 'ms"><i class="v2-sw ' + cl(d, k) + '"></i><span title="' + esc(d.l) + '">' + esc(d.l) + '</span><b>' + d3.format(d.v / tot < 0.01 ? '.1%' : '.0%')(d.v / tot) + '</b><small>' + esc(v2Corto(d.v, f)) + '</small></div>';
      }).join('') + '</div></div>';
    var g = d3.select($('svg', box)).append('g').attr('transform', 'translate(66,66)');
    var arcs = d3.pie().sort(null).padAngle(data.length > 1 ? 0.03 : 0).value(function (d) { return d.v; })(data);
    var arc = d3.arc().innerRadius(44).outerRadius(64).cornerRadius(4), quieto = v2Quieto || V2_REDUCE;
    g.selectAll('path').data(arcs).join('path').attr('class', function (d, k) { return 'v2-arc ' + cl(d.data, k); })
      .on('mousemove', function (e, d) { showTip(e, '<b>' + esc(d.data.l) + '</b><br>' + esc(v2Fmt(d.data.v, f)) + ' · ' + d3.format('.1%')(d.data.v / tot)); })
      .on('mouseleave', hideTip)
      .each(function (d) {
        var p = d3.select(this);
        if (quieto) { p.attr('d', arc(d)); return; }
        p.attr('d', arc({ startAngle: 0, endAngle: 0, padAngle: 0 }));
        p.transition().duration(800).ease(d3.easeCubicOut).attrTween('d', function () {
          var i = d3.interpolate({ startAngle: 0, endAngle: 0, padAngle: d.padAngle }, d);
          return function (t) { return arc(i(t)); };
        });
      });
    v2Contar(el);
    return el;
  }

  /* ---------- Tabla: encabezado discreto, barra en la cifra principal, primera columna fija ---------- */
  function v2Tabla(b) {
    var cols = (b.cols || []).map(String), rows = b.rows || [], fm = b.fmts || {};
    var num = cols.map(function (c, j) { return rows.some(function (r) { return typeof r[j] === 'number'; }); });
    var jb = num.indexOf(true), tope = jb < 0 ? 0 : d3.max(rows, function (r) { return Math.abs(+r[jb] || 0); }) || 0;
    // puesto numerado solo si de verdad es un ranking: primera columna de nombres y la cifra principal de mayor a menor
    var rank = jb > 0 && !num[0] && rows.length > 1 && rows.every(function (r, i) { return i === 0 || (+rows[i - 1][jb] || 0) >= (+r[jb] || 0); });
    var bonita = function (c) { return v2Frase(c.replace(/_pct$/i, ' %').replace(/_/g, ' ')); };
    // una columna de montos va toda corta o toda exacta: mezclar "S/ 1.2 M" con "S/ 996,395" confunde
    var largas = cols.map(function (c, j) { return (fm[c] === 'money') && d3.max(rows, function (r) { return Math.abs(+r[j] || 0); }) >= 1e6; });
    var nota = (b.total_filas > rows.length ? rows.length + ' de ' + d3.format(',')(b.total_filas) + ' filas' : rows.length + ' filas') + (b.nota ? ' · ' + b.nota : '');
    var el = v2Tarjeta('v2-tab', IC.tabla, v2Frase(b.titulo || 'Tabla'), '<em>' + esc(rows.length + ' filas') + '</em>');
    $('.v2-body', el).innerHTML = '<div class="v2-tw"><table class="v2-t' + (rank ? ' rank' : '') + '"><thead><tr>' + cols.map(function (c, j) {
      return '<th class="' + (num[j] ? 'n' : '') + (j === 0 ? ' k' : '') + '">' + esc(bonita(c)) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r, i) {
      return '<tr style="animation-delay:' + Math.min(i, 15) * 30 + 'ms">' + r.map(function (v, j) {
        var f = fm[cols[j]] || 'auto', t = typeof v === 'number' ? (largas[j] ? v2Corto(v, f) : v2Fmt(v, f)) : (j === 0 ? v2Nombre(v) : v2Fmt(v, f));
        var tt = ' title="' + esc(typeof v === 'number' ? v2Fmt(v, f) : v) + '"';
        if (j === 0) return '<td class="k' + (num[0] ? ' n' : '') + '"' + tt + '>' + (rank ? '<span class="v2-rk">' + (i + 1) + '</span>' : '') + esc(t) + '</td>';
        if (j === jb && tope > 0 && typeof v === 'number') return '<td class="n bar' + (v < 0 ? ' neg' : '') + '"' + tt + '><i style="--p:' + (Math.abs(v) / tope).toFixed(3) + '"></i><span>' + esc(t) + '</span></td>';
        return '<td class="' + (num[j] ? 'n' : '') + (typeof v === 'number' && v < 0 ? ' neg' : '') + '"' + tt + '>' + esc(t) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div><div class="v2-pie"><span>' + esc(nota) + '</span><button type="button" class="ia-exp" title="Descargar en Excel">' + IC.descarga + '<span>Excel</span></button></div>';
    $('.ia-exp', el).onclick = function () {
      var nombre = (b.titulo || 'tabla').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
      window.descargar(nombre + '.xls', tablaXls(b), 'application/vnd.ms-excel;charset=utf-8');
    };
    return el;
  }

  /* ---------- Tablero ejecutivo: barra de semáforo + filas con riel de estado, lo peor arriba ---------- */
  function v2Scorecard(b) {
    var c = b.cuenta || {};
    var pos = function (f) { return f.estado in ORDEN_EST ? ORDEN_EST[f.estado] : 3; };
    var filas = (b.filas || []).slice().sort(function (x, y) { return pos(x) - pos(y); });
    var claves = ['mal', 'atencion', 'bien'].filter(function (k) { return c[k]; });
    var el = v2Tarjeta('v2-sc', V2IC.meta, b.titulo || 'Tablero ejecutivo', b.subtitulo ? '<em>' + esc(b.subtitulo) + '</em>' : '');
    if (claves.length) $('.v2-top', el).insertAdjacentHTML('beforeend', '<div class="v2-seg">' + claves.map(function (k) {
      return '<i class="e-' + k + '" style="flex:' + c[k] + '"></i>';
    }).join('') + '</div><div class="v2-segl">' + claves.map(function (k) {
      return '<span class="e-' + k + '"><b>' + c[k] + '</b>&nbsp;' + (k === 'mal' ? 'fuera de meta' : k === 'atencion' ? 'en atención' : 'en meta') + '</span>';
    }).join('') + '</div>');
    $('.v2-body', el).innerHTML = '<div class="v2-scl">' + filas.map(function (x, i) {
      return '<div class="e-' + esc(x.estado || 'neu') + '" style="animation-delay:' + i * 35 + 'ms"><div class="v2-scn"><b>' + esc(x.indicador) + '</b>' + (x.nota ? '<span>' + esc(x.nota) + '</span>' : '') + '</div>' +
        '<div class="v2-scv"><div>' + sparkline(x.serie) + '<b title="' + esc(v2Fmt(x.valor, x.fmt)) + '">' + esc(v2Num(x.valor, x.fmt)) + '</b></div>' + (x.ref ? '<span title="' + esc(x.ref) + '">' + esc(x.ref) + '</span>' : '') + v2Chip(x.estado) + '</div></div>';
    }).join('') + '</div>';
    return el;
  }

  /* Qué gráficos toma el estilo nuevo; el resto (barras de varias series, calor, dispersión) sigue con dibujar() */
  function v2Grafico(b) {
    var s = (b.series || []).filter(function (x) { return x && x.values; }), labels = (b.labels || []).map(String), t = b.chart_type;
    if (!s.length || !labels.length) return null;
    if (t === 'pie') return v2Dona(b);
    if (t === 'line') return labels.length >= 2 ? v2Linea(b) : null;
    if (s.length !== 1) return null;
    if (t === 'barh') return v2Ranking(b);
    if (t === 'bar') {
      var ej = v2Ejes(labels);
      if (!ej.tiempo && (labels.length > 8 || d3.max(labels, function (l) { return l.length; }) > 12)) return v2Ranking(b);
      return labels.length <= 36 ? v2Columnas(b) : null;
    }
    return null;
  }

  var BLOQUES = { table: v2Tabla, kpis: v2Kpis, scorecard: v2Scorecard, alertas: bloqueAlertas, ficha: bloqueFicha, acciones: bloqueAcciones, comparativa: v2Comparativa, informe: bloqueInforme };

  /* ---------- Gráficos (d3) ---------- */
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 28) + 'px'; }
  function hideTip() { tip.hidden = true; }
  function bloqueGrafico(b, enDash) {
    if (!enDash) { try { var nuevo = v2Grafico(b); if (nuevo) return nuevo; } catch (e) { console.error(e); } }
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
    var horiz = tipo === 'barh' || (tipo === 'bar' && (labels.length > 8 || d3.max(labels, function (l) { return l.length; }) > 12));
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
  /* ---------- Guía: la cabeza va al dashboard y señala lo que movió ----------
   * Una copia de la cabeza del chat vuela a la pestaña y la "presiona", baja a la sección,
   * se posa en su esquina mirándola mientras late el aro, y vuelve al chat. Solo con el panel
   * abierto y sin "reducir movimiento": si no, el dashboard cambia igual, sin vuelo. */
  function guiaCrear() {
    if (!st.abierto || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return null;
    var r = medir(cabezaPanel());
    if (!r) return null;
    var c = document.createElement('div');
    c.className = 'ia-vuela ia-guia'; c.innerHTML = '<i></i><i></i>';
    c.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' +
      '--ojo:' + r.ojo + 'px;gap:' + Math.round(r.ojo * 1.35) + 'px';
    document.body.appendChild(c);
    document.body.classList.add('ia-guiando');
    return { el: c, r0: r, fin: false };
  }
  function guiaMira(g, x, y) {          // la copia mira hacia donde va
    var r = g.el.getBoundingClientRect();
    var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), d = Math.sqrt(dx * dx + dy * dy) || 1;
    g.el.style.setProperty('--ox', (dx / d * 1.6).toFixed(2) + 'px');
    g.el.style.setProperty('--oy', (dy / d * 1.6).toFixed(2) + 'px');
  }
  /* Lleva la copia a un elemento: centrada, o a (dx, dy) desde su esquina superior izquierda */
  function guiaIr(g, el, ancho, ms, listo, dx, dy) {
    var r = el.getBoundingClientRect();
    var x = dx == null ? r.left + r.width / 2 - ancho / 2 : r.left + dx;
    var y = dy == null ? r.top + r.height / 2 - ancho / 2 : r.top + dy;
    guiaMira(g, x + ancho / 2, y + ancho / 2);
    g.el.style.transitionDuration = ms + 'ms';
    g.el.style.transform = 'translate(' + (x - g.r0.left) + 'px,' + (y - g.r0.top) + 'px) scale(' + (ancho / g.r0.width) + ')';
    setTimeout(listo, ms);
  }
  function presionar(el) {
    el.classList.remove('ia-presiona'); void el.offsetWidth; el.classList.add('ia-presiona');
    setTimeout(function () { el.classList.remove('ia-presiona'); }, 380);
  }
  function tarjeta(el) { return el.closest('section, .ax-card, .pw-card, [class*="card"]') || el; }
  function aro(el) {
    var card = tarjeta(el);
    card.classList.remove('ia-flash'); void card.offsetWidth; card.classList.add('ia-flash');
  }
  /* Espera a que el elemento deje de moverse (fin del desplazamiento suave), con tope de 1,2 s */
  function esperarQuieto(el, listo) {
    var t0 = Date.now(), ult = null, quietos = 0;
    (function paso() {
      var y = Math.round(el.getBoundingClientRect().top);
      quietos = y === ult ? quietos + 1 : 0; ult = y;
      if (quietos >= 4 || Date.now() - t0 > 1200) listo(); else requestAnimationFrame(paso);
    })();
  }
  /* La sección que va a cambiar, ANTES de cambiarla (mismo orden de prioridad que ejecutarAccion) */
  function destinoDe(acc) {
    var id = null, k = acc.params ? Object.keys(acc.params) : [];
    if (k.some(function (n) { return /^so_/.test(n); })) id = 'so-vtitle';
    if (k.indexOf('abc_emp') >= 0) id = 'mx-title';
    if (acc.compras) id = 'sec-cvi';
    if (acc.ventas) id = 'sec-ventas';
    if (acc.abc_celda) id = 'mx-title';
    if (acc.croquis) id = 'pg-alm';
    if (acc.seguimiento) id = 'pg-sg';
    if (acc.conteo) id = 'cc-kpis';
    if (acc.grafico) id = 'ia-card';
    var el = id && document.getElementById(id);
    if (!el && acc.pestana) el = document.getElementById('pg-' + acc.pestana);
    return el && el.getClientRects().length ? el : null;
  }
  /* Ya posada sobre la sección: mira cómo cambia, late el aro y vuelve al chat */
  function posada(g, foco) {
    setTimeout(function () {
      if (foco) aro(foco);
      g.el.classList.add('ia-mira');
      g.el.style.setProperty('--ox', '1px'); g.el.style.setProperty('--oy', '1.3px');
      setTimeout(function () { guiaFin(g); }, 1300);
    }, 450);
  }
  function guiaFin(g) {
    if (!g || g.fin) return;
    g.fin = true;
    var r = medir(cabezaPanel()) || g.r0;
    g.el.classList.remove('ia-mira');
    guiaMira(g, r.left + r.width / 2, r.top + r.height / 2);
    g.el.style.transitionDuration = '480ms';
    g.el.style.transform = 'translate(' + (r.left - g.r0.left) + 'px,' + (r.top - g.r0.top) + 'px) scale(' + (r.width / g.r0.width) + ')';
    setTimeout(function () { g.el.remove(); document.body.classList.remove('ia-guiando'); gesto('feliz', 900); }, 480);
  }

  function aplicar(acc) {
    if (!acc || !acc.id || st.acciones[acc.id]) return;
    st.acciones[acc.id] = 1;
    try { sessionStorage.setItem('ia_acc', JSON.stringify(st.acciones)); } catch (e) { /* nada */ }
    var guia = guiaCrear();
    if (!guia) { ejecutarAccion(acc, null); return; }
    /* Con guía, primero llega la cabeza y DESPUÉS cambia el dashboard:
     * 1) vuela a la pestaña y la presiona → cambia la pestaña
     * 2) la página baja a la sección y la cabeza espera a que se quede quieta
     * 3) vuela a la sección, se posa, da un toque → recién ahí se aplica el cambio */
    var tab = acc.pestana ? document.querySelector('.ax-tab[data-tab="' + acc.pestana + '"]') : null;
    var cambia = !!tab && tab.getAttribute('aria-selected') !== 'true';
    var haciaSeccion = function () {
      var dest = destinoDe(acc);
      if (!dest) { ejecutarAccion(acc, guia); return; }
      var card = tarjeta(dest);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      esperarQuieto(card, function () {
        if (guia.fin) return;
        guiaIr(guia, card, 30, 560, function () {
          guia.el.classList.remove('ia-toca'); void guia.el.offsetWidth; guia.el.classList.add('ia-toca');
          setTimeout(function () { ejecutarAccion(acc, guia); }, 110);   // a mitad del toque
        }, 12, 10);
      });
    };
    if (cambia) {
      guiaIr(guia, tab, 26, 560, function () {
        presionar(tab);
        setTimeout(function () {
          try { if (typeof showPage === 'function') showPage(acc.pestana); } catch (e) { console.error(e); }
          setTimeout(haciaSeccion, 320);      // deja pintar la pestaña nueva antes de medir
        }, 170);
      });
    } else {
      haciaSeccion();
    }
  }
  function ejecutarAccion(acc, guia) {
    var foco = null;
    try {
      if (acc.reset) dash.resetParams();
      if (acc.params) dash.setParams(acc.params);
      // con guía la pestaña ya la cambió la cabeza al presionarla
      if (acc.pestana && !guia && typeof showPage === 'function') showPage(acc.pestana);
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
      /* Controles finos: se aplican cuando la pestaña ya está pintada */
      // con guía la pestaña ya está pintada y la cabeza encima: el cambio va al instante, con el toque
      var fino = function (fn, ms) { setTimeout(function () { try { fn(); } catch (e) { console.error('Control del dashboard', e); } }, guia ? 30 : (ms || 150)); };
      if (acc.compras) {
        var cA = acc.compras;
        fino(function () {
          if (cA.empresa) { var bc2 = document.querySelector('#sec-cvi [data-cve="' + cA.empresa + '"]'); if (bc2 && bc2.getAttribute('aria-pressed') !== 'true') bc2.click(); }
          if ((cA.todo || cA.desde) && typeof drawCv === 'function') {
            try { cvR = cA.todo ? null : { d: cA.desde, h: cA.hasta || cA.desde }; cvDef = true; drawCv(); } catch (e) { console.error('Control de Compras', e); }
          }
        }, 300);
        foco = document.getElementById('sec-cvi') || foco;
      }
      if (acc.ventas) {
        var vA = acc.ventas;
        fino(function () {
          if (vA.empresa) { var be = document.querySelector('#sec-ventas [data-vce="' + vA.empresa + '"]'); if (be && be.getAttribute('aria-pressed') !== 'true') be.click(); }
          setTimeout(function () {
            try {
              if (vA.vista) { var fb = document.querySelector('#sec-ventas .vc-flipb'); if (fb && (fb.getAttribute('aria-pressed') === 'true') !== (vA.vista === 'canal')) fb.click(); }
              if (vA.mes === 'cerrar') { var bk = document.getElementById('vc-sback'); if (bk && typeof vcSel !== 'undefined' && vcSel) bk.click(); }
              else if (vA.mes && typeof drawVc === 'function') { vcSel = vA.mes; vcSwapSide = true; drawVc(); }
            } catch (e) { console.error('Control de Ventas por mes', e); }
          }, 200);
        }, 300);
        foco = document.getElementById('sec-ventas') || foco;
      }
      if (acc.abc_celda) {
        fino(function () {
          var pin = document.querySelector('#pg-pn .ax-cell[aria-pressed="true"]');
          if (acc.abc_celda === 'cerrar') { if (typeof mxHide === 'function') mxHide(); return; }
          var c = document.querySelector('#pg-pn .ax-cell[data-pick-abc="' + acc.abc_celda + '"]');
          if (c && c !== pin) c.click();
        }, 250);
        foco = document.getElementById('mx-title') || foco;
      }
      if (acc.croquis) {
        fino(function () {
          if (acc.croquis === 'cerrar') { if (typeof almHide === 'function') almHide(); return; }
          var pg = document.getElementById('pg-alm');
          var host = pg && !pg.hidden ? pg : document.getElementById('pg-pn');
          var b = host && host.querySelector('.alm-btn[data-alm="' + acc.croquis + '"]');
          if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
        }, 250);
        foco = document.getElementById('pg-alm') || foco;
      }
      if (acc.simulador) {
        var sm = acc.simulador;
        fino(function () {
          var modo = document.getElementById(sm.tipo === 'producto' ? 'pl-sm-s' : 'pl-sm-p');
          if (modo && modo.getAttribute('aria-selected') !== 'true') modo.click();
          if (sm.buscar) {
            var q = document.getElementById('pl-sq');
            q.value = sm.buscar; q.dispatchEvent(new Event('input', { bubbles: true }));
            var li = document.querySelector('#pl-sl li[data-i]');
            if (li) li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            q.blur();
          }
          if (sm.descuento !== null && sm.descuento !== undefined) {
            var d = document.getElementById('pl-d'); d.value = sm.descuento; d.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 250);
        foco = document.getElementById('pl-sim') || foco;
      }
      if (acc.orden_obsoletos) {
        var ob = acc.orden_obsoletos;
        fino(function () {
          var th = document.querySelector('.pl-th[data-k="' + ob.columna + '"]');
          if (!th) return;
          var quiere = ob.orden === 'asc' ? 1 : -1;
          for (var n = 0; n < 2; n++) {
            var listo = typeof plSortK !== 'undefined' && plSortK === ob.columna && plSortD === quiere;
            if (listo) break;
            th.click();
          }
        }, 250);
        foco = document.getElementById('pl-otb') || foco;
      }
      if (acc.seguimiento) {
        var sgA = acc.seguimiento;
        fino(function () {
          if (sgA.vista) { var bm = document.querySelector('#sg-modes button[data-sgm="' + sgA.vista + '"]'); if (bm && !bm.classList.contains('on')) bm.click(); }
          setTimeout(function () {
            if (sgA.empresa) {
              [].forEach.call(document.querySelectorAll('#pg-sg .cc-seg-eb[data-emp="' + sgA.empresa + '"]'), function (b) { if (b.offsetParent && b.getAttribute('aria-selected') !== 'true') b.click(); });
            }
            if (sgA.solo_variacion !== null && sgA.solo_variacion !== undefined) {
              var cv = document.getElementById('sg-ev-var'); if (cv && cv.checked !== !!sgA.solo_variacion) { cv.checked = !!sgA.solo_variacion; cv.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            if (sgA.buscar) { var q = document.getElementById('sg-ev-q'); if (q) { q.value = sgA.buscar; q.dispatchEvent(new Event('input', { bubbles: true })); } }
          }, 150);
        }, 250);
        foco = document.getElementById('pg-sg') || foco;
      }
      if (acc.conteo) {
        // Conteo cíclico: elegir un proceso (clic en su fila) o "todos" (primera tarjeta). Tras pintar la pestaña.
        setTimeout(function () {
          try {
            var proc = String(acc.conteo.proceso || '');
            if (proc === 'todos') {
              if (typeof ccGo === 'function' && typeof ccOrd !== 'undefined') { var i = ccOrd.findIndex(function (r) { return r.all; }); if (i >= 0) ccGo(0, i); }
            } else {
              var fila = [].slice.call(document.querySelectorAll('#cc-tproc-b tr[data-key]')).find(function (tr) { return tr.dataset.key.split('|').pop() === proc; });
              if (fila) fila.click();
            }
          } catch (e) { console.error('Conteo cíclico', e); }
        }, 120);
        foco = document.getElementById('cc-kpis') || foco;
      }
      if (acc.planificador) {
        var p = acc.planificador;
        fijar('pl-meta', p.meta_venta_mes); fijar('pl-mes', p.meses); fijar('pl-mg', p.margen_pct); fijar('pl-dd', p.dias_cierre);
        foco = document.getElementById('pl-pres') || foco;
      }
      if (acc.grafico) foco = tarjetaDashboard(acc.grafico);
      if (!foco && acc.pestana) foco = document.getElementById('pg-' + acc.pestana);
      if (guia) posada(guia, foco);          // la cabeza ya está encima: no se vuelve a desplazar la página
      else if (foco) setTimeout(function () { destacar(foco); mirarHacia(foco, 1800); gesto('curiosa', 900); }, 250);
    } catch (e) { console.error('Acción del asistente', e); if (guia) guiaFin(guia); }
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

  /* Un hueco [[#n]] del texto se rellena con su bloque (el grafico se crea ya colgado, para medir su ancho) */
  function rellenar(hueco) {
    // basta con que siga dentro de su burbuja: al repintar el historial la burbuja aún no está en la página
    if (!hueco.parentNode) return null;
    var el = hueco._fab ? hueco._fab() : null;
    if (el) hueco.replaceWith(el); else hueco.remove();
    return el;
  }

  function revelar(caja, piezas) {
    // Vacia los textos ya pintados y guarda sus palabras para irlas devolviendo. Los huecos de
    // bloques ([[#n]] en el texto) entran en el mismo orden: texto, bloque, texto.
    var nodos = [], w = document.createTreeWalker(caja, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (n.classList.contains('ia-slot')) return NodeFilter.FILTER_ACCEPT;
          return SALTAR[n.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        for (var a = n.parentNode; a && a !== caja; a = a.parentNode) { if (SALTAR[a.nodeName]) return NodeFilter.FILTER_REJECT; }
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (w.nextNode()) nodos.push(w.currentNode);
    var plan = nodos.map(function (n) {
      if (n.nodeType === 1) return { hueco: n };
      var t = n.nodeValue.split(/(\s+)/); n.nodeValue = ''; return { n: n, t: t, i: 0 };
    });

    var k = 0, bi = 0, fin = false;
    var pegado = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    caja.classList.add('ia-escribiendo');

    // Red de seguridad: pase lo que pase, el mensaje termina completo
    function completar() {
      if (fin) return;
      fin = true;
      plan.forEach(function (t) {
        if (t.hueco) rellenar(t.hueco);
        else while (t.i < t.t.length) t.n.nodeValue += t.t[t.i++];
      });
      caja.classList.remove('ia-escribiendo');
      while (bi < piezas.length) caja.appendChild(piezas[bi++]());
      alFondo(pegado);
    }
    var palabras = plan.reduce(function (a, t) { return a + (t.t ? t.t.length : 0); }, 0);
    var huecos = plan.filter(function (t) { return t.hueco; }).length;
    setTimeout(completar, palabras * PASO_PALABRA + (piezas.length + huecos) * PAUSA_BLOQUE + 5000);

    function palabra() {
      if (fin) return;
      if (!caja.isConnected) return completar();   // la reemplazo un repintado
      while (plan[k] && !plan[k].hueco && plan[k].i >= plan[k].t.length) k++;
      var t = plan[k];
      if (t && t.hueco) {                          // llega a un bloque: aparece y sigue escribiendo
        k++;
        var el = rellenar(t.hueco);
        if (el) el.classList.add('ia-entra');
        alFondo(pegado);
        return setTimeout(palabra, el ? PAUSA_BLOQUE : 0);
      }
      if (!t) { caja.classList.remove('ia-escribiendo'); return bloque(); }
      t.n.nodeValue += t.t[t.i++];
      if (t.i < t.t.length && /^\s+$/.test(t.t[t.i])) t.n.nodeValue += t.t[t.i++];
      alFondo(pegado);
      setTimeout(palabra, PASO_PALABRA);
    }

    function bloque() {
      if (fin) return;
      if (!caja.isConnected) return completar();
      if (bi >= piezas.length) { fin = true; return; }
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
    var wrap = document.createElement('div'); wrap.className = 'ia-bienv';   // ocupa todo el alto y centra el saludo

    var hero = document.createElement('div'); hero.className = 'ia-hero';
    hero.innerHTML = '<span class="ia-cabeza ia-grande" id="ia-hcab"><i></i><i></i><b class="ia-mej"></b><b class="ia-mej"></b></span><h3>Hola, soy AlfaCorp Bot</h3>' +
      '<p>Tu asistente de ALFACORP, para ALFA y TORU. ¿En qué te echo una mano?</p>';
    tocable($('#ia-hcab', hero));
    wrap.appendChild(hero);

    var grid = document.createElement('div'); grid.className = 'ia-ideas';
    IDEAS.forEach(function (q) {
      var b = document.createElement('button'); b.className = 'ia-idea'; b.type = 'button'; b.title = q[3];
      b.innerHTML = '<b>' + q[0] + '<span>' + esc(q[1]) + '</span></b><small>' + esc(q[2]) + '</small>';
      b.onclick = function () { preguntar(q[3]); };
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function mensaje(m) {
    var x = burbuja(m.role);
    if (m.role === 'user') {
      var fotos = (m.imagenes || []).filter(function (s) { return /^data:image\//.test(s); });
      if (fotos.length) {
        var g = document.createElement('div'); g.className = 'ia-uimgs';
        fotos.forEach(function (s) { var im = new Image(); im.alt = 'Imagen adjunta'; im.src = s; g.appendChild(im); });
        x.b.appendChild(g);
      }
      var tx = document.createElement('div'); tx.textContent = m.texto; x.b.appendChild(tx);
      return x.m;
    }
    // Cada pieza es una fabrica: se construye en el momento de colgarla
    var fab = function (b) { return function () { return BLOQUES[b.type] ? BLOQUES[b.type](b) : bloqueGrafico(b, false); }; };
    // Los bloques que el texto coloca con [[#n]] van en su sitio (texto, bloque, texto); el resto, al final
    var porN = {}, puestos = {};
    (m.bloques || []).forEach(function (b) { if (b.n) porN[b.n] = b; });
    var conHuecos = String(m.texto || '').replace(/^[ \t]*\[\[\s*#?(\d+)\s*\]\][ \t]*$/gm, function (_, n) {
      return porN[n] ? '\n\n%%IAHUECO' + n + '%%\n\n' : '';
    });
    x.b.innerHTML = md(conHuecos)
      .replace(/<p>\s*%%IAHUECO(\d+)%%\s*<\/p>/g, '<div class="ia-slot" data-n="$1"></div>')
      .replace(/%%IAHUECO(\d+)%%/g, '<div class="ia-slot" data-n="$1"></div>');
    [].forEach.call(x.b.querySelectorAll('.ia-slot'), function (h) {
      var b = porN[h.dataset.n];
      if (b && !puestos[h.dataset.n]) { puestos[h.dataset.n] = 1; h._fab = fab(b); } else h.remove();
    });
    var piezas = (m.bloques || []).filter(function (b) { return !(b.n && puestos[b.n]); }).map(fab);
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
    // La animacion no arranca aqui: la burbuja todavia no esta en el documento.
    // pintar() la lanza justo despues de colgarla (ver colgar()).
    if (m.id && !st.animados[m.id]) { st.animados[m.id] = 1; x.m.animar = function () { revelar(x.b, piezas); }; }
    else {          // repintado: los bloques aparecen ya hechos, sin volver a animar
      var antes = v2Quieto; v2Quieto = true;
      try {
        [].forEach.call(x.b.querySelectorAll('.ia-slot'), rellenar);
        piezas.forEach(function (f) { x.b.appendChild(f()); });
      } finally { v2Quieto = antes; }
    }
    return x.m;
  }
  /* Cuelga el mensaje y solo entonces lo anima: fuera del documento no se puede
   * medir nada y la escritura se quedaba parada con el texto en blanco. */
  function colgar(m) {
    var el = mensaje(m);
    msgs.appendChild(el);
    if (el.animar) { var f = el.animar; el.animar = null; f(); }
    return el;
  }

  function pintar(forzar) {
    var key = st.chat.length + '|' + (st.chat.length ? st.chat[st.chat.length - 1].id : '') + '|' + st.busy + '|' + (st.error || '');
    if (!forzar && key === st.vistoKey) return;
    st.vistoKey = key;
    var abajo = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    msgs.replaceChildren();
    if (!st.chat.length) msgs.appendChild(bienvenida());   // desaparece con la primera pregunta
    st.chat.forEach(function (m) { colgar(m); });
    if (st.busy) {
      var t = burbuja('assistant'); t.m.classList.add('ia-typing'); t.b.setAttribute('aria-label', 'AlfaCorp Bot está escribiendo'); t.b.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>'; msgs.appendChild(t.m);
    }
    if (st.error) { var e = burbuja('assistant'); e.b.style.borderColor = '#e8b4b4'; e.b.textContent = st.error; msgs.appendChild(e.m); }
    btn.disabled = st.busy; txt.disabled = st.busy;
    var es = $('#ia-estado');
    var estado = !st.iaOk ? 'Sin conexión con Claude' : (st.busy ? 'Escribiendo…' : 'En línea');
    if (es) { es.title = estado; es.classList.toggle('off', !st.iaOk); }
    var sub = $('#ia-sub'); if (sub && sub.textContent !== estado) sub.textContent = estado;
    panel.classList.toggle('ia-working', st.busy);   // el anillo del logo late solo mientras trabaja
    panel.classList.toggle('ia-saludo', !st.chat.length);   // con la bienvenida, la cabeza esta abajo y no en la cabecera
    if (G.ocupado && !st.busy) {
      var ult = st.chat[st.chat.length - 1];
      var mal = st.error || (ult && ult.error);
      gesto(mal ? 'triste' : 'feliz', st.error ? 2600 : 1800);
      if (!mal) animarCabeza('ia-salta', 550);
    } else pintarGesto();
    G.ocupado = st.busy;
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
    // Interruptor ASISTENTE_ACTIVO de los Secrets: apagado, no se ve ni el círculo ni el panel
    var oculto = a.asistente === false;
    document.body.classList.toggle('ia-oculto', oculto);
    if (oculto) { if (st.abierto) abrir(false); return; }
    st.iaOk = !!a.ia_ok;
    $('#ia-model').textContent = a.modelo ? 'Claude · ' + a.modelo : 'Claude';
    var w = $('#ia-warn');
    w.hidden = !!a.ia_ok;
    w.innerHTML = a.ia_ok ? '' : IC.alerta + '<span><b>El chat está desactivado.</b> Falta la clave <code>ANTHROPIC_API_KEY</code> en los Secrets de la app.</span>';
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
    // La bienvenida ya no muestra insights, asi que no se piden a la API:
    // seria una llamada de pago sin nada que mostrar.
  };
  document.body.classList.add('ia-on');
  pintar(true);
})();
