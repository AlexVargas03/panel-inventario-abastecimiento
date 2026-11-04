/* Reemplazo del entorno del Claude Dashboard (window.dash) para usar pagina.html dentro de Streamlit.
 * Streamlit envía los datos como argumentos del componente; aquí se exponen con la misma API
 * que usa la página: dash.calc, dash.loader, dash.data, dash.onData, dash.params, dash.setParams,
 * dash.resetParams, dash.setLink, dash.refresh y dash.colors. */
(function () {
  'use strict';
  var calcs = {}, loaders = {}, callbacks = [], cache = {}, raw = null, params = {}, version = null;

  function compute(id) {
    if (cache[id]) return cache[id];
    if (!raw) return { status: 'loading', data: null };
    var r;
    try {
      if (Object.prototype.hasOwnProperty.call(raw, id)) {
        r = { status: 'ok', data: raw[id] };
      } else if (calcs[id]) {
        var ins = (calcs[id].inputs || []).map(compute);
        var bad = ins.find(function (x) { return x.status !== 'ok'; });
        r = bad ? { status: bad.status, data: null, error: bad.error }
                : { status: 'ok', data: calcs[id].fn.apply(null, ins.map(function (x) { return x.data; })) };
      } else {
        r = { status: 'error', data: null, error: 'No hay datos para "' + id + '"' };
      }
    } catch (e) {
      console.error('Error en ' + id, e);
      r = { status: 'error', data: null, error: String(e && e.message || e) };
    }
    cache[id] = r;
    return r;
  }

  function fire() {
    callbacks.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    reportHeight();
  }

  window.dash = {
    colors: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    calc: function (id, def) { calcs[id] = def; },
    loader: function (id, def) { loaders[id] = def; },
    data: compute,
    onData: function (fn) { callbacks.push(fn); if (raw) { try { fn(); } catch (e) { console.error(e); } } },
    params: function () { return Object.assign({}, params); },
    setParams: function (o) {
      Object.keys(o || {}).forEach(function (k) { if (o[k] === null || o[k] === undefined) delete params[k]; else params[k] = o[k]; });
      fire();
    },
    resetParams: function () { params = {}; fire(); },
    setLink: function () {},
    refresh: function () { fire(); },
    _setData: function (d, v) {
      if (v !== undefined && v === version) return;
      version = v; raw = d; cache = {}; fire();
    }
  };

  /* Descargas (botón "Descargar CSV" de la página) */
  window.claude = {
    use: function (name) {
      if (name !== 'downloads') return Promise.reject({ code: 'unavailable' });
      return Promise.resolve({
        save: function (o) {
          var blob = new Blob([o.data], { type: 'text/csv;charset=utf-8' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = o.filename || 'datos.csv';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          return Promise.resolve();
        }
      });
    }
  };

  /* Protocolo de componentes de Streamlit (sin librerías) */
  function send(type, extra) {
    window.parent.postMessage(Object.assign({ isStreamlitMessage: true, type: type }, extra || {}), '*');
  }
  var lastH = 0;
  function reportHeight() {
    var h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
    if (Math.abs(h - lastH) > 1) { lastH = h; send('streamlit:setFrameHeight', { height: h }); }
  }
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.type !== 'streamlit:render' || !m.args) return;
    var a = m.args;
    if (a.version === version) { reportHeight(); return; }
    var tables = a.tables || {}, out = {};
    Object.keys(tables).forEach(function (k) {
      var t = tables[k];
      out[k] = t.rows.map(function (r) { var o = {}; t.cols.forEach(function (c, i) { o[c] = r[i]; }); return o; });
    });
    window.dash._setData(out, a.version);
  });
  window.addEventListener('load', function () {
    send('streamlit:componentReady', { apiVersion: 1 });
    reportHeight();
    if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);
  });
  window.addEventListener('error', function (e) {
    var box = document.getElementById('dash-error');
    if (box) { box.hidden = false; box.textContent = 'Error en la página: ' + (e.message || e); }
  });
})();
