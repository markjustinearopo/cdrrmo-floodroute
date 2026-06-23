/* Generates the Supabase DUMMY seed SQL for trials/testing:
     supabase/seed/01_barangays.sql      18 barangays, full profile
     supabase/seed/02_officials.sql      ~200 officials (captains w/ rich detail)
     supabase/seed/03_accounts.sql       admin + staff + 18 barangay accounts
     supabase/seed/04_evac_centers.sql   ~34 centres
     supabase/seed/05_roads_##.sql       all 4,8xx real OSM roads, barangay-attributed
     supabase/seed/06_road_status.sql    flooded/blocked roads in vulnerable barangays
   Everything is DUMMY data for testing. Run: node scripts/seed-supabase.mjs */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const geo = JSON.parse(readFileSync(new URL('../src/data/cabuyaoBarangays.geo.json', import.meta.url), 'utf8'))
const roadsData = JSON.parse(readFileSync(new URL('../src/data/cabuyaoRoads.json', import.meta.url), 'utf8'))

const OUT = new URL('../supabase/seed/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const q = (s) => (s === null || s === undefined || s === 0 ? 'null' : `'${String(s).replace(/'/g, "''")}'`)

/* ── Point-in-polygon attribution (mirrors src/data/cabuyaoBarangays.js) ─── */
function pointInRing([lat, lng], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function inGeom(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polys.some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((h) => pointInRing(pt, h)))
}
const centroids = geo.features.map((f) => ({ name: f.properties.name, c: f.properties.center }))
function barangayAt(lat, lng) {
  for (const f of geo.features) if (inGeom([lat, lng], f.geometry)) return f.properties.name
  let best = null, bd = Infinity
  for (const { name, c } of centroids) {
    const d = (lat - c[0]) ** 2 + (lng - c[1]) ** 2
    if (d < bd) { bd = d; best = name }
  }
  return best
}

const R = 6371000
function hav([a, b], [c, d]) {
  const t = (x) => (x * Math.PI) / 180
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/* ── 01: Barangays — profile data (DUMMY but geographically honest) ──────── */
// classification + elevation follow the bundled terrain; population figures
// are plausible placeholders for testing, NOT official PSA counts.
const BRGY = [
  ['Baclaran',      'lakeshore', 1.91,  9800, 2230,   5, 0.96,  7, '(049) 531-0181'],
  ['Banay-Banay',   'lowland',   3.36, 26900, 6120,  12, 0.81,  9, '(049) 531-0182'],
  ['Banlic',        'lowland',   2.78, 25400, 5770,   8, 0.89,  4, '(049) 531-0183'],
  ['Bigaa',         'lakeshore', 2.04, 12400, 2820,   6, 0.94,  6, '(049) 531-0184'],
  ['Butong',        'lakeshore', 2.74, 15200, 3450,   7, 0.91,  5, '(049) 531-0185'],
  ['Casile',        'upland',    7.21,  5100, 1160, 158, 0.02, 17, '(049) 531-0186'],
  ['Diezmo',        'upland',    2.99,  5900, 1340,  38, 0.26, 16, '(049) 531-0187'],
  ['Gulod',         'lakeshore', 2.27, 21700, 4930,   5, 0.96,  3, '(049) 531-0188'],
  ['Mamatid',       'lakeshore', 3.92, 52800, 12000,  6, 0.94,  1, '(049) 531-0189'],
  ['Marinig',       'lakeshore', 3.65, 46300, 10520,  5, 0.96,  2, '(049) 531-0190'],
  ['Niugan',        'lowland',   2.42, 16800, 3820,  10, 0.85, 10, '(049) 531-0191'],
  ['Pittland',      'upland',    4.66,  3400,  770, 121, 0.00, 18, '(049) 531-0192'],
  ['Poblacion Dos', 'lowland',   0.49,  4900, 1110,  13, 0.79, 14, '(049) 531-0193'],
  ['Poblacion Tres','lowland',   0.66,  5600, 1270,  12, 0.81, 12, '(049) 531-0194'],
  ['Poblacion Uno', 'lowland',   0.54,  6200, 1410,  14, 0.77, 13, '(049) 531-0195'],
  ['Pulo',          'lowland',   3.11, 31200, 7090,  11, 0.83,  8, '(049) 531-0196'],
  ['Sala',          'lowland',   2.91, 15900, 3610,  16, 0.72, 11, '(049) 531-0197'],
  ['San Isidro',    'upland',    3.81, 13600, 3090,  42, 0.17, 15, '(049) 531-0198'],
]
const NOTES = {
  Mamatid: 'Largest population; lakeshore frontage with recurring knee-deep flooding along the coastal puroks during habagat.',
  Marinig: 'Dense lakeshore settlement; Cabuyao River outfall passes the eastern puroks.',
  Gulod: 'Lowest mean elevation in the city; first to flood when Laguna de Bay swells.',
  Banlic: 'Bounded by the Cabuyao River; PNR line crosses the barangay.',
  Casile: 'Tagaytay-ridge upland; landslide watch rather than flood watch.',
  Pittland: 'Highest ground in Cabuyao; designated spillover evacuation host.',
  Diezmo: 'Industrial estates; access roads carry relief convoys to the uplands.',
}
{
  const rows = geo.features.map((f) => {
    const [name, cls, area, pop, hh, elev, susc, rank, hotline] = BRGY.find((b) => b[0] === f.properties.name)
    const psgc = `0434040${String(BRGY.findIndex((b) => b[0] === name) + 1).padStart(2, '0')}`
    const [lat, lng] = f.properties.center
    return `(${q(name)}, ${q(psgc)}, ${q(cls)}, ${area}, ${pop}, ${hh}, ${lat}, ${lng}, ${elev}, ${susc}, ${rank}, ${q(
      `Barangay Hall, Brgy. ${name}, City of Cabuyao, Laguna`,
    )}, ${q(hotline)}, ${q(NOTES[name] || `Barangay ${name}, City of Cabuyao.`)})`
  })
  writeFileSync(
    new URL('01_barangays.sql', OUT),
    `insert into barangays (name, psgc_code, classification, area_km2, population, households, center_lat, center_lng, elevation_m, flood_susceptibility, vulnerability_rank, hall_address, hotline, notes) values\n${rows.join(',\n')};\n`,
  )
}

/* ── 02: Officials — 18 detailed captains + kagawads/SK/sec/treasurer ────── */
const CAPTAINS = {
  Baclaran:        ['Rodel M. Alcabasa', 'Ka Rodel', 'M', '1968-03-12', 9],
  'Banay-Banay':   ['Teresita V. Maglaqui', 'Kap Tessie', 'F', '1971-08-24', 6],
  Banlic:          ['Edgardo P. Sumagui', 'Ka Egay', 'M', '1965-11-02', 12],
  Bigaa:           ['Marivic S. Alimagno', 'Kap Bing', 'F', '1974-05-19', 3],
  Butong:          ['Renato C. Hemedes', 'Ka Ato', 'M', '1969-09-30', 9],
  Casile:          ['Domingo R. Banaag', 'Ka Ingo', 'M', '1963-12-08', 15],
  Diezmo:          ['Arlene T. Casunuran', 'Kap Lenlen', 'F', '1977-02-14', 3],
  Gulod:           ['Felipe N. Magcalas', 'Ka Ipe', 'M', '1966-06-21', 12],
  Mamatid:         ['Cristina L. Alumbres', 'Kap Tin', 'F', '1972-10-05', 6],
  Marinig:         ['Rogelio B. Hain', 'Ka Roger', 'M', '1964-04-17', 15],
  Niugan:          ['Generoso D. Limcuando', 'Ka Gener', 'M', '1970-07-27', 9],
  Pittland:        ['Lourdes E. Batitis', 'Kap Odeng', 'F', '1967-01-09', 6],
  'Poblacion Dos': ['Antonio G. Escueta', 'Ka Tonying', 'M', '1962-08-15', 18],
  'Poblacion Tres':['Remedios F. Alinsod', 'Kap Medy', 'F', '1969-03-03', 9],
  'Poblacion Uno': ['Wilfredo H. Parocha', 'Ka Willie', 'M', '1966-12-25', 12],
  Pulo:            ['Imelda C. Tagumpay', 'Kap Mhel', 'F', '1973-09-11', 6],
  Sala:            ['Bernardo J. Aguinaldo', 'Ka Bernie', 'M', '1968-05-06', 9],
  'San Isidro':    ['Editha M. Villapando', 'Kap Edith', 'F', '1975-11-18', 3],
}
const KAGAWAD_POOL = [
  'Joel Ramirez','Marites Soriano','Danilo Buenaflor','Rosario Pangilinan','Crispin Madlangbayan',
  'Aurora Dizon','Bayani Catindig','Luzviminda Roque','Ernesto Salonga','Corazon Villaluz',
  'Pablito Manansala','Gregoria Lacsamana','Isagani Punzalan','Milagros Bautista','Honesto Macaraeg',
  'Perlita Sandoval','Carlito Magpantay','Esperanza Tolentino','Domingo Caparas','Felisa Mangubat',
  'Rolando Capistrano','Nenita Alcantara','Virgilio Sarmiento','Estrella Dimaculangan','Mariano Libunao',
  'Pacita Evangelista','Severino Malabanan','Dolores Quizon','Florencio Almazan','Juanita Sevilla',
]
const COMMITTEES = ['Peace & Order','Health & Sanitation','Infrastructure','Education','DRRM & Safety','Livelihood','Environment']
{
  const rows = []
  let k = 0
  for (const [brgy, [name, nick, sex, bday, yrs]] of Object.entries(CAPTAINS)) {
    const slug = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ')
    const email = `${slug[0]}.${slug[slug.length - 1]}@cabuyao.gov.ph`
    const phone = `0917-${String(820 + rows.length).padStart(3, '0')}-${String(4100 + rows.length * 7).slice(-4)}`
    rows.push(
      `(${q(brgy)}, ${q(name)}, ${q(nick)}, 'Punong Barangay', 'DRRM & Safety (chair)', '${bday}', ${q(sex)}, ${q(phone)}, ${q(email)}, ${yrs}, ${q(`Purok 1, Brgy. ${brgy}, Cabuyao`)})`,
    )
    for (let i = 0; i < 7; i++) {
      const kg = KAGAWAD_POOL[k++ % KAGAWAD_POOL.length]
      const middle = 'ABCDEGLMPRSTV'[(k * 3) % 13]
      const full = kg.replace(' ', ` ${middle}. `)
      rows.push(
        `(${q(brgy)}, ${q(full)}, null, 'Kagawad', ${q(COMMITTEES[i % COMMITTEES.length])}, '${1965 + ((k * 7) % 30)}-${String(1 + ((k * 5) % 12)).padStart(2, '0')}-${String(1 + ((k * 11) % 28)).padStart(2, '0')}', ${q(k % 2 ? 'F' : 'M')}, ${q(`0918-${String(300 + k).padStart(3, '0')}-${String(2200 + k * 13).slice(-4)}`)}, null, ${(k * 3) % 12 + 1}, ${q(`Purok ${(i % 6) + 1}, Brgy. ${brgy}, Cabuyao`)})`,
      )
    }
    const skNames = ['Kyla Mendoza','John Rey Salazar','Princess Olivares','Mark Joseph Dela Rosa','Angelica Briones','Christian Paule','Sophia Legaspi','Jerome Tatlonghari','Bea Marasigan']
    rows.push(
      `(${q(brgy)}, ${q(skNames[rows.length % skNames.length])}, null, 'SK Chairperson', 'Youth & Sports', '${2002 + (rows.length % 4)}-0${1 + (rows.length % 9)}-15', ${q(rows.length % 2 ? 'F' : 'M')}, ${q(`0945-${String(700 + rows.length).padStart(3, '0')}-${String(5100 + rows.length * 3).slice(-4)}`)}, null, 1, ${q(`Brgy. ${brgy}, Cabuyao`)})`,
    )
    const secNames = ['Liza Coronel','Manuel Ditas','Grace Hizon','Romeo Inciong','Cecilia Javier','Arturo Kabigting']
    const treNames = ['Norma Lazaro','Felix Montano','Ofelia Navarro','Ramon Ocampo','Sylvia Padua','Victor Quimpo']
    rows.push(`(${q(brgy)}, ${q(secNames[rows.length % 6] )}, null, 'Secretary', 'Records & Documentation', null, null, ${q(`0919-${String(110 + rows.length).padStart(3, '0')}-${String(8800 + rows.length * 9).slice(-4)}`)}, null, ${rows.length % 8 + 1}, ${q(`Brgy. ${brgy}, Cabuyao`)})`)
    rows.push(`(${q(brgy)}, ${q(treNames[rows.length % 6])}, null, 'Treasurer', 'Finance', null, null, ${q(`0916-${String(450 + rows.length).padStart(3, '0')}-${String(6700 + rows.length * 11).slice(-4)}`)}, null, ${rows.length % 6 + 1}, ${q(`Brgy. ${brgy}, Cabuyao`)})`)
  }
  writeFileSync(
    new URL('02_officials.sql', OUT),
    `insert into barangay_officials (barangay, full_name, nickname, position, committee, birthdate, sex, phone, email, years_of_service, address) values\n${rows.join(',\n')};\n`,
  )
}

/* ── 03: Accounts — admin + staff + barangay captains (DUMMY passwords) ──── */
{
  const rows = [
    `('cdrrmo.admin', 'admin@cdrrmo-cabuyao.ph', 'Admin@Cabuyao2026', 'admin', null, 'Engr. Paulo V. Sta. Ana', 'CDRRMO Officer-in-Charge / System Administrator', '0917-555-0001', 'active', now() - interval '180 days', now() - interval '1 hour')`,
    `('cdrrmo.ops', 'ops@cdrrmo-cabuyao.ph', 'Ops@Center2026', 'staff', null, 'Maritess R. Banzuela', 'Operations Chief', '0917-555-0002', 'active', now() - interval '170 days', now() - interval '3 hours')`,
    `('cdrrmo.weather', 'weather@cdrrmo-cabuyao.ph', 'Weather@Watch2026', 'staff', null, 'Noel D. Pagaspas', 'Weather Watch Analyst', '0917-555-0003', 'active', now() - interval '160 days', now() - interval '6 hours')`,
    `('cdrrmo.dispatch', 'dispatch@cdrrmo-cabuyao.ph', 'Dispatch@2026', 'staff', null, 'Karen B. Mistica', 'Dispatcher', '0917-555-0004', 'active', now() - interval '150 days', now() - interval '30 minutes')`,
    `('cdrrmo.info', 'info@cdrrmo-cabuyao.ph', 'Info@Drill2026', 'staff', null, 'Jayson T. Umali', 'Public Information Officer', '0917-555-0005', 'active', now() - interval '140 days', now() - interval '2 days')`,
  ]
  for (const [brgy, [name]] of Object.entries(CAPTAINS)) {
    const slug = brgy.toLowerCase().replace(/ /g, '')
    rows.push(
      `('brgy.${slug}', 'brgy.${slug}@cabuyao.gov.ph', 'Brgy.${brgy.replace(/ /g, '')}2026!', 'barangay', ${q(brgy)}, ${q(name)}, 'Punong Barangay', null, 'active', now() - interval '120 days', now() - interval '${(rows.length % 48) + 1} hours')`,
    )
  }
  writeFileSync(
    new URL('03_accounts.sql', OUT),
    `insert into accounts (username, email, password_plain, role, barangay, full_name, position, phone, status, created_at, last_login) values\n${rows.join(',\n')};\n`,
  )
}

/* ── 04: Evacuation centres ──────────────────────────────────────────────── */
const EVAC = [
  ['Cabuyao Central School', 'Poblacion Uno', 'school', 450, 14.2766, 121.1245],
  ['Cabuyao City Sports Complex', 'Poblacion Tres', 'gym', 800, 14.2741, 121.1228],
  ['Poblacion Dos Covered Court', 'Poblacion Dos', 'covered court', 220, 14.2752, 121.1262],
  ['Pulo Elementary School', 'Pulo', 'school', 300, 14.2567, 121.1430],
  ['Pulo Covered Court', 'Pulo', 'covered court', 260, 14.2542, 121.1408],
  ['Mamatid Elementary School', 'Mamatid', 'school', 620, 14.2412, 121.1571],
  ['Mamatid Covered Court', 'Mamatid', 'covered court', 520, 14.2389, 121.1556],
  ['Mamatid National High School', 'Mamatid', 'school', 700, 14.2367, 121.1538],
  ['Marinig National High School', 'Marinig', 'school', 600, 14.2632, 121.1583],
  ['Marinig Covered Court A', 'Marinig', 'covered court', 280, 14.2660, 121.1549],
  ['Southville Multi-Purpose Hall', 'Marinig', 'multi-purpose hall', 350, 14.2614, 121.1612],
  ['Gulod Elementary School', 'Gulod', 'school', 480, 14.2702, 121.1397],
  ['Gulod Covered Court', 'Gulod', 'covered court', 240, 14.2718, 121.1375],
  ['Banlic Multi-Purpose Hall', 'Banlic', 'multi-purpose hall', 250, 14.2705, 121.1470],
  ['Banlic Elementary School', 'Banlic', 'school', 420, 14.2728, 121.1453],
  ['Butong Elementary School', 'Butong', 'school', 380, 14.2604, 121.1334],
  ['Butong Covered Court', 'Butong', 'covered court', 200, 14.2589, 121.1318],
  ['Bigaa Elementary School', 'Bigaa', 'school', 360, 14.2837, 121.1149],
  ['Bigaa Multi-Purpose Hall', 'Bigaa', 'multi-purpose hall', 180, 14.2851, 121.1131],
  ['Baclaran Elementary School', 'Baclaran', 'school', 320, 14.2900, 121.1086],
  ['Baclaran Covered Court', 'Baclaran', 'covered court', 170, 14.2914, 121.1068],
  ['Sala Elementary School', 'Sala', 'school', 340, 14.2518, 121.1224],
  ['Sala Parish Hall', 'Sala', 'church', 150, 14.2531, 121.1209],
  ['Niugan Elementary School', 'Niugan', 'school', 390, 14.2587, 121.1281],
  ['Banay-Banay Elementary School', 'Banay-Banay', 'school', 440, 14.2476, 121.1311],
  ['Banay-Banay Covered Court', 'Banay-Banay', 'covered court', 230, 14.2461, 121.1296],
  ['San Isidro Elementary School', 'San Isidro', 'school', 300, 14.2356, 121.1124],
  ['San Isidro Covered Court', 'San Isidro', 'covered court', 190, 14.2342, 121.1107],
  ['Diezmo Multi-Purpose Hall', 'Diezmo', 'multi-purpose hall', 160, 14.2271, 121.0922],
  ['Casile Elementary School', 'Casile', 'school', 210, 14.2014, 121.0698],
  ['Casile Barangay Hall Annex', 'Casile', 'multi-purpose hall', 110, 14.2002, 121.0681],
  ['Pittland Elementary School', 'Pittland', 'school', 180, 14.2189, 121.0779],
  ['Pittland Covered Court', 'Pittland', 'covered court', 140, 14.2175, 121.0764],
]
{
  const managers = ['Alma Reyes','Benjie Cruz','Carmen Diaz','Dario Estrella','Elsa Fuentes','Gardo Hilario','Irma Jacinto','Kiko Lim','Mona Nepomuceno','Oscar Pineda']
  const rows = EVAC.map(([name, brgy, type, cap, lat, lng], i) => {
    const occupied = ['Mamatid','Marinig','Gulod'].includes(brgy) ? Math.round(cap * (0.15 + (i % 4) * 0.1)) : 0
    const status = occupied >= cap ? 'full' : i % 11 === 10 ? 'standby' : 'open'
    const amen = `array['water','electricity'${type === 'school' ? ",'classrooms','clinic'" : ''}${cap > 400 ? ",'kitchen'" : ''}]`
    return `(${q(name)}, ${q(brgy)}, ${q(type)}, ${cap}, ${occupied}, ${q(status)}, ${q(managers[i % managers.length])}, ${q(`0908-${String(200 + i).padStart(3, '0')}-${String(3300 + i * 17).slice(-4)}`)}, ${lat}, ${lng}, ${amen}, null)`
  })
  writeFileSync(
    new URL('04_evac_centers.sql', OUT),
    `insert into evacuation_centers (name, barangay, facility_type, capacity, occupancy, status, manager, contact, lat, lng, amenities, notes) values\n${rows.join(',\n')};\n`,
  )
}

/* ── 05: Roads — every way in the bundled network, barangay-attributed ───── */
{
  const rows = roadsData.ways.map((w) => {
    const pts = []
    for (let i = 0; i < w.g.length; i += 2) pts.push([w.g[i], w.g[i + 1]])
    let len = 0
    for (let i = 1; i < pts.length; i++) len += hav(pts[i - 1], pts[i])
    const mid = pts[Math.floor(pts.length / 2)]
    const brgy = barangayAt(mid[0], mid[1])
    const s = pts[0], e = pts[pts.length - 1]
    return `(${w.i}, ${q(w.n || null)}, ${q(w.h)}, ${q(brgy)}, ${len.toFixed(1)}, ${s[0]}, ${s[1]}, ${mid[0]}, ${mid[1]}, ${e[0]}, ${e[1]}, ${pts.length}, ${w.n ? 'true' : 'false'})`
  })
  const BATCH = 800
  let part = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    part++
    writeFileSync(
      new URL(`05_roads_${String(part).padStart(2, '0')}.sql`, OUT),
      `insert into roads (osm_way_id, name, highway_class, barangay, length_m, start_lat, start_lng, mid_lat, mid_lng, end_lat, end_lng, vertex_count, is_named) values\n${rows.slice(i, i + BATCH).join(',\n')}\non conflict (osm_way_id) do nothing;\n`,
    )
  }
  console.log(`roads: ${rows.length} rows in ${part} batch files`)
}

/* ── 06: Road status — hazards placed in the VULNERABLE barangays ────────── */
{
  const vulnerable = ['Mamatid', 'Marinig', 'Gulod', 'Banlic', 'Butong', 'Bigaa', 'Baclaran', 'Pulo']
  const byBrgy = new Map(vulnerable.map((b) => [b, []]))
  for (const w of roadsData.ways) {
    if (!w.n) continue
    const mid = [w.g[Math.floor(w.g.length / 4) * 2], w.g[Math.floor(w.g.length / 4) * 2 + 1]]
    const brgy = barangayAt(mid[0], mid[1])
    if (byBrgy.has(brgy) && ['residential', 'tertiary', 'unclassified', 'secondary'].includes(w.h)) {
      byBrgy.get(brgy).push(w)
    }
  }
  const floodReasons = [
    'Knee-deep floodwater from lakeshore backflow',
    'Waist-deep flooding — Laguna de Bay swell',
    'Ankle to knee-deep water, passable to trucks only',
    'Flooded after continuous monsoon rain',
    'Storm drain overflow, rising slowly',
  ]
  const blockReasons = [
    'Washed-out road shoulder — impassable',
    'Fallen acacia tree blocking both lanes',
    'Submerged approach — barricaded by BDRRMC',
    'Road cut by floodwater current — do not enter',
  ]
  const rows = []
  let n = 0
  for (const [brgy, ways] of byBrgy) {
    const take = Math.min(ways.length, brgy === 'Mamatid' || brgy === 'Marinig' || brgy === 'Gulod' ? 5 : 3)
    // deterministic spread: pick distinct names across the barangay
    const seen = new Set()
    for (const w of ways) {
      if (rows.filter((r) => r.brgy === brgy).length >= take) break
      if (seen.has(w.n)) continue
      seen.add(w.n)
      n++
      const blocked = n % 4 === 0
      const depth = blocked ? (0.6 + (n % 3) * 0.15).toFixed(2) : (0.25 + (n % 5) * 0.12).toFixed(2)
      rows.push({
        brgy,
        sql: `(${w.i}, ${q(blocked ? 'blocked' : 'flooded')}, ${depth}, ${q(blocked ? blockReasons[n % 4] : floodReasons[n % 5])}, ${q('brgy.' + brgy.toLowerCase().replace(/ /g, ''))}, true, now() - interval '${(n % 18) + 1} hours', ${blocked ? "now() + interval '2 days'" : "now() + interval '" + ((n % 30) + 6) + " hours'"})`,
      })
    }
  }
  writeFileSync(
    new URL('06_road_status.sql', OUT),
    `insert into road_status (osm_way_id, status, flood_depth_m, reason, reported_by, verified, reported_at, expected_clear) values\n${rows.map((r) => r.sql).join(',\n')};\n`,
  )
  console.log(`road_status: ${rows.length} hazards across ${[...byBrgy.keys()].join(', ')}`)
}

console.log('Seed SQL written to supabase/seed/')
