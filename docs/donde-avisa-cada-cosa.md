# Dónde vive cada aviso, y por qué ahí

Tecnia Bot le habla a una docente que está en un aula, con veinte chicos, y que
no tiene a quién preguntarle. Cada vez que algo falla, alguien tiene que
explicárselo en castellano.

La pregunta no es **qué** decirle. Es **quién puede decírselo**, y eso depende de
qué se rompió.

## La regla

> **Un componente sólo puede explicar fallas que ocurren después de que él
> arrancó.** El que se rompió no puede contar que se rompió.

Parece obvia escrita. Nos costó una tarde descubrirla.

El 9 de septiembre de 2026 escribimos una skill (`opencode/skills/errores-del-bot/`)
y un disparador en el prompt del agente para que el bot explicara por qué había
dejado de contestar: cuota agotada, key rechazada, sin red, modelo retirado. Seis
tests, todos verdes.

Después lo probamos con el bot corriendo de verdad. Con la key rota, la docente ve
esto y nada más:

```
> tecnia-bot · gemini-3.5-flash-lite
Error: API key not valid. Please pass a valid API key.
```

Le habíamos pedido **al modelo** que explicara que el modelo estaba muerto. El
error ocurre en la llamada al proveedor, antes de que el modelo genere una sola
palabra. Imposible por construcción, no por descuido.

Y no lo vimos porque **los seis tests eran de contenido**: verificaban que el
archivo dijera lo correcto. Ninguno probaba que alguien llegara a leerlo.

## Las cuatro capas

De afuera hacia adentro. Cada una puede explicar menos cosas que la anterior,
pero con más detalle.

### 1. El lanzador — `installer/abrir-tecnia-bot.cmd`

**Corre siempre**, con modelo o sin modelo, con red o sin red. Es lo único que
funciona cuando no funciona nada.

Le toca lo que impide **arrancar**:

- OpenCode que no está o no corre
- La capa educativa que no está publicada
- La instalación que todavía está en curso
- **La key de Google muerta o sin cuota** (vía `install/chequear-clave.ps1`)

Reglas de esta capa:

- **Avisa, no bloquea.** Nunca puede impedir que el bot abra. Si la comprobación
  se rompe, se la traga y abre igual. Una docente tiene que poder abrir Tecnia
  Bot aunque nuestro chequeo esté roto.
- **Rápida.** Se paga en cada arranque. El chequeo de la key tiene un tope duro de
  6 segundos y ni toca la red en las máquinas sin key (250 ms medidos).
- **Callada cuando no sabe.** Si no se puede llegar a Google, no dice nada: no
  sabemos si la key sirve, y un aviso inútil en cada arranque sin internet es peor
  que el silencio.

### 2. El bot — el prompt del agente y las skills

**Corre sólo si el modelo contesta.** Todo lo que escriba esta capa depende de que
la parte que puede estar rota esté sana.

Le toca lo que pasa **con el bot andando**:

- Errores que reporta una herramienta (`/clave` encontrando la cuota agotada)
- Fallas a mitad de una conversación que ya venía funcionando
- Todo lo pedagógico: errores de compilación, circuitos, hardware

Regla de esta capa: **nunca afirmar lo que no reportó una herramienta.** Está
escrito en `opencode/command/reparar.md` — *"Nunca digas que algo quedó instalado
si el tool no lo dijo"*.

### 3. Los tools — `opencode/tool/*.ts`

Corren cuando el modelo los llama. Son los que **miran de verdad**: leen el disco,
le preguntan a Google, ejecutan `pio`.

Regla: **el alcance viaja en la respuesta, no en el prompt.** Un tool que sólo
miró la versión tiene que decir que sólo miró la versión — el modelo no puede
afirmar sobre algo que la herramienta acaba de decirle que no miró.

### 4. El diagnóstico — `install/diagnostico.ps1`

**Corre aunque no arranque nada**, desde el menú inicio. Es el último recurso, y
el único que ve el cuadro completo: versiones, dependencias, antivirus, disco,
política de ejecución, credenciales, los tres logs.

Regla: **no se imprime ni una credencial**, ni completa ni en parte. Este reporte
viaja por WhatsApp.

## Cómo elegir la capa

| Si la falla impide... | Va en |
|---|---|
| que el bot abra | el lanzador |
| que el modelo conteste | el lanzador |
| compilar, cargar, dibujar | el bot (skill) |
| algo que una herramienta detectó | el tool, y el bot lo cuenta |
| nada, pero hay que entender qué pasó | el diagnóstico |

**La pregunta que hay que hacerse antes de escribir el texto:** *cuando esto
falle, ¿el componente donde lo estoy escribiendo va a estar vivo?*

Si la respuesta es "depende de lo que está roto", está en la capa equivocada.

## Cómo se prueba cada capa

Y acá está la otra mitad de la lección: **un test de contenido no prueba que
alguien lea el mensaje.**

| Capa | Se prueba con |
|---|---|
| Lanzador | Ejecutándolo en la VM con el escenario de falla armado |
| Bot / skills | `opencode run --agent tecnia-bot --command <comando>` en la VM |
| Tools | Tests de node, y la llamada real al servicio cuando hay uno |
| Diagnóstico | Corriéndolo en la VM como el usuario real |

Los tests de texto sobre los `.ps1` y los `.md` sirven —custodian que las copias
no se desincronicen— pero **verifican que el archivo diga lo correcto, no que el
mensaje llegue.** Las dos cosas hacen falta.

`opencode run` es la clave para probar la capa 2 sin manejar la interfaz a mano:

```
opencode run --agent tecnia-bot --command clave
opencode run --agent tecnia-bot "hola, quiero hacer un semaforo"
```

Con `opencode/big-pickle` no hace falta ninguna credencial, así que el bot se
puede probar entero en una VM limpia.

## Una verdad, cuatro copias

La clasificación de los cinco resultados de una key —anda, cuota agotada, no
sirve, modelo retirado, no pude probarla— está repetida en cuatro lugares:

```
opencode/tool/clave.ts        el bot
install/install.ps1           el instalador (Windows)
install/install.sh            el instalador (Linux/Mac)
install/chequear-clave.ps1    el lanzador
```

**Es a propósito.** Ninguno de los `.ps1` hace dot-sourcing de otro: cada script
se copia y corre solo, y un módulo compartido los ataría entre sí.

Lo que mantiene honestas a las copias es `tests/key-instalador.test.mjs`, que las
exige a **todas** y falla nombrando cuál se olvidó. **Una copia nueva que no entre
en esas listas es una copia que se va a desincronizar** — no es una posibilidad,
es cuestión de tiempo.

Y una advertencia ganada a los golpes: ese test verificaba **dónde** aparecían los
tokens de Google, no **qué** devolvía cada rama. La mutación
`if (404) { return "sinProbar" }` pasaba en verde en las cuatro copias, porque
dejaba los tokens en su lugar. **Un test que mira la forma en vez de la propiedad
te da la sensación de red sin la red.**
