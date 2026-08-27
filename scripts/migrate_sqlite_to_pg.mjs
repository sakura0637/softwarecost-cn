// 一次性迁移脚本：把旧 SQLite 库(data/software_cost.db)的数据迁到新 PostgreSQL 库。
// 运行环境：Node >= 18。依赖：better-sqlite3（读旧库）、pg（写新库）。
//   服务器上临时安装：npm i better-sqlite3 pg
// 用法：
//   SQLITE_PATH=/path/to/software_cost.db \
//   DATABASE_URL=postgres://user:pass@127.0.0.1:5432/software_cost \
//   node scripts/migrate_sqlite_to_pg.mjs
// 说明：
//   - 脚本会先按 PG 方言建表（IF NOT EXISTS），再迁移数据，最后重置 SERIAL 序列。
//   - 保留旧库的自增 id，外键（user_id / project_id / role_id）据此一致。
//   - standards 用 UPSERT 覆盖，保留后台管理界面产生的增删改。
//   - device_prices / kv 不迁（由应用 bootstrap 按种子自动灌入）。
//   - 附件文件本体需另外把旧 data/uploads/ 目录整体复制到新部署的 data/uploads/。

import Database from 'better-sqlite3'
import pg from 'pg'

const SQLITE_PATH =
  process.env.SQLITE_PATH ||
  (() => {
    const cand = ['./data/software_cost.db', '../data/software_cost.db', '/home/ubuntu/softwarecost/data/software_cost.db']
    for (const c of cand) {
      try {
        require('fs').accessSync(c)
        return c
      } catch {}
    }
    return './data/software_cost.db'
  })()

const connectionString =
  process.env.DATABASE_URL ||
  (() => {
    const h = process.env.DB_HOST || '127.0.0.1'
    const p = process.env.DB_PORT || 5432
    const u = process.env.DB_USER || 'softwarecost'
    const pw = encodeURIComponent(process.env.DB_PASSWORD || '')
    const d = process.env.DB_NAME || 'software_cost'
    return `postgres://${u}:${pw}@${h}:${p}/${d}`
  })()

const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true })
const pool = new pg.Pool({ connectionString, max: 5 })

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, email VARCHAR(128), phone VARCHAR(32),
  password_hash VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL,
  description TEXT, method VARCHAR(16) NOT NULL DEFAULT 'ifpug', standard_id VARCHAR(64), status VARCHAR(16) NOT NULL DEFAULT 'draft',
  document_path VARCHAR(512), raw_text TEXT, result_json TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS function_points (
  id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, seq INTEGER, name VARCHAR(255) NOT NULL,
  type VARCHAR(8) NOT NULL, complexity VARCHAR(8) NOT NULL DEFAULT '中', ret INTEGER NOT NULL DEFAULT 0, det INTEGER NOT NULL DEFAULT 0,
  ufp INTEGER NOT NULL DEFAULT 0, note TEXT, source VARCHAR(8) NOT NULL DEFAULT 'ai', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_project ON function_points(project_id);
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY, code VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL, description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY, code VARCHAR(128) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL, type VARCHAR(16) NOT NULL DEFAULT 'button',
  module VARCHAR(64), parent VARCHAR(128), sort INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_code VARCHAR(128) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_ur_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_ur_role ON user_roles(role_id);
CREATE TABLE IF NOT EXISTS standard_attachments (
  id SERIAL PRIMARY KEY, standard_id VARCHAR(64) NOT NULL, file_name VARCHAR(255) NOT NULL, stored_name VARCHAR(255) NOT NULL,
  file_size INTEGER, mime_type VARCHAR(128), uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sa_std ON standard_attachments(standard_id);
CREATE TABLE IF NOT EXISTS standards (
  id TEXT PRIMARY KEY, category TEXT, name TEXT NOT NULL, code TEXT, region TEXT, level TEXT, org TEXT, summary TEXT, params TEXT, param_values TEXT
);
`

async function migrate() {
  const client = await pool.connect()
  try {
    // 1) 建表
    for (const part of DDL.split(';')) {
      const s = part.trim()
      if (s) await client.query(s)
    }
    console.log('[migrate] 建表完成（IF NOT EXISTS）')

    // 2) users（保留原 id）
    const users = sqlite.prepare('SELECT id, username, email, phone, password_hash, role, created_at FROM users').all()
    for (const u of users) {
      await client.query(
        'INSERT INTO users (id, username, email, phone, password_hash, role, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [u.id, u.username, u.email, u.phone, u.password_hash, u.role, u.created_at]
      )
    }
    console.log(`[migrate] users: ${users.length}`)

    // 3) roles（保留原 id；系统角色冲突则忽略）
    const roles = sqlite.prepare('SELECT id, code, name, description, is_system, created_at FROM roles').all()
    for (const r of roles) {
      await client.query(
        'INSERT INTO roles (id, code, name, description, is_system, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [r.id, r.code, r.name, r.description, r.is_system, r.created_at]
      )
    }
    console.log(`[migrate] roles: ${roles.length}`)

    // 4) permissions（保留原 id）
    const perms = sqlite.prepare('SELECT id, code, name, type, module, parent, sort, created_at FROM permissions').all()
    for (const p of perms) {
      await client.query(
        'INSERT INTO permissions (id, code, name, type, module, parent, sort, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING',
        [p.id, p.code, p.name, p.type, p.module, p.parent, p.sort, p.created_at]
      )
    }
    console.log(`[migrate] permissions: ${perms.length}`)

    // 5) user_roles
    const ur = sqlite.prepare('SELECT user_id, role_id FROM user_roles').all()
    for (const x of ur) {
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x.user_id, x.role_id])
    }
    console.log(`[migrate] user_roles: ${ur.length}`)

    // 6) projects（保留原 id；role 等无关，字段按序）
    const projects = sqlite.prepare('SELECT id, user_id, name, description, method, standard_id, status, document_path, raw_text, result_json, created_at, updated_at FROM projects').all()
    for (const p of projects) {
      await client.query(
        'INSERT INTO projects (id, user_id, name, description, method, standard_id, status, document_path, raw_text, result_json, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING',
        [p.id, p.user_id, p.name, p.description, p.method, p.standard_id, p.status, p.document_path, p.raw_text, p.result_json, p.created_at, p.updated_at]
      )
    }
    console.log(`[migrate] projects: ${projects.length}`)

    // 7) function_points（保留原 id）
    const fps = sqlite.prepare('SELECT id, project_id, seq, name, type, complexity, ret, det, ufp, note, source, created_at FROM function_points').all()
    for (const f of fps) {
      await client.query(
        'INSERT INTO function_points (id, project_id, seq, name, type, complexity, ret, det, ufp, note, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING',
        [f.id, f.project_id, f.seq, f.name, f.type, f.complexity, f.ret, f.det, f.ufp, f.note, f.source, f.created_at]
      )
    }
    console.log(`[migrate] function_points: ${fps.length}`)

    // 8) standards（UPSERT 覆盖，保留后台改动）
    const stds = sqlite.prepare('SELECT id, category, name, code, region, level, org, summary, params, param_values FROM standards').all()
    for (const s of stds) {
      await client.query(
        `INSERT INTO standards (id, category, name, code, region, level, org, summary, params, param_values)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           category=EXCLUDED.category, name=EXCLUDED.name, code=EXCLUDED.code, region=EXCLUDED.region,
           level=EXCLUDED.level, org=EXCLUDED.org, summary=EXCLUDED.summary, params=EXCLUDED.params, param_values=EXCLUDED.param_values`,
        [s.id, s.category, s.name, s.code, s.region, s.level, s.org, s.summary, s.params, s.param_values]
      )
    }
    console.log(`[migrate] standards: ${stds.length}`)

    // 9) standard_attachments（保留原 id）
    const atts = sqlite.prepare('SELECT id, standard_id, file_name, stored_name, file_size, mime_type, uploaded_at FROM standard_attachments').all()
    for (const a of atts) {
      await client.query(
        'INSERT INTO standard_attachments (id, standard_id, file_name, stored_name, file_size, mime_type, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [a.id, a.standard_id, a.file_name, a.stored_name, a.file_size, a.mime_type, a.uploaded_at]
      )
    }
    console.log(`[migrate] standard_attachments: ${atts.length}`)

    // 10) 重置 SERIAL 序列（避免后续插入 id 冲突）
    for (const t of ['users', 'roles', 'permissions', 'projects', 'function_points', 'standard_attachments']) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT max(id) FROM ${t}), 1))`,
        [t]
      )
    }
    console.log('[migrate] SERIAL 序列已重置')

    console.log('[migrate] ✅ 完成。请确认旧 data/uploads/ 已复制到新部署的 data/uploads/')
  } finally {
    client.release()
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[migrate] ❌ 失败:', e)
    process.exit(1)
  })
