"""Muestra la página original del dashboard (panel_original/pagina.html) dentro de Streamlit.

La página es el mismo HTML/JS del Claude Dashboard. Aquí se arma panel_original/index.html con:
  - base.css: las variables de color y tipografía del tema del dashboard,
  - d3.min.js: la librería de gráficos que usa la página,
  - shim.js: reemplaza el entorno de claude.ai (window.dash) y recibe los datos desde Python,
  - pagina.html: la página tal cual.
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


def _armar_index() -> None:
    pagina = (CARPETA / "pagina.html").read_text(encoding="utf-8")
    html = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel de Inventario y Abastecimiento</title>
<link rel="stylesheet" href="base.css">
<script src="d3.min.js"></script>
<script src="shim.js"></script>
</head><body>
<div id="dash-error" hidden></div>
{pagina}
</body></html>"""
    destino = CARPETA / "index.html"
    if not destino.exists() or destino.read_text(encoding="utf-8") != html:
        destino.write_text(html, encoding="utf-8")


_armar_index()
_componente = components.declare_component("panel_original", path=str(CARPETA))


def _limpio(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if hasattr(v, "item"):
        v = v.item()
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
    return v


def preparar_tablas(ds: dict[str, pd.DataFrame]) -> tuple[dict, str]:
    """Convierte los DataFrames al formato compacto {cols, rows} que recibe la página."""
    tablas = {}
    for nombre, cols in COLUMNAS.items():
        df = ds[ORIGEN.get(nombre, nombre)]
        cols = [c for c in cols if c in df.columns]
        filas = [[_limpio(v) for v in fila] for fila in df[cols].itertuples(index=False, name=None)]
        tablas[nombre] = {"cols": cols, "rows": filas}
    version = hashlib.md5(json.dumps(tablas, ensure_ascii=False, default=str).encode()).hexdigest()
    return tablas, version


def mostrar(tablas: dict, version: str, key: str = "panel"):
    return _componente(tables=tablas, version=version, key=key, default=None)
