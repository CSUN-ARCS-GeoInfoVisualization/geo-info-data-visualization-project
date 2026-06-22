# Retrain Log

## 2026-06-03T20:32:42 — PROMOTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(57) (1407 rows)
- candidate: AUROC=0.8881 Brier=0.1287 physics_ok=True
- production: AUROC=0.9914 Brier=0.0320 physics_ok=False
- reasons: production model FAILS physics — metric-regression waived, promoting physically-correct candidate

## 2026-06-22T11:37:41 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(343) -343 wind<=0 (1350 rows)
- candidate: AUROC=0.9125 Brier=0.1157 physics_ok=True
- production: AUROC=0.9923 Brier=0.0638 physics_ok=True
- reasons: AUROC regressed 0.9923 -> 0.9125; Brier regressed 0.0638 -> 0.1157

