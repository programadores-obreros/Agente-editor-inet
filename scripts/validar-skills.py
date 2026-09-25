#!/usr/bin/env python3
"""Valida el frontmatter de opencode/skills/*/SKILL.md.

El frontmatter no es decoracion: `description` es LA CLAVE DE RUTEO que decide si
OpenCode carga la skill. Si el YAML no parsea, la skill no se carga y el bot no avisa
nada -- el docente ve un producto que simplemente no sabe algo que deberia saber.

POR QUE ESTE ARCHIVO EXISTE
---------------------------
La logica vivia INLINE en .github/workflows/ci.yml, asi que solo corria en el runner.
Consecuencia medida el 2026-09-25: `pnpm test` dio 607 tests en verde con un skill
inservible (la `description` de archify tenia un `: ` sin comillas, que en YAML abre un
mapping en vez de ser texto). El PR lo cazo; la maquina de desarrollo, no.

Y era el UNICO de los tres chequeos fuera del patron que el repo ya usaba:

    scripts/fichas-manifest.mjs      -> pnpm fichas:check      OK local
    scripts/seguridad-proyectos.mjs  -> node scripts/...        OK local
    python inline en ci.yml          -> SOLO en el runner       <- este

Asi que esto no es una mejora nueva: es poner en la fila al que se habia salido.

POR QUE PyYAML Y NO js-yaml -- NO LO "SIMPLIFIQUES" A NODE
----------------------------------------------------------
Tiene que quedar clarisimo porque es contraintuitivo: el repo es JavaScript, hay un
`node` a mano, y pasar esto a js-yaml parece obviamente mejor. NO LO ES.

El hallazgo que motivo todo esto fue que un parser YAML **estandar** rechaza la skill.
Si se valida con otro parser, se esta midiendo un parser distinto del que provoco el
hallazgo, y el chequeo deja de responder la pregunta que importa.

PyYAML es estricto. Pasar PyYAML implica pasar cualquier parser mas permisivo, asi que
el error queda del lado seguro: se puede rechazar algo que otro parser aceptaria, pero
nunca aprobar algo que un parser estandar rompe. Al reves -validar con el permisivo- se
aprueba lo que en produccion no carga, que es exactamente el modo de falla que ya paso
dos veces (`educabot` y `librerias`, auditoria v0.4.1).

Una dependencia de Python en un repo de JS es un precio chico al lado de eso.
"""

import glob
import os
import re
import sys

import yaml

PATRON_FRONTMATTER = re.compile(r"^---\n(.*?)\n---", re.S)

# El glob es relativo al repo, no al cwd: `pnpm skills:check` corre desde la raiz, pero
# nada garantiza que el proximo llamador tambien. Un glob que no matchea nada haria que
# este script diga OK sobre cero archivos -- ver el chequeo del final.
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATRON_RUTAS = os.path.join(RAIZ, "opencode", "skills", "*", "SKILL.md")

# En Actions los errores se emiten con la sintaxis de anotaciones para que aparezcan
# sobre la linea exacta del archivo en el diff del PR. Fuera de Actions eso es ruido
# ilegible, y el objetivo de extraer este script era justamente que se pueda leer local.
EN_ACTIONS = bool(os.environ.get("GITHUB_ACTIONS"))


def error(ruta, mensaje):
    relativa = os.path.relpath(ruta, RAIZ)
    if EN_ACTIONS:
        print(f"::error file={relativa}::{mensaje}")
        return
    print(f"  [X] {relativa}: {mensaje}")


def main():
    rutas = sorted(glob.glob(PATRON_RUTAS))
    rotas = 0

    for ruta in rutas:
        texto = open(ruta, encoding="utf-8").read()
        match = PATRON_FRONTMATTER.match(texto)
        if not match:
            rotas += 1
            error(ruta, "no tiene bloque frontmatter '---'")
            continue

        try:
            datos = yaml.safe_load(match.group(1))
        except yaml.YAMLError as e:
            rotas += 1
            # Solo la primera linea: PyYAML incluye el fragmento con el caret, util en
            # consola pero ilegible dentro de una anotacion de Actions.
            error(ruta, f"YAML invalido en el frontmatter: {str(e).splitlines()[0]}")
            continue

        directorio = os.path.basename(os.path.dirname(ruta))
        nombre = datos.get("name") if isinstance(datos, dict) else None
        if nombre != directorio:
            rotas += 1
            error(ruta, f"name '{nombre}' no coincide con el directorio '{directorio}'")

        descripcion = datos.get("description") if isinstance(datos, dict) else None
        if not descripcion or not isinstance(descripcion, str):
            rotas += 1
            error(ruta, "falta description (o no es texto)")
        elif "\n" in descripcion:
            rotas += 1
            error(ruta, "description ocupa mas de una linea")

    # UN OK SOBRE CERO ARCHIVOS ES UN OK FALSO, y esto no estaba en la version inline.
    # Si alguien mueve el directorio de skills, cambia el glob o corre el script desde
    # otro lado, la version anterior imprimia "OK: 0 SKILL.md con frontmatter valido" y
    # salia con 0. Un guard que no encuentra nada que validar no esta pasando: no esta
    # midiendo. Es la regla del repo -- un OK falso es peor que un error.
    if not rutas:
        print(f"ERROR: no encontre ningun SKILL.md en {PATRON_RUTAS}")
        print("       Un guard que no mide nada no puede reportar OK.")
        return 1

    if rotas:
        if EN_ACTIONS:
            print(f"::error::{rotas} skill(s) con frontmatter roto")
        print(f"\n{rotas} de {len(rutas)} skill(s) con frontmatter roto")
        return 1

    print(f"OK: {len(rutas)} SKILL.md con frontmatter valido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
