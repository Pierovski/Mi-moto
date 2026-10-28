export const STORAGE_KEY = 'mi_moto_n160_data_v1';
export const CURRENT_SCHEMA_VERSION = 2;
export const TANK_CAPACITY_GAL = 3.7; // 14 Litros exactos de la Pulsar N160 FI

export const MAINT_RULES = [
  {
    id: 'breakin_500',
    title: '1er Servicio de Asentamiento',
    subtitle: 'Aceite 20W-50 + Filtro original (500 km)',
    intervalKm: 500,
    intervalMonths: 2,
    onlyFirstTime: true,
    infoKey: 'breakin_guide'
  },
  {
    id: 'chain_lube',
    title: 'Kit de Cadena (Limpieza y Tensión)',
    subtitle: 'Holgura 20-30 mm y lubricación O-Ring (Cada 500 km)',
    intervalKm: 500,
    intervalMonths: 1,
    onlyFirstTime: false,
    infoKey: 'chk_chain'
  },
  {
    id: 'oil_change',
    title: 'Cambio de Aceite (20W-50) y Filtro',
    subtitle: '1.0 Litro SAE 20W-50 JASO MA2 (Cada 2,500 km o 6 meses)',
    intervalKm: 2500,
    intervalMonths: 6,
    onlyFirstTime: false,
    infoKey: 'spec_oil'
  },
  {
    id: 'air_spark',
    title: 'Filtro de Aire y Bujías DTS-i',
    subtitle: 'Inspección y calibración 0.7-0.8 mm (Cada 5,000 km)',
    intervalKm: 5000,
    intervalMonths: 12,
    onlyFirstTime: false,
    infoKey: 'maint_air_spark'
  },
  {
    id: 'brakes_abs',
    title: 'Frenos ABS (Pastillas y Líquido DOT 4)',
    subtitle: 'Discos 300mm / 230mm (Cada 5,000 km o 12 meses)',
    intervalKm: 5000,
    intervalMonths: 12,
    onlyFirstTime: false,
    infoKey: 'chk_brakes'
  },
  {
    id: 'valve_calib',
    title: 'Calibración de Válvulas y Cambio Filtro Aire',
    subtitle: 'Adm: 0.05 mm • Esc: 0.08-0.10 mm (Cada 10,000 km)',
    intervalKm: 10000,
    intervalMonths: 18,
    onlyFirstTime: false,
    infoKey: 'spec_torque'
  },
  {
    id: 'fork_oil',
    title: 'Mantenimiento Barras Telescópicas (37 mm)',
    subtitle: 'Cambio de aceite hidráulico y retenes (Cada 15,000 km)',
    intervalKm: 15000,
    intervalMonths: 24,
    onlyFirstTime: false,
    infoKey: 'chk_lights'
  }
];

export const TECHNICAL_GUIDES = {
  breakin_guide: {
    category: 'CUIDADO DEL MOTOR NUEVO',
    title: 'Protocolo de Asentamiento (0 - 2,000 km)',
    how: 'Durante los primeros 1,000 km mantén el motor por debajo de las 5,000 RPM evitando acelerones bruscos en frío. Varía la velocidad y las marchas constantemente. A los 500 km exactos realiza el primer cambio de aceite y filtro de papel.',
    why: 'Los anillos del pistón y el cilindro están hermanándose a nivel microscópico y desprenden micropartículas metálicas naturales. Cambiar aceite y filtro a los 500 km retira esa limalla inicial.'
  },
  telemetry_how: {
    category: 'PRECISIÓN DE CONSUMO PREMIUM',
    title: '¿Cómo lograr un cálculo exacto en el grifo?',
    how: 'Abastece siempre Gasolina Premium (95/97 octanos) pidiendo "Tanque lleno hasta el primer corte automático de la pistola". Registra el kilometraje actual y el monto pagado en cada visita.',
    why: 'El corte automático deja el combustible exactamente al mismo nivel físico dentro de los 14 litros del tanque. Así, los galones que entran en tu siguiente carga equivalen al 100% real de lo quemado.'
  },
  chk_tires: {
    category: 'SEGURIDAD Y AGARRE',
    title: 'Presión de Llantas en Frío (25 / 28-32 PSI)',
    how: 'Mide siempre con las llantas frías (rodando menos de 2 km). Adelante: 25 PSI fijos. Atrás: 28 PSI solo o 32 PSI si vas con copiloto o carga.',
    why: 'El aire caliente expande la presión interna y da lecturas falsas. La presión exacta protege la carcasa tubeless y mantiene el perfil de giro original de la N160.'
  },
  chk_chain: {
    category: 'TRANSMISIÓN SECUNDARIA',
    title: 'Holgura (20-30 mm) y Lubricación O-Ring',
    how: 'En el caballete central y en neutro, mide en el punto medio inferior del basculante: la cadena debe moverse verticalmente entre 2 y 3 cm. Límpiala con desengrasante para O-Rings o kerosene, seca y lubrica por la cara interna.',
    why: 'Una cadena muy tensa destruye el rodamiento del eje de salida de la caja y estira los eslabones; una muy suelta chicotea el basculante.'
  },
  chk_brakes: {
    category: 'FRENADO DE DOBLE CANAL',
    title: 'Inspección de Frenos ABS y Líquido DOT 4',
    how: 'Verifica tacto firme en manigueta y pedal, pastillas con >2 mm de material visible y líquido DOT 4 sobre el nivel MIN. Frena 70% adelante y 30% atrás acompañando con freno de motor.',
    why: 'El líquido DOT 4 es higroscópico (absorbe humedad del ambiente con los meses), lo que reduce su punto de ebullición y puede corroer el modulador ABS si no se renueva.'
  },
  chk_oil: {
    category: 'LUBRICACIÓN Y TEMPERATURA',
    title: 'Lectura Exacta del Visor de Aceite (Ojo de Buey)',
    how: 'Con el motor tibio, apaga la moto y súbela al caballete central sobre piso plano. Espera 3 minutos para que el aceite del radiador baje al cárter y verifica que el nivel esté entre MIN y MAX.',
    why: 'Si mides sobre la pata lateral obtendrás una lectura errónea. El aceite 20W-50 refrigera la culata pasando por el radiador frontal.'
  },
  chk_lights: {
    category: 'SUSPENSIÓN Y ECU FI',
    title: 'Barras de 37mm, Faro Bi-LED y Sensor de Altura',
    how: 'Verifica que los tubos cromados de las barras estén limpios y secos sin anillos de aceite. Si subes a sierra (>2,000 msnm), apaga la moto de la llave por 5 segundos a mitad de ascenso y vuelve a dar contacto.',
    why: 'Ese reinicio permite que el sensor barométrico MAP de la inyección recalibre la presión atmosférica y ajuste la mezcla oxígeno/combustible.'
  },
  spec_oil: {
    category: 'ESPECIFICACIÓN DE MOTOR',
    title: 'Aceite SAE 20W-50 API SL / JASO MA2 (1.0 L)',
    how: 'En cada cambio regular utiliza exactamente 1.0 Litro (1,000 ml). Solo en desarme total de motor se usan 1.2 L. Exige norma JASO MA2.',
    why: 'La norma JASO MA2 garantiza el coeficiente de fricción exacto para que los discos de embrague bañados en aceite no patinen al exigir torque.'
  },
  spec_fuel: {
    category: 'SISTEMA DE INYECCIÓN FI',
    title: 'Tanque de 14 Litros (3.70 Gal) • Gasolina Premium',
    how: 'Utiliza exclusivamente gasolina Premium (95/97 octanos) y evita rodar con la reserva parpadeando constantemente.',
    why: 'La bomba electrónica de inyección trabaja sumergida y utiliza la propia gasolina alrededor para disipar calor y lubricar su rotor.'
  },
  maint_air_spark: {
    category: 'COMBUSTIÓN DTS-i',
    title: 'Filtro de Aire Viscoso y Doble Bujía (0.7 - 0.8 mm)',
    how: 'Nunca sopletees el filtro de aire con compresora (es de papel viscoso). Limpia la caja de admisión cada 5,000 km y reemplaza el filtro cada 10,000 km.',
    why: 'El aire a alta presión abre los microporos del papel filtrante dejando pasar sílice y polvo abrasivo directo al cilindro.'
  },
  spec_torque: {
    category: 'AJUSTE DE PRECISIÓN',
    title: 'Torques de Apriete (Nm) y Calibración de Válvulas',
    how: 'Tapón de drenaje de cárter: 22 a 25 Nm cambiando siempre su arandela. Válvulas con motor completamente frío: 0.05 mm admisión y 0.08-0.10 mm escape.',
    why: 'Exceder 25 Nm en el tapón de acero barre los hilos del cárter de aluminio. Válvulas pisadas restan compresión y dificultan el arranque.'
  },
  tire_dot_guide: {
    category: 'INGENIERÍA DE NEUMÁTICOS',
    title: 'Código DOT (SSAA), Compuesto y TWI',
    how: 'Revisa los 4 dígitos del código DOT en el flanco (ej. 1826 = semana 18 del año 2026) y los topes TWI dentro del surco (1.6 mm).',
    why: 'A partir de los 4 años desde su fabricación el caucho se cristaliza y pierde adherencia en frenadas de emergencia aunque tenga dibujo.'
  },
  elec_load_guide: {
    category: 'PROTECCIÓN DEL RAMAL FI',
    title: 'Batería 12V 4Ah VRLA y Drenaje Parásito',
    how: 'Conecta alarmas, GPS o cargadores mediante relé bajo llave y fusible independiente sin pelar cables originales. Consumo en reposo < 3 mA.',
    why: 'La batería original es de 4 Ah; la ECU e inyector requieren mínimo 11.8V estables para presurizar el riel y arrancar.'
  },
  spa_care_guide: {
    category: 'ESTÉTICA & PROTECCIÓN ANTICORROSIVA',
    title: 'Lavado, Radiador y Retenes (Cada 400 km)',
    how: 'Lava siempre con los discos de freno y motor fríos usando shampoo neutro. Nunca apuntes chorro a alta presión directo al radiador de aceite ni a los retenes de las barras de 37 mm. Seca con microfibra y lubrica cadena.',
    why: 'El barro y el polvo acumulados en los tubos de la suspensión lijan los retenes provocando fugas, y el agua a presión dobla las aletas del radiador.'
  },
  obd_ecu_guide: {
    category: 'TELEMETRÍA EN VIVO OBD2 (KONNWEI KW901)',
    title: 'Cockpit Dedicado ECU Bajaj N160 FI',
    how: 'Conecta el cable de 6 pines bajo el asiento y enchufa tu KONNWEI KW901. Enciende el botón del escáner, abre contacto en la moto y toca "⚡ Conectar". Toca "⛶ Modo Timón" para usar toda la pantalla sin distracciones.',
    why: 'Extrae en tiempo real los 14 parámetros internos del microcontrolador Bosch/Bajaj (RPM, Velocidad, Marcha, Temperatura, Voltaje, TPS, Carga, MAP, IAT, Chispa, Sonda Lambda y Códigos DTC) manteniendo la pantalla siempre encendida.'
  },
  obd_speed_info: {
    category: 'TELEMETRÍA DE VELOCIDAD (PID 010D)',
    title: 'Velocidad Real de la ECU vs. Tablero',
    how: 'Muestra los km/h exactos que calcula la computadora a partir del sensor del anillo fónico ABS de la rueda, registrando además tu velocidad pico de la ruta.',
    why: 'Los tableros de fábrica suelen marcar entre 5% y 7% de velocidad extra por norma internacional. La lectura OBD2 te entrega la velocidad física real sin ese margen de error.'
  },
  obd_gear_info: {
    category: 'TRANSMISIÓN DE 5 VELOCIDADES',
    title: 'Indicador de Marcha y Guardián de Cambio',
    how: 'Calcula instantáneamente en qué cambio vas (N, 1, 2, 3, 4 o 5) cruzando las RPM del cigüeñal con la velocidad real y la relación de piñón/catalina original (14T / 45T).',
    why: 'Te protege durante el asentamiento (<1,000 km) avisándote con vibración y destello rojo si superas las 5,000 RPM, y evita llevar el motor ahogado o sobrerrevolucionado en ruta.'
  },
  obd_rpm_info: {
    category: 'GIRO DEL CIGÜEÑAL (PID 010C)',
    title: 'Tacómetro Digital de Precisión (RPM)',
    how: 'Lee directamente del sensor inductivo CKP los giros exactos por minuto del motor monocilíndrico 164.82 cc. Ralentí normal en caliente: 1,350 a 1,450 RPM.',
    why: 'El torque máximo de tu N160 se entrega a las 6,750 RPM (14.65 Nm) y la potencia máxima a las 8,750 RPM (15.78 HP). Pasar de 8,800 RPM no da más empuje y desgasta el tren alternativo.'
  },
  obd_temp_info: {
    category: 'TERMOMETRÍA DEL MOTOR (PID 0105)',
    title: 'Temperatura Exacta de Motor y Aceite (°C)',
    how: 'Menos de 45 °C: Motor frío (no acelerar fuerte). Entre 65 °C y 95 °C: Rango térmico óptimo de trabajo. Más de 105 °C: Alerta de sobrecalentamiento.',
    why: 'El tablero original de la N160 no tiene medidor de temperatura en grados, solo un icono que prende cuando ya está hirviendo. Con este dato sabes el segundo exacto en que el aceite 20W-50 ya lubricó toda la culata.'
  },
  obd_volt_info: {
    category: 'SISTEMA DE CARGA 12V (COMANDO ATRV)',
    title: 'Voltaje de Batería (4Ah) y Estator Trifásico',
    how: 'Motor apagado (contacto): debe marcar >12.4V. Motor encendido acelerando (>2,500 RPM): debe mantenerse estable entre 13.6V y 14.4V.',
    why: 'Si con el motor en marcha ves menos de 12.8V, el estator o regulador no están cargando y te quedarás botado. Si supera los 14.8V, el regulador está sobrecargando y puede inflar tu batería o dañar la ECU.'
  },
  obd_tps_info: {
    category: 'CUERPO DE ACELERACIÓN FI (PID 0111)',
    title: 'Porcentaje de Apertura de Mariposa (TPS)',
    how: 'Mide de 0% a 100% cuánto estás abriendo el puño del acelerador y cuánto aire dejas entrar al cuerpo de inyección.',
    why: 'Manejar entre 15% y 45% de TPS mantiene a la ECU en "Lazo Cerrado" (modo económico), logrando rendimientos cercanos a 145-155 km/galón de Gasolina Premium.'
  },
  obd_load_info: {
    category: 'ESFUERZO VOLUMÉTRICO (PID 0104)',
    title: 'Carga Calculada del Motor (%)',
    how: 'Indica del 0% al 100% cuánto torque o esfuerzo real se le está exigiendo al cilindro respecto a su capacidad máxima en ese régimen de RPM.',
    why: 'Si ves la Carga al 90% pero las RPM son bajas (ej. subiendo una cuesta en 4ta o 5ta marcha), estás forzando la biela y provocando cascabeleo; debes bajar un cambio de inmediato.'
  },
  obd_map_info: {
    category: 'SENSOR BAROMÉTRICO Y VACÍO (PID 010B)',
    title: 'Presión de Admisión (kPa) y Altímetro (msnm)',
    how: 'A nivel del mar con contacto puesto marca ~101 kPa (0 msnm). Al subir hacia la sierra la presión cae (~75 kPa a 2,500 msnm) y la app calcula tu altitud.',
    why: 'La ECU usa este sensor para saber cuánto oxígeno hay en el aire y recortar gasolina en altura para que la moto no se ahogue al subir de la costa a la sierra.'
  },
  obd_iat_info: {
    category: 'DENSIDAD DE OXÍGENO (PID 010F)',
    title: 'Temperatura de Aire de Admisión - IAT (°C)',
    how: 'Mide la temperatura exacta del aire que está entrando dentro de la caja del filtro de aire bajo el asiento.',
    why: 'El aire más fresco es más denso en oxígeno y produce una explosión más potente. En tráfico pesado al mediodía verás subir este valor.'
  },
  obd_timing_info: {
    category: 'ENCENDIDO DIGITAL DTS-i (PID 010E)',
    title: 'Avance de Chispa de Doble Bujía (Grados °)',
    how: 'Muestra cuántos grados antes de que el pistón llegue arriba (PMS) saltan las chispas en las dos bujías Champion RG6HCC. En ralentí ronda 8°-12° y acelerando sube a 28°-35°.',
    why: 'Confirma que el mapa de encendido digital está adelantando la chispa correctamente a altas RPM. Si usas gasolina de bajo octanaje, la ECU retrasa el avance y pierdes potencia.'
  },
  obd_o2_info: {
    category: 'COMBUSTIÓN Y SONDA LAMBDA (PID 0114)',
    title: 'Sensor de Oxígeno (V) y Ajuste de Mezcla (STFT %)',
    how: 'En motor caliente oscila rápido entre 0.1V (mezcla pobre) y 0.9V (mezcla rica). El ajuste STFT ideal debe estar entre -8% y +8%.',
    why: 'Si el ajuste STFT supera +12% constantemente, te avisa de forma temprana que el inyector está sucio o hay una entrada de aire pirata antes de que siquiera prenda el Check Engine.'
  },
  obd_runtime_info: {
    category: 'CRONÓMETRO INTERNO ECU (PID 011F)',
    title: 'Tiempo Continuo de Motor Encendido (MM:SS)',
    how: 'Cuenta el tiempo exacto desde el último arranque del motor sin haberse apagado.',
    why: 'Útil para controlar que cumpliste al menos 60-90 segundos de calentamiento lubricando la culata antes de salir a rodar en las mañanas, y medir tramos continuos de viaje.'
  },
  obd_dtc_info: {
    category: 'AUTODIAGNÓSTICO OBD2 (MODOS 03 Y 04)',
    title: 'Escáner y Borrador de Códigos de Falla (DTC)',
    how: 'Toca "🔍 Escanear Fallas" para consultar la memoria de errores de la ECU. Si reparaste un sensor y quedó la luz amarilla encendida, toca "🧹 Borrar Check Engine".',
    why: 'Te ahorra pagar entre S/ 40 y S/ 60 por escaneo electrónico en talleres externos y traduce cada código (ej. P0131, P0562) al componente exacto de tu Pulsar N160.'
  },
  obd_econ_info: {
    category: 'EFICIENCIA VOLUMÉTRICA & AUTONOMÍA (14 L)',
    title: 'Economía Instantánea (km/L) y Rango de Tanque',
    how: 'Cruza en vivo la velocidad real (010D), carga del motor (0104), apertura de mariposa (0111) y tu media histórica de Gasolina Premium para estimar cuántos km/L estás logrando en ese segundo y cuántos kilómetros de autonomía te quedan.',
    why: 'Te enseña a encontrar el "punto dulce" del acelerador en carretera para estirar al máximo los 14 litros (3.70 galones) del tanque.'
  },
  nav_radar_guide: {
    category: 'NAVEGACIÓN TÁCTICA & TELEMETRÍA GPS',
    title: 'Mapa Radar, Alcance Seguro y Perfil de Elevación',
    how: 'Selecciona un destino rápido o ingresa tu ruta (km y altitud meta). Toca "🛰️ Activar GPS" para rastrear tus coordenadas reales, altitud en msnm y mover el punto de tu moto a lo largo del trazado y de la curva topográfica.',
    why: 'Cruza la gasolina real que queda en tu tanque de 14L con la topografía de ascenso para dibujar el anillo verde de "Alcance Seguro", garantizando que tienes combustible suficiente para llegar y volver.'
  },
  nav_elev_guide: {
    category: 'TOPOGRAFÍA & SENSOR BAROMÉTRICO MAP',
    title: 'Curva de Elevación (msnm) y Compensación FI',
    how: 'El gráfico inferior derecho dibuja el perfil longitudinal de altitud desde tu punto de partida hasta la cima del destino y posiciona tu altitud actual (vía GPS o sensor MAP 010B de la ECU).',
    why: 'Cada 1,000 metros de ascenso la presión atmosférica cae ~10 kPa. Si tu ruta supera los 2,000 msnm, recuerda apagar y encender la llave 5 segundos a mitad de subida para recalibrar la inyección.'
  }
};

export const ROUTE_PRESETS = [
  {
    id: 'samne',
    name: 'Puente Pala / Samne',
    region: 'Valle Santa Catalina • Ascenso Moderado',
    distKm: 42.5,
    estMin: 55,
    startAlt: 34,
    peakAlt: 1450,
    terrainFactor: 1.10,
    difficulty: 'Media • Curvas',
    lat: -7.9942,
    lon: -78.6851,
    svgPath: 'M 140 245 C 132 215, 158 190, 146 160 C 134 130, 168 105, 155 72 C 148 52, 172 38, 178 24',
    elevProfile: [34, 120, 280, 520, 840, 1180, 1450]
  },
  {
    id: 'cachicadan',
    name: 'Cachicadán / Santiago de Chuco',
    region: 'Sierra de La Libertad • Alta Montaña',
    distKm: 168.0,
    estMin: 230,
    startAlt: 34,
    peakAlt: 3180,
    terrainFactor: 1.18,
    difficulty: 'Alta • Sierra (>3,000m)',
    lat: -8.0958,
    lon: -78.1524,
    svgPath: 'M 135 248 C 115 220, 165 198, 130 170 C 102 145, 175 122, 142 92 C 118 68, 185 45, 168 20',
    elevProfile: [34, 480, 1350, 2420, 3180, 2950, 2880]
  },
  {
    id: 'huanchaco',
    name: 'Circuito Costa / Huanchaco',
    region: 'Ruta Costera • Nivel del Mar',
    distKm: 28.0,
    estMin: 32,
    startAlt: 34,
    peakAlt: 65,
    terrainFactor: 1.0,
    difficulty: 'Baja • Pista Plana',
    lat: -8.0782,
    lon: -79.1194,
    svgPath: 'M 155 245 C 150 205, 142 165, 138 125 C 134 85, 148 52, 142 24',
    elevProfile: [34, 42, 28, 15, 12, 35, 18]
  },
  {
    id: 'custom',
    name: 'Mirador El Cóndor / Ruta Libre',
    region: 'Tramo Personalizado N160 FI',
    distKm: 36.7,
    estMin: 52,
    startAlt: 180,
    peakAlt: 1560,
    terrainFactor: 1.14,
    difficulty: 'Dificultad Media',
    lat: -8.1116,
    lon: -79.0287,
    svgPath: 'M 142 245 C 128 212, 164 185, 144 152 C 126 122, 168 95, 152 62 C 144 42, 168 32, 172 22',
    elevProfile: [180, 420, 790, 1120, 1480, 1390, 1560]
  }
];

export const DEFAULT_TIRES = {
  front: {
    pos: 'front',
    label: 'DELANTERA',
    brand: 'MRF Nylogrip Zapper / Eurogrip (Fábrica)',
    size: '100/80-17 TL',
    compound: 'Touring / Calle',
    installKm: 0,
    lifeKm: 18000,
    cost: 0,
    dot: '2026',
    date: ''
  },
  rear: {
    pos: 'rear',
    label: 'TRASERA',
    brand: 'MRF Zapper-S / Eurogrip (Fábrica)',
    size: '130/70-17 TL',
    compound: 'Touring / Calle',
    installKm: 0,
    lifeKm: 16000,
    cost: 0,
    dot: '2026',
    date: ''
  }
};
