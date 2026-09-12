import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';

// Must satisfy GLib's application-id format (dotted components, no '@') or
// gweather_info_set_application_id() silently fails its validity assertion —
// which then makes set_enabled_providers()/update() no-ops too, so weather
// data never loads (confirmed via journalctl: "assertion
// 'g_application_id_is_valid (application_id)' failed").
const APPLICATION_ID = 'io.github.mlkonrad.gnome-weather';
const CONTACT_INFO = 'https://github.com/mlkonrad/gnome-weather';

/**
 * Wraps a GWeather.Info for one location: creation, provider/contact setup,
 * and the "updated" signal. Callers own start()/destroy() symmetry.
 */
export class WeatherClient {
    constructor(location, onUpdated) {
        this._info = new GWeather.Info({location});
        this._info.set_application_id(APPLICATION_ID);
        this._info.set_contact_info(CONTACT_INFO);
        this._info.set_enabled_providers(
            GWeather.Provider.METAR | GWeather.Provider.OWM | GWeather.Provider.MET_NO);

        this._updatedId = this._info.connect('updated', () => onUpdated());
    }

    get info() {
        return this._info;
    }

    update() {
        this._info.update();
    }

    destroy() {
        this._info.disconnect(this._updatedId);
        this._info = null;
    }
}

/**
 * Groups a GWeather.Info's flat forecast list into per-day buckets with a
 * representative icon/humidity and min/max temperature, for the forecast
 * strip. Behaviorally identical to the original extension's day-bucketing:
 * pick the representative entry from whichever of afternoon/morning/evening/
 * night has data for that day, preferring afternoon.
 */
export function buildForecast(info, temperatureUnit) {
    const list = info.get_forecast_list();
    if (!list.length)
        return [];

    // GWeather.Location.get_timezone() already returns a GLib.TimeZone in
    // libgweather-4 (confirmed via introspection — it has get_identifier(),
    // not the get_tzid() the pre-port code expected), so no re-wrapping needed.
    const tz = info.get_location().get_timezone();

    const days = [];
    let lastDayOfMonth = null;

    for (const entry of list) {
        if (!entry)
            continue;

        // MET Norway's forecast list always leads with one placeholder entry
        // whose update time (and temperature) is unset - [valid, value] both
        // read (false, 0) - which would otherwise bucket as its own bogus
        // "day" dated the Unix epoch. Confirmed via a live fetch for Tallinn:
        // 1 invalid entry out of 86, always at index 0.
        const [updateValid, updateTime] = entry.get_value_update();
        if (!updateValid)
            continue;

        const date = GLib.DateTime.new_from_unix_local(updateTime).to_timezone(tz);
        if (lastDayOfMonth !== null && date.get_day_of_month() !== lastDayOfMonth)
            days.push({hours: {}, date});
        else if (days.length === 0)
            days.push({hours: {}, date});
        lastDayOfMonth = date.get_day_of_month();

        const day = days[days.length - 1];
        const temp = entry.get_value_temp(temperatureUnit)[1];

        day.hours[date.get_hour()] = entry;
        day.minTemp = day.minTemp === undefined ? temp : Math.min(day.minTemp, temp);
        day.maxTemp = day.maxTemp === undefined ? temp : Math.max(day.maxTemp, temp);
    }

    for (const day of days) {
        const entry = representativeEntry(day.hours);
        day.icon = entry?.get_icon_name() ?? '';
        day.humidity = entry?.get_humidity() ?? '';
    }

    return days;
}

/**
 * Returns a GWeather.Info's flat forecast list filtered down to entries
 * strictly after now, in chronological order, for the hour-by-hour strip.
 * Skips the same invalid placeholder entry buildForecast() does.
 */
export function buildHourlyForecast(info) {
    const list = info.get_forecast_list();
    if (!list.length)
        return [];

    const tz = info.get_location().get_timezone();
    const nowUnix = GLib.DateTime.new_now_utc().to_unix();

    const hours = [];
    for (const entry of list) {
        if (!entry)
            continue;

        const [updateValid, updateTime] = entry.get_value_update();
        if (!updateValid || updateTime <= nowUnix)
            continue;

        hours.push({date: GLib.DateTime.new_from_unix_local(updateTime).to_timezone(tz), entry});
    }
    return hours;
}

function representativeEntry(hours) {
    const buckets = [[], [], [], []]; // night, morning, afternoon, evening
    for (const [hour, entry] of Object.entries(hours)) {
        const h = Number(hour);
        if (h < 6)
            buckets[0].push(entry);
        else if (h < 12)
            buckets[1].push(entry);
        else if (h < 18)
            buckets[2].push(entry);
        else
            buckets[3].push(entry);
    }

    // Prefer afternoon, then morning, then evening, then night.
    for (const bucket of [buckets[2], buckets[1], buckets[3], buckets[0]]) {
        if (bucket.length)
            return bucket[Math.floor(bucket.length / 2)];
    }
    return null;
}
