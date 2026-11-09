"""Abre el dashboard publicado para despertarlo y dejar los datos del día ya descargados.

Lo ejecuta GitHub Actions cada mañana (.github/workflows/despertar.yml). También se puede probar a mano:
    pip install playwright && playwright install chromium
    python scripts/despertar_app.py

Variables de entorno:
    APP_URL           dirección de la app (por defecto, la de Streamlit Cloud)
    APP_PASSWORD      solo si la app pide contraseña
    BROWSER_CHANNEL   "chrome" para usar el Chrome instalado en vez del Chromium de Playwright
Termina con error (código 1) si la app no llega a mostrar el dashboard: así GitHub avisa por correo.
"""
from __future__ import annotations

import os
import sys
import time

from playwright.sync_api import TimeoutError as Agotado
from playwright.sync_api import sync_playwright

URL = os.environ.get("APP_URL") or "https://panel-inventario-a1.streamlit.app/"
CLAVE = os.environ.get("APP_PASSWORD", "")
LIMITE = 6 * 60          # segundos: despertar + arrancar + bajar de SharePoint
# Estado de los datos que escribe la barra lateral (plegada, por eso se lee el texto aunque no se vea)
ESTADOS = ("Datos de SharePoint", "La app usa los archivos de la carpeta data/", "No pude leer SharePoint")


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def texto_de(pagina) -> str:
    """Texto de la página y de todos sus marcos, visible u oculto (la app va dentro de iframes)."""
    partes = []
    for marco in pagina.frames:
        try:
            partes.append(marco.evaluate("() => document.body ? document.body.innerText + '\\n' + document.body.textContent : ''"))
        except Exception:
            pass
    return "\n".join(partes)


def dashboard_listo(pagina) -> bool:
    """El panel (componente) solo se dibuja cuando los datos ya cargaron y se calcularon."""
    for marco in pagina.frames:
        if "panel_component" in marco.url or "/component/" in marco.url:
            try:
                if marco.evaluate("() => !!document.getElementById('ia-panel') && !!document.getElementById('ia-main')"):
                    return True
            except Exception:
                pass
    return False


def pulsar_si_existe(pagina, nombres: tuple[str, ...]) -> bool:
    for marco in pagina.frames:
        for nombre in nombres:
            boton = marco.get_by_role("button", name=nombre)
            try:
                if boton.count():
                    boton.first.click(timeout=3000)
                    return True
            except Exception:
                pass
    return False


def main() -> int:
    with sync_playwright() as p:
        canal = os.environ.get("BROWSER_CHANNEL") or None
        navegador = p.chromium.launch(headless=True, channel=canal)
        pagina = navegador.new_page(viewport={"width": 1440, "height": 900})
        log(f"Abriendo {URL}")
        pagina.goto(URL, wait_until="domcontentloaded", timeout=120_000)

        inicio, desperto, entro = time.time(), False, False
        while time.time() - inicio < LIMITE:
            t = texto_de(pagina)
            if dashboard_listo(pagina):
                linea = next((l for l in t.splitlines() if any(s in l for s in ESTADOS)), "estado de los datos no visible")
                log(f"Dashboard listo · {linea.strip()[:160]}")
                navegador.close()
                return 0
            if not desperto and pulsar_si_existe(pagina, ("Yes, get this app back up!", "Wake up", "Despertar")):
                desperto = True
                log("La app estaba dormida: pulsé el botón para despertarla")
            if CLAVE and not entro and "Contraseña" in t:
                for marco in pagina.frames:
                    campo = marco.get_by_label("Contraseña")
                    try:
                        if campo.count():
                            campo.first.fill(CLAVE)
                            campo.first.press("Enter")
                            entro = True
                            log("Ingresé la contraseña de la app")
                            break
                    except Exception:
                        pass
            elif not CLAVE and "Contraseña" in t:
                log("La app pide contraseña: agrega APP_PASSWORD en los secretos del repositorio de GitHub")
                navegador.close()
                return 1
            try:
                pagina.wait_for_timeout(5000)
            except Agotado:
                pass
        log(f"La app no terminó de cargar en {LIMITE // 60} minutos")
        pagina.screenshot(path="despertar_fallo.png", full_page=True)
        navegador.close()
        return 1


if __name__ == "__main__":
    sys.exit(main())
