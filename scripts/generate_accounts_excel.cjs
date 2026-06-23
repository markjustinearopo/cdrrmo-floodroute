const ExcelJS = require('exceljs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'CDRRMO_Dummy_Accounts.xlsx')

// ── palette ─────────────────────────────────────────────────────────────────
const C = {
  headerBg:   '1E3A5F',  headerFg: 'FFFFFF',
  adminBg:    'EDE9FD',  adminAcc: '6D5ACD',
  staffBg:    'E2F5EF',  staffAcc: '1A7A5E',
  brgyBg:     'FEF3E2',  brgyAcc:  'B26A00',
  resBg:      'FEE9E5',  resAcc:   'B04527',
  sectionBg:  'F7F7F7',
  borderGray: 'CCCCCC',
  white:      'FFFFFF',
  titleBg:    '0D2137',  titleFg:  'FFFFFF',
}

const FONT = 'Arial'

function border(style = 'thin', color = C.borderGray) {
  const s = { style, color: { argb: 'FF' + color } }
  return { top: s, left: s, bottom: s, right: s }
}

function hFill(hex) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } } }

function applyHeader(row, cols) {
  row.font   = { name: FONT, bold: true, size: 10, color: { argb: 'FF' + C.headerFg } }
  row.fill   = hFill(C.headerBg)
  row.height = 22
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cols.forEach((_, i) => { row.getCell(i + 1).border = border() })
}

function applyDataRow(row, bg, colCount, align = {}) {
  row.font   = { name: FONT, size: 9 }
  row.fill   = hFill(bg)
  row.height = 18
  row.alignment = { vertical: 'middle', wrapText: false }
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i)
    cell.border = border('thin', 'E0E0E0')
    if (align[i]) cell.alignment = { ...cell.alignment, horizontal: align[i] }
  }
}

function roleBadge(ws, rowNum, colNum, role) {
  const cfg = {
    admin:    { bg: C.adminAcc, fg: 'FFFFFF', label: 'ADMIN' },
    staff:    { bg: C.staffAcc, fg: 'FFFFFF', label: 'STAFF' },
    barangay: { bg: C.brgyAcc,  fg: 'FFFFFF', label: 'BARANGAY' },
    resident: { bg: C.resAcc,   fg: 'FFFFFF', label: 'RESIDENT' },
  }[role] || { bg: '888888', fg: 'FFFFFF', label: role.toUpperCase() }
  const cell = ws.getCell(rowNum, colNum)
  cell.value = cfg.label
  cell.font  = { name: FONT, bold: true, size: 8, color: { argb: 'FF' + cfg.fg } }
  cell.fill  = hFill(cfg.bg)
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

// ── data ────────────────────────────────────────────────────────────────────
const ADMINS = [
  { u:'admin',  e:'admin@cabuyao.gov.ph',          pw:'admin123',    name:'CDRRMO Administrator',  pos:'CDRRMO Head',              portal:'/admin/dashboard' },
  { u:'admin2', e:'deputy@cabuyao.gov.ph',          pw:'Admin@2024',  name:'Maria Santos',           pos:'CDRRMO Deputy Head',       portal:'/admin/dashboard' },
  { u:'admin3', e:'operations@cabuyao.gov.ph',      pw:'Admin@2024',  name:'Roberto Garcia',         pos:'Operations Manager',       portal:'/admin/dashboard' },
  { u:'admin4', e:'data@cabuyao.gov.ph',            pw:'Admin@2024',  name:'Ana Reyes',              pos:'Data & Analytics Officer', portal:'/admin/dashboard' },
  { u:'admin5', e:'itsystems@cabuyao.gov.ph',       pw:'Admin@2024',  name:'Carlos Bautista',        pos:'IT Systems Administrator', portal:'/admin/dashboard' },
]
const STAFF = [
  { u:'operator',e:'eoc@cabuyao.gov.ph',            pw:'operator123', name:'EOC Duty Operator',      pos:'Operations Officer',       portal:'/admin/dashboard' },
  { u:'staff2',  e:'monitoring@cabuyao.gov.ph',     pw:'Staff@2024',  name:'Ligaya Morales',         pos:'Monitoring Officer',       portal:'/admin/dashboard' },
]

const OFFICIALS = [
  ['BCL-001','bcl001@brgy.cabuyao.ph','Brgy@2024','Roberto Santos','Barangay Captain','Baclaran'],
  ['BCL-002','bcl002@brgy.cabuyao.ph','Brgy@2024','Maria Reyes','Barangay Secretary','Baclaran'],
  ['BCL-003','bcl003@brgy.cabuyao.ph','Brgy@2024','Jose Cruz','Barangay Councilor','Baclaran'],
  ['BNB-001','bnb001@brgy.cabuyao.ph','Brgy@2024','Elena Garcia','Barangay Captain','Banay-Banay'],
  ['BNB-002','bnb002@brgy.cabuyao.ph','Brgy@2024','Marco Torres','Barangay Secretary','Banay-Banay'],
  ['BNB-003','bnb003@brgy.cabuyao.ph','Brgy@2024','Ana Flores','Barangay Councilor','Banay-Banay'],
  ['BNL-001','bnl001@brgy.cabuyao.ph','Brgy@2024','Pedro Ramos','Barangay Captain','Banlic'],
  ['BNL-002','bnl002@brgy.cabuyao.ph','Brgy@2024','Lina Bautista','Barangay Secretary','Banlic'],
  ['BNL-003','bnl003@brgy.cabuyao.ph','Brgy@2024','Carlos Mendoza','Barangay Councilor','Banlic'],
  ['BIG-001','big001@brgy.cabuyao.ph','Brgy@2024','Luz Villanueva','Barangay Captain','Bigaa'],
  ['BIG-002','big002@brgy.cabuyao.ph','Brgy@2024','Andres Castillo','Barangay Secretary','Bigaa'],
  ['BIG-003','big003@brgy.cabuyao.ph','Brgy@2024','Carmen Gonzales','Barangay Councilor','Bigaa'],
  ['BUT-001','but001@brgy.cabuyao.ph','Brgy@2024','Eduardo Morales','Barangay Captain','Butong'],
  ['BUT-002','but002@brgy.cabuyao.ph','Brgy@2024','Rita Aquino','Barangay Secretary','Butong'],
  ['BUT-003','but003@brgy.cabuyao.ph','Brgy@2024','Fernando Perez','Barangay Councilor','Butong'],
  ['CAS-001','cas001@brgy.cabuyao.ph','Brgy@2024','Gloria Espinosa','Barangay Captain','Casile'],
  ['CAS-002','cas002@brgy.cabuyao.ph','Brgy@2024','Reynaldo Navarro','Barangay Secretary','Casile'],
  ['CAS-003','cas003@brgy.cabuyao.ph','Brgy@2024','Teresita Vega','Barangay Councilor','Casile'],
  ['DIE-001','die001@brgy.cabuyao.ph','Brgy@2024','Leonardo Herrera','Barangay Captain','Diezmo'],
  ['DIE-002','die002@brgy.cabuyao.ph','Brgy@2024','Rosario Diaz','Barangay Secretary','Diezmo'],
  ['DIE-003','die003@brgy.cabuyao.ph','Brgy@2024','Ernesto Jimenez','Barangay Councilor','Diezmo'],
  ['GUL-001','gul001@brgy.cabuyao.ph','Brgy@2024','Marites Pascual','Barangay Captain','Gulod'],
  ['GUL-002','gul002@brgy.cabuyao.ph','Brgy@2024','Renato Vargas','Barangay Secretary','Gulod'],
  ['GUL-003','gul003@brgy.cabuyao.ph','Brgy@2024','Natividad Ruiz','Barangay Councilor','Gulod'],
  ['MAM-001','mamatid.official@cabuyao.gov.ph','brgy123','Brgy. Mamatid Official','Barangay Captain','Mamatid'],
  ['MAM-002','mam002@brgy.cabuyao.ph','Brgy@2024','Rosalinda Castro','Barangay Secretary','Mamatid'],
  ['MAM-003','mam003@brgy.cabuyao.ph','Brgy@2024','Danilo Reyes','Barangay Councilor','Mamatid'],
  ['MAR-001','marinig.official@cabuyao.gov.ph','brgy123','Brgy. Marinig Official','Barangay Captain','Marinig'],
  ['MAR-002','mar002@brgy.cabuyao.ph','Brgy@2024','Corazon Mendez','Barangay Secretary','Marinig'],
  ['MAR-003','mar003@brgy.cabuyao.ph','Brgy@2024','Arturo Lim','Barangay Councilor','Marinig'],
  ['NIU-001','niu001@brgy.cabuyao.ph','Brgy@2024','Violeta Aguilar','Barangay Captain','Niugan'],
  ['NIU-002','niu002@brgy.cabuyao.ph','Brgy@2024','Rodrigo Padilla','Barangay Secretary','Niugan'],
  ['NIU-003','niu003@brgy.cabuyao.ph','Brgy@2024','Felicidad Serrano','Barangay Councilor','Niugan'],
  ['PIT-001','pit001@brgy.cabuyao.ph','Brgy@2024','Guillermo Abad','Barangay Captain','Pittland'],
  ['PIT-002','pit002@brgy.cabuyao.ph','Brgy@2024','Concepcion Moran','Barangay Secretary','Pittland'],
  ['PIT-003','pit003@brgy.cabuyao.ph','Brgy@2024','Marcelino Salazar','Barangay Councilor','Pittland'],
  ['PDO-001','pdo001@brgy.cabuyao.ph','Brgy@2024','Socorro Dela Cruz','Barangay Captain','Poblacion Dos'],
  ['PDO-002','pdo002@brgy.cabuyao.ph','Brgy@2024','Alfredo Soria','Barangay Secretary','Poblacion Dos'],
  ['PDO-003','pdo003@brgy.cabuyao.ph','Brgy@2024','Herminia Ocampo','Barangay Councilor','Poblacion Dos'],
  ['PDT-001','pdt001@brgy.cabuyao.ph','Brgy@2024','Domingo Pacia','Barangay Captain','Poblacion Tres'],
  ['PDT-002','pdt002@brgy.cabuyao.ph','Brgy@2024','Milagros Legaspi','Barangay Secretary','Poblacion Tres'],
  ['PDT-003','pdt003@brgy.cabuyao.ph','Brgy@2024','Ramon Guerrero','Barangay Councilor','Poblacion Tres'],
  ['PDU-001','pdu001@brgy.cabuyao.ph','Brgy@2024','Angelica Mercado','Barangay Captain','Poblacion Uno'],
  ['PDU-002','pdu002@brgy.cabuyao.ph','Brgy@2024','Nestor Tolentino','Barangay Secretary','Poblacion Uno'],
  ['PDU-003','pdu003@brgy.cabuyao.ph','Brgy@2024','Lourdes Villaluz','Barangay Councilor','Poblacion Uno'],
  ['PUL-001','pul001@brgy.cabuyao.ph','Brgy@2024','Vicente Cabral','Barangay Captain','Pulo'],
  ['PUL-002','pul002@brgy.cabuyao.ph','Brgy@2024','Estrella Banaag','Barangay Secretary','Pulo'],
  ['PUL-003','pul003@brgy.cabuyao.ph','Brgy@2024','Marcelo Oropesa','Barangay Councilor','Pulo'],
  ['SAL-001','sal001@brgy.cabuyao.ph','Brgy@2024','Catalina Manalo','Barangay Captain','Sala'],
  ['SAL-002','sal002@brgy.cabuyao.ph','Brgy@2024','Benedicto Arenas','Barangay Secretary','Sala'],
  ['SAL-003','sal003@brgy.cabuyao.ph','Brgy@2024','Evelyn Tamayo','Barangay Councilor','Sala'],
  ['SIS-001','sis001@brgy.cabuyao.ph','Brgy@2024','Andres Bitong','Barangay Captain','San Isidro'],
  ['SIS-002','sis002@brgy.cabuyao.ph','Brgy@2024','Felisa Candelario','Barangay Secretary','San Isidro'],
  ['SIS-003','sis003@brgy.cabuyao.ph','Brgy@2024','Jaime Espejo','Barangay Councilor','San Isidro'],
]

const RESIDENTS = [
  ['resident@demo.com','resident@demo.com','resident123','Juan Dela Cruz','Marinig'],
  ['josefina.garcia@email.ph','josefina.garcia@email.ph','Res@2024','Josefina Garcia','Baclaran'],
  ['ramon.buencamino@email.ph','ramon.buencamino@email.ph','Res@2024','Ramon Buencamino','Baclaran'],
  ['teresita.pangilinan@email.ph','teresita.pangilinan@email.ph','Res@2024','Teresita Pangilinan','Baclaran'],
  ['silvestre.ramos@email.ph','silvestre.ramos@email.ph','Res@2024','Silvestre Ramos','Banay-Banay'],
  ['norma.bautista@email.ph','norma.bautista@email.ph','Res@2024','Norma Bautista','Banay-Banay'],
  ['diego.mendoza@email.ph','diego.mendoza@email.ph','Res@2024','Diego Mendoza','Banay-Banay'],
  ['milagros.santos@email.ph','milagros.santos@email.ph','Res@2024','Milagros Santos','Banlic'],
  ['fernando.cruz@email.ph','fernando.cruz@email.ph','Res@2024','Fernando Cruz','Banlic'],
  ['erlinda.reyes@email.ph','erlinda.reyes@email.ph','Res@2024','Erlinda Reyes','Banlic'],
  ['nemesio.villanueva@email.ph','nemesio.villanueva@email.ph','Res@2024','Nemesio Villanueva','Bigaa'],
  ['amelita.castillo@email.ph','amelita.castillo@email.ph','Res@2024','Amelita Castillo','Bigaa'],
  ['domingo.flores@email.ph','domingo.flores@email.ph','Res@2024','Domingo Flores','Bigaa'],
  ['carmelita.morales@email.ph','carmelita.morales@email.ph','Res@2024','Carmelita Morales','Butong'],
  ['bonifacio.torres@email.ph','bonifacio.torres@email.ph','Res@2024','Bonifacio Torres','Butong'],
  ['rosario.garcia@email.ph','rosario.garcia@email.ph','Res@2024','Rosario Garcia','Butong'],
  ['bernardo.aquino@email.ph','bernardo.aquino@email.ph','Res@2024','Bernardo Aquino','Casile'],
  ['filomena.perez@email.ph','filomena.perez@email.ph','Res@2024','Filomena Perez','Casile'],
  ['alejandro.espinosa@email.ph','alejandro.espinosa@email.ph','Res@2024','Alejandro Espinosa','Casile'],
  ['eloisa.herrera@email.ph','eloisa.herrera@email.ph','Res@2024','Eloisa Herrera','Diezmo'],
  ['simplicio.diaz@email.ph','simplicio.diaz@email.ph','Res@2024','Simplicio Diaz','Diezmo'],
  ['amor.navarro@email.ph','amor.navarro@email.ph','Res@2024','Amor Navarro','Diezmo'],
  ['arsenio.pascual@email.ph','arsenio.pascual@email.ph','Res@2024','Arsenio Pascual','Gulod'],
  ['perpetua.vargas@email.ph','perpetua.vargas@email.ph','Res@2024','Perpetua Vargas','Gulod'],
  ['exequiel.ruiz@email.ph','exequiel.ruiz@email.ph','Res@2024','Exequiel Ruiz','Gulod'],
  ['leoncia.castro@email.ph','leoncia.castro@email.ph','Res@2024','Leoncia Castro','Mamatid'],
  ['procopio.reyes@email.ph','procopio.reyes@email.ph','Res@2024','Procopio Reyes','Mamatid'],
  ['isidra.padilla@email.ph','isidra.padilla@email.ph','Res@2024','Isidra Padilla','Mamatid'],
  ['apolonia.mendez@email.ph','apolonia.mendez@email.ph','Res@2024','Apolonia Mendez','Marinig'],
  ['fausto.lim@email.ph','fausto.lim@email.ph','Res@2024','Fausto Lim','Marinig'],
  ['basilisa.aguilar@email.ph','basilisa.aguilar@email.ph','Res@2024','Basilisa Aguilar','Niugan'],
  ['clemente.padilla@email.ph','clemente.padilla@email.ph','Res@2024','Clemente Padilla','Niugan'],
  ['guadalupe.serrano@email.ph','guadalupe.serrano@email.ph','Res@2024','Guadalupe Serrano','Niugan'],
  ['hilarion.abad@email.ph','hilarion.abad@email.ph','Res@2024','Hilarion Abad','Pittland'],
  ['purificacion.moran@email.ph','purificacion.moran@email.ph','Res@2024','Purificacion Moran','Pittland'],
  ['saturnino.salazar@email.ph','saturnino.salazar@email.ph','Res@2024','Saturnino Salazar','Pittland'],
  ['celestina.delacruz@email.ph','celestina.delacruz@email.ph','Res@2024','Celestina Dela Cruz','Poblacion Dos'],
  ['ildefonso.soria@email.ph','ildefonso.soria@email.ph','Res@2024','Ildefonso Soria','Poblacion Dos'],
  ['honorata.ocampo@email.ph','honorata.ocampo@email.ph','Res@2024','Honorata Ocampo','Poblacion Dos'],
  ['patricio.pacia@email.ph','patricio.pacia@email.ph','Res@2024','Patricio Pacia','Poblacion Tres'],
  ['leodigario.legaspi@email.ph','leodigario.legaspi@email.ph','Res@2024','Leodigario Legaspi','Poblacion Tres'],
  ['segundina.guerrero@email.ph','segundina.guerrero@email.ph','Res@2024','Segundina Guerrero','Poblacion Tres'],
  ['tranquilino.mercado@email.ph','tranquilino.mercado@email.ph','Res@2024','Tranquilino Mercado','Poblacion Uno'],
  ['bienvenida.tolentino@email.ph','bienvenida.tolentino@email.ph','Res@2024','Bienvenida Tolentino','Poblacion Uno'],
  ['crisostomo.villaluz@email.ph','crisostomo.villaluz@email.ph','Res@2024','Crisostomo Villaluz','Poblacion Uno'],
  ['maximina.cabral@email.ph','maximina.cabral@email.ph','Res@2024','Maximina Cabral','Pulo'],
  ['dionisio.banaag@email.ph','dionisio.banaag@email.ph','Res@2024','Dionisio Banaag','Pulo'],
  ['sofronia.oropesa@email.ph','sofronia.oropesa@email.ph','Res@2024','Sofronia Oropesa','Pulo'],
  ['hermenegildo.manalo@email.ph','hermenegildo.manalo@email.ph','Res@2024','Hermenegildo Manalo','Sala'],
  ['visitacion.arenas@email.ph','visitacion.arenas@email.ph','Res@2024','Visitacion Arenas','Sala'],
  ['marciana.tamayo@email.ph','marciana.tamayo@email.ph','Res@2024','Marciana Tamayo','Sala'],
  ['lamberto.bitong@email.ph','lamberto.bitong@email.ph','Res@2024','Lamberto Bitong','San Isidro'],
  ['pilar.candelario@email.ph','pilar.candelario@email.ph','Res@2024','Pilar Candelario','San Isidro'],
  ['cornelio.espejo@email.ph','cornelio.espejo@email.ph','Res@2024','Cornelio Espejo','San Isidro'],
]

async function main() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CDRRMO FloodRoute'
  wb.created = new Date()

  // ── SHEET 1: COVER ─────────────────────────────────────────────────────────
  const cover = wb.addWorksheet('Summary', { tabColor: { argb: 'FF' + C.titleBg } })
  cover.columns = [{ width: 4 }, { width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 10 }]

  cover.mergeCells('B2:F2')
  const title = cover.getCell('B2')
  title.value = 'CDRRMO FloodRoute — Dummy Account Directory'
  title.font  = { name: FONT, bold: true, size: 16, color: { argb: 'FF' + C.titleFg } }
  title.fill  = hFill(C.titleBg)
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  cover.getRow(2).height = 40

  cover.mergeCells('B3:F3')
  const sub = cover.getCell('B3')
  sub.value = 'Cabuyao City CDRRMO  ·  All passwords are bcrypt-hashed in Supabase  ·  For internal use only'
  sub.font  = { name: FONT, size: 9, italic: true, color: { argb: 'FF555555' } }
  sub.fill  = hFill('E8EEF4')
  sub.alignment = { horizontal: 'center', vertical: 'middle' }
  cover.getRow(3).height = 18

  cover.getRow(5).height = 24
  const statHdr = ['Role', 'Count', 'Default Password', 'Portal / Login', 'Login identifier']
  statHdr.forEach((h, i) => {
    const cell = cover.getCell(5, i + 2)
    cell.value = h
    cell.font  = { name: FONT, bold: true, size: 10, color: { argb: 'FF' + C.headerFg } }
    cell.fill  = hFill(C.headerBg)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = border()
  })

  const statData = [
    ['Admin',            5, 'admin123 / Admin@2024',  '/admin/dashboard',    'Username or email', C.adminBg],
    ['Staff',            2, 'operator123 / Staff@2024','/admin/dashboard',   'Username or email', C.staffBg],
    ['Barangay Official',54,'brgy123 / Brgy@2024',    '/barangay/dashboard', 'Staff Code (e.g. BCL-001)', C.brgyBg],
    ['Resident',         54,'resident123 / Res@2024', '/resident/dashboard', 'Email address',     C.resBg],
    ['TOTAL',           115,'—',                      '—',                   '—',                 'F0F4F8'],
  ]
  statData.forEach((d, di) => {
    const r = cover.getRow(6 + di)
    r.height = 20
    const isTotal = di === 4
    ;[d[0], d[1], d[2], d[3], d[4]].forEach((v, ci) => {
      const cell = r.getCell(ci + 2)
      cell.value = v
      cell.fill  = hFill(d[5])
      cell.font  = { name: FONT, size: 9, bold: isTotal }
      cell.alignment = { vertical: 'middle', horizontal: ci === 1 ? 'center' : 'left' }
      cell.border = border('thin', 'D0D0D0')
    })
  })

  cover.mergeCells('B13:F13')
  const leg = cover.getCell('B13')
  leg.value = 'COLOR LEGEND'
  leg.font  = { name: FONT, bold: true, size: 9, color: { argb: 'FF333333' } }
  leg.alignment = { horizontal: 'left', vertical: 'middle' }
  cover.getRow(13).height = 20

  const legData = [
    ['Admin accounts',            C.adminBg, C.adminAcc],
    ['Staff accounts',            C.staffBg, C.staffAcc],
    ['Barangay Official accounts', C.brgyBg, C.brgyAcc],
    ['Resident accounts',          C.resBg,  C.resAcc],
  ]
  legData.forEach((l, li) => {
    const r = cover.getRow(14 + li)
    r.height = 18
    const swatch = r.getCell(2)
    swatch.value = '  ' + l[0]
    swatch.fill  = hFill(l[1])
    swatch.font  = { name: FONT, size: 9, bold: true, color: { argb: 'FF' + l[2] } }
    swatch.border = border('thin', l[2])
    swatch.alignment = { vertical: 'middle' }
    for (let c = 3; c <= 6; c++) {
      const cell = r.getCell(c)
      cell.fill   = hFill(l[1])
      cell.border = border('thin', l[2])
    }
  })

  // ── SHEET 2: ADMIN & STAFF ─────────────────────────────────────────────────
  const wsAS = wb.addWorksheet('Admin & Staff', { tabColor: { argb: 'FF' + C.adminAcc } })
  wsAS.columns = [
    { width: 4 }, { width: 5 }, { width: 18 }, { width: 32 }, { width: 18 },
    { width: 26 }, { width: 28 }, { width: 10 }, { width: 26 },
  ]

  wsAS.mergeCells('B1:I1')
  const asTitle = wsAS.getCell('B1')
  asTitle.value = 'Admin & Staff Accounts'
  asTitle.font  = { name: FONT, bold: true, size: 13, color: { argb: 'FF' + C.titleFg } }
  asTitle.fill  = hFill(C.titleBg)
  asTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsAS.getRow(1).height = 30

  const asHdr = ['#', 'Role', 'Username', 'Email', 'Password', 'Full Name', 'Position', 'Portal']
  const asHdrRow = wsAS.getRow(2)
  asHdr.forEach((h, i) => { asHdrRow.getCell(i + 2).value = h })
  applyHeader(asHdrRow, asHdr)
  wsAS.autoFilter = { from: { row: 2, column: 2 }, to: { row: 2, column: 9 } }
  wsAS.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

  let num = 1
  const writeAS = (arr, role, bg) => arr.forEach(a => {
    const r = wsAS.addRow([null, num++, role.toUpperCase(), a.u, a.e, a.pw, a.name, a.pos, a.portal])
    applyDataRow(r, bg, 9, { 2: 'center' })
    roleBadge(wsAS, r.number, 3, role)
  })
  writeAS(ADMINS, 'admin', C.adminBg)
  writeAS(STAFF, 'staff', C.staffBg)

  // ── SHEET 3: BARANGAY OFFICIALS ───────────────────────────────────────────
  const wsBO = wb.addWorksheet('Barangay Officials', { tabColor: { argb: 'FF' + C.brgyAcc } })
  wsBO.columns = [
    { width: 4 }, { width: 5 }, { width: 12 }, { width: 32 },
    { width: 14 }, { width: 26 }, { width: 22 }, { width: 18 }, { width: 10 },
  ]

  wsBO.mergeCells('B1:I1')
  const boTitle = wsBO.getCell('B1')
  boTitle.value = 'Barangay Official Accounts  (3 per barangay × 18 barangays = 54)'
  boTitle.font  = { name: FONT, bold: true, size: 13, color: { argb: 'FF' + C.titleFg } }
  boTitle.fill  = hFill(C.titleBg)
  boTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsBO.getRow(1).height = 30

  const boHdr = ['#', 'Staff Code', 'Email', 'Password', 'Full Name', 'Position', 'Barangay', 'Portal']
  const boHdrRow = wsBO.getRow(2)
  boHdr.forEach((h, i) => { boHdrRow.getCell(i + 2).value = h })
  applyHeader(boHdrRow, boHdr)
  wsBO.autoFilter = { from: { row: 2, column: 2 }, to: { row: 2, column: 9 } }
  wsBO.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

  let boRow = 3
  let lastBrgy = ''
  OFFICIALS.forEach((o, idx) => {
    if (o[5] !== lastBrgy) {
      if (lastBrgy !== '') { wsBO.addRow([]) ; boRow++ }
      wsBO.mergeCells(`B${boRow}:I${boRow}`)
      const sec = wsBO.getCell(`B${boRow}`)
      sec.value = o[5].toUpperCase()
      sec.font  = { name: FONT, bold: true, size: 9, color: { argb: 'FF' + C.brgyAcc } }
      sec.fill  = hFill(C.sectionBg)
      sec.alignment = { horizontal: 'left', vertical: 'middle' }
      wsBO.getRow(boRow).height = 16
      boRow++
      lastBrgy = o[5]
    }
    const r = wsBO.getRow(boRow)
    r.getCell(2).value = idx + 1
    r.getCell(3).value = o[0]
    r.getCell(4).value = o[1]
    r.getCell(5).value = o[2]
    r.getCell(6).value = o[3]
    r.getCell(7).value = o[4]
    r.getCell(8).value = o[5]
    r.getCell(9).value = '/barangay/dashboard'
    applyDataRow(r, C.brgyBg, 9, { 2: 'center', 3: 'center' })
    r.getCell(3).font = { name: FONT, bold: true, size: 9, color: { argb: 'FF' + C.brgyAcc } }
    boRow++
  })

  // ── SHEET 4: RESIDENTS ────────────────────────────────────────────────────
  const wsR = wb.addWorksheet('Residents', { tabColor: { argb: 'FF' + C.resAcc } })
  wsR.columns = [
    { width: 4 }, { width: 5 }, { width: 34 }, { width: 34 },
    { width: 14 }, { width: 26 }, { width: 18 }, { width: 10 },
  ]

  wsR.mergeCells('B1:H1')
  const rTitle = wsR.getCell('B1')
  rTitle.value = 'Resident Accounts  (3 per barangay × 18 barangays = 54)'
  rTitle.font  = { name: FONT, bold: true, size: 13, color: { argb: 'FF' + C.titleFg } }
  rTitle.fill  = hFill(C.titleBg)
  rTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsR.getRow(1).height = 30

  const rHdr = ['#', 'Username / Email', 'Email', 'Password', 'Full Name', 'Barangay', 'Portal']
  const rHdrRow = wsR.getRow(2)
  rHdr.forEach((h, i) => { rHdrRow.getCell(i + 2).value = h })
  applyHeader(rHdrRow, rHdr)
  wsR.autoFilter = { from: { row: 2, column: 2 }, to: { row: 2, column: 8 } }
  wsR.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

  let rRow = 3
  let lastRBrgy = ''
  RESIDENTS.forEach((res, idx) => {
    if (res[4] !== lastRBrgy) {
      if (lastRBrgy !== '') { wsR.addRow([]) ; rRow++ }
      wsR.mergeCells(`B${rRow}:H${rRow}`)
      const sec = wsR.getCell(`B${rRow}`)
      sec.value = res[4].toUpperCase()
      sec.font  = { name: FONT, bold: true, size: 9, color: { argb: 'FF' + C.resAcc } }
      sec.fill  = hFill(C.sectionBg)
      sec.alignment = { horizontal: 'left', vertical: 'middle' }
      wsR.getRow(rRow).height = 16
      rRow++
      lastRBrgy = res[4]
    }
    const r = wsR.getRow(rRow)
    r.getCell(2).value = idx + 1
    r.getCell(3).value = res[0]
    r.getCell(4).value = res[1]
    r.getCell(5).value = res[2]
    r.getCell(6).value = res[3]
    r.getCell(7).value = res[4]
    r.getCell(8).value = '/resident/dashboard'
    applyDataRow(r, C.resBg, 8, { 2: 'center' })
    rRow++
  })

  // ── SHEET 5: COMPLETE LIST ─────────────────────────────────────────────────
  const wsAll = wb.addWorksheet('All Accounts', { tabColor: { argb: 'FF2B6CB0' } })
  wsAll.columns = [
    { width: 4 }, { width: 5 }, { width: 20 }, { width: 34 },
    { width: 14 }, { width: 10 }, { width: 26 }, { width: 22 }, { width: 18 }, { width: 10 },
  ]

  wsAll.mergeCells('B1:J1')
  const allTitle = wsAll.getCell('B1')
  allTitle.value = 'Complete Account Directory  —  115 Accounts'
  allTitle.font  = { name: FONT, bold: true, size: 13, color: { argb: 'FF' + C.titleFg } }
  allTitle.fill  = hFill(C.titleBg)
  allTitle.alignment = { horizontal: 'center', vertical: 'middle' }
  wsAll.getRow(1).height = 30

  const allHdr = ['#', 'Username / Code', 'Email', 'Password', 'Role', 'Full Name', 'Position / Barangay', 'Barangay', 'Portal']
  const allHdrRow = wsAll.getRow(2)
  allHdr.forEach((h, i) => { allHdrRow.getCell(i + 2).value = h })
  applyHeader(allHdrRow, allHdr)
  wsAll.autoFilter = { from: { row: 2, column: 2 }, to: { row: 2, column: 10 } }
  wsAll.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

  const ALL = [
    ...ADMINS.map(a => [a.u, a.e, a.pw, 'admin', a.name, a.pos, '—', '/admin/dashboard']),
    ...STAFF.map(a  => [a.u, a.e, a.pw, 'staff', a.name, a.pos, '—', '/admin/dashboard']),
    ...OFFICIALS.map(o => [o[0], o[1], o[2], 'barangay', o[3], o[4], o[5], '/barangay/dashboard']),
    ...RESIDENTS.map(r => [r[0], r[1], r[2], 'resident', r[3], 'Resident', r[4], '/resident/dashboard']),
  ]

  const roleColors = { admin: C.adminBg, staff: C.staffBg, barangay: C.brgyBg, resident: C.resBg }
  ALL.forEach((a, idx) => {
    const r = wsAll.getRow(idx + 3)
    r.getCell(2).value = idx + 1
    r.getCell(3).value = a[0]
    r.getCell(4).value = a[1]
    r.getCell(5).value = a[2]
    r.getCell(7).value = a[4]
    r.getCell(8).value = a[5]
    r.getCell(9).value = a[6]
    r.getCell(10).value = a[7]
    applyDataRow(r, roleColors[a[3]], 10, { 2: 'center', 6: 'center' })
    roleBadge(wsAll, r.number, 6, a[3])
    r.getCell(3).font = { name: FONT, bold: true, size: 9 }
  })

  await wb.xlsx.writeFile(OUT)
  console.log('Saved:', OUT)
}

main().catch(e => { console.error(e); process.exit(1) })
