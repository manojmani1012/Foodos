export function getEnvironment() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    databaseUrl: process.env.DATABASE_URL || '',
  }
}
