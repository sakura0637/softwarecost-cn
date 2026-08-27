import pg from 'pg'
import bcrypt from 'bcryptjs'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// 造价标准库静态数据（单一真相源，前端 fallback 与种子同源）；库为运行时权威，可经后台管理界面改
import { standards } from '../../composables/useStandards'

// ── PostgreSQL 连接 ────────────────────────────────────────────────────
// 优先读 DATABASE_URL（ecosystem.config.cjs 注入）；否则用分项变量拼。
// 本库与 172.22.2.203 上的党建库 pb_show_init 零耦合、零牵连。
const connectionString =
  process.env.DATABASE_URL ||
  (() => {
    const host = process.env.DB_HOST || '127.0.0.1'
    const port = process.env.DB_PORT || 5432
    const user = process.env.DB_USER || 'softwarecost'
    const password = encodeURIComponent(process.env.DB_PASSWORD || '')
    const database = process.env.DB_NAME || 'software_cost'
    return `postgres://${user}:${password}@${host}:${port}/${database}`
  })()

const pool = new pg.Pool({ connectionString, max: 10 })

// ── 附件目录（仍落磁盘，与 DB 分离）────────────────────────────────────
function resolveUploadDir(): string {
  // 显式覆盖优先（ecosystem/.env 可设 UPLOAD_DIR 绝对路径）
  if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR
  const candidates: string[] = []
  // 1) 从启动入口推导项目根：相对路径先用 cwd 解析成绝对，再匹配 .output/server
  //    （PM2 的 script 是相对路径 .output/server/index.mjs，不 resolve 就匹配不到）
  const entry = process.argv[1] ? resolve(process.argv[1]) : ''
  const m = entry.match(/(.+?)[\\/]\.output[\\/]server[\\/]/)
  if (m && m[1]) candidates.push(join(m[1], 'data', 'uploads'))
  // 2) DB_DIR（ecosystem 注入绝对路径 ~/softwarecost/data）→ data/uploads（与旧版 SQLite 同根）
  if (process.env.DB_DIR) candidates.push(join(process.env.DB_DIR, 'uploads'))
  // 3) 兜底 cwd（PM2 已设 cwd=项目根）→ data/uploads
  candidates.push(join(process.cwd(), 'data', 'uploads'))
  for (const d of candidates) {
    try {
      mkdirSync(d, { recursive: true })
      return d
    } catch {
      /* 该候选不可用，尝试下一个 */
    }
  }
  return candidates[candidates.length - 1]
}
export const DATA_DIR = resolveUploadDir()
export const STANDARD_UPLOAD_DIR = join(DATA_DIR, 'standards')
mkdirSync(STANDARD_UPLOAD_DIR, { recursive: true })

// ── 占位符转换 ? → $1 $2 ...（让接口文件无需改 SQL 写法）──────────────
function toPgPlaceholders(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

// 当前事务连接（事务期间所有查询走它，保证 BEGIN/COMMIT 真正生效）
let currentClient: any = null

class Stmt {
  private sql: string
  constructor(sql: string) {
    this.sql = sql
  }
  private build(sql: string, autoReturning: boolean): string {
    let s = toPgPlaceholders(sql)
    const up = s.replace(/\s+/g, ' ').trim().toUpperCase()
    if (up.startsWith('INSERT OR IGNORE')) {
      // SQLite 的 INSERT OR IGNORE → PG 的 ON CONFLICT DO NOTHING（省略冲突目标，捕获所有唯一约束冲突）
      s = s.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING'
    } else if (
      autoReturning &&
      up.startsWith('INSERT') &&
      !/RETURNING/i.test(s) &&
      !/ON\s+CONFLICT/i.test(s)
    ) {
      // 普通 INSERT 自动 RETURNING id，等价 better-sqlite3 的 lastInsertRowid
      s = s.replace(/;\s*$/, '') + ' RETURNING id'
    }
    return s
  }
  async run(...params: any[]) {
    await ensureReady()
    const sql = this.build(this.sql, true)
    const c = currentClient || pool
    const r = await c.query(sql, params)
    return { lastID: r.rows[0]?.id ?? undefined, changes: r.rowCount ?? 0, rows: r.rows }
  }
  async get(...params: any[]) {
    await ensureReady()
    const sql = this.build(this.sql, false)
    const c = currentClient || pool
    const r = await c.query(sql, params)
    return r.rows[0]
  }
  async all(...params: any[]) {
    await ensureReady()
    const sql = this.build(this.sql, false)
    const c = currentClient || pool
    const r = await c.query(sql, params)
    return r.rows
  }
}

const db = {
  prepare(sql: string) {
    return new Stmt(sql)
  },
  async exec(sql: string) {
    for (const part of sql.split(';')) {
      const s = part.trim()
      if (!s || s.startsWith('--')) continue
      await pool.query(s)
    }
  },
  async transaction(fn: () => Promise<void> | void) {
    const client = await pool.connect()
    currentClient = client
    try {
      await client.query('BEGIN')
      await fn()
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      currentClient = null
      client.release()
    }
  },
}

// ── 自举：建表 + 种子 + 管理员（首次查询前执行一次）──────────────────
let readyPromise: Promise<void> | null = null
function ensureReady(): Promise<void> {
  if (!readyPromise) readyPromise = bootstrap()
  return readyPromise
}

async function bootstrap() {
  // 1) 建表（PG 方言）
  const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  email         VARCHAR(128),
  phone         VARCHAR(32),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(16)  NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  method        VARCHAR(16)  NOT NULL DEFAULT 'ifpug',
  standard_id   VARCHAR(64),
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
  document_path VARCHAR(512),
  raw_text      TEXT,
  result_json   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS function_points (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq         INTEGER,
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(8)   NOT NULL,
  complexity  VARCHAR(8)   NOT NULL DEFAULT '中',
  ret         INTEGER      NOT NULL DEFAULT 0,
  det         INTEGER      NOT NULL DEFAULT 0,
  ufp         INTEGER      NOT NULL DEFAULT 0,
  note        TEXT,
  source      VARCHAR(8)   NOT NULL DEFAULT 'ai',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_project    ON function_points(project_id);

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(64)  NOT NULL UNIQUE,
  name        VARCHAR(64)  NOT NULL,
  description TEXT,
  is_system   INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id      SERIAL PRIMARY KEY,
  code    VARCHAR(128) NOT NULL UNIQUE,
  name    VARCHAR(64)  NOT NULL,
  type    VARCHAR(16)  NOT NULL DEFAULT 'button',
  module  VARCHAR(64),
  parent  VARCHAR(128),
  sort    INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code VARCHAR(128) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_ur_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_ur_role ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS device_prices (
  id           SERIAL PRIMARY KEY,
  station      VARCHAR(32)  NOT NULL,
  subsite      VARCHAR(64),
  category     VARCHAR(32),
  subcategory  VARCHAR(64),
  name         VARCHAR(255) NOT NULL,
  unit         TEXT,
  brand_model  VARCHAR(255),
  qty          DOUBLE PRECISION,
  unit_price   DOUBLE PRECISION,
  total_price  DOUBLE PRECISION,
  remark       TEXT
);
CREATE INDEX IF NOT EXISTS idx_dp_station  ON device_prices(station);
CREATE INDEX IF NOT EXISTS idx_dp_category ON device_prices(category);

-- 兼容旧库：unit 早期为 VARCHAR(16)，种子里装的是长描述，需加宽到 TEXT（已为 TEXT 时则此句无副作用）
ALTER TABLE device_prices ALTER COLUMN unit TYPE TEXT;

CREATE TABLE IF NOT EXISTS standard_attachments (
  id           SERIAL PRIMARY KEY,
  standard_id  VARCHAR(64)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  stored_name  VARCHAR(255) NOT NULL,
  file_size    INTEGER,
  mime_type    VARCHAR(128),
  uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_std ON standard_attachments(standard_id);

CREATE TABLE IF NOT EXISTS standards (
  id            TEXT PRIMARY KEY,
  category      TEXT,
  name          TEXT NOT NULL,
  code          TEXT,
  region        TEXT,
  level         TEXT,
  org           TEXT,
  summary       TEXT,
  params        TEXT,
  param_values  TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT
);
`
  for (const part of DDL.split(';')) {
    const s = part.trim()
    if (!s) continue
    await pool.query(s)
  }

  // 2) RBAC 种子（首次启动灌入，库非空则不覆盖）
  const MODULES = [
    { key: 'standards', name: '造价标准库', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'devices', name: '设备价格库', actions: ['view'] },
    { key: 'industry', name: '行业基准数据分析', actions: ['view'] },
    { key: 'city', name: '省市计价数据分析', actions: ['view'] },
    { key: 'projects', name: '工作台', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-users', name: '用户管理', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-roles', name: '角色管理', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-permissions', name: '权限管理', actions: ['view', 'edit'] },
  ]
  const ACTION_NAMES: Record<string, string> = { view: '查看', create: '新增', edit: '编辑', delete: '删除' }

  const roleCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM roles')).rows[0].c)
  if (roleCount === 0) {
    await pool.query(
      "INSERT INTO roles (code, name, description, is_system) VALUES ('admin','系统管理员','拥有系统全部权限',1),('user','普通用户','默认注册用户',0) ON CONFLICT DO NOTHING"
    )
    console.log('[seed] roles 已灌 2 条')
  }

  const permCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM permissions')).rows[0].c)
  if (permCount === 0) {
    let sort = 0
    for (const m of MODULES) {
      await pool.query(
        'INSERT INTO permissions (code, name, type, module, parent, sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [`m:${m.key}`, m.name, 'module', m.key, null, sort++]
      )
      for (const a of m.actions) {
        await pool.query(
          'INSERT INTO permissions (code, name, type, module, parent, sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [`${m.key}:${a}`, ACTION_NAMES[a] || a, 'button', m.key, `m:${m.key}`, sort++]
        )
      }
    }
    console.log('[seed] permissions 已灌若干条')
  }

  const rpCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM role_permissions')).rows[0].c)
  if (rpCount === 0) {
    const allPerms = (await pool.query('SELECT code FROM permissions')).rows.map((p: any) => p.code)
    const adminId = (await pool.query("SELECT id FROM roles WHERE code='admin'")).rows[0]?.id
    const userId = (await pool.query("SELECT id FROM roles WHERE code='user'")).rows[0]?.id
    for (const code of allPerms) {
      await pool.query('INSERT INTO role_permissions (role_id, permission_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [adminId, code])
      if (['standards:', 'devices:', 'industry:', 'city:', 'projects:'].some((x) => code.startsWith(x))) {
        await pool.query('INSERT INTO role_permissions (role_id, permission_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, code])
      }
    }
    console.log('[seed] role_permissions 已分配')
  }

  // 3) 存量/迁移用户并入 user_roles（按 users.role；迁移脚本灌入的账号也在此补齐）
  const usersNoRole = (
    await pool.query(`SELECT u.id, u.role FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id WHERE ur.user_id IS NULL`)
  ).rows
  for (const u of usersNoRole) {
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2 ON CONFLICT DO NOTHING',
      [u.id, u.role === 'admin' ? 'admin' : 'user']
    )
  }

  // 4) 造价标准库种子（首次启动灌入静态数据；库非空则不覆盖，保护后台增删改）
  const stdCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM standards')).rows[0].c)
  if (stdCount === 0 && standards.length > 0) {
    for (const s of standards) {
      await pool.query(
        'INSERT INTO standards (id, category, name, code, region, level, org, summary, params, param_values) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',
        [s.id, s.category, s.name, s.code, s.region, s.level, s.org, s.summary, JSON.stringify(s.params || []), JSON.stringify(s.paramValues || {})]
      )
    }
    console.log(`[seed] standards 已灌 ${standards.length} 条`)
  }

  // 5) 设备价格库种子（server/seed/device_prices_seed.json）
  const DEVICE_SEED_VERSION = '6'
  const SEED_DIR = (() => {
    const candidates: string[] = []
    const here = dirname(fileURLToPath(import.meta.url))
    const byMeta = here.replace(/[\\/]server[\\/]utils$/, '')
    if (byMeta && byMeta !== here) candidates.push(join(byMeta, 'server', 'seed'))
    if (process.env.DB_DIR) candidates.push(join(process.env.DB_DIR, '..', 'server', 'seed'))
    candidates.push(join(process.cwd(), 'server', 'seed'))
    for (const d of candidates) if (existsSync(d)) return d
    return candidates[candidates.length - 1]
  })()
  const SEED_FILE = join(SEED_DIR, 'device_prices_seed.json')
  let seedRows: any[] = []
  if (existsSync(SEED_FILE)) {
    try {
      seedRows = JSON.parse(readFileSync(SEED_FILE, 'utf-8'))
    } catch {
      seedRows = []
    }
  }
  const dpCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM device_prices')).rows[0].c)
  const verRow = (await pool.query("SELECT v FROM kv WHERE k='device_seed_version'")).rows
  const needReseed =
    seedRows.length > 0 &&
    (verRow.length === 0 || verRow[0].v !== DEVICE_SEED_VERSION || dpCount !== seedRows.length)
  if (needReseed) {
    await pool.query('DELETE FROM device_prices')
    for (const r of seedRows) {
      await pool.query(
        'INSERT INTO device_prices (station, subsite, category, subcategory, name, unit, brand_model, qty, unit_price, total_price, remark) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [r.station, r.subsite, r.category, r.subcategory ?? null, r.name, r.unit, r.brand_model, r.qty, r.unit_price, r.total_price, r.remark]
      )
    }
    await pool.query(
      "INSERT INTO kv (k, v) VALUES ('device_seed_version', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [DEVICE_SEED_VERSION]
    )
    console.log(`[seed] device_prices 已重灌 ${seedRows.length} 条 (v${DEVICE_SEED_VERSION})`)
  }

  // 6) 初始管理员（环境变量驱动，幂等）
  const initUser = process.env.INIT_ADMIN_USERNAME
  if (initUser) {
    const exist = (await pool.query('SELECT id FROM users WHERE username=$1', [initUser])).rows[0]
    let uid: number | undefined
    if (exist) {
      uid = exist.id
      await pool.query("UPDATE users SET role='admin' WHERE username=$1", [initUser])
    } else if (process.env.INIT_ADMIN_PASSWORD) {
      const ph = bcrypt.hashSync(process.env.INIT_ADMIN_PASSWORD, 10)
      const ins = (await pool.query(
        'INSERT INTO users (username, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [initUser, process.env.INIT_ADMIN_EMAIL || null, null, ph, 'admin']
      )).rows[0]
      uid = ins.id
    }
    if (uid != null) {
      await pool.query(
        'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code=$2 ON CONFLICT DO NOTHING',
        [uid, 'admin']
      )
      console.log(`[init] 已确保 ${initUser} 为管理员（user_roles 已关联）`)
    }
  }
}

export default db
