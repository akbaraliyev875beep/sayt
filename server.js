const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { haversine } = require('./server/haversine');
const logger = require('./server/logger');
const telegram = require('./server/telegram');

// ========== APP SETUP ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
});

// ========== IN-MEMORY STORAGE ==========
const users = {};       // { phone: { name, phone, password, address, createdAt } }
const drivers = {};     // { driverId: { id, lat, lng, busy, socketId, lastUpdate } }
const emergencies = []; // Chaqiruvlar tarixi

// ========== STATIC FILES ==========
app.use(express.static(path.join(__dirname, 'public')));

// ========== API ENDPOINTS ==========
app.get('/api/stats', (_req, res) => {
    const list = Object.values(drivers);
    res.json({
        totalDrivers: list.length,
        freeDrivers: list.filter((d) => !d.busy).length,
        totalEmergencies: emergencies.length,
        totalUsers: Object.keys(users).length,
    });
});

// Sog'liq tekshiruvi — monitoring tizimlari va cron pinger uchun
app.get('/api/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        uptimeHuman: formatUptime(process.uptime()),
        timestamp: new Date().toISOString(),
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
        },
        nodeVersion: process.version,
        platform: process.platform,
        drivers: Object.keys(drivers).length,
        users: Object.keys(users).length,
        emergencies: emergencies.length,
    });
});

// Oxirgi loglarni ko'rish (debug uchun)
app.get('/api/logs', (req, res) => {
    const n = Math.min(parseInt(req.query.n) || 50, 200);
    res.json({
        count: logger.getStats(),
        entries: logger.getRecent(n),
    });
});

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

// ========== SOCKET.IO HANDLERS ==========
io.on('connection', (socket) => {
    console.log(`🔗 Yangi ulanish: ${socket.id}`);
    logger.event('Yangi socket ulanishi', { socketId: socket.id });

    // Dastlabki holat
    socket.emit('drivers_updated', Object.values(drivers));

    // ── Ro'yxatdan o'tish ─────────────────────────────────────────
    socket.on('register', (data, callback) => {
        const { name, phone, password, address } = data;

        if (!name || !phone || !password) {
            return callback({
                success: false,
                message: "Barcha majburiy maydonlarni to'ldiring",
            });
        }

        if (phone.length < 4) {
            return callback({
                success: false,
                message: "Telefon raqam juda qisqa",
            });
        }

        if (password.length < 4) {
            return callback({
                success: false,
                message: "Parol kamida 4 ta belgidan iborat bo'lishi kerak",
            });
        }

        if (users[phone]) {
            return callback({
                success: false,
                message: "Bu raqam allaqachon ro'yxatdan o'tgan",
            });
        }

        users[phone] = {
            name,
            phone,
            password,
            address: address || '',
            createdAt: new Date().toISOString(),
        };

        console.log(`📝 Yangi foydalanuvchi: ${name} (${phone})`);
        logger.info('Yangi foydalanuvchi', { name, phone });
        callback({
            success: true,
            user: { name, phone, address: address || '' },
        });
    });

    // ── Kirish ────────────────────────────────────────────────────
    socket.on('login', (data, callback) => {
        const { phone, password } = data;

        if (!phone || !password) {
            return callback({
                success: false,
                message: "Telefon va parolni kiriting",
            });
        }

        const user = users[phone];

        if (!user || user.password !== password) {
            return callback({
                success: false,
                message: "Telefon raqam yoki parol noto'g'ri",
            });
        }

        console.log(`🔓 Kirish: ${user.name} (${phone})`);
        logger.info('Foydalanuvchi kirdi', { name: user.name, phone });
        callback({
            success: true,
            user: { name: user.name, phone: user.phone, address: user.address },
        });
    });

    // ── Haydovchi joylashuvini yangilash ───────────────────────────
    socket.on('ambulance_update', (data) => {
        const { id, lat, lng } = data;

        if (!id || typeof lat !== 'number' || typeof lng !== 'number') {
            return socket.emit('error_msg', {
                message: "Noto'g'ri ma'lumot formati",
            });
        }

        drivers[id] = {
            id,
            lat,
            lng,
            busy: drivers[id]?.busy || false,
            socketId: socket.id,
            lastUpdate: Date.now(),
        };

        io.emit('drivers_updated', Object.values(drivers));

        console.log(
            `🚑 ${id} joylashuvi yangilandi: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`
        );
    });

    // ── Shoshilinch chaqiruv ──────────────────────────────────────
    socket.on('emergency_request', (data) => {
        const {
            lat,
            lng,
            illness,
            forWhom,
            otherPerson,
            userName,
            userPhone,
        } = data;

        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return socket.emit('error_msg', {
                message: "Noto'g'ri koordinatalar",
            });
        }

        console.log(`🆘 Yangi chaqiruv: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`);
        console.log(`   Chaqiruvchi: ${userName || 'Noma\'lum'} | Kasallik: ${illness || '-'}`);
        console.log(`   Kim uchun: ${forWhom === 'other' ? 'Boshqa odam' : 'O\'zi'}`);

        // Haversine formula — eng yaqin bo'sh haydovchi
        let nearestDriver = null;
        let minDistance = Infinity;

        for (const driver of Object.values(drivers)) {
            if (driver.busy) continue;
            const distance = haversine(lat, lng, driver.lat, driver.lng);
            if (distance < minDistance) {
                minDistance = distance;
                nearestDriver = driver;
            }
        }

        if (nearestDriver) {
            nearestDriver.busy = true;

            const emergency = {
                id: `EMR-${Date.now()}`,
                patientLat: lat,
                patientLng: lng,
                illness: illness || '',
                forWhom: forWhom || 'self',
                otherPerson: otherPerson || null,
                callerName: userName || "Noma'lum",
                callerPhone: userPhone || '',
                driverId: nearestDriver.id,
                distance: minDistance,
                timestamp: new Date().toISOString(),
                status: 'assigned',
            };
            emergencies.push(emergency);

            // Haydovchiga new_task
            io.to(nearestDriver.socketId).emit('new_task', {
                emergencyId: emergency.id,
                patientLat: lat,
                patientLng: lng,
                distance: minDistance,
                illness: emergency.illness,
                forWhom: emergency.forWhom,
                callerName: emergency.callerName,
                callerPhone: emergency.callerPhone,
                otherPerson: emergency.otherPerson,
            });

            // Bemorga javob
            socket.emit('emergency_accepted', {
                emergencyId: emergency.id,
                driverId: nearestDriver.id,
                driverLat: nearestDriver.lat,
                driverLng: nearestDriver.lng,
                distance: minDistance,
            });

            io.emit('drivers_updated', Object.values(drivers));

            console.log(
                `✅ Chaqiruv ${nearestDriver.id}ga tayinlandi. Masofa: ${minDistance.toFixed(2)} km`
            );
            logger.success('Chaqiruv tayinlandi', {
                driverId: nearestDriver.id,
                distance: minDistance.toFixed(2) + ' km',
            });
            if (telegram.ENABLED) {
                telegram.send(
                    `🆘 Yangi chaqiruv!\n\n` +
                    `👤 Kimdan: ${userName || "Noma'lum"}\n` +
                    `📞 Tel: ${userPhone || '-'}\n` +
                    `🤒 Kasallik: ${illness || '-'}\n` +
                    `👥 Kim uchun: ${forWhom === 'other' ? `Boshqa (${otherPerson || '?'})` : 'O\'zi'}\n` +
                    `🚑 Tayinlangan: ${nearestDriver.id}\n` +
                    `📏 Masofa: ${minDistance.toFixed(2)} km`
                );
            }
        } else {
            socket.emit('emergency_rejected', {
                message:
                    "Hozirda bo'sh haydovchi topilmadi. Iltimos, keyinroq urinib ko'ring.",
            });
            console.log("❌ Bo'sh haydovchi topilmadi");
            logger.warn("Bo'sh haydovchi topilmadi", { patient: { lat, lng } });
            if (telegram.ENABLED) {
                telegram.send(
                    `⚠️ Bo'sh haydovchi topilmadi!\n\n` +
                    `👤 Kimdan: ${userName || "Noma'lum"}\n` +
                    `📞 Tel: ${userPhone || '-'}\n` +
                    `📍 Joy: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`
                );
            }
        }
    });

    // ── Vazifani qabul qilish ─────────────────────────────────────
    socket.on('task_accepted', (data) => {
        const { emergencyId } = data;
        const emergency = emergencies.find((e) => e.id === emergencyId);
        if (emergency) {
            emergency.status = 'accepted';
            console.log(`✅ ${emergency.driverId} vazifani qabul qildi`);
        }
    });

    // ── Vazifani yakunlash ────────────────────────────────────────
    socket.on('task_completed', (data) => {
        const { driverId: completedId } = data;
        if (drivers[completedId]) {
            drivers[completedId].busy = false;
            io.emit('drivers_updated', Object.values(drivers));
            console.log(`🏁 ${completedId} vazifani yakunladi`);
        }
    });

    // ── Uzilish ───────────────────────────────────────────────────
    socket.on('disconnect', () => {
        for (const [id, driver] of Object.entries(drivers)) {
            if (driver.socketId === socket.id) {
                delete drivers[id];
                console.log(`🔴 Haydovchi ${id} uzildi`);
                logger.warn('Haydovchi uzildi', { driverId: id });
            }
        }
        io.emit('drivers_updated', Object.values(drivers));
        console.log(`🔴 Ulanish uzildi: ${socket.id}`);
    });
});

// ========== SERVER START ==========
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const startedAt = new Date();

server.listen(PORT, HOST, () => {
    console.log('═══════════════════════════════════════════');
    console.log('  🚑  Tez Yordam — EMS Dispatch Server');
    console.log(`  📡  Port: ${PORT}`);
    console.log(`  🌐  http://localhost:${PORT}`);
    console.log(`  📊  Health: http://localhost:${PORT}/api/health`);
    console.log(`  📝  Telegram: ${telegram.ENABLED ? '✅ yoqilgan' : '⚪ o\'chirilgan'}`);
    console.log('═══════════════════════════════════════════');
    logger.success('Server ishga tushdi', { port: PORT });

    // Telegram'ga startup xabari
    if (telegram.ENABLED) {
        telegram.send(
            `🚑 Tez Yordam serveri ishga tushdi!\n\n` +
            `📡 Port: ${PORT}\n` +
            `⏰ Vaqt: ${startedAt.toISOString()}\n` +
            `📊 Health: /api/health`
        );
    }
});

// Xatolarni ushlash va Telegram'ga yuborish
process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { error: err.message, stack: err.stack });
    if (telegram.ENABLED) {
        telegram.send(`❌ Server xatosi:\n\n${err.message}`);
    }
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error('unhandledRejection', { reason: msg });
});
