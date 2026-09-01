#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读分析 device_prices_seed.json，为「设备库范式化拆分」提供决策依据。

背景：现有 device_prices 是一张大宽表，单价在每行重复存储，导致改价需改 N 行（更新异常）。
计划拆成 devices(设备主数据) / stations(站点层级) / station_devices(站点-设备对照，仅存数量) 三张表。

本脚本不写任何文件、不连数据库、不改数据，仅统计：
  1) 规模与冗余率：大表行数 vs 去重后的真实设备数
  2) 「全站设备汇总」这类汇总行占比（这些行是各子站合计，若直接进对照表会重复计金额）
  3) 合价口径：现有 total_price 是否等于 qty × unit_price（决定是否采用「查询时计算」）
  4) 同名设备多单价情况（决定设备唯一键口径）
"""
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, 'server', 'seed', 'device_prices_seed.json')

with open(SEED, 'r', encoding='utf-8') as f:
    rows = json.load(f)

total = len(rows)
print(f'=== 种子规模 ===')
print(f'大表总行数: {total}')

# 1) 设备去重（按 分类+子分类+名称+品牌型号+单位+单价 视为同一设备）
dev_keys = {}
for r in rows:
    key = (
        r.get('category') or '',
        r.get('subcategory') or '',
        r.get('name') or '',
        r.get('brand_model') or '',
        r.get('unit') or '',
        round(float(r['unit_price']), 6) if r.get('unit_price') is not None else None,
    )
    dev_keys[key] = dev_keys.get(key, 0) + 1

print(f'\n=== 冗余率（设备去重）===')
print(f'去重后设备数(分类+子分类+名称+品牌型号+单位+单价): {len(dev_keys)}')
print(f'压缩比: {total / max(1, len(dev_keys)):.1f} 行/设备  → 即单价平均被重复存储这么多次')

# 仅按 名称+品牌型号 去重（口径更宽松）
dev_name = {}
for r in rows:
    key = ((r.get('name') or ''), (r.get('brand_model') or ''))
    dev_name[key] = dev_name.get(key, 0) + 1
print(f'去重后设备数(仅名称+品牌型号): {len(dev_name)}')

# 2) 站点层级
stations = set()
subsites = set()
for r in rows:
    st = r.get('station') or ''
    sb = r.get('subsite') or ''
    if st:
        stations.add(st)
    if sb:
        subsites.add((st, sb))
print(f'\n=== 站点层级 ===')
print(f'站点(管理处)数: {len(stations)}')
print(f'(站点,子站)组合数: {len(subsites)}')

# 3) 汇总行检测：「全站设备汇总」是各子站合计，不能当明细进对照表
summary_rows = [r for r in rows if (r.get('subsite') or '') == '全站设备汇总']
print(f'\n=== 汇总行（重复计金额风险）===')
print(f'"全站设备汇总" 行数: {len(summary_rows)}  占比 {len(summary_rows)/total*100:.1f}%')
by_st = defaultdict(int)
for r in summary_rows:
    by_st[r.get('station') or ''] += 1
for st, c in sorted(by_st.items()):
    print(f'  - {st}: {c} 行')

# 4) 合价口径核对：total_price ?= qty * unit_price
checked = 0
consistent = 0
inconsistent = []
missing = 0
for r in rows:
    qty = r.get('qty')
    up = r.get('unit_price')
    tp = r.get('total_price')
    if qty is None or up is None or tp is None:
        missing += 1
        continue
    checked += 1
    calc = float(qty) * float(up)
    diff = abs(calc - float(tp))
    # 允许 0.01 元绝对误差 或 0.5% 相对误差（浮点/四舍五入）
    tol = max(0.01, abs(float(tp)) * 0.005)
    if diff <= tol:
        consistent += 1
    else:
        inconsistent.append((r.get('station'), r.get('name'), qty, up, tp, calc, diff))

print(f'\n=== 合价口径核对（total_price ?= qty × unit_price）===')
print(f'可核对行数: {checked}   字段缺失跳过: {missing}')
print(f'一致(误差<=0.01元或0.5%): {consistent}  不一致: {len(inconsistent)}')
if inconsistent:
    print('不一致样例(前10):')
    for s, n, q, u, t, c, d in inconsistent[:10]:
        print(f'  {s} | {n} | 数量={q} 单价={u} 现有合价={t} 计算={c:.2f} 差={d:.2f}')

# 5) 同名设备不同单价（设备唯一键口径风险）
name_prices = defaultdict(set)
for r in rows:
    if r.get('unit_price') is None:
        continue
    name_prices[(r.get('name') or '', r.get('brand_model') or '')].add(round(float(r['unit_price']), 2))
multi = {k: v for k, v in name_prices.items() if len(v) > 1}
print(f'\n=== 同名(名称+品牌型号)存在多个不同单价的设备组 ===')
print(f'组数: {len(multi)}')
for k, v in list(multi.items())[:8]:
    print(f'  {k[0]} / {k[1]}: {sorted(v)[:6]}')

print('\n完成（本脚本为只读分析，未修改任何数据）')
