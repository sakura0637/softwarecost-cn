import Database from 'better-sqlite3'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// 本地 SQLite 文件库，与 172.22.2.203 上的党建库 pb_show_init 零耦合、零牵连
// 用完整 file:// URL（.href）避免 Windows 路径被 ESM loader 误判为协议
const DB_FILE = join(process.cwd(), 'data', 'software_cost.db')
mkdirSync(dirname(DB_FILE), { recursive: true })
const DB_PATH = pathToFileURL(DB_FILE).href

const db = new Database(DB_PATH)
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
