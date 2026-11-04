"""Panel de Inventario y Abastecimiento — versión Streamlit.

Ejecutar en local:   streamlit run app.py
Streamlit Cloud:     subir esta carpeta a un repositorio de GitHub (privado) y elegir app.py.
"""
from __future__ import annotations

import os

import numpy as np
import streamlit as st

import agent
import calc
import panel_component

st.set_page_config(page_title="Panel de Inventario y Abastecimiento", page_icon="📦", layout="wide", initial_sidebar_state="collapsed")

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

st.markdown("""<style>
.block-container{padding-top:2.2rem;padding-left:1rem;padding-right:1rem;max-width:1240px}
iframe[title="panel_component.panel_original"]{border:0}
</style>""", unsafe_allow_html=True)

tab_panel, tab_ia = st.tabs(["📊 Panel", "🤖 Asistente IA"])


@st.cache_data(show_spinner="Preparando el panel…")
def tablas_panel(ds: dict):
    return panel_component.preparar_tablas(ds)


# ============================================================================
# Panel: la página original del dashboard (mismo diseño), con los datos de data/
# ============================================================================
with tab_panel:
    tablas, version = tablas_panel(ds)
    panel_component.mostrar(tablas, version)

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
