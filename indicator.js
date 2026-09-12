import St from 'gi://St';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {WeatherClient, buildForecast} from './weatherClient.js';
import {iconType, dayName, localeTime, temperatureString, windString} from './helpers.js';

const GWEATHER_SCHEMA = 'org.gnome.GWeather4';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const REFRESH_INTERVAL_SECONDS = 30 * 60;

const WORLD = GWeather.Location.get_world();

function unpackCities(settings) {
    return settings.get_value('city').deep_unpack().map(v => WORLD.deserialize(v));
}

function clamp(index, length) {
    if (length === 0)
        return 0;
    return Math.min(Math.max(index, 0), length - 1);
}

export const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(settings, openPrefs) {
        super._init(0.25, 'Weather');

        this._settings = settings;
        this._openPrefsFn = openPrefs;
        this._gweatherSettings = new Gio.Settings({schema_id: GWEATHER_SCHEMA});
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        this._client = null;
        this._timerId = 0;

        this._buildUI();

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => this._onSettingChanged(key));
        this._gweatherChangedId = this._gweatherSettings.connect('changed', () => this._refreshReadyDisplay());
        this._interfaceChangedId = this._interfaceSettings.connect('changed::clock-format', () => this._renderCurrent());

        this._reload();
    }

    _debug(message) {
        if (this._settings.get_boolean('debug-extension'))
            console.debug(`[gnome-weather] ${message}`);
    }

    // ── UI construction ────────────────────────────────────────────────────

    _buildUI() {
        const rtl = this.get_text_direction() === Clutter.TextDirection.RTL;
        this._panelIcon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            icon_name: 'view-refresh-symbolic',
            style_class: `system-status-icon weather-icon${rtl ? '-rtl' : ''}`,
        });
        this._panelLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, text: _('Weather')});

        const topBox = new St.BoxLayout();
        topBox.add_child(this._panelIcon);
        topBox.add_child(this._panelLabel);
        this.add_child(topBox);

        this._currentBin = new St.Bin({style_class: 'current'});
        this._forecastBin = new St.Bin({style_class: 'forecast'});
        this._attributionBin = new St.Bin({style_class: 'attribution'});

        this.menu.box.add_child(this._currentBin);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._forecastBin);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.box.add_child(this._attributionBin);
        this._attributionBin.hide();
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._locationsItem = new PopupMenu.PopupSubMenuMenuItem(_('Locations'));
        this.menu.addMenuItem(this._locationsItem);

        this._reloadItem = new PopupMenu.PopupMenuItem(_('Reload Weather Information'));
        this._reloadItem.connect('activate', () => this._client?.update());
        this._reloadItem.hide();
        this.menu.addMenuItem(this._reloadItem);

        const prefsItem = new PopupMenu.PopupMenuItem(_('Weather Settings'));
        prefsItem.connect('activate', () => this._openPrefsFn());
        this.menu.addMenuItem(prefsItem);
    }

    // ── Settings plumbing ───────────────────────────────────────────────────

    _onSettingChanged(key) {
        switch (key) {
        case 'city':
        case 'actual-city':
            this._reload();
            break;
        case 'use-symbolic-icons':
            this._refreshReadyDisplay();
            break;
        case 'position-in-panel':
            // handled by the owning extension, which recreates the indicator
            break;
        default:
            this._renderCurrent();
        }
    }

    _refreshReadyDisplay() {
        this._renderCurrent();
        this._renderForecast();
    }

    _cities() {
        return unpackCities(this._settings);
    }

    _actualCityIndex(cities = this._cities()) {
        return clamp(this._settings.get_int('actual-city'), cities.length);
    }

    // ── Weather fetching ────────────────────────────────────────────────────

    _reload() {
        this._client?.destroy();
        this._client = null;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        const cities = this._cities();
        this._renderLocations(cities);

        if (!cities.length) {
            this._setState('no-location');
            return;
        }

        const location = cities[this._actualCityIndex(cities)];
        this._setState('loading');

        this._client = new WeatherClient(location, () => {
            this._debug(`updated: ${location.get_city_name()}`);
            this._renderReady();
        });
        this._reloadItem.show();
        this._client.update();

        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
            this._client?.update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setState(state) {
        this._state = state;
        this._forecastBin.hide();
        this._attributionBin.hide();
        this._reloadItem.hide();

        switch (state) {
        case 'no-location':
            this._setPanelIcon('weather-clear');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('No location configured')}));
            break;
        case 'loading':
            this._setPanelIcon('view-refresh');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('Loading weather')}));
            break;
        case 'error':
            this._setPanelIcon('weather-severe-alert');
            this._panelLabel.text = _('Weather');
            this._currentBin.set_child(new St.Label({text: _('No weather information')}));
            break;
        }
    }

    _setPanelIcon(name) {
        this._panelIcon.icon_name = iconType(name, this._settings.get_boolean('use-symbolic-icons'));
    }

    _renderReady() {
        if (!this._client || !this._client.info.is_valid()) {
            this._setState('error');
            return;
        }
        this._state = 'ready';
        this._renderCurrent();
        this._renderForecast();
        this._renderAttribution();
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    _renderCurrent() {
        if (this._state !== 'ready' || !this._client)
            return;

        const info = this._client.info;
        const symbolic = this._settings.get_boolean('use-symbolic-icons');
        const temperatureUnit = this._gweatherSettings.get_enum('temperature-unit');
        const speedUnit = this._gweatherSettings.get_enum('speed-unit');
        const clockFormat = this._interfaceSettings.get_string('clock-format');
        const conditions = info.get_conditions() === '-' ? info.get_sky() : info.get_conditions();

        this._setPanelIcon(info.get_icon_name());

        let panelText = '';
        if (this._settings.get_boolean('show-comment-in-panel'))
            panelText += conditions;
        if (this._settings.get_boolean('show-comment-in-panel') && this._settings.get_boolean('show-text-in-panel'))
            panelText += _(', ');
        if (this._settings.get_boolean('show-text-in-panel'))
            panelText += temperatureString(temperatureUnit, info.get_value_temp(temperatureUnit)[1], _);
        this._panelLabel.text = panelText || _('Weather');

        const icon = new St.Icon({
            icon_size: 72,
            icon_name: iconType(info.get_icon_name(), symbolic),
            style_class: 'weather-current-icon',
        });

        const location = new St.Label({text: `${info.get_location().get_city_name()}${_(', ')}${conditions}`});
        const summary = new St.Label({
            text: temperatureString(temperatureUnit, info.get_value_apparent(temperatureUnit)[1], _),
            style_class: 'weather-current-summary',
        });

        const tz = info.get_location().get_timezone();
        const sunrise = localeTime(GLib.DateTime.new_from_unix_local(info.get_value_sunrise()[1]).to_timezone(tz), clockFormat);
        const sunset = localeTime(GLib.DateTime.new_from_unix_local(info.get_value_sunset()[1]).to_timezone(tz), clockFormat);
        const updated = localeTime(GLib.DateTime.new_from_unix_local(info.get_value_update()[1]).to_timezone(GLib.TimeZone.new_local()), clockFormat);

        const infoBox = new St.BoxLayout({style_class: 'weather-current-infobox'});
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('weather-clear', symbolic), style_class: 'weather-sunrise-icon'}));
        infoBox.add_child(new St.Label({text: sunrise}));
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('weather-clear-night', symbolic), style_class: 'weather-sunset-icon'}));
        infoBox.add_child(new St.Label({text: sunset}));
        infoBox.add_child(new St.Icon({icon_size: 15, icon_name: iconType('view-refresh', symbolic), style_class: 'weather-build-icon'}));
        infoBox.add_child(new St.Label({text: updated}));

        const summaryBox = new St.BoxLayout({vertical: true, style_class: 'weather-current-summarybox'});
        summaryBox.add_child(location);
        summaryBox.add_child(summary);
        summaryBox.add_child(infoBox);

        const captions = new St.BoxLayout({vertical: true, style_class: 'weather-current-databox-captions'});
        const values = new St.BoxLayout({vertical: true, style_class: 'weather-current-databox-values'});
        const dataBox = new St.BoxLayout({style_class: 'weather-current-databox'});
        dataBox.add_child(captions);
        dataBox.add_child(values);

        const wind = info.get_value_wind(speedUnit);
        const rows = [
            [_('Feels like'), temperatureString(temperatureUnit, info.get_value_apparent(temperatureUnit)[1], _)],
            [_('Visibility'), `${info.get_visibility()}`],
            [_('Humidity'), `${info.get_humidity()}`],
            [_('Pressure'), `${info.get_pressure()}`],
            [_('Wind'), windString(speedUnit, wind[1], wind[2], this._settings.get_boolean('wind-direction'), _)],
        ];
        for (const [caption, value] of rows) {
            captions.add_child(new St.Label({text: caption}));
            values.add_child(new St.Label({text: value}));
        }

        const detailBox = new St.BoxLayout();
        detailBox.add_child(summaryBox);
        detailBox.add_child(dataBox);

        const box = new St.BoxLayout({style_class: 'weather-current-iconbox'});
        box.add_child(icon);
        box.add_child(detailBox);
        this._currentBin.set_child(box);
    }

    _renderForecast() {
        if (this._state !== 'ready' || !this._client)
            return;

        const info = this._client.info;
        const symbolic = this._settings.get_boolean('use-symbolic-icons');
        const temperatureUnit = this._gweatherSettings.get_enum('temperature-unit');
        const days = buildForecast(info, temperatureUnit);
        const today = GLib.DateTime.new_now_local();

        if (!days.length) {
            this._forecastBin.hide();
            return;
        }

        const row = new St.BoxLayout();
        for (const day of days) {
            const icon = new St.Icon({
                icon_size: 32,
                icon_name: iconType(day.icon, symbolic),
                style_class: 'weather-forecast-icon',
            });
            const minmax = new St.BoxLayout({vertical: true, style_class: 'weather-forecast-minmax'});
            minmax.add_child(new St.Label({
                text: `↑ ${temperatureString(temperatureUnit, day.maxTemp, _)}`,
                style_class: 'weather-forecast-temp-max',
            }));
            minmax.add_child(new St.Label({
                text: `↓ ${temperatureString(temperatureUnit, day.minTemp, _)}`,
                style_class: 'weather-forecast-temp-min',
            }));

            const iconMinMax = new St.BoxLayout({style_class: 'weather-forecast-iconminmax'});
            iconMinMax.add_child(icon);
            iconMinMax.add_child(minmax);

            const iconMinMaxBin = new St.Bin({style_class: 'weather-forecast-minmax-box'});
            iconMinMaxBin.set_child(iconMinMax);

            const dayBox = new St.BoxLayout({vertical: true, style_class: 'weather-forecast-daybox'});
            dayBox.add_child(new St.Label({text: dayName(today, day.date, _), style_class: 'weather-forecast-day'}));

            const column = new St.BoxLayout({vertical: true, style_class: 'weather-forecast-box'});
            column.add_child(iconMinMaxBin);
            column.add_child(dayBox);

            row.add_child(column);
        }

        const scroll = new St.ScrollView({
            style_class: 'weather-forecasts',
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        scroll.add_child(row);

        this._forecastBin.set_child(scroll);
        this._forecastBin.show();
    }

    _renderAttribution() {
        if (this._state !== 'ready' || !this._client) {
            this._attributionBin.hide();
            return;
        }

        const text = (this._client.info.get_attribution() ?? '').replace(/<[^>]+>/g, '');
        if (!text) {
            this._attributionBin.hide();
            return;
        }
        this._attributionBin.set_child(new St.Label({text}));
        this._attributionBin.show();
    }

    _renderLocations(cities) {
        this._locationsItem.menu.removeAll();
        this._locationsItem.visible = cities.length > 1;

        const actual = this._actualCityIndex(cities);
        cities.forEach((city, index) => {
            const item = new PopupMenu.PopupMenuItem(city.get_city_name());
            if (index === actual)
                item.setOrnament(PopupMenu.Ornament.DOT);
            item.connect('activate', () => this._settings.set_int('actual-city', index));
            this._locationsItem.menu.addMenuItem(item);
        });
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._client?.destroy();
        this._client = null;

        this._settings.disconnect(this._settingsChangedId);
        this._gweatherSettings.disconnect(this._gweatherChangedId);
        this._interfaceSettings.disconnect(this._interfaceChangedId);

        super.destroy();
    }
});
