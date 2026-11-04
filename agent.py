"""Asistente de IA del panel (Anthropic Claude con herramientas).

El agente responde preguntas sobre los datos del panel, muestra tablas y gráficos en el chat
y puede mover los filtros y pestañas del dashboard. Herramientas:
  - query_business_database: métricas agrupadas por una dimensión, con rango de fechas y filtros.
  - consultar_sql: SELECT libre (DuckDB, solo lectura) sobre las vistas del panel.
  - mostrar_tabla: muestra al usuario el resultado de una consulta como tabla.
  - generate_dynamic_chart: dibuja un gráfico en el chat o en el dashboard.
  - controlar_dashboard: cambia pestaña, periodo, proveedor, empresa, top N, filtros de obsoleto y planificador.
  - simular_descuento / planificar_compra: las calculadoras de la pestaña Planificación.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata

import duckdb
import numpy as np
import pandas as pd

import calc

MODELO_POR_DEFECTO = "claude-sonnet-5-5"
MAX_PASOS = 10
MAX_FILAS_MODELO = 200
MAX_FILAS_TABLA = 60
MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
PESTANAS = {"panel": "pn", "politica": "po", "almacen": "alm", "planificacion": "pl"}
PESTANAS_TXT = {"pn": "Panel de control", "po": "Política por segmento", "alm": "Capacidad de almacén", "pl": "Planificación"}


def _norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return s.lower().strip()


def _clave(s) -> str:
    """Texto sin tildes, espacios ni signos, para comparar nombres (L'OREAL = loreal)."""
    return re.sub(r"[^a-z0-9]", "", _norm(s))


def mes_txt(m: str) -> str:
    return f"{MES[int(m[5:7]) - 1]} {m[:4]}"


def _py(v):
    """Convierte valores de numpy/pandas a tipos JSON."""
    if v is None:
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    return v


# ----------------------------------------------------------------------------
# Vistas de negocio (Data Mart en memoria)
# ----------------------------------------------------------------------------
def vistas(ds: dict, R: dict) -> dict[str, tuple[pd.DataFrame, str]]:
    sp = ds["sellout_proveedor"]
    ventas = pd.DataFrame({
        "mes": sp["mes"], "canal": sp["canal"], "interco": pd.to_numeric(sp["interco"], errors="coerce").fillna(0).astype(int),
        "id_proveedor": sp["id_proveedor"], "proveedor": sp["proveedor"], "venta": sp["venta"].fillna(0),
        "costo_igv": sp["costo_sin_igv"].fillna(0) * calc.IGV, "unidades": sp["unidades"].fillna(0),
        "tickets": sp["tickets"].fillna(0), "skus": sp["skus"].fillna(0)})
    ventas["margen"] = ventas["venta"] - ventas["costo_igv"]
    sm = ds["sellout_mes"]
    ventas_mes = pd.DataFrame({
        "mes": sm["mes"], "canal": sm["canal"], "interco": pd.to_numeric(sm["interco"], errors="coerce").fillna(0).astype(int),
        "venta": sm["venta"].fillna(0), "costo_igv": sm["costo_sin_igv"].fillna(0) * calc.IGV, "unidades": sm["unidades"].fillna(0),
        "tickets": sm["tickets"].fillna(0), "lineas": sm["lineas"].fillna(0)})
    ventas_mes["margen"] = ventas_mes["venta"] - ventas_mes["costo_igv"]
    st_ = ds["sellout_tienda_prov"]
    ventas_tienda = pd.DataFrame({
        "mes": st_["mes"], "tienda": st_["tienda"], "empresa": np.where(st_["tienda"] == "01", "ALFA", np.where(st_["tienda"] == "02", "TORU", st_["tienda"])),
        "proveedor": st_["proveedor"], "venta": st_["venta"].fillna(0), "costo_igv": st_["costo_sin_igv"].fillna(0) * calc.IGV})
    ventas_tienda["margen"] = ventas_tienda["venta"] - ventas_tienda["costo_igv"]
    inv = ds["inventario"]
    prov = dict(zip(inv["sku"], inv["proveedor"]))
    base = R["base"].copy()
    base["proveedor"] = base["sku"].map(prov).fillna("")
    sv = ds["sku_venta"].copy()
    sv["sku"] = sv["sku"].str.strip()
    info = inv.drop_duplicates("sku").set_index("sku")
    productos_venta = pd.DataFrame({
        "sku": sv["sku"], "producto": sv["sku"].map(info["producto"]).fillna(""), "proveedor": sv["sku"].map(info["proveedor"]).fillna(""),
        "categoria": sv["sku"].map(info["categoria"]).fillna(""), "ult_venta": sv["ult_venta"], "unidades": sv["unidades"].fillna(0),
        "venta": sv["venta"].fillna(0), "costo_igv": sv["costo_sin_igv"].fillna(0) * calc.IGV})
    productos_venta["margen"] = productos_venta["venta"] - productos_venta["costo_igv"]
    return {
        "vw_ventas": (ventas, "Sell out por mes (YYYY-MM), canal, interco (1 = intercompañía), id_proveedor y proveedor: venta (con IGV), costo_igv, margen (venta − costo con IGV), unidades, tickets (que incluyen al proveedor; no sumar entre proveedores) y skus."),
        "vw_ventas_mes": (ventas_mes, "Totales del sell out por mes, canal e interco: venta, costo_igv, margen, unidades, tickets (exactos, se pueden sumar) y lineas."),
        "vw_ventas_tienda": (ventas_tienda, "Sell out por mes, tienda ('01' ALFA, '02' TORU), empresa y proveedor: venta, costo_igv, margen."),
        "vw_productos_venta": (productos_venta, "Por SKU todo el periodo: producto, proveedor, categoria, ult_venta, unidades, venta, costo_igv, margen."),
        "vw_inventario": (base, "Inventario ALFA por SKU: producto, proveedor, categoria, grupo, subgrupo, stock, valor (a costo sin IGV), estado, clase (segmento XYZABC o 'Sin clase'), masterpack, cajas, m3, abc (por volumen), abc_valor, riesgo."),
        "vw_productos_margen": (R["pl_sku"], "Productos ALFA con stock: venta, margen (0–1, propio o del proveedor según fuente), stock, valor, costo_u (sin IGV), ult_venta, proveedor."),
        "vw_obsoleto": (R["pl_obs"], "Inventario obsoleto ALFA: sku, producto, proveedor, valor, m3, ult_venta, criterio, desc, cz, sinventa (1/0)."),
        "vw_proveedor_inventario": (R["pl_prov"], "Por proveedor: inventario (valor), m3, costo_dia (costo de venta diario sin IGV tienda 01 últimos 3 meses), dias (días de inventario; NULL = sin venta), venta, margen (0–1)."),
        "vw_abc": (R["abc_seg"], "Productos con stock del archivo ABC-XYZ por empresa (ALFA/TORU): segmento, stock, valor, cajas, m3, medidas."),
        "vw_matriz_abc": (R["matriz_abc"], "Matriz ABC-XYZ por empresa (emp = ALFA, TORU, all) y clase: productos, valor, m3, cajas, sin_medidas, pct_valor, pct_m3 (0–1)."),
        "vw_matriz_clase": (R["matriz_cl"], "Matriz por clase XYZABC del inventario ALFA: productos, valor, pct_valor, m3, pct_m3, cajas."),
        "vw_almacenes": (R["almacenes"], "Almacenes: id, almacen, capacidad, usado_alfa, usado_toru, usado, libre (m³), pct (0–1), vitrina, uni_alfa, uni_toru, monto_alfa, monto_toru."),
    }


# ----------------------------------------------------------------------------
# Periodos
# ----------------------------------------------------------------------------
def resolver_periodo(texto, meses: list[str]) -> tuple[list[str], str]:
    if not meses:
        return [], "sin datos"
    t = _norm(texto)
    if t in ("", "all", "todo", "todos", "total", "todo el periodo", "ytd", "ano", "ano actual", "2026"):
        return meses, f"{mes_txt(meses[0])} – {mes_txt(meses[-1])}"
    if t in ("ultimo_mes", "ultimo mes", "mes actual", "last_month"):
        return meses[-1:], mes_txt(meses[-1])
    if t in ("mes_anterior", "mes anterior", "penultimo mes"):
        return meses[-2:-1], mes_txt(meses[-2])
    m = re.match(r"ultimos?[_ ](\d+)[_ ]mes", t)
    if m:
        n = int(m.group(1))
        sel = meses[-n:]
        return sel, f"{mes_txt(sel[0])} – {mes_txt(sel[-1])}"
    m = re.match(r"q([1-4])[-_ ]?(\d{4})?", t)
    if m:
        q, y = int(m.group(1)), m.group(2) or meses[-1][:4]
        sel = [x for x in meses if x[:4] == y and (int(x[5:7]) - 1) // 3 + 1 == q]
        return sel, f"Q{q}-{y}"
    m = re.findall(r"(\d{4})-(\d{2})", t)
    if m:
        a, b = f"{m[0][0]}-{m[0][1]}", f"{m[-1][0]}-{m[-1][1]}"
        a, b = min(a, b), max(a, b)
        sel = [x for x in meses if a <= x <= b]
        return sel, mes_txt(a) if a == b else f"{mes_txt(a)} – {mes_txt(b)}"
    for i, n in enumerate(MES):
        if t.startswith(n):
            y = re.search(r"\d{4}", t)
            k = f"{y.group(0) if y else meses[-1][:4]}-{i + 1:02d}"
            return [x for x in meses if x == k], mes_txt(k)
    return meses, f"{mes_txt(meses[0])} – {mes_txt(meses[-1])}"


# ----------------------------------------------------------------------------
# Motor analítico: query_business_database
# ----------------------------------------------------------------------------
METRICAS_VENTA = ["total_ventas", "costo", "margen", "margen_pct", "unidades", "tickets", "ticket_promedio"]
METRICAS_INV = ["valor_inventario", "m3", "productos", "cajas", "stock_unidades"]
METRICAS_OTRAS = ["dias_inventario", "obsoleto_valor", "obsoleto_productos", "uso_almacen"]
DIMENSIONES = ["mes", "canal", "proveedor", "interco", "tienda", "empresa", "categoria", "grupo", "segmento", "estado", "producto", "criterio_obsoleto", "almacen", "total"]
ALIAS_DIM = {"cliente": "proveedor", "zona": "tienda", "region": "tienda", "sucursal": "tienda", "linea": "categoria", "clase": "segmento",
             "abc": "segmento", "sku": "producto", "fecha": "mes", "periodo": "mes", "canal_distribucion": "canal", "marca": "proveedor"}
ALIAS_MET = {"ventas": "total_ventas", "venta": "total_ventas", "margen_promedio": "margen_pct", "margen_porcentaje": "margen_pct",
             "unidades_vendidas": "unidades", "valor": "valor_inventario", "inventario": "valor_inventario", "stock": "stock_unidades",
             "espacio": "m3", "obsoleto": "obsoleto_valor", "dias": "dias_inventario", "dio": "dias_inventario", "ticket": "ticket_promedio"}


def _agg_ventas(df: pd.DataFrame, by: list[str], metrica: str) -> pd.DataFrame:
    cols = {c: (c, "sum") for c in ["venta", "costo_igv", "margen", "unidades", "tickets"] if c in df.columns}
    g = df.groupby(by, as_index=False).agg(**cols) if by else pd.DataFrame([{k: df[c].sum() for k, (c, _) in cols.items()}])
    g["margen_pct"] = np.where(g["venta"] != 0, g["margen"] / g["venta"].where(g["venta"] != 0, 1), np.nan)
    if "tickets" in g:
        g["ticket_promedio"] = np.where(g["tickets"] > 0, g["venta"] / g["tickets"].where(g["tickets"] > 0, 1), np.nan)
    return g.rename(columns={"venta": "total_ventas", "costo_igv": "costo"})


def query_business_database(V: dict, meses: list[str], dimension: str, metric: str, date_range=None, filtros=None,
                            top_n=15, orden="desc") -> dict:
    dim = ALIAS_DIM.get(_norm(dimension), _norm(dimension))
    met = ALIAS_MET.get(_norm(metric), _norm(metric))
    f = {k: v for k, v in (filtros or {}).items() if v not in (None, "", "todos", "all")}
    sel, periodo_txt = resolver_periodo(date_range, meses)
    notas = []
    if dim not in DIMENSIONES:
        raise ValueError(f"Dimensión no soportada: {dimension}. Usa una de: {', '.join(DIMENSIONES)}")
    if met not in METRICAS_VENTA + METRICAS_INV + METRICAS_OTRAS:
        raise ValueError(f"Métrica no soportada: {metric}. Usa una de: {', '.join(METRICAS_VENTA + METRICAS_INV + METRICAS_OTRAS)}")

    def filtrar(df):
        for k, v in f.items():
            if k in df.columns:
                if not pd.api.types.is_numeric_dtype(df[k]):
                    df = df[df[k].map(_clave).str.contains(_clave(v), regex=False)]
                else:
                    df = df[df[k] == v]
        return df

    by = [] if dim == "total" else [dim]
    if met in METRICAS_VENTA:
        if dim in ("tienda", "empresa"):
            src = V["vw_ventas_tienda"][0]
            src = filtrar(src[src["mes"].isin(sel)])
            g = _agg_ventas(src, by, met)
            notas.append("Por tienda solo hay venta, costo y margen.")
        elif dim in ("producto", "categoria"):
            src = filtrar(V["vw_productos_venta"][0])
            by = ["sku", "producto"] if dim == "producto" else ["categoria"]
            g = _agg_ventas(src, by, met)
            periodo_txt = f"{mes_txt(meses[0])} – {mes_txt(meses[-1])} (por producto no hay detalle mensual)"
        elif dim in ("mes", "canal", "interco", "total") and "proveedor" not in f:
            src = filtrar(V["vw_ventas_mes"][0])
            src = src[src["mes"].isin(sel)]
            g = _agg_ventas(src, by, met)
        else:
            src = V["vw_ventas"][0]
            src = filtrar(src[src["mes"].isin(sel)])
            g = _agg_ventas(src, by, met)
            if met in ("tickets", "ticket_promedio") and dim != "proveedor":
                notas.append("Los tickets por proveedor se repiten entre proveedores; el total es aproximado.")
        unidad = "ventas"
    elif met in METRICAS_INV:
        if dim == "empresa" or "empresa" in f:
            src = filtrar(V["vw_abc"][0])
            by = ["empresa"] if dim == "empresa" else ([] if dim == "total" else [dim])
            if by and by[0] not in src.columns:
                raise ValueError(f"El archivo ABC-XYZ no se puede agrupar por {dim}.")
            g = (src.groupby(by, as_index=False) if by else src.assign(_k=1).groupby("_k", as_index=False)).agg(
                valor_inventario=("valor", "sum"), m3=("m3", "sum"), productos=("sku", "count"), cajas=("cajas", "sum"), stock_unidades=("stock", "sum"))
            g = g.drop(columns=["_k"], errors="ignore")
        else:
            src = filtrar(V["vw_inventario"][0].rename(columns={"clase": "segmento"}))
            if dim not in ("total", "proveedor", "categoria", "grupo", "segmento", "estado", "producto"):
                raise ValueError(f"El inventario no se puede agrupar por {dim}.")
            by = ["sku", "producto"] if dim == "producto" else by
            src = src.assign(vpos=src["valor"].clip(lower=0))
            g = (src.groupby(by, as_index=False) if by else src.assign(_k=1).groupby("_k", as_index=False)).agg(
                valor_inventario=("vpos", "sum"), m3=("m3", "sum"), productos=("sku", "count"), cajas=("cajas", "sum"), stock_unidades=("stock", "sum"))
            g = g.drop(columns=["_k"], errors="ignore")
        periodo_txt = "stock actual"
        unidad = "inventario"
    elif met == "dias_inventario":
        g = filtrar(V["vw_proveedor_inventario"][0])
        g = g[g["inventario"] >= 10000].rename(columns={"dias": "dias_inventario"})[["proveedor", "inventario", "costo_dia", "dias_inventario"]]
        notas.append("Solo proveedores con S/ 10,000 o más de inventario; días vacíos = sin venta en 3 meses.")
        periodo_txt = "inventario actual ÷ costo diario de los últimos 3 meses (tienda 01)"
        unidad = "dias"
    elif met in ("obsoleto_valor", "obsoleto_productos"):
        src = filtrar(V["vw_obsoleto"][0])
        if dim == "criterio_obsoleto":
            filas = [{"criterio_obsoleto": n, "obsoleto_valor": src.loc[src[k] == 1, "valor"].sum(), "obsoleto_productos": int((src[k] == 1).sum()),
                      "m3": src.loc[src[k] == 1, "m3"].sum()} for k, n in (("desc", "Descontinuado"), ("cz", "CZ"), ("sinventa", "Sin venta 180 d"))]
            g = pd.DataFrame(filas)
        else:
            by = ["sku", "producto"] if dim == "producto" else by
            g = src.groupby(by, as_index=False).agg(obsoleto_valor=("valor", "sum"), obsoleto_productos=("sku", "count"), m3=("m3", "sum"))
        periodo_txt = "stock actual"
        unidad = "inventario"
    else:  # uso_almacen
        g = V["vw_almacenes"][0][["almacen", "capacidad", "usado_alfa", "usado_toru", "libre", "pct"]].rename(columns={"pct": "uso_almacen"})
        periodo_txt = "último Excel de almacenes"
        unidad = "almacen"

    if g is None or g.empty:
        return {"filas": [], "columnas": [], "periodo": periodo_txt, "notas": notas + ["Sin datos para esos filtros."]}
    sort_col = met if met in g.columns else g.columns[-1]
    if dim == "mes":
        g = g.sort_values("mes")
    else:
        g = g.sort_values(sort_col, ascending=(_norm(orden) == "asc"), na_position="last")
    total_filas = len(g)
    aditivas = {"total_ventas", "costo", "margen", "unidades", "valor_inventario", "m3", "productos", "cajas", "obsoleto_valor", "obsoleto_productos"}
    if met in aditivas and met in g.columns and dim not in ("total",):
        tot = g[met].sum()
        g["part"] = g[met] / tot if tot else np.nan
    if top_n and dim != "mes":
        g = g.head(int(top_n))
    # columnas: dimensión primero, métrica pedida después
    lead = [c for c in (by or []) if c in g.columns]
    rest = [c for c in g.columns if c not in lead]
    if met in rest:
        rest.remove(met)
        rest.insert(0, met)
    g = g[lead + rest]
    return {"filas": g, "periodo": periodo_txt, "notas": notas, "total_filas": total_filas, "unidad": unidad,
            "filtros": f, "dimension": dim, "metrica": met}


# ----------------------------------------------------------------------------
# Formato de tablas para el chat
# ----------------------------------------------------------------------------
def formato_col(c: str) -> str:
    c = c.lower()
    if c in ("part", "uso_almacen", "pct", "margen_pct", "pct_valor", "pct_m3") or c.endswith("_pct"):
        return "pct"
    if any(k in c for k in ("venta", "costo", "valor", "inventario", "monto", "ticket_promedio", "precio", "margen_soles")) or c in ("margen", "obsoleto_valor"):
        return "money"
    if c in ("m3", "capacidad", "libre", "usado", "usado_alfa", "usado_toru", "vitrina"):
        return "dec1"
    if c in ("dias", "dias_inventario"):
        return "int"
    return "auto"


def tabla_json(df: pd.DataFrame, titulo: str, nota: str = "", total_filas: int | None = None) -> dict:
    df = df.head(MAX_FILAS_TABLA)
    cols = [str(c) for c in df.columns]
    fmts = {}
    for c in cols:
        f = formato_col(c)
        if f == "pct" and c == "margen":
            f = "money"
        fmts[c] = f
    # 'margen' como fracción en algunas vistas (pl_prov, pl_sku)
    if "margen" in df.columns and df["margen"].dropna().abs().le(1.5).all() and "venta" in df.columns and df["venta"].abs().max() > 10:
        fmts["margen"] = "pct"
    filas = [[_py(v) for v in r] for r in df.itertuples(index=False, name=None)]
    return {"type": "table", "titulo": titulo, "cols": cols, "fmts": fmts, "rows": filas, "nota": nota,
            "total_filas": total_filas if total_filas is not None else len(df)}


def df_texto(df: pd.DataFrame) -> str:
    return df.head(MAX_FILAS_MODELO).to_csv(index=False, float_format="%.4f")


# ----------------------------------------------------------------------------
# Herramientas
# ----------------------------------------------------------------------------
HERRAMIENTAS = [
    {
        "name": "query_business_database",
        "description": "Ejecuta una consulta analítica: agrupa una métrica por una dimensión, en un rango de fechas y con filtros. El resultado se le MUESTRA al usuario como tabla en el chat (salvo mostrar=false). "
                       f"Dimensiones: {', '.join(DIMENSIONES)} ('total' = sin agrupar). Métricas de venta (sell out): {', '.join(METRICAS_VENTA)}. "
                       f"Métricas de inventario (stock actual): {', '.join(METRICAS_INV)}. Otras: dias_inventario (por proveedor), obsoleto_valor/obsoleto_productos (por proveedor, categoria, producto o criterio_obsoleto), uso_almacen (por almacen).",
        "input_schema": {"type": "object", "properties": {
            "dimension": {"type": "string", "description": "Dimensión de agrupación (ej: 'proveedor', 'mes', 'canal', 'categoria', 'segmento', 'tienda', 'producto')"},
            "metric": {"type": "string", "description": "Métrica (ej: 'total_ventas', 'margen_pct', 'unidades', 'valor_inventario', 'dias_inventario')"},
            "date_range": {"type": "string", "description": "Rango para métricas de venta: 'all', 'ultimo_mes', 'mes_anterior', 'ultimos_3_meses', 'Q2-2026', '2026-06', '2026-04:2026-06'. Si el usuario no lo dice, usa el periodo activo del dashboard."},
            "filtros": {"type": "object", "description": "Filtros opcionales por texto: proveedor, canal, categoria, empresa (ALFA/TORU), segmento (AX…CZ), estado, interco (0/1).",
                        "properties": {"proveedor": {"type": "string"}, "canal": {"type": "string"}, "categoria": {"type": "string"}, "empresa": {"type": "string"},
                                       "segmento": {"type": "string"}, "estado": {"type": "string"}, "interco": {"type": "integer"}}},
            "top_n": {"type": "integer", "description": "Cuántas filas mostrar (por defecto 15; 0 = todas)"},
            "orden": {"type": "string", "enum": ["desc", "asc"]},
            "titulo": {"type": "string", "description": "Título corto de la tabla para el usuario"},
            "mostrar": {"type": "boolean", "description": "false para usarla solo como dato interno"}},
            "required": ["dimension", "metric"]},
    },
    {
        "name": "consultar_sql",
        "description": "Consulta SQL libre de solo lectura (SELECT o WITH, DuckDB) sobre las vistas vw_* del panel. Devuelve hasta 200 filas en CSV para ti; el usuario no la ve (usa mostrar_tabla o query_business_database para mostrar resultados).",
        "input_schema": {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]},
    },
    {
        "name": "mostrar_tabla",
        "description": "Muestra al usuario en el chat una tabla con el resultado de una consulta SQL (máx. 60 filas). Úsala para listas o detalles que el usuario debe ver.",
        "input_schema": {"type": "object", "properties": {
            "titulo": {"type": "string"}, "sql": {"type": "string", "description": "SELECT sobre las vistas vw_*; nombra las columnas en español"},
            "nota": {"type": "string", "description": "Aclaración corta bajo la tabla (opcional)"}}, "required": ["titulo", "sql"]},
    },
    {
        "name": "generate_dynamic_chart",
        "description": "Dibuja un gráfico para el usuario. destino 'chat' lo pone en la conversación; 'dashboard' lo pone en la tarjeta 'Análisis de IA' arriba del dashboard. "
                       "Datos: pasa 'sql' (primera columna = etiquetas, demás columnas numéricas = series; para scatter: etiqueta, x, y; para heatmap: fila, columna, valor) o 'data_payload' "
                       "({labels:[...], series:[{name, values:[...]}]} o, para scatter, {points:[{label,x,y}]}, o para heatmap {x:[...], y:[...], z:[[...]]}).",
        "input_schema": {"type": "object", "properties": {
            "chart_type": {"type": "string", "enum": ["line", "bar", "pie", "scatter", "heatmap"]},
            "titulo": {"type": "string"},
            "sql": {"type": "string"},
            "data_payload": {"type": "object"},
            "formato": {"type": "string", "enum": ["money", "pct", "num"], "description": "Formato de los valores"},
            "destino": {"type": "string", "enum": ["chat", "dashboard"]}},
            "required": ["chart_type", "titulo"]},
    },
    {
        "name": "controlar_dashboard",
        "description": "Mueve el dashboard para mostrarle algo al usuario: cambia la pestaña, el periodo del sell out, el proveedor filtrado, el top de proveedores, la empresa de la matriz ABC-XYZ, el filtro de inventario obsoleto o los valores del planificador de compra. Solo pasa lo que quieras cambiar.",
        "input_schema": {"type": "object", "properties": {
            "pestana": {"type": "string", "enum": list(PESTANAS)},
            "periodo_desde": {"type": "string", "description": "YYYY-MM (sell out)"},
            "periodo_hasta": {"type": "string", "description": "YYYY-MM (sell out)"},
            "todo_el_periodo": {"type": "boolean"},
            "proveedor": {"type": "string", "description": "Nombre del proveedor a filtrar en ventas; 'todos' para quitar el filtro"},
            "top_proveedores": {"type": "integer", "enum": [10, 20, 50, 0]},
            "empresa_abc": {"type": "string", "enum": ["ALFA", "TORU", "all"]},
            "criterio_obsoleto": {"type": "string", "enum": ["all", "desc", "cz", "sinventa"]},
            "buscar_obsoleto": {"type": "string", "description": "Texto para buscar en la tabla de obsoletos (SKU, producto o proveedor); '' para limpiar"},
            "planificador": {"type": "object", "properties": {"meta_venta_mes": {"type": "number"}, "meses": {"type": "integer"},
                                                             "margen_pct": {"type": "number", "description": "en % (9.2 = 9,2 %)"}, "dias_cierre": {"type": "number"}}},
            "limpiar_filtros": {"type": "boolean", "description": "Vuelve los filtros del sell out a su estado inicial"}}},
    },
    {
        "name": "simular_descuento",
        "description": "Simula un descuento: cuánto deben subir las unidades vendidas para ganar lo mismo (descuento ÷ (margen − descuento)) y, si se da costo_u y stock, el resultado de liquidar el stock. margen y descuento en fracción (0.12 = 12 %).",
        "input_schema": {"type": "object", "properties": {
            "margen": {"type": "number"}, "descuento": {"type": "number"}, "costo_u": {"type": "number"}, "stock": {"type": "number"},
            "con_venta": {"type": "boolean"}}, "required": ["margen", "descuento"]},
    },
    {
        "name": "planificar_compra",
        "description": "Compra sugerida (sin IGV) y si cabe en el espacio libre: costo de lo que se va a vender + stock al cierre − inventario útil (sin obsoleto).",
        "input_schema": {"type": "object", "properties": {
            "meta_venta_mes": {"type": "number"}, "meses": {"type": "integer"}, "margen": {"type": "number", "description": "fracción (0.09 = 9 %)"},
            "dias_cierre": {"type": "number"}}, "required": ["meta_venta_mes", "meses", "margen", "dias_cierre"]},
    },
]

REGLAS = """Reglas del negocio:
- Moneda: soles (S/). La venta del sell out es CON IGV; el costo se compara con IGV (costo sin IGV × 1.18). Margen = venta − costo con IGV; margen % = margen ÷ venta.
- El valor del inventario (Stock Valorizado) es a costo sin IGV. ALFA = tienda '01', TORU = tienda '02'. Los códigos TORU llevan una T delante del código ALFA.
- ABC = importancia por venta acumulada (A hasta 80 %, B hasta 95 %, C el resto); XYZ = estabilidad de la demanda (X estable, Y variable, Z errática). CZ = candidatos a descontinuar.
- Un almacén con 85 % de uso o más está "por llenarse". Días de inventario: hasta 60 bien, 61–120 atención, más de 120 o sin venta = alto.
- Obsoleto = descontinuado, clase CZ o sin venta en los 180 días previos al último día del sell out.
- No hay datos de compras, devoluciones, clientes ni regiones: si te los piden, dilo y ofrece lo más cercano (proveedor, canal, tienda)."""


# ----------------------------------------------------------------------------
# Contexto del dashboard
# ----------------------------------------------------------------------------
def describir_contexto(ctx: dict | None, R: dict) -> str:
    if not ctx:
        return "El usuario aún no movió filtros: el dashboard está en Panel de control, todo el periodo, todos los proveedores, matriz ABC de ALFA."
    p = ctx.get("params") or {}
    meses = R["meses"]
    d, h = p.get("so_d"), p.get("so_h")
    periodo = "todo el periodo" if not d else (mes_txt(d) if d == (h or d) else f"{mes_txt(d)} – {mes_txt(h)}") + f" (date_range '{d}:{h or d}')"
    prov_id = p.get("so_v")
    nombres = R["so_base"].drop_duplicates("id").set_index("id")["proveedor"]
    prov = nombres.get(prov_id, prov_id) if prov_id else "todos"
    lineas = [
        f"- Pestaña visible: {PESTANAS_TXT.get(ctx.get('pestana'), ctx.get('pestana') or 'Panel de control')}",
        f"- Periodo del sell out: {periodo} (datos de {mes_txt(meses[0])} a {mes_txt(meses[-1])})",
        f"- Proveedor filtrado en ventas: {prov}",
        f"- Top de proveedores mostrado: {p.get('so_n') or 10}",
        f"- Empresa en la matriz ABC-XYZ: {p.get('abc_emp') or 'ALFA'}",
    ]
    if ctx.get("criterio_obsoleto"):
        lineas.append(f"- Filtro de obsoletos: {ctx['criterio_obsoleto']}" + (f", búsqueda '{ctx['buscar_obsoleto']}'" if ctx.get("buscar_obsoleto") else ""))
    if ctx.get("planificador"):
        lineas.append(f"- Planificador: {json.dumps(ctx['planificador'], ensure_ascii=False)}")
    return "\n".join(lineas)


def resumen_kpis(R: dict) -> str:
    k, a, p, o = R["kpis_inv"], R["alm_tot"], R["pl_kpi"], R["pl_obs_res"]["all"]
    m = R["meses"]
    f = lambda v, fmt="{:,.0f}": "—" if v is None or (isinstance(v, float) and math.isnan(v)) else fmt.format(v)
    return "\n".join([
        f"- Sell out: {m[0]} a {m[-1]} ({len(m)} meses).",
        f"- Inventario ALFA: {k['productos']:,} productos con stock, S/ {f(k['valor'])}, {f(k['m3'], '{:,.1f}')} m³; CZ S/ {f(k['cz_valor'])}; {k['desc_n']} descontinuados con stock.",
        f"- Obsoleto: {o['productos']:,} productos, S/ {f(o['valor'])} ({f(p['obs_pct'], '{:.1%}')} del inventario).",
        f"- Días de inventario ALFA {f(p['dio'])}; margen ALFA últimos 3 meses {f(p['margen_alfa'], '{:.1%}')}; venta mensual promedio ALFA S/ {f(p['venta_mes_alfa'])}.",
        f"- Almacenes: {f(a['capacidad'], '{:,.1f}')} m³ de capacidad, {f(a['pct'], '{:.1%}')} de uso, {f(a['libre'], '{:,.1f}')} m³ libres.",
    ])


def system_prompt(V: dict, R: dict) -> str:
    vistas_txt = "\n".join(f"- {n}: {d}" for n, (_, d) in V.items())
    return f"""Eres el Asistente IA del "Panel de Inventario y Abastecimiento" de ALFA y TORU (distribución y retail de cuidado personal en Lima, Perú). Estás en un panel lateral junto al dashboard. Respondes en español, breve y concreto, a jefes de compras, logística y gerencia.

Cómo trabajar:
- Nunca inventes cifras: sácalas con las herramientas.
- Cuando el usuario pida datos, listas o comparaciones, muéstralos con query_business_database o mostrar_tabla (el usuario ve la tabla en el chat; no la repitas entera en tu texto, comenta lo importante).
- Si una tendencia o comparación se entiende mejor en gráfico, usa generate_dynamic_chart (destino 'chat'; usa 'dashboard' solo si el usuario pide verlo en el dashboard).
- Si la respuesta se ve en el dashboard, usa controlar_dashboard para llevar al usuario ahí (cambiar pestaña, periodo, proveedor, filtros) y dile qué cambiaste.
- Mantén el contexto: si el usuario refina ("ahora solo mayorista", "y en junio?"), aplica el cambio sobre lo anterior.
- Cuando el usuario no indique periodo, usa el periodo activo del dashboard (abajo).

Cómo responder (esto importa tanto como el dato):
- Abre con la respuesta en UNA frase. Sin preámbulo, sin "Aquí tienes", sin repetir la pregunta.
- La tabla y el gráfico ya tienen las cifras. NO las recites fila por fila ni mes por mes: eso duplica lo que el usuario ya ve y hace la respuesta pesada. Cita como mucho dos o tres números, los que sostienen tu conclusión.
- Explica el porqué, no el qué: qué cambió, cuánto pesa y a qué se debe.
- Tres o cuatro frases en total. Si usas viñetas, máximo tres y de una línea cada una.
- Nada de encabezados tipo "Lectura:", "Resumen:", "Análisis:" ni secciones numeradas. Es una conversación, no un informe.
- Habla como un colega que conoce el negocio: cercano y directo, sin jerga ni solemnidad. Puedes decir "ojo con", "lo raro aquí es", "esto sí llama la atención".
- Si los datos no permiten responder, dilo en una frase y ofrece lo más cercano.
- Cierra con UNA sola propuesta concreta de siguiente paso, y solo si aporta de verdad. Nunca dos.
- Montos S/ 1,234,567; en prosa, cifras grandes como S/ 3.97 millones. Porcentajes con un decimal.

Vistas disponibles (DuckDB; códigos como texto con ceros a la izquierda):
{vistas_txt}

{REGLAS}

Cifras clave:
{resumen_kpis(R)}"""


# ----------------------------------------------------------------------------
# Ejecución
# ----------------------------------------------------------------------------
_SQL_OK = re.compile(r"^\s*(select|with|describe|show|summarize)\b", re.I | re.S)


class Sesion:
    """Agrupa los datos, la conexión DuckDB y lo que el agente produce en un turno."""

    def __init__(self, ds: dict, R: dict):
        self.ds, self.R = ds, R
        self.V = vistas(ds, R)
        self.con = duckdb.connect(":memory:")
        for n, (df, _) in self.V.items():
            self.con.register(n, df)
        self.con.execute("SET enable_external_access = false")
        self.con.execute("SET lock_configuration = true")
        self.nombres_prov = R["so_base"].drop_duplicates("id")[["id", "proveedor"]]
        self.reiniciar_turno()

    def reiniciar_turno(self):
        self.bloques: list[dict] = []
        self.accion: dict = {}
        self.consultas: list[dict] = []

    def sql(self, q: str) -> pd.DataFrame:
        q = str(q or "").strip().rstrip(";")
        if not _SQL_OK.match(q) or ";" in q:
            raise ValueError("solo se permite una consulta SELECT/WITH.")
        return self.con.execute(q).df()

    def buscar_proveedor(self, texto: str):
        t = _norm(texto)
        if t in ("", "todos", "all", "ninguno"):
            return None, "todos"
        df = self.nombres_prov
        exacto = df[df["proveedor"].map(_clave) == _clave(t)]
        cand = exacto if len(exacto) else df[df["proveedor"].map(_clave).str.contains(_clave(t), regex=False)]
        if cand.empty:
            raise ValueError(f"No encontré el proveedor '{texto}' en el sell out.")
        ventas = self.R["so_base"].groupby("id")["venta"].sum()
        cand = cand.assign(v=cand["id"].map(ventas)).sort_values("v", ascending=False)
        return cand.iloc[0]["id"], cand.iloc[0]["proveedor"]

    # -- herramientas ------------------------------------------------------
    def ejecutar(self, nombre: str, a: dict) -> str:
        if nombre == "query_business_database":
            r = query_business_database(self.V, self.R["meses"], a.get("dimension", ""), a.get("metric", ""), a.get("date_range"),
                                        a.get("filtros"), a.get("top_n", 15), a.get("orden", "desc"))
            df = r["filas"]
            if isinstance(df, list) or df is None or len(df) == 0:
                return "Sin filas. " + " ".join(r.get("notas", []))
            fil = ", ".join(f"{k}={v}" for k, v in r.get("filtros", {}).items())
            nota = f"Periodo: {r['periodo']}" + (f" · filtros: {fil}" if fil else "") + ("" if not r["notas"] else " · " + " ".join(r["notas"]))
            if a.get("mostrar", True):
                titulo = a.get("titulo") or f"{r['metrica'].replace('_', ' ')} por {r['dimension']}"
                self.bloques.append(tabla_json(df, titulo, nota, r["total_filas"]))
            self.consultas.append({"herramienta": nombre, "detalle": json.dumps({k: v for k, v in a.items() if k != "titulo"}, ensure_ascii=False)})
            return f"{nota}\n{r['total_filas']} filas en total (se muestran {len(df)}).\n" + df_texto(df)
        if nombre == "consultar_sql":
            df = self.sql(a.get("sql"))
            self.consultas.append({"herramienta": nombre, "detalle": a.get("sql")})
            return f"{len(df)} filas\n" + df_texto(df)
        if nombre == "mostrar_tabla":
            df = self.sql(a.get("sql"))
            self.consultas.append({"herramienta": nombre, "detalle": a.get("sql")})
            self.bloques.append(tabla_json(df, a.get("titulo") or "Resultado", a.get("nota", ""), len(df)))
            return f"Tabla mostrada al usuario ({len(df)} filas).\n" + df_texto(df.head(40))
        if nombre == "generate_dynamic_chart":
            spec = self._grafico(a)
            if a.get("destino") == "dashboard":
                self.accion.setdefault("grafico", spec)
                self.accion.setdefault("descripcion", []).append(f"gráfico «{spec['titulo']}» en el dashboard")
                return "Gráfico mostrado en la tarjeta 'Análisis de IA' del dashboard."
            self.bloques.append(spec)
            return "Gráfico mostrado en el chat."
        if nombre == "controlar_dashboard":
            return self._controlar(a)
        if nombre == "simular_descuento":
            r = calc.simular_descuento(a["margen"], a["descuento"], a.get("costo_u"), a.get("stock") or 0, a.get("con_venta", True))
            return json.dumps(r, ensure_ascii=False, default=_py)
        if nombre == "planificar_compra":
            r = calc.planificar_compra(self.R["pl_kpi"], self.R["pl_obs_res"]["all"]["m3"], a["meta_venta_mes"], max(1, int(a["meses"])), a["margen"], max(0, a["dias_cierre"]))
            return json.dumps(r, ensure_ascii=False, default=_py)
        return f"Herramienta desconocida: {nombre}"

    def _grafico(self, a: dict) -> dict:
        tipo = a.get("chart_type", "bar")
        spec = {"type": "chart", "chart_type": tipo, "titulo": a.get("titulo") or "Gráfico", "formato": a.get("formato") or "num"}
        if a.get("sql"):
            df = self.sql(a["sql"]).head(400)
            self.consultas.append({"herramienta": "generate_dynamic_chart", "detalle": a["sql"]})
            if df.shape[1] < 2:
                raise ValueError("la consulta del gráfico debe tener al menos 2 columnas.")
            if tipo == "scatter":
                c = list(df.columns)
                pts = [{"label": str(r[0]), "x": _py(r[1]), "y": _py(r[2]) if len(r) > 2 else None} for r in df.itertuples(index=False, name=None)]
                spec.update({"points": pts, "x_label": c[1], "y_label": c[2] if len(c) > 2 else ""})
            elif tipo == "heatmap":
                c = list(df.columns)
                pv = df.pivot_table(index=c[0], columns=c[1], values=c[2], aggfunc="sum")
                spec.update({"y": [str(x) for x in pv.index], "x": [str(x) for x in pv.columns],
                             "z": [[_py(v) for v in fila] for fila in pv.values.tolist()]})
            else:
                spec.update({"labels": [str(x) for x in df.iloc[:, 0]],
                             "series": [{"name": str(c), "values": [_py(v) for v in df[c]]} for c in df.columns[1:] if pd.api.types.is_numeric_dtype(df[c])]})
        else:
            p = a.get("data_payload") or {}
            spec.update({k: p[k] for k in ("labels", "series", "points", "x", "y", "z", "x_label", "y_label") if k in p})
            if "series" not in spec and "values" in p:
                spec["series"] = [{"name": a.get("titulo", "valor"), "values": p["values"]}]
        if tipo in ("line", "bar", "pie") and not spec.get("series"):
            raise ValueError("faltan datos: pasa sql o data_payload con labels y series.")
        return spec

    def _controlar(self, a: dict) -> str:
        acc, desc, params = self.accion, [], {}
        meses = self.R["meses"]
        if a.get("limpiar_filtros"):
            acc["reset"] = True
            desc.append("filtros del sell out reiniciados")
        if a.get("pestana") in PESTANAS:
            acc["pestana"] = PESTANAS[a["pestana"]]
            desc.append(f"pestaña {PESTANAS_TXT[acc['pestana']]}")
        if a.get("todo_el_periodo"):
            params.update({"so_d": None, "so_h": None})
            desc.append("todo el periodo")
        elif a.get("periodo_desde") or a.get("periodo_hasta"):
            d = (a.get("periodo_desde") or a.get("periodo_hasta"))[:7]
            h = (a.get("periodo_hasta") or d)[:7]
            d, h = min(d, h), max(d, h)
            if d not in meses or h not in meses:
                return f"Error: el sell out solo tiene meses de {meses[0]} a {meses[-1]}."
            if d == meses[0] and h == meses[-1]:
                params.update({"so_d": None, "so_h": None})
            else:
                params.update({"so_d": d, "so_h": h})
            desc.append(f"periodo {mes_txt(d)}" + ("" if d == h else f" – {mes_txt(h)}"))
        if "proveedor" in a and a["proveedor"] is not None:
            pid, nombre = self.buscar_proveedor(a["proveedor"])
            params["so_v"] = pid
            desc.append(f"proveedor {nombre}")
        if a.get("top_proveedores") is not None:
            params["so_n"] = int(a["top_proveedores"])
            desc.append(f"top {a['top_proveedores'] or 'todos'} proveedores")
        if a.get("empresa_abc") in ("ALFA", "TORU", "all"):
            params["abc_emp"] = a["empresa_abc"]
            desc.append(f"matriz ABC de {'ALFA + TORU' if a['empresa_abc'] == 'all' else a['empresa_abc']}")
        if a.get("criterio_obsoleto") or a.get("buscar_obsoleto") is not None:
            acc["obsoleto"] = {"criterio": a.get("criterio_obsoleto"), "buscar": a.get("buscar_obsoleto")}
            acc.setdefault("pestana", "pl")
            desc.append("filtro de obsoletos " + (a.get("criterio_obsoleto") or "") + (f" «{a['buscar_obsoleto']}»" if a.get("buscar_obsoleto") else ""))
        if a.get("planificador"):
            acc["planificador"] = a["planificador"]
            acc.setdefault("pestana", "pl")
            desc.append("valores del planificador")
        if params:
            acc.setdefault("params", {}).update(params)
        acc.setdefault("descripcion", []).extend(desc)
        return "Dashboard actualizado: " + (", ".join(desc) if desc else "sin cambios")


def sin_razonamiento(msgs: list) -> list:
    """Quita los bloques de razonamiento del historial.

    Cada bloque va firmado contra el prefijo que lo produjo (system prompt,
    herramientas y mensajes anteriores). Si algo de eso cambia, la API responde
    400 "bound to a different conversation". Esto es la recuperación.
    """
    out = []
    for m in msgs:
        c = m.get("content")
        if m.get("role") == "assistant" and isinstance(c, list):
            limpio = [b for b in c if (b.get("type") if isinstance(b, dict) else None) not in ("thinking", "redacted_thinking")]
            if not limpio:
                continue          # solo tenía razonamiento: el turno entero sobra
            m = {**m, "content": limpio}
        out.append(m)
    return out


def responder(cliente, modelo: str, historial: list, sesion: Sesion, contexto: dict | None) -> tuple[dict, list]:
    """Corre el ciclo de herramientas. Devuelve ({texto, bloques, accion, consultas}, historial)."""
    sesion.reiniciar_turno()
    # El system se queda igual entre turnos. El estado del dashboard cambia en cada
    # pregunta, así que viaja dentro del turno del usuario: si cambiara el system,
    # los bloques de razonamiento firmados de los turnos previos quedarían inválidos.
    sistema = [{"type": "text", "text": system_prompt(sesion.V, sesion.R), "cache_control": {"type": "ephemeral"}}]
    msgs = list(historial)
    if msgs and msgs[-1].get("role") == "user" and isinstance(msgs[-1].get("content"), str):
        msgs[-1] = {"role": "user", "content": [
            {"type": "text", "text": msgs[-1]["content"]},
            {"type": "text", "text": "[Estado actual del dashboard que ve el usuario]\n" + describir_contexto(contexto, sesion.R)},
        ]}
    texto = ""
    recuperado = False
    for _ in range(MAX_PASOS):
        try:
            resp = cliente.messages.create(model=modelo, max_tokens=16000, system=sistema, tools=HERRAMIENTAS, messages=msgs)
        except Exception as e:
            # Conversación heredada de una versión anterior del prompt: se reintenta sin razonamiento
            if not recuperado and "bound to a different conversation" in str(e):
                recuperado = True
                msgs = sin_razonamiento(msgs)
                continue
            raise
        msgs.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
        texto = "\n".join(b.text for b in resp.content if b.type == "text").strip() or texto
        usos = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not usos:
            break
        res = []
        for u in usos:
            try:
                out = sesion.ejecutar(u.name, dict(u.input))
            except Exception as e:
                out = f"Error: {e}"
            res.append({"type": "tool_result", "tool_use_id": u.id, "content": str(out)[:20000]})   # tope al crearlo: el historial ya no se recorta despues
        msgs.append({"role": "user", "content": res})
    else:
        texto = texto or "Necesité demasiados pasos. Prueba con una pregunta más específica."
    return {"texto": texto or "(sin respuesta)", "bloques": sesion.bloques, "accion": sesion.accion,
            "consultas": sesion.consultas}, msgs


# ----------------------------------------------------------------------------
# Insights automáticos
# ----------------------------------------------------------------------------
def insights_reglas(R: dict) -> list[dict]:
    """Alertas calculadas con reglas fijas (instantáneas y sin costo de API)."""
    out = []
    alm = R["almacenes"].sort_values("pct", ascending=False)
    if len(alm):
        a = alm.iloc[0]
        nivel = "alerta" if a["pct"] >= 0.85 else "info"
        out.append({"nivel": nivel, "texto": f"**{a['almacen']}** está al {a['pct']:.0%} de su capacidad ({a['libre']:,.1f} m³ libres)." +
                    (" Está por llenarse." if nivel == "alerta" else ""), "pregunta": "¿Qué almacén está más lleno y qué productos ocupan más espacio?"})
    p = R["pl_kpi"]
    out.append({"nivel": "alerta" if (p["obs_pct"] or 0) > 0.15 else "info",
                "texto": f"El inventario obsoleto suma **S/ {p['obsoleto']:,.0f}** ({p['obs_pct']:.1%} del inventario, {p['obs_n']:,} productos).",
                "pregunta": "¿Qué proveedores concentran el inventario obsoleto?"})
    so = R["so_base"].groupby("mes")["venta"].sum().sort_index()
    if len(so) >= 2:
        d = so.iloc[-1] / so.iloc[-2] - 1 if so.iloc[-2] else 0
        out.append({"nivel": "alerta" if d < -0.03 else "ok" if d > 0.03 else "info",
                    "texto": f"La venta de **{mes_txt(so.index[-1])}** fue S/ {so.iloc[-1]:,.0f}, {'▲' if d >= 0 else '▼'} {abs(d):.1%} vs {mes_txt(so.index[-2])}.",
                    "pregunta": f"¿Por qué cambió la venta de {mes_txt(so.index[-1])} frente al mes anterior? Muéstrame los proveedores que más explican la diferencia."})
    pp = R["pl_prov"]
    pp = pp[(pp["inventario"] > 50000) & pp["dias"].notna()].sort_values("dias", ascending=False)
    if len(pp):
        r = pp.iloc[0]
        out.append({"nivel": "alerta" if r["dias"] > 120 else "info",
                    "texto": f"**{r['proveedor']}** tiene {r['dias']:,.0f} días de inventario (S/ {r['inventario']:,.0f} en stock).",
                    "pregunta": f"Analiza el inventario de {r['proveedor']}: días, obsoleto y margen."})
    return out[:4]


def insights_ia(cliente, modelo: str, R: dict, base: list[dict]) -> list[dict]:
    """Pide a Claude 3 insights accionables a partir de un resumen de los datos."""
    so = R["so_base"].groupby("mes").agg(venta=("venta", "sum"), costo=("costo", "sum")).sort_index()
    so["margen_pct"] = (so["venta"] - so["costo"]) / so["venta"]
    top = calc.calc_so_prov(R["so_base"], R["meses"][-3:]).head(10)[["proveedor", "venta", "margen_pct", "part"]]
    datos = (f"{resumen_kpis(R)}\n\nVenta y margen por mes:\n{so.round(4).to_csv()}\n"
             f"Top 10 proveedores últimos 3 meses:\n{top.round(4).to_csv(index=False)}\n"
             f"Matriz ABC ALFA:\n{R['matriz_cl'].round(4).to_csv(index=False)}\n"
             f"Proveedores con más días de inventario:\n{R['pl_prov'][R['pl_prov']['inventario'] > 50000].sort_values('dias', ascending=False).head(8).round(1).to_csv(index=False)}\n"
             f"Almacenes:\n{R['almacenes'][['almacen', 'capacidad', 'usado', 'libre', 'pct']].round(3).to_csv(index=False)}")
    msg = cliente.messages.create(model=modelo, max_tokens=6000, messages=[{"role": "user", "content":
        "Eres analista de inventario de ALFA/TORU (Perú). Con estos datos escribe EXACTAMENTE 3 insights accionables y concretos, "
        "con cifras, en español, máx. 30 palabras cada uno. Responde solo JSON: "
        '[{"nivel":"alerta|ok|info","texto":"… usa **negrita** para lo clave","pregunta":"pregunta de seguimiento para el chat"}]\n\n' + datos}])
    txt = "".join(b.text for b in msg.content if b.type == "text")
    m = re.search(r"\[.*\]", txt, re.S)
    items = json.loads(m.group(0)) if m else []
    items = [i for i in items if isinstance(i, dict) and i.get("texto")][:3]
    return items or base
