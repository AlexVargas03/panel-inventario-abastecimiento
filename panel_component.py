"""Muestra la página original del dashboard (panel_original/pagina.html) con el Asistente IA al lado.

panel_original/index.html se arma al iniciar con:
  - base.css: variables de color y tipografía del tema del Claude Dashboard,
  - d3.min.js: librería de gráficos que usa la página,
  - shim.js: reemplaza el entorno de claude.ai (window.dash) y carga los datos,
  - pagina.html: la página original, sin cambios,
  - ia.css / ia.js: el panel del Asistente IA (chat, tablas, gráficos y acciones sobre el dashboard).
Para actualizar el diseño basta con reemplazar pagina.html por la nueva versión del dashboard.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pandas as pd
import streamlit.components.v1 as components

CARPETA = Path(__file__).parent / "panel_original"

# Columnas que la página lee de cada archivo (se manda solo eso para que cargue rápido)
COLUMNAS = {
    "inventario": ["sku", "producto", "proveedor", "categoria", "grupo", "subgrupo", "stock", "valor", "estado", "clase", "masterpack", "m3_masterpack"],
    "sellout_mes": ["mes", "canal", "interco", "venta", "costo_sin_igv", "unidades", "tickets", "lineas"],
    "sellout_proveedor": ["mes", "canal", "interco", "id_proveedor", "proveedor", "venta", "costo_sin_igv", "unidades", "tickets", "skus"],
    "sellout_tienda_prov": ["mes", "tienda", "proveedor", "venta", "costo_sin_igv"],
    "sku_venta": ["sku", "ult_venta", "unidades", "venta", "costo_sin_igv"],
    "almacenes_real": ["id", "almacen", "capacidad", "usado_alfa", "usado_toru", "usado_total", "libre", "pct_total", "pct_alfa", "pct_toru", "vitrina", "uni_alfa", "uni_toru", "monto_alfa", "monto_toru"],
    "abc_xyz_nuevo": ["empresa", "producto_id", "producto", "categoria", "segmento", "stock", "valor"],
}
# nombre en la página -> nombre del archivo en la app
ORIGEN = {"almacenes_real": "almacenes", "abc_xyz_nuevo": "abc_xyz"}


def _sello() -> str:
    """Huella de los archivos de la página: cambia con cada versión y obliga al navegador a bajarlos de nuevo."""
    h = hashlib.sha1()
    for n in ("base.css", "ia.css", "d3.min.js", "shim.js", "ia.js"):
        h.update((CARPETA / n).read_bytes())
    return h.hexdigest()[:10]


def _armar_index() -> None:
    pagina = (CARPETA / "pagina.html").read_text(encoding="utf-8")
    v = _sello()
    html = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel de Inventario y Abastecimiento</title>
<link rel="stylesheet" href="base.css?v={v}">
<link rel="stylesheet" href="ia.css?v={v}">
<script src="d3.min.js?v={v}"></script>
<script src="shim.js?v={v}"></script>
</head><body>
<div id="ia-wrap">
<main id="ia-main">
<div id="dash-error" hidden></div>
{pagina}
</main>
<aside id="ia-panel" aria-label="Asistente IA"></aside>
</div>
<button id="ia-handle" type="button" title="Mostrar u ocultar el Asistente IA" aria-label="Mostrar u ocultar el Asistente IA">»</button>
<script src="ia.js?v={v}"></script>
</body></html>"""
    destino = CARPETA / "index.html"
    if not destino.exists() or destino.read_text(encoding="utf-8") != html:
        destino.write_text(html, encoding="utf-8")


_armar_index()
_componente = components.declare_component("panel_original", path=str(CARPETA))


def _limpio(v):
    if v is None:
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def preparar_datos(ds: dict[str, pd.DataFrame]) -> tuple[str, str]:
    """Escribe los datos de la página en panel_original/datos_<versión>.json y devuelve (archivo, versión)."""
    tablas = {}
    for nombre, cols in COLUMNAS.items():
        df = ds[ORIGEN.get(nombre, nombre)]
        cols = [c for c in cols if c in df.columns]
        tablas[nombre] = {"cols": cols, "rows": [[_limpio(v) for v in fila] for fila in df[cols].itertuples(index=False, name=None)]}
    texto = json.dumps(tablas, ensure_ascii=False, separators=(",", ":"))
    version = hashlib.md5(texto.encode()).hexdigest()[:16]
    archivo = f"datos_{version}.json"
    destino = CARPETA / archivo
    if not destino.exists():
        destino.write_text(texto, encoding="utf-8")
        # deja solo los 5 archivos de datos más recientes
        viejos = sorted(CARPETA.glob("datos_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[5:]
        for p in viejos:
            try:
                p.unlink()
            except OSError:
                pass
    return archivo, version


def mostrar(archivo: str, version: str, key: str = "panel", **estado):
    """Dibuja el dashboard + asistente. Devuelve el último evento del panel (pregunta, insights, reiniciar) o None."""
    return _componente(data_url=archivo, version=version, key=key, default=None, **estado)
