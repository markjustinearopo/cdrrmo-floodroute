-- ============================================================
-- seed_full_accounts.sql — Complete CDRRMO user population
--
-- Populates:
--   • 5 CDRRMO Admins (role = 'admin')
--   • 2 CDRRMO Staff / EOC (role = 'staff')
--   • 3 Barangay Officials × 18 barangays = 54 (role = 'barangay')
--   • 3 Residents × 18 barangays = 54 (role = 'resident')
--
-- Idempotent: ON CONFLICT (username) DO NOTHING preserves existing
-- accounts (including their bcrypt hashes). Writing password_plain
-- on new rows fires the trg_accounts_hash_password trigger which
-- hashes the value into password_hash and nulls password_plain.
--
-- Existing accounts preserved as-is:
--   admin / admin123       (admin)
--   operator / operator123 (staff)
--   MAR-001 / brgy123      (Marinig captain)
--   MAM-001 / brgy123      (Mamatid captain)
--   resident@demo.com / resident123  (Marinig resident)
--
-- NEW account passwords:
--   Admins (admin2–5):           Admin@2024
--   Staff (staff2):              Staff@2024
--   Barangay officials (-002/-003 + new barangays): Brgy@2024
--   Residents:                   Res@2024
-- ============================================================

begin;

-- ── 1. ADMIN ACCOUNTS (5 total; admin already exists) ────────────────────────
insert into public.accounts
  (username, email, password_plain, role, barangay, full_name, position, status)
values
  ('admin2', 'deputy@cabuyao.gov.ph',      'Admin@2024', 'admin', null, 'Maria Santos',    'CDRRMO Deputy Head',         'active'),
  ('admin3', 'operations@cabuyao.gov.ph',  'Admin@2024', 'admin', null, 'Roberto Garcia',  'Operations Manager',         'active'),
  ('admin4', 'data@cabuyao.gov.ph',        'Admin@2024', 'admin', null, 'Ana Reyes',       'Data & Analytics Officer',   'active'),
  ('admin5', 'itsystems@cabuyao.gov.ph',   'Admin@2024', 'admin', null, 'Carlos Bautista', 'IT Systems Administrator',   'active')
on conflict (username) do nothing;

-- ── 2. STAFF ACCOUNTS (2 total; operator already exists) ─────────────────────
insert into public.accounts
  (username, email, password_plain, role, barangay, full_name, position, status)
values
  ('staff2', 'monitoring@cabuyao.gov.ph', 'Staff@2024', 'staff', null, 'Ligaya Morales', 'Monitoring Officer', 'active')
on conflict (username) do nothing;

-- ── 3. BARANGAY OFFICIALS (3 per barangay × 18 = 54 total) ──────────────────
-- MAR-001 and MAM-001 already exist; add -002 and -003 for both,
-- plus all 3 for the remaining 16 barangays.
insert into public.accounts
  (username, email, password_plain, role, barangay, full_name, position, status)
values
  -- Baclaran
  ('BCL-001', 'bcl001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Baclaran',    'Roberto Santos',    'Barangay Captain',   'active'),
  ('BCL-002', 'bcl002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Baclaran',    'Maria Reyes',       'Barangay Secretary', 'active'),
  ('BCL-003', 'bcl003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Baclaran',    'Jose Cruz',         'Barangay Councilor', 'active'),
  -- Banay-Banay
  ('BNB-001', 'bnb001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banay-Banay', 'Elena Garcia',      'Barangay Captain',   'active'),
  ('BNB-002', 'bnb002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banay-Banay', 'Marco Torres',      'Barangay Secretary', 'active'),
  ('BNB-003', 'bnb003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banay-Banay', 'Ana Flores',        'Barangay Councilor', 'active'),
  -- Banlic
  ('BNL-001', 'bnl001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banlic',      'Pedro Ramos',       'Barangay Captain',   'active'),
  ('BNL-002', 'bnl002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banlic',      'Lina Bautista',     'Barangay Secretary', 'active'),
  ('BNL-003', 'bnl003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Banlic',      'Carlos Mendoza',    'Barangay Councilor', 'active'),
  -- Bigaa
  ('BIG-001', 'big001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Bigaa',       'Luz Villanueva',    'Barangay Captain',   'active'),
  ('BIG-002', 'big002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Bigaa',       'Andres Castillo',   'Barangay Secretary', 'active'),
  ('BIG-003', 'big003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Bigaa',       'Carmen Gonzales',   'Barangay Councilor', 'active'),
  -- Butong
  ('BUT-001', 'but001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Butong',      'Eduardo Morales',   'Barangay Captain',   'active'),
  ('BUT-002', 'but002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Butong',      'Rita Aquino',       'Barangay Secretary', 'active'),
  ('BUT-003', 'but003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Butong',      'Fernando Perez',    'Barangay Councilor', 'active'),
  -- Casile
  ('CAS-001', 'cas001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Casile',      'Gloria Espinosa',   'Barangay Captain',   'active'),
  ('CAS-002', 'cas002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Casile',      'Reynaldo Navarro',  'Barangay Secretary', 'active'),
  ('CAS-003', 'cas003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Casile',      'Teresita Vega',     'Barangay Councilor', 'active'),
  -- Diezmo
  ('DIE-001', 'die001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Diezmo',      'Leonardo Herrera',  'Barangay Captain',   'active'),
  ('DIE-002', 'die002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Diezmo',      'Rosario Diaz',      'Barangay Secretary', 'active'),
  ('DIE-003', 'die003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Diezmo',      'Ernesto Jimenez',   'Barangay Councilor', 'active'),
  -- Gulod
  ('GUL-001', 'gul001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Gulod',       'Marites Pascual',   'Barangay Captain',   'active'),
  ('GUL-002', 'gul002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Gulod',       'Renato Vargas',     'Barangay Secretary', 'active'),
  ('GUL-003', 'gul003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Gulod',       'Natividad Ruiz',    'Barangay Councilor', 'active'),
  -- Mamatid (MAM-001 exists; add -002 and -003)
  ('MAM-002', 'mam002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Mamatid',     'Rosalinda Castro',  'Barangay Secretary', 'active'),
  ('MAM-003', 'mam003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Mamatid',     'Danilo Reyes',      'Barangay Councilor', 'active'),
  -- Marinig (MAR-001 exists; add -002 and -003)
  ('MAR-002', 'mar002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Marinig',     'Corazon Mendez',    'Barangay Secretary', 'active'),
  ('MAR-003', 'mar003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Marinig',     'Arturo Lim',        'Barangay Councilor', 'active'),
  -- Niugan
  ('NIU-001', 'niu001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Niugan',      'Violeta Aguilar',   'Barangay Captain',   'active'),
  ('NIU-002', 'niu002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Niugan',      'Rodrigo Padilla',   'Barangay Secretary', 'active'),
  ('NIU-003', 'niu003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Niugan',      'Felicidad Serrano', 'Barangay Councilor', 'active'),
  -- Pittland
  ('PIT-001', 'pit001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pittland',    'Guillermo Abad',    'Barangay Captain',   'active'),
  ('PIT-002', 'pit002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pittland',    'Concepcion Moran',  'Barangay Secretary', 'active'),
  ('PIT-003', 'pit003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pittland',    'Marcelino Salazar', 'Barangay Councilor', 'active'),
  -- Poblacion Dos
  ('PDO-001', 'pdo001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Dos',  'Socorro Dela Cruz', 'Barangay Captain',   'active'),
  ('PDO-002', 'pdo002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Dos',  'Alfredo Soria',     'Barangay Secretary', 'active'),
  ('PDO-003', 'pdo003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Dos',  'Herminia Ocampo',   'Barangay Councilor', 'active'),
  -- Poblacion Tres
  ('PDT-001', 'pdt001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Tres', 'Domingo Pacia',     'Barangay Captain',   'active'),
  ('PDT-002', 'pdt002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Tres', 'Milagros Legaspi',  'Barangay Secretary', 'active'),
  ('PDT-003', 'pdt003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Tres', 'Ramon Guerrero',    'Barangay Councilor', 'active'),
  -- Poblacion Uno
  ('PDU-001', 'pdu001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Uno',  'Angelica Mercado',  'Barangay Captain',   'active'),
  ('PDU-002', 'pdu002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Uno',  'Nestor Tolentino',  'Barangay Secretary', 'active'),
  ('PDU-003', 'pdu003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Poblacion Uno',  'Lourdes Villaluz',  'Barangay Councilor', 'active'),
  -- Pulo
  ('PUL-001', 'pul001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pulo',        'Vicente Cabral',    'Barangay Captain',   'active'),
  ('PUL-002', 'pul002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pulo',        'Estrella Banaag',   'Barangay Secretary', 'active'),
  ('PUL-003', 'pul003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Pulo',        'Marcelo Oropesa',   'Barangay Councilor', 'active'),
  -- Sala
  ('SAL-001', 'sal001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Sala',        'Catalina Manalo',   'Barangay Captain',   'active'),
  ('SAL-002', 'sal002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Sala',        'Benedicto Arenas',  'Barangay Secretary', 'active'),
  ('SAL-003', 'sal003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'Sala',        'Evelyn Tamayo',     'Barangay Councilor', 'active'),
  -- San Isidro
  ('SIS-001', 'sis001@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'San Isidro',  'Andres Bitong',     'Barangay Captain',   'active'),
  ('SIS-002', 'sis002@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'San Isidro',  'Felisa Candelario', 'Barangay Secretary', 'active'),
  ('SIS-003', 'sis003@brgy.cabuyao.ph', 'Brgy@2024', 'barangay', 'San Isidro',  'Jaime Espejo',      'Barangay Councilor', 'active')
on conflict (username) do nothing;

-- ── 4. RESIDENT ACCOUNTS (3 per barangay × 18 = 54; resident@demo.com exists in Marinig) ──
insert into public.accounts
  (username, email, password_plain, role, barangay, full_name, position, status)
values
  -- Baclaran (3)
  ('josefina.garcia@email.ph',    'josefina.garcia@email.ph',    'Res@2024', 'resident', 'Baclaran',    'Josefina Garcia',         'Resident', 'active'),
  ('ramon.buencamino@email.ph',   'ramon.buencamino@email.ph',   'Res@2024', 'resident', 'Baclaran',    'Ramon Buencamino',        'Resident', 'active'),
  ('teresita.pangilinan@email.ph','teresita.pangilinan@email.ph','Res@2024', 'resident', 'Baclaran',    'Teresita Pangilinan',     'Resident', 'active'),
  -- Banay-Banay (3)
  ('silvestre.ramos@email.ph',    'silvestre.ramos@email.ph',    'Res@2024', 'resident', 'Banay-Banay', 'Silvestre Ramos',         'Resident', 'active'),
  ('norma.bautista@email.ph',     'norma.bautista@email.ph',     'Res@2024', 'resident', 'Banay-Banay', 'Norma Bautista',          'Resident', 'active'),
  ('diego.mendoza@email.ph',      'diego.mendoza@email.ph',      'Res@2024', 'resident', 'Banay-Banay', 'Diego Mendoza',           'Resident', 'active'),
  -- Banlic (3)
  ('milagros.santos@email.ph',    'milagros.santos@email.ph',    'Res@2024', 'resident', 'Banlic',      'Milagros Santos',         'Resident', 'active'),
  ('fernando.cruz@email.ph',      'fernando.cruz@email.ph',      'Res@2024', 'resident', 'Banlic',      'Fernando Cruz',           'Resident', 'active'),
  ('erlinda.reyes@email.ph',      'erlinda.reyes@email.ph',      'Res@2024', 'resident', 'Banlic',      'Erlinda Reyes',           'Resident', 'active'),
  -- Bigaa (3)
  ('nemesio.villanueva@email.ph', 'nemesio.villanueva@email.ph', 'Res@2024', 'resident', 'Bigaa',       'Nemesio Villanueva',      'Resident', 'active'),
  ('amelita.castillo@email.ph',   'amelita.castillo@email.ph',   'Res@2024', 'resident', 'Bigaa',       'Amelita Castillo',        'Resident', 'active'),
  ('domingo.flores@email.ph',     'domingo.flores@email.ph',     'Res@2024', 'resident', 'Bigaa',       'Domingo Flores',          'Resident', 'active'),
  -- Butong (3)
  ('carmelita.morales@email.ph',  'carmelita.morales@email.ph',  'Res@2024', 'resident', 'Butong',      'Carmelita Morales',       'Resident', 'active'),
  ('bonifacio.torres@email.ph',   'bonifacio.torres@email.ph',   'Res@2024', 'resident', 'Butong',      'Bonifacio Torres',        'Resident', 'active'),
  ('rosario.garcia@email.ph',     'rosario.garcia@email.ph',     'Res@2024', 'resident', 'Butong',      'Rosario Garcia',          'Resident', 'active'),
  -- Casile (3)
  ('bernardo.aquino@email.ph',    'bernardo.aquino@email.ph',    'Res@2024', 'resident', 'Casile',      'Bernardo Aquino',         'Resident', 'active'),
  ('filomena.perez@email.ph',     'filomena.perez@email.ph',     'Res@2024', 'resident', 'Casile',      'Filomena Perez',          'Resident', 'active'),
  ('alejandro.espinosa@email.ph', 'alejandro.espinosa@email.ph', 'Res@2024', 'resident', 'Casile',      'Alejandro Espinosa',      'Resident', 'active'),
  -- Diezmo (3)
  ('eloisa.herrera@email.ph',     'eloisa.herrera@email.ph',     'Res@2024', 'resident', 'Diezmo',      'Eloisa Herrera',          'Resident', 'active'),
  ('simplicio.diaz@email.ph',     'simplicio.diaz@email.ph',     'Res@2024', 'resident', 'Diezmo',      'Simplicio Diaz',          'Resident', 'active'),
  ('amor.navarro@email.ph',       'amor.navarro@email.ph',       'Res@2024', 'resident', 'Diezmo',      'Amor Navarro',            'Resident', 'active'),
  -- Gulod (3)
  ('arsenio.pascual@email.ph',    'arsenio.pascual@email.ph',    'Res@2024', 'resident', 'Gulod',       'Arsenio Pascual',         'Resident', 'active'),
  ('perpetua.vargas@email.ph',    'perpetua.vargas@email.ph',    'Res@2024', 'resident', 'Gulod',       'Perpetua Vargas',         'Resident', 'active'),
  ('exequiel.ruiz@email.ph',      'exequiel.ruiz@email.ph',      'Res@2024', 'resident', 'Gulod',       'Exequiel Ruiz',           'Resident', 'active'),
  -- Mamatid (3)
  ('leoncia.castro@email.ph',     'leoncia.castro@email.ph',     'Res@2024', 'resident', 'Mamatid',     'Leoncia Castro',          'Resident', 'active'),
  ('procopio.reyes@email.ph',     'procopio.reyes@email.ph',     'Res@2024', 'resident', 'Mamatid',     'Procopio Reyes',          'Resident', 'active'),
  ('isidra.padilla@email.ph',     'isidra.padilla@email.ph',     'Res@2024', 'resident', 'Mamatid',     'Isidra Padilla',          'Resident', 'active'),
  -- Marinig (2 new; resident@demo.com = Juan Dela Cruz already exists)
  ('apolonia.mendez@email.ph',    'apolonia.mendez@email.ph',    'Res@2024', 'resident', 'Marinig',     'Apolonia Mendez',         'Resident', 'active'),
  ('fausto.lim@email.ph',         'fausto.lim@email.ph',         'Res@2024', 'resident', 'Marinig',     'Fausto Lim',              'Resident', 'active'),
  -- Niugan (3)
  ('basilisa.aguilar@email.ph',   'basilisa.aguilar@email.ph',   'Res@2024', 'resident', 'Niugan',      'Basilisa Aguilar',        'Resident', 'active'),
  ('clemente.padilla@email.ph',   'clemente.padilla@email.ph',   'Res@2024', 'resident', 'Niugan',      'Clemente Padilla',        'Resident', 'active'),
  ('guadalupe.serrano@email.ph',  'guadalupe.serrano@email.ph',  'Res@2024', 'resident', 'Niugan',      'Guadalupe Serrano',       'Resident', 'active'),
  -- Pittland (3)
  ('hilarion.abad@email.ph',      'hilarion.abad@email.ph',      'Res@2024', 'resident', 'Pittland',    'Hilarion Abad',           'Resident', 'active'),
  ('purificacion.moran@email.ph', 'purificacion.moran@email.ph', 'Res@2024', 'resident', 'Pittland',    'Purificacion Moran',      'Resident', 'active'),
  ('saturnino.salazar@email.ph',  'saturnino.salazar@email.ph',  'Res@2024', 'resident', 'Pittland',    'Saturnino Salazar',       'Resident', 'active'),
  -- Poblacion Dos (3)
  ('celestina.delacruz@email.ph', 'celestina.delacruz@email.ph', 'Res@2024', 'resident', 'Poblacion Dos',  'Celestina Dela Cruz',  'Resident', 'active'),
  ('ildefonso.soria@email.ph',    'ildefonso.soria@email.ph',    'Res@2024', 'resident', 'Poblacion Dos',  'Ildefonso Soria',      'Resident', 'active'),
  ('honorata.ocampo@email.ph',    'honorata.ocampo@email.ph',    'Res@2024', 'resident', 'Poblacion Dos',  'Honorata Ocampo',      'Resident', 'active'),
  -- Poblacion Tres (3)
  ('patricio.pacia@email.ph',     'patricio.pacia@email.ph',     'Res@2024', 'resident', 'Poblacion Tres', 'Patricio Pacia',       'Resident', 'active'),
  ('leodigario.legaspi@email.ph', 'leodigario.legaspi@email.ph', 'Res@2024', 'resident', 'Poblacion Tres', 'Leodigario Legaspi',   'Resident', 'active'),
  ('segundina.guerrero@email.ph', 'segundina.guerrero@email.ph', 'Res@2024', 'resident', 'Poblacion Tres', 'Segundina Guerrero',   'Resident', 'active'),
  -- Poblacion Uno (3)
  ('tranquilino.mercado@email.ph','tranquilino.mercado@email.ph','Res@2024', 'resident', 'Poblacion Uno',  'Tranquilino Mercado',  'Resident', 'active'),
  ('bienvenida.tolentino@email.ph','bienvenida.tolentino@email.ph','Res@2024','resident', 'Poblacion Uno',  'Bienvenida Tolentino', 'Resident', 'active'),
  ('crisostomo.villaluz@email.ph','crisostomo.villaluz@email.ph','Res@2024', 'resident', 'Poblacion Uno',  'Crisostomo Villaluz',  'Resident', 'active'),
  -- Pulo (3)
  ('maximina.cabral@email.ph',    'maximina.cabral@email.ph',    'Res@2024', 'resident', 'Pulo',        'Maximina Cabral',         'Resident', 'active'),
  ('dionisio.banaag@email.ph',    'dionisio.banaag@email.ph',    'Res@2024', 'resident', 'Pulo',        'Dionisio Banaag',         'Resident', 'active'),
  ('sofronia.oropesa@email.ph',   'sofronia.oropesa@email.ph',   'Res@2024', 'resident', 'Pulo',        'Sofronia Oropesa',        'Resident', 'active'),
  -- Sala (3)
  ('hermenegildo.manalo@email.ph','hermenegildo.manalo@email.ph','Res@2024', 'resident', 'Sala',        'Hermenegildo Manalo',     'Resident', 'active'),
  ('visitacion.arenas@email.ph',  'visitacion.arenas@email.ph',  'Res@2024', 'resident', 'Sala',        'Visitacion Arenas',       'Resident', 'active'),
  ('marciana.tamayo@email.ph',    'marciana.tamayo@email.ph',    'Res@2024', 'resident', 'Sala',        'Marciana Tamayo',         'Resident', 'active'),
  -- San Isidro (3)
  ('lamberto.bitong@email.ph',    'lamberto.bitong@email.ph',    'Res@2024', 'resident', 'San Isidro',  'Lamberto Bitong',         'Resident', 'active'),
  ('pilar.candelario@email.ph',   'pilar.candelario@email.ph',   'Res@2024', 'resident', 'San Isidro',  'Pilar Candelario',        'Resident', 'active'),
  ('cornelio.espejo@email.ph',    'cornelio.espejo@email.ph',    'Res@2024', 'resident', 'San Isidro',  'Cornelio Espejo',         'Resident', 'active')
on conflict (username) do nothing;

-- ── 5. RESIDENT PROFILES in `residents` table ────────────────────────────────
-- Mirror each resident account with a resident record (same as app_register_resident does).
-- WHERE NOT EXISTS guard makes this re-runnable without duplicates.
insert into public.residents (full_name, sex, barangay, purok, household_size, registered_at)
select v.full_name, v.sex, v.barangay, v.purok, v.household_size, now()
from (values
  -- Baclaran
  ('Josefina Garcia',         'F', 'Baclaran',    'Purok 1', 4),
  ('Ramon Buencamino',        'M', 'Baclaran',    'Purok 2', 3),
  ('Teresita Pangilinan',     'F', 'Baclaran',    'Purok 3', 5),
  -- Banay-Banay
  ('Silvestre Ramos',         'M', 'Banay-Banay', 'Purok 1', 3),
  ('Norma Bautista',          'F', 'Banay-Banay', 'Purok 2', 4),
  ('Diego Mendoza',           'M', 'Banay-Banay', 'Purok 3', 2),
  -- Banlic
  ('Milagros Santos',         'F', 'Banlic',      'Purok 1', 5),
  ('Fernando Cruz',           'M', 'Banlic',      'Purok 2', 3),
  ('Erlinda Reyes',           'F', 'Banlic',      'Purok 3', 4),
  -- Bigaa
  ('Nemesio Villanueva',      'M', 'Bigaa',       'Purok 1', 3),
  ('Amelita Castillo',        'F', 'Bigaa',       'Purok 2', 4),
  ('Domingo Flores',          'M', 'Bigaa',       'Purok 3', 2),
  -- Butong
  ('Carmelita Morales',       'F', 'Butong',      'Purok 1', 4),
  ('Bonifacio Torres',        'M', 'Butong',      'Purok 2', 3),
  ('Rosario Garcia',          'F', 'Butong',      'Purok 3', 5),
  -- Casile
  ('Bernardo Aquino',         'M', 'Casile',      'Purok 1', 3),
  ('Filomena Perez',          'F', 'Casile',      'Purok 2', 4),
  ('Alejandro Espinosa',      'M', 'Casile',      'Purok 3', 2),
  -- Diezmo
  ('Eloisa Herrera',          'F', 'Diezmo',      'Purok 1', 4),
  ('Simplicio Diaz',          'M', 'Diezmo',      'Purok 2', 3),
  ('Amor Navarro',            'F', 'Diezmo',      'Purok 3', 5),
  -- Gulod
  ('Arsenio Pascual',         'M', 'Gulod',       'Purok 1', 3),
  ('Perpetua Vargas',         'F', 'Gulod',       'Purok 2', 4),
  ('Exequiel Ruiz',           'M', 'Gulod',       'Purok 3', 2),
  -- Mamatid
  ('Leoncia Castro',          'F', 'Mamatid',     'Purok 1', 4),
  ('Procopio Reyes',          'M', 'Mamatid',     'Purok 2', 3),
  ('Isidra Padilla',          'F', 'Mamatid',     'Purok 3', 5),
  -- Marinig (2 new; Juan Dela Cruz already inserted by seed_demo)
  ('Apolonia Mendez',         'F', 'Marinig',     'Purok 1', 3),
  ('Fausto Lim',              'M', 'Marinig',     'Purok 2', 4),
  -- Niugan
  ('Basilisa Aguilar',        'F', 'Niugan',      'Purok 1', 3),
  ('Clemente Padilla',        'M', 'Niugan',      'Purok 2', 4),
  ('Guadalupe Serrano',       'F', 'Niugan',      'Purok 3', 2),
  -- Pittland
  ('Hilarion Abad',           'M', 'Pittland',    'Purok 1', 4),
  ('Purificacion Moran',      'F', 'Pittland',    'Purok 2', 3),
  ('Saturnino Salazar',       'M', 'Pittland',    'Purok 3', 5),
  -- Poblacion Dos
  ('Celestina Dela Cruz',     'F', 'Poblacion Dos',  'Purok 1', 4),
  ('Ildefonso Soria',         'M', 'Poblacion Dos',  'Purok 2', 3),
  ('Honorata Ocampo',         'F', 'Poblacion Dos',  'Purok 3', 2),
  -- Poblacion Tres
  ('Patricio Pacia',          'M', 'Poblacion Tres', 'Purok 1', 3),
  ('Leodigario Legaspi',      'M', 'Poblacion Tres', 'Purok 2', 4),
  ('Segundina Guerrero',      'F', 'Poblacion Tres', 'Purok 3', 5),
  -- Poblacion Uno
  ('Tranquilino Mercado',     'M', 'Poblacion Uno',  'Purok 1', 4),
  ('Bienvenida Tolentino',    'F', 'Poblacion Uno',  'Purok 2', 3),
  ('Crisostomo Villaluz',     'M', 'Poblacion Uno',  'Purok 3', 2),
  -- Pulo
  ('Maximina Cabral',         'F', 'Pulo',        'Purok 1', 3),
  ('Dionisio Banaag',         'M', 'Pulo',        'Purok 2', 4),
  ('Sofronia Oropesa',        'F', 'Pulo',        'Purok 3', 5),
  -- Sala
  ('Hermenegildo Manalo',     'M', 'Sala',        'Purok 1', 4),
  ('Visitacion Arenas',       'F', 'Sala',        'Purok 2', 3),
  ('Marciana Tamayo',         'F', 'Sala',        'Purok 3', 2),
  -- San Isidro
  ('Lamberto Bitong',         'M', 'San Isidro',  'Purok 1', 3),
  ('Pilar Candelario',        'F', 'San Isidro',  'Purok 2', 4),
  ('Cornelio Espejo',         'M', 'San Isidro',  'Purok 3', 5)
) as v(full_name, sex, barangay, purok, household_size)
where not exists (
  select 1 from public.residents r
  where r.full_name = v.full_name and r.barangay = v.barangay
);

commit;
