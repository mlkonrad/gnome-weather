import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';

// Pure formatting helpers shared by indicator.js/weatherClient.js (Shell
// process only — see prefs.js's own comment on why it doesn't import this).

function windArrows(_) {
    return [
        '', `${_('VAR')} `, '↓ ', '↙ ', '↙ ', '↙ ', '← ', '↖ ', '↖ ', '↖ ',
        '↑ ', '↗ ', '↗ ', '↗ ', '→ ', '↘ ', '↘ ', '↘ ', '- ',
    ];
}

/**
 * Resolves an icon name to its symbolic or full-color variant.
 *
 * @param {string} iconName - a GWeather/freedesktop icon name, symbolic or not
 * @param {boolean} symbolic - whether the symbolic variant should be returned
 * @returns {string} the resolved icon name
 */
export function iconType(iconName, symbolic) {
    if (!iconName)
        return symbolic ? '-symbolic' : '';

    if (iconName.includes('-symbolic'))
        return symbolic ? iconName : iconName.replace('-symbolic', '');

    return symbolic ? `${iconName}-symbolic` : iconName;
}

/**
 * Formats a forecast date relative to today ("Today", "Tomorrow", a weekday,
 * or a full date), capitalized.
 *
 * @param {GLib.DateTime} today - the current local date
 * @param {GLib.DateTime} date - the forecast date to label
 * @param {Function} _ - gettext translation function
 * @returns {string} the relative day label
 */
export function dayName(today, date, _) {
    const oneDay = 86400;
    const startOfToday = GLib.DateTime.new_local(
        today.get_year(), today.get_month(), today.get_day_of_month(), 0, 0, 0);
    const delta = date.to_unix() - startOfToday.to_unix();

    if (delta < 0 && delta > -oneDay)
        return _('Yesterday');
    if (delta >= 0 && delta < oneDay)
        return _('Today');
    if (delta >= oneDay && delta < oneDay * 2)
        return _('Tomorrow');

    const name = delta >= oneDay * 2 && delta < oneDay * 7
        ? date.format('%A') : date.format('%a, %x');
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Formats a time in either 12-hour or 24-hour style.
 *
 * @param {GLib.DateTime} date - the time to format
 * @param {string} clockFormat - '12h' or '24h'
 * @returns {string} the formatted time
 */
export function localeTime(date, clockFormat) {
    return clockFormat === '12h' ? date.format('%l:%M %p') : date.format('%R');
}

/**
 * Formats a temperature value with its unit suffix.
 *
 * @param {GWeather.TemperatureUnit} unit - the unit `temp` is expressed in
 * @param {number} temp - the temperature value
 * @param {Function} _ - gettext translation function
 * @returns {string} the formatted temperature
 */
export function temperatureString(unit, temp, _) {
    const value = Math.round(temp).toLocaleString();
    switch (unit) {
    case GWeather.TemperatureUnit.FAHRENHEIT:
        return _('%s °F').replace('%s', value);
    case GWeather.TemperatureUnit.CENTIGRADE:
        return _('%s °C').replace('%s', value);
    case GWeather.TemperatureUnit.KELVIN:
        return _('%s K').replace('%s', value);
    default:
        return _('Unknown');
    }
}

/**
 * Formats a wind speed and direction, or '-' if no valid reading exists.
 *
 * @param {GWeather.SpeedUnit} unit - the unit `speed` is expressed in
 * @param {boolean} valid - whether GWeather reported a usable wind reading
 * @param {number} speed - the wind speed value
 * @param {number} directionIndex - GWeather's wind-direction index (-1 for none)
 * @param {boolean} useArrows - show direction as arrows instead of letters
 * @param {Function} _ - gettext translation function
 * @returns {string} the formatted wind string
 */
export function windString(unit, valid, speed, directionIndex, useArrows, _) {
    if (!valid)
        return '-';

    const value = (Math.round(speed * 10) / 10).toLocaleString();
    const direction = (useArrows ? windArrows(_) : windLetters(_))[directionIndex + 1];

    switch (unit) {
    case GWeather.SpeedUnit.KNOTS:
        return _('$d$s knots').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.MPH:
        return _('$d$s mph').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.KPH:
        return _('$d$s km/h').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.MS:
        return _('$d$s m/s').replace('$d', direction).replace('$s', value);
    case GWeather.SpeedUnit.BFT:
        return _('$dBeaufort $s').replace('$d', direction).replace('$s', value);
    default:
        return _('Unknown');
    }
}

function windLetters(_) {
    return [
        '', `${_('VAR')} `, `${_('N')} `, `${_('NNE')} `, `${_('NE')} `, `${_('ENE')} `,
        `${_('E')} `, `${_('ESE')} `, `${_('SE')} `, `${_('SSE')} `, `${_('S')} `,
        `${_('SSW')} `, `${_('SW')} `, `${_('WSW')} `, `${_('W')} `, `${_('WNW')} `,
        `${_('NW')} `, `${_('NNW')} `, '- ',
    ];
}
