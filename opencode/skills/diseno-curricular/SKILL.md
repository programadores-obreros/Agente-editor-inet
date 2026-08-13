---
name: diseno-curricular
description: Diseños Curriculares (DC) jurisdiccionales oficiales, provincia por provincia, para el Primer Ciclo de Educación Secundaria Modalidad Técnico Profesional. Para responder con precisión oficial qué se enseña en cada materia/taller, con qué saberes y carga horaria, según el Ministerio de Educación de la provincia correspondiente.
---

# Diseño Curricular — qué es y cómo se usa

**¿Qué es un "DC"?** Un **Diseño Curricular (DC)** es el documento oficial que un Ministerio de Educación provincial publica para definir, materia por materia y año por año, qué se tiene que enseñar en las escuelas de esa jurisdicción: fundamentación, perfil del egresado, estructura curricular, carga horaria, y los contenidos/saberes de cada espacio curricular o taller. No es una guía sugerida ni un libro de texto — es la norma vigente que rige la planificación de cada escuela de esa provincia.

Esta skill le da a Tecnia Bot el contenido real de los Diseños Curriculares que ya cargamos, para que pueda responder preguntas de docentes ("¿qué contenidos tiene Tecnología en 2° año?", "¿cuánta carga horaria tiene el taller de Metal Mecánica?", "¿cuál es el perfil del egresado del Primer Ciclo?") con precisión oficial, citando la provincia y la fuente.

## Provincias cargadas hoy

| Provincia | Nivel / Ciclo / Modalidad | Carpeta |
|---|---|---|
| San Juan | Primer Ciclo de Educación Secundaria, Modalidad Técnico Profesional (Escuelas Técnicas Industriales y Agrotécnicas/Agroindustriales) | `san-juan/` |

Si te preguntan por una provincia que **no** está en esta tabla, decilo con honestidad: "todavía no tengo el diseño curricular de esa provincia cargado" — nunca completes con el DC de otra provincia ni con conocimiento general.

## Cómo usar esta skill

1. **Identificá la provincia** de la que preguntan (o asumí la única cargada si el contexto de la escuela ya la dejó clara en la sesión).
2. Para preguntas **genéricas del ciclo** (fundamentación, marco político-pedagógico, perfil del egresado, propósitos generales, estructura curricular completa, carga horaria total, campos de formación), leé `<provincia>/marco-general.md`.
3. Para preguntas sobre **una materia, taller o espacio curricular puntual**, leé el archivo correspondiente en `<provincia>/espacios/<campo>/<espacio>.md`. Cada archivo trae: perspectiva, propósitos, aprendizajes y contenidos (por año), orientaciones para la enseñanza y orientaciones para la evaluación — tal como los define el propio documento oficial.
4. Si no sabés en qué archivo puntual está el contenido, revisá primero `marco-general.md`: ahí están las tablas de estructura curricular con todos los espacios de esa provincia, organizados por campo de formación y año, y podés inferir el nombre del archivo.

## San Juan — estructura de espacios curriculares

El Primer Ciclo de San Juan organiza los espacios en tres Campos de Formación (ver `san-juan/marco-general.md` para el detalle completo):

- **Formación General** (común a Técnicas Industriales y Agrotécnicas) → `san-juan/espacios/formacion-general/`: Lengua, Lengua Extranjera Inglés, Geografía, Historia, Formación Ética y Ciudadana, Educación Artística (Música/Teatro/Artes Visuales — tres materias distintas de un año cada una), Educación Física.
- **Formación Científico Tecnológica** (común a ambos tipos de escuela, salvo Dibujo Técnico) → `san-juan/espacios/formacion-cientifico-tecnologica/`: Matemática, Tecnología, Biología, Física, Química, Informática, Dibujo Técnico (solo Técnicas Industriales).
- **Formación Técnica Específica** (Formación Pre-Profesional, bajo formato **Taller** — distinto de "materia"/"espacio curricular" disciplinar): dos sub-recorridos según el tipo de escuela, que NO se comparten:
  - `san-juan/espacios/formacion-tecnica-especifica-industrial/` — talleres exclusivos de Escuelas Técnicas Industriales.
  - `san-juan/espacios/formacion-tecnica-especifica-agrotecnica/` — talleres exclusivos de Escuelas Agrotécnicas/Agroindustriales.

**Terminología del propio documento (no la mezcles):**
- **Espacio Curricular**: la unidad organizativa general — "delimita un conjunto de aprendizajes y contenidos... y constituye una unidad autónoma de evaluación y acreditación" (definición literal del DC). Todas las materias y talleres SON Espacios Curriculares.
- **Materia / propuesta disciplinar**: un Espacio Curricular a cargo de un docente con formación específica (Lengua, Matemática, etc. — Formación General y Científico Tecnológica).
- **Taller**: el formato que la Modalidad Técnico Profesional prescribe específicamente para el Campo de la Formación Técnica Específica — "organización centrada en el hacer, que integra el saber, el convivir, el emprender y el ser". No es sinónimo de "materia": el documento los distingue.

## Regla de oro

**Esta skill (y solo esta skill) es la fuente de verdad para preguntas sobre el Diseño Curricular de una provincia ya cargada.** Nunca completes con contenido de otra provincia, con conocimiento general de "lo que suele enseñarse" en esa materia, ni busques en internet — citá siempre lo que el documento oficial dice, tal como está en los archivos de `<provincia>/`. Si un dato puntual no está en el archivo correspondiente, decilo con honestidad en vez de inventarlo: es información curricular oficial de un organismo de gobierno, y de ella depende la planificación real de una escuela.
