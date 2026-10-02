---
paths:
  - "odd/**"
---

## `odd/` es andamio, no producto — POLÍTICA

Cuando un trabajo es sustancial (varios pasos coordinados, o progreso que valdría la
pena recuperar si se corta la sesión), se crea un documento de seguimiento en
`odd/tasks/<nombre-del-trabajo>.md` con el objetivo, el alcance autorizado, la lista de
tareas, la verificación de cada una y el próximo paso.

**Ese documento NO se commitea.** Está en `.gitignore` a propósito.

Por qué: es andamio del proceso, no producto. Lo que tiene que sobrevivir del trabajo es
**el código, sus tests y el mensaje del commit** — y por eso los mensajes de commit de
este repo son largos y cuentan el porqué, el incidente que originó el cambio y qué quedó
sin verificar. Esa es la memoria que se lee dentro de seis meses; un tablero de tareas a
medio tachar, no.

La copia de recuperación del documento va a Engram bajo el topic `odd/<nombre>/tasks`,
que es lo que permite retomar después de una interrupción sin depender del working tree.

**Esta decisión ya está tomada. No la vuelvas a discutir cada sesión.** Si alguna vez hay
que cambiarla, se cambia acá, con el motivo escrito al lado.

**Y una advertencia sobre este documento en particular, aprendida rompiéndola:** es la
única regla del repo **sin guardián**. El bloque de seguridad tiene un job de CI, el
frontmatter YAML tiene otro, los tests se verifican por mutación, el `.iss` se compila en
CI. Éste depende de que alguien se acuerde — y en la v0.4.1 se quedó dos días atrás
mientras el trabajo seguía, con tareas ya mergeadas sin tildar.

**Un documento de recuperación que miente sobre el estado es peor que no tenerlo**: quien
lo lea para retomar arranca en el pasado. Dos consecuencias prácticas:

- Cuando el trabajo se vuelve reactivo y aparecen tareas que no están en la checklist,
  **agregalas antes de hacerlas**. Si no hay nada que tildar, el documento se muere solo.
- **Cerralo explícitamente** cuando el trabajo termina, con el estado final y los commits.
  Un documento abierto para siempre es indistinguible de uno abandonado.
- Si vas a dejar de mantenerlo a propósito (pasa, y a veces está bien), **decilo en el
  chat**. Soltarlo en silencio es lo único que no se puede hacer.
