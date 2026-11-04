"""Panel de Inventario y Abastecimiento con Asistente IA — Streamlit.

Ejecutar en local:   streamlit run app.py
Streamlit Cloud:     subir esta carpeta a un repositorio privado de GitHub, elegir app.py y
                     pegar ANTHROPIC_API_KEY en Settings → Secrets (una sola vez).
"""
from __future__ import annotations

import os

import streamlit as st

import agent
import calc
import panel_component

st.set_page_config(page_title="Panel de Inventario y Abastecimiento", page_icon="📦", layout="wide", initial_sidebar_state="collapsed")


def secreto(nombre: str, defecto=None):
    """Lee un valor de .streamlit/secrets.toml (o Secrets de Streamlit Cloud) o de las variables de entorno."""
    try:
        if nombre in st.secrets:
            return st.secrets[nombre]
    except Exception:
        pass
    return os.environ.get(nombre, defecto)


# ----------------------------------------------------------------------------
# Acceso (opcional): define APP_PASSWORD en los Secrets para pedir contraseña
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
# Datos: archivos de /data, reemplazables desde la barra lateral
# ----------------------------------------------------------------------------
@st.cache_data(show_spinner="Cargando archivos…")
def datos_por_defecto():
    return calc.cargar_por_defecto()


@st.cache_data(show_spinner="Calculando indicadores…")
def calcular(ds: dict):
    return calc.calcular_todo(ds)


@st.cache_data(show_spinner="Preparando el panel…")
def datos_panel(ds: dict):
    return panel_component.preparar_datos(ds)


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def insights_ia_cache(version: str, modelo: str, _cliente, _R, _base):
    """Insights de Claude: se generan una vez por versión de datos y se reutilizan 6 horas para todos."""
    return agent.insights_ia(_cliente, modelo, _R, _base)


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
    archivo, version = datos_panel(ds)
except Exception as e:
    st.error(f"Los archivos no tienen el formato esperado: {e}")
    st.stop()

# ----------------------------------------------------------------------------
# Asistente IA: la clave sale de los Secrets, nunca de la interfaz
# ----------------------------------------------------------------------------
api_key = secreto("ANTHROPIC_API_KEY")
modelo = secreto("ANTHROPIC_MODEL", agent.MODELO_POR_DEFECTO)
cliente = None
if api_key:
    import anthropic

    cliente = anthropic.Anthropic(api_key=api_key)

ss = st.session_state
ss.setdefault("chat_api", [])       # historial en formato de la API de Anthropic (memoria de la conversación)
ss.setdefault("chat_vis", [])       # lo que se muestra en el panel (texto, tablas, gráficos, acciones)
ss.setdefault("procesados", set())  # eventos del panel ya atendidos
ss.setdefault("accion", None)       # última acción del asistente sobre el dashboard
ss.setdefault("respondido", None)
ss.setdefault("insights", None)
if ss.get("sesion_version") != version:
    ss["sesion"] = agent.Sesion(ds, R)
    ss["sesion_version"] = version
    ss["insights"] = {"items": agent.insights_reglas(R), "fuente": "reglas"}
    ss["insights_ia_ok"] = False


def compactar(hist: list, max_turnos: int = 12) -> list:
    """Limita la memoria: últimas preguntas completas y resultados de herramientas antiguos recortados."""
    inicios = [i for i, m in enumerate(hist) if m["role"] == "user" and isinstance(m["content"], str)]
    if len(inicios) > max_turnos:
        hist = hist[inicios[-max_turnos]:]
        inicios = [i for i, m in enumerate(hist) if m["role"] == "user" and isinstance(m["content"], str)]
    ultimo = inicios[-1] if inicios else 0
    for m in hist[:ultimo]:
        if m["role"] == "user" and isinstance(m["content"], list):
            for b in m["content"]:
                if b.get("type") == "tool_result" and isinstance(b.get("content"), str) and len(b["content"]) > 1200:
                    b["content"] = b["content"][:1200] + "\n…(recortado)"
    return hist


# ----------------------------------------------------------------------------
# Página: el dashboard original + panel del asistente
# ----------------------------------------------------------------------------
st.markdown("""<style>
[data-testid="stHeader"]{background:transparent;height:2.4rem}
.block-container{padding:2.4rem .5rem 0 .5rem;max-width:100%}
[data-testid="stMainBlockContainer"]{padding-bottom:0}
iframe[title="panel_component.panel_original"]{border:0;display:block}
footer{display:none}
</style>""", unsafe_allow_html=True)

evento = panel_component.mostrar(
    archivo, version,
    chat=ss["chat_vis"], insights=ss["insights"], ia_ok=bool(cliente), modelo=modelo if cliente else "",
    accion=ss["accion"], respondido=ss["respondido"], reiniciado=ss.pop("reiniciado", False),
    pedir_insights=bool(cliente) and not ss.get("insights_ia_ok"),
)

if evento and evento.get("id") not in ss["procesados"]:
    ss["procesados"].add(evento["id"])
    tipo = evento.get("tipo")
    if tipo == "preguntar" and cliente and str(evento.get("texto", "")).strip():
        texto = str(evento["texto"]).strip()[:4000]
        ss["chat_vis"].append({"id": evento["id"] + "-u", "role": "user", "texto": texto})
        ss["chat_api"].append({"role": "user", "content": texto})
        try:
            res, nuevo = agent.responder(cliente, modelo, ss["chat_api"], ss["sesion"], evento.get("contexto"))
            ss["chat_api"] = compactar(nuevo)
            acc = {k: v for k, v in res["accion"].items() if k != "descripcion"}
            ss["chat_vis"].append({"id": evento["id"], "role": "assistant", "texto": res["texto"], "bloques": res["bloques"],
                                   "accion_desc": res["accion"].get("descripcion", []), "consultas": res["consultas"]})
            if acc:
                ss["accion"] = {"id": evento["id"], **acc}
        except Exception as e:  # error de la API (clave, modelo, saldo, red…)
            ss["chat_api"].pop()
            ss["chat_vis"].append({"id": evento["id"], "role": "assistant", "error": True,
                                   "texto": f"No pude responder: **{type(e).__name__}**: {e}"})
        ss["respondido"] = evento["id"]
        st.rerun()
    elif tipo == "insights" and cliente and not ss.get("insights_ia_ok"):
        ss["insights_ia_ok"] = True
        try:
            items = insights_ia_cache(version, modelo, cliente, R, ss["insights"]["items"])
            ss["insights"] = {"items": items, "fuente": "ia"}
        except Exception as e:
            print("Insights de IA:", e)
        st.rerun()
    elif tipo == "reiniciar":
        ss["chat_api"], ss["chat_vis"], ss["accion"], ss["respondido"] = [], [], None, None
        ss["reiniciado"] = True
        st.rerun()
