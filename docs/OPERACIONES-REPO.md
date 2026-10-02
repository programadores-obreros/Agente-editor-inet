# Operaciones del repo (publicar versión, PRs encadenadas)

## Publicar una versión

El procedimiento completo está en [`docs/publicar-release.md`](docs/publicar-release.md):
qué número le toca, los cuatro archivos que se tocan y por qué los demás no, y las dos
trampas —que el tag va sobre el commit de merge y **pegado** a él, y que las notas del
release son lo que termina leyendo el docente en el sitio público—.

Las otras dos puntas: [`docs/prueba-rc.md`](docs/prueba-rc.md) para probar el `.exe` en
una notebook real antes de publicar, y [`docs/rollback.md`](docs/rollback.md) para
cuando ya salió y salió mal.

**No pegues las notas a mano.** El workflow las saca del `CHANGELOG` con
`scripts/notas-release.mjs` y **falla si no encuentra la sección de esa versión**: hasta
la 0.4.1 todos los releases salieron con el cuerpo vacío, y el sitio público lee de ahí.


## PRs encadenadas: no borres ramas hasta que toda la cadena esté mergeada

`gh pr merge <n> --merge --delete-branch` en una cadena apilada **cierra automáticamente
las PRs que tienen esa rama como base**. No las reapunta: las cierra. Y una PR cerrada no
se repara — no se puede reabrir porque la base no existe, y no se puede cambiar la base
porque está cerrada.

Las ramas y sus commits sobreviven; lo que se pierde es el hilo de revisión.

**El flujo correcto:** mergear **sin** `--delete-branch`, reapuntar la siguiente con
`gh pr edit <n> --base main` mientras la rama base todavía exista, mergear, y **recién al
final** borrar todas las ramas.
