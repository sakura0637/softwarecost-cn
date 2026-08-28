import pdfplumber, re, json

FILES = {
    "shandong": "C:/Users/lenovo/Desktop/标准(2)/标准/《山东省省级政务信息化建设项目支出预算编制标准（试行）》.pdf",
    "jiangxi": "C:/Users/lenovo/Desktop/标准(2)/标准/DB36T+2096-2024政务信息化项目软件费用测算规范.pdf",
    "henan_dev": "C:/Users/lenovo/Desktop/标准(2)/标准/《豫财预〔2024〕105号关于省级政务信息化建设项目支出预算标准的规定》.pdf",
    "henan_maint": "C:/Users/lenovo/Desktop/标准(2)/标准/6_ 河南省财政厅关于印发《关于省级信息化运行维护项目支出预算标准的规定（试行）》的通知（豫财预〔2020〕67号）(1).pdf",
    "beijing_maint": "C:/Users/lenovo/Desktop/预算编制/标准/信息化项目软件运维费用测算规范-北京地标.pdf",
    "shanxi_maint": "C:/Users/lenovo/Desktop/预算编制/标准/信息化项目软件运维费用测算指南-山西省.pdf",
}

KW = ["人月费率", "人工成本", "人月折算", "折算系数", "功能点", "调整因子", "应用类型", "开发平台",
      "开发团队", "非功能", "规模变更", "复用", "生产率", "元/人月", "万元", "VAF", "复杂度",
      "ILF", "EIF", "EI", "EO", "EQ", "权重", "运维级别", "完整性级别", "安全等级", "团队经验"]

for key, path in FILES.items():
    print("\n" + "="*60)
    print(key, "->", path.split("/")[-1])
    print("="*60)
    try:
        with pdfplumber.open(path) as pdf:
            # collect tables that look like adjustment factor / weight tables
            cnt = 0
            for i, page in enumerate(pdf.pages):
                tbls = page.extract_tables()
                for ti, tb in enumerate(tbls):
                    flat = " ".join(" ".join(c or "" for c in r) for r in tb)
                    if re.search(r"调整因子|权值|权重|费率|元/人月|人月折算|复杂度|运维级别|完整性级别", flat):
                        # print compact
                        rows = [" | ".join((c or "").strip() for c in r) for r in tb]
                        # only print tables with factor-like numbers
                        if re.search(r"0\.[0-9]|1\.[0-9]|[1-9]\.[0-9]", flat):
                            print(f"\n[页{i+1} 表{ti}]")
                            for r in rows[:10]:
                                if r.strip():
                                    print("   ", r[:150])
                            cnt += 1
                            if cnt >= 6: break
                if cnt >= 6: break
    except Exception as e:
        print("ERR", e)
