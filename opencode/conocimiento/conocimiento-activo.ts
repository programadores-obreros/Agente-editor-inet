// El ComponentKnowledge del runtime — construido UNA vez sobre la MISMA instancia del
// catálogo que usa la raíz de composición (`nucleo/catalogo-activo.ts`, F1). Las tools y
// el agente obtienen conocimiento de acá, nunca de la vista (D-01, condición 3).

import { CATALOGO_ACTIVO } from "../nucleo/catalogo-activo.ts"
import { crearConocimiento, type ComponentKnowledge } from "./conocimiento.ts"

export const CONOCIMIENTO_ACTIVO: ComponentKnowledge = crearConocimiento(CATALOGO_ACTIVO)
