"""Lee los archivos del dashboard desde una carpeta de SharePoint (Microsoft Graph).

Usa la aplicación registrada en Microsoft Entra (credenciales de aplicación, sin usuario conectado).
La configuración va en los Secrets de Streamlit, nunca en el código:

    [sharepoint]
    tenant_id     = "00000000-0000-0000-0000-000000000000"
    client_id     = "00000000-0000-0000-0000-000000000000"
    client_secret = "…"
    sitio         = "https://empresa.sharepoint.com/sites/Abastecimiento"
    carpeta       = "Dashboard/Datos"          # ruta dentro de la biblioteca
    # biblioteca  = "Documentos"               # opcional; por defecto, la biblioteca principal del sitio
    # hora_corte  = 9                          # opcional; hora de Lima a la que se refrescan los datos

    [sharepoint.archivos]                      # opcional; solo los que tengan otro nombre
    inventario  = "inventario.xlsx"
    abc_xyz     = "dashboard_abcxyz.csv"
    almacenes   = "dashboard_inventarios.xlsx"
    cc_maestro  = "resumen_general_diferencias.csv"   # conteo cíclico, tal como sale del sistema
    cc_causas   = ""                         # vacío = no está en SharePoint (carga manual)
    cc_historia = ""                         # histórico acumulado del conteo (por ahora desde data/)
    # un Excel con varias hojas: "archivo.xlsx#NombreHoja"

Para probar la conexión desde la carpeta del proyecto (lee .streamlit/secrets.toml):
    .venv\\Scripts\\python sharepoint.py
"""
from __future__ import annotations

import io
from collections.abc import Mapping
from urllib.parse import quote, urlparse

import pandas as pd
import requests

import calc

GRAPH = "https://graph.microsoft.com/v1.0"
TIEMPO = 60          # segundos por petición


class ErrorSharePoint(Exception):
    """Error con un mensaje que se puede mostrar tal cual en la app."""


def a_dict(x) -> dict:
    """Los Secrets de Streamlit son objetos de solo lectura: se pasan a dict normal (también lo anidado)."""
    return {k: a_dict(v) if isinstance(v, Mapping) else v for k, v in x.items()} if isinstance(x, Mapping) else {}


def configurado(cfg) -> bool:
    cfg = a_dict(cfg)
    return all(cfg.get(k) for k in ("tenant_id", "client_id", "client_secret", "sitio"))


# ----------------------------------------------------------------------------
class Cliente:
    def __init__(self, cfg: dict, sesion=None):
        self.cfg = cfg
        self.http = sesion or requests.Session()
        self._token = None

    def token(self) -> str:
        if self._token:
            return self._token
        r = self.http.post(f"https://login.microsoftonline.com/{self.cfg['tenant_id']}/oauth2/v2.0/token", timeout=TIEMPO, data={
            "grant_type": "client_credentials", "client_id": self.cfg["client_id"],
            "client_secret": self.cfg["client_secret"], "scope": "https://graph.microsoft.com/.default"})
        if r.status_code != 200:
            detalle = ""
            try:
                detalle = r.json().get("error_description", "").split("\r\n")[0]
            except Exception:
                pass
            raise ErrorSharePoint(f"No pude iniciar sesión en Microsoft (revisa tenant_id, client_id y client_secret). {detalle}".strip())
        self._token = r.json()["access_token"]
        return self._token

    def get(self, ruta: str, **kw) -> requests.Response:
        url = ruta if ruta.startswith("http") else GRAPH + ruta
        r = self.http.get(url, headers={"Authorization": f"Bearer {self.token()}"}, timeout=TIEMPO, **kw)
        if r.status_code == 200:
            return r
        motivo = {401: "credenciales rechazadas", 403: "la aplicación no tiene permiso sobre ese sitio o carpeta",
                  404: "no existe"}.get(r.status_code, f"error {r.status_code}")
        raise ErrorSharePoint(f"SharePoint respondió «{motivo}» al pedir {ruta.split('?')[0]}")

    def unidad(self) -> str:
        """Id de la biblioteca de documentos donde está la carpeta."""
        if self.cfg.get("drive_id"):
            return self.cfg["drive_id"]
        sitio = str(self.cfg["sitio"]).strip().rstrip("/")
        if sitio.startswith("http"):
            u = urlparse(sitio)
            host, ruta = u.netloc, u.path or "/"
        elif ":" in sitio:
            host, ruta = sitio.split(":", 1)
        else:
            host, ruta = sitio, "/"
        site_id = self.get(f"/sites/{host}:{quote(ruta)}").json()["id"]
        biblio = str(self.cfg.get("biblioteca") or "").strip().lower()
        if biblio:
            for d in self.get(f"/sites/{site_id}/drives").json().get("value", []):
                if d.get("name", "").lower() == biblio:
                    return d["id"]
            raise ErrorSharePoint(f"No encontré la biblioteca «{self.cfg['biblioteca']}» en el sitio.")
        return self.get(f"/sites/{site_id}/drive").json()["id"]

    def listar(self, drive: str) -> list[dict]:
        carpeta = str(self.cfg.get("carpeta") or "").strip("/")
        ruta = f"/drives/{drive}/root:/{quote(carpeta)}:/children" if carpeta else f"/drives/{drive}/root/children"
        return [{"nombre": i["name"], "modificado": i.get("lastModifiedDateTime", ""), "bytes": i.get("size", 0)}
                for i in self.get(ruta).json().get("value", []) if "file" in i]

    def archivo(self, drive: str, nombre: str) -> tuple[bytes, str]:
        """Contenido y fecha de modificación de un archivo de la carpeta."""
        carpeta = str(self.cfg.get("carpeta") or "").strip("/")
        ruta = f"{carpeta}/{nombre}" if carpeta else nombre
        meta = self.get(f"/drives/{drive}/root:/{quote(ruta)}").json()
        enlace = meta.get("@microsoft.graph.downloadUrl")
        if enlace:      # enlace temporal de descarga: no lleva el token
            r = self.http.get(enlace, timeout=TIEMPO)
            if r.status_code != 200:
                raise ErrorSharePoint(f"No pude descargar {nombre} (error {r.status_code}).")
            datos = r.content
        else:
            datos = self.get(f"/drives/{drive}/root:/{quote(ruta)}:/content").content
        return datos, meta.get("lastModifiedDateTime", "")


# ----------------------------------------------------------------------------
class _Subido(io.BytesIO):
    """Imita un archivo subido en la app: así se reutiliza el mismo lector (calc.leer_subido)."""
    def __init__(self, datos: bytes, nombre: str):
        super().__init__(datos)
        self.name = nombre


def nombres(cfg: dict) -> dict[str, str]:
    """Archivo de SharePoint para cada dato del panel (por defecto, el mismo nombre que en data/)."""
    propios = cfg.get("archivos") or {}
    # nombre vacío = ese dato no está en SharePoint (por ejemplo, una carga manual): se usa el de data/ sin avisar
    return {clave: str(propios[clave] if clave in propios else archivo) for clave, (archivo, _) in calc.DATASETS.items()
            if not (clave in propios and not str(propios[clave]).strip())}


def leer(clave: str, datos: bytes, nombre: str) -> pd.DataFrame:
    archivo, _, hoja = nombre.partition("#")
    if hoja and clave != "almacenes":
        # Excel con varias hojas: se toma la indicada y se pasa por el lector de CSV
        df = pd.read_excel(io.BytesIO(datos), sheet_name=hoja, dtype=str).fillna("")
        return calc.leer_subido(clave, _Subido(df.to_csv(index=False).encode("utf-8"), archivo.rsplit(".", 1)[0] + ".csv"))
    return calc.leer_subido(clave, _Subido(datos, archivo))


def cargar(cfg, sesion=None) -> tuple[dict[str, pd.DataFrame], dict]:
    """Descarga y lee los 7 archivos. Devuelve (datos, info). Los que fallen se informan en info['errores']."""
    cfg = a_dict(cfg)
    cli = Cliente(cfg, sesion)
    drive = cli.unidad()
    ds, info = {}, {"archivos": {}, "errores": {}}
    for clave, nombre in nombres(cfg).items():
        try:
            datos, modificado = cli.archivo(drive, nombre.partition("#")[0])
            ds[clave] = leer(clave, datos, nombre)
            info["archivos"][clave] = {"nombre": nombre, "modificado": modificado, "filas": len(ds[clave])}
        except ErrorSharePoint as e:
            info["errores"][clave] = str(e)
        except Exception as e:            # archivo con otro formato
            info["errores"][clave] = f"{nombre}: no tiene el formato esperado ({type(e).__name__}: {e})"
    return ds, info


# ----------------------------------------------------------------------------
if __name__ == "__main__":       # prueba de conexión: .venv\Scripts\python sharepoint.py
    import sys
    import tomllib
    from pathlib import Path
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    p = Path(__file__).parent / ".streamlit" / "secrets.toml"
    cfg = tomllib.loads(p.read_text(encoding="utf-8")).get("sharepoint", {}) if p.exists() else {}
    if not configurado(cfg):
        sys.exit("Falta la sección [sharepoint] en .streamlit/secrets.toml (tenant_id, client_id, client_secret, sitio).")
    cli = Cliente(cfg)
    drive = cli.unidad()
    print("Conexión correcta. Archivos en la carpeta:")
    hay = {f["nombre"]: f for f in cli.listar(drive)}
    for f in hay.values():
        print(f"  · {f['nombre']}  ({f['bytes']:,} bytes, modificado {f['modificado']})")
    print("\nDatos del panel:")
    for clave, nombre in nombres(cfg).items():
        print(f"  {'OK ' if nombre.partition('#')[0] in hay else 'FALTA'}  {clave:20s} ← {nombre}")
    ds, info = cargar(cfg)
    print("\nLectura:", {k: v["filas"] for k, v in info["archivos"].items()})
    for k, e in info["errores"].items():
        print(f"  ERROR {k}: {e}")
