// ════════════════════════════════════════════════════════════════
// PICO · Mapa de pin obligatorio para envío a domicilio
// Google Maps JavaScript API + Places API (New)
// ════════════════════════════════════════════════════════════════

const GOOGLE_MAPS_API_KEY = 'AIzaSyDFTWAxoZ2XGDfJ2F14lEC3gOQ6-6kth7Y';
// Centro por defecto: San Salvador, El Salvador
const SHIP_MAP_DEFAULT = { lat: 13.6929, lng: -89.2182 };
const SHIP_MAP_DEFAULT_ZOOM = 12;
const SHIP_MAP_PIN_ZOOM = 17;

let _mapsLoadPromise = null;
let _shipMap = null;
let _shipMarker = null;
let _shipCoords = null; // { lat, lng } | null — obligatorio para confirmar
let _shipMapInited = false;
let _shipAutocompleteEl = null;

function loadGoogleMapsApi() {
  if (_mapsLoadPromise) return _mapsLoadPromise;
  _mapsLoadPromise = new Promise((resolve, reject) => {
    if (window.google && google.maps && typeof google.maps.importLibrary === 'function') {
      resolve();
      return;
    }
    const prev = window.__picoMapsReady;
    window.__picoMapsReady = function () {
      try { if (typeof prev === 'function') prev(); } catch (_) {}
      resolve();
    };
    const s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.src = 'https://maps.googleapis.com/maps/api/js?key='
      + encodeURIComponent(GOOGLE_MAPS_API_KEY)
      + '&v=weekly&libraries=places&loading=async&callback=__picoMapsReady';
    s.onerror = () => reject(new Error('No se pudo cargar Google Maps'));
    document.head.appendChild(s);
  });
  return _mapsLoadPromise;
}

function getShippingPin() {
  if (!_shipCoords) return null;
  const lat = Number(_shipCoords.lat);
  const lng = Number(_shipCoords.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
}

function shippingMapsLink(lat, lng) {
  return 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
}

function _setShipPinStatus(ok, detail) {
  const el = document.getElementById('shipMapStatus');
  if (!el) return;
  if (ok) {
    el.className = 'ship-map-status ok';
    el.textContent = detail || 'Ubicación marcada. Podés ajustar el pin arrastrándolo.';
  } else {
    el.className = 'ship-map-status';
    el.textContent = detail || 'Obligatorio: tocá el mapa, buscá tu dirección o usá tu ubicación.';
  }
}

function _applyShipCoords(lat, lng, opts) {
  const o = opts || {};
  _shipCoords = { lat: +Number(lat).toFixed(6), lng: +Number(lng).toFixed(6) };
  const latInput = document.getElementById('shipLat');
  const lngInput = document.getElementById('shipLng');
  if (latInput) latInput.value = String(_shipCoords.lat);
  if (lngInput) lngInput.value = String(_shipCoords.lng);

  if (_shipMap && _shipMarker) {
    const pos = { lat: _shipCoords.lat, lng: _shipCoords.lng };
    _shipMarker.setPosition(pos);
    _shipMarker.setMap(_shipMap);
    if (o.center !== false) {
      _shipMap.panTo(pos);
      if (o.zoom) _shipMap.setZoom(o.zoom);
    }
  }
  _setShipPinStatus(true);
}

function clearShippingPin() {
  _shipCoords = null;
  const latInput = document.getElementById('shipLat');
  const lngInput = document.getElementById('shipLng');
  if (latInput) latInput.value = '';
  if (lngInput) lngInput.value = '';
  if (_shipMarker) _shipMarker.setMap(null);
  _setShipPinStatus(false);
}

async function initShippingMap(saved) {
  const wrap = document.getElementById('shipMapWrap');
  const mapEl = document.getElementById('shipMap');
  if (!wrap || !mapEl) return;

  try {
    await loadGoogleMapsApi();
    await google.maps.importLibrary('maps');
    await google.maps.importLibrary('marker');
    try { await google.maps.importLibrary('places'); } catch (_) {}

    if (!_shipMap) {
      _shipMap = new google.maps.Map(mapEl, {
        center: SHIP_MAP_DEFAULT,
        zoom: SHIP_MAP_DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy'
      });

      _shipMarker = new google.maps.Marker({
        map: null,
        draggable: true,
        title: 'Arrastrá el pin a tu ubicación exacta'
      });

      _shipMarker.addListener('dragend', () => {
        const p = _shipMarker.getPosition();
        if (!p) return;
        _applyShipCoords(p.lat(), p.lng(), { center: false });
      });

      _shipMap.addListener('click', (e) => {
        if (!e || !e.latLng) return;
        _applyShipCoords(e.latLng.lat(), e.latLng.lng(), { zoom: SHIP_MAP_PIN_ZOOM });
      });

      _initPlaceAutocomplete();
      _shipMapInited = true;
    }

    // Restaurar pin guardado o limpiar
    const s = saved || {};
    const lat = Number(s.shipLat);
    const lng = Number(s.shipLng);
    if (isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      _applyShipCoords(lat, lng, { zoom: SHIP_MAP_PIN_ZOOM });
    } else {
      clearShippingPin();
      if (_shipMap) {
        _shipMap.setCenter(SHIP_MAP_DEFAULT);
        _shipMap.setZoom(SHIP_MAP_DEFAULT_ZOOM);
      }
    }

    // Recalcular tamaño (el modal a veces inicia oculto)
    setTimeout(() => {
      try { google.maps.event.trigger(_shipMap, 'resize'); } catch (_) {}
      const pin = getShippingPin();
      if (pin && _shipMap) _shipMap.setCenter(pin);
    }, 180);
  } catch (err) {
    console.warn('shipping map:', err);
    _setShipPinStatus(false, 'No se pudo cargar el mapa. Revisá la conexión o la API key.');
  }
}

function _initPlaceAutocomplete() {
  const host = document.getElementById('shipPlacesHost');
  if (!host || _shipAutocompleteEl) return;
  if (!google.maps.places || typeof google.maps.places.PlaceAutocompleteElement !== 'function') {
    host.innerHTML = '<p class="ship-map-places-fallback">Escribí tu dirección abajo y marcá el pin en el mapa.</p>';
    return;
  }

  const el = new google.maps.places.PlaceAutocompleteElement({
    includedRegionCodes: ['sv']
  });
  el.id = 'shipPlacesAutocomplete';
  el.className = 'ship-places-autocomplete';
  host.innerHTML = '';
  host.appendChild(el);
  _shipAutocompleteEl = el;

  const onSelect = async (ev) => {
    try {
      let place = null;
      if (ev && ev.placePrediction && typeof ev.placePrediction.toPlace === 'function') {
        place = ev.placePrediction.toPlace();
      } else if (ev && ev.place) {
        place = ev.place;
      }
      if (!place) return;
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'displayName'] });
      const loc = place.location;
      if (!loc) return;
      const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
      const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
      _applyShipCoords(lat, lng, { zoom: SHIP_MAP_PIN_ZOOM });

      // Prefill dirección escrita si está vacía
      const addr = document.getElementById('shipAddress');
      const formatted = place.formattedAddress || (place.displayName && (place.displayName.text || place.displayName)) || '';
      if (addr && !addr.value.trim() && formatted) addr.value = String(formatted);
    } catch (e) {
      console.warn('place select:', e);
    }
  };

  el.addEventListener('gmp-select', onSelect);
  el.addEventListener('gmp-placeselect', onSelect);
}

function useMyShippingLocation() {
  if (!navigator.geolocation) {
    showToast('Tu navegador no soporta geolocalización');
    return;
  }
  const btn = document.getElementById('shipUseLocationBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Obteniendo…'; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Usar mi ubicación'; }
      _applyShipCoords(pos.coords.latitude, pos.coords.longitude, { zoom: SHIP_MAP_PIN_ZOOM });
      showToast('Ubicación marcada');
    },
    (err) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Usar mi ubicación'; }
      showToast(err && err.code === 1
        ? 'Permiso de ubicación denegado'
        : 'No se pudo obtener tu ubicación');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}
