---
"@noron/shared": patch
---

> Branch: fix-update-ui
> PR: https://github.com/thejustinwalsh/noron/pull/13

- `ThermalRingBuffer.trend()` default stability threshold raised from 0.5°C to 1.5°C to reduce false positives from sensor noise on SBCs (e.g. Orange Pi 5 Plus ~±0.9°C idle noise)
- `trend()` now accepts a configurable `thresholdC` parameter, allowing callers to override the threshold for their hardware

Thermal trend detection is more resilient to normal SBC idle temperature variation, preventing spurious "rising"/"falling" readings from sensor noise.
