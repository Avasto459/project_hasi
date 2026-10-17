import { createClient, type Client } from "@libsql/client"
import { existsSync, copyFileSync } from "node:fs"

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
  // USE_LOCAL_DB разрешён в любой среде, включая Vercel — так committed
  // data/hasi.db (закоммичен через git add -f) можно читать на продакшене.
  return process.env.USE_LOCAL_DB === "true"
}

function createDb(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  const token = process.env.TURSO_AUTH_TOKEN?.trim()
  const forceLocal = process.env.USE_LOCAL_DB === "true"

  // Локальный файловый SQLite при USE_LOCAL_DB=true (в т.ч. на Vercel,
  // где data/hasi.db закоммичен в git). На Vercel ФС только для чтения,
  // поэтому копируем committed базу в /tmp и открываем writable копию.
  if (forceLocal) {
    let dbPath = "file:data/hasi.db"
    if (isVercel()) {
      const src = "data/hasi.db"
      const dst = "/tmp/hasi.db"
      try {
        if (existsSync(src)) copyFileSync(src, dst)
        dbPath = `file:${dst}`
      } catch {
        // Если копия не удалась, пробуем открыть оригинал.
        dbPath = "file:data/hasi.db"
      }
    }
    return createClient({ url: dbPath })
  }

  // На Vercel — Turso, если заданы; иначе память (пусто, без товаров).
  if (isVercel()) {
    if (url && token) {
      return createClient({ url, authToken: token })
    }
    // Безопасный fallback для сборки, когда Turso ещё не заданы — не падаем.
    return createClient({ url: ":memory:" })
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
