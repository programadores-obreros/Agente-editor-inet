# Volver atrás una versión

Escrito **antes** de publicar la v0.3.69, no después de que algo salga mal.
Mañana hay veinte máquinas: si la versión nueva falla, lo que importa es cuánto
se tarda en volver, no de quién fue la culpa.

## La versión a la que se vuelve

| | |
|---|---|
| **Último release confirmado en máquina real** | **v0.3.69** — la instalaron decenas de docentes en la capacitación del 20/08, con un solo problema parcial (PlatformIO en una máquina) |
| Último release publicado antes de esta | v0.3.68 |
| Base de esta versión | commit `f1036d8` |

Ojo con la diferencia: entre la v0.3.63 y la v0.3.68 se publicaron seis
versiones en una madrugada y **ninguna se probó en una notebook de verdad**. Si
hay que volver corriendo, el punto seguro es la **v0.3.62**, no la anterior.

## Qué hacer, en orden

### 1. Que el docente instale la versión vieja (30 segundos)

Es lo primero y casi siempre alcanza. Los releases viejos **no se borran**:

```
https://github.com/programadores-obreros/Agente-editor-inet/releases/tag/v0.3.62
```

Bajar el `.exe` de ahí e instalarlo encima. No hace falta desinstalar nada.

### 2. Sacar la versión rota de "Latest" (2 minutos)

Así el que entra a la página de releases no se lleva la mala:

```bash
gh release edit v0.3.69 --prerelease --latest=false
gh release edit v0.3.62 --latest
```

Esto **no borra** la v0.3.69: la saca de la vidriera. Borrar un release es
irreversible y no hace falta.

### 3. Recién ahí, revertir el código

```bash
git revert --no-edit <sha del commit malo>
git push origin main
```

`revert`, no `reset`: el historial queda contando qué pasó. Un `reset --hard`
sobre `main` publicado le rompe el clon a cualquiera que ya haya bajado.

## Lo que NO hay que hacer

- **No borrar el release viejo.** Es la única salida rápida que tiene el docente.
- **No `git push --force` a `main`.** El repo es público.
- **No desinstalar nada de la máquina del docente para "empezar limpio".** La
  regla del instalador vale también acá: PUEDE FALLAR, PERO NO PUEDE ROMPER.
  Una notebook que andaba quedó sin OpenCode por un `scoop uninstall` puesto con
  buena intención.

## Cómo saber si la nueva está bien, sin esperar a que se queje alguien

CI corre un smoke test de instalación silenciosa en cada tag. Si ese falla, el
`.exe` ni se adjunta al release y no hay nada que revertir:

```bash
gh run list --workflow=build-installer.yml --limit 3
```

Y en una máquina de verdad, lo mínimo:

1. El acceso directo abre y el bot responde.
2. Pedirle una ficha de nombre compuesto: **«dame la de corriente alterna»**.
   Es lo que arregló esta versión — si contesta que no la encuentra, volvió el bug.
3. Pedirle un circuito y confirmar que **no** abre el navegador solo.
4. Menú inicio → "Diagnostico de Tecnia Bot": tiene que dejar el `.txt` y
   decir dónde quedó.
