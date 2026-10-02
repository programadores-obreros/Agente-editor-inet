---
paths:
  - "opencode/skills/proyectos-inet/proyectos/**"
---

# Seguridad física en los proyectos INET

Todo proyecto de `opencode/skills/proyectos-inet/proyectos/` que tenga **partes
móviles, calor o red eléctrica** lleva el bloque canónico, justo antes de
`## Los niveles`:

```markdown
## Seguridad con <lo que sea> ⚠️
> ⚠️ **SEGURIDAD:** <mecanismo concreto>, <momento de peligro>, <acción que lo evita>.
```

Si el proyecto dispara el detector pero el riesgo **no existe de verdad** (ej. menciona
`Servo.h` sólo dentro de una lista de mitos de librerías), lleva una exención explícita
con motivo:

```markdown
<!-- sin-riesgo-fisico: <por qué no aplica> -->
```

**Una exención sin motivo no cuenta** — sería un silenciador con otro nombre, y el
guard la rechaza. `pnpm seguridad:check` corta el PR si falta alguna de las dos cosas.

El molde de redacción es `11-brazo-robotico.md`: nombra el mecanismo, el momento y la
acción. Nada de "tené cuidado".
