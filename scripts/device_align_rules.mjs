// 设备台账对齐 · 映射规则
//
// 用途：把数据库·设备价格库对齐到桌面《设备台账_数据对齐版》的口径。
//   · 生成器 scripts/gen_device_align_seed.mjs 用它在本地算出「目标态」新种子
//   · 迁移脚本 scripts/apply_device_align.mjs 用它把线上老库改到同一目标态
// 两边共用同一份规则，杜绝「本地算一套、线上跑另一套」。
//
// 口径（已确认）：以台账为准 · 库独有数据全部保留 · 单价不动。
//
// ⚠️ 分类与子分类**不参与金额计算** —— 运维测算的匹配只看设备名
//    （server/utils/omDeviceMatcher.matchDevice 只用 name）。改分类只影响
//    浏览/展示与后台可读性，不动任何一分钱；因此归并可放手做。

export const MANAGERS = ['保沧', '廊涿', '保定', '石家庄', '衡水', '邢台', '沧州', '邯郸']

// ── 一、站点：合并 ────────────────────────────────────────────────
// 库把「核心节点」拆成了多个子站（网络/视频一部分、机房/供电/消防另一部分），
// 台账把它们合在一个 sheet 里。合并做法：选一个「宿主」子站改名到目标名，
// 其余源子站的行搬进宿主，源站删掉。
// 选宿主的依据：承载设备更多、语义更接近「核心节点」的那个。
export const SITE_MERGE = [
  { station: '保定', host: '保定区域应急调度监测站', to: '核心节点',
    sources: ['保定末端实体环境', '保定市管理处实体环境'] },
  { station: '保沧', host: '保沧干渠区域应急调度监测站', to: '核心节点',
    sources: ['保沧干渠管理处', '保沧干渠实体环境'] },
  { station: '廊涿', host: '廊涿干渠管理处', to: '核心节点',
    sources: ['管理处设备'] },
  { station: '石家庄', host: '7石家庄区域应急调度监测站', to: '核心节点',
    sources: ['实体环境汇总'] },
  { station: '衡水', host: '衡水区域应急调度监测站', to: '核心节点', sources: [] },
  { station: '邢台', host: '邢台区域应急调度监测站', to: '核心节点', sources: [] },
  { station: '沧州', host: '沧州区域应急调度监测站', to: '核心节点', sources: [] },
  // 总调中心没有真实子站，它的「全站设备汇总」就是本站明细（灌库时被豁免汇总标记）
  { station: '总调中心', host: '全站设备汇总', to: '核心节点', sources: [] },
]

// ── 二、站点：改名（去脏数据 / 换成台账写法）──────────────────────
// 依据：台账同名站的设备重合率（79%~100%，见 设备台账对齐方案.md §1.1）
export const SITE_RENAME = [
  { station: '石家庄', from: '64晋州管理站', to: '晋州管理站' },
  { station: '石家庄', from: '65藁城管理站', to: '藁城管理站' },
  { station: '石家庄', from: '66辛集管理站', to: '辛集管理站' },
  { station: '衡水', from: '工业新区管理站（高新区管理站）', to: '工业新区管理站' },
  { station: '邢台', from: '华龙分水口现地阀站', to: '华龙分水口管理站' },
  { station: '邢台', from: '华龙工业区调流阀站', to: '华龙管理站' },
  { station: '邢台', from: '广宗线管理站', to: '广宗管理站' },
  { station: '邯郸', from: '吴庄管理站', to: '永年管理所' },
  { station: '邯郸', from: '临漳泵站', to: '临漳管理站' },
  { station: '邯郸', from: '肥乡分水口站', to: '肥乡管理站' },
  { station: '邯郸', from: '魏广管理所', to: '魏广管理站' },
  { station: '沧州', from: '小白庄管理站', to: '南皮管理所' },
]

// ── 三、站点：重挂（换管理处）────────────────────────────────────
// 库里挂在「廊坊」下，实为廊涿干渠的站（设备重合 92% / 100%）。
// 「廊坊管理处」本身与台账各站重合仅 1%，属库独有数据 —— 保留不动。
export const SITE_REPARENT = [
  { fromStation: '廊坊', fromSubsite: '霸州管理所', toStation: '廊涿', toSubsite: '霸州管理站' },
  { fromStation: '廊坊', fromSubsite: '胜芳泵站', toStation: '廊涿', toSubsite: '胜芳管理站' },
]

// ── 四、分类归并（20 类 → 台账写法）──────────────────────────────
// value = [新 category, 新 subcategory]；subcategory 为 null 表示保持原值
export const CAT_MAP = {
  视频监控: ['视频监视', null],          // 同一概念的两种写法（台账以「视频监视」为主）
  通信: ['通信系统', null],
  通信交换: ['通信系统', '通信交换'],     // 降为「通信系统」下的子分类
  通信传输: ['通信系统', '通信传输'],
  通信电源: ['通信系统', '通信电源'],
  通信施工: ['通信系统', '通信施工'],
  光缆监测: ['通信系统', '光缆监测'],
  安全监测: ['安全监测设备', null],
  ups供电系统: ['UPS供电系统', null],     // 统一大小写
  专用空调: ['实体环境', '空调'],
}

// 台账侧同样要规范（新增行照台账写，但这两组写法要与库归并后的结果一致）
export const CAT_MAP_EXCEL = {
  视频监控: ['视频监视', null],
  通信: ['通信系统', null],
  ups供电系统: ['UPS供电系统', null],
}

// ── 五、分类规范化 ───────────────────────────────────────────────
// 处理「子分类里塞了站名/位置」的串位数据（库中实测 61 行）：
//   安全监测 / （涿州末端管理站）工程监控   → 工程监控 / （空）
//   工程监控 / 总调中心(安装于河北水务集团) → 工程监控 / （空）
//   工程监控 / 数据备份中心（安装于保沧干渠管理处） → 工程监控 / （空）
// 子分类置空而非猜测：自动判定「硬件设备 / 软件」不可靠，
// 且子分类不参与金额计算，宁可留空由后台按需指定。
const RE_BRACKET_PREFIX = /^[（(]([^）)]*)[）)](.+)$/

export function canonicalCat(cat, sub, map = CAT_MAP) {
  let c = cat || null
  let s = sub || null
  if (s) {
    const m = s.match(RE_BRACKET_PREFIX)
    if (m) {
      c = m[2].trim()          // 括号里是站名，括号后才是真分类 → 上移
      s = null
    } else if (s.includes('安装于')) {
      s = null
    }
  }
  const rule = map[c]
  if (rule) {
    c = rule[0]
    if (rule[1]) s = rule[1]
  }
  return [c, s]
}

// ── 六、目标站点清单（库改名的结果，供校验用）──────────────────────
export function buildSiteMap() {
  // 'station\u0000subsite' 旧键 -> [station, subsite] 新键
  const map = new Map()
  const put = (st, sub, toSt, toSub) => map.set(st + '\u0000' + sub, [toSt, toSub])
  for (const g of SITE_MERGE) {
    put(g.station, g.host, g.station, g.to)
    for (const src of g.sources) put(g.station, src, g.station, g.to)
  }
  for (const r of SITE_RENAME) put(r.station, r.from, r.station, r.to)
  for (const r of SITE_REPARENT) put(r.fromStation, r.fromSubsite, r.toStation, r.toSubsite)
  return map
}

// 站点是否「被搬迁」（用于迁移脚本判断源站处理方式）
export function mergedAwaySites() {
  const out = []
  for (const g of SITE_MERGE) for (const src of g.sources) out.push([g.station, src])
  return out
}

// 规范化设备名（对齐匹配用）：统一括号、去空白
export function normName(s) {
  if (!s) return ''
  return String(s).trim().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '')
}

export function normUnit(s) {
  if (!s) return ''
  return String(s).trim().replace(/\s+/g, '')
}
