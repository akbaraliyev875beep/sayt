// ═══════════════════════════════════════════════════════════════
//  Tez Yordam — EMS Dispatch System (Client)
// ═══════════════════════════════════════════════════════════════

const socket = io();

// ── Globals & State ───────────────────────────────────────────
const TASHKENT = [41.2995, 69.2401];
let currentUser = null; // Tizimga kirgan foydalanuvchi obyekti

// Map
let map = null;
const driverMarkers = {};
let patientMarker = null;
let routeLine = null;

// Driver State
let isDriverActive = false;
let driverId = null;
let driverLat = TASHKENT[0];
let driverLng = TASHKENT[1];
let simulationInterval = null;
let currentEmergencyId = null;
let taskAccepted = false;
const botIntervals = [];
const botSockets = [];

// SOS State
let currentSosLat = TASHKENT[0];
let currentSosLng = TASHKENT[1];

// ═══════════════════════════════════════════════════════════════
//  AUTH LOGIC
// ═══════════════════════════════════════════════════════════════

// Sahifa yuklanganda local storage'ni tekshirish
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('ems_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    }
});

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    document.getElementById(`auth-${tab}-tab`).classList.add('active');

    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(`${tab}-form`).classList.add('active');

    document.getElementById('login-error').innerText = '';
    document.getElementById('register-error').innerText = '';
}

function handleRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('register-btn');
    const err = document.getElementById('register-error');

    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    const address = document.getElementById('reg-address').value.trim();

    btn.disabled = true;
    btn.innerHTML = 'Kutilmoqda...';
    err.innerText = '';

    socket.emit('register', { name, phone, password, address }, (res) => {
        btn.disabled = false;
        btn.innerHTML = "Ro'yxatdan o'tish";

        if (res.success) {
            loginUser(res.user);
        } else {
            err.innerText = res.message;
        }
    });
}

function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');

    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;

    btn.disabled = true;
    btn.innerHTML = 'Kutilmoqda...';
    err.innerText = '';

    socket.emit('login', { phone, password }, (res) => {
        btn.disabled = false;
        btn.innerHTML = 'Kirish';

        if (res.success) {
            loginUser(res.user);
        } else {
            err.innerText = res.message;
        }
    });
}

function loginUser(user) {
    currentUser = user;
    localStorage.setItem('ems_user', JSON.stringify(user));
    showApp();
}

function logout() {
    currentUser = null;
    localStorage.removeItem('ems_user');
    document.getElementById('auth-page').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    // Auth sahifasini yashirish va App ni ko'rsatish
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Foydalanuvchi ma'lumotlarini UI ga yozish
    document.getElementById('user-name-display').innerText = currentUser.name.split(' ')[0];
    document.getElementById('user-avatar').innerText = currentUser.name.charAt(0).toUpperCase();

    // Xarita hali chizilmagan bo'lsa chizish
    if (!map) {
        initMap();
    } else {
        map.invalidateSize(); // Xarita o'lchamini yangilash
    }
}


// ═══════════════════════════════════════════════════════════════
//  MAP INITIALIZATION
// ═══════════════════════════════════════════════════════════════
function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: false }).setView(TASHKENT, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

const ambulanceIcon = createDivIcon('🚑', 32);
const patientIcon = createDivIcon('🆘', 32);
const busyIcon = createDivIcon('🚨', 32);

function createDivIcon(emoji, size) {
    return L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-inner" style="font-size:${size}px">${emoji}</div>`,
        iconSize: [size+10, size+10],
        iconAnchor: [(size+10)/2, (size+10)/2],
    });
}


// ═══════════════════════════════════════════════════════════════
//  UI INTERACTIONS (Tabs)
// ═══════════════════════════════════════════════════════════════
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
    document.getElementById(`${tabName}-panel`).classList.add('active');
}


// ═══════════════════════════════════════════════════════════════
//  SOS MODAL & PATIENT LOGIC
// ═══════════════════════════════════════════════════════════════

function openSosModal() {
    const modal = document.getElementById('sos-modal');
    modal.classList.remove('hidden');
    
    // Taxminiy random lokatsiya generatsiya qilamiz
    currentSosLat = TASHKENT[0] + (Math.random() - 0.5) * 0.015;
    currentSosLng = TASHKENT[1] + (Math.random() - 0.5) * 0.015;

    document.getElementById('sos-location-coords').innerText = `${currentSosLat.toFixed(5)}, ${currentSosLng.toFixed(5)}`;
}

function closeSosModal() {
    document.getElementById('sos-modal').classList.add('hidden');
    document.getElementById('sos-form').reset();
    toggleOtherPerson();
}

function toggleOtherPerson() {
    const isOther = document.getElementById('radio-other').checked;
    const fields = document.getElementById('other-person-fields');
    if (isOther) {
        fields.classList.remove('hidden');
    } else {
        fields.classList.add('hidden');
    }
}

function submitEmergency(e) {
    e.preventDefault();
    if (!currentUser) return alert("Avval tizimga kiring!");

    const illness = document.getElementById('sos-illness').value.trim();
    const forWhom = document.getElementById('radio-self').checked ? 'self' : 'other';
    
    let otherPerson = null;
    if (forWhom === 'other') {
        otherPerson = {
            name: document.getElementById('other-name').value.trim(),
            phone: document.getElementById('other-phone').value.trim()
        };
    }

    closeSosModal();

    // UI Status updates
    const btn = document.getElementById('emergency-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    document.getElementById('patient-status').textContent = '⏳ Eng yaqin ambulans qidirilmoqda...';
    document.getElementById('patient-status').className = 'status-text searching';
    document.getElementById('patient-lat').textContent = currentSosLat.toFixed(5);
    document.getElementById('patient-lng').textContent = currentSosLng.toFixed(5);
    document.getElementById('response-info').style.display = 'none';

    // Xaritani yangilash
    if (patientMarker) map.removeLayer(patientMarker);
    if (routeLine) map.removeLayer(routeLine);

    patientMarker = L.marker([currentSosLat, currentSosLng], { icon: patientIcon }).addTo(map);
    patientMarker.bindPopup('<strong>🆘 Chaqiruv manzili</strong>').openPopup();
    map.setView([currentSosLat, currentSosLng], 14);

    // Backendga so'rov
    socket.emit('emergency_request', { 
        lat: currentSosLat, 
        lng: currentSosLng,
        illness,
        forWhom,
        otherPerson,
        userName: currentUser.name,
        userPhone: currentUser.phone
    });

    showNotification('🆘 Shoshilinch chaqiruv yuborildi!', 'warning');
}


// ═══════════════════════════════════════════════════════════════
//  DRIVER LOGIC
// ═══════════════════════════════════════════════════════════════

function startDriver() {
    driverId = 'AMB-' + Math.floor(Math.random() * 900 + 100);
    driverLat = TASHKENT[0] + (Math.random() - 0.5) * 0.02;
    driverLng = TASHKENT[1] + (Math.random() - 0.5) * 0.02;
    isDriverActive = true;

    document.getElementById('driver-status').textContent = 'Faol';
    document.getElementById('driver-status').className = 'status-badge active';
    document.getElementById('driver-id-display').textContent = driverId;
    document.getElementById('start-driver-btn').disabled = true;
    document.getElementById('stop-driver-btn').disabled = false;

    sendDriverLocation();
    map.setView([driverLat, driverLng], 14);

    simulationInterval = setInterval(() => {
        driverLat += (Math.random() - 0.5) * 0.001;
        driverLng += (Math.random() - 0.5) * 0.001;
        sendDriverLocation();
    }, 5000);

    showNotification(`✅ Haydovchi <strong>${driverId}</strong> faollashtirildi`, 'success');
}

function stopDriver() {
    isDriverActive = false;
    clearInterval(simulationInterval);
    simulationInterval = null;

    document.getElementById('driver-status').textContent = 'Nofaol';
    document.getElementById('driver-status').className = 'status-badge';
    document.getElementById('start-driver-btn').disabled = false;
    document.getElementById('stop-driver-btn').disabled = true;
}

function sendDriverLocation() {
    socket.emit('ambulance_update', { id: driverId, lat: driverLat, lng: driverLng });
    document.getElementById('driver-lat').textContent = driverLat.toFixed(5);
    document.getElementById('driver-lng').textContent = driverLng.toFixed(5);
}

function addBotDrivers() {
    for (let i = 0; i < 3; i++) {
        let bs = io();
        let bid = 'BOT-' + Math.floor(Math.random() * 900 + 100);
        let blat = TASHKENT[0] + (Math.random() - 0.5) * 0.03;
        let blng = TASHKENT[1] + (Math.random() - 0.5) * 0.03;

        bs.emit('ambulance_update', { id: bid, lat: blat, lng: blng });
        
        let inv = setInterval(() => {
            blat += (Math.random() - 0.5) * 0.0015;
            blng += (Math.random() - 0.5) * 0.0015;
            bs.emit('ambulance_update', { id: bid, lat: blat, lng: blng });
        }, 5000);

        botIntervals.push(inv);
        botSockets.push(bs);
    }
    document.getElementById('add-bots-btn').disabled = true;
    document.getElementById('add-bots-btn').innerHTML = "✅ 3 ta bot qo'shildi";
}

function acceptTask() {
    if (!taskAccepted) {
        if (currentEmergencyId) {
            socket.emit('task_accepted', { emergencyId: currentEmergencyId });
            showNotification("✅ Vazifa qabul qilindi!", 'success');
            document.getElementById('accept-task-btn').textContent = '🏁 Vazifani yakunlash';
            document.getElementById('accept-task-btn').className = 'btn btn-primary btn-full';
            taskAccepted = true;
        }
    } else {
        if (driverId) {
            socket.emit('task_completed', { driverId: driverId });
            currentEmergencyId = null;
            taskAccepted = false;
            document.getElementById('task-info').style.display = 'none';
            document.getElementById('accept-task-btn').textContent = '✅ Qabul qilish';
            document.getElementById('accept-task-btn').className = 'btn btn-success btn-full';
            if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
            showNotification("🏁 Vazifa yakunlandi.", 'success');
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════

socket.on('drivers_updated', (drivers) => {
    if(!map) return; // if auth page is active

    Object.keys(driverMarkers).forEach(id => {
        if (!drivers.find(d => d.id === id)) {
            map.removeLayer(driverMarkers[id]);
            delete driverMarkers[id];
        }
    });

    drivers.forEach(d => {
        const icon = d.busy ? busyIcon : ambulanceIcon;
        const popup = `<strong>${d.busy?'🚨':'🚑'} ${d.id}</strong><br><small>${d.busy?"Band":"Bo'sh"}</small>`;

        if (driverMarkers[d.id]) {
            driverMarkers[d.id].setLatLng([d.lat, d.lng]).setIcon(icon).setPopupContent(popup);
        } else {
            driverMarkers[d.id] = L.marker([d.lat, d.lng], { icon }).addTo(map).bindPopup(popup);
        }
    });

    document.getElementById('active-drivers-count').textContent = drivers.length;
    document.getElementById('free-drivers-count').textContent = drivers.filter(d => !d.busy).length;
});

// Driverga kelgan xabar
socket.on('new_task', (data) => {
    currentEmergencyId = data.emergencyId;
    taskAccepted = false;

    showNotification(`🆘 <strong>YANGI CHAQIRUV!</strong> Masofa: ${data.distance.toFixed(2)} km`, 'error');

    const tInfo = document.getElementById('task-info');
    tInfo.style.display = 'block';
    
    document.getElementById('task-caller-name').textContent = data.callerName;
    document.getElementById('task-caller-phone').textContent = data.callerPhone;
    document.getElementById('task-illness').textContent = data.illness;
    document.getElementById('task-for-whom').textContent = data.forWhom === 'self' ? "O'zi uchun" : "Boshqa odam uchun";
    document.getElementById('task-distance').textContent = data.distance.toFixed(2) + ' km';

    const otherDiv = document.getElementById('task-other-info');
    if (data.forWhom === 'other' && data.otherPerson) {
        otherDiv.style.display = 'block';
        document.getElementById('task-other-name').textContent = data.otherPerson.name || "Noma'lum";
        document.getElementById('task-other-phone').textContent = data.otherPerson.phone || "Noma'lum";
    } else {
        otherDiv.style.display = 'none';
    }

    document.getElementById('accept-task-btn').textContent = '✅ Qabul qilish';
    document.getElementById('accept-task-btn').className = 'btn btn-success btn-full';

    if (routeLine) map.removeLayer(routeLine);
    if (isDriverActive && map) {
        routeLine = L.polyline([[driverLat, driverLng], [data.patientLat, data.patientLng]], 
            { color: '#ef4444', weight: 3, dashArray: '10, 6' }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [80, 80] });
    }
    switchTab('driver');
});

// Bemorga kelgan javob
socket.on('emergency_accepted', (data) => {
    const btn = document.getElementById('emergency-btn');
    btn.disabled = false;
    btn.classList.remove('loading');

    document.getElementById('patient-status').textContent = '✅ Ambulans topildi!';
    document.getElementById('patient-status').className = 'status-text found';

    document.getElementById('response-info').style.display = 'block';
    document.getElementById('resp-driver-id').textContent = data.driverId;
    document.getElementById('resp-distance').textContent = data.distance.toFixed(2) + ' km';
    document.getElementById('resp-eta').textContent = '~' + Math.ceil(data.distance * 2.5) + ' daqiqa';

    if (routeLine) map.removeLayer(routeLine);
    if (patientMarker && map) {
        const patPos = patientMarker.getLatLng();
        routeLine = L.polyline([[data.driverLat, data.driverLng], [patPos.lat, patPos.lng]], 
            { color: '#22c55e', weight: 3, dashArray: '10, 6' }).addTo(map);
    }
    showNotification(`✅ <strong>${data.driverId}</strong> yo'lda!`, 'success');
});

socket.on('emergency_rejected', (data) => {
    const btn = document.getElementById('emergency-btn');
    btn.disabled = false;
    btn.classList.remove('loading');

    document.getElementById('patient-status').textContent = '❌ Haydovchi topilmadi';
    document.getElementById('patient-status').className = 'status-text error';
    showNotification('❌ ' + data.message, 'error');
});

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const el = document.createElement('div');
    el.className = `notification ${type}`;
    el.innerHTML = message;
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 400);
    }, 5000);
}

function updateClock() {
    const clock = document.getElementById('clock');
    if(clock) {
        const now = new Date();
        clock.textContent = String(now.getHours()).padStart(2, '0') + ':' + 
                            String(now.getMinutes()).padStart(2, '0') + ':' + 
                            String(now.getSeconds()).padStart(2, '0');
    }
}
setInterval(updateClock, 1000);
