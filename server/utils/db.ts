import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { dirname, join } from 'node:path'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// 造价标准库静态数据（单一真相源，前端 fallback 与种子同源）；库为运行时权威，可经后台管理界面改
import { standards } from '../../composables/useStandards'

// 本地 SQLite 文件库，与 172.22.2.203 上的党建库 pb_show_init 零耦合、零牵连
//
// ⚠️ 关键坑（已踩）：better-sqlite3 的 new Database() 只接受【普通文件路径字符串】，
//    绝对不能传 file:// URL（pathToFileURL().href 那种）。
//    Linux 下 file:///home/... 会被当成字面路径，导致父目录不存在而报错
//    "Cannot open database because the directory does not exist"。
//
// 部署路径解析优先级（Nitro 打包后会 process.chdir() 到 .output/server，且本文件
// 以源码形式被动态 import，trace 指向 server/utils/db.ts，故 cwd 不可靠）：
//   1) 环境变量 DB_DIR（ecosystem.config.cjs 已注入绝对路径，最可靠）
//   2) 启动入口 .output/server/index.mjs → 项目根 = 去掉 .output/server
//   3) import.meta.url（db.ts 在 <ROOT>/server/utils）→ 去掉 /server/utils
//   4) 兜底 process.cwd()/data（仅开发态）
function resolveDbDir(): string {
  const candidates: string[] = []
  if (process.env.DB_DIR) candidates.push(process.env.DB_DIR)
  const entry = process.argv[1] || ''
  const m = entry.match(/(.+?)[\\/]\.output[\\/]server[\\/]/)
  if (m && m[1]) candidates.push(join(m[1], 'data'))
  const here = dirname(fileURLToPath(import.meta.url))
  const byMeta = here.replace(/[\\/]server[\\/]utils$/, '')
  if (byMeta && byMeta !== here) candidates.push(join(byMeta, 'data'))
  candidates.push(join(process.cwd(), 'data'))
  // 返回第一个可创建/已存在的目录，确保 new Database 时父目录一定存在
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

const DB_DIR = resolveDbDir()
const DB_FILE = join(DB_DIR, 'software_cost.db')

// 标准附件上传目录（data/uploads/standards/），与 DB 同根，确保 deploy 后一定存在
export const DATA_DIR = DB_DIR
export const STANDARD_UPLOAD_DIR = join(DB_DIR, 'uploads', 'standards')
mkdirSync(STANDARD_UPLOAD_DIR, { recursive: true })

const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  email         VARCHAR(128),
  phone         VARCHAR(32),
  password_hash VARCHAR(255) NOT NULL,
  created_at    TEXT         NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  method        VARCHAR(16)  NOT NULL DEFAULT 'ifpug',   -- ifpug / nesma
  standard_id   VARCHAR(64),                            -- 选用标准(对应 useStandards.id)
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',   -- draft/analyzed/calculated
  document_path VARCHAR(512),                           -- 上传文档服务器路径
  raw_text      TEXT,                                   -- 提取的需求文本
  result_json   TEXT,                                   -- 计价结果缓存
  created_at    TEXT         NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT         NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS function_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq         INTEGER,
  name        VARCHAR(255) NOT NULL,   -- 功能项名称
  type        VARCHAR(8)   NOT NULL,   -- ILF/EIF/EI/EO/EQ
  complexity  VARCHAR(8)   NOT NULL DEFAULT '中',  -- 低/中/高
  ret         INTEGER      NOT NULL DEFAULT 0,  -- 记录元素类型(ILF/EIF)
  det         INTEGER      NOT NULL DEFAULT 0,  -- 数据元素类型
  ufp         INTEGER      NOT NULL DEFAULT 0,  -- 未调整功能点
  note        TEXT,
  source      VARCHAR(8)   NOT NULL DEFAULT 'ai',  -- ai/manual
  created_at  TEXT         NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_project    ON function_points(project_id);
`)

// 兼容老库：补 role 列（管理员角色限制用，默认普通用户）。列已存在则忽略
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
} catch { /* 列已存在 */ }

// ── RBAC：角色 / 权限 / 用户-角色关联（支持多角色，权限取并集）──────────
db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        VARCHAR(64)  NOT NULL UNIQUE,   -- admin / user / 自定义编码
  name        VARCHAR(64)  NOT NULL,
  description TEXT,
  is_system   INTEGER      NOT NULL DEFAULT 0, -- 系统内置角色(admin/user)不可删
  created_at  TEXT         NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    VARCHAR(128) NOT NULL UNIQUE,        -- 如 standards:edit / m:standards
  name    VARCHAR(64)  NOT NULL,
  type    VARCHAR(16)  NOT NULL DEFAULT 'button', -- module / menu / button
  module  VARCHAR(64),                          -- 所属模块 key（用于分组）
  parent  VARCHAR(128),                         -- 父权限 code（模块 → 按钮 层级）
  sort    INTEGER      NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`)

// ── RBAC 种子（首次启动灌入，库非空则不覆盖）──────────
{
  // 模块与动作定义 = 权限目录的唯一真相源。
  // 一个模块可含 view/create/edit/delete 等动作，最终权限码为 `${module}:${action}`。
  const MODULES = [
    { key: 'standards',          name: '造价标准库',     actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'devices',            name: '设备价格库',     actions: ['view'] },
    { key: 'industry',           name: '行业基准数据分析', actions: ['view'] },
    { key: 'city',               name: '省市计价数据分析', actions: ['view'] },
    { key: 'projects',           name: '工作台',         actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-users',        name: '用户管理',       actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-roles',        name: '角色管理',       actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'admin-permissions',  name: '权限管理',       actions: ['view', 'edit'] },
  ]
  const ACTION_NAMES: Record<string, string> = { view: '查看', create: '新增', edit: '编辑', delete: '删除' }

  // 1) 系统角色
  const roleCount = (db.prepare('SELECT COUNT(*) AS c FROM roles').get() as { c: number }).c
  if (roleCount === 0) {
    const insRole = db.prepare('INSERT OR IGNORE INTO roles (code, name, description, is_system) VALUES (?, ?, ?, 1)')
    insRole.run('admin', '系统管理员', '拥有系统全部权限')
    insRole.run('user', '普通用户', '默认注册用户，可浏览标准/设备库/工作台')
    console.log('[seed] roles 已灌 2 条')
  }

  // 2) 权限目录（模块节点 + 按钮节点）
  const permCount = (db.prepare('SELECT COUNT(*) AS c FROM permissions').get() as { c: number }).c
  if (permCount === 0) {
    const insPerm = db.prepare('INSERT OR IGNORE INTO permissions (code, name, type, module, parent, sort) VALUES (?, ?, ?, ?, ?, ?)')
    let sort = 0
    for (const m of MODULES) {
      insPerm.run(`m:${m.key}`, m.name, 'module', m.key, null, sort++)
      for (const a of m.actions) {
        insPerm.run(`${m.key}:${a}`, ACTION_NAMES[a] || a, 'button', m.key, `m:${m.key}`, sort++)
      }
    }
    console.log('[seed] permissions 已灌若干条')
  }

  // 3) 角色-权限分配（种子）
  const rpCount = (db.prepare('SELECT COUNT(*) AS c FROM role_permissions').get() as { c: number }).c
  if (rpCount === 0) {
    const allPerms = (db.prepare('SELECT code FROM permissions').all() as { code: string }[]).map(p => p.code)
    const adminId = (db.prepare('SELECT id FROM roles WHERE code = ?').get('admin') as { id: number }).id
    const userId = (db.prepare('SELECT id FROM roles WHERE code = ?').get('user') as { id: number }).id
    const insRp = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    const tx = db.transaction(() => {
      for (const code of allPerms) insRp.run(adminId, code) // 管理员拥有全部权限
      // 普通用户：可浏览全部业务模块，且可管理自己的工作台项目
      for (const code of allPerms) {
        if (
          code.startsWith('standards:') || code.startsWith('devices:') ||
          code.startsWith('industry:') || code.startsWith('city:') || code.startsWith('projects:')
        ) {
          insRp.run(userId, code)
        }
      }
    })
    tx()
    console.log('[seed] role_permissions 已分配')
  }

  // 4) 存量用户迁移进 user_roles（按 legacy 的 users.role）
  const tx2 = db.transaction(() => {
    const users = db.prepare('SELECT id, role FROM users').all() as { id: number; role: string }[]
    const migrate = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?')
    for (const u of users) migrate.run(u.id, u.role === 'admin' ? 'admin' : 'user')
  })
  tx2()
}

// ── 设备价格库（种子数据：server/seed/device_prices_seed.json）──────────
// 运行时路径解析（Nitro 打包后 import.meta.url 指向 .output/server/chunks，
// 正则匹配失败，故兜底到 cwd 与 DB_DIR，确保 dev/prod 均能定位 seed）：
//   1) import.meta.url → <ROOT>/server/seed（源码态）
//   2) DB_DIR(项目根/data) 上一级 → <ROOT>/server/seed（生产态，最可靠）
//   3) process.cwd()/server/seed（兜底）
const SEED_DIR = (() => {
  const candidates: string[] = []
  const here = dirname(fileURLToPath(import.meta.url))
  const byMeta = here.replace(/[\\/]server[\\/]utils$/, '')
  if (byMeta && byMeta !== here) candidates.push(join(byMeta, 'server', 'seed'))
  if (process.env.DB_DIR) candidates.push(join(process.env.DB_DIR, '..', 'server', 'seed'))
  candidates.push(join(process.cwd(), 'server', 'seed'))
  for (const d of candidates) {
    if (existsSync(d)) return d
  }
  // 都不存在时返回最可能在生产态命中的候选（DB_DIR 优先）
  return candidates[candidates.length - 1]
})()
const SEED_FILE = join(SEED_DIR, 'device_prices_seed.json')

db.exec(`
CREATE TABLE IF NOT EXISTS device_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  station      VARCHAR(32)  NOT NULL,   -- 站(石家庄/沧州/...)
  subsite      VARCHAR(64),             -- 管理子站(sheet名)；全站汇总为「全站设备汇总」
  category     VARCHAR(32),             -- 顶层分类(工程监控/视频监视/计算机网络/通信/安全监测/实体环境...)
  subcategory  VARCHAR(64),             -- 子分类(硬件设备/软件/控制专网/通信传输/通信交换...)
  name         VARCHAR(255) NOT NULL,   -- 设备名称
  unit         VARCHAR(16),             -- 单位
  brand_model  VARCHAR(255),            -- 品牌型号
  qty          REAL,                    -- 数量
  unit_price   REAL,                    -- 单价(元)
  total_price  REAL,                    -- 合价(元)
  remark       TEXT                     -- 备注
);
CREATE INDEX IF NOT EXISTS idx_dp_station  ON device_prices(station);
CREATE INDEX IF NOT EXISTS idx_dp_category ON device_prices(category);
`)

// ── 标准附件（后台上传，文件存于 data/uploads/standards/）──────────
db.exec(`
CREATE TABLE IF NOT EXISTS standard_attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  standard_id  VARCHAR(64)  NOT NULL,         -- 关联 useStandards.ts 的 id
  file_name    VARCHAR(255) NOT NULL,         -- 原始文件名（下载时展示）
  stored_name  VARCHAR(255) NOT NULL,         -- 磁盘实际文件名（防冲突/防注入）
  file_size    INTEGER,
  mime_type    VARCHAR(128),
  uploaded_at  TEXT         NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sa_std ON standard_attachments(standard_id);
`)

// ── 造价标准库（种子数据：composables/useStandards.ts）──────────
// 运行时从库读取（GET /api/standards）。首次启动（表空）灌入静态数据；
// 库非空则不覆盖，保护后台管理界面对标准的增删改。
db.exec(`
CREATE TABLE IF NOT EXISTS standards (
  id            TEXT PRIMARY KEY,            -- 标准 id（与附件关联、前端 key 一致）
  category      TEXT,                        -- 类别（软件开发/运维费用/信创适配/...）
  name          TEXT NOT NULL,               -- 标准名称
  code          TEXT,                        -- 标准编号（CSBMK-202510 / 粤财行… / —）
  region        TEXT,                        -- 地区（全国/四川/广东-佛山…）
  level         TEXT,                        -- national/provincial/municipal/industry/military
  org           TEXT,                        -- 发布机构
  summary       TEXT,                        -- 说明
  params        TEXT,                        -- JSON 数组：核心参数名
  param_values  TEXT                         -- JSON 对象：参数名→取值
);
`)
{
  const stdCount = (db.prepare('SELECT COUNT(*) AS c FROM standards').get() as { c: number }).c
  if (stdCount === 0 && standards.length > 0) {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO standards (id, category, name, code, region, level, org, summary, params, param_values) VALUES (?,?,?,?,?,?,?,?,?,?)'
    )
    const tx = db.transaction((rows: any[]) => {
      for (const s of rows) {
        ins.run(
          s.id, s.category, s.name, s.code, s.region, s.level, s.org, s.summary,
          JSON.stringify(s.params || []), JSON.stringify(s.paramValues || {})
        )
      }
    })
    tx(standards)
    console.log(`[seed] standards 已灌 ${standards.length} 条`)
  }
}

// 设备价格库种子版本：seed 结构变化(加 subcategory / 重新解析 / 修正总调中心 subsite / 修正跨表求和公式求值)时 +1，触发自动重灌
const DEVICE_SEED_VERSION = '6'
// 兼容老库：补 subcategory 列（已存在则忽略）
try {
  db.exec('ALTER TABLE device_prices ADD COLUMN subcategory TEXT')
} catch {
  /* 列已存在 */
}

// 种子版本化自动重灌：版本不符 或 行数与 seed 不一致 → 清空 device_prices 重新灌入，
// 避免在服务器上手动执行 DELETE（部署新 seed 后重启即生效）。
db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)')
const curVerRow = db.prepare('SELECT v FROM kv WHERE k = ?').get('device_seed_version') as { v: string } | undefined
const seedExists = existsSync(SEED_FILE)
let seedRows: any[] = []
if (seedExists) {
  try { seedRows = JSON.parse(readFileSync(SEED_FILE, 'utf-8')) } catch { seedRows = [] }
}
const curCount = (db.prepare('SELECT COUNT(*) AS c FROM device_prices').get() as { c: number }).c
const needReseed = seedRows.length > 0 && (
  !curVerRow || curVerRow.v !== DEVICE_SEED_VERSION || curCount !== seedRows.length
)
if (needReseed) {
  const ins = db.prepare(
    'INSERT INTO device_prices (station, subsite, category, subcategory, name, unit, brand_model, qty, unit_price, total_price, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  )
  const tx = db.transaction((rows: any[]) => {
    db.exec('DELETE FROM device_prices')
    for (const r of rows) {
      ins.run(r.station, r.subsite, r.category, r.subcategory ?? null, r.name, r.unit, r.brand_model, r.qty, r.unit_price, r.total_price, r.remark)
    }
  })
  tx(seedRows)
  db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('device_seed_version', DEVICE_SEED_VERSION)
  console.log(`[seed] device_prices 已重灌 ${seedRows.length} 条 (v${DEVICE_SEED_VERSION})`)
}

// ── 初始管理员（环境变量驱动，幂等）──────────
// 部署时通过 ecosystem.config.cjs 配置 INIT_ADMIN_USERNAME 把指定账号设为管理员：
//   - 账号已存在 → 升级为 admin
//   - 账号不存在且给了 INIT_ADMIN_PASSWORD → 新建 admin 账号
// 不配置则不自动建/改，管理员需手动在库里维护。
{
  const initUser = process.env.INIT_ADMIN_USERNAME
  const initPwd = process.env.INIT_ADMIN_PASSWORD
  const initEmail = process.env.INIT_ADMIN_EMAIL || null
  if (initUser) {
    const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(initUser) as { id: number } | undefined
    let uid: number | undefined
    if (exist) {
      uid = exist.id
      db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(initUser)
    } else if (initPwd) {
      const ph = bcrypt.hashSync(initPwd, 10)
      const info = db.prepare('INSERT INTO users (username, email, phone, password_hash, role) VALUES (?,?,?,?,?)')
        .run(initUser, initEmail, null, ph, 'admin')
      uid = Number(info.lastInsertRowid)
    }
    if (uid != null) {
      const adminRoleId = (db.prepare('SELECT id FROM roles WHERE code = ?').get('admin') as { id: number }).id
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(uid, adminRoleId)
      console.log(`[init] 已确保 ${initUser} 为管理员（user_roles 已关联）`)
    }
  }
}

export default db
