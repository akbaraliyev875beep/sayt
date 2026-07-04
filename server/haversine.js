/**
 * Haversine formula — ikki geografik nuqta orasidagi masofani hisoblaydi
 * @param {number} lat1 - Birinchi nuqta kengligi (degrees)
 * @param {number} lng1 - Birinchi nuqta uzunligi (degrees)
 * @param {number} lat2 - Ikkinchi nuqta kengligi (degrees)
 * @param {number} lng2 - Ikkinchi nuqta uzunligi (degrees)
 * @returns {number} Masofa kilometrlarda (km)
 */
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371; // Yer radiusi (km)
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function toRad(deg) {
    return deg * (Math.PI / 180);
}

module.exports = { haversine };
