import { createClient, type Client } from "@libsql/client"

declare global {
  var __hasiLibsqlClient: Client | undefined
}

function isVercel(): boolean {
  return process.env.VERCEL === "1"
}

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV !== "production" && !isVercel()
}

function isLocalDbAllowed(): boolean {
  return process.env.USE_LOCAL_DB === "true" && isLocalDevelopment()
}

function createDb(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  const token = process.env.TURSO_AUTH_TOKEN?.trim()
  const forceLocal = process.env.USE_LOCAL_DB === "true"

  // На Vercel (в т.ч. во время сборки) НИКОГДА не открываем локальный файл file:data/hasi.db.
  if (isVercel()) {
    if (url && token) {
      return createClient({ url, authToken: token })
    }
    // Безопасный fallback для сборки, когда Turso ещё не заданы — не падаем.
    return createClient({ url: ":memory:" })
  }

  // Локально: файловый SQLite только при USE_LOCAL_DB=true.
  if (forceLocal) {
    return createClient({ url: "file:data/hasi.db" })
  }

  // Иначе Turso, если заданы.
  if (url && token) {
    return createClient({ url, authToken: token })
  }

  // Локальная разработка без Turso — в памяти, чтобы не пытаться открыть файл.
  return createClient({ url: ":memory:" })
}

export const db = globalThis.__hasiLibsqlClient ?? createDb()

if (process.env.NODE_ENV !== "production") {
  globalThis.__hasiLibsqlClient = db
}

export const usingTurso = Boolean(
  process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim()
)

export const databaseMode: "file" | "turso" | "memory" =
  isLocalDbAllowed()
    ? "file"
    : usingTurso
      ? "turso"
      : "memory";
