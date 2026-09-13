import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {WeatherIndicator} from './indicator.js';

const PANEL_BOXES = ['center', 'right', 'left'];

export default class WeatherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // First run only: nothing to show and 'use-current-location' has
        // never been touched, so default to current-location instead of the
        // empty "no location" placeholder. get_user_value() (not a lifecycle
        // flag) makes this fire exactly once - it stays null forever after
        // the set_boolean() below gives the key an explicit value.
        if (this._settings.get_value('city').n_children() === 0 &&
            this._settings.get_user_value('use-current-location') === null) {
            this._settings.set_boolean('use-current-location', true);
            this._settings.set_int('actual-city', -1);
        }

        this._positionChangedId = this._settings.connect(
            'changed::position-in-panel', () => this._createIndicator());
        this._createIndicator();
    }

    disable() {
        this._settings.disconnect(this._positionChangedId);
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _createIndicator() {
        this._indicator?.destroy();
        this._indicator = new WeatherIndicator(this._settings, () => this.openPreferences());

        const box = PANEL_BOXES[this._settings.get_enum('position-in-panel')];
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, box);
    }
}
