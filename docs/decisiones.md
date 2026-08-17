# Decisiones que conviene poder revisar

Las decisiones que se toman con información incompleta, o que cambian si cambia
el contexto. No están acá para justificarse: están para **que alguien pueda
revisarlas más adelante sabiendo qué se pensó en su momento**.

Cada una dice **cuándo volver a mirarla**. Una decisión sin criterio de revisión
no se revisa nunca — se olvida, y después se cambia por la razón equivocada.

---

## D-01 · Las fichas viajan dentro del instalador

**17 de agosto de 2026 · v0.3.40 · abierta**

### Qué se decidió

Las 17 fichas A4 de Tecnia Lab van **adentro del `.exe`**, en
`opencode/skills/fichas/hojas/`. El docente instala y ya las tiene: no descarga
nada aparte, no necesita internet para imprimirlas, no hay un segundo paso donde
perderse.

### Qué cuesta

El instalador **casi se triplicó**:

| Versión | Peso del `.exe` |
|---|---|
| v0.3.39 | 2,63 MB |
| v0.3.40 | **7,44 MB** |

Son 4,81 MB más, que es lo que ocupan los 17 PDF comprimidos por Inno Setup.

### Por qué se decidió así igual

**El público es una escuela técnica, y ahí el problema no es el ancho de banda:
es que el material nunca llega al aula.** Un docente que tiene que bajar el
instalador *y además* encontrar las fichas *y además* descargarlas, en la
práctica se queda sin fichas.

Siete megas se bajan una vez. Un segundo paso se pierde todas las veces.

### Cuándo volver a mirarla

Cualquiera de estas tres alcanza para reabrirla:

1. **Alguien reporta que la descarga es un problema** — una escuela con conexión
   mala, un docente que abandonó a mitad de la bajada. Un caso real vale más que
   cualquier estimación de acá.
2. **El `.exe` pasa de 10 MB.** Con más fichas o más material, el número crece.
   Diez megas es el umbral donde deja de ser "un ratito" y pasa a ser "después lo
   bajo".
3. **Las fichas empiezan a cambiar más seguido que el bot.** Hoy no: son
   estables. Si pasaran a actualizarse todas las semanas, meterlas en el
   instalador obligaría a publicar una versión del producto por cada corrección
   de una hoja, que no tiene sentido.

### La salida, si hay que sacarlas

Concreta, para no tener que pensarla de nuevo:

1. En `installer/tecnia-bot.iss`, excluir la carpeta del `[Files]`:
   ```
   Source: "..\opencode\*"; DestDir: "{app}\opencode"; \
     Excludes: "skills\fichas\hojas\*"; Flags: recursesubdirs createallsubdirs ignoreversion
   ```
2. Publicar `fichas-tecnialab.zip` como **asset del release**, junto al `.exe`.
3. Que el skill `fichas` deje de apuntar a `hojas/` y ofrezca el link de descarga.
   El `SKILL.md` se genera desde `fichas-tecnialab/src/skill-tecnia-bot.mjs`: el
   cambio va ahí, no a mano.

**Lo que se pierde con eso** es lo que hoy la justifica: el docente sin internet
en el aula deja de tener las hojas. Vale la pena sólo si el costo de la descarga
resultó mayor que el de ese segundo paso — y eso se sabe cuando alguien lo
reporta, no antes.

### Un cabo suelto que no es de peso

Tres de las 17 hojas (02 Sensor Shield, 04 servo, 08 téster) usan **fotos de
catálogo comercial sin licencia documentada**, y ahora están en un repositorio
público bajo GPLv3. Se incluyeron por decisión explícita del dueño del proyecto,
con el riesgo planteado.

**No es la misma discusión que el peso**, pero se resuelve en el mismo lugar: si
alguna vez hay que tocar esas tres, la salida barata es cambiarles la foto por
los dibujos originales, que están preservados en el repo `fichas-tecnialab`.
