// 造价标准数据源 —— 整理自 softwarecost.cn 公开造价标准库
// 结构：category(类别) / name(标准名称) / code(标准编号) / region(地区) / level(级别) / org(发布机构) / params(核心参数)

export interface CostStandard {
  id: string
  category: string
  name: string
  code: string
  region: string
  level: 'national' | 'provincial' | 'municipal' | 'industry' | 'military'
  org: string
  summary: string
  params: string[]
  paramValues?: Record<string, string | number>
}

export const standards: CostStandard[] = [
  // ===== 国家级 =====
  {
    id: 'bscea-csbmk',
    category: '行业基准数据',
    name: '中国软件行业基准数据',
    code: 'CSBMK-202510',
    region: '全国',
    level: 'national',
    org: '北京软件造价评估技术创新联盟',
    summary: '《中国软件行业基准数据》（CSBMK-202510）、《软件造价评估实施规程》（TBSCEA 002-2024）',
    params: ['基准生产率', '人月折算系数', '平均人力成本费率', '功能点调整因子'],
    paramValues: {
      '基准生产率': '8.5 FP/人月',
      '人月折算系数': 21.75,
      '平均人力成本费率': '2.3 万元/人月',
      '功能点调整因子': '0.8 ~ 1.2',
    },
  },
  {
    id: 'csia-ssmbk',
    category: '行业基准数据',
    name: '中国软件行业基准数据报告',
    code: 'SSM-BK-202509',
    region: '全国',
    level: 'national',
    org: '中国软件行业协会软件造价分会',
    summary: '中国软件行业协会软件造价分会基准数据报告',
    params: ['基准生产率', '人月折算系数', '功能点单价'],
    paramValues: {
      '基准生产率': '8.5 FP/人月',
      '人月折算系数': 21.75,
      '功能点单价': '1100 元/FP',
    },
  },
  {
    id: 'gb-t-28827',
    category: '运维费用',
    name: '软件运维费用测算规范',
    code: 'GB/T 28827.7-2022',
    region: '全国',
    level: 'national',
    org: '国家标准化管理委员会',
    summary: '《信息技术服务运行维护第7部分：成本度量规范》',
    params: ['运维工作量', '人月费率', '运维级别调整因子'],
    paramValues: {
      '运维工作量': '按项目实际测算',
      '人月费率': '2.3 万元/人月',
      '运维级别调整因子': 1.0
    },
  },
  {
    id: 'gb-t-36964',
    category: '软件开发',
    name: '软件开发成本度量规范',
    code: 'GB/T 36964-2018',
    region: '全国',
    level: 'national',
    org: '国家标准化管理委员会',
    summary: '《软件工程 软件开发成本度量规范》——功能点法造价评估基础国标',
    params: ['功能点计数', '基准生产率', '人月折算系数', '平均人力成本费率'],
    paramValues: {
      '功能点计数': '按项目实际测算',
      '基准生产率': '8.5 FP/人月',
      '人月折算系数': 21.75,
      '平均人力成本费率': '2.3 万元/人月'
    },
  },

  // ===== 省级 =====
  {
    id: 'sc-t-0015',
    category: '软件开发',
    name: '四川省信息化项目费用测算标准',
    code: 'T/SCSIA 0015-2025',
    region: '四川',
    level: 'provincial',
    org: '四川省软件行业协会',
    summary: '《四川省信息化项目费用测算标准》',
    params: ['功能点单价', '基准生产率', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '基准生产率': '8.5 FP/人月',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-xcfb',
    category: '软件开发',
    name: '湖南省省直单位政府投资信息化项目预算编制与财政评审工作指南',
    code: '湘财办〔2024〕10号',
    region: '湖南',
    level: 'provincial',
    org: '湖南省财政厅',
    summary: '《湖南省省直单位政府投资信息化项目预算编制与财政评审工作指南(试行)》',
    params: ['功能点单价', '调整因子', '人月费率'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2',
      '人月费率': '2.3 万元/人月'
    },
  },
  {
    id: 'bj-db11-1010',
    category: '软件开发',
    name: '信息化项目软件开发费用测算规范',
    code: 'DB 11/T 1010—2019',
    region: '北京',
    level: 'provincial',
    org: '北京市市场监督管理局',
    summary: '《信息化项目软件开发费用测算规范》',
    params: ['功能点单价', '基准生产率', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '基准生产率': '8.5 FP/人月',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-yc82',
    category: '软件开发',
    name: '广东省省级政务信息化服务预算编制标准（软件开发服务分册）',
    code: '粤财行〔2019〕82号',
    region: '广东',
    level: 'provincial',
    org: '广东省财政厅',
    summary: '《广东省省级政务信息化服务预算编制标准(试行)软件开发服务分册》',
    params: ['功能点单价', '调整因子', '人月费率'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2',
      '人月费率': '2.3 万元/人月'
    },
  },
  {
    id: 'cq-t-001',
    category: '软件开发',
    name: '政务数字化应用费用测算规范',
    code: 'T/CDCIDA 001—2023',
    region: '重庆',
    level: 'provincial',
    org: '重庆市信息数据行业协会',
    summary: '《政务数字化应用费用测算规范》',
    params: ['功能点单价', '基准生产率', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '基准生产率': '8.5 FP/人月',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-budget',
    category: '软件开发',
    name: '江苏省省级政务信息化项目建设支出预算标准',
    code: '（试行）',
    region: '江苏',
    level: 'provincial',
    org: '江苏省财政厅',
    summary: '江苏省省级政务信息化项目建设支出预算标准（试行）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sd-lu1',
    category: '软件开发',
    name: '山东省省级政务信息化建设项目支出预算编制标准',
    code: '鲁财数〔2024〕1号',
    region: '山东',
    level: 'provincial',
    org: '山东省财政厅、山东省大数据局',
    summary: '《山东省省级政务信息化建设项目支出预算编制标准(试行)》',
    params: ['功能点单价', '调整因子', '人月费率'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2',
      '人月费率': '2.3 万元/人月'
    },
  },
  {
    id: 'hb-eb40',
    category: '软件开发',
    name: '湖北省省级信息化建设项目预算标准',
    code: '鄂财预发〔2023〕40号',
    region: '湖北',
    level: 'provincial',
    org: '湖北省财政厅',
    summary: '《湖北省省级信息化建设项目预算标准》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sx-jc182',
    category: '软件开发',
    name: '省直部门信息化建设项目支出预算方案编制规范和预算编制标准',
    code: '晋财行〔2020〕182号',
    region: '山西',
    level: 'provincial',
    org: '山西省财政厅',
    summary: '《省直部门信息化建设项目支出预算方案编制规范和预算编制标准》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gx-gz102',
    category: '软件开发',
    name: '广西壮族自治区本级政务信息化建设和运维项目预算支出标准',
    code: '桂财建〔2023〕102号',
    region: '广西',
    level: 'provincial',
    org: '广西壮族自治区财政厅',
    summary: '《广西壮族自治区本级政务信息化建设和运维项目预算支出标准》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'fj-spec',
    category: '软件开发',
    name: '福建省政务信息化项目建设造价评估规范',
    code: '—',
    region: '福建',
    level: 'provincial',
    org: '福建省数字福建建设领导小组',
    summary: '《福建省政务信息化项目建设造价评估规范》、《福建省政务信息化项目购买服务造价评估规范》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'ah-spec',
    category: '软件开发',
    name: '安徽省级政务信息化项目概算编制及审核要点',
    code: '（试行）',
    region: '安徽',
    level: 'provincial',
    org: '安徽省数据资源管理局',
    summary: '《安徽省级政务信息化项目概算编制及审核要点(试行)》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gz-qz7',
    category: '软件开发',
    name: '贵州省省级政务信息系统项目预算支出标准',
    code: '黔财工[2023]7号',
    region: '贵州',
    level: 'provincial',
    org: '贵州省财政厅',
    summary: '《贵州省省级政务信息系统项目预算支出标准(试行)》、《软件开发费用测算规范》（DB52/T 1653—2022）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-hn2026',
    category: '软件开发',
    name: '海南省政务信息化项目投资编制标准',
    code: '2026年修订版',
    region: '海南',
    level: 'provincial',
    org: '海南省发展和改革委员会等',
    summary: '《海南省政务信息化项目投资编制标准》（2026 年修订版）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'jx-db36-2096',
    category: '软件开发',
    name: '江西省政务信息化项目软件费用测算规范',
    code: 'DB36/T 2096—2024',
    region: '江西',
    level: 'provincial',
    org: '江西省市场监督管理局',
    summary: '《江西省省本级信息系统建设及运维服务开支管理暂行办法》（赣信办[2019]41号）、《政务信息化项目软件费用测算规范》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sn-spec',
    category: '软件开发',
    name: '陕西省省级政务信息化项目投资编制指南（建设类）',
    code: '（试行）',
    region: '陕西',
    level: 'provincial',
    org: '陕西省工业和信息化厅',
    summary: '《陕西省省级政务信息化项目投资编制指南（建设类）（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'ha-yu105',
    category: '软件开发',
    name: '河南省省级政务信息化建设项目支出预算标准',
    code: '豫财预〔2024〕105号',
    region: '河南',
    level: 'provincial',
    org: '河南省财政厅',
    summary: '《关于省级政务信息化建设项目支出预算标准的规定》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hlj-hb16',
    category: '软件开发',
    name: '黑龙江省省级信息化建设项目预算支出标准',
    code: '黑财办[2025]16号',
    region: '黑龙江',
    level: 'provincial',
    org: '黑龙江省财政厅',
    summary: '《黑龙江省省级信息化建设项目预算支出标准》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'nmg-nc1449',
    category: '软件开发',
    name: '内蒙古自治区本级政务信息化建设项目预算支出标准',
    code: '内财预〔2024〕1449号',
    region: '内蒙古',
    level: 'provincial',
    org: '内蒙古自治区财政厅',
    summary: '《内蒙古自治区本级政务信息化建设项目预算支出标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'ln-ln54',
    category: '软件开发',
    name: '辽宁省省级政务信息化建设项目预算支出标准',
    code: '辽财预〔2021〕54号',
    region: '辽宁',
    level: 'provincial',
    org: '辽宁省财政厅',
    summary: '《辽宁省省级政务信息化建设项目预算支出标准规定（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xz-xz68',
    category: '软件开发',
    name: '西藏自治区本级政务信息化项目建设和运维费用预算支出标准',
    code: '藏财建〔2024〕68号',
    region: '西藏',
    level: 'provincial',
    org: '西藏自治区财政厅',
    summary: '《西藏自治区本级政务信息化项目 建设和运维费用预算支出标准》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sh-t108',
    category: '软件开发',
    name: '上海市软件开发项目造价评估规范',
    code: 'T/SHMHZQ 108—2021',
    region: '上海',
    level: 'provincial',
    org: '上海市闵行区中小企业协会',
    summary: '《软件开发项目造价评估规范》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'he-db13-2106',
    category: '软件开发',
    name: '河北省软件开发项目造价评估规范',
    code: 'DB 13/T 2106—2014',
    region: '河北',
    level: 'provincial',
    org: '河北省质量技术监督局',
    summary: '《软件开发项目造价评估规范》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xj-t036',
    category: '软件开发',
    name: '新疆维吾尔自治区定制化软件开发费用测算实施指南',
    code: 'T/XJSIA 036—2025',
    region: '新疆',
    level: 'provincial',
    org: '新疆软件行业协会',
    summary: '《定制化软件开发费用测算实施指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },

  // ===== 军用 / 行业 =====
  {
    id: 'mil-4h',
    category: '军用软件',
    name: '军用软件计价规范',
    code: '（4号文）',
    region: '军用',
    level: 'military',
    org: '中央军委装备发展部',
    summary: '《军用软件计价规范（试行）》（4号文）、GJB 10162-2021《军用软件计价功能项识别方法》',
    params: ['功能项识别', '计价参数', '调整因子'],
    paramValues: {
      '功能项识别': '—',
      '计价参数': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'dl-2015',
    category: '电力行业',
    name: '电力信息化软件工程度量规范',
    code: 'DL/T 2015-2019',
    region: '电力行业',
    level: 'industry',
    org: '国家能源局',
    summary: '《电力信息化软件工程度量规范》',
    params: ['功能点计数', '基准生产率', '调整因子'],
    paramValues: {
      '功能点计数': '按项目实际测算',
      '基准生产率': '8.5 FP/人月',
      '调整因子': '0.8 ~ 1.2'
    },
  },

  // ===== 市级 / 区级 =====
  {
    id: 'sc-cd',
    category: '软件开发',
    name: '成都市智慧蓉城建设项目资金测算评审导则',
    code: '2025版',
    region: '四川-成都',
    level: 'municipal',
    org: '成都市政务服务管理和网络理政办公室',
    summary: '《成都市智慧蓉城建设项目资金测算评审导则》（2025版）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sn-xa',
    category: '软件开发',
    name: '西安市软件开发项目成本测算指南',
    code: 'DB 6101/T 3222—2025',
    region: '陕西-西安',
    level: 'municipal',
    org: '西安市市场监督管理局',
    summary: '《软件开发项目成本测算指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sd-jn',
    category: '软件开发',
    name: '济南市政务信息化项目软件开发功能点法费用测算指南',
    code: '（2024年9月30日）',
    region: '山东-济南',
    level: 'municipal',
    org: '济南市大数据局、济南市财政局',
    summary: '《政务信息化项目软件开发功能点法费用测算指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'yn-km',
    category: '软件开发',
    name: '昆明市应用软件定制开发成本测算指南',
    code: 'DB5301/T 102-2024',
    region: '云南-昆明',
    level: 'municipal',
    org: '昆明市市场监督管理局',
    summary: '《应用软件定制开发成本测算指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'fj-xm',
    category: '软件开发',
    name: '厦门市政务信息化项目造价评估规范',
    code: '厦工信信息〔2022〕304号',
    region: '福建-厦门',
    level: 'municipal',
    org: '厦门市工业和信息化局、厦门市财政局',
    summary: '《厦门市工业和信息化局 厦门市财政局关于印发厦门市政务信息化项目造价评估规范（试行）的通知》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-cs',
    category: '软件开发',
    name: '长沙市财政评审中心政府投资信息化项目评审指南',
    code: '长财评综〔2023〕12号',
    region: '湖南-长沙',
    level: 'municipal',
    org: '长沙市财政评审中心',
    summary: '《长沙市财政评审中心政府投资信息化项目评审指南》、《信息化项目结算评审工作指引(试行)》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hb-yz',
    category: '软件开发',
    name: '宜昌市市级政务信息化项目支出定额标准',
    code: '宜数盟〔2026〕4号',
    region: '湖北-宜昌',
    level: 'municipal',
    org: '宜昌市数据局',
    summary: '《宜昌市市级政务信息化项目支出定额标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-yy',
    category: '软件开发',
    name: '益阳市市本级政府投资信息化项目预算编制与财政评审工作指南',
    code: '益财评[2024]346号',
    region: '湖南-益阳',
    level: 'municipal',
    org: '益阳市财政局',
    summary: '《益阳市市本级政府投资信息化项目预算编制与财政评审工作指南（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-hy',
    category: '软件开发',
    name: '衡阳市市本级政府投资信息化项目评审指南',
    code: '（试行）',
    region: '湖南-衡阳',
    level: 'municipal',
    org: '衡阳市财政局',
    summary: '《衡阳市市本级政府投资信息化项目评审指南（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-cd',
    category: '软件开发',
    name: '常德市市级信息化建设项目初步设计方案编制规范和支出预算编制标准',
    code: '常行审发[2023]07号',
    region: '湖南-常德',
    level: 'municipal',
    org: '常德市行政审批服务局',
    summary: '《市级信息化建设项目初步设计方案编制规范和支出预算编制标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-dg',
    category: '软件开发',
    name: '东莞市政府投资信息化项目造价指南',
    code: '2024年8月',
    region: '广东-东莞',
    level: 'municipal',
    org: '东莞市政府投资项目评审中心',
    summary: '《东莞市政府投资信息化项目造价指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'jx-gz',
    category: '软件开发',
    name: '赣州市本级政府投资数字化项目费用编制指南',
    code: '（2026年3月13日实施）',
    region: '江西-赣州',
    level: 'municipal',
    org: '赣州市财政局、赣州市政务服务和数据管理局',
    summary: '《赣州市本级政府投资数字化项目费用编制指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'zj-ls',
    category: '密码应用',
    name: '丽水市信息系统商用密码应用成本测算指南',
    code: 'T/LSZX 0012—2025',
    region: '浙江-丽水',
    level: 'municipal',
    org: '丽水市质量协会',
    summary: '《信息系统商用密码应用成本测算指南》',
    params: ['密码应用成本', '调整因子'],
    paramValues: {
      '密码应用成本': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-qy',
    category: '软件开发',
    name: '清远市市级政务信息化服务项目立项审批细则',
    code: '—',
    region: '广东-清远',
    level: 'municipal',
    org: '清远市政务服务和数据管理局',
    summary: '《清远市市级政务信息化服务项目立项审批细则(试行)》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-fs',
    category: '软件开发',
    name: '佛山市政务信息化项目概算编制指南',
    code: '2023年版',
    region: '广东-佛山',
    level: 'municipal',
    org: '佛山市财政局',
    summary: '佛山市政务信息化项目概算编制指南（2023年版）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'zj-qz',
    category: '软件开发',
    name: '衢州市市本级数字化项目建设支出预算限额标准',
    code: '衢财审〔2025〕2号',
    region: '浙江-衢州',
    level: 'municipal',
    org: '衢州市财政局',
    summary: '《衢州市市本级数字化项目建设支出预算限额标准(试行)》',
    params: ['功能点单价', '限额标准'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '限额标准': '按官方发布文件'
    },
  },
  {
    id: 'zj-wz',
    category: '软件开发',
    name: '温州市政务信息化项目软件开发费用测算规范',
    code: 'DB 3303/T 059-2023',
    region: '浙江-温州',
    level: 'municipal',
    org: '温州市市场监督管理局',
    summary: '《政务信息化项目软件开发费用测算规范》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gx-lz',
    category: '软件开发',
    name: '柳州市本级信息化建设项目预算支出标准',
    code: '柳财审〔2020〕16号',
    region: '广西-柳州',
    level: 'municipal',
    org: '柳州市财政局',
    summary: '《柳州市本级信息化建设项目预算支出标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-xz',
    category: '软件开发',
    name: '徐州市市级政务信息化建设及运行维护项目支出预算标准',
    code: '徐财评〔2021〕5号',
    region: '江苏-徐州',
    level: 'municipal',
    org: '徐州市财政局',
    summary: '《徐州市市级政务信息化建设及运行维护项目支出预算标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-yc',
    category: '软件开发',
    name: '盐城市信息化项目造价评估报告编制指南',
    code: '2024',
    region: '江苏-盐城',
    level: 'municipal',
    org: '盐城市财政局',
    summary: '盐城市信息化项目造价评估报告编制指南（2024）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sn-yl',
    category: '软件开发',
    name: '榆林市信息化建设类项目投资编制指南',
    code: '2023年6月',
    region: '陕西-榆林',
    level: 'municipal',
    org: '榆林市委网信办、榆林市智慧局',
    summary: '《榆林市信息化建设类项目投资编制指南》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-wx',
    category: '软件开发',
    name: '无锡市市级政务信息化建设及运行维护项目预算支出标准',
    code: '2024修订版',
    region: '江苏-无锡',
    level: 'municipal',
    org: '无锡市政府投资评审中心',
    summary: '《无锡市市级政务信息化建设及运行维护项目预算支出标准(2024修订版)》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sc-nc',
    category: '软件开发',
    name: '南充市信息化项目费用测算标准',
    code: '—',
    region: '四川-南充',
    level: 'municipal',
    org: '南充市财政局',
    summary: '根据政府申请公开资料设置相关数值',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sx-jc',
    category: '软件开发',
    name: '晋城市信息化建设项目方案和预算编制规范',
    code: '晋市财发〔2022〕15号',
    region: '山西-晋城',
    level: 'municipal',
    org: '晋城市财政局、晋城市行政审批服务管理局、晋城市大数据应用局',
    summary: '《晋城市信息化建设项目方案和预算编制规范（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sx-ll',
    category: '软件开发',
    name: '吕梁市市直部门信息化建设项目支出预算方案编制规范和预算编制标准',
    code: '吕财行〔2023〕169号',
    region: '山西-吕梁',
    level: 'municipal',
    org: '吕梁市财政局',
    summary: '《市直部门信息化建设项目支出预算方案编制规范和预算编制标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sx-cz',
    category: '软件开发',
    name: '长治市市直部门政务信息化建设项目预算编制规范和预算编制标准',
    code: '长财行〔2022〕25号',
    region: '山西-长治',
    level: 'municipal',
    org: '长治市财政局',
    summary: '《长治市市直部门政务信息化建设项目预算编制规范和预算编制标准(试行)》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'nmg-erdos',
    category: '软件开发',
    name: '鄂尔多斯市本级政务信息化建设项目预算支出标准',
    code: '鄂政数发〔2026〕20号',
    region: '内蒙古-鄂尔多斯',
    level: 'municipal',
    org: '鄂尔多斯市政务服务与数据管理局',
    summary: '《鄂尔多斯市本级政务信息化建设项目预算支出标准（试行）》',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'hn-cs-xc',
    category: '信创适配',
    name: '长沙市政府投资建设信息化项目信创适配预算支出标准',
    code: '长财评综[2025]35号',
    region: '湖南-长沙-信创适配',
    level: 'municipal',
    org: '长沙市财政评审中心',
    summary: '《长沙市政府投资建设信息化项目信创适配预算支出标准》',
    params: ['信创适配单价', '调整因子'],
    paramValues: {
      '信创适配单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },

  // ===== 信创适配 =====
  {
    id: 'xc-bscea004',
    category: '信创适配',
    name: '信息技术应用创新信息系统适配改造成本度量',
    code: 'T/BSCEA004-2024',
    region: '全国（北京软件造价联盟）',
    level: 'industry',
    org: '北京软件造价评估技术创新联盟',
    summary: '《信息技术应用创新信息系统适配改造成本度量》',
    params: ['适配改造单价', '调整因子'],
    paramValues: {
      '适配改造单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-sc-db',
    category: '信创适配',
    name: '四川省信息技术应用创新项目费用测算标准（数据库适配）',
    code: 'T/SCSIA 0018—2025',
    region: '四川',
    level: 'provincial',
    org: '四川省软件行业协会',
    summary: '《四川省信息技术应用创新项目费用测算标准》（数据库适配）',
    params: ['数据库适配单价', '调整因子'],
    paramValues: {
      '数据库适配单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-sc-code',
    category: '信创适配',
    name: '四川省信息技术应用创新项目费用测算标准（代码重构）',
    code: 'T/SCSIA 0018—2025',
    region: '四川',
    level: 'provincial',
    org: '四川省软件行业协会',
    summary: '《四川省信息技术应用创新项目费用测算标准》（代码重构）',
    params: ['代码重构单价', '调整因子'],
    paramValues: {
      '代码重构单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-js-db32',
    category: '信创适配',
    name: '江苏省信息技术应用创新软件适配改造成本评估规范',
    code: 'DB32/T 4935—2024',
    region: '江苏',
    level: 'provincial',
    org: '江苏省市场监督管理局',
    summary: 'DB32/T 4935—2024 信息技术应用创新软件适配改造成本评估规范',
    params: ['适配改造单价', '调整因子'],
    paramValues: {
      '适配改造单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-nb-t001',
    category: '信创适配',
    name: '宁波市信息技术应用创新软件成本测算规范',
    code: 'T/NBCF 001-2023',
    region: '宁波',
    level: 'municipal',
    org: '宁波市计算机学会',
    summary: '《信息技术应用创新软件成本测算规范》（信创）',
    params: ['信创软件单价', '调整因子'],
    paramValues: {
      '信创软件单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-wx-t001',
    category: '信创适配',
    name: '无锡市软件及信息化工程造价测算规范',
    code: 'T/WXIA 001—2022',
    region: '江苏-无锡',
    level: 'municipal',
    org: '无锡市信息化协会',
    summary: '《软件及信息化工程造价测算规范 V1.0》（团标）',
    params: ['功能点单价', '调整因子'],
    paramValues: {
      '功能点单价': '1100 元/FP',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'xc-bj-sql',
    category: '信创适配',
    name: '信息技术应用创新信息系统适配改造成本度量（SQL语法适配）',
    code: 'T/BSCEA004-2024',
    region: '全国（北京软件造价联盟）',
    level: 'industry',
    org: '北京软件造价评估技术创新联盟',
    summary: '《信息技术应用创新信息系统适配改造成本度量》（SQL 语法适配）',
    params: ['SQL适配单价', '调整因子'],
    paramValues: {
      'SQL适配单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },

  // ===== 运维费用 =====
  {
    id: 'sd-lu3',
    category: '运维费用',
    name: '山东省省级政务信息化运维项目支出预算编制标准',
    code: '鲁财数〔2024〕3号',
    region: '山东',
    level: 'provincial',
    org: '山东省财政厅、山东省大数据局',
    summary: '《山东省省级政务信息化运维项目支出预算编制标准（试行）》',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-yc82-yw',
    category: '运维费用',
    name: '广东省省级政务信息化服务预算编制标准（运维服务分册）',
    code: '粤财行[2019]82号',
    region: '广东',
    level: 'provincial',
    org: '广东省财政厅',
    summary: '《广东省省级政务信息化服务预算编制标准(试行)运维服务分册》',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gx-gz102-yw',
    category: '运维费用',
    name: '广西壮族自治区本级政务信息化建设和运维项目预算支出标准（运维）',
    code: '桂财建〔2023〕102号',
    region: '广西',
    level: 'provincial',
    org: '广西壮族自治区财政厅',
    summary: '广西壮族自治区财政厅关于印发《广西壮族自治区本级政务信息化建设和运维项目预算支出标准》的通知（运维部分）',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'sx-db14-2163',
    category: '运维费用',
    name: '山西省信息化项目软件运维费用测算指南',
    code: 'DB 14/T 2163-2020',
    region: '山西',
    level: 'provincial',
    org: '山西省市场监督管理局',
    summary: '《信息化项目软件运维费用测算指南》',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-xz-yw',
    category: '运维费用',
    name: '徐州市市级政务信息化运行维护项目支出预算标准',
    code: '徐财评〔2021〕5号',
    region: '江苏-徐州',
    level: 'municipal',
    org: '徐州市财政局',
    summary: '《徐州市市级政务信息化建设及运行维护项目支出预算标准（试行）》（运维部分）',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'js-wx-yw',
    category: '运维费用',
    name: '无锡市软件及信息化工程造价测算规范（运维）',
    code: 'T/WXIA 001—2022',
    region: '江苏-无锡',
    level: 'municipal',
    org: '无锡市信息化协会',
    summary: '《软件及信息化工程造价测算规范 V1.0》（运维部分）',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
  {
    id: 'gd-fs-yw',
    category: '运维费用',
    name: '佛山市政务信息化项目概算编制指南（运维）',
    code: '2023年版',
    region: '广东-佛山',
    level: 'municipal',
    org: '佛山市财政局',
    summary: '佛山市政务信息化项目概算编制指南（2023年版）（运维部分）',
    params: ['运维单价', '调整因子'],
    paramValues: {
      '运维单价': '—',
      '调整因子': '0.8 ~ 1.2'
    },
  },
]
