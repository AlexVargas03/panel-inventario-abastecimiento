"""Panel de Inventario y Abastecimiento — versión Streamlit.

Ejecutar en local:   streamlit run app.py
Streamlit Cloud:     subir esta carpeta a un repositorio de GitHub (privado) y elegir app.py.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

import agent
import calc

st.set_page_config(page_title="Panel de Inventario y Abastecimiento", page_icon="📦", layout="wide")

COL_A, COL_B, COL_C, COL_T = "#2E6FD8", "#E8A33D", "#8A8F98", "#1B9E77"
MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def secreto(nombre: str, defecto=None):
    try:
        if nombre in st.secrets:
            return st.secrets[nombre]
    except Exception:
        pass
    return os.environ.get(nombre, defecto)


# ----------------------------------------------------------------------------
# Acceso (opcional): define APP_PASSWORD en los secrets para pedir contraseña
# ----------------------------------------------------------------------------
clave_app = secreto("APP_PASSWORD")
if clave_app and not st.session_state.get("acceso_ok"):
    st.title("📦 Panel de Inventario y Abastecimiento")
    pw = st.text_input("Contraseña", type="password")
    if pw:
        if pw == clave_app:
            st.session_state["acceso_ok"] = True
            st.rerun()
        st.error("Contraseña incorrecta.")
    st.stop()


# ----------------------------------------------------------------------------
# Formato
# ----------------------------------------------------------------------------
def money(v, dec=0):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"S/ {v:,.{dec}f}"


def moneyk(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"S/ {v / 1e6:,.2f} M" if abs(v) >= 1e6 else f"S/ {v / 1e3:,.0f} mil" if abs(v) >= 1e3 else f"S/ {v:,.0f}"


def pct(v, dec=1):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"{v:.{dec}%}"


def num(v, dec=0):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "—"
    return f"{v:,.{dec}f}"


def mes_txt(m: str) -> str:
    return f"{MES[int(m[5:7]) - 1]} {m[:4]}"


# ----------------------------------------------------------------------------
# Datos: archivos incluidos en /data, reemplazables desde la barra lateral
# ----------------------------------------------------------------------------
@st.cache_data(show_spinner="Cargando archivos…")
def datos_por_defecto():
    return calc.cargar_por_defecto()


@st.cache_data(show_spinner="Calculando indicadores…")
def calcular(ds: dict):
    return calc.calcular_todo(ds)


ETIQUETAS = {
    "inventario": "Inventario ALFA (inventario.csv)",
    "abc_xyz": "ABC-XYZ (dashboard_abcxyz.csv)",
    "almacenes": "Almacenes (dashboard_inventarios.xlsx o almacenes.json)",
    "sellout_mes": "Sell out por mes (sellout_mes.csv)",
    "sellout_proveedor": "Sell out por proveedor (sellout_proveedor.csv)",
    "sellout_tienda_prov": "Sell out por tienda y proveedor (sellout_tienda_prov.csv)",
    "sku_venta": "Venta por SKU (sku_venta.csv)",
}

ds = dict(datos_por_defecto())
subidos = st.session_state.setdefault("subidos", {})

with st.sidebar:
    st.header("📁 Archivos")
    st.caption("La app usa los archivos de la carpeta data/. Puedes reemplazar cualquiera por uno nuevo (CSV o Excel) solo para esta sesión; para dejarlo fijo, reemplázalo en data/ del repositorio.")
    exp = st.expander("Reemplazar archivos", expanded=False)
    for clave, etiqueta in ETIQUETAS.items():
        tipos = ["xlsx", "csv", "json"] if clave == "almacenes" else ["csv", "xlsx"]
        f = exp.file_uploader(etiqueta, type=tipos, key="up_" + clave)
        if f is not None:
            try:
                subidos[clave] = calc.leer_subido(clave, f)
            except Exception as e:
                st.error(f"No pude leer {f.name}: {e}")
        else:
            subidos.pop(clave, None)
    if subidos:
        st.success("Usando archivo nuevo en: " + ", ".join(subidos))
    st.caption("Filas cargadas: " + " · ".join(f"{c} {len(subidos.get(c, ds[c])):,}" for c in ETIQUETAS))

ds.update(subidos)
try:
    R = calcular(ds)
except Exception as e:
    st.error(f"Los archivos no tienen el formato esperado: {e}")
    st.stop()

# ----------------------------------------------------------------------------
st.title("📦 Panel de Inventario y Abastecimiento")
st.caption(f"ALFA y TORU · sell out {mes_txt(R['meses'][0])} – {mes_txt(R['meses'][-1])} · montos en soles")

tab_pn, tab_po, tab_alm, tab_pl, tab_ia = st.tabs(
    ["Panel de control", "Política por segmento", "Capacidad de almacén", "Planificación", "🤖 Asistente IA"])


# ============================================================================
# Capacidad de almacén (se usa en dos pestañas)
# ============================================================================
def bloque_almacenes(clave: str):
    a, alm = R["alm_tot"], R["almacenes"]
    c = st.columns(4)
    c[0].metric("Capacidad total", f"{num(a['capacidad'], 1)} m³")
    c[1].metric("Usado total", f"{num(a['usado'], 1)} m³")
    c[2].metric("Libre total", f"{num(a['libre'], 1)} m³")
    c[3].metric("% de uso global", pct(a["pct"]))
    fig = go.Figure()
    fig.add_bar(y=alm["almacen"], x=alm["usado_alfa"], name="ALFA", orientation="h", marker_color=COL_A)
    fig.add_bar(y=alm["almacen"], x=alm["usado_toru"], name="TORU", orientation="h", marker_color=COL_B)
    fig.add_bar(y=alm["almacen"], x=alm["libre"].clip(lower=0), name="Libre", orientation="h", marker_color="#D9DDE3")
    for _, r in alm.iterrows():
        fig.add_annotation(y=r["almacen"], x=r["capacidad"], text=f" {r['pct']:.0%}" + (" ⚠" if r["pct"] >= 0.85 else ""),
                           showarrow=False, xanchor="left", font=dict(color="#C0392B" if r["pct"] >= 0.85 else "#333"))
    fig.update_layout(barmode="stack", height=260, margin=dict(l=0, r=40, t=10, b=0), xaxis_title="m³",
                      legend=dict(orientation="h", y=-0.25), yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, width="stretch", key="alm_" + clave)
    t = alm[["almacen", "capacidad", "usado_alfa", "usado_toru", "libre", "pct", "vitrina"]].copy()
    st.dataframe(t, hide_index=True, width="stretch", column_config={
        "almacen": "Almacén", "capacidad": st.column_config.NumberColumn("Capacidad m³", format="%.2f"),
        "usado_alfa": st.column_config.NumberColumn("ALFA m³", format="%.2f"),
        "usado_toru": st.column_config.NumberColumn("TORU m³", format="%.2f"),
        "libre": st.column_config.NumberColumn("Libre m³", format="%.2f"),
        "pct": st.column_config.ProgressColumn("% uso", min_value=0, max_value=1, format="percent"),
        "vitrina": st.column_config.NumberColumn("Vitrina/cuarentena m³", format="%.2f")}, key="almt_" + clave)
    st.caption("Menos de 85 % de uso: bien · 85 % o más: por llenarse (⚠).")


# ============================================================================
# Panel de control
# ============================================================================
with tab_pn:
    k = R["kpis_inv"]
    mcl = R["matriz_cl"].set_index("clase")
    c = st.columns(3) + st.columns(3)
    c[0].metric("Valor del stock", moneyk(k["valor"]), help="Stock Valorizado total", border=True)
    c[1].metric("Espacio ocupado", f"{num(k['m3'], 1)} m³", help="cajas × m³ por MasterPack", border=True)
    c[2].metric("Productos con stock", num(k["productos"]), help="con stock mayor a cero", border=True)
    c[3].metric("Cajas en almacén", num(k["cajas"]), help="stock ÷ MasterPack", border=True)
    c[4].metric("Candidatos a descontinuar (CZ)", moneyk(k["cz_valor"]), help=f"{pct(mcl.loc['CZ', 'pct_valor'])} del valor del stock", border=True)
    c[5].metric("Descontinuados con stock", num(k["desc_n"]), help="siguen con stock en almacén", border=True)

    # ---- Sell out --------------------------------------------------------
    st.subheader("Sell out")
    meses = R["meses"]
    so_base = R["so_base"]
    f1, f2 = st.columns([2, 2])
    rango = f1.select_slider("Periodo", options=meses, value=(meses[0], meses[-1]), format_func=mes_txt)
    sel = meses[meses.index(rango[0]): meses.index(rango[1]) + 1]
    provs = so_base.groupby(["id", "proveedor"], as_index=False)["venta"].sum().sort_values("venta", ascending=False)
    opciones = ["Todos"] + provs["id"].tolist()
    nombres = dict(zip(provs["id"], provs["proveedor"]))
    pid = f2.selectbox("Proveedor", opciones, format_func=lambda x: "Todos los proveedores" if x == "Todos" else nombres.get(x, x))
    pid = None if pid == "Todos" else pid
    kp = calc.calc_so_kpi(ds["sellout_mes"], so_base, sel, pid)
    vs = f"vs. {mes_txt(kp['prev'][0])}" + (f" – {mes_txt(kp['prev'][-1])}" if kp["prev"] and len(kp["prev"]) > 1 else "") if kp["prev"] else None
    d = lambda v, pts=False: None if v is None else (f"{v * 100:+.1f} pts" if pts else f"{v:+.1%}")
    c = st.columns(4)
    c[0].metric("Venta (con IGV)", moneyk(kp["venta"]), d(kp["d_venta"]), help=f"Promedio {moneyk(kp['prom_venta'])} por mes")
    c[1].metric("Margen bruto", pct(kp["margen_pct"]), d(kp["d_margen"], True), help=f"{money(kp['margen'])} de margen (venta − costo con IGV)")
    c[2].metric("Unidades", num(kp["unidades"]), d(kp["d_unidades"]), help=f"Promedio {num(kp['prom_unidades'])} por mes")
    c[3].metric("Ticket promedio", money(kp["ticket_prom"], 2), d(kp["d_ticket"]), help=f"{num(kp['tickets'])} boletas y facturas")
    st.caption((vs + " · " if vs else "Sin periodo anterior comparable · ") + "incluye intercompañía")

    sm = calc.calc_so_mes(so_base, pid)
    sm["sel"] = sm["mes"].isin(sel)
    vista = st.radio("Ver", ["Venta S/", "Margen %"], horizontal=True, label_visibility="collapsed")
    if vista == "Venta S/":
        fig = go.Figure(go.Bar(x=[mes_txt(m) for m in sm["mes"]], y=sm["venta"], marker_color=[COL_A if s else "#C9D3E3" for s in sm["sel"]],
                               text=[moneyk(v) for v in sm["venta"]], textposition="outside"))
        fig.update_layout(yaxis_title="Venta S/ (con IGV)")
    else:
        fig = go.Figure(go.Scatter(x=[mes_txt(m) for m in sm["mes"]], y=sm["margen_pct"], mode="lines+markers+text",
                                   text=[pct(v) for v in sm["margen_pct"]], textposition="top center", line_color=COL_T))
        fig.update_layout(yaxis_tickformat=".0%", yaxis_title="Margen bruto %")
    fig.update_layout(height=320, margin=dict(l=0, r=0, t=20, b=0))
    st.plotly_chart(fig, width="stretch")

    # ---- Venta y margen por proveedor ------------------------------------
    st.subheader("Venta y margen por proveedor")
    top = st.selectbox("Mostrar", [10, 20, 50, 0], format_func=lambda n: "Todos" if n == 0 else f"Top {n}")
    sp = calc.calc_so_prov(so_base, sel)
    tv, tc = sp["venta"].sum(), sp["costo"].sum()
    filas = sp if top == 0 else sp.head(top)
    extra = []
    if top and len(sp) > top:
        r = sp.iloc[top:]
        v, co = r["venta"].sum(), r["costo"].sum()
        extra.append({"rank": None, "proveedor": f"Otros ({len(r)} proveedores)", "venta": v, "part": v / tv if tv else None, "margen_pct": (v - co) / v if v else None, "margen": v - co})
    extra.append({"rank": None, "proveedor": "Total", "venta": tv, "part": 1.0, "margen_pct": (tv - tc) / tv if tv else None, "margen": tv - tc})
    tabla = pd.concat([filas[["rank", "proveedor", "venta", "part", "margen_pct", "margen"]], pd.DataFrame(extra)], ignore_index=True)
    tabla_v = pd.DataFrame({
        "#": tabla["rank"].map(lambda v: "" if pd.isna(v) else str(int(v))),
        "Proveedor": tabla["proveedor"],
        "Venta (S/)": tabla["venta"].map(lambda v: f"{v:,.0f}"),
        "Part.": tabla["part"].map(lambda v: pct(v)),
        "Margen %": tabla["margen_pct"].map(lambda v: ("🔴 " if v is not None and not pd.isna(v) and v < 0 else "") + pct(v)),
        "Margen (S/)": tabla["margen"].map(lambda v: f"{v:,.0f}"),
    })
    st.dataframe(tabla_v, hide_index=True, width="stretch", height=min(36 * (len(tabla_v) + 1) + 4, 600))
    st.caption("Margen = venta − costo con IGV (costo sin IGV × 1.18).")

    # ---- Matriz ABC-XYZ --------------------------------------------------
    st.subheader("Inventario por segmento ABC-XYZ")
    emp = st.radio("Empresa", ["ALFA", "TORU", "all"], horizontal=True, format_func=lambda e: "ALFA + TORU" if e == "all" else e)
    mx = R["matriz_abc"][R["matriz_abc"]["emp"] == emp].set_index("clase")
    metrica = st.radio("Color por", ["% del valor", "% del espacio"], horizontal=True)
    col = "pct_valor" if metrica == "% del valor" else "pct_m3"
    z = [[mx.loc[a + x, col] for x in "XYZ"] for a in "ABC"]
    txt = [[f"<b>{moneyk(mx.loc[a + x, 'valor'])}</b><br>{num(mx.loc[a + x, 'productos'])} prod.<br>valor {pct(mx.loc[a + x, 'pct_valor'])} · espacio {pct(mx.loc[a + x, 'pct_m3'])}"
            + ("<br>⚠ revisar" if mx.loc[a + x, "pct_m3"] > mx.loc[a + x, "pct_valor"] else "") for x in "XYZ"] for a in "ABC"]
    fig = go.Figure(go.Heatmap(z=z, x=["X · estable", "Y · variable", "Z · errática"], y=["A · venta alta", "B · venta media", "C · venta baja"],
                               text=txt, texttemplate="%{text}", colorscale="Blues", showscale=False, hoverinfo="skip"))
    fig.update_layout(height=380, margin=dict(l=0, r=0, t=10, b=0), yaxis=dict(autorange="reversed"))
    st.plotly_chart(fig, width="stretch")
    t = mx.loc["TOTAL"]
    st.caption(f"Total: {money(t['valor'])} · {num(t['productos'])} productos con stock. ⚠ revisar = ocupa más espacio del que vale. "
               f"{num(t['sin_medidas'])} productos no tienen medidas de MasterPack y cuentan con 0 m³."
               + (" TORU trae los mismos productos, stock y valor que ALFA." if R["abc_copia"] else ""))
    seg = st.selectbox("Detalle de un segmento", ["—"] + calc.SEGMENTOS)
    if seg != "—":
        det = R["abc_seg"][(R["abc_seg"]["segmento"] == seg) & ((R["abc_seg"]["empresa"] == emp) | (emp == "all"))].sort_values("valor", ascending=False)
        st.dataframe(det[["empresa", "sku", "producto", "categoria", "stock", "valor", "m3"]], hide_index=True, width="stretch",
                     column_config={"valor": st.column_config.NumberColumn("Valor", format="localized"), "m3": st.column_config.NumberColumn("m³", format="%.3f")})

    # ---- Categorías ------------------------------------------------------
    st.subheader("Categorías por valor y espacio")
    ct = R["cat_top"]
    fig = go.Figure()
    fig.add_bar(y=ct["categoria"], x=ct["valor"], orientation="h", marker_color=COL_A, text=[moneyk(v) for v in ct["valor"]], textposition="auto",
                customdata=ct["m3"], hovertemplate="%{y}<br>Valor S/ %{x:,.0f}<br>%{customdata:.1f} m³<extra></extra>")
    fig.update_layout(height=320, margin=dict(l=0, r=0, t=10, b=0), yaxis=dict(autorange="reversed"), xaxis_title="Valor del stock S/")
    st.plotly_chart(fig, width="stretch")

    st.subheader("Capacidad de almacén")
    bloque_almacenes("pn")


# ============================================================================
# Política por segmento
# ============================================================================
POLITICA = {
    "AX": ("Mucha venta · demanda estable", "Prioridad máxima: mucha venta y fáciles de planificar. Asegurar abastecimiento y no dejar que falten."),
    "AY": ("Mucha venta · demanda variable", "Mucha venta con altibajos: mantener stock de seguridad y revisar el patrón."),
    "AZ": ("Mucha venta · demanda errática", "Mucha venta pero impredecible: seguimiento cercano y pedidos más frecuentes en lotes chicos."),
    "BX": ("Venta media · demanda estable", "Reposición simple y automática."),
    "BY": ("Venta media · demanda variable", "Revisar con regularidad y ajustar el stock a la estacionalidad."),
    "BZ": ("Venta media · demanda errática", "Stock ajustado y compra bajo pedido cuando se pueda."),
    "CX": ("Poca venta · demanda estable", "Mantener simple y sin exceso de stock."),
    "CY": ("Poca venta · demanda variable", "Comprar bajo pedido si se puede y vigilar el stock."),
    "CZ": ("Poca venta · demanda errática", "Candidatos a descontinuar: poca venta e impredecibles. Liquidar el stock y no reponer."),
    "SC": ("Sin clase en el archivo", "Pendiente de clasificar: el archivo no permite decidir. Revisar si son nuevos o sin movimiento."),
    "TOTAL": ("", ""),
}
with tab_po:
    st.markdown("Cada producto cae en un segmento de dos letras. El segmento define la política de inventario: los **AX** son prioridad máxima y los **CZ** son candidatos a descontinuar.")
    a, b = st.columns(2)
    a.info("**ABC, importancia económica.** Según la venta acumulada (regla de Pareto). A concentra hasta el 80 % de la venta, B del 80 % al 95 % y C el 5 % restante.")
    b.info("**XYZ, predictibilidad de la demanda.** Según la variabilidad mes a mes. X es estable y predecible, Y es variable o estacional con un patrón reconocible, y Z es errática o con poca historia.")
    m = R["matriz_cl"].copy()
    m["significado"] = m["clase"].map(lambda c: POLITICA[c][0])
    m["politica"] = m["clase"].map(lambda c: POLITICA[c][1])
    m["clase"] = m["clase"].replace({"SC": "Sin clase", "TOTAL": "Total"})
    st.dataframe(m[["clase", "significado", "politica", "productos", "valor", "pct_valor", "m3", "pct_m3", "cajas"]], hide_index=True, width="stretch",
                 height=460, column_config={
                     "clase": "Segmento", "significado": "Significado", "politica": st.column_config.TextColumn("Política", width="large"),
                     "productos": "Productos", "valor": st.column_config.NumberColumn("Valor del stock", format="localized"),
                     "pct_valor": st.column_config.NumberColumn("% del valor", format="percent"),
                     "m3": st.column_config.NumberColumn("Espacio m³", format="%.1f"),
                     "pct_m3": st.column_config.NumberColumn("% del espacio", format="percent"), "cajas": "Cajas"})
    st.caption("La clase es la de la columna XYZABC del inventario. El valor y el espacio se calculan con Stock Valorizado y m³ (cajas × m³ por MasterPack).")


# ============================================================================
# Capacidad de almacén
# ============================================================================
with tab_alm:
    bloque_almacenes("alm")
    alm = R["almacenes"]
    st.dataframe(alm[["almacen", "uni_alfa", "uni_toru", "monto_alfa", "monto_toru"]], hide_index=True, width="stretch", column_config={
        "almacen": "Almacén", "uni_alfa": st.column_config.NumberColumn("Unidades ALFA", format="localized"),
        "uni_toru": st.column_config.NumberColumn("Unidades TORU", format="localized"),
        "monto_alfa": st.column_config.NumberColumn("Monto ALFA S/", format="localized"),
        "monto_toru": st.column_config.NumberColumn("Monto TORU S/", format="localized")})
    st.caption("Fuente: Excel dashboard_inventarios (hoja Inventarios). Capacidad, uso y libre en m³.")


# ============================================================================
# Planificación
# ============================================================================
with tab_pl:
    pk, ores = R["pl_kpi"], R["pl_obs_res"]
    c = st.columns(4)
    c[0].metric("Inventario ALFA", moneyk(pk["inventario"]), help="valor del stock (a costo)")
    c[1].metric("Obsoleto", moneyk(pk["obsoleto"]), help=f"{pct(pk['obs_pct'])} del inventario · {num(pk['obs_n'])} productos")
    c[2].metric("Días de inventario", f"{num(pk['dio'])} días", help="inventario ÷ costo de venta diario de ALFA (últimos 3 meses)")
    c[3].metric("Espacio libre", f"{num(pk['m3_libre'], 1)} m³", help=f"1 m³ ≈ {moneyk(pk['valor_m3'])} de inventario")
    st.caption(f"Obsoleto: {pct(pk['obs_pct'])} del inventario · {num(pk['obs_n'])} productos · 1 m³ ≈ {moneyk(pk['valor_m3'])} de inventario · días de inventario = inventario ÷ costo de venta diario de ALFA (últimos 3 meses)")

    # ---- Obsoleto --------------------------------------------------------
    st.subheader("Inventario obsoleto")
    st.caption("descontinuado · clase CZ · sin venta en 180 días")
    crits = {"all": "Todos", "desc": "Descontinuado", "cz": "CZ", "sinventa": "Sin venta 180 d"}
    crit = st.radio("Criterio", list(crits), horizontal=True, format_func=lambda x: f"{crits[x]} · {moneyk(ores[x]['valor'])}")
    q = st.text_input("Buscar por SKU, producto o proveedor", key="obs_q")
    ob = R["pl_obs"]
    if crit != "all":
        ob = ob[ob[crit] == 1]
    if q:
        ql = q.strip().lower()
        ob = ob[(ob["sku"] + " " + ob["producto"] + " " + ob["proveedor"]).str.lower().str.contains(ql, regex=False)]
    st.dataframe(ob[["sku", "producto", "proveedor", "valor", "m3", "ult_venta", "criterio"]].replace({"ult_venta": {"": "Sin venta"}}),
                 hide_index=True, width="stretch", height=360, column_config={
                     "sku": "SKU", "producto": "Producto", "proveedor": "Proveedor",
                     "valor": st.column_config.NumberColumn("Valor", format="localized"),
                     "m3": st.column_config.NumberColumn("m³", format="%.2f"), "ult_venta": "Última venta", "criterio": "Criterio"})
    a, b = st.columns([3, 1])
    a.caption(f"{num(len(ob))} productos · {money(ob['valor'].sum())}. Un producto puede cumplir más de un criterio. \"Sin venta\" se mide hasta el último día del sell out.")
    b.download_button("Descargar CSV", ob.to_csv(index=False).encode("utf-8-sig"), file_name=f"inventario_obsoleto_{crit}.csv", mime="text/csv")

    # ---- Días de inventario por proveedor --------------------------------
    st.subheader("Días de inventario por proveedor")
    st.caption("ALFA · inventario ÷ costo de venta diario (últimos 3 meses) · hasta 60 días bien · 61 a 120 atención · más de 120 o sin venta alto")
    todos = st.toggle("Ver todos los proveedores", value=False)
    pp = R["pl_prov"][R["pl_prov"]["inventario"] > 0]
    pp = pp if todos else pp.head(15)
    pp = pp.assign(estado=np.where(pp["dias"].isna() | (pp["dias"] > 120), "🔴", np.where(pp["dias"] > 60, "🟠", "🟢")))
    st.dataframe(pp[["estado", "proveedor", "inventario", "m3", "costo_dia", "dias"]], hide_index=True, width="stretch", column_config={
        "estado": "", "proveedor": "Proveedor", "inventario": st.column_config.NumberColumn("Inventario S/", format="localized"),
        "m3": st.column_config.NumberColumn("m³", format="%.1f"), "costo_dia": st.column_config.NumberColumn("Costo venta/día", format="localized"),
        "dias": st.column_config.ProgressColumn("Días de inventario", min_value=0, max_value=365, format="%.0f d")})

    s1, s2 = st.columns(2)
    # ---- Simulador de descuento ------------------------------------------
    with s1:
        st.subheader("Simulador de descuento")
        st.caption("¿cuánto más hay que vender para ganar lo mismo?")
        modo = st.radio("Simular", ["Proveedor", "Producto"], horizontal=True)
        if modo == "Proveedor":
            src = R["pl_prov"][(R["pl_prov"]["venta"] > 0) & R["pl_prov"]["margen"].notna()].sort_values("venta", ascending=False)
            elegido = st.selectbox("Proveedor", src["proveedor"].tolist(), index=None, placeholder="Buscar proveedor…")
            fila = src[src["proveedor"] == elegido].iloc[0] if elegido else None
            m0 = fila["margen"] if fila is not None else None
            fuente, costo_u, stock, con_venta = "propio", None, 0, True
        else:
            src = R["pl_sku"]
            elegido = st.selectbox("Producto", src["sku"].tolist(), index=None, placeholder="Buscar producto o SKU…",
                                   format_func=lambda s: f"{s} · {src.loc[src['sku'] == s, 'producto'].iloc[0]}")
            fila = src[src["sku"] == elegido].iloc[0] if elegido else None
            m0 = None if fila is None or pd.isna(fila["margen"]) else fila["margen"]
            fuente = fila["fuente"] if fila is not None else "ninguno"
            costo_u = None if fila is None or pd.isna(fila["costo_u"]) else fila["costo_u"]
            stock = fila["stock"] if fila is not None else 0
            con_venta = fuente == "propio"
        dv = st.slider("Descuento %", 0, 40, 10) / 100
        mg_in = st.number_input("Margen usado %", min_value=-100.0, max_value=95.0, step=0.1,
                                value=None if m0 is None else round(float(m0) * 100, 1), key=f"mg_{modo}_{elegido}")
        if fila is None:
            st.info("Elige un proveedor o producto.")
        else:
            mg = None if mg_in is None else mg_in / 100
            r = calc.simular_descuento(mg, dv, costo_u, stock, con_venta)
            st.write(f"**Margen {'estimado (del proveedor)' if fuente == 'proveedor' else 'actual'}:** {pct(mg)} · **con {dv:.0%} de descuento:** {pct(r.get('margen_con_desc'))}")
            grande = {"sin_margen": "—", "sin_ventas": "Sin ventas", "no_aplica": "No aplica", "imposible": "Imposible"}.get(r["estado"])
            st.metric("Venta extra necesaria (en unidades)", grande or f"+{r['incremento']:.0%}")
            (st.error if r["estado"] in ("no_aplica", "imposible", "dificil") else st.warning if r["estado"] in ("exigente", "sin_ventas") else st.success)(r["mensaje"])
            if "liquidacion" in r and modo == "Producto":
                lq = r["liquidacion"]
                st.markdown(f"**Si liquidas todo el stock con {dv:.0%} de descuento**  \n"
                            f"Stock: {num(stock)} u · {money(fila['valor'])} a costo  \n"
                            f"Costo unitario (con IGV): S/ {lq['costo_u_igv']:,.2f} · Precio {'actual' if fuente == 'propio' else 'estimado'}: S/ {lq['precio']:,.2f} · Con descuento: S/ {lq['precio_desc']:,.2f}  \n"
                            f"**{'Ganancia' if lq['resultado'] >= 0 else 'Pérdida'} total: {money(abs(lq['resultado']))}**  \n"
                            f"Descuento máximo sin perder: {pct(lq['desc_max'])}")
        st.caption("Venta extra necesaria = descuento ÷ (margen − descuento). El margen es el real del sell out (venta − costo con IGV); si el producto no tuvo venta se usa el de su proveedor.")

    # ---- Planificador de compra ------------------------------------------
    with s2:
        st.subheader("Planificador de compra y espacio")
        meta = st.number_input("Meta de venta mensual (S/ con IGV)", min_value=0, step=10000,
                               value=int(round((pk["venta_mes_alfa"] or 0) / 10000) * 10000))
        a, b = st.columns(2)
        nmes = a.number_input("Meses a cubrir", min_value=1, max_value=12, value=1)
        dd = b.number_input("Días de stock al cierre", min_value=0, max_value=365, value=30, step=5)
        mgp = st.number_input("Margen esperado %", min_value=0.0, max_value=80.0, step=0.1, value=round((pk["margen_alfa"] or 0) * 100, 1))
        p = calc.planificar_compra(pk, ores["all"]["m3"], meta, int(nmes), mgp / 100, dd)
        st.markdown(f"""
| | |
|---|---:|
| Costo de lo que vas a vender (sin IGV) | {money(p['costo_venta'])} |
| + Stock al cierre ({dd} días) | {money(p['stock_cierre'])} |
| − Inventario útil hoy (sin obsoleto) | {money(p['inventario_util'])} |
| **= Compra sugerida (sin IGV)** | **{money(p['compra'])}** |
""")
        st.progress(min(1.0, p["m3_compra"] / p["m3_libre"]) if p["m3_libre"] else 1.0,
                    text=f"Espacio: la compra ocupa ≈ {p['m3_compra']:,.1f} m³ · libres {p['m3_libre']:,.1f} m³")
        if p["compra"] == 0:
            st.success("No hace falta comprar: el inventario útil cubre la meta y el stock al cierre.")
        elif p["alcanza"]:
            st.success(f"Alcanza: sobran ≈ {p['m3_libre'] - p['m3_compra']:,.1f} m³ si llega todo junto.")
        else:
            st.error(f"No alcanza: faltan ≈ {p['m3_compra'] - p['m3_libre']:,.1f} m³ si llega todo junto. Liberar el obsoleto ocupa ≈ {p['obsoleto_m3']:,.1f} m³; también puedes escalonar la compra.")


# ============================================================================
# Asistente IA (Anthropic Claude)
# ============================================================================
with tab_ia:
    st.subheader("🤖 Asistente de inventario")
    api_key = secreto("ANTHROPIC_API_KEY") or st.session_state.get("api_key_manual")
    modelo = secreto("ANTHROPIC_MODEL", agent.MODELO_POR_DEFECTO)
    if not api_key:
        st.warning("Falta la clave de la API de Anthropic. En Streamlit Cloud ponla en **Settings → Secrets** como `ANTHROPIC_API_KEY = \"sk-ant-...\"`. "
                   "Para probar ahora puedes pegarla aquí (solo dura esta sesión).")
        k_in = st.text_input("ANTHROPIC_API_KEY", type="password")
        if k_in:
            st.session_state["api_key_manual"] = k_in
            st.rerun()
    else:
        import anthropic

        cliente = anthropic.Anthropic(api_key=api_key)
        st.caption(f"Responde con los datos cargados en el panel · modelo {modelo}")
        hist = st.session_state.setdefault("chat_api", [])
        vis = st.session_state.setdefault("chat_vis", [])
        if st.button("Nueva conversación", disabled=not vis):
            hist.clear(), vis.clear()
            st.rerun()
        ejemplos = ["¿Qué 10 proveedores tienen más días de inventario y cuánto valor tienen?",
                    "¿Cuánto inventario obsoleto hay por criterio y qué proveedores concentran más?",
                    "Si hago 15 % de descuento a los productos CZ de L'OREAL, ¿cuánto más debo vender?",
                    "¿Qué almacén está más lleno y cuántos m³ libres quedan en total?"]
        if not vis:
            cols = st.columns(2)
            for i, e in enumerate(ejemplos):
                if cols[i % 2].button(e, key=f"ej{i}", width="stretch"):
                    st.session_state["pregunta"] = e
                    st.rerun()
        for m in vis:
            with st.chat_message(m["role"]):
                st.markdown(m["text"])
                for t in m.get("tools", []):
                    with st.expander(f"🔧 {t['name']}"):
                        st.code(t["input"].get("sql") or str(t["input"]), language="sql" if "sql" in t["input"] else None)
                        st.text(t["output"][:3000])
        pregunta = st.chat_input("Pregunta sobre inventario, ventas, almacenes o compras…") or st.session_state.pop("pregunta", None)
        if pregunta:
            with st.chat_message("user"):
                st.markdown(pregunta)
            vis.append({"role": "user", "text": pregunta})
            hist.append({"role": "user", "content": pregunta})
            with st.chat_message("assistant"):
                usadas = []
                with st.status("Consultando los datos…", expanded=False) as estado:
                    def on_tool(n, i, o):
                        usadas.append({"name": n, "input": i, "output": o})
                        estado.write(f"🔧 {n}: `{(i.get('sql') or str(i))[:200]}`")
                    try:
                        texto, nuevo = agent.responder(cliente, modelo, hist, ds, R, on_tool)
                        hist[:] = nuevo
                        estado.update(label=f"Listo · {len(usadas)} consulta(s)", state="complete")
                    except anthropic.APIError as e:
                        texto = f"Error de la API de Anthropic: {e}"
                        hist.pop()
                        estado.update(label="Error", state="error")
                st.markdown(texto)
            vis.append({"role": "assistant", "text": texto, "tools": usadas})
