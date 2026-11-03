import os
from pathlib import Path
import pandas as pd
import streamlit as st
import plotly.express as px

st.set_page_config(page_title="Panel de Inventario y Abastecimiento", page_icon="📦", layout="wide")
ROOT = Path(__file__).parent
DATA = ROOT / "data"

st.markdown("""
<style>
.block-container {padding-top: 1.5rem; padding-bottom: 2rem;}
[data-testid="stMetric"] {background: #f7f9fc; border: 1px solid #e6eaf0; padding: 14px; border-radius: 12px;}
</style>
""", unsafe_allow_html=True)

@st.cache_data
def load_data():
    abc_path = DATA / "dashboard_abcxyz.xlsx"
    inv_path = DATA / "dashboard_inventarios.xlsx"
    abc = pd.read_excel(abc_path, sheet_name="ABC_XYZ") if abc_path.exists() else pd.DataFrame()
    inv = pd.read_excel(inv_path, sheet_name="Inventarios") if inv_path.exists() else pd.DataFrame()
    return abc, inv

def get_api_key() -> str:
    """Lee la clave de los secretos de Streamlit o del entorno.

    st.secrets lanza StreamlitSecretNotFoundError cuando no existe ningun
    secrets.toml (caso habitual en local y en un despliegue sin secretos),
    por eso el acceso va protegido.
    """
    try:
        key = st.secrets.get("ANTHROPIC_API_KEY", "")
    except Exception:
        key = ""
    return key or os.getenv("ANTHROPIC_API_KEY", "")


abc, inv = load_data()

st.title("📦 Panel de Inventario y Abastecimiento")
st.caption("Versión inicial de prueba · Datos Excel locales · Próxima etapa: conexión a SharePoint y agente IA")

with st.sidebar:
    st.header("Filtros")
    if not abc.empty:
        empresas = sorted(abc["Empresa"].dropna().astype(str).unique())
        selected_empresas = st.multiselect("Empresa", empresas, default=empresas)
        segmentos = sorted(abc["segmento_abcxyz"].dropna().astype(str).unique())
        selected_segmentos = st.multiselect("Segmento ABC-XYZ", segmentos, default=segmentos)
        categorias = sorted(abc["categoria"].dropna().astype(str).unique())
        selected_categorias = st.multiselect("Categoría", categorias)
    else:
        selected_empresas, selected_segmentos, selected_categorias = [], [], []

tab1, tab2, tab3 = st.tabs(["Resumen de inventario", "Análisis ABC-XYZ", "Asistente IA"])

with tab1:
    st.subheader("Ocupación de almacenes")
    if inv.empty:
        st.warning("No se encontró el archivo de inventarios en la carpeta data.")
    else:
        cap = inv["Capacidad(m3)"].sum()
        used = inv["Usado Total(m3)"].sum()
        free = inv["Libre(m3)"].sum()
        units = inv["Unidades_ALFA"].sum() + inv["Unidades_TORU"].sum()
        c1,c2,c3,c4 = st.columns(4)
        c1.metric("Capacidad total", f"{cap:,.2f} m³")
        c2.metric("Volumen utilizado", f"{used:,.2f} m³")
        c3.metric("Espacio libre", f"{free:,.2f} m³")
        c4.metric("Unidades almacenadas", f"{units:,.0f}")
        left,right = st.columns(2)
        with left:
            fig = px.bar(inv, x="Almacen_Fisico", y=["Usado ALFA(m3)", "Usado TORU(m3)"],
                         title="Volumen utilizado por almacén", barmode="stack")
            fig.update_layout(xaxis_title="", yaxis_title="m³", legend_title="Empresa")
            st.plotly_chart(fig, width='stretch')
        with right:
            fig = px.bar(inv, x="Almacen_Fisico", y="% Uso Total", title="Porcentaje de ocupación por almacén",
                         color="% Uso Total", color_continuous_scale="Blues")
            fig.update_layout(xaxis_title="", yaxis_title="%")
            st.plotly_chart(fig, width='stretch')
        st.dataframe(inv, width='stretch', hide_index=True)

with tab2:
    st.subheader("Clasificación ABC-XYZ")
    if abc.empty:
        st.warning("No se encontró el archivo ABC-XYZ en la carpeta data.")
    else:
        f = abc.copy()
        if selected_empresas:
            f = f[f["Empresa"].astype(str).isin(selected_empresas)]
        if selected_segmentos:
            f = f[f["segmento_abcxyz"].astype(str).isin(selected_segmentos)]
        if selected_categorias:
            f = f[f["categoria"].astype(str).isin(selected_categorias)]
        a,b,c,d = st.columns(4)
        a.metric("Productos", f["producto_id"].nunique())
        cstock = f["stock_actual"].fillna(0).sum()
        b.metric("Stock total", f"{cstock:,.0f}")
        c.metric("Stock valorizado", f"{f['Stock Valorizado'].fillna(0).sum():,.2f}")
        d.metric("Categorías", f["categoria"].nunique())
        left,right = st.columns(2)
        with left:
            seg = f.groupby("segmento_abcxyz", dropna=False).size().reset_index(name="Productos")
            st.plotly_chart(px.bar(seg, x="segmento_abcxyz", y="Productos", title="Productos por segmento ABC-XYZ"), width='stretch')
        with right:
            cat = f.groupby("categoria", dropna=False)["Stock Valorizado"].sum().nlargest(12).reset_index()
            st.plotly_chart(px.bar(cat, x="Stock Valorizado", y="categoria", orientation="h", title="Top 12 categorías por valorización"), width='stretch')
        search = st.text_input("Buscar producto por código o nombre")
        if search:
            f = f[f["producto_id"].astype(str).str.contains(search, case=False, na=False) |
                  f["producto_nombre"].astype(str).str.contains(search, case=False, na=False)]
        st.dataframe(f, width='stretch', hide_index=True)

with tab3:
    st.subheader("Asistente de inventarios")
    st.info("El chat se habilitará en la siguiente iteración con Claude API. Por ahora puedes explorar los datos en las pestañas anteriores.")
    st.markdown("**Ejemplos de preguntas que podrá responder:**")
    st.markdown("- ¿Qué almacenes tienen mayor porcentaje de ocupación?\n- ¿Qué segmentos ABC-XYZ concentran más stock valorizado?\n- ¿Qué categorías tienen mayor inventario?\n- ¿Cuánto espacio libre queda en los almacenes?")
    api_key = get_api_key()
    if api_key:
        st.success("Se detectó una clave de Anthropic. El chat se integrará en la siguiente versión.")
    else:
        st.caption("Para activar el agente necesitaremos configurar ANTHROPIC_API_KEY en los secretos de Streamlit, nunca dentro del código.")

st.divider()
st.caption("Panel de prueba · Las fechas de los archivos corresponden a las exportaciones recibidas. Los datos no se actualizan automáticamente en esta versión.")
