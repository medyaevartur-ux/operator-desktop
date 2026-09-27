import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; refusing to connect to an implicit database');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});

pool.on("error", (err) => {
  console.error("[db] pool error:", (err as any).code || 'database_error');
});

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
