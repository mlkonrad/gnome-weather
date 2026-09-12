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

export function iconType(iconName, symbolic) {
    if (!iconName)
        return symbolic ? '-symbolic' : '';

    if (iconName.includes('-symbolic'))
        return symbolic ? iconName : iconName.replace('-symbolic', '');

    return symbolic ? `${iconName}-symbolic` : iconName;
}

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

export function localeTime(date, clockFormat) {
    return clockFormat === '12h' ? date.format('%l:%M %p') : date.format('%R');
}

export function temperatureString(unit, temp, _) {
    const value = (Math.round(temp * 10) / 10).toLocaleString();
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

export function windString(unit, speed, directionIndex, useArrows, _) {
    if (!speed)
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
