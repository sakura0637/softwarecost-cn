// 操作审计的静态配置（不含任何数据库依赖，前后端都可 import）。
//
// 抽到 config 里的原因有三个：
//   1. 同一份中文名原来在 auditLog.ts / revertOperation.ts / 审计页各写一份，改一处必漏两处；
//   2. 审计页要按「记录所属模块」决定撤销按钮是否可点，必须与后端撤销接口用同一张权限表，
//      否则会出现「按钮点得动但一定 403」的假入口；
//   3. 静态配置才能被 scripts/check_audit.ts 断言 —— 新增模块忘了登记会被自检直接拦下。
import { getTableConf } from './dataTables'

/** 归属模块 → 中文名（审计页筛选下拉与列表展示共用） */
export const MODULE_LABELS: Record<string, string> = {
  standards: '造价标准库',
  'admin/devices': '设备价格库',
  'admin/data': '数据维护（参数）',
  om: '运维测算',
}

/** 写入方未显式指定 module 时的兜底归属。抽成常量，避免散落的字符串字面量逃过 check:audit。 */
export const DEFAULT_OPERATION_MODULE = 'admin/devices'

/**
 * 归属模块 → 撤销该模块的记录所需权限码。
 * ⚠️ 必须覆盖 MODULE_LABELS 的全部 key：漏一个，那条记录就只能靠 fallback 权限撤销，
 *    等于「谁能看审计谁就能回退数据」。
 */
export const REVERT_PERM_BY_MODULE: Record<string, string> = {
  standards: 'standards:edit',
  'admin/devices': 'devices:edit',
  'admin/data': 'data:edit',
  om: 'om:edit',
}

/** 兜底权限码：模块未登记撤销权限时使用（应尽量不走到这里，check:audit 会拦下漏登记） */
export const REVERT_PERM_FALLBACK = 'admin-logs:edit'

/** 动作 → 中文名 */
export const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  revert: '撤销',
}

/**
 * 大字段在日志里的占位文字。
 * 唯一来源 —— logOperation.ts 写占位、revertOperation.ts 读占位做完整性判断，
 * 两处字符串必须完全一致，否则「快照不完整」的拦截会失效、进而把占位符写进 JSON 列。
 */
export const HEAVY_PLACEHOLDER = '（大字段，未记入日志）'

/** 批量操作（如 Excel 整表导入）在 operation_logs.entity_id 里的标记值 */
export const BATCH_ENTITY_ID = 'batch'

/** 设备三表的实体类型（它们不在 dataTables 注册表里，真实表名另有一层映射） */
export const DEVICE_ENTITY_TYPES = ['station', 'device', 'station_device']

/**
 * 明确「记了日志但不可撤销」的实体及其原因。
 * 这类实体在审计页不显示撤销按钮 —— 否则就是一个点得动但必然报错的死按钮。
 * 新增审计对象时若确实不可撤销，必须登记到这里，check:audit 会强制这条约束。
 */
export const NON_REVERTIBLE_ENTITIES: Record<string, string> = {
  standard_attachments: '附件的实体文件已从磁盘删除，快照里只有元数据，无法还原文件'
}

/** 该实体类型是否支持撤销（审计页据此决定是否给撤销按钮） */
export function isRevertibleEntity(entityType: string): boolean {
  if (NON_REVERTIBLE_ENTITIES[entityType]) return false
  return DEVICE_ENTITY_TYPES.includes(entityType) || !!getTableConf(entityType)
}

/** 数据表实体的「显示名」候选列（按优先级）。审计列表用它把 #123 变成人看得懂的名字。 */
export const DISPLAY_CANDIDATES = ['name', 'category', 'title', 'group_name', 'industry', 'code', 'key']
