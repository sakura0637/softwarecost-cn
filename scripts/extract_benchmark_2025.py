import pdfplumber, re, json

P = "C:/Users/lenovo/Desktop/预算编制/标准/《2025年中国软件行业基准数据》.pdf"

def row_text(r): return [ (c or "").strip() for c in r ]

def parse_city_table(tbl):
    """tbl: list of rows (each list of str). Return dict: city-> {2021:..,2022:..,...} and header years."""
    # find header row containing 城市 + years
    hdr = None
    hidx = -1
    for i, r in enumerate(tbl):
        cells = [c for c in r if c]
        joined = " ".join(cells)
        if "城市" in joined and re.search(r"202[0-9]", joined):
            hdr = cells; hidx = i; break
    if hdr is None:
        return None, None
    # years are the cells after 城市
    years = []
    for c in hdr:
        m = re.search(r"(20[0-9]{2})", c)
        if m: years.append(int(m.group(1)))
    data = {}
    for r in tbl[hidx+1:]:
        if not r or not r[0]: continue
        # first non-empty cell = city name
        city = r[0].strip()
        if not city or "城市" in city: continue
        vals = {}
        for j, y in enumerate(years):
            idx = j+1
            if idx < len(r) and r[idx]:
                raw = re.sub(r"[^\d.]", "", r[idx])
                if raw:
                    try: vals[y] = float(raw)
                    except: pass
        if vals:
            data[city] = vals
    return data, years

out = {"dev": {}, "maint": {}, "dev_years": [], "maint_years": []}

with pdfplumber.open(P) as pdf:
    for i, page in enumerate(pdf.pages):
        tbls = page.extract_tables()
        if not tbls: continue
        text = page.extract_text() or ""
        for ti, tb in enumerate(tbls):
            flat = " ".join(" ".join(c or "" for c in r) for r in tb)
            is_dev = "软件开发" in text or "软件开发人月费率" in flat
            is_maint = "运维" in text or "软件运维人月费率" in flat
            # city rate tables have 城市 + years
            if "城市" in flat and re.search(r"202[0-9]", flat):
                data, years = parse_city_table(tb)
                if data:
                    if is_maint and not is_dev:
                        out["maint"].update(data); out["maint_years"] = sorted(set(out["maint_years"]+years))
                        print(f"[页{i+1} 表{ti}] 运维城市费率: {list(data.keys())}")
                    else:
                        # prefer title detection; if both, put dev
                        if "运维" in flat and "开发" not in flat:
                            out["maint"].update(data); out["maint_years"] = sorted(set(out["maint_years"]+years))
                            print(f"[页{i+1} 表{ti}] 运维城市费率: {list(data.keys())}")
                        else:
                            out["dev"].update(data); out["dev_years"] = sorted(set(out["dev_years"]+years))
                            print(f"[页{i+1} 表{ti}] 开发城市费率: {list(data.keys())}")

print("\n=== 开发城市数:", len(out["dev"]), "年份:", out["dev_years"])
print("=== 运维城市数:", len(out["maint"]), "年份:", out["maint_years"])
# sample
for c, v in list(out["dev"].items())[:3]:
    print(c, v)
for c, v in list(out["maint"].items())[:3]:
    print("运维", c, v)

with open("scripts/city_rates_2025.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("\n已写出 scripts/city_rates_2025.json")
