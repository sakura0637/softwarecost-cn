import pdfplumber, json, re
from pathlib import Path

P = "C:/Users/lenovo/Desktop/预算编制/标准/《2025年中国软件行业基准数据》.pdf"
OUT = Path("D:/softwarecost/scripts/benchmark_tables_2025.json")

tables = []
with pdfplumber.open(P) as pdf:
    for i, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        for ti, tb in enumerate(page.extract_tables() or []):
            rows = [[(c or "").strip() for c in r] for r in tb]
            # skip empty
            if not any(any(c for c in r) for r in rows):
                continue
            flat = " ".join(" ".join(r) for r in rows)
            tables.append({
                "page": i+1,
                "table_index": ti,
                "text_near": text[:200],
                "rows": rows,
                "flat": flat[:300],
            })

OUT.write_text(json.dumps(tables, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"dumped {len(tables)} tables to {OUT}")
