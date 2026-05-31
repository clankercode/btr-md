# Rust render pipeline per-stage timings

- Branch: feat/incremental-rendering, release build, ITERS=25 (WARMUP=3), means in ms.
- Pipeline: `pmd_core::emit::render_string`. Stages: byte_to_line, parse+emit (event loop + footnotes assembly), ammonia_build (builder construction), ammonia_clean, strip_nonces, total. `ipc` = `serde_json::to_string(&RenderResult)`.
- NOTE: footnotes stage folded into parse+emit (negligible, not separable without refactor); reported as 0.

## Composition: prose

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 18 | 18 | 207 | 0.0048 | 0.0898 | 0.0131 | 0.4598 | 0.0024 | 0.5727 | 0.0153 |
| 100KB | 100 | 171 | 177 | 1980 | 0.0239 | 0.7959 | 0.0278 | 4.3808 | 0.0228 | 5.2570 | 0.1475 |
| 500KB | 500 | 863 | 891 | 9873 | 0.1324 | 4.7785 | 0.0414 | 24.9899 | 0.1480 | 30.0980 | 0.9220 |
| 1MB | 1024 | 1778 | 1835 | 20151 | 0.2459 | 9.3596 | 0.0449 | 52.0280 | 0.3419 | 62.0294 | 1.7538 |
| 2MB | 2048 | 3569 | 3682 | 40230 | 0.4607 | 19.0387 | 0.0389 | 96.5715 | 0.6251 | 116.7464 | 3.7537 |

## Composition: fenced-code

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 16 | 16 | 92 | 0.0064 | 0.0493 | 0.0101 | 0.4050 | 0.0014 | 0.4743 | 0.0132 |
| 100KB | 100 | 160 | 160 | 904 | 0.0532 | 0.4566 | 0.0203 | 3.9676 | 0.0169 | 4.5191 | 0.1219 |
| 500KB | 500 | 804 | 804 | 4454 | 0.2906 | 3.0330 | 0.0380 | 25.1855 | 0.1591 | 28.7147 | 0.7188 |
| 1MB | 1024 | 1646 | 1646 | 9078 | 0.6145 | 6.7403 | 0.0475 | 50.3311 | 0.2578 | 58.0000 | 1.6305 |
| 2MB | 2048 | 3297 | 3297 | 18118 | 1.1236 | 11.8153 | 0.0434 | 90.0930 | 0.4502 | 103.5359 | 2.8224 |

## Composition: table

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 71 | 72 | 1073 | 0.0071 | 0.3163 | 0.0233 | 2.3257 | 0.0114 | 2.6894 | 0.0836 |
| 100KB | 100 | 693 | 700 | 10101 | 0.0479 | 3.4690 | 0.0429 | 25.4513 | 0.1317 | 29.1511 | 0.7575 |
| 500KB | 500 | 3462 | 3493 | 49432 | 0.2200 | 17.7366 | 0.0454 | 125.3706 | 0.7223 | 144.1054 | 4.6182 |
| 1MB | 1024 | 7098 | 7161 | 100122 | 0.4016 | 40.2070 | 0.0472 | 280.8719 | 1.5771 | 323.1156 | 9.8376 |
| 2MB | 2048 | 14168 | 14294 | 198616 | 0.7588 | 79.0855 | 0.0516 | 531.5659 | 2.9324 | 614.4053 | 19.6685 |

## Composition: mermaid

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 19 | 19 | 69 | 0.0080 | 0.0631 | 0.0118 | 0.5570 | 0.0213 | 0.6638 | 0.0182 |
| 100KB | 100 | 187 | 187 | 636 | 0.0672 | 0.5418 | 0.0303 | 5.7071 | 0.1825 | 6.5366 | 0.1684 |
| 500KB | 500 | 915 | 915 | 3013 | 0.3124 | 3.3578 | 0.0402 | 29.9916 | 1.0076 | 34.7189 | 0.8485 |
| 1MB | 1024 | 1867 | 1867 | 6097 | 0.6266 | 6.3363 | 0.0462 | 54.4563 | 1.5694 | 63.0451 | 1.5993 |
| 2MB | 2048 | 3711 | 3711 | 11997 | 1.1794 | 12.5759 | 0.0421 | 101.9708 | 3.0614 | 118.8407 | 3.0819 |

## Composition: math

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 43 | 38 | 156 | 0.0067 | 0.1077 | 0.0144 | 1.0774 | 0.0647 | 1.2739 | 0.0325 |
| 100KB | 100 | 415 | 370 | 1484 | 0.0494 | 1.1819 | 0.0425 | 14.1372 | 0.7228 | 16.1413 | 0.3436 |
| 500KB | 500 | 2026 | 1813 | 7154 | 0.2226 | 5.5854 | 0.0370 | 60.9451 | 2.8004 | 69.5988 | 1.6570 |
| 1MB | 1024 | 4137 | 3703 | 14556 | 0.4554 | 11.6906 | 0.0551 | 123.1028 | 5.6952 | 141.0086 | 3.2731 |
| 2MB | 2048 | 8184 | 7331 | 28660 | 0.9208 | 21.8869 | 0.0485 | 238.3840 | 10.4289 | 271.6797 | 6.2762 |

## Composition: mixed

| size | in KB | html KB | out KB | blocks | byte_to_line | parse+emit | ammonia_build | ammonia_clean | strip_nonces | total | ipc |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10KB | 10 | 34 | 34 | 405 | 0.0100 | 0.1758 | 0.0180 | 1.1383 | 0.0495 | 1.3956 | 0.0450 |
| 100KB | 100 | 340 | 339 | 3825 | 0.0512 | 1.5123 | 0.0297 | 10.3754 | 0.4665 | 12.4421 | 0.3258 |
| 500KB | 500 | 1699 | 1695 | 18766 | 0.2396 | 9.4705 | 0.0351 | 59.4331 | 2.0088 | 71.1964 | 1.7779 |
| 1MB | 1024 | 3483 | 3475 | 38108 | 0.4523 | 18.5684 | 0.0439 | 116.1194 | 4.0455 | 139.2393 | 4.1961 |
| 2MB | 2048 | 6967 | 6951 | 75897 | 0.8973 | 36.2021 | 0.0383 | 222.5353 | 7.4409 | 267.1234 | 8.4780 |

## Summary

### Dominant stage per (composition, size)

| composition | size | dominant stage | its ms | % of total | total ms |
|---|---|---|---:|---:|---:|
| prose | 10KB | ammonia_clean | 0.4598 | 80% | 0.5727 |
| prose | 100KB | ammonia_clean | 4.3808 | 83% | 5.2570 |
| prose | 500KB | ammonia_clean | 24.9899 | 83% | 30.0980 |
| prose | 1MB | ammonia_clean | 52.0280 | 84% | 62.0294 |
| prose | 2MB | ammonia_clean | 96.5715 | 83% | 116.7464 |
| fenced-code | 10KB | ammonia_clean | 0.4050 | 85% | 0.4743 |
| fenced-code | 100KB | ammonia_clean | 3.9676 | 88% | 4.5191 |
| fenced-code | 500KB | ammonia_clean | 25.1855 | 88% | 28.7147 |
| fenced-code | 1MB | ammonia_clean | 50.3311 | 87% | 58.0000 |
| fenced-code | 2MB | ammonia_clean | 90.0930 | 87% | 103.5359 |
| table | 10KB | ammonia_clean | 2.3257 | 86% | 2.6894 |
| table | 100KB | ammonia_clean | 25.4513 | 87% | 29.1511 |
| table | 500KB | ammonia_clean | 125.3706 | 87% | 144.1054 |
| table | 1MB | ammonia_clean | 280.8719 | 87% | 323.1156 |
| table | 2MB | ammonia_clean | 531.5659 | 87% | 614.4053 |
| mermaid | 10KB | ammonia_clean | 0.5570 | 84% | 0.6638 |
| mermaid | 100KB | ammonia_clean | 5.7071 | 87% | 6.5366 |
| mermaid | 500KB | ammonia_clean | 29.9916 | 86% | 34.7189 |
| mermaid | 1MB | ammonia_clean | 54.4563 | 86% | 63.0451 |
| mermaid | 2MB | ammonia_clean | 101.9708 | 86% | 118.8407 |
| math | 10KB | ammonia_clean | 1.0774 | 85% | 1.2739 |
| math | 100KB | ammonia_clean | 14.1372 | 88% | 16.1413 |
| math | 500KB | ammonia_clean | 60.9451 | 88% | 69.5988 |
| math | 1MB | ammonia_clean | 123.1028 | 87% | 141.0086 |
| math | 2MB | ammonia_clean | 238.3840 | 88% | 271.6797 |
| mixed | 10KB | ammonia_clean | 1.1383 | 82% | 1.3956 |
| mixed | 100KB | ammonia_clean | 10.3754 | 83% | 12.4421 |
| mixed | 500KB | ammonia_clean | 59.4331 | 83% | 71.1964 |
| mixed | 1MB | ammonia_clean | 116.1194 | 83% | 139.2393 |
| mixed | 2MB | ammonia_clean | 222.5353 | 83% | 267.1234 |

### Scaling (ms per stage, mixed composition, by size)

Shows how each stage grows with input size for the `mixed` doc.

| size | in MB | parse+emit | ammonia_clean | clean/emit ratio | total | total ms/MB-in |
|---|---:|---:|---:|---:|---:|---:|
| 10KB | 0.010 | 0.1758 | 1.1383 | 6.48x | 1.3956 | 141.04 |
| 100KB | 0.098 | 1.5123 | 10.3754 | 6.86x | 12.4421 | 127.24 |
| 500KB | 0.488 | 9.4705 | 59.4331 | 6.28x | 71.1964 | 145.79 |
| 1MB | 1.000 | 18.5684 | 116.1194 | 6.25x | 139.2393 | 139.22 |
| 2MB | 2.000 | 36.2021 | 222.5353 | 6.15x | 267.1234 | 133.54 |

