---
paths:
  - "installer/*.iss"
---

# `installer/*.iss`: tres caracteres que ISCC lee como estructura

Costaron tres compilaciones fallidas seguidas, ninguna detectable sin compilar. ISCC lee
estos caracteres como **estructura del archivo, sin mirar si están comentados**:

| No se puede | Error de ISCC |
|---|---|
| Un renglón que **empieza** con `#` (ej. `#13#10` al inicio de línea) | `Unknown preprocessor directive` |
| Un renglón que **empieza** con `[` — incluso dentro de un comentario Pascal | `Invalid section tag` |
| Un **cierre de llave** dentro de un comentario `{ }` (ej. nombrar `{app}` ahí) | `Syntax error` — el comentario cierra en la primera llave |

Poner ese mismo texto a mitad de renglón está bien; lo que rompe es que abra la línea.

**Regla de diseño que sale del mismo archivo**: el `Check` de una entrada de
`[UninstallRun]` se evalúa al INSTALAR, no al desinstalar — Inno graba esas entradas en
el log de desinstalación durante el install. Una decisión que se toma cuando el usuario
aprieta un botón no puede vivir en esa sección; va en `[Code]`, en
`CurUninstallStepChanged`, que sí corre al desinstalar.

El job de Windows del CI compila el `.iss` con ISCC justamente porque nada de esto se ve
sin construir el `.exe`.
