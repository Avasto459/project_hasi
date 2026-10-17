import { createClient, type Client } from "@libsql/client"
import { existsSync, copyFileSync } from "node:fs"
import { join } from "node:path"

declare global {
  var __hasiLibsqlClient: Client | undefined
}

// Абсолютный путь к закоммиченной базе: в serverless-бандле Vercel cwd может
// отличаться, поэтому опираемся на process.cwd() (корень проекта, куда
// outputFileTracingIncludes упаковывает ./data/hasi.db).
function bundledDbPath(): string {
  return join(process.cwd(), "data", "hasi.db")
}

function tmpDbPath(): string {
  return "/tmp/hasi.db"
}

// ФС Vercel только для чтения — SQLite нужен writable-файл, поэтому копируем
// закоммиченную базу в /tmp один раз и открываем копию.
function writableFileDb(): Client {
  const src = bundledDbPath()
  const dst = tmpDbPath()
  if (existsSync(dst)) return createClient({ url: `file:${dst}` })
  try {
    if (existsSync(src)) copyFileSync(src, dst)
  } catch {
    // Если копия не удалась (например, локально без прав), пробуем оригинал.
  }
  if (existsSync(dst)) return createClient({ url: `file:${dst}` })
  if (existsSync(src)) return createClient({ url: `file:${src}` })
  throw new Error(`База данных не найдена: ${src}`)
}

function isVercel(): boolean {
  return process.env.VERCEL === "1"
}

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV !== "production" && !isVercel()
}

function isLocalDbAllowed(): boolean {
  // USE_LOCAL_DB разрешён в любой среде, включая Vercel — так committed
  // data/hasi.db (закоммичен в git) читается и на продакшене.
  // Без флага на Vercel тоже читаем bundled-файл (см. createDb).
  return process.env.USE_LOCAL_DB === "true" || isVercel()
}

function createDb(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim()
  const token = process.env.TURSO_AUTH_TOKEN?.trim()
  const forceLocal = process.env.USE_LOCAL_DB === "true"

  // Локальный файловый SQLite при USE_LOCAL_DB=true (в т.ч. на Vercel,
  // где data/hasi.db закоммичен в git и упакован через outputFileTracingIncludes).
  if (forceLocal) return writableFileDb()

  // На Vercel — Turso, если заданы; иначе закоммиченная data/hasi.db.
  // Пустая in-memory база больше не используется: именно она была причиной
  // расхождения (Vercel показывал демо-заглушки вместо 47 актуальных товаров).
  if (isVercel()) {
    if (url && token) {
      return createClient({ url, authToken: token })
    }
    return writableFileDb()
  }

  // Иначе Turso, если заданы.
  if (url && token) {
    return createClient({ url, authToken: token })
  }

  // Локальный прод/дев без Turso — закоммиченный файл, иначе память (только для dev).
  if (existsSync(bundledDbPath()) || existsSync("data/hasi.db")) {
    try {
      return writableFileDb()
    } catch {
      return createClient({ url: "file:data/hasi.db" })
    }
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
