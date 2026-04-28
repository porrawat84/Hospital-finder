import './styles.css';
import { hospitals } from './data/hospitals.js';
import { sortHospitalsByDistance } from './utils/geo.js';

const GOOGLE_API_KEY = 'AIzaSyADcTaf70pA2x8L4UsjlcKeq1zo3iApyZE';

const defaultPosition = { lat: 13.7563, lng: 100.5018 };
let userPosition = null;
let searchRadius = 5000;

let hospitalMarkers = [];
let userMarker = null;
let map = null;
let geocoder = null;
let directionsService = null;
let directionsRenderer = null;
let activeInfoWindow = null;

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="app">
    <section class="sidebar">
      <div class="brand">
        <div class="brand-icon">+</div>
        <div>
          <h1>SOS Hospital Finder</h1>
          <p>ระบบค้นหาโรงพยาบาลฉุกเฉินใกล้ตัว</p>
        </div>
      </div>

      <div class="sos-card">
        <h2>ต้องการความช่วยเหลือ?</h2>
        <p>กดปุ่ม SOS ระบบจะเปิด GPS และหาโรงพยาบาลที่ใกล้ที่สุดให้ทันที</p>
        <button class="sos-button" id="sosButton">SOS</button>
      </div>

      <div class="status" id="statusText">พร้อมใช้งาน กด SOS เพื่อเริ่มค้นหา</div>

      <div class="stats">
        <div class="stat"><span>พบทั้งหมด</span><strong id="foundCount">—</strong></div>
        <div class="stat"><span>ใกล้สุด</span><strong id="nearestDistance">—</strong></div>
        <div class="stat"><span>สถานะ</span><strong id="gpsStatus">รอ GPS</strong></div>
        <div class="stat"><span>เวลาค้นหา</span><strong id="searchTime">—</strong></div>
      </div>

      <div class="filter-box">
        <label for="radiusSelect">ระยะค้นหา</label>
        <select id="radiusSelect">
          <option value="2000">2 กม.</option>
          <option value="5000" selected>5 กม.</option>
          <option value="10000">10 กม.</option>
          <option value="20000">20 กม.</option>
        </select>
      </div>

      <div class="results" id="results">
        <div class="empty">ยังไม่มีข้อมูล กดปุ่ม SOS เพื่อค้นหาโรงพยาบาลใกล้ตัว</div>
      </div>
    </section>

    <section class="map-panel">
      <div id="map"></div>
      <div class="map-note">แผนที่ใช้ Google Maps และค้นหาโรงพยาบาลจริงจาก Google Places</div>
    </section>
  </main>
`;

const sosButton = document.querySelector('#sosButton');
const radiusSelect = document.querySelector('#radiusSelect');
const statusText = document.querySelector('#statusText');
const foundCount = document.querySelector('#foundCount');
const nearestDistance = document.querySelector('#nearestDistance');
const gpsStatus = document.querySelector('#gpsStatus');
const searchTime = document.querySelector('#searchTime');
const results = document.querySelector('#results');

radiusSelect.addEventListener('change', async () => {
  searchRadius = Number(radiusSelect.value);
  setLoading(false, `เปลี่ยนระยะค้นหาเป็น ${searchRadius / 1000} กม.`);

  if (userPosition) {
    await searchNearbyHospitals();
  }
});

loadGoogleMaps()
  .then(() => {
    initMap();
    sosButton.addEventListener('click', startSOS);
  })
  .catch((error) => {
    console.error(error);
    setLoading(false, 'โหลด Google Maps ไม่สำเร็จ ตรวจสอบ API Key');
  });

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'ใส่_API_KEY_ของเธอตรงนี้') {
      reject(new Error('ยังไม่ได้ใส่ Google API Key'));
      return;
    }

    window.initGoogleMapCallback = () => resolve();

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&callback=initGoogleMapCallback&loading=async&libraries=marker&language=th&region=TH`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('โหลด Google Maps script ไม่สำเร็จ'));

    document.head.appendChild(script);
  });
}

function initMap() {
  geocoder = new google.maps.Geocoder();
  map = new google.maps.Map(document.querySelector('#map'), {
    center: defaultPosition,
    zoom: 12,
    mapId: 'sos_hospital_map',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
  });

  directionsService = new google.maps.DirectionsService();

  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    preserveViewport: false,
  });
}
function geocodePlaceId(place) {
  return new Promise((resolve) => {
    geocoder.geocode({ placeId: place.id }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const location = results[0].geometry.location;

        resolve({
          ...place,
          location: {
            latitude: location.lat(),
            longitude: location.lng(),
          },
          formattedAddress: place.formattedAddress || results[0].formatted_address,
        });
      } else {
        console.warn('Geocode failed:', place.displayName?.text, status);
        resolve(place);
      }
    });
  });
}

function startSOS() {
  setLoading(true, 'กำลังขอตำแหน่ง GPS...');

  if (!navigator.geolocation) {
    setLoading(false, 'Browser นี้ไม่รองรับ GPS');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      userPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      gpsStatus.textContent = 'เปิดแล้ว';
      showUserOnMap();
      await searchNearbyHospitals();
    },
    (error) => {
      gpsStatus.textContent = 'ไม่สำเร็จ';
      setLoading(false, `เปิด GPS ไม่สำเร็จ: ${error.message}`);
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    }
  );
}

function is24HourOrEmergency(place) {
  const types = place.types || [];

  if (types.includes('emergency_room')) return true;

  const hours = place.currentOpeningHours || place.regularOpeningHours;

  if (!hours) return true;

  const descriptions = hours.weekdayDescriptions || [];

  const has24h = descriptions.some((d) =>
    d.includes('ตลอด 24 ชั่วโมง') ||
    d.toLowerCase().includes('open 24 hours')
  );

  if (has24h) return true;

  const periods = hours.periods || [];

  const alwaysOpen =
    periods.length === 1 &&
    periods[0].open?.day === 0 &&
    periods[0].open?.hour === 0 &&
    !periods[0].close;

  if (alwaysOpen) return true;

  return false;
}

async function searchNearbyHospitals() {
  if (!userPosition) {
    setLoading(false, 'กรุณากด SOS เพื่อเปิด GPS ก่อน');
    return;
  }

  setLoading(true, `กำลังค้นหาโรงพยาบาลในระยะ ${searchRadius / 1000} กม...`);
  searchTime.textContent = '—';

  const t0 = performance.now();

  try {
    const allPlaces = await fetchAllPlaces();
    const elapsed = (performance.now() - t0).toFixed(0);

    let hospitalData = [];

  if (allPlaces.length > 0) {
  const filtered = allPlaces.filter(is24HourOrEmergency);
  const selectedPlaces = filtered.length === 0 ? allPlaces : filtered;

  const geocodedPlaces = await Promise.all(
    selectedPlaces.map((place) => geocodePlaceId(place))
  );

  hospitalData = geocodedPlaces.map(mapPlaceToHospital);
} else {
  hospitalData = hospitals;
}
    displayResults(hospitalData, elapsed, allPlaces.length === 0);
  } catch (error) {
    console.error(error);

    const elapsed = (performance.now() - t0).toFixed(0);
    displayResults(hospitals, elapsed, true);
    setLoading(false, `ค้นหาไม่สำเร็จ ใช้ข้อมูล default แทน — ${elapsed} ms`);
  }
}

async function fetchAllPlaces() {
  const FIELD_MASK =
    'places.id,places.displayName,places.formattedAddress,' +
    'places.location,places.googleMapsUri,places.nationalPhoneNumber,' +
    'places.types,places.primaryType,' +
    'places.currentOpeningHours,places.regularOpeningHours,' +
    'nextPageToken';

  const baseBody = {
    includedPrimaryTypes: ['hospital'],
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: {
          latitude: userPosition.lat,
          longitude: userPosition.lng,
        },
        radius: searchRadius,
      },
    },
    languageCode: 'th',
  };

  let allPlaces = [];
  let pageToken = null;
  let page = 0;
  const MAX_PAGES = 3;

  do {
    const body = pageToken ? { ...baseBody, pageToken } : baseBody;

    setLoading(true, `กำลังดึงข้อมูล... หน้า ${page + 1}/${MAX_PAGES}`);

    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || 'Places API error');
    }

    allPlaces = allPlaces.concat(data.places || []);
    pageToken = data.nextPageToken || null;
    page++;

    if (pageToken && page < MAX_PAGES) {
      await sleep(500);
    }
  } while (pageToken && page < MAX_PAGES);

  return allPlaces;
}
async function fetchPlaceDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask':
        'id,displayName,formattedAddress,location,googleMapsUri,nationalPhoneNumber,types,primaryType,currentOpeningHours,regularOpeningHours'
    }
  });

  const data = await res.json();

  if (!res.ok) {
    console.warn('Place Details error:', data.error?.message || data);
    return null;
  }

  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapPlaceToHospital(place) {
  const types = place.types || [];
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  const descriptions = hours?.weekdayDescriptions || [];
  const periods = hours?.periods || [];

  const hasEmergency = types.includes('emergency_room');

  const is24h =
    descriptions.some((d) =>
      d.includes('ตลอด 24 ชั่วโมง') ||
      d.toLowerCase().includes('open 24 hours')
    ) ||
    (
      periods.length === 1 &&
      periods[0].open?.day === 0 &&
      periods[0].open?.hour === 0 &&
      !periods[0].close
    );

  return {
    id: place.id,
    name: place.displayName?.text || 'ไม่ทราบชื่อโรงพยาบาล',
    address: place.formattedAddress || 'ไม่พบที่อยู่',
    phone: place.nationalPhoneNumber || '-',
    lat: place.location.latitude,
    lng: place.location.longitude,
    googleMapsUri: place.googleMapsUri,
    hasEmergency,
    is24h,
    primaryType: place.primaryType,
    types,
  };
}

function displayResults(hospitalData, elapsed, isFallback = false) {
  const sorted = sortHospitalsByDistance(hospitalData, userPosition)
    .filter((hospital) => hospital.distance * 1000 <= searchRadius);

  const nearest = sorted[0];

  foundCount.textContent = sorted.length;
  nearestDistance.textContent = nearest ? `${nearest.distance.toFixed(2)} กม.` : '—';
  searchTime.textContent = elapsed ? `${elapsed} ms` : '—';

  renderHospitalCards(sorted);
  renderHospitalMarkers(sorted);
  fitMapToResults();

  if (sorted.length === 0) {
    setLoading(false, `ไม่พบโรงพยาบาลในระยะ ${searchRadius / 1000} กม.`);
    return;
  }

  if (isFallback) {
    setLoading(false, `แสดงข้อมูล default เฉพาะในระยะ ${searchRadius / 1000} กม. จำนวน ${sorted.length} แห่ง`);
  } else {
    setLoading(false, `ค้นหาสำเร็จ พบโรงพยาบาลในระยะ ${searchRadius / 1000} กม. จำนวน ${sorted.length} แห่ง`);
  }
}

function showUserOnMap() {
  if (userMarker) {
    userMarker.map = null;
  }

  const { AdvancedMarkerElement } = google.maps.marker;

  const dot = document.createElement('div');
  dot.style.cssText = `
    width:18px;
    height:18px;
    border-radius:50%;
    background:#2563eb;
    border:3px solid #fff;
    box-shadow:0 0 0 2px #2563eb;
  `;

  userMarker = new AdvancedMarkerElement({
    position: userPosition,
    map,
    title: 'ตำแหน่งของคุณ',
    content: dot,
  });

  const infoWindow = new google.maps.InfoWindow({
    content: '<strong>ตำแหน่งของคุณ</strong>',
  });

  userMarker.addListener('click', () => {
    if (activeInfoWindow) activeInfoWindow.close();
    infoWindow.open(map, userMarker);
    activeInfoWindow = infoWindow;
  });

  map.setCenter(userPosition);
  map.setZoom(14);
}

function renderHospitalCards(data) {
  if (!data.length) {
    results.innerHTML = '<div class="empty">ไม่พบโรงพยาบาลในระยะที่เลือก</div>';
    return;
  }

  results.innerHTML = data
    .map((hospital, index) => {
      const directionUrl = `https://www.google.com/maps/dir/?api=1&destination_place_id=${hospital.id}&destination=${encodeURIComponent(hospital.name)}`;

      const viewUrl =
        hospital.googleMapsUri ||
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hospital.name)}`;

      const isNearest = index === 0;
      const etaMin = hospital.distance > 0 ? Math.ceil((hospital.distance / 40) * 60) : '—';

      const badges = [];

      if (hospital.hasEmergency) {
        badges.push(`<span class="badge badge-emergency">🚨 ฉุกเฉิน</span>`);
      }

      if (hospital.is24h) {
        badges.push(`<span class="badge badge-24h">⏰ เปิด 24 ชม.</span>`);
      }

      return `
        <article class="hospital-card ${isNearest ? 'nearest' : ''}" data-index="${index}">
          ${isNearest ? '<div class="nearest-label">● ใกล้ที่สุด</div>' : ''}
          <div class="card-top">
            <h3>${hospital.name}</h3>
            <div class="distance">${hospital.distance.toFixed(2)} กม.</div>
          </div>

          ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}

          <div class="address">${hospital.address}</div>
          <div class="eta">⏱ เวลาเดินทางโดยประมาณ ~${etaMin} นาที</div>

          <div class="actions">
            <button class="action navigate" data-index="${index}">🗺 นำทางในเว็บ</button>
            <a class="action map" href="${directionUrl}" target="_blank">↗ Google Maps</a>
            <a class="action view" href="${viewUrl}" target="_blank">ดูสถานที่</a>
            <a class="action call" href="tel:${hospital.phone}">📞 ${hospital.phone}</a>
          </div>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('.hospital-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.actions')) return;

      const index = Number(card.dataset.index);
      focusHospital(data[index]);
    });
  });

  document.querySelectorAll('.action.navigate').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      const index = Number(btn.dataset.index);
      showRouteOnMap(data[index]);
    });
  });
}

function showRouteOnMap(hospital) {
  if (!hospital || !userPosition) return;

  setLoading(true, `กำลังนำทางไป ${hospital.name}...`);

  if (!directionsService || !directionsRenderer) {
    setLoading(false, 'ระบบนำทางยังไม่พร้อม');
    return;
  }

  directionsService.route(
    {
      origin: new google.maps.LatLng(userPosition.lat, userPosition.lng),

      destination: {
        placeId: hospital.id,
      },

      travelMode: google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: false,
    },
    (result, status) => {
      if (status !== 'OK' || !result) {
        console.warn('DirectionsService placeId error:', status);

        directionsService.route(
          {
            origin: new google.maps.LatLng(userPosition.lat, userPosition.lng),

            destination: new google.maps.LatLng(hospital.lat, hospital.lng),

            travelMode: google.maps.TravelMode.DRIVING,
            provideRouteAlternatives: false,
          },
          (fallbackResult, fallbackStatus) => {
            if (fallbackStatus !== 'OK' || !fallbackResult) {
              console.warn('DirectionsService lat/lng error:', fallbackStatus);

              setLoading(false, 'นำทางในเว็บไม่สำเร็จ กำลังเปิด Google Maps แทน');

              window.open(
                `https://www.google.com/maps/dir/?api=1&destination_place_id=${hospital.id}&destination=${encodeURIComponent(hospital.name)}`,
                '_blank'
              );

              return;
            }

            directionsRenderer.setDirections(fallbackResult);

            const leg = fallbackResult.routes[0].legs[0];

            setLoading(
              false,
              `นำทางไป ${hospital.name} — ${leg.distance.text} ประมาณ ${leg.duration.text}`
            );
          }
        );

        return;
      }

      directionsRenderer.setDirections(result);

      const leg = result.routes[0].legs[0];

      setLoading(
        false,
        `นำทางไป ${hospital.name} — ${leg.distance.text} ประมาณ ${leg.duration.text}`
      );
    }
  );
}

function renderHospitalMarkers(data) {
  hospitalMarkers.forEach((marker) => {
    marker.map = null;
  });

  hospitalMarkers = [];

  if (directionsRenderer) {
    directionsRenderer.setDirections({ routes: [] });
  }

  const { AdvancedMarkerElement, PinElement } = google.maps.marker;

  data.forEach((hospital, index) => {
    const isNearest = index === 0;

    const pin = new PinElement({
      glyph: isNearest ? '★' : `${index + 1}`,
      glyphColor: '#ffffff',
      background: isNearest ? '#dc2626' : '#ef4444',
      borderColor: '#ffffff',
      scale: isNearest ? 1.3 : 1.0,
    });

    const marker = new AdvancedMarkerElement({
      position: new google.maps.LatLng(hospital.lat, hospital.lng),
      map,
      title: hospital.name,
      content: pin.element,
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="max-width:220px;font-family:sans-serif">
          <strong>${hospital.name}</strong><br>
          ${hospital.distance.toFixed(2)} กม. จากคุณ<br>
          ${hospital.address}<br>
          โทร: ${hospital.phone}<br>
          <button
            onclick="window._navigateToHospital(${index})"
            style="margin-top:6px;padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer">
            นำทางในเว็บ
          </button>
        </div>
      `,
    });

    marker.addListener('click', () => {
      if (activeInfoWindow) activeInfoWindow.close();

      infoWindow.open(map, marker);
      activeInfoWindow = infoWindow;
    });

    if (isNearest) {
      infoWindow.open(map, marker);
      activeInfoWindow = infoWindow;
    }

    hospitalMarkers.push(marker);
  });

  window._navigateToHospital = (index) => {
    if (data[index]) {
      showRouteOnMap(data[index]);
    }
  };
}

function focusHospital(hospital) {
  if (!hospital) return;

  map.setCenter({
    lat: hospital.lat,
    lng: hospital.lng,
  });

  map.setZoom(16);
}

function fitMapToResults() {
  const bounds = new google.maps.LatLngBounds();

  if (userPosition) {
    bounds.extend(userPosition);
  }

  hospitalMarkers.forEach((marker) => {
    bounds.extend(marker.position);
  });

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, 80);
  }
}

function setLoading(isLoading, message) {
  sosButton.disabled = isLoading;
  sosButton.textContent = isLoading ? 'กำลังค้นหา...' : 'SOS';
  statusText.textContent = message;
}