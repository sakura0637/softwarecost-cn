# -*- coding: utf-8 -*-
r"""解析《设备台账》站级 sheet -> 结构化基线（设备价格库对齐的输入）

背景（为什么要有这个脚本）
  「数据对齐版」台账里存在 **两种列结构**，旧解析脚本按固定列位取值 → 4 张
  「在建实体环境」sheet 的单价/合价整列错位（把备注当单价、把采购单价当合价），
  且分类为空。本脚本**按表头动态定位列位**，不再假设列序。

两种列结构（实测 161 张台账 sheet）
  A. 标准站（155 张 + 2 个细微变体）
     序号 | 设备名称 | 单位 | 品牌型号 | 数量 | 运维费单价（元） | 运维费合价（元）
  B. 在建实体环境（4 张，保定/保沧/邯郸 多一列备注）
     序号 | 设备名称 | 单位 | 品牌型号 | 数量 | 备注 | 单价（元） | 合价（元） | 运维费单价（元） | 运维费合价（元）

分类来源也分两种
  A. `1.0 工程监控` / `1.1 硬件设备` 形如 `\d+\.\d+` 的分级行
  B. 无编号的分组标题（变配电设备 / 消防工程 / 暖通工程 …），按 ZJ_GROUP_MAP 映射

输出
  _tmp_ledger/excel_ledger_v2.json   设备行（含来源列结构标记）
  _tmp_ledger/excel_sheets_v2.json   每个 sheet 的统计

用法
  python scripts/parse_device_ledger.py [台账.xlsx 路径]
"""
import json
import os
import re
import sys

import openpyxl

SRC_DEFAULT = r"C:\Users\lenovo\Desktop\运维相关\设备台账\设备台账_数据对齐版v3.4_0919 - 副本.xlsx"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_tmp_ledger")

MANAGERS = ["保沧", "廊涿", "保定", "石家庄", "衡水", "邢台", "沧州", "邯郸"]

# 在建实体环境的分组标题 -> (category, subcategory)；值为 None 表示整组跳过（费用项而非设备）
ZJ_GROUP_MAP = {
    "变配电设备": ("实体环境", "供配电"),
    "电力电缆": ("实体环境", "供配电"),
    "管材及埋件": ("实体环境", "机房工程"),
    "接地": ("实体环境", "防雷接地"),
    "照明、插座": ("实体环境", "照明"),
    "微模块机房": ("实体环境", "机房工程"),
    "通信网络及综合布线": ("实体环境", "机房工程"),
    "消防系统": ("实体环境", "消防"),
    "消防工程": ("实体环境", "消防"),
    "视频监控及安防系统": ("视频监视", "硬件设备"),
    "网络安全防护体系": ("计算机网络", "配套"),
    "监控中心": ("实体环境", "机房装修"),
    "现有监控中心": ("实体环境", "机房装修"),
    "原监控中心改为管理用房": ("实体环境", "机房装修"),
    "原值班室改为管理用房": ("实体环境", "机房装修"),
    "暖通工程": ("实体环境", "空调"),
    "给排水工程": ("实体环境", "机房工程"),
    "会议显示及扩声系统": ("大屏幕显示系统", None),
    "信息发布系统": ("大屏幕显示系统", None),
    "大屏展示及视频会商系统": ("大屏幕显示系统", None),
    # 费用项，不是设备 —— 整组跳过
    "运杂 、保险及采保费 5.13%": None,
    "运杂、保险及采保费 5.13%": None,
}

CAT_RE = re.compile(r"^\s*(\d+)\.(\d+)\s*$")
SUM_RE = re.compile(r"^(合计|小计|总计)$")
# 台账里作为分组标题出现的分类名（有的写 `4.0 实体环境`，有的只写 `38 实体环境`）
CAT_NAMES = {
    "工程监控", "视频监视", "视频监控", "计算机网络", "通信系统", "通信",
    "安全监测设备", "安全监测", "实体环境", "大屏幕显示系统", "其它",
    "UPS供电系统", "ups供电系统", "应用系统", "应用支撑及总集", "水量调度", "专用空调",
}
# 表头列名 -> 内部字段
HEAD_ALIASES = {
    "设备名称": "name",
    "单位": "unit",
    "品牌型号": "brand_model",
    "数量": "qty",
    "备注": "remark",
    "运维费单价（元）": "ops_price",
    "运维费单价(元)": "ops_price",
    "运维费合价（元）": "ops_total",
    "运维费合价(元)": "ops_total",
    "单价（元）": "buy_price",
    "单价(元)": "buy_price",
    "合价（元）": "buy_total",
    "合价(元)": "buy_total",
}


def is_ledger_sheet(name: str) -> bool:
    return name.startswith(tuple(MANAGERS)) or name == "调度中心"


def split_sheet(name: str):
    """sheet 名 -> (station, subsite)"""
    if name == "调度中心":
        return ("总调中心", "核心节点")
    m = re.match(r"^(保沧|廊涿|保定|石家庄|衡水|邢台|沧州|邯郸)管理处(.*)$", name)
    if m:
        return (m.group(1), m.group(2))
    m = re.match(r"^廊涿干渠(.*)$", name)
    if m:
        return ("廊涿", m.group(1))
    return (None, name)


def num(x):
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        s = x.strip().replace(",", "")
        try:
            return float(s)
        except ValueError:
            return None
    return None


def txt(x):
    if x is None:
        return None
    s = str(x).strip()
    return s or None


def find_header(rows):
    """返回 (表头行号(1based), {字段: 列下标})；找不到返回 (None, None)"""
    for i, r in enumerate(rows[:5], 1):
        cols = {}
        for j, c in enumerate(r):
            t = txt(c)
            if not t:
                continue
            t2 = re.sub(r"\s+", "", t)
            for k, v in HEAD_ALIASES.items():
                if re.sub(r"\s+", "", k) == t2:
                    cols.setdefault(v, j)
        if "name" in cols and "qty" in cols:
            return i, cols
    return None, None


def explode(cells, idx):
    """处理「一格挤多行」：设备名称/数量等含换行时拆成多条"""
    vals = [cells.get(i) for i in idx]
    parts = []
    for v in vals:
        s = "" if v is None else str(v)
        parts.append([p.strip() for p in s.split("\n")])
    n = max(len(p) for p in parts) if parts else 0
    if n <= 1:
        return [vals]
    out = []
    for k in range(n):
        row = []
        for p in parts:
            row.append(p[k] if k < len(p) else (p[-1] if len(p) == 1 else None))
        out.append(row)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC_DEFAULT
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    recs, stats = [], []
    skipped_groups = {}

    for ws in wb.worksheets:
        if not is_ledger_sheet(ws.title):
            continue
        station, subsite = split_sheet(ws.title)
        rows = list(ws.iter_rows(values_only=True))
        hrow, cols = find_header(rows)
        if not cols:
            print(f"  ! 未找到表头：{ws.title}")
            continue
        # cols 与 fields 同为 {字段: 列下标}；保留两个名字仅为可读性
        fields = cols
        cat = sub = grp_raw = None
        n_dev = 0
        # 判断是否「在建实体环境」型（无编号分组）
        is_zj = "buy_price" in fields or "remark" in fields

        for i, r in enumerate(rows, 1):
            if i <= hrow:
                continue
            a = txt(r[0]) if len(r) > 0 else None
            b = txt(r[1]) if len(r) > 1 else None
            get = lambda f: (r[fields[f]] if f in fields and len(r) > fields[f] else None)

            if a is None and b is None:
                continue
            if a and SUM_RE.match(a):
                continue
            if b and SUM_RE.match(re.sub(r"\s+", "", str(b))):
                continue

            # ── 分组标题 ──
            m = CAT_RE.match(a or "")
            if m:
                lvl1, lvl2 = m.group(1), m.group(2)
                if lvl2 == "0":
                    cat, sub = b, None
                else:
                    sub = b
                continue
            if is_zj and a is None and b and get("unit") is None and get("qty") is None:
                grp_raw = b
                mp = ZJ_GROUP_MAP.get(re.sub(r"\s+", "", b)) or ZJ_GROUP_MAP.get(b)
                if mp is None:
                    skipped_groups[b] = skipped_groups.get(b, 0) + 1
                    cat = sub = None
                else:
                    cat, sub = mp
                continue
            # 标准 sheet 里也有把分类名当分组标题的写法（有的写 `4.0 实体环境`，
            # 有的只写 `38 实体环境`、甚至单元格是浮点 `5.0`）→ 判据只看
            # 「名称是分类名 + 单位与数量都空」，不依赖序号形态
            if (not is_zj) and b in CAT_NAMES and get("unit") is None and get("qty") is None:
                cat, sub = b, None
                continue

            # ── 设备行 ──
            name = b
            if not name:
                continue
            qty = num(get("qty"))
            # 一格多行 → 拆
            needed = [f for f in ("name", "unit", "brand_model", "qty",
                                  "buy_price", "buy_total", "ops_price", "ops_total") if f in fields]
            idxs = [fields[f] for f in needed]
            sub_rows = explode({k: (r[k] if len(r) > k else None) for k in idxs}, idxs)
            merged = []
            for sr in sub_rows:
                d = dict(zip(needed, sr))
                nm = txt(d.get("name")) or name
                if not nm:
                    continue
                u = txt(d.get("unit"))
                q = num(d.get("qty"))
                # 续行：一个格子里换行写了两段，第二段没有单位/数量 → 并回上一行的名称
                if merged and u is None and q is None:
                    merged[-1]["name"] = (merged[-1]["name"] + " " + nm).strip()
                    continue
                merged.append({
                    "sheet": ws.title, "station": station, "subsite": subsite,
                    "category": cat, "subcategory": sub,
                    "name": nm,
                    "unit": u,
                    "brand_model": txt(d.get("brand_model")),
                    "qty": q,
                    "ops_price": num(d.get("ops_price")),
                    "ops_total": num(d.get("ops_total")),
                    "buy_price": num(d.get("buy_price")),
                    "buy_total": num(d.get("buy_total")),
                    "group": grp_raw if is_zj else None,
                    "row": i,
                })
            for rec in merged:
                recs.append(rec)
                n_dev += 1

        stats.append({"sheet": ws.title, "station": station, "subsite": subsite,
                      "header_row": hrow, "cols": cols, "is_zj": is_zj,
                      "dev_rows": n_dev,
                      "ops_total_sum": round(sum(x["ops_total"] or 0 for x in recs if x["sheet"] == ws.title), 2)})

    wb.close()
    out_dir = os.path.normpath(OUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    json.dump(recs, open(os.path.join(out_dir, "excel_ledger_v2.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    json.dump(stats, open(os.path.join(out_dir, "excel_sheets_v2.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print(f"台账 sheet : {len(stats)}")
    print(f"设备行合计 : {len(recs)}")
    print(f"运维费合价合计: {sum(x['ops_total'] or 0 for x in recs):,.0f}")
    print(f"带采购价的行  : {sum(1 for x in recs if x['buy_price'] is not None)}")
    print(f"运维费非空的行: {sum(1 for x in recs if x['ops_total'])}")
    zj = [s for s in stats if s["is_zj"]]
    print(f"\n在建实体环境型 sheet {len(zj)} 张（列结构特殊）:")
    for s in zj:
        print(f"   {s['sheet']:<24} 表头行{s['header_row']} 设备{s['dev_rows']:>4} 行  列={s['cols']}")
    if skipped_groups:
        print("\n跳过的分组（费用项，非设备）:")
        for k, v in skipped_groups.items():
            print(f"   {k}  ×{v}")


if __name__ == "__main__":
    main()
