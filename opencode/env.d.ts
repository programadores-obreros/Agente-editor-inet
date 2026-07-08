// Tipos de ambiente para las herramientas de Tecnia Bot.
// Las tools corren dentro del runtime de OpenCode (Bun), que expone un objeto
// global `Bun`. Este archivo declara lo mínimo que usan nuestras tools para que
// TypeScript/el editor no marquen error (el runtime real lo provee OpenCode).

export {}

declare global {
  interface BunFile {
    text(): Promise<string>
    arrayBuffer(): Promise<ArrayBuffer>
  }

  interface BunSpawn {
    readonly exited: Promise<number>
    readonly stdout: ReadableStream<Uint8Array>
    readonly stderr: ReadableStream<Uint8Array>
    readonly exitCode: number | null
  }

  const Bun: {
    /** Escribe un string o el contenido de un BunFile en `path`. */
    write(path: string, data: string | BunFile | ArrayBuffer | Uint8Array): Promise<number>
    /** Referencia perezosa a un archivo (para leerlo o copiarlo). */
    file(path: string): BunFile
    /** Lanza un proceso hijo. */
    spawn(cmd: string[], options?: {
      cwd?: string
      env?: Record<string, string | undefined>
      stdout?: "pipe" | "inherit" | "ignore"
      stderr?: "pipe" | "inherit" | "ignore"
    }): BunSpawn
  }
}
