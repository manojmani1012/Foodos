import { Pool } from 'pg'
import { getEnvironment } from './environment.js'

let pool = null

export function getDatabasePool() {
  const { databaseUrl } = getEnvironment()

  if (!databaseUrl) {
    return null
  }

  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl })
  }

  return pool
}

export async function pingDatabase() {
  const activePool = getDatabasePool()

  if (!activePool) {
    return { connected: false, reason: 'DATABASE_URL is not configured' }
  }

  const result = await activePool.query('select now() as server_time')

  return {
    connected: true,
    serverTime: result.rows[0]?.server_time || null,
  }
}
