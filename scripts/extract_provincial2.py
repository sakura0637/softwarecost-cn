import pdfplumber, re

FILES = {
    "beijing_maint": "C:/Users/lenovo/Desktop/预算编制/标准/信息化项目软件运维费用测算规范-北京地标.pdf",
    "shanxi_maint": "C:/Users/lenovo/Desktop/预算编制/标准/信息化项目软件运维费用测算指南-山西省.pdf",
    "henan_maint": "C:/Users/lenovo/Desktop/标准(2)/标准/6_ 河南省财政厅关于印发《关于省级信息化运行维护项目支出预算标准的规定（试行）》的通知（豫财预〔2020〕67号）(1).pdf",
}

for key, path in FILES.items():
    print("\n" + "="*60)
    print(key)
    print("="*60)
    try:
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                tbls = page.extract_tables()
                for ti, tb in enumerate(tbls):
                    flat = " ".join(" ".join(c or "" for c in r) for r in tb)
                    if re.search(r"调整因子|费率|元/人月|人月|权重|级别|完整|安全等级|团队经验|更新频率|支持方式|软件类型|用户规模", flat):
                        if re.search(r"0\.[0-9]|1\.[0-9]|[1-9]\.[0-9]", flat) or "元/人月" in flat:
                            print(f"\n[页{i+1} 表{ti}]")
                            for r in tb:
                                cells = [ (c or "").strip() for c in r]
                                if any(cells):
                                    print("   ", " | ".join(cells)[:150])
    except Exception as e:
        print("ERR", e)
