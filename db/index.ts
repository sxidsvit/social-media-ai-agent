import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://placeholder-url';

// One connection pool per server process. Kept on globalThis so dev hot reloads reuse it instead of
// opening a new pool each time (the old ones are never closed, and the database runs out of
// connections). Idle connections close after a while so a quiet server doesn't hold them.
const globalForDb = globalThis as unknown as { postgresClient?: ReturnType<typeof postgres> };

const client = globalForDb.postgresClient ?? postgres(databaseUrl, { prepare: false, max: 10, idle_timeout: 30 });
if (process.env.NODE_ENV !== 'production') globalForDb.postgresClient = client;

export const db = drizzle({ client, schema });
export * from '@/db/schema';
