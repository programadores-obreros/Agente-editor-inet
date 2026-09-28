## Demo

Launcher de desarrollo: `scripts/vista-fisica-demo.mjs`. Usa la MISMA raíz de
composición (`opencode/servidor/servicio-con-vista.ts`) y el MISMO servidor HTTP+SSE
(`opencode/servidor/servidor-proyecto.ts`) que la tool de OpenCode
(`opencode/tool/vista-fisica.ts`) y el navegador — no es un segundo motor.

### Levantar la demo interactiva

```
node scripts/vista-fisica-demo.mjs --dir /tmp/tecnia-vista-fisica-demo
```

(o con la variable de entorno: `TECNIA_VISTA_FISICA_DIR=/tmp/tecnia-vista-fisica-demo node scripts/vista-fisica-demo.mjs`)

- `--dir <directorio>` es OBLIGATORIO — nunca hay un default dentro del repo. Usar un
  directorio fuera del working tree (ej. un subdirectorio de `/tmp` o de
  `os.tmpdir()`), nunca una carpeta versionada.
- Si el proyecto (`demo.json`) todavía no existe en ese directorio, el launcher lo
  siembra con ESP32 + LED (ánodo en GPIO4) por OPERACIONES REALES del Engine
  (`SetPlaca`/`AgregarComponente`/`AsignarPin`) — nunca escribiendo el JSON a mano.
- Corriéndolo de nuevo sobre el MISMO directorio hace un reload real (releyendo el
  Almacén persistido): no vuelve a sembrar si el proyecto ya tiene placa.
- `--id-proyecto <id>` es opcional (default `"demo"`), para tener varios proyectos de
  prueba en el mismo directorio.
- El proceso imprime la URL (`Vista física — http://127.0.0.1:<puerto>/`) y queda
  escuchando: abrir esa URL en el navegador.

### Cerrarla

`Ctrl+C` en la terminal donde corre (o `SIGTERM`/`SIGINT` al proceso) — cierra el
servidor HTTP+SSE (todas las conexiones abiertas) y el servicio, liberando el puerto,
antes de salir con código 0.

### Modo `--una-vez` (para tests/CI)

```
node scripts/vista-fisica-demo.mjs --dir /tmp/tecnia-vista-fisica-demo --una-vez
```

Imprime la URL y el `Snapshot` completo (JSON, incluida la vista física) por stdout, y
cierra el servidor y el servicio inmediatamente después — sin quedarse escuchando.
Salida real capturada como evidencia en
`.../scratchpad/phase2/evidencia/W4/03-demo-una-vez.txt`.
