---
name: validacion-vm-windows
description: Workflow de validación "VM primero" para cambios de instalador — reproducir en la VM win10 con el .exe real antes de tocar la notebook real, puente virsh+schtasks, ISCC dentro de la VM, precondiciones de medición. Usar antes de dar por probado cualquier cambio en installer/ o install/*.ps1.
---

# Validación en VM Windows antes de tocar la notebook real

Cuándo usar: todo cambio de instalador (`installer/*.iss`, `install/*.ps1`) se
reproduce acá **antes** de probarlo en la notebook real.

## Pasos

1. **Commiteá antes de mutar.** Si vas a mutation-test algo en el camino, necesitás un
   commit previo para poder restaurar sin depender de la casualidad.
2. **Preparar la VM**: snapshot conocido, puente `virsh` + `schtasks` levantado. Si vas
   a probar algo "por usuario" (Scoop, `env_add_path`, `HKCU:`), usá
   `schtasks /ru <usuario> /it` — exige sesión interactiva; sin nadie logueado la tarea
   no corre.
3. **Compilá el `.iss` con ISCC dentro de la VM** (o en el job Windows de CI) — nunca
   confíes en que un `.iss` sintácticamente válido en Linux vaya a compilar igual; los
   tres caracteres de `.claude/rules/installer-iss.md` no se ven sin construir el
   `.exe`.
4. **Verificá cada precondición antes de medir** (ver
   `.claude/rules/vm-windows-precondiciones.md`): lo que empujaste sigue ahí, el caché
   está limpio, estás en el perfil correcto, el estado inicial es el que creés, el
   usuario puede escribir donde le pedís.
5. **Cerrá la VM con `virsh shutdown`, nunca `virsh destroy`** si necesitás que las
   escrituras queden flusheadas.
6. **Sólo después de la VM en verde**, probá en la notebook real con el `.exe` real
   (ver `docs/prueba-rc.md`) antes de publicar.

## Qué NO hacer

- No publiques un cambio de instalador que sólo se compiló, nunca se corrió.
- No uses `virsh destroy` para cerrar si necesitás los datos escritos.
- Excepción: un validador fail-closed (whitelist que sólo rechaza) sí se puede agregar
  sin pasar por la VM — el peor caso es rechazar algo válido.

## Anexo — tabla completa "¿el instrumento mintió?"

### Antes de reportar: ¿el instrumento mintió?

En una sola tanda de trabajo, siete mediciones dieron un resultado falso **y ninguna era
el producto**:

| Lo que medí | Lo que estaba midiendo en realidad |
|---|---|
| `cmd \| tail; echo $?` | el exit code del `tail`, no el del comando |
| `/^X$/.test("X\n")` | creí que `$` matchea antes de un newline final — eso es Python, no JS |
| `HKCU:` y `%LOCALAPPDATA%` por `guest-exec` | el perfil de SYSTEM, no el del usuario |
| la hora de la VM "4 h atrasada" | diferencia de ZONA HORARIA; en UTC coincidían con 2 s |
| `schtasks /run` + `sleep` | la tarea devolvió `0x800710E0` y **no corrió**; medí un estado que nunca se creó |
| polling propio con TIMEOUT | la tarea había terminado bien; el roto era mi parser |
| `Test-Path auth.json` | el archivo debe seguir existiendo: lo correcto es mirar si quedó el bloque `google` |

Las dos primeras casi me hacen borrar un guard que funcionaba; la última, reportar un bug
de privacidad inexistente.

**Reglas concretas que salen de ahí:**

- **Exit codes sin pipe.** `cmd > /dev/null; echo $?`, nunca `cmd | algo; echo $?`.
- **Nunca `sleep` a ciegas en la VM.** El `.cmd` escribe un centinela como última línea y
  se espera ESE archivo. Y después se verifica el estado esperado **antes** de medir
  comportamiento.
- **Verificá QUÉ build estás probando** antes de sacar conclusiones: marca única en el
  código + leerla en el artefacto instalado.
- **El assert tiene que medir el mundo, no el reporte del mundo.** Si un script dice
  "borré", mirá el disco; si dice "reparé", mirá el conteo antes y después.
