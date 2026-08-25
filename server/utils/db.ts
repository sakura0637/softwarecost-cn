import Database from 'better-sqlite3'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

export default db
