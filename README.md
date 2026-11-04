# Panel de Inventario y Abastecimiento + Asistente IA (Streamlit)

El mismo dashboard de ALFA y TORU (diseño original del Claude Dashboard) con un **Asistente IA** al lado, hecho con la API de Claude (Anthropic). El asistente:

- responde preguntas de negocio con los datos del panel (ventas, margen, inventario, obsoleto, ABC-XYZ, almacenes);
- **muestra tablas y gráficos** en el chat (líneas, barras, torta, dispersión, mapa de calor) y puede descargar cada tabla en CSV;
- **mueve el dashboard** para enseñarte la respuesta: cambia de pestaña, periodo, proveedor, top N, empresa de la matriz ABC, filtro de obsoletos o valores del planificador, y puede poner un gráfico en la tarjeta "Análisis de IA";
- sabe qué filtros tienes activos y mantiene el contexto de la conversación ("ahora solo junio", "y para L'Oréal?");
- al abrir muestra **insights automáticos** (alertas calculadas al instante y luego reescritas por Claude).

## Qué hay en la carpeta

| Archivo | Para qué sirve |
|---|---|
| `app.py` | La app: carga los datos, muestra el panel y atiende las preguntas del asistente |
| `agent.py` | El asistente: vistas de negocio, herramientas de Claude, contexto y memoria, insights |
| `calc.py` | Cálculos del panel en pandas (los mismos del dashboard) |
| `panel_component.py` | Muestra la página del dashboard + el panel del asistente y le pasa los datos |
| `panel_original/pagina.html` | La página original del dashboard, sin cambios |
| `panel_original/ia.js`, `ia.css` | El panel del Asistente IA (chat, tablas, gráficos, acciones) |
| `panel_original/shim.js`, `base.css`, `d3.min.js` | Reemplazan el entorno de claude.ai (API `dash`, colores, d3) |
| `data/` | Copia de los datos (inventario, ABC-XYZ, almacenes, sell out ene–sep 2026) |
| `.streamlit/secrets.toml.example` | Modelo de los secretos |

## La clave de la API (se pega una sola vez)

La app lee `ANTHROPIC_API_KEY` de los **Secrets**; nadie la escribe en la pantalla y no va dentro del código (si el repositorio se comparte o se filtra, la clave quedaría expuesta y GitHub/Anthropic la desactivan).

- **Streamlit Cloud:** tu app → **Settings → Secrets** → pega:
  ```toml
  ANTHROPIC_API_KEY = "sk-ant-..."
  # ANTHROPIC_MODEL = "claude-sonnet-5-5"   # opcional
  # APP_PASSWORD = "una-contraseña"         # opcional: pide contraseña al entrar
  ```
- **En tu computadora:** copia `.streamlit/secrets.toml.example` como `.streamlit/secrets.toml` y pon la clave ahí (ese archivo está en `.gitignore`).

La clave se crea en https://console.anthropic.com → API Keys (la cuenta necesita créditos). Sin clave, el dashboard funciona igual y el panel avisa que el chat está desactivado.

## Probar en tu computadora

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

## Publicar en Streamlit Community Cloud

1. Sube esta carpeta a un repositorio **privado** de GitHub (los datos de la empresa van en `data/`).
2. https://share.streamlit.io → **Create app** → repositorio, rama `main`, archivo `app.py`.
3. **Advanced settings → Secrets**: pega lo de arriba. **Deploy**.

## Actualizar los datos

- **Solo esa sesión:** barra lateral (botón `>` arriba a la izquierda) → *Reemplazar archivos*. Para almacenes acepta `dashboard_inventarios.xlsx`; para ABC-XYZ, `dashboard_abcxyz.csv` tal cual sale de SharePoint.
- **Fijo:** reemplaza el archivo en `data/` con el mismo nombre y columnas y haz commit.

Columnas esperadas:

- `inventario.csv`: sku, producto, proveedor, categoria, grupo, subgrupo, stock, valor, estado, clase, masterpack, m3_masterpack
- `abc_xyz.csv`: empresa, producto_id, producto, categoria, segmento, stock, valor, longitud, ancho, alto, peso
- `almacenes.json` (o el Excel): id, almacen, capacidad, usado_alfa, usado_toru, usado_total, libre, pct_total, pct_alfa, pct_toru, vitrina, uni_alfa, uni_toru, monto_alfa, monto_toru
- `sellout_mes.csv`: mes, canal, interco, venta, costo_sin_igv, unidades, tickets, lineas
- `sellout_proveedor.csv`: mes, canal, interco, id_proveedor, proveedor, venta, costo_sin_igv, unidades, tickets, skus
- `sellout_tienda_prov.csv`: mes, tienda, proveedor, venta, costo_sin_igv
- `sku_venta.csv`: sku, ult_venta, unidades, venta, costo_sin_igv

## Cómo funciona el asistente

**Motor analítico** (`agent.py`): con los archivos se arman vistas de negocio en memoria (DuckDB + pandas): `vw_ventas`, `vw_ventas_mes`, `vw_ventas_tienda`, `vw_productos_venta`, `vw_inventario`, `vw_productos_margen`, `vw_obsoleto`, `vw_proveedor_inventario`, `vw_abc`, `vw_matriz_abc`, `vw_matriz_clase`, `vw_almacenes`. Más adelante pueden apuntar a SQL Server con SQLAlchemy sin cambiar las herramientas.

**Herramientas de Claude:**

| Herramienta | Qué hace |
|---|---|
| `query_business_database` | Métrica por dimensión con rango de fechas y filtros (ej. ventas por proveedor en Q3, margen % por mes, valor de inventario por segmento de TORU). Muestra la tabla en el chat |
| `consultar_sql` | SELECT libre de solo lectura sobre las vistas (sin acceso a archivos ni internet) |
| `mostrar_tabla` | Muestra al usuario el resultado de una consulta |
| `generate_dynamic_chart` | Gráfico de líneas, barras, torta, dispersión o mapa de calor, en el chat o en el dashboard |
| `controlar_dashboard` | Cambia pestaña, periodo, proveedor, top N, empresa ABC, obsoletos y planificador |
| `simular_descuento` / `planificar_compra` | Las calculadoras de la pestaña Planificación |

**Contexto y memoria:** en cada pregunta el panel envía el estado del dashboard (pestaña, periodo, proveedor, filtros) y se inyecta en el system prompt del turno. El historial usa el formato `messages` de la API y dura mientras la sesión esté abierta (se recorta a las últimas 12 preguntas). Para guardarlo entre días haría falta una base de datos externa (Redis, Postgres…), porque Streamlit Cloud borra sus archivos al reiniciar.

**Insights automáticos:** se calculan al instante con reglas (almacén más lleno, obsoleto, variación del último mes, proveedor con más días de inventario) y, si hay clave, Claude los reescribe; se guardan 6 horas por versión de datos para no gastar en cada visita.

## Instrucciones para un agente de IA que instale esto

1. Python 3.10+; `pip install -r requirements.txt`.
2. Crear `.streamlit/secrets.toml` desde `secrets.toml.example` con la `ANTHROPIC_API_KEY` que entregue el usuario (no inventarla, no subirla al repositorio, no ponerla en el código).
3. Probar: `streamlit run app.py --server.headless true` y `curl localhost:8501/_stcore/health` → `ok`.
4. Nube: repositorio privado → share.streamlit.io → `app.py` → Secrets.
5. No cambiar nombres de columnas de `data/` ni `panel_original/pagina.html` salvo para actualizar el diseño del dashboard.
