"""Asistente de IA del panel (Anthropic Claude con herramientas).

El agente responde preguntas sobre los datos del panel. Tiene tres herramientas:
  - consultar_sql: consultas SELECT (DuckDB) sobre las tablas del panel, solo lectura.
  - simular_descuento: el mismo simulador de la pestaña Planificación.
  - planificar_compra: el mismo planificador de compra y espacio.
"""
from __future__ import annotations

import json
import re

import duckdb
import pandas as pd

import calc

MODELO_POR_DEFECTO = "claude-sonnet-4-5"
MAX_FILAS = 200
MAX_PASOS = 8

# Tablas que ve el agente: nombre -> (función que la saca, descripción)
TABLAS = {
    "inventario": ("ds", calc.DESCRIPCIONES["inventario"]),
    "sellout_mes": ("ds", calc.DESCRIPCIONES["sellout_mes"]),
    "sellout_proveedor": ("ds", calc.DESCRIPCIONES["sellout_proveedor"]),
    "sellout_tienda_prov": ("ds", calc.DESCRIPCIONES["sellout_tienda_prov"]),
    "sku_venta": ("ds", calc.DESCRIPCIONES["sku_venta"]),
    "abc_xyz": ("ds", calc.DESCRIPCIONES["abc_xyz"]),
    "almacenes": ("R", "Almacenes con usado = usado_alfa + usado_toru, libre y pct (0–1) recalculados como usado ÷ capacidad. " + calc.DESCRIPCIONES["almacenes"]),
    "base": ("R", "Inventario ALFA calculado: una fila por SKU con cajas (stock ÷ masterpack hacia arriba), m3 (cajas × m3_masterpack), pct_m3, abc y xyz_vol por volumen acumulado, acum_valor y abc_valor por valor acumulado (A hasta 80 %, B hasta 95 %), clase ('Sin clase' si vacía), riesgo (desc, cz, sinclas, c, ok)."),
    "so_base": ("R", "Sell out por mes, canal, id (id_proveedor) y proveedor con venta (con IGV), costo (costo sin IGV × 1.18, o sea con IGV), unidades y tickets. Incluye intercompañía."),
    "pl_obs": ("R", "Inventario obsoleto ALFA: productos con stock descontinuados (desc=1), clase CZ (cz=1) o sin venta en los 180 días previos al último día del sell out (sinventa=1); valor, m3, ult_venta, criterio, proveedor."),
    "pl_prov": ("R", "Por proveedor: inventario (valor a costo), m3, costo_dia (costo de venta diario sin IGV de la tienda 01 en los últimos 3 meses), dias (días de inventario = inventario ÷ costo_dia; NULL = sin venta), venta (con IGV, todo el periodo, ambas tiendas) y margen (0–1)."),
    "pl_sku": ("R", "Productos ALFA con stock: venta del sell out, margen (0–1; propio si tuvo venta, si no el de su proveedor; ver columna fuente), stock, valor, costo_u (costo unitario sin IGV), ult_venta, proveedor."),
    "abc_seg": ("R", "Productos con stock del archivo ABC-XYZ por empresa (ALFA/TORU): segmento, stock, valor, cajas, m3 (con las medidas de masterpack del inventario; los SKU TORU 'T…' usan las del código sin la T) y medidas (1/0)."),
    "matriz_abc": ("R", "Matriz ABC-XYZ por empresa (emp = ALFA, TORU o all) y clase (AX…CZ y TOTAL): productos, valor, m3, cajas, sin_medidas, pct_valor y pct_m3 (0–1)."),
    "matriz_cl": ("R", "Matriz por clase de la columna XYZABC del inventario ALFA (AX…CZ, SC = sin clase, TOTAL): productos, valor, pct_valor, m3, pct_m3, cajas."),
}

REGLAS = """Reglas del negocio (respétalas al calcular):
- Moneda: soles (S/). La venta del sell out es CON IGV; costo_sin_igv es SIN IGV. Margen bruto = venta − costo_sin_igv × 1.18, y margen % = margen ÷ venta.
- El valor del inventario (Stock Valorizado) es a costo sin IGV.
- ALFA es la tienda '01' y TORU la '02'. Los códigos TORU llevan una T delante del código ALFA.
- Segmento ABC-XYZ: A/B/C = importancia por venta acumulada (A hasta 80 %, B hasta 95 %, C el resto); X/Y/Z = estabilidad de la demanda (X estable, Y variable, Z errática). CZ = candidatos a descontinuar.
- Capacidad de almacén en m³; un almacén con 85 % de uso o más está "por llenarse".
- Días de inventario = inventario ÷ costo de venta diario (tienda 01, últimos 3 meses): hasta 60 bien, 61–120 atención, más de 120 o sin venta = alto.
- Simulador: venta extra necesaria = descuento ÷ (margen − descuento)."""


def _f(v, fmt="{:,.2f}"):
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return "—"
        return fmt.format(v)
    except Exception:
        return str(v)


def resumen_kpis(R: dict) -> str:
    k, a, p, o = R["kpis_inv"], R["alm_tot"], R["pl_kpi"], R["pl_obs_res"]["all"]
    m = R["meses"]
    return "\n".join([
        f"- Periodo del sell out: {m[0]} a {m[-1]} ({len(m)} meses).",
        f"- Inventario ALFA: {k['productos']:,} productos con stock, valor S/ {_f(k['valor'])}, {_f(k['m3'])} m³, {k['cajas']:,} cajas; CZ S/ {_f(k['cz_valor'])}; {k['desc_n']} descontinuados con stock.",
        f"- Obsoleto: {o['productos']:,} productos, S/ {_f(o['valor'])} ({_f(p['obs_pct'], '{:.1%}')} del inventario), {_f(o['m3'])} m³.",
        f"- Días de inventario ALFA: {_f(p['dio'], '{:,.0f}')}; costo de venta diario S/ {_f(p['costo_dia'])}; margen ALFA últimos 3 meses {_f(p['margen_alfa'], '{:.1%}')}; venta mensual promedio ALFA S/ {_f(p['venta_mes_alfa'])}; 1 m³ ≈ S/ {_f(p['valor_m3'])} de inventario.",
        f"- Almacenes: capacidad {_f(a['capacidad'])} m³, usado {_f(a['usado'])} m³ ({_f(a['pct'], '{:.1%}')}), libre {_f(a['libre'])} m³.",
    ])


def system_prompt(R: dict) -> str:
    tablas = "\n".join(f"- {n}: {d}" for n, (_, d) in TABLAS.items())
    return f"""Eres el asistente del "Panel de Inventario y Abastecimiento" de ALFA y TORU (distribución y retail de cuidado personal en Lima, Perú). Respondes en español, de forma breve y concreta, a jefes de compras, logística y gerencia.

Usa la herramienta consultar_sql para obtener cifras: nunca inventes números. Si una pregunta no se puede responder con estos datos, dilo. Muestra montos como S/ 1,234,567 y porcentajes con un decimal. Cuando des una lista, usa una tabla markdown corta (máx. 15 filas) y di cuántas filas hay en total. Al final, si ayuda, sugiere una acción concreta.

Tablas disponibles (DuckDB, SQL estándar; los códigos son texto con ceros a la izquierda):
{tablas}

{REGLAS}

Cifras clave de hoy:
{resumen_kpis(R)}"""


HERRAMIENTAS = [
    {
        "name": "consultar_sql",
        "description": "Ejecuta UNA consulta SQL de solo lectura (SELECT o WITH … SELECT) en DuckDB sobre las tablas del panel y devuelve hasta 200 filas en CSV. Para ver columnas usa: DESCRIBE <tabla> o SELECT * FROM <tabla> LIMIT 5.",
        "input_schema": {"type": "object", "properties": {"sql": {"type": "string", "description": "Consulta SELECT."}}, "required": ["sql"]},
    },
    {
        "name": "simular_descuento",
        "description": "Simula un descuento: cuánto deben subir las unidades vendidas para ganar lo mismo (descuento ÷ (margen − descuento)) y, si se da costo_u y stock, el resultado de liquidar todo el stock. margen y descuento van en fracción (0.12 = 12 %).",
        "input_schema": {"type": "object", "properties": {
            "margen": {"type": "number"}, "descuento": {"type": "number"},
            "costo_u": {"type": "number", "description": "Costo unitario sin IGV (opcional)"},
            "stock": {"type": "number", "description": "Unidades en stock (opcional)"},
            "con_venta": {"type": "boolean", "description": "false si el producto no tuvo venta en el periodo"}},
            "required": ["margen", "descuento"]},
    },
    {
        "name": "planificar_compra",
        "description": "Calcula la compra sugerida (sin IGV) y si cabe en el espacio libre: costo de lo que se va a vender + stock al cierre − inventario útil (sin obsoleto).",
        "input_schema": {"type": "object", "properties": {
            "meta_venta_mes": {"type": "number", "description": "Meta de venta mensual con IGV en soles"},
            "meses": {"type": "integer", "description": "Meses a cubrir (1–12)"},
            "margen": {"type": "number", "description": "Margen esperado en fracción (0.09 = 9 %)"},
            "dias_cierre": {"type": "number", "description": "Días de stock que deben quedar al cierre"}},
            "required": ["meta_venta_mes", "meses", "margen", "dias_cierre"]},
    },
]


def _conexion(ds: dict, R: dict) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(":memory:")
    for n, (src, _) in TABLAS.items():
        df = ds[n] if src == "ds" else R[n]
        con.register(n, df)
    con.execute("SET enable_external_access = false")
    con.execute("SET lock_configuration = true")
    return con


_SQL_OK = re.compile(r"^\s*(select|with|describe|show|summarize)\b", re.I | re.S)


def ejecutar_herramienta(nombre: str, args: dict, ds: dict, R: dict, con) -> str:
    try:
        if nombre == "consultar_sql":
            sql = str(args.get("sql", "")).strip().rstrip(";")
            if not _SQL_OK.match(sql) or ";" in sql:
                return "Error: solo se permite una consulta SELECT/WITH/DESCRIBE."
            df = con.execute(sql).df()
            n = len(df)
            txt = df.head(MAX_FILAS).to_csv(index=False, float_format="%.4f")
            return (f"{n} filas" + (f" (se muestran {MAX_FILAS})" if n > MAX_FILAS else "") + "\n" + txt)[:60000]
        if nombre == "simular_descuento":
            r = calc.simular_descuento(args["margen"], args["descuento"], args.get("costo_u"), args.get("stock") or 0, args.get("con_venta", True))
            return json.dumps(r, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        if nombre == "planificar_compra":
            obs_m3 = R["pl_obs_res"]["all"]["m3"]
            r = calc.planificar_compra(R["pl_kpi"], obs_m3, args["meta_venta_mes"], max(1, int(args["meses"])), args["margen"], max(0, args["dias_cierre"]))
            return json.dumps(r, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        return f"Herramienta desconocida: {nombre}"
    except Exception as e:  # el modelo ve el error y puede corregir la consulta
        return f"Error: {e}"


def responder(cliente, modelo: str, historial: list, ds: dict, R: dict, on_tool=None) -> tuple[str, list]:
    """Corre el ciclo de herramientas. Devuelve (texto final, historial actualizado)."""
    con = _conexion(ds, R)
    sistema = [{"type": "text", "text": system_prompt(R), "cache_control": {"type": "ephemeral"}}]
    msgs = list(historial)
    for _ in range(MAX_PASOS):
        resp = cliente.messages.create(model=modelo, max_tokens=4096, system=sistema, tools=HERRAMIENTAS, messages=msgs)
        bloques = [b.model_dump(exclude_none=True) for b in resp.content]
        msgs.append({"role": "assistant", "content": bloques})
        usos = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not usos:
            texto = "\n".join(b.text for b in resp.content if b.type == "text").strip()
            return texto or "(sin respuesta)", msgs
        resultados = []
        for u in usos:
            out = ejecutar_herramienta(u.name, u.input, ds, R, con)
            if on_tool:
                on_tool(u.name, u.input, out)
            resultados.append({"type": "tool_result", "tool_use_id": u.id, "content": out})
        msgs.append({"role": "user", "content": resultados})
    return "Necesité demasiados pasos para responder. Prueba con una pregunta más específica.", msgs
