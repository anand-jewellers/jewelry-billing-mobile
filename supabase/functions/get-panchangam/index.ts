// supabase/functions/get-panchangam/index.ts
//
// Deploy with: supabase functions deploy get-panchangam
//
// Computes today's sunrise/sunset (standard NOAA solar formula) and derives
// Rahu Kalam, Yamaganda, Gulika Kalam, and Abhijit Muhurat from them.
// Pure TypeScript math only — no WASM, no npm/jsr packages, so it bundles
// and deploys cleanly on Supabase's Edge Runtime.
//
// Note: Tithi/Nakshatra (lunar position) are NOT included here — those
// genuinely need an ephemeris library. This covers the good/bad time part.

// Chennai coordinates — change if the shop is elsewhere.
const SHOP_LATITUDE = 13.0827;
const SHOP_LONGITUDE = 80.2707;
const TIMEZONE_OFFSET_HOURS = 5.5; // IST

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Standard NOAA solar calculator algorithm.
 * Returns sunrise/sunset as minutes-from-midnight in local time.
 */
function calcSunriseSunset(date: Date, lat: number, lon: number, tzOffsetHours: number) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Julian day
  let jd: number;
  {
    let y = year;
    let m = month;
    if (m <= 2) {
      y -= 1;
      m += 12;
    }
    const a = Math.floor(y / 100);
    const b = 2 - a + Math.floor(a / 4);
    jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
  }

  const T = (jd - 2451545) / 36525;
  const geomMeanLongSun = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const geomMeanAnomSun = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const eccentEarthOrbit = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const sunEqCtr =
    Math.sin(toRad(geomMeanAnomSun)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(toRad(2 * geomMeanAnomSun)) * (0.019993 - 0.000101 * T) +
    Math.sin(toRad(3 * geomMeanAnomSun)) * 0.000289;
  const sunTrueLong = geomMeanLongSun + sunEqCtr;
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(toRad(125.04 - 1934.136 * T));

  const meanObliqEcliptic =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(toRad(125.04 - 1934.136 * T));

  const sunDeclin = toDeg(Math.asin(Math.sin(toRad(obliqCorr)) * Math.sin(toRad(sunAppLong))));

  const varY = Math.tan(toRad(obliqCorr / 2)) * Math.tan(toRad(obliqCorr / 2));
  const eqTime =
    4 *
    toDeg(
      varY * Math.sin(2 * toRad(geomMeanLongSun)) -
        2 * eccentEarthOrbit * Math.sin(toRad(geomMeanAnomSun)) +
        4 * eccentEarthOrbit * varY * Math.sin(toRad(geomMeanAnomSun)) * Math.cos(2 * toRad(geomMeanLongSun)) -
        0.5 * varY * varY * Math.sin(4 * toRad(geomMeanLongSun)) -
        1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * toRad(geomMeanAnomSun))
    );

  const haSunrise = toDeg(
    Math.acos(
      Math.cos(toRad(90.833)) / (Math.cos(toRad(lat)) * Math.cos(toRad(sunDeclin))) -
        Math.tan(toRad(lat)) * Math.tan(toRad(sunDeclin))
    )
  );

  const solarNoonMin = 720 - 4 * lon - eqTime + tzOffsetHours * 60;
  const sunriseMin = solarNoonMin - haSunrise * 4;
  const sunsetMin = solarNoonMin + haSunrise * 4;

  return { sunriseMin, sunsetMin };
}

function minutesToLabel(minutesFromMidnight: number): string {
  const total = Math.round(minutesFromMidnight);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

// Traditional day-division tables. Daylight (sunrise->sunset) is split into
// 8 equal parts; each weekday has a fixed "bad" part for each of these.
// Sunday=0 ... Saturday=6, matching Date.getDay().
const RAHU_KALAM_PART = [8, 2, 7, 5, 6, 4, 3]; // Sun, Mon, Tue, Wed, Thu, Fri, Sat
const YAMAGANDA_PART = [5, 4, 3, 2, 1, 7, 6];
const GULIKA_PART = [7, 6, 5, 4, 3, 2, 1];

function partWindow(sunriseMin: number, sunsetMin: number, partNumber: number) {
  const partLength = (sunsetMin - sunriseMin) / 8;
  const start = sunriseMin + (partNumber - 1) * partLength;
  const end = start + partLength;
  return { start, end };
}

// Abhijit Muhurta: the 8th of 15 equal divisions of the full day
// (sunrise -> sunset), centred on solar noon.
function abhijitWindow(sunriseMin: number, sunsetMin: number) {
  const muhurtaLength = (sunsetMin - sunriseMin) / 15;
  const start = sunriseMin + 7 * muhurtaLength;
  const end = start + muhurtaLength;
  return { start, end };
}

Deno.serve((_req) => {
  try {
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const weekday = istNow.getDay(); // 0=Sunday

    const { sunriseMin, sunsetMin } = calcSunriseSunset(
      istNow,
      SHOP_LATITUDE,
      SHOP_LONGITUDE,
      TIMEZONE_OFFSET_HOURS
    );

    const rahu = partWindow(sunriseMin, sunsetMin, RAHU_KALAM_PART[weekday]);
    const yama = partWindow(sunriseMin, sunsetMin, YAMAGANDA_PART[weekday]);
    const gulika = partWindow(sunriseMin, sunsetMin, GULIKA_PART[weekday]);
    const abhijit = abhijitWindow(sunriseMin, sunsetMin);

    const body = {
      date: istNow.toISOString().slice(0, 10),
      sunrise: minutesToLabel(sunriseMin),
      sunset: minutesToLabel(sunsetMin),
      tithi: null,
      nakshatra: null,
      goodTimes: [
        { label: 'Abhijit Muhurat', start: minutesToLabel(abhijit.start), end: minutesToLabel(abhijit.end) },
      ],
      badTimes: [
        { label: 'Rahu Kalam', start: minutesToLabel(rahu.start), end: minutesToLabel(rahu.end) },
        { label: 'Yamaganda', start: minutesToLabel(yama.start), end: minutesToLabel(yama.end) },
        { label: 'Gulika Kalam', start: minutesToLabel(gulika.start), end: minutesToLabel(gulika.end) },
      ],
    };

    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});