import { buildPricingStandards } from '../utils/pricingStandards'

// 计价标准档位清单（供工作台「选择标准」下拉 + 计价引擎取参）
// 返回：standards（各标准档位，含 hm/rate/pdr/生产率/功能点单价/调整因子）
//      cities（各城市当年开发/运维费率，供 rateMode='city' 的标准选费率）
export default defineEventHandler(async () => {
  return await buildPricingStandards()
})
