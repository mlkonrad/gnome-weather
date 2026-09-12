# gnome-weather dev notes

Fork of [Neroth/gnome-shell-extension-weather](https://github.com/Neroth/gnome-shell-extension-weather),
ported 2026-09-12 from its original ~2013-era `imports.lang`/`Mainloop`/
autotools shape to current GNOME Shell (ESM, `GObject.registerClass`) and
`libgweather-4`, under a new fork identity (`gnome-weather@mlkonrad.github.com`).

## Local install is a symlink

`~/.local/share/gnome-shell/extensions/gnome-weather@mlkonrad.github.com` is
a **symlink** to this repo (not a copy) — editing files here is editing what
GNOME Shell loads, no separate deploy step.

To reload after a code change (schema changes need the compile step too):

```bash
glib-compile-schemas schemas/ --strict   # only needed after editing schemas/*.xml
gnome-extensions disable gnome-weather@mlkonrad.github.com
gnome-extensions enable gnome-weather@mlkonrad.github.com
```

`schemas/gschemas.compiled` is generated and gitignored — always regenerate
it in place after touching the `.xml` schema.

## GNOME Shell module caching caveat

`disable`/`enable` does not reliably reload changed `extension.js`/
`indicator.js`/`weatherClient.js`/`helpers.js` code in every GNOME Shell
session (observed on Shell 50 — the old module can stay cached even across a
clean disable/enable cycle). If behavior still looks stale after reloading,
a full log out/in is the sure fix — GNOME Shell can't restart in place on
Wayland like it can on X11 (`Alt+F2` → `r`).

`prefs.js` runs in a separate process (`org.gnome.Shell.Extensions`), so
changes there just need the Settings window closed and reopened — no
logout needed, and no cross-contamination with the Shell-process reload
caveat above.

CSS-only changes to `stylesheet.css` are also picked up by the same
`gnome-extensions disable`/`enable` cycle, or a full logout if that proves
unreliable.

## libgweather-4 migration notes

This extension moved from `libgweather-3` to `libgweather-4` as part of the
port. Verified against the actually-installed `libgweather-4.6.0` typelib
(not assumed from older docs/memory of GWeather 3) — some of this is
genuinely non-obvious and easy to get wrong silently:

- Units schema: `org.gnome.GWeather` → `org.gnome.GWeather4` (same key
  names: `temperature-unit`, `speed-unit`, `pressure-unit`,
  `distance-unit`). Read via plain `new Gio.Settings({schema_id:
  'org.gnome.GWeather4'})`, not `this.getSettings()` (that's only for this
  extension's own bundled schema).
- `GWeather.Provider.YR_NO` → `GWeather.Provider.MET_NO`.
- **`GWeather.LocationEntry` (the GTK autocomplete widget) no longer
  exists.** `prefs.js`'s "add city" search is a from-scratch recursive walk
  of `GWeather.Location.get_world()` via `next_child(prev)`, filtered to
  `get_level() === GWeather.LocationLevel.CITY && has_coords()`. Benchmarked
  at ~13,000 world nodes, ~20-40ms per search — fine for live
  search-as-you-type, no index needed.
- `GWeather.Location.get_timezone()` returns a `GLib.TimeZone` **directly**
  now (`get_identifier()`, not the old `get_tzid()`) — don't re-wrap it with
  `GLib.TimeZone.new(...)`. Got this wrong on the first pass; it threw
  `TypeError: ... .get_tzid is not a function` **inside** `_renderCurrent()`,
  after the panel label/icon were already set but before the dropdown's
  detail view was built — which looked like "panel works, dropdown stuck
  loading forever" rather than an obvious crash. If that symptom ever
  recurs (panel updates, dropdown doesn't), check `journalctl --user` for a
  `JS ERROR` first, not just weather-fetch logic.
- `GWeather.Info`'s `application-id` property must be a **valid GLib
  application ID** (dotted components, e.g. `io.github.mlkonrad.gnome-weather`
  — no `@`). Setting it to something uuid-shaped fails
  `g_application_id_is_valid()`'s assertion silently (just logs a GLib
  critical, doesn't throw in JS), which cascades: `set_enabled_providers()`
  and `update()` both also assert on `application_id != NULL` and become
  no-ops — so the extension looks like it's stuck "loading" forever with no
  JS-visible error at all. Verify with
  `Gio.Application.id_is_valid('...')` before changing this constant in
  `weatherClient.js`.
- `GWeather.TemperatureUnit`/`SpeedUnit`/`PressureUnit`/`DistanceUnit` all
  start at **1** (`0` is `INVALID`) and aren't contiguous (e.g.
  `PressureUnit.ATM == 7` with gaps). `prefs.js`'s `Adw.ComboRow`s store
  explicit `[value, label]` pairs per option rather than assuming the
  combo's positional index equals the enum's integer value — don't
  "simplify" that back to a plain label array. General rule: any time a
  `GSettings` enum key backs a picker widget, check the real enum values
  first (`python3 -c "import gi; ..."` or similar) instead of assuming a
  0-based contiguous range.

## Translation workflow

`po/POTFILES.in` lists the files gettext scans (`helpers.js`, `indicator.js`,
`prefs.js` — `extension.js`/`weatherClient.js` have no translatable
strings). After changing any translatable string:

```bash
cd po
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ \
  --package-name=gnome-weather --copyright-holder="gnome-weather contributors" \
  --output=gnome-weather@mlkonrad.github.com.pot --files-from=POTFILES.in \
  --add-comments --no-wrap
for f in *.po; do
  msgmerge --quiet --previous --backup=none --update "$f" gnome-weather@mlkonrad.github.com.pot
done
cd ..
for f in po/*.po; do
  lang=$(basename "$f" .po)
  mkdir -p "locale/$lang/LC_MESSAGES"
  msgfmt "$f" -o "locale/$lang/LC_MESSAGES/gnome-weather@mlkonrad.github.com.mo"
done
```

**Gotcha, verified 2026-09-12**: `msgmerge`'s fuzzy-matching will match a
short new string (e.g. `"km/h"`) against an old *unrelated, longer template*
string that shares a substring (`"$d$s km/h"`), carrying over that old
translation's leftover placeholder tokens verbatim — which would render
literal `%s`/`$d$s` text in the UI if ever confirmed/shipped. `msgfmt`
excludes fuzzy entries from the compiled `.mo` by default (verified
empirically, not assumed), so this isn't a live bug the moment it happens,
but it's a landmine for whoever next reviews the fuzzy queue and trusts a
fluent-looking guess. **After any `msgmerge` run, audit every fuzzy entry
for a placeholder-token mismatch between `msgid` and `msgstr`
(`%s`/`%d`/`$s`/`$d`-style) across all languages** — don't just spot-check
one. Clear (blank + un-fuzzy) any mismatch; leave wording-only fuzzy
matches alone for a human translator.

`--previous` is passed to `msgmerge` so every fuzzy entry keeps a
`#| msgid "..."` comment showing what it was matched from, for easier
manual review later.

## extensions.gnome.org review guidelines

Full guide: https://gjs.guide/extensions/review-guidelines/review-guidelines.html
GNOME also publishes a second, LLM-targeted checklist aimed specifically at
AI coding assistants working on GNOME Shell extensions:
https://gjs.guide/extensions/review-guidelines/best-practices.html
Both are live URLs — fetch fresh rather than trusting this summary to stay
current. Checked clean as of 2026-09-12:

- **Lifecycle discipline**: nothing gets created, connected, or scheduled at
  module scope — only in `enable()`/`_init()`. Everything created there gets
  torn down in `disable()`/`destroy()` (the timer `GLib.source_remove()`d,
  every settings `connect()` id explicitly disconnected, the `WeatherClient`
  destroyed, instance vars set back to `null`). `WeatherExtension.enable/
  disable` in `extension.js` and `WeatherIndicator.destroy()` in
  `indicator.js` already follow this — keep new state on the same pattern.
- **No deprecated imports**: no `ByteArray`, `Lang`, or `Mainloop`. ESM
  `import`, `GLib.timeout_add_seconds`/`GLib.SOURCE_CONTINUE` natively.
- **Don't mix process libraries**: no `Gtk`/`Gdk`/`Adw` in
  `extension.js`/`indicator.js`/`weatherClient.js`/`helpers.js` (Shell
  process), no `St`/`Clutter`/`Meta` in `prefs.js` (separate GTK-only
  process). `prefs.js` deliberately does **not** import `helpers.js` or
  `weatherClient.js`, even though neither actually touches St/Clutter —
  keeping prefs fully self-contained avoids ever having to reason about
  which of its dependencies might one day gain a Shell-process-only import
  (see litsycal's own CLAUDE.md for a real incident of exactly that biting a
  sibling project).
- **No unnecessary try/catch or optional-chaining guards**: no defensive
  padding around guaranteed GObject/GLib methods. The only optional-chaining
  in this codebase (`this._client?.update()`, `this._indicator?.destroy()`,
  etc.) guards a reference that's genuinely nullable by design (not yet
  created, or already torn down), not a method call that can't fail.
- **No lifecycle guard flags**: no `_destroyed`/`_enabled` booleans — instance
  vars are nulled out on cleanup instead.
- **`destroy()` order**: timer removed first, then signals disconnected,
  then `super.destroy()` last. `destroy()` is overridden directly on
  `WeatherIndicator`, not attached via a `'destroy'` signal handler.
- **Icons**: `St.Icon`/`Gtk.Image` throughout, never emoji. No custom
  progress bars.
- **Comments**: no trivial comments restating the next line — every comment
  in this codebase exists to record a non-obvious constraint or a real
  incident (see the libgweather-4 section above for the pattern).
- **Settings pairing**: `settings-schema` in `metadata.json` pairs with a
  parameterless `this.getSettings()` call in both `extension.js` and
  `prefs.js`; the *other* two schemas in play
  (`org.gnome.GWeather4`, `org.gnome.desktop.interface`) are foreign
  system schemas, read via plain `new Gio.Settings({schema_id: '...'})` —
  don't reach for `this.getSettings()` for those.
- **Structural**: `enable()`/`disable()` stay adjacent in `extension.js`;
  logic is split by responsibility (`indicator.js` = panel UI/menu,
  `weatherClient.js` = GWeather.Info lifecycle + forecast bucketing,
  `helpers.js` = pure formatting, `prefs.js` = settings UI) rather than one
  monolithic file.
- **No `eval`, no minified/obfuscated code, no bundled binaries.**
- **No telemetry**, no clipboard access, no third-party data sharing.
- **Logging**: no `console.log`/`print` in normal operation. There used to
  be a user-toggleable "Debug Logging" setting (`console.debug` gated
  behind a switch) — removed 2026-09-12 at the user's request to keep the
  settings surface minimal; `journalctl --user` already surfaces real
  errors without it. Don't reintroduce a bespoke log file like the original
  2013 extension had (`~/.cache/weather-extension.log`, written on ~80 call
  sites) — that's exactly the kind of noisy logging this guideline flags.
- **metadata.json**: uuid `gnome-weather@mlkonrad.github.com` (own fork
  identity, not the upstream `weather-extension@xeked.com`); `shell-version`
  currently `["49", "50"]` — trim/extend as new Shell versions ship; no
  hand-set `version` key (EGO assigns that on upload).
- **GSettings schema id** stays under `org.gnome.shell.extensions.*`
  (`org.gnome.shell.extensions.gnome-weather`).
- **Attribution**: `_renderAttribution()` in `indicator.js` shows
  `GWeather.Info.get_attribution()` whenever it's non-empty. This isn't
  cosmetic — MET Norway's data (one of the three enabled providers,
  alongside METAR and OpenWeatherMap) is CC BY 4.0 licensed and requires
  "appropriate credit... in any reasonable manner." Don't remove this
  outright; it's already styled as a muted footnote
  (`.attribution` in `stylesheet.css`) rather than deleted, since
  `get_attribution()` is provider-aware and automatically returns nothing
  for providers (like METAR) that don't require it.
- **Unnecessary files for an EGO upload** (not yet pruned/verified for an
  actual submission — revisit if this is ever actually submitted): the
  guide's Recommendations discourage shipping source `.po`/`.pot` files,
  dev-only `package.json`/`eslint.config.js`, and `CLAUDE.md` itself in the
  upload zip — keep only the compiled `locale/*/LC_MESSAGES/*.mo`.
- Code must be genuinely functional, not stubs — true throughout; this was
  a from-scratch API port, not new placeholder code.

## Coding standards (matches litsycal's)

- ESM only, `GObject.registerClass` for GObject subclasses, arrow functions,
  `const`/`let` — never the original's `Lang.Class`/`arguments[0]`/C-style
  `return 0` idioms.
- Max ~200-char lines.
- Modules split by single responsibility (see Structural bullet above);
  keep new logic in the module that already owns that concern rather than
  growing `indicator.js` into a monolith again.
- Prefer reusing an existing pattern in this repo over inventing a new one
  - e.g. `_enumRow`/`_boolChoiceRow`/`_switchRow` in `prefs.js` for any new
  settings row, the `[value, label]` pair pattern for any new GSettings-enum
  picker, `GLib.timeout_add_seconds` + tracked id + `GLib.source_remove()`
  in `destroy()` for any new periodic task.
- When touching GWeather/GLib APIs whose behavior isn't already proven
  elsewhere in this codebase, verify against the actually-installed typelib
  (`python3 -c "import gi; gi.require_version('GWeather', '4.0'); ..."`)
  before writing code against assumed semantics - this file exists because
  three separate assumptions turned out wrong on the first pass (timezone
  return type, application-id format, unit enum numbering).
