#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
解析桌面「价格汇总/现有汇总/」下 10 个 *设备台账*.xlsx，
抽取有单价的真实设备行（跳过分类小计行/表头/站名标题），
输出为 D:\softwarecost\data\device_prices_seed.json，供水网数智造价系统灌库。

列布局（按已验证的台账结构）：
  0 序号 | 1 设备名称 | 2 单位 | 3 品牌型号 | 4 数量 | 5 备注 | 6 单价（元） | 7 合价（元）
分类标题行特征：序号为大纲号(如 1.0 / 1.1.1) 且 单价为空。
"""
import openpyxl, os, glob, re, json

BASE = r"C:\Users\lenovo\Desktop\价格汇总\现有汇总"
OUT = r"D:\softwarecost\server\seed\device_prices_seed.json"


def parse_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("，", "").replace("元", "")
    if s == "":
        return None
    try:
        return float(s)
    except Exception:
        return None


def is_outline(seq):
    if seq is None:
        return False
    s = str(seq).strip()
    return bool(re.match(r"^\d+(\.\d+)*$", s)) and "." in s


def clean_cat(name):
    if not name:
        return ""
    return re.sub(r"^\d+(\.\d+)*\s*", "", str(name)).strip()


records = []
stats = {}

for f in sorted(glob.glob(os.path.join(BASE, "*设备台账*.xlsx"))):
    site = re.sub(r"设备台账.*$", "", os.path.basename(f)).strip()
    wb = openpyxl.load_workbook(f, data_only=True, read_only=True)
    cnt = 0
    for ws in wb.worksheets:
        subsite = ws.title
        cur_cat = "未分类"
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            seq = row[0] if len(row) > 0 else None
            name = row[1] if len(row) > 1 else None
            unit = row[2] if len(row) > 2 else None
            brand = row[3] if len(row) > 3 else None
            qty = row[4] if len(row) > 4 else None
            remark = row[5] if len(row) > 5 else None
            price = row[6] if len(row) > 6 else None
            total = row[7] if len(row) > 7 else None

            # 跳过表头行
            if name == "设备名称":
                continue
            # 跳过全空行
            if all(v is None or (isinstance(v, str) and v.strip() == "") for v in row):
                continue

            # 分类标题行（大纲号 + 单价空）
            if is_outline(seq) and parse_num(price) is None:
                if name:
                    cur_cat = clean_cat(name) or cur_cat
                continue

            # 设备行：有单价
            p = parse_num(price)
            if p is not None:
                records.append(
                    {
                        "station": site,
                        "subsite": subsite,
                        "category": cur_cat,
                        "name": str(name).strip() if name else "",
                        "unit": str(unit).strip() if unit else "",
                        "brand_model": str(brand).strip() if brand else "",
                        "qty": parse_num(qty),
                        "unit_price": p,
                        "total_price": parse_num(total),
                        "remark": str(remark).strip() if remark else "",
                    }
                )
                cnt += 1
    wb.close()
    stats[site] = cnt

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fp:
    json.dump(records, fp, ensure_ascii=False, indent=1)

print("总设备条数:", len(records))
print("各站条数:")
for k, v in stats.items():
    print(f"  {k}: {v}")
