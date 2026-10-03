import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://jungle:jungle@localhost:5432/jungle' });
const migrationsDirectory = new URL('./migrations/', import.meta.url);
const migrationsPath = fileURLToPath(migrationsDirectory);

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;

    const existingSchema = await pool.query(
      `SELECT to_regclass('public.wallets') AS wallets`,
    );
    const hasInitialSchema = Boolean(existingSchema.rows[0]?.wallets);
    if (file === '001-initial.sql' && hasInitialSchema) {
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      console.log(`Baselined ${file}`);
      continue;
    }

    await pool.query('BEGIN');
    try {
      await pool.query(await readFile(join(migrationsPath, file), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await pool.end();
}
