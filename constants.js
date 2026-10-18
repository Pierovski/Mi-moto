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
  }
};

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
