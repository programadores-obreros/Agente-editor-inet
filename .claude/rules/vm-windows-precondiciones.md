---
paths:
  - "installer/**"
  - "install/*.ps1"
  - "install/*.sh"
---

# Precondiciones de medición en VM Windows / instalador

**Commitear ANTES de mutar.**

Mutar es romper archivos a propósito y después restaurarlos. Eso exige que exista de
dónde restaurar.

**Sin un commit previo, la herramienta de restauración y la de destrucción son
exactamente la misma.** El 2026-09-25, mutando dos archivos que todavía no estaban
commiteados, un `git checkout -- install/bootstrap.ps1 install/diagnostico.ps1` para
"limpiar la mutación" borró dos tareas enteras: la sección de Node del diagnóstico y el
aviso del bootstrap.

Y la segunda mitad, que es la que importa más: **lo salvó una copia en `/tmp` dejada por
casualidad** minutos antes. Un plan de recuperación que depende de una casualidad no es
un plan. Si esa copia no estaba, se perdían el validador extraído y el guard cruzado,
enteros.

Después de recuperar, el orden correcto fue: commitear primero, mutar después. Ahí
`git checkout` volvió a ser lo que uno cree que es — una herramienta segura.

**Antes de medir en la VM, enumerá CADA precondición y verificala** (no "debería
estar" — `Test-Path`, y que se vea en la salida):

- **Lo que empujaste a la VM sigue ahí.** Un `snapshot-revert` se lo lleva todo.
  `virsh destroy` es un corte de energía (escrituras sin flushear se pierden); para
  cerrar, `virsh shutdown`.
- **El caché está limpio.** Un chequeo con caché contesta `cache-valid` y no prueba
  nada.
- **Estás en el perfil correcto.** El puente `guest-exec` corre como **SYSTEM**. Si lo
  que se prueba es "por usuario" (Scoop, `env_add_path`, `HKCU:`), medir como SYSTEM no
  prueba nada del usuario: correlo con `schtasks /ru <usuario> /it`, que exige sesión
  interactiva (sin nadie logueado, `schtasks /query` dice
  `Último tiempo de ejecución: 30/11/1999`).
- **El estado inicial es el que creés.** Si se prueba una instalación, que lo instalado
  NO esté antes.
- **El usuario puede escribir donde le pedís.** Una cuenta sin elevar no puede escribir
  en `C:\` aunque esté en Administradores.
- **Lo que vas a descartar es descartable.** Antes de `git checkout`/`restore`/`clean`,
  mirá el diff.

El número de artefactos cazados no es la métrica — lo que hay que minimizar es
HALLAZGOS FALSOS REPORTADOS (ver doctrina general en `CLAUDE.md`).

## Lo que no se toca sin poder probarlo

`installer/` es Inno Setup y PowerShell: no se puede verificar desde Linux. Un cambio
ahí se commitea con lo que sí se comprobó (sintaxis, balance de bloques, tests que leen
el `.iss`) y **queda retenido hasta probarlo en la VM win10 con el `.exe` real**. Nunca
se publica un cambio de instalador que nadie vio funcionar.

Excepción acotada: un validador **fail-closed** (whitelist que sólo puede rechazar
entrada, nunca ejecuta algo distinto) sí se puede agregar sin poder probarlo en la
plataforma destino — el peor caso es rechazar algo válido. Un "arreglo" que cambia lo
que se ejecuta, no.

## Nota de scope (`paths:`), sin cambiarlo

El principio general "commiteá antes de mutar" también aplica al mutation-testing de
`tests/*.test.mjs` (ver `CLAUDE.md` → Invariantes), no sólo a `installer/`/`install/*`.
Con el `paths:` actual, esta rule **no carga** al mutar archivos bajo `tests/` — queda
registrado acá como nota, no como cambio de scope.
