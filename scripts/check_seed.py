import json, collections
data = json.load(open(r"D:\softwarecost\data\device_prices_seed.json", encoding="utf-8"))
print("总条数:", len(data))
# 分类分布
cat = collections.Counter(d["category"] for d in data)
print("\n分类 Top 20:")
for k, v in cat.most_common(20):
    print(f"  {k!r}: {v}")
# 单价异常
zero = [d for d in data if d["unit_price"] == 0]
neg = [d for d in data if d["unit_price"] < 0]
big = [d for d in data if d["unit_price"] > 10_000_000]
print(f"\n单价=0: {len(zero)}  单价<0: {len(neg)}  单价>1000万: {len(big)}")
# 数量为空
noqty = [d for d in data if d["qty"] is None]
print("数量为空:", len(noqty))
# 名称为空
noname = [d for d in data if not d["name"]]
print("名称为空:", len(noname))
# 单价最小/最大 样例
ps = sorted(d["unit_price"] for d in data)
print("单价最小10:", ps[:10])
print("单价最大10:", ps[-10:])
# 随机抽 3 条
import random
random.seed(1)
print("\n随机样例:")
for d in random.sample(data, 5):
    print("  ", {k: d[k] for k in ("station","subsite","category","name","unit","brand_model","qty","unit_price","total_price")})
