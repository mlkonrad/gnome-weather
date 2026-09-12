import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {WeatherIndicator} from './indicator.js';

const PANEL_BOXES = ['center', 'right', 'left'];

export default class WeatherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
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
