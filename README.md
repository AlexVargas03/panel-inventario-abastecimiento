# Panel de Inventario y Abastecimiento (Streamlit)

Versión en Python del dashboard "Panel de Inventario y Abastecimiento" de ALFA y TORU. Incluye un asistente de IA (Claude, de Anthropic) que responde preguntas sobre los datos.

## Qué hay en la carpeta

| Archivo | Para qué sirve |
|---|---|
| `app.py` | La app: pestaña **Panel** (el dashboard original, mismo diseño) y pestaña **Asistente IA** |
| `panel_component.py` | Muestra la página original del dashboard dentro de Streamlit y le pasa los datos |
| `panel_original/pagina.html` | La página original del dashboard (HTML/JS), sin cambios |
| `panel_original/shim.js`, `base.css`, `d3.min.js` | Reemplazan el entorno de claude.ai: la API `dash`, los colores y tipografías del tema y la librería de gráficos d3 |
| `calc.py` | Los cálculos del panel pasados a pandas (los usa el asistente de IA) |
| `agent.py` | El asistente de IA: Claude con herramientas para consultar los datos (SQL de solo lectura con DuckDB), simular descuentos y planificar compras |
| `data/` | Copia de los datos al 03/11/2026 (inventario, ABC-XYZ, almacenes, sell out ene–sep 2026) |
| `requirements.txt` | Librerías de Python |
| `.streamlit/config.toml` | Tema y límite de subida |
| `.streamlit/secrets.toml.example` | Modelo de los secretos (clave de la API) |

## Probar en tu computadora

```bash
python -m venv .venv
source .venv/bin/activate          # en Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy .streamlit\secrets.toml.example .streamlit\secrets.toml   # en Mac/Linux: cp ...
# edita .streamlit/secrets.toml y pon tu ANTHROPIC_API_KEY
streamlit run app.py
```

## Publicar en Streamlit Community Cloud (share.streamlit.io)

1. Crea un repositorio **privado** en GitHub y sube todo el contenido de esta carpeta (los datos de la empresa van en `data/`, por eso privado). No subas `.streamlit/secrets.toml` (ya está en `.gitignore`).
2. Entra a https://share.streamlit.io con tu cuenta de GitHub → **Create app** → elige el repositorio, la rama `main` y el archivo `app.py`.
3. En **Advanced settings → Secrets** pega:
   ```toml
   ANTHROPIC_API_KEY = "sk-ant-..."
   APP_PASSWORD = "una-contraseña"     # opcional, pide contraseña al entrar
   # ANTHROPIC_MODEL = "claude-sonnet-4-5"   # opcional
   ```
4. **Deploy**. La primera vez tarda unos minutos en instalar las librerías.

La clave de la API se saca en https://console.anthropic.com → API Keys (necesita saldo/créditos).

## Actualizar los datos

- **Rápido (solo esa sesión):** en la barra lateral, *Reemplazar archivos*, sube el CSV o Excel nuevo. Para almacenes acepta directamente `dashboard_inventarios.xlsx` (hoja Inventarios + hoja Info); para ABC-XYZ acepta `dashboard_abcxyz.csv` tal cual sale de SharePoint.
- **Fijo:** reemplaza el archivo en `data/` del repositorio con el mismo nombre y columnas; Streamlit Cloud se actualiza solo al hacer commit.

Columnas esperadas:

- `inventario.csv`: sku, producto, proveedor, categoria, grupo, subgrupo, stock, valor, estado, clase, masterpack, m3_masterpack
- `abc_xyz.csv`: empresa, producto_id, producto, categoria, segmento, stock, valor, longitud, ancho, alto, peso
- `almacenes.json` (o el Excel): id, almacen, capacidad, usado_alfa, usado_toru, usado_total, libre, pct_total, pct_alfa, pct_toru, vitrina, uni_alfa, uni_toru, monto_alfa, monto_toru
- `sellout_mes.csv`: mes, canal, interco, venta, costo_sin_igv, unidades, tickets, lineas
- `sellout_proveedor.csv`: mes, canal, interco, id_proveedor, proveedor, venta, costo_sin_igv, unidades, tickets, skus
- `sellout_tienda_prov.csv`: mes, tienda, proveedor, venta, costo_sin_igv
- `sku_venta.csv`: sku, ult_venta, unidades, venta, costo_sin_igv

Más adelante se puede conectar SharePoint (Microsoft Graph) para que lea los Excel directamente.

## Diseño del panel

La pestaña Panel es la misma página del Claude Dashboard: `panel_original/pagina.html` corre dentro de un componente de Streamlit y `shim.js` le da los datos de `data/` con la misma API (`dash.calc`, `dash.data`, `dash.setParams`…). Si el dashboard original cambia, reemplaza `pagina.html` por el nuevo `files/index.html` y reinicia la app; `index.html` se vuelve a armar solo al iniciar.

Diferencia con claude.ai: las tipografías propias de Anthropic se reemplazan por las del sistema (no se pueden redistribuir).

## Asistente de IA

La pestaña **🤖 Asistente IA** usa Claude con tres herramientas:

- `consultar_sql`: consultas SELECT sobre las tablas del panel (inventario, pl_obs, pl_prov, pl_sku, almacenes, so_base, matriz_abc…). Solo lectura y sin acceso a archivos ni internet.
- `simular_descuento`: venta extra necesaria = descuento ÷ (margen − descuento), y liquidación del stock.
- `planificar_compra`: compra sugerida y si cabe en el espacio libre.

En cada respuesta se puede abrir el detalle de las consultas que hizo.

## Instrucciones para un agente de IA que instale esto

1. Verificar Python 3.10+ e instalar `pip install -r requirements.txt`.
2. Crear `.streamlit/secrets.toml` a partir de `secrets.toml.example` con la `ANTHROPIC_API_KEY` que dé el usuario (no inventarla ni subirla al repositorio).
3. Probar: `streamlit run app.py --server.headless true` y comprobar `curl localhost:8501/_stcore/health` → `ok`.
4. Para la nube: repositorio privado en GitHub → share.streamlit.io → `app.py` → Secrets.
5. No cambiar los nombres de columnas de `data/`: `calc.py` depende de ellos.
