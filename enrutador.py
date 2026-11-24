"""Enrutador de preguntas de AlfaCorp Bot.

Antes de llamar al modelo detecta de qué trata la pregunta y le deja una guía concreta: qué bloque
visual usar y a qué sección exacta llevar el dashboard (con la empresa, el mes, el segmento o el
almacén que el usuario mencionó). Al terminar, comprueba que lo hizo: si respondió una pregunta de
datos solo con texto, o no movió el dashboard a lo que se preguntó, se le pide una vez que lo complete.
El movimiento siempre sale de la pregunta: si el dashboard ya está donde toca, no se mueve.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
         "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
PESTANA_COD = {"panel": "pn", "politica": "po", "almacen": "alm", "conteo": "cc", "seguimiento": "sg"}
LUGAR = {"panel": "Panel de control", "politica": "Política por segmento", "almacen": "Capacidad de almacén",
         "conteo": "Conteo cíclico", "seguimiento": "Seguimiento de proveedores"}
VISUALES = {"kpis", "scorecard", "chart", "table", "comparativa", "alertas", "ficha", "informe"}

# (tema, patrón sobre el texto sin tildes y en minúsculas). El orden importa: lo más específico primero.
TEMAS = [
    ("gerencia", r"como vamos|como estamos|resumen|panorama|estado general|en rojo|para gerencia|tablero ejecutivo|indicadores (clave|de gestion)|kpis?\b"),
    ("calculo", r"compra sugerida|cuanto (pedir|comprar|debo comprar)|obsolet|descontinu|sin venta|liquid|dias de inventario|rotacion|descuento|sobrestock|quiebre"),
    ("seguimiento", r"seguimiento|cobertura del conteo|se contaron|no se cont|cuando se cont|contad[oa]s\b|sin conteo|evolucion por sku"),
    ("conteo", r"conteo|diferencias?\b|faltante|sobrante|exactitud|reconteo|ajuste de inventario|inventario fisico"),
    ("almacen", r"almacen|capacidad|\bm3\b|m³|metros cubicos|espacio libre|ocupacion|croquis|deposito"),
    ("abc", r"\babc\b|\bxyz\b|segmento|clasificacion|clase [abc]\b|politica"),   # códigos AX…CZ: solo en mayúsculas (abajo)
    ("compras", r"compras?\b|compramos|sell ?in|abastecimiento|reposicion|evolucion del inventario|inventario (por|de cada|mes a) mes"),
    ("ventas", r"venta|vend[ieo]|cuota|\bmeta\b|facturac|sell ?out|ingreso|canal|reparto|tienda|e-?commerce|crecimiento"),
    ("producto", r"\bsku\b|\bproducto\b|\barticulo\b|\b\d{6,10}\b"),
]
NO_DATOS = r"^(hola|buen[oa]s|gracias|ok|okey|dale|listo|perfecto|genial|chao|adios|jaja)\b"


def _plano(t: str) -> str:
    t = unicodedata.normalize("NFD", str(t or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def texto_usuario(contenido) -> str:
    if isinstance(contenido, str):
        return contenido
    return " ".join(b.get("text", "") for b in (contenido or []) if isinstance(b, dict) and b.get("type") == "text")


def _empresa(p: str) -> str | None:
    if re.search(r"alfa ?corp|ambas|las dos|consolidad|grupo", p):
        return "ALL"
    if re.search(r"\btoru\b", p):
        return "TORU"
    if re.search(r"\balfa\b", p):
        return "ALFA"
    return None


def _mes(p: str, hoy: date) -> str | None:
    for nombre, n in MESES.items():
        if re.search(rf"\b{nombre}\b", p):
            anio = re.search(r"\b(20\d\d)\b", p)
            y = int(anio.group(1)) if anio else (hoy.year if n <= hoy.month else hoy.year - 1)
            return f"{y}-{n:02d}"
    if re.search(r"este mes|mes actual|mes en curso", p):
        return f"{hoy.year}-{hoy.month:02d}"
    return None


def detectar(pregunta: str, hoy: date | None = None) -> list[dict]:
    """Temas de la pregunta, en el orden en que aparecen, cada uno con su lugar en el dashboard y su visual."""
    hoy = hoy or date.today()
    p = _plano(pregunta)
    if not p.strip() or (re.match(NO_DATOS, p) and len(p.split()) <= 4):
        return []
    original = str(pregunta or "")
    emp, mes = _empresa(p), _mes(p, hoy)
    hallados = []
    for tema, patron in TEMAS:
        m = re.search(patron, p)
        if tema == "abc" and not m:
            m = re.search(r"\b[ABC][XYZ]\b", original)           # códigos de segmento en mayúsculas
        if m:
            hallados.append((m.start(), tema))
    hallados.sort()
    temas = []
    for _, tema in hallados:
        t = {"tema": tema, "control": None, "visual": "", "lugar": None}
        if tema == "gerencia":
            t["visual"] = "tablero_ejecutivo" + (f" con empresa {emp}" if emp else "")
            t["control"] = {"pestana": "panel", "ventas": {"empresa": emp or "ALL", "mes": f"{hoy.year}-{hoy.month:02d}"}}
            t["lugar"] = "Ventas por mes (Panel de control)"
        elif tema == "ventas":
            v = {k: x for k, x in (("empresa", emp), ("mes", mes)) if x}
            if re.search(r"canal|reparto|tienda|e-?commerce", p):
                v["vista"] = "canal"
            t["control"] = {"pestana": "panel", "ventas": v} if v else {"pestana": "panel"}
            t["visual"] = "mostrar_kpis con meta y estado (venta vs cuota), o un gráfico de línea/barras si pide evolución"
            t["lugar"] = "Ventas por mes (Panel de control)"
        elif tema == "compras":
            c = {"empresa": emp} if emp else {}
            if mes:
                c.update({"desde": mes, "hasta": mes})
            t["control"] = {"pestana": "panel", "compras": c} if c else {"pestana": "panel", "compras": {"empresa": "ALL"}}
            t["visual"] = "mostrar_kpis (compras, ventas, compra ÷ venta) o un gráfico de barras compra vs venta"
            t["lugar"] = "Compras, ventas e inventario (Panel de control)"
        elif tema == "abc":
            seg = re.search(r"\b([ABC][XYZ])\b", original)
            concepto = re.search(r"politica|que (es|significa)|como se (clasifica|calcula)|explica(me)? (el|la|que)|para que sirve", p) and not seg_en(original)
            ctrl = {"pestana": "politica"} if concepto else {"pestana": "panel"}
            if emp:
                ctrl["empresa_abc"] = "all" if emp == "ALL" else emp
            if seg:
                ctrl["abc_segmento"] = seg.group(1).upper()
            t["control"] = ctrl
            t["visual"] = "mostrar_comparativa o un mapa de calor/barras por segmento"
            t["lugar"] = LUGAR[ctrl["pestana"]]
        elif tema == "almacen":
            ctrl = {"pestana": "almacen"}
            alm = re.search(r"\b(001|012|013|020)\b", p)
            if alm:
                ctrl["croquis_almacen"] = alm.group(1)
            t["control"] = ctrl
            t["visual"] = "mostrar_kpis (ocupación vs 85 %) o barras horizontales por almacén; mostrar_alertas si alguno está por llenarse"
            t["lugar"] = LUGAR["almacen"]
        elif tema == "conteo":
            ctrl = {"pestana": "conteo"}
            proc = re.search(r"\b(\d{4})\b", p)
            if proc and not re.match(r"20\d\d", proc.group(1)):
                ctrl["conteo_proceso"] = proc.group(1)
            t["control"] = ctrl
            t["visual"] = "mostrar_kpis (exactitud vs 97 %, diferencia neta) o barras horizontales por proceso/proveedor"
            t["lugar"] = LUGAR["conteo"]
        elif tema == "seguimiento":
            t["control"] = {"pestana": "seguimiento"}
            t["visual"] = "barras horizontales o una tabla corta de proveedores"
            t["lugar"] = LUGAR["seguimiento"]
        elif tema == "calculo":
            t["visual"] = "mostrar_alertas o barras horizontales (obsoleto, días de inventario), mostrar_kpis para un cálculo (descuento, compra sugerida)"
        elif tema == "producto":
            t["visual"] = "mostrar_ficha del producto"
        temas.append(t)
    # quita repetidos conservando el orden
    vistos, unicos = set(), []
    for t in temas:
        if t["tema"] not in vistos:
            vistos.add(t["tema"])
            unicos.append(t)
    return unicos


def seg_en(texto: str) -> bool:
    """¿Menciona un segmento concreto (AX…CZ, en mayúsculas)?"""
    return bool(re.search(r"\b[ABC][XYZ]\b", str(texto or "")))


def principal(temas: list[dict]) -> dict | None:
    """El tema que manda el movimiento: el primero que tiene lugar en el dashboard."""
    return next((t for t in temas if t.get("control")), None)


def guia(temas: list[dict]) -> str | None:
    if not temas:
        return None
    lineas = ["[Guía del sistema para este mensaje; el usuario no la ve. Si el mensaje no pide datos, ignórala.]",
              "- Muestra lo que respondas con bloques, no solo con texto: " +
              "; ".join(f"{t['tema']} → {t['visual']}" for t in temas if t["visual"]) + "."]
    p = principal(temas)
    if p:
        lineas.append(f"- Lleva el dashboard a lo que preguntó ({p['lugar']}) con controlar_dashboard, por ejemplo "
                      f"{json.dumps(p['control'], ensure_ascii=False)}; ajusta empresa, mes o periodo a lo que pide. "
                      "Si el estado actual ya muestra eso, no lo muevas. Un solo movimiento: el del tema principal.")
    else:
        lineas.append("- Esto no tiene una sección propia en el dashboard: no lo muevas; responde con los bloques en el chat.")
    return "\n".join(lineas)


def _ya_esta(control: dict, contexto: dict | None) -> bool:
    """El dashboard ya muestra lo que pide el control (misma pestaña y nada más fino que cambiar)."""
    ctx = contexto or {}
    if PESTANA_COD.get(control.get("pestana")) != (ctx.get("pestana") or "pn"):
        return False
    finos = {k: v for k, v in control.items() if k != "pestana"}
    if not finos:
        return True
    if set(finos) == {"ventas"} and isinstance(finos["ventas"], dict):
        vn = ctx.get("ventas") or {}
        return all(vn.get(k) == v for k, v in finos["ventas"].items())
    if set(finos) == {"compras"} and isinstance(finos["compras"], dict):
        cv = ctx.get("compras") or {}
        return all(cv.get(k) == v for k, v in finos["compras"].items())
    return False


PIDE_DETALLE = r"explica|detall|a fondo|por que|porque|analiza|informe|reporte|paso a paso|todo sobre"
TOPE_PALABRAS, TOPE_DETALLE = 75, 160


def palabras(texto: str) -> int:
    return len(re.sub(r"\[\[\s*#?\d+\s*\]\]", " ", str(texto or "")).split())


def faltantes(temas: list[dict], bloques: list[dict], accion: dict, contexto: dict | None,
              texto: str = "", pregunta: str = "") -> dict | None:
    """Qué le faltó a la respuesta. None si está completa; si no, {'texto': aviso, 'rehacer': bool}.
    rehacer=True: el texto anterior se descarta y escribe uno nuevo, armado junto a los bloques
    (falta un bloque visual o el texto es demasiado largo). Si solo faltó mover el dashboard, se
    conserva el texto y solo se pide la herramienta."""
    if not temas:
        return None
    rehacer, falta = [], []
    if not any(b.get("type") in VISUALES for b in bloques or []):
        rehacer.append("no mostraste ningún bloque visual: muestra las cifras clave con " +
                       " o ".join(t["visual"] for t in temas[:2] if t["visual"]))
    tope = TOPE_DETALLE if re.search(PIDE_DETALLE, _plano(pregunta)) else TOPE_PALABRAS
    n = palabras(texto)
    if n > tope:
        rehacer.append(f"tu texto es demasiado largo ({n} palabras; máximo {tope}): no recites lo que ya muestran los bloques")
    p = principal(temas)
    movio = any(k for k in (accion or {}) if k not in ("descripcion",))
    if p and not movio and not _ya_esta(p["control"], contexto):
        falta.append(f"no llevaste el dashboard a lo que preguntó: usa controlar_dashboard con "
                     f"{json.dumps(p['control'], ensure_ascii=False)} (ajustado a lo que pide)")
    if not rehacer and not falta:
        return None
    if rehacer:
        return {"rehacer": True, "texto": (
            "[Nota del sistema, el usuario no la ve: rehaz tu respuesta: " + "; ".join(rehacer + falta) + ". "
            "Tu texto anterior se DESCARTA y el usuario no lo verá. Primero las herramientas que falten (sin repetir bloques que ya "
            "mostraste: los que sirvan siguen ahí con su número). Después escribe el texto nuevo y completo, corto y armado con los bloques: "
            "el titular en una frase, cada bloque en su sitio con [[#n]] sola en una línea, y debajo como mucho una o dos líneas de "
            "por qué y qué hacer.]")}
    return {"rehacer": False, "texto": (
        "[Nota del sistema, el usuario no la ve: " + "; ".join(falta) + ". Hazlo ahora con la herramienta. "
        "No escribas texto nuevo: tu respuesta ya está bien.]")}
