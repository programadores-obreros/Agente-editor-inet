// Ubicación del proyecto de vista física — Fase 2, Slice 2 (§3.1 del diseño,
// PHASE_2_SLICE_2_DESIGN.md, "Módulo compartido"): `directorioDeDatos` e
// `ID_PROYECTO_DEFAULT` vivían en `opencode/tool/vista-fisica.ts` (Slice 1, W4) — se
// mudan ACÁ porque Slice 2 suma una SEGUNDA tool (`opencode/tool/proyecto-fisico.ts`)
// que necesita exactamente el mismo criterio de directorio/idProyecto por defecto, y
// "los tools no se importan entre sí" (mismo criterio ya documentado en
// `vista-fisica.ts::abrirEnNavegador`, "cuatro copias de seis líneas es más barato que
// inventar una capa de infraestructura para esto" — acá, en cambio, SÍ vale la pena un
// módulo compartido: no son seis líneas cosméticas, son la clave de aislamiento por
// carpeta de trabajo que el candado de `servicio-con-vista.ts` depende en que las DOS
// tools calculen IGUAL, byte a byte, para terminar en el MISMO singleton).
//
// `opencode/tool/vista-fisica.ts` reexporta ambos nombres tal cual (comportamiento
// idéntico, mismos tests) — nunca duplica esta lógica.

import { join } from "node:path"

/**
 * Directorio de DATOS de la vista física para una carpeta de trabajo activa
 * (`ctx.directory`) — decisión registrada (Phase 2 Slice 1, briefing tarea 2, "decidí
 * algo razonable y documentalo").
 *
 * Se eligió un subdirectorio OCULTO DENTRO de la carpeta de trabajo activa
 * (`<ctx.directory>/.tecnia-vista-fisica/`), en vez de:
 * - `~/.config/opencode/` (lo que usan `memoria.ts`/`perfil.ts`/`clave.ts`): esos
 *   archivos son datos de LA MÁQUINA/persona (progreso pedagógico, perfil), no de
 *   un proyecto puntual — mezclar un `<idProyecto>.json` del motor ahí adentro
 *   rompería esa separación a propósito documentada en `memoria.ts`.
 * - Escribir `<idProyecto>.json` suelto en la raíz visible de `ctx.directory`:
 *   `crearAlmacen` (`nucleo/almacen.ts`) escribe el archivo DENTRO del
 *   `directorio` que se le pasa, tal cual — sin este subdirectorio, el archivo
 *   del motor quedaría mezclado con los sketches/fichas del alumno en la misma
 *   carpeta visible.
 *
 * Aislado por CARPETA DE TRABAJO (no por máquina ni por proceso): abrir Tecnia
 * Bot en dos carpetas de proyecto distintas da dos vistas físicas
 * independientes — mismo criterio "un directorio, un estado" que ya usa
 * `InstanceState` del host (informe ARCH-A, §1) y que la propia
 * `composicion-raiz.ts` documenta como su convención de aislamiento.
 *
 * Fase 2, Slice 2: la tool `proyecto-fisico` usa esta MISMA función (nunca una
 * copia) — así, para la misma carpeta de trabajo, las dos tools calculan el MISMO
 * directorio de datos y comparten el MISMO singleton/candado de
 * `servicio-con-vista.ts` (§3.1 del diseño).
 */
export function directorioDeDatos(directorioActivo: string): string {
  return join(directorioActivo, ".tecnia-vista-fisica")
}

/** Un único proyecto de vista física por carpeta de trabajo — el slice 1 no pide
 * multi-proyecto por carpeta; `idProyecto` queda como argumento opcional para no
 * cerrar esa puerta más adelante. Reusado tal cual por `proyecto-fisico` (Slice 2). */
export const ID_PROYECTO_DEFAULT = "activo"
