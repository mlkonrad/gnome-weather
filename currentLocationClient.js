import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather';

import {APPLICATION_ID} from './weatherClient.js';

/**
 * Tracks the user's live location via GeoClue and resolves it to the
 * nearest GWeather.Location, for use as a selectable, auto-refreshing
 * entry alongside manually-added cities.
 *
 * geoclue-2.0 is imported dynamically, only from start(), and nowhere else
 * in this codebase - a static top-of-file import would fail extension load
 * entirely for users without geoclue2 installed, even if they never touch
 * this feature.
 */
export class CurrentLocationClient {
    constructor(onCityChanged, onError) {
        this._onCityChanged = onCityChanged;
        this._onError = onError;
        this._cancellable = new Gio.Cancellable();
        this._simple = null;
        this._notifyId = 0;
        this._lastKey = null;
    }

    async start() {
        let Geoclue;
        try {
            ({default: Geoclue} = await import('gi://Geoclue'));
        } catch (e) {
            // destroy() may have run while the import was pending.
            if (!this._cancellable.is_cancelled())
                this._onError(e);
            return;
        }

        // CITY accuracy is all find_nearest_city() needs, and is less
        // privacy-sensitive than STREET/EXACT.
        Geoclue.Simple.new(APPLICATION_ID, Geoclue.AccuracyLevel.CITY, this._cancellable,
            (_source, result) => {
                let simple;
                try {
                    simple = Geoclue.Simple.new_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._onError(e);
                    return;
                }
                this._simple = simple;
                this._notifyId = this._simple.connect('notify::location', () => this._resolve());
                this._resolve();
            });
    }

    _resolve() {
        const location = this._simple?.get_location();
        if (!location)
            return;

        const city = GWeather.Location.get_world().find_nearest_city(location.latitude, location.longitude);
        if (!city)
            return;

        // Dedupe by resolved-city identity, not raw lat/lon - a GeoClue fix
        // that jitters but still lands on the same nearest city must not
        // trigger a redundant weather re-fetch.
        const key = city.serialize().print(true);
        if (key === this._lastKey)
            return;
        this._lastKey = key;
        this._onCityChanged(city);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._simple && this._notifyId)
            this._simple.disconnect(this._notifyId);
        this._simple = null;
        this._notifyId = 0;
        this._lastKey = null;
    }
}
