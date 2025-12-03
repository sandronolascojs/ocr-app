import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';
import { env } from '@/env.mjs';

const MAX_POOL_CONNECTIONS = 30;
const IDLE_TIMEOUT = 10000;
const CONNECTION_TIMEOUT = 10000;

const postgresPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: MAX_POOL_CONNECTIONS,
  idleTimeoutMillis: IDLE_TIMEOUT,
  connectionTimeoutMillis: CONNECTION_TIMEOUT,
});

export const db = drizzle(postgresPool, { schema: { ...schema } });

export type DrizzleDB = typeof db;
export type DrizzleTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DB = DrizzleDB | DrizzleTx;

export * as schema from './schema';
