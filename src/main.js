import './styles.css';
import { hospitals } from './data/hospitals.js';
import { sortHospitalsByDistance } from './utils/geo.js';

const GOOGLE_API_KEY = 'AIzaSyADcTaf70pA2x8L4UsjlcKeq1zo3iApyZE';

const defaultPosition = { lat: 13.7563, lng: 100.5018 };
let userPosition = defaultPosition;
let searchRadius = 5000; // default 5 km
let hospitalMarkers = [];
let userMarker = null;
let map = null;

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
      </div>
        <div class="filter-box">
  <label for="radiusSelect">ระยะค้นหา</label>
  <select id="radiusSelect">
    <option value="2000">2 กม.</option>
    <option value="5000" selected>5 กม.</option>
    <option value="10000">10 กม.</option>
    <option value="20000">20 กม.</option>
  </select>

      <div class="results" id="results">
        <div class="empty">ยังไม่มีข้อมูล กดปุ่ม SOS เพื่อค้นหาโรงพยาบาลใกล้ตัว</div>
      </div>
    </section>

    <section class="map-panel">
      <div id="map"></div>
      <div class="map-note">แผนที่ใช้ Google Maps และค้นหาโรงพยาบาลจริงจาก Google Places</div>
    </section>
  
</div>
  </main>
`;

const sosButton = document.querySelector('#sosButton');
const radiusSelect = document.querySelector('#radiusSelect');

radiusSelect.addEventListener('change', () => {
  searchRadius = Number(radiusSelect.value);
});
const statusText = document.querySelector('#statusText');
const foundCount = document.querySelector('#foundCount');
const nearestDistance = document.querySelector('#nearestDistance');
const gpsStatus = document.querySelector('#gpsStatus');
const results = document.querySelector('#results');

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&callback=initGoogleMapCallback&loading=async&language=th&region=TH`;
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
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true
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
        lng: position.coords.longitude
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
      maximumAge: 0
    }
  );
}

async function searchNearbyHospitals() {
  setLoading(true, 'กำลังค้นหาโรงพยาบาลจาก Google Places...');

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.nationalPhoneNumber,places.types,places.primaryType'
      },
      body: JSON.stringify({
        includedPrimaryTypes: ['hospital'],
        maxResultCount: 10,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: {
              latitude: userPosition.lat,
              longitude: userPosition.lng
            },
           radius: searchRadius
          }
        },
        languageCode: 'th'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      throw new Error(data.error?.message || 'Google Places API error');
    }

    let hospitalData = [];

    if (data.places && data.places.length > 0) {
     hospitalData = data.places.map((place) => ({
        id: place.id,
        name: place.displayName?.text || 'ไม่ทราบชื่อโรงพยาบาล',
        address: place.formattedAddress || 'ไม่พบที่อยู่',
        phone: place.nationalPhoneNumber || '-',
        lat: place.location.latitude,
        lng: place.location.longitude,
        googleMapsUri: place.googleMapsUri
      })); 
    } else {
      hospitalData = hospitals;
      setLoading(false, 'ไม่พบจาก Google Places จึงแสดงข้อมูล default แทน');
    }

    const sortedHospitals = sortHospitalsByDistance(hospitalData, userPosition);
    const nearestHospital = sortedHospitals[0];

    foundCount.textContent = sortedHospitals.length;
    nearestDistance.textContent = nearestHospital
      ? `${nearestHospital.distance.toFixed(2)} กม.`
      : '—';

    renderHospitalCards(sortedHospitals);
    renderHospitalMarkers(sortedHospitals);
    fitMapToResults();

    setLoading(false, 'ค้นหาสำเร็จ แสดงโรงพยาบาลจาก Google Maps แล้ว');
  } catch (error) {
    console.error(error);

    const fallbackHospitals = sortHospitalsByDistance(hospitals, userPosition);
    foundCount.textContent = fallbackHospitals.length;
    nearestDistance.textContent = fallbackHospitals[0]
      ? `${fallbackHospitals[0].distance.toFixed(2)} กม.`
      : '—';

    renderHospitalCards(fallbackHospitals);
    renderHospitalMarkers(fallbackHospitals);
    fitMapToResults();

    setLoading(false, 'ค้นหา Google Places ไม่สำเร็จ จึงแสดงข้อมูล default แทน');
  }
}

function showUserOnMap() {
  if (userMarker) {
    userMarker.setMap(null);
  }

  userMarker = new google.maps.Marker({
    position: userPosition,
    map,
    title: 'ตำแหน่งของคุณ',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#2563eb',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 3
    }
  });

  const infoWindow = new google.maps.InfoWindow({
    content: '<strong>ตำแหน่งของคุณ</strong>'
  });

  userMarker.addListener('click', () => {
    infoWindow.open(map, userMarker);
  });

  map.setCenter(userPosition);
  map.setZoom(14);
}

function renderHospitalCards(data) {
  if (!data.length) {
    results.innerHTML = '<div class="empty">ไม่พบโรงพยาบาลใกล้ตำแหน่งนี้</div>';
    return;
  }

  results.innerHTML = data.map((hospital, index) => {
    const directionUrl = `https://www.google.com/maps/dir/?api=1&destination=${hospital.lat},${hospital.lng}`;
    const viewUrl = hospital.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${hospital.lat},${hospital.lng}`;
    const isNearest = index === 0;

    return `
      <article class="hospital-card ${isNearest ? 'nearest' : ''}" data-id="${hospital.id}">
        ${isNearest ? '<div class="nearest-label">● ใกล้ที่สุด</div>' : ''}
        <div class="card-top">
          <h3>${hospital.name}</h3>
          <div class="distance">${hospital.distance.toFixed(2)} กม.</div>
        </div>
        <div class="address">${hospital.address}</div>
        <div class="actions">
          <a class="action map" href="${directionUrl}" target="_blank">นำทาง</a>
          <a class="action view" href="${viewUrl}" target="_blank">เปิดแผนที่</a>
          <a class="action call" href="tel:${hospital.phone}">โทร ${hospital.phone}</a>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.hospital-card').forEach((card) => {
    card.addEventListener('click', () => {
   const hospitalData = data.places
    .filter((place) => {
    const types = place.types || [];
    return types.includes("hospital");
  })
  .map((place) => ({
    id: place.id,
    name: place.displayName?.text || "ไม่ทราบชื่อโรงพยาบาล",
    address: place.formattedAddress || "",
    lat: place.location.latitude,
    lng: place.location.longitude
  }));
      if (hospital) focusHospital(hospital);
    });
  });
}

function renderHospitalMarkers(data) {
  hospitalMarkers.forEach((marker) => marker.setMap(null));
  hospitalMarkers = [];

  data.forEach((hospital, index) => {
    const isNearest = index === 0;

    const marker = new google.maps.Marker({
      position: {
        lat: hospital.lat,
        lng: hospital.lng
      },
      map,
      title: hospital.name,
      label: {
        text: isNearest ? '★' : `${index + 1}`,
        color: '#ffffff',
        fontSize: isNearest ? '14px' : '12px',
        fontWeight: 'bold'
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isNearest ? 14 : 11,
        fillColor: isNearest ? '#dc2626' : '#ef4444',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3
      }
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="max-width:220px">
          <strong>${hospital.name}</strong><br>
          ${hospital.distance.toFixed(2)} กม. จากคุณ<br>
          ${hospital.address}<br>
          โทร: ${hospital.phone}
        </div>
      `
    });

    marker.addListener('click', () => {
      infoWindow.open(map, marker);
    });

    if (isNearest) {
      infoWindow.open(map, marker);
    }

    hospitalMarkers.push(marker);
  });
}

function focusHospital(hospital) {
  map.setCenter({
    lat: hospital.lat,
    lng: hospital.lng
  });

  map.setZoom(16);
}

function fitMapToResults() {
  const bounds = new google.maps.LatLngBounds();

  if (userMarker) {
    bounds.extend(userPosition);
  }

  hospitalMarkers.forEach((marker) => {
    bounds.extend(marker.getPosition());
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
radiusSelect.addEventListener('change', async () => {
  searchRadius = Number(radiusSelect.value);

  if (userPosition) {
    await searchNearbyHospitals();
  }
});