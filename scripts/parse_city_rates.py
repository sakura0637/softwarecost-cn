import json, re
from pathlib import Path

t = json.load(open('scripts/benchmark_tables_2025.json', encoding='utf-8'))

def clean_rate(v):
    # remove letters/line breaks, keep digits and dot
    v = re.sub(r'[^\d.]', '', v)
    return float(v) if v else None

def clean_name(v):
    return re.sub(r'[A-Z\\n]', '', v).strip()

def parse_city_table(tb):
    out = []
    for r in tb['rows'][1:]:
        if len(r) < 2: continue
        name = clean_name(r[0])
        rate = clean_rate(r[1])
        level = (r[2] if len(r) > 2 else '').strip()
        if name and rate:
            out.append((name, int(rate), level))
    return out

# page13 (2025 dev)
dev_2025 = parse_city_table(t[7]) + parse_city_table(t[8])
# page14/15 (2024 dev)
dev_2024 = parse_city_table(t[9]) + parse_city_table(t[10])

print('// CSBMK 2025 当前软件开发人月单价（元/人月）')
print('const CSBMK_DEV_2025 = [')
for n, r, lv in sorted(dev_2025, key=lambda x: -x[1]):
    print(f"  {{ city: '{n}', rate: {r}, cityLevel: '{lv or '未知'}' }},")
print(']')

print('\n// CSBMK 2024 当前软件开发人月单价（元/人月）')
print('const CSBMK_DEV_2024 = [')
for n, r, lv in sorted(dev_2024, key=lambda x: -x[1]):
    print(f"  {{ city: '{n}', rate: {r}, cityLevel: '{lv or '未知'}' }},")
print(']')
