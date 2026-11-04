"""Cálculos del Panel de Inventario y Abastecimiento.

Es la misma lógica de los `dash.calc` del dashboard original (Claude Dashboard),
traducida a pandas. Cada función recibe DataFrames y devuelve DataFrames o dicts.
"""
from __future__ import annotations

import calendar
import json
import math
import re
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
IGV = 1.18
SEGMENTOS = [a + x for a in "ABC" for x in "XYZ"]

# ----------------------------------------------------------------------------
# Lectura de archivos
# ----------------------------------------------------------------------------
# Archivos que usa el panel: nombre -> (archivo por defecto, columnas numéricas)
DATASETS = {
    "inventario": ("inventario.csv", ["stock", "valor", "masterpack", "m3_masterpack"]),
    "sellout_mes": ("sellout_mes.csv", ["venta", "costo_sin_igv", "unidades", "tickets", "lineas"]),
    "sellout_proveedor": ("sellout_proveedor.csv", ["venta", "costo_sin_igv", "unidades", "tickets", "skus"]),
    "sellout_tienda_prov": ("sellout_tienda_prov.csv", ["venta", "costo_sin_igv"]),
    "sku_venta": ("sku_venta.csv", ["unidades", "venta", "costo_sin_igv"]),
    "abc_xyz": ("abc_xyz.csv", ["stock", "valor", "longitud", "ancho", "alto", "peso"]),
    "almacenes": ("almacenes.json", []),
}

DESCRIPCIONES = {
    "inventario": "Inventario ALFA con stock: sku, producto, proveedor, categoria, grupo, subgrupo, stock, valor (Stock Valorizado, a costo sin IGV), estado (Activo/Descontinuado), clase (segmento XYZABC, p. ej. AX, CZ; vacío = sin clase), masterpack (unidades por caja) y m3_masterpack (m³ por caja).",
    "sellout_mes": "Sell out ene–sep 2026 por mes (YYYY-MM), canal (tipo de entrega) e interco (1 = intercompañía): venta con IGV, costo_sin_igv, unidades, tickets (boletas y facturas distintas) y lineas.",
    "sellout_proveedor": "Sell out por mes, canal, interco y proveedor (id_proveedor, proveedor): venta con IGV, costo_sin_igv, unidades, tickets y skus distintos.",
    "sellout_tienda_prov": "Sell out por mes, tienda ('01' = ALFA, '02' = TORU) y proveedor: venta con IGV y costo_sin_igv.",
    "sku_venta": "Por SKU del sell out: ult_venta (fecha de la última venta, YYYY-MM-DD), unidades, venta con IGV y costo_sin_igv.",
    "abc_xyz": "Productos de ALFA y TORU (empresa) con producto_id, producto, categoria, segmento ABC-XYZ, stock, valor (Stock Valorizado), medidas en cm (longitud, ancho, alto) y peso. Los códigos TORU llevan una T delante del código ALFA.",
    "almacenes": "4 almacenes físicos: id, almacen, capacidad, usado_alfa, usado_toru, usado_total, libre (todo en m³), pct_total/pct_alfa/pct_toru (en %), vitrina (m³ de vitrina/cuarentena), uni_alfa, uni_toru, monto_alfa, monto_toru.",
}

TEXT_COLS = {"sku", "producto_id", "id", "id_proveedor", "tienda", "mes", "ult_venta", "clase", "segmento"}


def _limpiar(df: pd.DataFrame, num_cols: list[str]) -> pd.DataFrame:
    df.columns = [str(c).replace("﻿", "").strip() for c in df.columns]
    for c in df.columns:
        if c in num_cols:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        else:
            df[c] = df[c].fillna("").astype(str).str.strip()
    return df


def leer_csv(fuente, num_cols: list[str]) -> pd.DataFrame:
    """Lee un CSV dejando los códigos como texto (conserva ceros a la izquierda)."""
    df = pd.read_csv(fuente, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    return _limpiar(df, num_cols)


# ---- Almacenes: JSON del panel o Excel dashboard_inventarios.xlsx ----------
COLS_ALM = {
    "id_almacen_fisico": "id", "almacen_fisico": "almacen", "capacidad(m3)": "capacidad",
    "usado alfa(m3)": "usado_alfa", "usado toru(m3)": "usado_toru", "usado total(m3)": "usado_total",
    "libre(m3)": "libre", "% uso total": "pct_total", "% ocupa alfa": "pct_alfa", "% ocupa toru": "pct_toru",
    "usado vitrina/cuarentena(m3)": "vitrina", "unidades_alfa": "uni_alfa", "unidades_toru": "uni_toru",
    "monto_alfa": "monto_alfa", "monto_toru": "monto_toru",
}


def _num_pe(v):
    """Convierte números de formato peruano ('1.525.230,42', '64,24%', '-') a float."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return 0.0
    if isinstance(v, (int, float, np.number)):
        return float(v)
    s = re.sub(r"S/|%|\s| ", "", str(v))
    if s == "" or re.fullmatch(r"-+", s):
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def leer_almacenes(fuente, nombre: str = "") -> tuple[pd.DataFrame, dict]:
    """Acepta almacenes.json (formato del panel), un CSV o el Excel dashboard_inventarios.xlsx."""
    meta: dict = {}
    nombre = (nombre or str(fuente)).lower()
    if nombre.endswith(".json"):
        raw = fuente.read() if hasattr(fuente, "read") else Path(fuente).read_bytes()
        df = pd.DataFrame(json.loads(raw))
    else:
        if nombre.endswith((".xlsx", ".xlsm", ".xls")):
            xls = pd.ExcelFile(fuente)
            hoja = next((h for h in xls.sheet_names if h.lower().startswith("inventario")), xls.sheet_names[0])
            raw = xls.parse(hoja, header=None, dtype=object)
            if "Info" in xls.sheet_names:
                info = xls.parse("Info", header=None, dtype=object)
                for _, r in info.iterrows():
                    if len(r) > 1 and str(r[0]).strip() in ("Generado", "Origen"):
                        meta[str(r[0]).strip()] = str(r[1]).strip()
        else:
            raw = pd.read_csv(fuente, header=None, dtype=str, keep_default_na=False, encoding="utf-8-sig", sep=None, engine="python")
        norm = lambda s: re.sub(r"\s+", " ", str(s or "").strip().lower())
        hi = next((i for i, r in raw.iterrows() if any(norm(c) == "id_almacen_fisico" for c in r)), None)
        if hi is None:
            # ya viene con los nombres del panel
            df = raw.copy()
            df.columns = [str(c) for c in df.iloc[0]]
            df = df.iloc[1:]
        else:
            head = [COLS_ALM.get(norm(c)) for c in raw.iloc[hi]]
            rows = []
            for _, r in raw.iloc[hi + 1:].iterrows():
                d = {k: r.iloc[j] for j, k in enumerate(head) if k}
                if not str(d.get("id", "") or "").strip() or str(d.get("id")) == "nan":
                    break
                rows.append(d)
            df = pd.DataFrame(rows)
    falta = [c for c in ["id", "almacen", "capacidad", "usado_alfa", "usado_toru"] if c not in df.columns]
    if falta:
        raise ValueError("Faltan columnas en el archivo de almacenes: " + ", ".join(falta))
    for c in df.columns:
        if c in ("id", "almacen"):
            df[c] = df[c].astype(str).str.strip()
            if c == "id":
                df[c] = df[c].str.replace(r"\.0$", "", regex=True).str.zfill(3)
        else:
            df[c] = df[c].map(_num_pe).astype(float)
    return df.reset_index(drop=True), meta


def cargar_por_defecto() -> dict[str, pd.DataFrame]:
    out = {}
    for k, (archivo, nums) in DATASETS.items():
        p = DATA_DIR / archivo
        if k == "almacenes":
            out[k] = leer_almacenes(p, archivo)[0]
        else:
            out[k] = leer_csv(p, nums)
    return out


def leer_subido(clave: str, archivo) -> pd.DataFrame:
    """Lee un archivo subido desde la app (CSV o Excel)."""
    nums = DATASETS[clave][1]
    nombre = archivo.name.lower()
    if clave == "almacenes":
        return leer_almacenes(archivo, nombre)[0]
    if nombre.endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(archivo, dtype=str).fillna("")
        df = _limpiar(df, nums)
    else:
        df = leer_csv(archivo, nums)
    # Nombres alternativos del CSV de SharePoint dashboard_abcxyz.csv
    if clave == "abc_xyz":
        ren = {"producto_nombre": "producto", "segmento_abcxyz": "segmento", "stock_actual": "stock",
               "stock valorizado": "valor", "longitud_cm": "longitud", "ancho_cm": "ancho", "alto_cm": "alto"}
        df.columns = [ren.get(c.lower(), c.lower()) for c in df.columns]
        for c in nums:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
def fix_pct(vals: list[float]) -> list[float]:
    """Redondea a 0,1 % por mayor resto para que la suma dé exactamente 100 %."""
    sc = [v * 1000 for v in vals]
    fl = [math.floor(v) for v in sc]
    rest = 1000 - sum(fl)
    orden = sorted(range(len(sc)), key=lambda i: -(sc[i] - fl[i]))
    for k in range(min(max(rest, 0), len(orden))):
        fl[orden[k]] += 1
    return [v / 1000 for v in fl]


def dias_mes(m: str) -> int:
    return calendar.monthrange(int(m[:4]), int(m[5:7]))[1]


# ----------------------------------------------------------------------------
# Inventario
# ----------------------------------------------------------------------------
def calc_base(inv: pd.DataFrame) -> pd.DataFrame:
    d = inv.copy()
    stock = d["stock"].fillna(0)
    mp = d["masterpack"].fillna(0)
    mm = d["m3_masterpack"].fillna(0)
    tiene = (mp > 0) & (mm > 0)
    d["cajas"] = np.where(tiene, np.ceil(stock / mp.where(mp > 0, 1)), 0).astype(int)
    d["masterpack"] = np.where(mp > 0, mp, 0)
    d["m3"] = d["cajas"] * mm
    d["valor"] = d["valor"].fillna(0)
    clase = d["clase"].fillna("")
    d["riesgo"] = np.select(
        [d["estado"] == "Descontinuado", clase == "CZ", clase == "", clase.str[:1] == "C"],
        ["desc", "cz", "sinclas", "c"], "ok")
    d["xyz"] = np.where(clase != "", clase.str[1:2], "S")
    d["clase"] = np.where(clase != "", clase, "Sin clase")
    d = d.sort_values("m3", ascending=False, kind="stable").reset_index(drop=True)
    tot = d["m3"].sum() or 1
    acc = d["m3"].cumsum()
    prev = (acc - d["m3"]) / tot
    med = d["m3"] > 0
    d["pct_m3"] = d["m3"] / tot
    d["acum"] = np.where(med, acc / tot, np.nan)
    d["abc"] = np.where(~med, "S/M", np.where(prev < 0.8, "A", np.where(prev < 0.95, "B", "C")))
    d["xyz_vol"] = np.where(~med, "S/M", np.where(prev < 0.8, "X", np.where(prev < 0.95, "Y", "Z")))
    # ABC por valor
    v = d.sort_values("valor", ascending=False, kind="stable")
    pos = v["valor"].clip(lower=0)
    tot_v = pos.sum() or 1
    acc_v = pos.cumsum()
    prev_v = (acc_v - pos) / tot_v
    has = v["valor"] > 0
    d.loc[v.index, "acum_valor"] = np.where(has, acc_v / tot_v, np.nan)
    d.loc[v.index, "abc_valor"] = np.where(~has, "S/V", np.where(prev_v < 0.8, "A", np.where(prev_v < 0.95, "B", "C")))
    return d


def calc_kpis_inv(base: pd.DataFrame) -> dict:
    vpos = base["valor"].clip(lower=0)
    return {
        "productos": len(base),
        "valor": vpos.sum(),
        "m3": base["m3"].sum(),
        "cajas": int(base["cajas"].sum()),
        "cz_valor": vpos[base["clase"] == "CZ"].sum(),
        "desc_n": int((base["estado"] == "Descontinuado").sum()),
    }


def calc_matriz_cl(base: pd.DataFrame) -> pd.DataFrame:
    tot_v = base["valor"].sum()
    tot_m = base["m3"].sum()
    filas = []
    for c in SEGMENTOS + ["SC"]:
        r = base[base["clase"] == ("Sin clase" if c == "SC" else c)]
        filas.append({"clase": c, "productos": len(r), "valor": r["valor"].sum(), "m3": r["m3"].sum(), "cajas": int(r["cajas"].sum())})
    pv = fix_pct([f["valor"] / tot_v if tot_v else 0 for f in filas])
    pm = fix_pct([f["m3"] / tot_m if tot_m else 0 for f in filas])
    for f, a, b in zip(filas, pv, pm):
        f["pct_valor"], f["pct_m3"] = a, b
    filas.append({"clase": "TOTAL", "productos": len(base), "valor": tot_v, "pct_valor": 1, "m3": tot_m, "pct_m3": 1,
                  "cajas": sum(f["cajas"] for f in filas)})
    return pd.DataFrame(filas)


def calc_cat_top(base: pd.DataFrame) -> pd.DataFrame:
    g = (base.assign(vpos=base["valor"].clip(lower=0)).groupby("categoria", as_index=False)
         .agg(valor=("vpos", "sum"), m3=("m3", "sum")).sort_values("valor", ascending=False))
    top, rest = g.head(7), g.iloc[7:]
    if len(rest):
        top = pd.concat([top, pd.DataFrame([{"categoria": f"Otras ({len(rest)})", "valor": rest["valor"].sum(), "m3": rest["m3"].sum()}])])
    return top.reset_index(drop=True)


# ----------------------------------------------------------------------------
# Sell out
# ----------------------------------------------------------------------------
def calc_so_base(sp: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({
        "mes": sp["mes"], "canal": sp["canal"], "id": sp["id_proveedor"], "proveedor": sp["proveedor"],
        "venta": sp["venta"].fillna(0), "costo": sp["costo_sin_igv"].fillna(0) * IGV,
        "unidades": sp["unidades"].fillna(0), "tickets": sp["tickets"].fillna(0),
    })


def meses_sellout(sm: pd.DataFrame) -> list[str]:
    return sorted(sm["mes"].unique())


def _sum_periodo(df, meses):
    r = df[df["mes"].isin(meses)]
    return {"venta": r["venta"].sum(), "costo": r["costo"].sum(), "unidades": r["unidades"].sum(), "tickets": r["tickets"].sum()}


def calc_so_kpi(sm: pd.DataFrame, so_base: pd.DataFrame, meses: list[str], proveedor_id: str | None = None) -> dict:
    """Venta, margen, unidades y ticket del periodo, con variación contra el periodo anterior de igual largo."""
    todos = meses_sellout(sm)
    if proveedor_id:
        src = so_base[so_base["id"] == proveedor_id]
    else:
        src = pd.DataFrame({"mes": sm["mes"], "venta": sm["venta"].fillna(0), "costo": sm["costo_sin_igv"].fillna(0) * IGV,
                            "unidades": sm["unidades"].fillna(0), "tickets": sm["tickets"].fillna(0)})
    a = _sum_periodo(src, meses)
    prev = None
    if meses and len(meses) < len(todos):
        i = todos.index(meses[0])
        n = len(meses)
        if i - n >= 0:
            prev = todos[i - n:i]
    b = _sum_periodo(src, prev) if prev else None
    mp = lambda x: (x["venta"] - x["costo"]) / x["venta"] if x["venta"] else None
    tk = lambda x: x["venta"] / x["tickets"] if x["tickets"] else None
    ch = lambda x, y: x / y - 1 if x is not None and y else None
    n = max(len(meses), 1)
    return {
        **a, "margen": a["venta"] - a["costo"], "margen_pct": mp(a), "ticket_prom": tk(a),
        "prom_venta": a["venta"] / n, "prom_unidades": a["unidades"] / n, "prev": prev,
        "d_venta": ch(a["venta"], b["venta"]) if b else None,
        "d_margen": (mp(a) - mp(b)) if b and mp(a) is not None and mp(b) is not None else None,
        "d_unidades": ch(a["unidades"], b["unidades"]) if b else None,
        "d_ticket": ch(tk(a), tk(b)) if b else None,
    }


def calc_so_mes(so_base: pd.DataFrame, proveedor_id: str | None = None) -> pd.DataFrame:
    src = so_base[so_base["id"] == proveedor_id] if proveedor_id else so_base
    g = src.groupby("mes", as_index=False).agg(venta=("venta", "sum"), costo=("costo", "sum"), unidades=("unidades", "sum"))
    g["margen_pct"] = np.where(g["venta"] != 0, (g["venta"] - g["costo"]) / g["venta"].where(g["venta"] != 0, 1), np.nan)
    return g.sort_values("mes").reset_index(drop=True)


def calc_so_prov(so_base: pd.DataFrame, meses: list[str]) -> pd.DataFrame:
    r = so_base[so_base["mes"].isin(meses)]
    nombres = so_base.groupby("id")["proveedor"].last()
    g = r.groupby("id", as_index=False).agg(venta=("venta", "sum"), costo=("costo", "sum")).sort_values("venta", ascending=False, kind="stable")
    g["proveedor"] = g["id"].map(nombres)
    tv = g["venta"].sum()
    g["margen"] = g["venta"] - g["costo"]
    g["margen_pct"] = np.where(g["venta"] != 0, g["margen"] / g["venta"].where(g["venta"] != 0, 1), np.nan)
    g["part"] = g["venta"] / tv if tv else np.nan
    g.insert(0, "rank", range(1, len(g) + 1))
    return g.reset_index(drop=True)


# ----------------------------------------------------------------------------
# Almacenes
# ----------------------------------------------------------------------------
def calc_almacenes(alm: pd.DataFrame) -> pd.DataFrame:
    d = alm.copy()
    c = d["capacidad"].fillna(0)
    d["usado"] = d["usado_alfa"].fillna(0) + d["usado_toru"].fillna(0)
    d["libre"] = c - d["usado"]
    d["pct"] = np.where(c > 0, d["usado"] / c.where(c > 0, 1), 0)
    d["pct_alfa"] = np.where(c > 0, d["usado_alfa"] / c.where(c > 0, 1), 0)
    d["pct_toru"] = np.where(c > 0, d["usado_toru"] / c.where(c > 0, 1), 0)
    return d


def calc_alm_tot(alm: pd.DataFrame) -> dict:
    cap = alm["capacidad"].sum()
    ua, ut = alm["usado_alfa"].sum(), alm["usado_toru"].sum()
    return {"capacidad": cap, "usado_alfa": ua, "usado_toru": ut, "usado": ua + ut, "libre": cap - ua - ut,
            "pct": (ua + ut) / cap if cap > 0 else 0, "vitrina": alm.get("vitrina", pd.Series(dtype=float)).sum()}


# ----------------------------------------------------------------------------
# Planificación
# ----------------------------------------------------------------------------
def calc_pl_obs(base: pd.DataFrame, inv: pd.DataFrame, sku_venta: pd.DataFrame) -> pd.DataFrame:
    prov = dict(zip(inv["sku"], inv["proveedor"]))
    sv = sku_venta[sku_venta["ult_venta"] != ""]
    ult = dict(zip(sv["sku"].str.strip(), sv["ult_venta"]))
    ref = max(ult.values()) if ult else date.today().isoformat()
    lim = (date.fromisoformat(ref) - timedelta(days=180)).isoformat()
    d = base[["sku", "producto", "valor", "m3", "estado", "clase"]].copy()
    d["ult_venta"] = d["sku"].map(ult).fillna("")
    d["desc"] = (d["estado"] == "Descontinuado").astype(int)
    d["cz"] = (d["clase"] == "CZ").astype(int)
    d["sinventa"] = ((d["ult_venta"] == "") | (d["ult_venta"] < lim)).astype(int)
    d = d[(d["desc"] + d["cz"] + d["sinventa"]) > 0].copy()
    d["criterio"] = d.apply(lambda r: " · ".join(x for x, f in (("Descontinuado", r.desc), ("CZ", r.cz), ("Sin venta", r.sinventa)) if f), axis=1)
    d["proveedor"] = d["sku"].map(prov).fillna("")
    d["valor"] = d["valor"].clip(lower=0)
    d.attrs["ref"], d.attrs["lim"] = ref, lim
    return d.sort_values("valor", ascending=False)[["sku", "producto", "proveedor", "valor", "m3", "ult_venta", "criterio", "desc", "cz", "sinventa"]].reset_index(drop=True)


def calc_pl_obs_res(pl_obs: pd.DataFrame) -> dict:
    out = {}
    for k in ["all", "desc", "cz", "sinventa"]:
        r = pl_obs if k == "all" else pl_obs[pl_obs[k] == 1]
        out[k] = {"productos": len(r), "valor": r["valor"].sum(), "m3": r["m3"].sum()}
    return out


def calc_pl_prov(base: pd.DataFrame, inv: pd.DataFrame, stp: pd.DataFrame) -> pd.DataFrame:
    prov = dict(zip(inv["sku"], inv["proveedor"]))
    b = base.assign(proveedor=base["sku"].map(prov).fillna("SIN PROVEEDOR").replace("", "SIN PROVEEDOR"),
                    vpos=base["valor"].clip(lower=0))
    gi = b.groupby("proveedor").agg(inventario=("vpos", "sum"), m3=("m3", "sum"))
    meses = sorted(stp["mes"].unique())
    ult3 = meses[-3:]
    dias = sum(dias_mes(m) for m in ult3)
    gv = stp.groupby("proveedor").agg(venta=("venta", "sum"), costo=("costo_sin_igv", "sum"))
    c3 = stp[(stp["tienda"] == "01") & stp["mes"].isin(ult3)].groupby("proveedor")["costo_sin_igv"].sum().rename("c3")
    g = gi.join(gv, how="outer").join(c3, how="left").fillna(0).reset_index()
    g["costo_dia"] = g["c3"] / dias if dias else 0
    g["dias"] = np.where(g["costo_dia"] > 0, g["inventario"] / g["costo_dia"].where(g["costo_dia"] > 0, 1), np.nan)
    g["margen"] = np.where(g["venta"] != 0, (g["venta"] - g["costo"] * IGV) / g["venta"].where(g["venta"] != 0, 1), np.nan)
    return g.sort_values(["inventario", "venta"], ascending=False)[["proveedor", "inventario", "m3", "costo_dia", "dias", "venta", "margen"]].reset_index(drop=True)


def calc_pl_sku(base: pd.DataFrame, sku_venta: pd.DataFrame, inv: pd.DataFrame, pl_prov: pd.DataFrame) -> pd.DataFrame:
    sv = sku_venta.assign(sku=sku_venta["sku"].str.strip()).drop_duplicates("sku", keep="last").set_index("sku")
    prov = dict(zip(inv["sku"], inv["proveedor"]))
    mprov = dict(zip(pl_prov["proveedor"], pl_prov["margen"]))
    d = base[base["stock"] > 0][["sku", "producto", "stock", "valor"]].copy()
    d["proveedor"] = d["sku"].map(prov).fillna("")
    d["venta"] = d["sku"].map(sv["venta"]).fillna(0)
    costo = d["sku"].map(sv["costo_sin_igv"]).fillna(0)
    d["ult_venta"] = d["sku"].map(sv["ult_venta"]).fillna("")
    own = np.where(d["venta"] > 0, (d["venta"] - costo * IGV) / d["venta"].where(d["venta"] > 0, 1), np.nan)
    mp = d["proveedor"].map(mprov)
    d["margen"] = np.where(~np.isnan(own), own, mp)
    d["fuente"] = np.where(~np.isnan(own), "propio", np.where(mp.notna(), "proveedor", "ninguno"))
    d["costo_u"] = np.where((d["stock"] > 0) & (d["valor"] > 0), d["valor"] / d["stock"].where(d["stock"] > 0, 1), np.nan)
    return d.sort_values(["venta", "valor"], ascending=False).reset_index(drop=True)


def calc_pl_kpi(base: pd.DataFrame, pl_obs: pd.DataFrame, stp: pd.DataFrame, alm_tot: dict) -> dict:
    inv = base["valor"].clip(lower=0).sum()
    den = base[(base["valor"] > 0) & (base["m3"] > 0)]
    vm3 = den["valor"].sum() / (den["m3"].sum() or 1)
    ob = pl_obs["valor"].sum()
    t1 = stp[stp["tienda"] == "01"]
    ult3 = sorted(t1["mes"].unique())[-3:]
    dias = sum(dias_mes(m) for m in ult3)
    r3 = t1[t1["mes"].isin(ult3)]
    c3, v3 = r3["costo_sin_igv"].sum(), r3["venta"].sum()
    cd = c3 / dias if dias else 0
    return {"inventario": inv, "obsoleto": ob, "obs_pct": ob / inv if inv else None, "obs_n": len(pl_obs), "util": inv - ob,
            "dio": inv / cd if cd else None, "costo_dia": cd, "valor_m3": vm3, "m3_libre": alm_tot.get("libre"),
            "margen_alfa": (v3 - c3 * IGV) / v3 if v3 else None, "venta_mes_alfa": v3 / len(ult3) if ult3 else None, "ult3": ult3}


# ----------------------------------------------------------------------------
# ABC-XYZ por empresa (archivo dashboard_abcxyz.csv)
# ----------------------------------------------------------------------------
def calc_abc_seg(abc: pd.DataFrame, inv: pd.DataFrame) -> pd.DataFrame:
    i = inv[(inv["masterpack"] > 0) & (inv["m3_masterpack"] > 0)]
    mp = {s.strip(): (a, b) for s, a, b in zip(i["sku"], i["masterpack"], i["m3_masterpack"])}
    d = abc[abc["stock"] > 0].copy()
    d["sku"] = d["producto_id"].str.strip()

    def medidas(s):
        m = mp.get(s)
        if m is None and re.match(r"^T\d", s, re.I):
            m = mp.get(s[1:])
        return m

    m = d["sku"].map(medidas)
    d["cajas"] = [math.ceil(st / x[0]) if x else 0 for st, x in zip(d["stock"], m)]
    d["m3"] = [c * x[1] if x else 0.0 for c, x in zip(d["cajas"], m)]
    d["medidas"] = [1 if x else 0 for x in m]
    d["empresa"] = d["empresa"].replace("", "ALFA").str.upper()
    d["segmento"] = d["segmento"].replace("", "SC")
    d["valor"] = d["valor"].fillna(0)
    return d[["empresa", "sku", "producto", "categoria", "segmento", "stock", "valor", "cajas", "m3", "medidas"]].reset_index(drop=True)


def calc_matriz_abc(abc_seg: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    al, to = abc_seg[abc_seg["empresa"] == "ALFA"], abc_seg[abc_seg["empresa"] == "TORU"]
    ka = dict(zip(al["sku"], zip(al["stock"], al["valor"])))
    copia = len(to) > 0 and len(to) == len(al) and all(ka.get(s) == (st, v) for s, st, v in zip(to["sku"], to["stock"], to["valor"]))
    out = []
    for emp, rows0 in (("ALFA", al), ("TORU", to), ("all", abc_seg)):
        tv, tm = rows0["valor"].sum(), rows0["m3"].sum()
        cells = []
        for c in SEGMENTOS:
            r = rows0[rows0["segmento"] == c]
            cells.append({"emp": emp, "clase": c, "productos": len(r), "valor": r["valor"].sum(), "m3": r["m3"].sum(),
                          "cajas": int(r["cajas"].sum()), "sin_medidas": int((r["medidas"] == 0).sum())})
        pv = fix_pct([x["valor"] / tv for x in cells]) if tv else [0] * len(cells)
        pm = fix_pct([x["m3"] / tm for x in cells]) if tm else [0] * len(cells)
        for x, a, b in zip(cells, pv, pm):
            x["pct_valor"], x["pct_m3"] = a, b
        out += cells
        out.append({"emp": emp, "clase": "TOTAL", "productos": len(rows0), "valor": tv, "m3": tm, "cajas": int(rows0["cajas"].sum()),
                    "sin_medidas": int((rows0["medidas"] == 0).sum()), "pct_valor": 1 if len(rows0) else 0, "pct_m3": 1 if tm else 0})
    return pd.DataFrame(out), copia


# ----------------------------------------------------------------------------
# Simulador y planificador
# ----------------------------------------------------------------------------
def simular_descuento(margen: float | None, descuento: float, costo_u: float | None = None, stock: float = 0, con_venta: bool = True) -> dict:
    """Venta extra necesaria = descuento ÷ (margen − descuento). Si se da costo_u, calcula la liquidación del stock."""
    r: dict = {"margen": margen, "descuento": descuento}
    if margen is None:
        r["estado"], r["mensaje"] = "sin_margen", "Sin datos de margen: ingresa el margen a mano para simular."
        return r
    r["margen_con_desc"] = (margen - descuento) / (1 - descuento) if descuento < 1 else None
    if not con_venta:
        r["estado"], r["mensaje"] = "sin_ventas", "Este producto no se vendió en el periodo, así que no hay venta actual con qué comparar. Mira cuánto recuperas o pierdes si liquidas el stock con este descuento."
    elif descuento == 0:
        r["estado"], r["incremento"], r["mensaje"] = "ok", 0.0, "Sin descuento no hace falta vender más."
    elif margen <= 0:
        r["estado"], r["mensaje"] = "no_aplica", "Ya se vende sin margen: cualquier descuento aumenta la pérdida. Conviene negociar con el proveedor (cambio, devolución o descuento)."
    elif descuento >= margen:
        r["estado"], r["mensaje"] = "imposible", "El descuento es igual o mayor que el margen: se pierde en cada venta y ningún volumen lo compensa. Negocia con el proveedor (cambio, devolución o que asuma parte del descuento)."
    else:
        inc = descuento / (margen - descuento)
        r["incremento"] = inc
        r["estado"] = "dificil" if inc > 0.5 else "exigente" if inc > 0.2 else "ok"
        r["mensaje"] = f"Para ganar lo mismo, las unidades vendidas deben subir {inc:.0%}. " + (
            "Es difícil de lograr: evalúa negociar con el proveedor antes de rematar." if inc > 0.5 else
            "Es exigente: úsalo si el objetivo es liberar stock o espacio." if inc > 0.2 else
            "Es alcanzable con una buena activación.")
    if costo_u and margen < 1:
        cc = costo_u * IGV
        pr = cc / (1 - margen)
        pd_ = pr * (1 - descuento)
        r["liquidacion"] = {"costo_u_igv": cc, "precio": pr, "precio_desc": pd_, "resultado": (pd_ - cc) * stock,
                            "desc_max": max(0.0, margen)}
    return r


def planificar_compra(k: dict, obs_m3: float, meta_venta_mes: float, meses: int, margen: float, dias_cierre: float) -> dict:
    costo = meta_venta_mes * meses * (1 - margen) / IGV
    cdia = costo / (meses * 30)
    cierre = cdia * dias_cierre
    comp = max(0.0, costo + cierre - k["util"])
    m3c = comp / k["valor_m3"] if k["valor_m3"] else 0
    lib = k["m3_libre"] or 0
    return {"costo_venta": costo, "stock_cierre": cierre, "inventario_util": k["util"], "compra": comp,
            "m3_compra": m3c, "m3_libre": lib, "alcanza": m3c <= lib, "obsoleto_m3": obs_m3}


# ----------------------------------------------------------------------------
# Todo junto
# ----------------------------------------------------------------------------
def calcular_todo(ds: dict[str, pd.DataFrame]) -> dict:
    base = calc_base(ds["inventario"])
    so_base = calc_so_base(ds["sellout_proveedor"])
    alm = calc_almacenes(ds["almacenes"])
    alm_tot = calc_alm_tot(ds["almacenes"])
    pl_obs = calc_pl_obs(base, ds["inventario"], ds["sku_venta"])
    pl_prov = calc_pl_prov(base, ds["inventario"], ds["sellout_tienda_prov"])
    pl_sku = calc_pl_sku(base, ds["sku_venta"], ds["inventario"], pl_prov)
    abc_seg = calc_abc_seg(ds["abc_xyz"], ds["inventario"])
    matriz_abc, copia = calc_matriz_abc(abc_seg)
    return {
        "base": base, "kpis_inv": calc_kpis_inv(base), "matriz_cl": calc_matriz_cl(base), "cat_top": calc_cat_top(base),
        "so_base": so_base, "meses": meses_sellout(ds["sellout_mes"]),
        "almacenes": alm, "alm_tot": alm_tot,
        "pl_obs": pl_obs, "pl_obs_res": calc_pl_obs_res(pl_obs), "pl_prov": pl_prov, "pl_sku": pl_sku,
        "pl_kpi": calc_pl_kpi(base, pl_obs, ds["sellout_tienda_prov"], alm_tot),
        "abc_seg": abc_seg, "matriz_abc": matriz_abc, "abc_copia": copia,
    }
