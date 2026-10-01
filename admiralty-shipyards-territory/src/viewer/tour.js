// Экскурсия по верфи: камера облетает территорию по маршруту, на каждой остановке — подпись
// и подсветка главного здания; во время остановки камера медленно обходит его по кругу.
// Пауза, назад и вперёд — кнопками или клавишами (пробел, ← →), Esc — закончить.
// Любое движение камеры мышью или пальцем ставит экскурсию на паузу.

const STOPS = [
  {
    title: 'Адмиралтейские верфи',
    text: 'Одно из старейших судостроительных предприятий России, ведёт историю с 1704 года. Территория — 63 га на четырёх участках: основная площадка между Фонтанкой и Пряжкой, Галерный остров, Матисов и Ново-Адмиралтейский острова.',
    eye: [950, -250, 1250],
    target: [-380, 620, 0],
  },
  {
    title: 'Центральная проходная и заводоуправление',
    text: 'Проходная у площади Репина. Вдоль Лоцманской улицы — заводоуправление: здание бывшей администрации завода («Малое Адмиралтейство», 1913–1914, арх. Н. П. Козлов) с колоннадой большого ордера.',
    eye: [-20, -10, 70],
    target: [-150, 130, 12],
    id: 'Z182',
  },
  {
    title: 'Стапели',
    text: 'Два открытых наклонных стапеля длиной около 275 м; вдоль них — пути башенных кранов. Корпуса судов на стапелях в модели — условные заказы.',
    eye: [-1080, 280, 200],
    target: [-600, 60, 8],
    id: 'S2',
  },
  {
    title: 'Исторический комплекс завода',
    text: 'Выявленный объект культурного наследия начала XX века: главная судостроительная мастерская с кузницей (1910), разбивочный плаз (1914) и главная электрическая станция (1909–1910).',
    eye: [-150, -250, 140],
    target: [-340, -10, 10],
    id: 'Z129',
  },
  {
    title: 'Галерный остров',
    text: 'Остров в устье Фонтанки. Главный корпус Галерного острова — самое крупное здание предприятия по площади застройки, около 180 × 105 м.',
    eye: [-560, -480, 220],
    target: [-800, -200, 10],
    id: 'Z3',
  },
  {
    title: 'Матисов остров',
    text: 'Корпуса вдоль Сальнобуянского канала. Участок вокруг Перевозной ул., 1Б заводу больше не принадлежит: застройка снесена, оставлено производственное здание с водонапорной башней бывшего завода Ч. Берда (1885–1894).',
    eye: [-60, 620, 240],
    target: [-330, 780, 5],
    id: 'Y6ea82e',
  },
  {
    title: 'Новое Адмиралтейство',
    text: 'Большой каменный эллинг (1890–1893, длина 129 м) и Малый каменный эллинг, Главное корабельное здание с башней с часами, крытые эллинги.',
    eye: [-520, 1950, 300],
    target: [-20, 1360, 10],
    id: 'Z136',
  },
  {
    title: 'Котельная «Судомеха»',
    text: 'На берегу Мойки — котельная бывшего завода «Судомех» с тремя чёрными стальными трубами на растяжках; её хорошо видно с набережной Мойки.',
    eye: [175, 1150, 60],
    target: [95, 1320, 16],
    id: 'Z173',
  },
  {
    title: 'Цех у устья Мойки',
    text: 'Цех 1965 года на оконечности Ново-Адмиралтейского острова: сплошное остекление в сетку, мятный верхний пояс и тёмно-зелёный блок с ленточными окнами — приметный вид с Васильевского острова.',
    eye: [-470, 1235, 40],
    target: [-300, 1105, 12],
    id: 'Z32',
  },
  {
    title: 'Большая Нева',
    text: 'Достроечные набережные с портальными кранами, плавучие доки «Луга» (92 × 27 м) и СПД-2М (92 × 22 м). Экскурсия окончена — модель можно смотреть самостоятельно.',
    eye: [-860, 250, 45],
    target: [-430, 600, 14],
    id: 'D2',
  },
];

const FLY_MS = 3400;
const STAY_MS = 7500;

export function setupTour({ $, flyTo, controls, objects, highlightProxy, beforeStart, reduceMotion }) {
  const el = $('tour');
  let i = -1;
  let playing = false;
  let finished = false;
  let timer = null;
  let progressStart = 0;
  let progressMs = 0;
  let raf = 0;

  const clear = () => {
    clearTimeout(timer);
    timer = null;
    cancelAnimationFrame(raf);
    controls.autoRotate = false;
  };
  function progress() {
    const t = progressMs ? Math.min(1, (performance.now() - progressStart) / progressMs) : 0;
    $('tourProgress').style.transform = `scaleX(${t})`;
    if (playing && t < 1) raf = requestAnimationFrame(progress);
  }
  function render() {
    const s = STOPS[i];
    $('tourStep').textContent = `${i + 1} / ${STOPS.length}`;
    $('tourTitle').textContent = s.title;
    $('tourText').textContent = s.text;
    $('tourPlay').textContent = playing ? '❚❚' : '▶';
    $('tourPlay').setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
    $('tourPlay').title = playing ? 'Пауза (пробел)' : 'Продолжить (пробел)';
    $('tourPrev').disabled = i === 0;
    $('tourNext').disabled = i === STOPS.length - 1;
  }
  function go(n, { fly = true } = {}) {
    clear();
    finished = false;
    i = Math.max(0, Math.min(STOPS.length - 1, n));
    const s = STOPS[i];
    const o = s.id && objects().find((x) => x.id === s.id);
    highlightProxy(o ? o.proxy : null);
    if (fly) flyTo(s.eye, s.target, reduceMotion ? 0 : FLY_MS);
    render();
    if (!playing) return;
    // долетели — медленный облёт и подпись, потом следующая остановка
    const flyMs = fly && !reduceMotion ? FLY_MS : 0;
    progressStart = performance.now();
    progressMs = flyMs + STAY_MS;
    raf = requestAnimationFrame(progress);
    timer = setTimeout(() => {
      if (!reduceMotion) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = i === 0 ? 0.25 : 0.5;
      }
      timer = setTimeout(() => {
        controls.autoRotate = false;
        if (i < STOPS.length - 1) go(i + 1);
        else {
          pause();
          finished = true;
        }
      }, STAY_MS);
    }, flyMs);
  }
  function start() {
    if (beforeStart?.() === false) return;
    el.hidden = false;
    document.body.classList.add('touring');
    playing = true;
    go(0);
    $('tourPlay').focus({ preventScroll: true });
  }
  function pause() {
    if (!playing) return;
    playing = false;
    clear();
    $('tourProgress').style.transform = 'scaleX(0)';
    render();
  }
  function resume() {
    playing = true;
    // после конца маршрута — сначала
    go(finished ? 0 : i);
  }
  function stop() {
    if (el.hidden) return;
    playing = false;
    clear();
    highlightProxy(null);
    el.hidden = true;
    document.body.classList.remove('touring');
  }

  $('tourPlay').addEventListener('click', () => (playing ? pause() : resume()));
  $('tourPrev').addEventListener('click', () => go(i - 1));
  $('tourNext').addEventListener('click', () => go(i + 1));
  $('tourClose').addEventListener('click', stop);
  // пользователь сам повёл камеру — экскурсия ждёт
  controls.addEventListener('start', () => {
    if (!el.hidden && playing) pause();
  });
  window.addEventListener('keydown', (ev) => {
    if (el.hidden || ev.target.closest?.('input, textarea, select')) return;
    if (ev.key === 'Escape') stop();
    else if (ev.key === ' ') {
      ev.preventDefault();
      if (playing) pause();
      else resume();
    } else if (ev.key === 'ArrowRight' && i < STOPS.length - 1) go(i + 1);
    else if (ev.key === 'ArrowLeft' && i > 0) go(i - 1);
    else return;
  });

  return { start, stop, pause, isActive: () => !el.hidden, stops: STOPS };
}
