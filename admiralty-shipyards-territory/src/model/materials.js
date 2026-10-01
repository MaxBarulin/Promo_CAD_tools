// Палитра материалов модели. Ключ → название (для экспорта в CAD), цвет, параметры PBR.
// Цвета подобраны под «архитектурный макет» с узнаваемой петербургской гаммой.

export const PALETTE = {
  // --- стены ---
  brick: { name: 'Стена_кирпич_красный', color: '#9a4b38' },
  brick_dark: { name: 'Стена_кирпич_тёмный', color: '#74402f' },
  ochre: { name: 'Стена_штукатурка_охра', color: '#d6b26c' },
  yellow: { name: 'Стена_штукатурка_жёлтая', color: '#e2c779' },
  cream: { name: 'Стена_штукатурка_кремовая', color: '#e6d9bb' },
  pink: { name: 'Стена_штукатурка_розовая', color: '#d8a49a' },
  terracotta: { name: 'Стена_штукатурка_терракота', color: '#c47e5e' },
  green: { name: 'Стена_штукатурка_зелёная', color: '#94b39f' },
  blue_stucco: { name: 'Стена_штукатурка_голубая', color: '#9fb7c9' },
  mint: { name: 'Стена_панели_мятные', color: '#b7d6c3' },
  red: { name: 'Стена_панели_красные', color: '#a8343a' },
  green_dark: { name: 'Стена_панели_тёмно-зелёные', color: '#4f6a5d' },
  sand: { name: 'Стена_песочная', color: '#cdb68f' },
  light: { name: 'Стена_светлая', color: '#dedbd2' },
  white: { name: 'Стена_белая', color: '#eeebe3' },
  gray: { name: 'Стена_серая', color: '#a9aaa7' },
  panel: { name: 'Стена_ЖБ_панели', color: '#bcb7ac' },
  blue_gray: { name: 'Стена_профлист_серо-голубой', color: '#8197a8' },
  blue: { name: 'Стена_профлист_синий', color: '#4f7aa1' },

  // --- кровли ---
  r_gray: { name: 'Кровля_металл_серая', color: '#6c7074', roughness: 0.7, metalness: 0.15 },
  r_dark: { name: 'Кровля_тёмная', color: '#46494e', roughness: 0.8 },
  r_green: { name: 'Кровля_металл_зелёная', color: '#5a7a68', roughness: 0.7, metalness: 0.15 },
  r_rust: { name: 'Кровля_металл_сурик', color: '#8a4c3a', roughness: 0.75, metalness: 0.1 },
  r_light: { name: 'Кровля_профлист_светлая', color: '#a3a8ab', roughness: 0.6, metalness: 0.2 },
  r_blue: { name: 'Кровля_профлист_синяя', color: '#58708a', roughness: 0.6, metalness: 0.2 },
  r_bitumen: { name: 'Кровля_рулонная', color: '#3d3f42', roughness: 0.95 },
  r_gold: { name: 'Кровля_золочёная', color: '#c9a44c', roughness: 0.35, metalness: 0.7 },
  r_copper: { name: 'Кровля_медная_патина', color: '#6f9f8a', roughness: 0.6, metalness: 0.25 },
  lantern: { name: 'Фонарь_световой', color: '#9fb4c2', roughness: 0.3, metalness: 0.3 },

  // --- фасадные элементы ---
  glass: { name: 'Остекление', color: '#2f4252', roughness: 0.15, metalness: 0.6 },
  glass_light: { name: 'Остекление_светлое', color: '#5d7c92', roughness: 0.15, metalness: 0.5 },
  glass_lit: { name: 'Остекление_освещённое', color: '#2f4252', roughness: 0.15, metalness: 0.6, emissive: '#ffc977' },
  frame_white: { name: 'Рамы_белые', color: '#f1efe9' },
  frame_dark: { name: 'Рамы_тёмные', color: '#4b4d50' },
  glass_green: { name: 'Остекление_серо-зелёное_в_сетку', color: '#7f958b', roughness: 0.35, metalness: 0.3 },
  door: { name: 'Двери', color: '#5a4334' },
  door_metal: { name: 'Двери_металл', color: '#5f6870', metalness: 0.4, roughness: 0.5 },
  gate: { name: 'Ворота_цеха', color: '#7c8a93', metalness: 0.3, roughness: 0.55 },
  trim: { name: 'Карниз_тяги', color: '#efe9db' },
  plinth: { name: 'Цоколь_гранит', color: '#7a706a' },
  canopy: { name: 'Козырёк', color: '#5b6066', metalness: 0.3 },
  column: { name: 'Колонны', color: '#f2ede2' },
  sign: { name: 'Вывеска', color: '#1d4f8f' },

  // --- земля, вода, дороги ---
  water: { name: 'Вода', color: '#3e5d70', roughness: 0.14, metalness: 0.1 },
  water_pond: { name: 'Вода_бассейн', color: '#4a6b7c', roughness: 0.1 },
  ground_city: { name: 'Покрытие_город', color: '#b4afa6', roughness: 0.95 },
  ground_yard: { name: 'Покрытие_бетон_верфь', color: '#a5a4a0', roughness: 0.95 },
  ground_civil: { name: 'Покрытие_двор', color: '#aaa597', roughness: 0.95 },
  quay: { name: 'Набережная_гранит', color: '#8f837b', roughness: 0.85 },
  quay_concrete: { name: 'Причальная_стенка_бетон', color: '#8b8b86', roughness: 0.9 },
  base: { name: 'Основание_макета', color: '#3a3c40', roughness: 1 },
  asphalt: { name: 'Асфальт', color: '#5a5d61', roughness: 0.9 },
  asphalt_yard: { name: 'Асфальт_внутризаводской', color: '#76787a', roughness: 0.9 },
  sidewalk: { name: 'Тротуар', color: '#9d988f', roughness: 0.9 },
  marking: { name: 'Разметка', color: '#f2f2ee', roughness: 0.6 },
  square: { name: 'Площадь_плитка', color: '#b9ab98', roughness: 0.9 },
  grass: { name: 'Газон', color: '#7c9a58', roughness: 1 },
  parking: { name: 'Парковка', color: '#6a6c70', roughness: 0.9 },
  storage: { name: 'Площадка_складская', color: '#8e8c86', roughness: 0.95 },
  apron: { name: 'Площадка_бетонная', color: '#b3b1aa', roughness: 0.95 },
  slipway: { name: 'Стапель_бетон', color: '#9c9a93', roughness: 0.9 },
  rail: { name: 'Рельсы', color: '#3b3a38', metalness: 0.6, roughness: 0.4 },
  sleeper: { name: 'Шпалы_балласт', color: '#6a625a', roughness: 1 },
  industrial: { name: 'Покрытие_промзона', color: '#a19f99', roughness: 0.95 },

  // --- ограждение ---
  fence_concrete: { name: 'Забор_ЖБ', color: '#bdb9b0', roughness: 0.95 },
  fence_post: { name: 'Забор_столбы', color: '#a19c92', roughness: 0.95 },
  fence_mesh: { name: 'Забор_сетка', color: '#55626a', roughness: 0.6, metalness: 0.5, opacity: 0.55 },
  fence_sheet: { name: 'Забор_профлист', color: '#6d8296', roughness: 0.55, metalness: 0.35 },
  fence_wire: { name: 'Колючая_проволока', color: '#3c3f42', metalness: 0.6 },
  fence_wall: { name: 'Забор_кирпичный', color: '#8f4a37', roughness: 0.9 },
  gate_leaf: { name: 'Ворота_откатные', color: '#3f6a52', metalness: 0.4, roughness: 0.5 },
  railing: { name: 'Ограда_чугунная', color: '#2b2d2f', metalness: 0.5, roughness: 0.5 },
  parapet: { name: 'Парапет_гранит', color: '#9a8c82', roughness: 0.85 },
  bollard: { name: 'Кнехты', color: '#2f3134', metalness: 0.5 },

  // --- краны, металл ---
  crane_yellow: { name: 'Кран_жёлтый', color: '#e3ad12', roughness: 0.55, metalness: 0.3 },
  crane_blue: { name: 'Кран_синий', color: '#2f6aa3', roughness: 0.55, metalness: 0.3 },
  crane_red: { name: 'Кран_красный', color: '#c2392b', roughness: 0.55, metalness: 0.3 },
  crane_gray: { name: 'Кран_серый', color: '#8b939a', roughness: 0.55, metalness: 0.4 },
  steel: { name: 'Металл', color: '#6f777e', roughness: 0.5, metalness: 0.6 },
  steel_dark: { name: 'Металл_тёмный', color: '#3d4247', roughness: 0.5, metalness: 0.6 },
  cable: { name: 'Канаты', color: '#222222', roughness: 0.6 },
  chimney: { name: 'Труба_кирпич', color: '#8e5a48', roughness: 0.9 },
  chimney_band: { name: 'Труба_полосы', color: '#c63b2b', roughness: 0.8 },
  steel_stock: { name: 'Металлопрокат', color: '#6b5d52', roughness: 0.7, metalness: 0.4 },

  // --- суда ---
  hull_red: { name: 'Корпус_подводная_часть', color: '#8f2f25', roughness: 0.6 },
  hull_black: { name: 'Корпус_надводный_тёмный', color: '#2a2e33', roughness: 0.6 },
  hull_blue: { name: 'Корпус_надводный_синий', color: '#26476b', roughness: 0.6 },
  hull_red_top: { name: 'Корпус_надводный_красный', color: '#b2382c', roughness: 0.6 },
  hull_primer: { name: 'Корпус_грунт', color: '#9e6b4f', roughness: 0.8 },
  deck: { name: 'Палуба', color: '#7f7a70', roughness: 0.9 },
  superstructure: { name: 'Надстройка_белая', color: '#ecebe6', roughness: 0.6 },
  funnel: { name: 'Труба_судовая', color: '#d9b13c', roughness: 0.6 },
  sub_black: { name: 'Корпус_ПЛ', color: '#1e2124', roughness: 0.5 },
  dock: { name: 'Плавдок', color: '#5f6a72', roughness: 0.7, metalness: 0.2 },
  dock_red: { name: 'Плавдок_ватерлиния', color: '#7a2d26', roughness: 0.7 },
  keelblock: { name: 'Кильблоки', color: '#6f5a46', roughness: 0.9 },

  // --- озеленение, разное ---
  foliage: { name: 'Крона', color: '#5f7f43', roughness: 1 },
  foliage2: { name: 'Крона_2', color: '#6f8d4b', roughness: 1 },
  foliage3: { name: 'Крона_3', color: '#4f6d3b', roughness: 1 },
  trunk: { name: 'Ствол', color: '#5b4a3b', roughness: 1 },
  bridge: { name: 'Мост_гранит', color: '#a1958b', roughness: 0.85 },
  bridge_deck: { name: 'Мост_покрытие', color: '#5f6266', roughness: 0.9 },
  bridge_steel: { name: 'Мост_металл', color: '#5d7b8a', roughness: 0.5, metalness: 0.4 },
  lamp: { name: 'Фонари', color: '#2e3134', metalness: 0.5 },
  car: { name: 'Автомобили', color: '#7b8590', metalness: 0.5, roughness: 0.35 },
  car2: { name: 'Автомобили_2', color: '#a2342b', metalness: 0.5, roughness: 0.35 },
  car3: { name: 'Автомобили_3', color: '#e9e9e6', metalness: 0.5, roughness: 0.35 },
  container: { name: 'Контейнеры', color: '#2f6fa0', roughness: 0.7, metalness: 0.3 },
  container2: { name: 'Контейнеры_2', color: '#b8552e', roughness: 0.7, metalness: 0.3 },
  pick: { name: 'Служебный_выбор', color: '#ffffff' },
};

export const WALL_KEYS_CITY = ['ochre', 'yellow', 'cream', 'pink', 'terracotta', 'green', 'sand', 'light', 'blue_stucco', 'gray', 'ochre', 'yellow', 'cream'];
export const ROOF_KEYS_CITY = ['r_gray', 'r_dark', 'r_rust', 'r_gray', 'r_green', 'r_gray'];

// Создание THREE-материалов (кэш по ключу).
export function createMaterialFactory(THREE, { forExport = false } = {}) {
  const cache = new Map();
  return function get(key) {
    if (cache.has(key)) return cache.get(key);
    const p = PALETTE[key];
    if (!p) throw new Error('Неизвестный материал: ' + key);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color),
      roughness: p.roughness ?? 0.85,
      metalness: p.metalness ?? 0.0,
      transparent: p.opacity != null && p.opacity < 1,
      opacity: p.opacity ?? 1,
      side: p.opacity != null ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: p.opacity == null || p.opacity >= 1,
    });
    if (p.emissive && !forExport) {
      m.emissive = new THREE.Color(p.emissive);
      m.emissiveIntensity = 0;
    }
    m.name = p.name;
    m.userData.key = key;
    cache.set(key, m);
    return m;
  };
}
