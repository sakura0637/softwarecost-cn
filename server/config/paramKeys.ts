// 测算参数字典的「参数键」—— 计价引擎识别参数的唯一依据。
//
// 由来（2026-09-18，第二轮「配置真实性」整治）：
//   引擎原来按 param_name 的**中文名字面量**匹配取值，写法如
//     find((p) => p.param_name === '人月折算系数')
//     find((p) => p.param_name === '平均人力成本费率' || p.param_name === '基准人月费率')
//     find((x) => ['应用类型'].some((k) => x.param_name.includes(k)))
//   后果是「改中文名 = 静默改行为」——后台把「人月折算系数」改个名，引擎就匹配不到，
//   hm 掉到兜底值。最坑的是**兜底 HM(174) 恰好等于多数标准的取值**，于是失配被数值巧合
//   掩盖得干干净净：只有北京 DB11/T 1010（176）会悄悄变成 174，金额小改、不报错、不留痕。
//
// 现在：引擎只认本文件的 param_key。中文名（param_name）退为纯展示字段，随便改不影响测算。
// ⚠️ 新增参数行必须填 param_key，否则引擎不会读它（后台会露出英文键，故 DATA_ENUMS 配了中文）。
//
// 本文件是唯一事实源：种子赋键、引擎取数、后台枚举、护栏断言全部引用它。

export interface ParamKeyDef {
  key: string
  label: string
  /** 引擎拿它干什么 —— 后台表说明里逐条交代，避免再出现「这列到底管什么」的困惑 */
  used: string
}

export const PARAM_KEYS: ParamKeyDef[] = [
  { key: 'hm', label: '人月折算系数', used: '人时/人月；把工作量（人时）折成人月' },
  { key: 'rate', label: '人月费率', used: '元/人月；功能点单价的分子' },
  { key: 'pdr_dev', label: '开发基准生产率', used: '人时/功能点，开发档（标准类别=开发时取用）' },
  { key: 'pdr_ops', label: '运维基准生产率', used: '人时/功能点，运维档（标准类别=运维时取用）' },
  { key: 'app_type_factor', label: '应用类型调整因子', used: '按业务处理/科技/多媒体等应用类型给系数' },
  { key: 'platform_factor', label: '开发平台调整因子', used: '按开发语言/平台给系数' },
  { key: 'team_factor', label: '开发团队背景调整因子', used: '按团队经验给系数' },
  { key: 'nonfunc_factor', label: '非功能性特征调整因子', used: '性能/兼容/可靠/可移植四类，带公式' },
  { key: 'scale_change_factor', label: '规模变更因子', used: '即 CF；估算阶段（概算/预算/需求）的规模调整' },
  { key: 'reuse_factor', label: '复用度调整因子', used: '构件复用程度的折扣系数' },
]

export const PARAM_KEY_VALUES: string[] = PARAM_KEYS.map((k) => k.key)

export const PARAM_KEY_LABELS: Record<string, string> = Object.fromEntries(
  PARAM_KEYS.map((k) => [k.key, k.label])
)

/** 旧中文名 → 参数键。
 *  用途只有两个：① 给历史数据回填参数键（`db.ts` 幂等回填块）；② 护栏断言「搬迁保真」。
 *  ⚠️ 运行时引擎一律不许再按名字取数 —— 出现即 `check:pricing` 报红。
 *  这里收录的是**改造前引擎按名字实际命中的全部名字**（含 includes 命中的），漏一个就会掉兜底值。 */
export const LEGACY_NAME_TO_KEY: Record<string, string> = {
  // 成本估算
  人月折算系数: 'hm',
  平均人力成本费率: 'rate',
  基准人月费率: 'rate',
  // 工作量度量（调整因子）
  应用类型调整因子: 'app_type_factor',
  开发平台调整因子: 'platform_factor',
  '开发语言/平台调整因子': 'platform_factor',
  开发团队背景调整因子: 'team_factor',
  非功能性特征调整因子: 'nonfunc_factor',
  规模变更因子: 'scale_change_factor',
  规模调整因子: 'scale_change_factor',
  规模调整因子CF: 'scale_change_factor',
  // 国标里名字带「规模调整」但整体是公式，改造前同样被 cf 匹配过 —— 保持等价
  '软件功能规模调整因子（VAF）': 'scale_change_factor',
  // 规模度量
  复用度调整因子: 'reuse_factor',
  复用系数: 'reuse_factor',
}

/** 生产率是特例：名字五花八门（基准生产率 / 软件开发生产率（全行业分位）…），
 *  改造前靠 param_type=productivity + 名字里有无「运维」二字分流，这里改成按行的类别直接定键。 */
export function paramKeyFor(paramName: string, paramType: string, category: string): string | null {
  if (paramType === 'productivity') return category === '运维' ? 'pdr_ops' : 'pdr_dev'
  return LEGACY_NAME_TO_KEY[paramName] ?? null
}
