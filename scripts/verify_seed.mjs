// 验证 db.ts 的建表 + 灌库逻辑（复刻，不依赖 Nuxt build）
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

const DB_FILE = 'D:/softwarecost/data/_verify_seed.db'
const SEED = 'D:/softwarecost/server/seed/device_prices_seed.json'

const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// 与 server/utils/db.ts 中 device_prices 表结构完全一致
db.exec(`
CREATE TABLE IF NOT EXISTS device_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  station      VARCHAR(32)  NOT NULL,
  subsite      VARCHAR(64),
  category     VARCHAR(32),
  name         VARCHAR(255) NOT NULL,
  unit         VARCHAR(16),
  brand_model  VARCHAR(255),
  qty          REAL,
  unit_price   REAL,
  total_price  REAL,
  remark       TEXT
);
`)

const seed = JSON.parse(readFileSync(SEED))
const ins = db.prepare(
  'INSERT INTO device_prices (station, subsite, category, name, unit, brand_model, qty, unit_price, total_price, remark) VALUES (?,?,?,?,?,?,?,?,?,?)'
)
const tx = db.transaction((rows) => {
  for (const r of rows) {
    ins.run(r.station, r.subsite, r.category, r.name, r.unit, r.brand_model, r.qty, r.unit_price, r.total_price, r.remark)
  }
})
tx(seed)

const c = db.prepare('SELECT COUNT(*) AS c FROM device_prices').get()
console.log('插入条数:', c.c)

const sample = db.prepare('SELECT station, subsite, category, name, unit_price FROM device_prices LIMIT 1').get()
console.log('抽样:', sample)

// 各站计数
const byStation = db.prepare('SELECT station, COUNT(*) c FROM device_prices GROUP BY station ORDER BY c DESC').all()
console.log('各站:', byStation)

db.close()
