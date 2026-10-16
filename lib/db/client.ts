import { createClient, type Client } from "@libsql/client";

declare global {
  var __hasiLibsqlClient: Client | undefined;
}

function createDb(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  const forceLocal = process.env.HASI_LOCAL_DB === "1";

  if (!forceLocal && url && token) {
    return createClient({ url, authToken: token });
  }

  return createClient({ url: "file:data/hasi.db" });
}

export const db = globalThis.__hasiLibsqlClient ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__hasiLibsqlClient = db;
}

export const usingTurso = Boolean(
  process.env.HASI_LOCAL_DB !== "1" && process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim()
);
