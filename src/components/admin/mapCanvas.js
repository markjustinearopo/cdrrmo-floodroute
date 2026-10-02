import L from 'leaflet'

// Leaflet can remove a renderer before its paths during map teardown.
// Those paths must not schedule another paint on the destroyed canvas.
const MapCanvas = L.Canvas.extend({
  _redraw() {
    if (!this._ctx) {
      this._redrawRequest = null
      return
    }
    L.Canvas.prototype._redraw.call(this)
  },
})

export const mapCanvas = (options) => new MapCanvas(options)
