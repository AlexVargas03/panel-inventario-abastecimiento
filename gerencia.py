"""Indicadores de gerencia para AlfaCorp Bot.

Se calculan en código (el modelo no los inventa), cada uno con su referencia (meta, cuota,
año anterior o umbral) y su estado de semáforo: 'bien', 'atencion' o 'mal'.
Los umbrales están en UMBRALES para ajustarlos en un solo lugar.
"""
from __future__ import annotations

import calendar
import math
from datetime import date, datetime, timedelta, timezone

import pandas as pd

LIMA = timezone(timedelta(hours=-5))
MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

# (valor para 'bien', valor para 'atencion', True si más es mejor)
UMBRALES = {
    "venta_mes": (1.00, 0.95, True),          # venta del mes ÷ meta a hoy
    "cumplimiento": (1.00, 0.95, True),       # venta ÷ cuota, meses cerrados del año
    "crecimiento": (0.00, -0.05, True),       # vs mismos meses del año anterior
    "compra_venta": (1.05, 1.20, False),      # compras ÷ ventas del año
    "meses_inventario": (2.0, 3.0, False),    # inventario ÷ venta promedio de los últimos 3 meses
    "ocupacion": (0.85, 0.85, False),         # % de uso global (85 % = por llenarse)
    "exactitud": (0.97, 0.93, True),          # artículos sin diferencia ÷ contados, últimos 30 días
    "obsoleto": (0.05, 0.10, False),          # % del inventario ALFA
}
ORDEN = list(UMBRALES)
NOMBRE_EMP = {"ALL": "Alfa Corp", "ALFA": "ALFA", "TORU": "TORU"}


def hoy() -> date:
    return datetime.now(LIMA).date()


# Último día con ventas cargadas. La venta de un día se sube en la noche, así que hoy todavía
# no tiene venta: el mes en curso se mide hasta este día, no hasta hoy. Lo fija la app con
# fijar_corte_ventas(); sin ese dato se usa ayer.
_CORTE_VENTAS: date | None = None
HORA_CIERRE = 18      # un archivo de ventas subido desde esta hora (Lima) ya trae la venta de ese día


def corte_desde_modificado(modificado: str | None) -> date | None:
    """Fecha de corte según la última modificación del archivo de ventas (ISO, UTC en SharePoint)."""
    if not modificado:
        return None
    try:
        m = datetime.fromisoformat(str(modificado).replace("Z", "+00:00"))
    except ValueError:
        return None
    m = (m if m.tzinfo else m.replace(tzinfo=timezone.utc)).astimezone(LIMA)
    return m.date() if m.hour >= HORA_CIERRE else m.date() - timedelta(days=1)


_FECHAS_ARCHIVOS: dict[str, datetime] = {}


def fijar_fechas_archivos(modificados: dict[str, str]) -> None:
    """Fecha y hora (Lima) de la última modificación de cada archivo de SharePoint, por clave (abc_xyz, ventas_canal…)."""
    _FECHAS_ARCHIVOS.clear()
    for clave, txt in (modificados or {}).items():
        try:
            m = datetime.fromisoformat(str(txt).replace("Z", "+00:00"))
        except ValueError:
            continue
        _FECHAS_ARCHIVOS[clave] = (m if m.tzinfo else m.replace(tzinfo=timezone.utc)).astimezone(LIMA)


def fecha_archivo(clave: str) -> datetime | None:
    return _FECHAS_ARCHIVOS.get(clave)


def fijar_corte_ventas(corte: date | None) -> None:
    global _CORTE_VENTAS
    _CORTE_VENTAS = corte


def corte_ventas() -> date:
    """Último día con ventas cargadas; nunca después de ayer si el archivo no dice otra cosa."""
    h = hoy()
    return min(_CORTE_VENTAS, h) if _CORTE_VENTAS else h - timedelta(days=1)


def habiles(anio: int, mes: int, hasta: int | None = None) -> tuple[int, int]:
    """Días hábiles (lunes a sábado) transcurridos hasta el día `hasta` (incluido) y del mes completo."""
    n = calendar.monthrange(anio, mes)[1]
    tope = n if hasta is None else min(hasta, n)
    total = sum(1 for d in range(1, n + 1) if date(anio, mes, d).weekday() < 6)
    trans = sum(1 for d in range(1, tope + 1) if date(anio, mes, d).weekday() < 6)
    return trans, total


def _ok(v) -> bool:
    return v is not None and not (isinstance(v, float) and (math.isnan(v) or math.isinf(v)))


def estado(clave: str, v) -> str | None:
    if not _ok(v):
        return None
    bien, aten, sube = UMBRALES[clave]
    if sube:
        return "bien" if v >= bien else "atencion" if v >= aten else "mal"
    return "bien" if v <= bien else "atencion" if v <= aten else "mal"


def soles(v) -> str:
    if not _ok(v):
        return "—"
    s = "−" if v < 0 else ""
    a = abs(v)
    if a >= 1e6:
        return f"{s}S/ {a / 1e6:.1f} M"
    if a >= 1e3:
        return f"{s}S/ {a / 1e3:.0f} mil"
    return f"{s}S/ {a:,.0f}"


def pct(v, dec=1) -> str:
    return "—" if not _ok(v) else f"{v * 100:.{dec}f} %"


def mes_txt(m: str) -> str:
    return f"{MES_CORTO[int(m[5:7]) - 1]} {m[:4]}"


def _por_mes(df: pd.DataFrame, empresa: str, cols: list[str]) -> pd.DataFrame:
    """Suma por mes para la empresa (ALL = ALFA + TORU). Un mes sin el dato queda vacío, no en cero."""
    d = df if empresa == "ALL" else df[df["empresa"] == empresa]
    if d.empty:
        return pd.DataFrame(columns=["mes"] + cols)
    return d.groupby("mes", as_index=False)[cols].sum(min_count=1).sort_values("mes")


# ----------------------------------------------------------------------------
def _venta_mes(V, R, emp, h):
    vc = _por_mes(V["vw_ventas_canal"][0], emp, ["venta_total", "cuota"])
    if vc.empty:
        return None
    actual = f"{h.year}-{h.month:02d}"
    fila = vc[vc["mes"] == actual]
    if fila.empty:                                  # el mes en curso aún no tiene datos: el último disponible
        fila = vc.tail(1)
    r = fila.iloc[0]
    venta, cuota, mes = r["venta_total"], r["cuota"], r["mes"]
    if not _ok(cuota) or not cuota:
        return None
    if mes == actual:
        # se mide hasta el último día con ventas cargadas (normalmente ayer), no hasta hoy
        c = corte_ventas()
        dia = c.day if (c.year, c.month) == (h.year, h.month) else 0
        trans, total = habiles(h.year, h.month, dia)
        if not trans:
            return None
        meta = cuota * trans / total if total else cuota
        falta = max(0.0, cuota - venta)
        resto = max(1, total - trans)                # días hábiles que quedan, contando hoy
        nota = f"Vendido {soles(venta)} de {soles(cuota)} al {dia} {MES_CORTO[h.month - 1]}" + \
            (f" · faltan {soles(falta / resto)} por día hábil ({resto} días)" if falta else " · cuota alcanzada")
        return {"clave": "venta_mes", "indicador": f"Venta de {mes_txt(mes)} vs meta al {dia} {MES_CORTO[h.month - 1]}", "valor": venta / meta if meta else None,
                "fmt": "pct", "ref": f"meta al {dia} {MES_CORTO[h.month - 1]}: {soles(meta)} (día hábil {trans} de {total})", "nota": nota}
    return {"clave": "venta_mes", "indicador": f"Venta de {mes_txt(mes)} vs cuota", "valor": venta / cuota, "fmt": "pct",
            "ref": f"cuota {soles(cuota)}", "nota": f"Vendido {soles(venta)} (mes cerrado)"}


def _cumplimiento(V, R, emp, h):
    vc = _por_mes(V["vw_ventas_canal"][0], emp, ["venta_total", "cuota"])
    actual = f"{h.year}-{h.month:02d}"
    d = vc[(vc["mes"].str[:4] == str(h.year)) & (vc["mes"] < actual) & vc["cuota"].notna() & (vc["cuota"] > 0)]
    if d.empty:
        return None
    logrados = int((d["venta_total"] >= d["cuota"]).sum())
    return {"clave": "cumplimiento", "indicador": f"Cumplimiento de cuota {h.year}", "valor": d["venta_total"].sum() / d["cuota"].sum(),
            "fmt": "pct", "ref": "meta 100 %", "nota": f"{logrados} de {len(d)} meses en cuota · {mes_txt(d['mes'].iloc[0])} a {mes_txt(d['mes'].iloc[-1])}",
            "serie": [round(float(v), 4) for v in (d["venta_total"] / d["cuota"]).tolist()][-12:]}


def _crecimiento(V, R, emp, h):
    vc = _por_mes(V["vw_ventas_canal"][0], emp, ["venta_total"])
    actual = f"{h.year}-{h.month:02d}"
    este = vc[(vc["mes"].str[:4] == str(h.year)) & (vc["mes"] < actual)]
    if este.empty:
        return None
    meses = [m[5:] for m in este["mes"]]
    antes = vc[(vc["mes"].str[:4] == str(h.year - 1)) & (vc["mes"].str[5:].isin(meses))]
    if antes.empty or not antes["venta_total"].sum():
        return None
    v1, v0 = este["venta_total"].sum(), antes["venta_total"].sum()
    serie = vc[vc["mes"] < actual].tail(12)["venta_total"].tolist()
    return {"clave": "crecimiento", "indicador": "Crecimiento de ventas", "valor": v1 / v0 - 1, "fmt": "pct",
            "ref": f"vs {mes_txt(este['mes'].iloc[0])[:3]}–{mes_txt(este['mes'].iloc[-1])[:3]} {h.year - 1}",
            "nota": f"{soles(v1)} frente a {soles(v0)}", "serie": [round(float(v), 2) for v in serie]}


def _compra_venta(V, R, emp, h):
    cv = _por_mes(V["vw_compras_ventas_inv"][0], emp, ["compra", "venta"])
    d = cv[(cv["mes"].str[:4] == str(h.year)) & cv["compra"].notna() & cv["venta"].notna()]
    if d.empty or not d["venta"].sum():
        return None
    return {"clave": "compra_venta", "indicador": f"Compras ÷ ventas {h.year}", "valor": d["compra"].sum() / d["venta"].sum(), "fmt": "pct",
            "ref": "sano ≤ 105 %", "nota": f"Compras {soles(d['compra'].sum())} · ventas {soles(d['venta'].sum())}",
            "serie": [round(float(v), 4) for v in (d["compra"] / d["venta"]).tolist()][-12:]}


def _meses_inventario(V, R, emp, h):
    cv = _por_mes(V["vw_compras_ventas_inv"][0], emp, ["inventario", "venta"])
    inv = cv[cv["inventario"].notna()]
    if inv.empty:
        return None
    ult = inv.iloc[-1]
    ventas = cv[(cv["mes"] <= ult["mes"]) & cv["venta"].notna()].tail(3)["venta"]
    prom = ventas.mean() if len(ventas) else None
    if not _ok(prom) or not prom:
        return None
    return {"clave": "meses_inventario", "indicador": "Meses de inventario", "valor": ult["inventario"] / prom, "fmt": "dec1",
            "ref": "sano ≤ 2 meses", "nota": f"Inventario {soles(ult['inventario'])} ({mes_txt(ult['mes'])}) ÷ venta prom. 3 meses {soles(prom)}"}


def _ocupacion(V, R, emp, h):
    t = R.get("alm_tot") or {}
    p = t.get("pct")
    if not _ok(p):
        return None
    alm = V["vw_almacenes"][0]
    llenos = alm[alm["pct"] >= 0.85] if "pct" in alm else alm.iloc[0:0]
    e = estado("ocupacion", p)
    if e == "bien" and len(llenos):
        e = "atencion"                              # el total está bien, pero hay almacenes por llenarse
    nota = ("Por llenarse: " + ", ".join(f"{str(r['almacen']).split(' - ')[0]} ({pct(r['pct'], 0)})" for _, r in llenos.iterrows())) if len(llenos) else "Ningún almacén por llenarse"
    return {"clave": "ocupacion", "indicador": "Ocupación de almacenes", "valor": p, "fmt": "pct", "ref": "por llenarse desde 85 %",
            "nota": nota, "estado": e}


def _exactitud(V, R, emp, h):
    c = V["vw_conteo"][0]
    if c.empty:
        return None
    if emp in ("ALFA", "TORU"):
        c = c[c["empresa"].astype(str).str.upper() == emp]
    fechas = pd.to_datetime(c["fecha"], errors="coerce")
    if fechas.notna().sum() == 0:
        return None
    desde = fechas.max() - pd.Timedelta(days=30)
    d = c[fechas >= desde]
    if d.empty:
        return None
    sin_dif = (pd.to_numeric(d["diferencia"], errors="coerce").fillna(0) == 0).mean()
    neto = pd.to_numeric(d["valor"], errors="coerce").sum()
    return {"clave": "exactitud", "indicador": "Exactitud del conteo", "valor": float(sin_dif), "fmt": "pct", "ref": "meta ≥ 97 %",
            "nota": f"{d['id_proceso'].nunique()} procesos, últimos 30 días · neto {soles(neto)}"}


def _obsoleto(V, R, emp, h):
    p = R.get("pl_kpi") or {}
    v = p.get("obs_pct")
    if not _ok(v):
        return None
    return {"clave": "obsoleto", "indicador": "Inventario obsoleto (ALFA)", "valor": v, "fmt": "pct", "ref": "sano ≤ 5 %",
            "nota": f"{soles(p.get('obsoleto'))} · {int(p.get('obs_n') or 0):,} productos"}


CALCULOS = {"venta_mes": _venta_mes, "cumplimiento": _cumplimiento, "crecimiento": _crecimiento, "compra_venta": _compra_venta,
            "meses_inventario": _meses_inventario, "ocupacion": _ocupacion, "exactitud": _exactitud, "obsoleto": _obsoleto}


def _valor_txt(f: dict) -> str:
    v = f["valor"]
    if f["fmt"] == "pct":
        return pct(v)
    if f["fmt"] == "dec1":
        return f"{v:.1f}"
    return soles(v)


def tablero(V: dict, R: dict, empresa: str = "ALL", claves: list[str] | None = None, titulo: str | None = None,
            fecha: date | None = None) -> tuple[dict, str]:
    """Devuelve (bloque 'scorecard' para el chat, resumen en texto para el modelo)."""
    emp = empresa if empresa in NOMBRE_EMP else "ALL"
    h = fecha or hoy()
    pedidas = [c for c in (claves or ORDEN) if c in CALCULOS] or ORDEN
    filas = []
    for c in pedidas:
        try:
            f = CALCULOS[c](V, R, emp, h)
        except Exception:                            # un dato que falta no tumba el tablero
            f = None
        if not f or not _ok(f.get("valor")):
            continue
        f.setdefault("estado", estado(c, f["valor"]))
        f["valor"] = round(float(f["valor"]), 4)
        filas.append(f)
    if not filas:
        raise ValueError("no hay datos para calcular los indicadores pedidos")
    cuenta = {e: sum(1 for f in filas if f["estado"] == e) for e in ("bien", "atencion", "mal")}
    bloque = {"type": "scorecard", "titulo": titulo or "Tablero ejecutivo",
              "subtitulo": f"{NOMBRE_EMP[emp]} · al {h.day} {MES_CORTO[h.month - 1]} {h.year}",
              "filas": [{k: f[k] for k in ("clave", "indicador", "valor", "fmt", "ref", "estado", "nota", "serie") if f.get(k) is not None} for f in filas],
              "cuenta": cuenta}
    txt = {"bien": "BIEN", "atencion": "ATENCIÓN", "mal": "MAL"}
    lineas = [f"- {f['indicador']}: {_valor_txt(f)} ({f['ref']}) → {txt.get(f['estado'], '?')}. {f.get('nota', '')}" for f in filas]
    resumen = (f"Tablero ejecutivo de {NOMBRE_EMP[emp]} mostrado al usuario ({cuenta['bien']} bien, {cuenta['atencion']} en atención, {cuenta['mal']} mal):\n"
               + "\n".join(lineas) +
               "\nEscribe un titular de una frase con lo más importante y, como mucho, 3 viñetas cortas sobre lo que está en MAL o ATENCIÓN "
               "(por qué y qué hacer). No repitas las cifras del tablero una por una.")
    return bloque, resumen
