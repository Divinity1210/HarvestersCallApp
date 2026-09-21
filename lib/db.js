import { neon } from '@neondatabase/serverless';

/**
 * Returns a Neon SQL tagged-template query client.
 * Uses process.env.DATABASE_URL or process.env.POSTGRES_URL.
 */
export function getDb() {
  const connectionString = 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.POSTGRES_PRISMA_URL;

  if (!connectionString) {
    throw new Error('Database connection string (DATABASE_URL or POSTGRES_URL) is not configured.');
  }

  return neon(connectionString);
}

/**
 * Helper to run a parameterised SQL query via Neon HTTP API.
 * 
 * @param {string} text - SQL query string with $1, $2 placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<Array>} Array of result row objects
 */
export async function query(text, params = []) {
  const sql = getDb();
  return await sql.query(text, params);
}
