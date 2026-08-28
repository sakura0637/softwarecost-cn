#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""深挖 2025 中国软件行业基准数据：抽取城市费率表 + GBT36964 探查。"""
import pdfplumber, re
from pathlib import Path

BENCH = r"C:/Users/lenovo/Desktop/预算编制/标准/《2025年中国软件行业基准数据》.pdf"
GBT = r"C:/Users/lenovo/Desktop/预算编制/标准/GBT+36964-2018.pdf"

def show_tables(path, max_pages=60, max_tables=8):
    print(f"\n{'='*70}\n📊 {Path(path).name}\n{'='*70}")
    with pdfplumber.open(path) as pdf:
        shown = 0
        for i, page in enumerate(pdf.pages[:max_pages]):
            tbls = page.extract_tables()
            for t in tbls:
                # 只看含城市 + 数字费率 的表
                flat = "\n".join(" | ".join(str(c or "") for c in row) for row in t)
                if re.search(r"元/人月|人月费率|P50|城市|年份|费率", flat) and len(t) >= 3:
                    print(f"\n--- 表 (页{i+1}) ---")
                    for row in t[:14]:
                        print(" | ".join(str(c or "") for c in row))
                    shown += 1
                    if shown >= max_tables:
                        return

show_tables(BENCH, max_tables=6)

# GBT36964 探查：看前几页文字
print(f"\n\n{'='*70}\n🔍 GBT36964-2018 文字探查\n{'='*70}")
with pdfplumber.open(GBT) as pdf:
    for i in range(min(6, len(pdf.pages))):
        t = pdf.pages[i].extract_text() or ""
        if t.strip():
            print(f"\n[页{i+1}] 前 600 字:\n" + t[:600])
