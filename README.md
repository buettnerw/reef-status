# reef-status

Latest water readings for Werner's 850 L reef tank, read by an iPhone home-screen widget.

- `latest.json` – most recent value of each parameter, with targets (lo/hi = green band, yl/yh = amber band) and retest interval in days (`rt`). The full history lives in the Reef Water Log on Claude.
- `ReefWidget.js` – the Scriptable widget script. Copy it into a new script in the Scriptable app.

## Updating (for Claude)

When new readings are logged, update the matching entries in `latest.json`: set `prev` to the old `v`, then the new `v` and `at` (ISO time with +02:00). Set `"gt": true` for a reading above the kit's range. Update `last_water_change` after a water change, and `updated` to now. Then commit and push to `main`.

## Task widget

- `tasks.json` – aquarium jobs. Kinds: `test` (done automatically when `latest.json` has a reading for `param` today; interval = `days` or the parameter's `rt`), `every` (every `days`, `last` = date last done), `weekly` (`weekday`, 0 = Sunday … 6 = Saturday; the water change is auto-done from `last_water_change`), `once` (`due` date; auto-done if `param` gets a reading after `after`).
- `TaskWidget.js` – Scriptable script. Tapping the widget opens a tick-off menu; ticks are stored on the phone only.
- `BalanceWidget.js` – Scriptable script for a LARGE widget: Ca vs Alk chart with target box, "snow" zone (moves with Mg), trail of past tests and the Mg:Ca gauge. Uses `balance.history` in latest.json.

Updating (for Claude): add new jobs to `tasks.json`, delete finished `once` jobs, and set `last` on `every` jobs when Werner reports doing them (e.g. KNO3 dosing). Keep `note` short (shown on the large widget).
