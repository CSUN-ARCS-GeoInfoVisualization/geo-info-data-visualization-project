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

## 2026-06-29T10:24:46 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(395) -343 wind<=0 (1402 rows)
- candidate: AUROC=0.9003 Brier=0.1246 physics_ok=True
- production: AUROC=0.9691 Brier=0.0839 physics_ok=True
- reasons: AUROC regressed 0.9691 -> 0.9003; Brier regressed 0.0839 -> 0.1246

## 2026-07-06T09:58:21 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(461) -343 wind<=0 (1468 rows)
- candidate: AUROC=0.8929 Brier=0.1243 physics_ok=True
- production: AUROC=0.9586 Brier=0.0919 physics_ok=True
- reasons: AUROC regressed 0.9586 -> 0.8929; Brier regressed 0.0919 -> 0.1243

## 2026-07-13T08:50:41 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(512) -343 wind<=0 (1519 rows)
- candidate: AUROC=0.8932 Brier=0.1232 physics_ok=True
- production: AUROC=0.9519 Brier=0.0979 physics_ok=True
- reasons: AUROC regressed 0.9519 -> 0.8932; Brier regressed 0.0979 -> 0.1232

## 2026-07-20T08:42:48 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(512) -343 wind<=0 (1519 rows)
- candidate: AUROC=0.8932 Brier=0.1232 physics_ok=True
- production: AUROC=0.9519 Brier=0.0979 physics_ok=True
- reasons: AUROC regressed 0.9519 -> 0.8932; Brier regressed 0.0979 -> 0.1232

## 2026-07-27T09:33:58 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(588) -343 wind<=0 (1594 rows)
- candidate: AUROC=0.8945 Brier=0.1185 physics_ok=True
- production: AUROC=0.9347 Brier=0.1112 physics_ok=True
- reasons: AUROC regressed 0.9347 -> 0.8945; Brier regressed 0.1112 -> 0.1185

## 2026-08-03T09:23:49 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(637) -343 wind<=0 (1643 rows)
- candidate: AUROC=0.8902 Brier=0.1158 physics_ok=True
- production: AUROC=0.9037 Brier=0.1347 physics_ok=True
- reasons: AUROC regressed 0.9037 -> 0.8902

## 2026-08-10T07:12:22 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(694) -343 wind<=0 (1699 rows)
- candidate: AUROC=0.8797 Brier=0.1204 physics_ok=True
- production: AUROC=0.8930 Brier=0.1463 physics_ok=True
- reasons: AUROC regressed 0.8930 -> 0.8797

## 2026-08-17T06:35:17 — PROMOTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(767) -343 wind<=0 (1772 rows)
- candidate: AUROC=0.8684 Brier=0.1226 physics_ok=True
- production: AUROC=0.8692 Brier=0.1646 physics_ok=True
- reasons: candidate clears physics + metric gate

## 2026-08-24T06:38:28 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(839) -343 wind<=0 (1843 rows)
- candidate: AUROC=0.8709 Brier=0.1214 physics_ok=True
- production: AUROC=0.9613 Brier=0.0903 physics_ok=True
- reasons: AUROC regressed 0.9613 -> 0.8709; Brier regressed 0.0903 -> 0.1214

## 2026-08-31T12:12:22 — REJECTED
- dataset: california_2020_kbdi.csv(1350) + california_daily.csv(897) -343 wind<=0 (1901 rows)
- candidate: AUROC=0.8749 Brier=0.1181 physics_ok=True
- production: AUROC=0.9634 Brier=0.0863 physics_ok=True
- reasons: AUROC regressed 0.9634 -> 0.8749; Brier regressed 0.0863 -> 0.1181

