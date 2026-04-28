import './styles.css';
import { hospitals } from './data/hospitals.js';
import { sortHospitalsByDistance } from './utils/geo.js';

// ⚠️ ใส่ API Key ของคุณที่นี่ (ตรวจสอบว่าไม่มีเว้นวรรค)
const GOOGLE_API_KEY = 'AIzaSyADcTaf70pA2x8L4UsjlcKeq1zo3iApyZE';

const defaultPosition = { lat: 13.7563, lng: 100.5018 };
let userPosition = null;
let searchRadius = 5000;

let hospitalMarkers = [];
let userMarker = null;
let map = null;
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
  if (userPosition) await searchNearbyHospitals();
});

loadGoogleMaps()
  .then(() => {
    initMap();
    sosButton.addEventListener('click', startSOS);
  })
  .catch((error) => {
    console.error(error);
    setLoading(false, 'โหลด Google Maps ไม่สำเร็จ');
  });

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) { resolve(); return; }
    if (!GOOGLE_API_KEY || GOOGLE_API_KEY.includes('ใส่_API_KEY')) {
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

function startSOS() {
  setLoading(true, 'กำลังขอตำแหน่ง GPS...');
  if (!navigator.geolocation) {
    setLoading(false, 'Browser นี้ไม่รองรับ GPS');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      userPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
      gpsStatus.textContent = 'เปิดแล้ว';
      showUserOnMap();
      await searchNearbyHospitals();
    },
    (error) => {
      gpsStatus.textContent = 'ไม่สำเร็จ';
      setLoading(false, `เปิด GPS ไม่สำเร็จ: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}

function is24HourOrEmergency(place) {
  const types = place.types || [];
  if (types.includes('emergency_room')) return true;
  const hours = place.currentOpeningHours || place.regularOpeningHours;
  if (!hours) return false;
  const descriptions = hours.weekdayDescriptions || [];
  return descriptions.some((d) => d.includes('ตลอด 24 ชั่วโมง') || d.toLowerCase().includes('open 24 hours'));
}

async function searchNearbyHospitals() {
  if (!userPosition) return;
  setLoading(true, `กำลังค้นหาโรงพยาบาลจริง...`);
  const t0 = performance.now();

  try {
    const allPlaces = await fetchAllPlaces();
    const elapsed = (performance.now() - t0).toFixed(0);

    // ถ้า Google API มีข้อมูล (ต่อให้กรองแล้วเหลือ 0 ก็ตาม) จะไม่ไปใช้ hospitals.js
    if (allPlaces) {
      const hospitalData = allPlaces.map(place => ({
        id: place.id,
        name: place.displayName?.text || 'ไม่ทราบชื่อ',
        address: place.formattedAddress || '-',
        phone: place.nationalPhoneNumber || '-',
        lat: place.location.latitude,
        lng: place.location.longitude,
        googleMapsUri: place.googleMapsUri,
        hasEmergency: (place.types || []).includes('emergency_room'),
        is24h: is24HourOrEmergency(place)
      }));
      displayResults(hospitalData, elapsed, false);
    } else {
      // กรณี API ขัดข้องจริงๆ เท่านั้นถึงจะใช้ Fallback
      displayResults(hospitals, elapsed, true);
    }
  } catch (error) {
    console.error("API Error:", error);
    displayResults(hospitals, 0, true);
  }
}

async function fetchAllPlaces() {
  const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.nationalPhoneNumber,places.types,places.currentOpeningHours,places.regularOpeningHours';
  
  const body = {
    includedPrimaryTypes: ['hospital'], 
    maxResultCount: 20, // ลองที่ 20 ก่อนเพื่อความเสถียร
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: { latitude: userPosition.lat, longitude: userPosition.lng },
        radius: searchRadius,
      },
    },
    languageCode: 'th',
  };

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
  if (!res.ok) throw new Error(data.error?.message || 'Places API error');
  
  let resultsList = data.places || [];

  // กรองเฉพาะที่เป็นโรงพยาบาลจริงๆ (ตัดพวกหน่วยงานย่อยออก)
  const excludeKeywords = ['สำนัก', 'โภชนาการ', 'โรงอาหาร', 'คณะ', 'หอพัก', 'ตึก', 'อาคารเรียน', 'สถาบันเทคโนโลยี'];
  return resultsList.filter(place => {
    const name = place.displayName?.text || '';
    return !excludeKeywords.some(keyword => name.includes(keyword));
  });
}

function displayResults(hospitalData, elapsed, isFallback = false) {
  const sorted = sortHospitalsByDistance(hospitalData, userPosition)
    .filter((h) => h.distance * 1000 <= searchRadius);

  foundCount.textContent = sorted.length;
  nearestDistance.textContent = sorted[0] ? `${sorted[0].distance.toFixed(2)} กม.` : '—';
  searchTime.textContent = `${elapsed} ms`;

  renderHospitalCards(sorted);
  renderHospitalMarkers(sorted);
  fitMapToResults();
  
  if (sorted.length > 0) {
    setLoading(false, isFallback ? "⚠️ ใช้ข้อมูลสำรอง (Check API)" : "✅ ข้อมูลสดจาก Google");
  } else {
    results.innerHTML = '<div class="empty">ไม่พบโรงพยาบาลในระยะที่เลือก</div>';
    setLoading(false, "ค้นหาเสร็จสิ้น");
  }
}

function showUserOnMap() {
  if (userMarker) userMarker.map = null;
  const { AdvancedMarkerElement } = google.maps.marker;
  const dot = document.createElement('div');
  dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 8px rgba(0,0,0,0.3);`;
  userMarker = new AdvancedMarkerElement({ position: userPosition, map, content: dot });
  map.setCenter(userPosition);
}

function renderHospitalCards(data) {
  if (!data.length) return;
  results.innerHTML = data.map((h, i) => {
    const isNearest = i === 0;
    // สร้าง Google Maps URL แบบนำทางจริง
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}&destination_place_id=${h.id}`;
    
    return `
      <article class="hospital-card ${isNearest ? 'nearest' : ''}" data-index="${i}">
        ${isNearest ? '<div class="nearest-label">● ใกล้ที่สุด</div>' : ''}
        <div class="card-top"><h3>${h.name}</h3><div class="distance">${h.distance.toFixed(2)} กม.</div></div>
        <div class="badges">
          ${h.hasEmergency ? '<span class="badge badge-emergency">🚨 ฉุกเฉิน</span>' : ''}
          ${h.is24h ? '<span class="badge badge-24h">⏰ 24 ชม.</span>' : ''}
        </div>
        <div class="address">${h.address}</div>
        <div class="actions">
          <button class="action navigate" data-index="${i}">🗺 นำทาง</button>
          <a class="action map" href="${googleMapsUrl}" target="_blank">↗ Google Maps</a>
          <a class="action call" href="tel:${h.phone}">📞 โทร</a>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.hospital-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.actions')) focusHospital(data[card.dataset.index]);
    });
  });
  document.querySelectorAll('.action.navigate').forEach(btn => {
    btn.addEventListener('click', () => showRouteOnMap(data[btn.dataset.index]));
  });
}

function showRouteOnMap(hospital) {
  directionsService.route({
    origin: userPosition,
    destination: { lat: hospital.lat, lng: hospital.lng },
    travelMode: google.maps.TravelMode.DRIVING,
  }, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
    }
  });
}

function renderHospitalMarkers(data) {
  hospitalMarkers.forEach(m => m.map = null);
  hospitalMarkers = [];
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });

  const { AdvancedMarkerElement, PinElement } = google.maps.marker;
  data.forEach((h, i) => {
    const pin = new PinElement({
      glyph: i === 0 ? '★' : `${i + 1}`,
      background: i === 0 ? '#dc2626' : '#ef4444',
      borderColor: '#fff',
    });
    const marker = new AdvancedMarkerElement({ position: { lat: h.lat, lng: h.lng }, map, content: pin.element });
    hospitalMarkers.push(marker);
  });
}

function focusHospital(h) {
  map.setCenter({ lat: h.lat, lng: h.lng });
  map.setZoom(16);
}

function fitMapToResults() {
  const bounds = new google.maps.LatLngBounds();
  if (userPosition) bounds.extend(userPosition);
  hospitalMarkers.forEach(m => bounds.extend(m.position));
  if (!bounds.isEmpty()) map.fitBounds(bounds, 80);
}

function setLoading(isLoading, message) {
  sosButton.disabled = isLoading;
  sosButton.textContent = isLoading ? 'กำลังค้นหา...' : 'SOS';
  statusText.textContent = message;
}