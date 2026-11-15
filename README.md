# reef-status

Latest water readings for Werner's 850 L reef tank, read by an iPhone home-screen widget.

- `latest.json` – most recent value of each parameter, with targets (lo/hi = green band, yl/yh = amber band) and retest interval in days (`rt`). The full history lives in the Reef Water Log on Claude.
- `ReefWidget.js` – the Scriptable widget script. Copy it into a new script in the Scriptable app.

## Updating (for Claude)

When new readings are logged, update the matching entries in `latest.json`: set `prev` to the old `v`, then the new `v` and `at` (ISO time with +02:00). Set `"gt": true` for a reading above the kit's range. Update `last_water_change` after a water change, and `updated` to now. Then commit and push to `main`.
