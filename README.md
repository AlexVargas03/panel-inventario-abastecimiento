# Panel de Inventario y Abastecimiento — Streamlit

## Ejecutar localmente
1. Instala Python 3.10 o superior.
2. Abre una terminal en esta carpeta.
3. Ejecuta:

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

## Archivos de datos
Coloca los Excel en `data/` con estos nombres:
- `dashboard_abcxyz.xlsx` (hoja `ABC_XYZ`)
- `dashboard_inventarios.xlsx` (hoja `Inventarios`)

## Próximas etapas
- Replicar con mayor fidelidad las vistas del Claude Artifact original.
- Integrar Claude API con herramientas de consulta sobre los DataFrames.
- Sustituir la lectura local por Microsoft Graph / SharePoint.
- Configurar secretos y despliegue.

No subas claves API, contraseñas ni datos empresariales sensibles a un repositorio público.
