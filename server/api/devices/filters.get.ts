import db from '../../utils/db'

export default defineEventHandler(() => {
  const stations = (db.prepare('SELECT DISTINCT station FROM device_prices ORDER BY station').all() as any[]).map(
    (r) => r.station
  )
  const categories = (
    db
      .prepare("SELECT DISTINCT category FROM device_prices WHERE category IS NOT NULL AND category <> '' ORDER BY category")
      .all() as any[]
  ).map((r) => r.category)
  return { stations, categories }
})
