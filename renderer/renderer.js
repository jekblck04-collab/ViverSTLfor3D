// Импорт Three.js
// Импорт Three.js
import * as THREE from './lib/three.module.js';
import { STLLoader } from './lib/STLLoader.js';
import { OrbitControls } from './lib/OrbitControls.js';

// Глобальные переменные
// База рабочих областей принтеров Bambu Lab (в миллиметрах: X - ширина, Y - высота, Z - глубина)
// База рабочих областей принтеров Bambu Lab (в миллиметрах: X - ширина, Y - высота, Z - глубина)
// Встроенная база рабочих областей принтеров (X - ширина, Y - высота, Z - глубина в мм)
const DEFAULT_PRINTERS = {
  'a1-mini': {
    name: 'Bambu Lab A1 mini (180×180×180 мм)',
    x: 180,
    y: 180,
    z: 180,
  },
  'p1-x1-a1-p2s': {
    name: 'Bambu Lab A1 / P1P / P1S / P2S / X1C / X1E (256×256×256 мм)',
    x: 256,
    y: 256,
    z: 256,
  },
  'h2d': {
    name: 'Bambu Lab H2D / H2D Pro / H2C (350×320×325 мм)',
    x: 350,
    y: 325,
    z: 320,
  },
  'h2s': {
    name: 'Bambu Lab H2S (340×320×340 мм)',
    x: 340,
    y: 340,
    z: 320,
  },
};

// Глобальные переменные
let scene, camera, renderer, controls;
let currentModel = null;
let currentModelSize = null;
let scaleRuler = null;
let printerVolumeBox = null;
let printerEdgesMaterial = null;
let printerWallsMaterial = null;
let isPrinterOverflow = false;
let horizonGroup = null;
let animationFrameId = null;
let currentFilePath = null;
let folderFiles = [];
let currentFileIndex = -1;
let isInchScaled = false;

// Настройки по умолчанию
let settings = {
  backgroundColor: '#1a1a1a',
  modelColor: '#4a9eff',
  wireframe: false,
  showRuler: true,
  rulerColor: '#ffffff',
  rulerTextColor: '#ffffff',
  rulerUnit: 'mm',
  showPrinterBox: false,
  printerModel: 'p1-x1-a1-p2s',
  printerBoxColor: '#00ae42',
  showHorizon: true,
  customPrinters: {},
  slicerPath: '',
  confirmDelete: true,
};


// Вспомогательная функция получения полного списка принтеров (встроенные + пользовательские)
function getAllPrinters() {
  return { ...DEFAULT_PRINTERS, ...(settings.customPrinters || {}) };
}


// DOM элементы
const canvas = document.getElementById('canvas');
const fileNameEl = document.getElementById('file-name');
const scaleInfoEl = document.getElementById('scale-info');
const dropZone = document.getElementById('drop-zone');

// Инициализация Three.js
function initThreeJS() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(settings.backgroundColor);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(settings.backgroundColor);
  createHorizon();

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
  );
  camera.position.set(0, 0, 100);

  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  // Освещение
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);

  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  directionalLight2.position.set(-1, -1, -1);
  scene.add(directionalLight2);

  // Обработка изменения размера окна
  window.addEventListener('resize', onWindowResize);

  // Настройка управления
  setupControls();

  // Drag and drop
  setupDragDrop();

  // Запуск анимации
  animate();
}

// Создание визуальной линии горизонта и дальнего окружения
function createHorizon() {
  if (horizonGroup) {
    scene.remove(horizonGroup);
  }

  horizonGroup = new THREE.Group();

  const bgColor = new THREE.Color(settings.backgroundColor);
  // Делаем оттенок пола чуть темнее фона, а неба — чуть светлее
  const groundColor = bgColor.clone().multiplyScalar(0.65);
  const skyColor = bgColor.clone().lerp(new THREE.Color(0xffffff), 0.12);

  // Дальняя плоскость земли для чёткой линии горизонта
  const groundGeo = new THREE.CircleGeometry(4000, 64);
  const groundMat = new THREE.MeshBasicMaterial({
    color: groundColor,
    depthWrite: false,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  horizonGroup.add(ground);

  // Тонкое кольцо самой линии горизонта на дальнем плане
  const ringGeo = new THREE.RingGeometry(3980, 4000, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: skyColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0;
  horizonGroup.add(ring);

  // Туман для плавного растворения дальнего края в фоне
  scene.fog = new THREE.Fog(bgColor, 800, 4200);

  horizonGroup.visible = settings.showHorizon !== false;
  scene.add(horizonGroup);
}

// Настройка управления камерой (ЛКМ - вращение, Колесо - зум, Shift + СКМ - перетаскивание)
function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.enablePan = true;

  // Отключаем встроенные действия для СКМ и ПКМ, чтобы управлять ими вручную
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: null,
    RIGHT: null
  };

  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  // Блокируем системную автопрокрутку Windows на СКМ и запускаем панорамирование при Shift + СКМ
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      if (e.shiftKey) {
        isPanning = true;
        panStart = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'move';
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;

    const deltaX = e.clientX - panStart.x;
    const deltaY = e.clientY - panStart.y;
    panStart = { x: e.clientX, y: e.clientY };

    // Вычисляем смещение пропорционально расстоянию от камеры до цели
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const targetDistance = offset.length() * Math.tan((camera.fov / 2) * Math.PI / 180);

    const moveX = (2 * deltaX * targetDistance) / canvas.clientHeight;
    const moveY = (2 * deltaY * targetDistance) / canvas.clientHeight;

    const panLeft = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-moveX);
    const panUp = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(moveY);
    const panOffset = new THREE.Vector3().addVectors(panLeft, panUp);

    camera.position.add(panOffset);
    controls.target.add(panOffset);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1 && isPanning) {
      isPanning = false;
      canvas.style.cursor = 'grab';
    }
  });

  // Контекстное меню на ПКМ
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.electronAPI.showContextMenu({ x: e.clientX, y: e.clientY });
  });
}



// Настройка drag-and-drop
function setupDragDrop() {
  const viewport = document.getElementById('viewport-container');

  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.stl')) {
        loadSTLFile(file);
      } else {
        alert('Выберите STL файл');
      }
    }
  });

  // Клик по viewport открывает диалог
  viewport.addEventListener('click', (e) => {
    if (currentModel) return;
    if (e.target.closest('#toolbar')) return;
    window.electronAPI.openFileDialog();
  });
}

// Загрузка STL файла
function loadSTL(filePath) {
  const loader = new STLLoader();

  loader.load(filePath, (geometry) => {
    // Удаляем предыдущую модель
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.geometry.dispose();
      currentModel.material.dispose();
    }

    // Удаляем предыдущую линейку
    if (scaleRuler) {
      scene.remove(scaleRuler);
    }

    // Вычисляем центр и размеры модели
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    currentModelSize = size.clone();
    updatePrinterVolume();
    if (currentModelSize) {
      updateScaleInfo(currentModelSize);
    }
    // Центрируем модель
    geometry.translate(-center.x, -boundingBox.min.y, -center.z);

    // Создаём материал
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(settings.modelColor),
      specular: 0x111111,
      shininess: 30,
      flatShading: false,
      side: THREE.DoubleSide,
      wireframe: settings.wireframe,
    });

    // Создаём меш
    currentModel = new THREE.Mesh(geometry, material);
    scene.add(currentModel);

    // Создаём масштабную линейку
    if (settings.showRuler) {
      createScaleRuler(size);
    }

    // Позиционируем камеру
    const maxDim = Math.max(size.x, size.y, size.z);
    if (controls) {
      controls.target.set(0, size.y / 2, 0);
    }
    camera.position.set(maxDim * 1.2, maxDim * 1.1, maxDim * 1.8);
    camera.lookAt(0, size.y / 2, 0);
    if (controls) controls.update();

    // Обновляем информацию
    fileNameEl.textContent = filePath.split(/[\\/]/).pop();
    updateScaleInfo(size);
    isInchScaled = false;
    const inchBtn = document.getElementById('btn-inch');
    if (inchBtn) inchBtn.style.background = '#3a3a3a';
    refreshFolderList(filePath);

    // Скрываем подсказку
    dropZone.classList.add('hidden');

    // Анимация появления модели
    animateModel();
  }, undefined, (error) => {
    console.error('Ошибка загрузки STL:', error);
    alert('Не удалось загрузить STL файл');
  });
}

// Загрузка STL из объекта File (drag-and-drop)
function loadSTLFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const buffer = event.target.result;
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);

    // Удаляем предыдущую модель
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.geometry.dispose();
      currentModel.material.dispose();
    }

    // Удаляем предыдущую линейку
    if (scaleRuler) {
      scene.remove(scaleRuler);
    }

    // Вычисляем центр и размеры модели
    geometry.computeBoundingBox();
    const boundingBox = geometry.boundingBox;
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    currentModelSize = size.clone();
    updatePrinterVolume();
    if (currentModelSize) {
      updateScaleInfo(currentModelSize);
    }
    // Центрируем модель
    geometry.translate(-center.x, -boundingBox.min.y, -center.z);

    // Создаём материал
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(settings.modelColor),
      specular: 0x111111,
      shininess: 30,
      flatShading: false,
      side: THREE.DoubleSide,
      wireframe: settings.wireframe,
    });

    // Создаём меш
    currentModel = new THREE.Mesh(geometry, material);
    scene.add(currentModel);

    // Создаём масштабную линейку
    if (settings.showRuler) {
      createScaleRuler(size);
    }

    // Позиционируем камеру
        // Позиционируем камеру и нацеливаем её на центр высоты модели
        const maxDim = Math.max(size.x, size.y, size.z);
        if (controls) {
          controls.target.set(0, size.y / 2, 0);
        }
        camera.position.set(maxDim * 1.2, maxDim * 1.1, maxDim * 1.8);
        camera.lookAt(0, size.y / 2, 0);
        if (controls) controls.update();
    

    // Обновляем информацию
    fileNameEl.textContent = file.name;
    updateScaleInfo(size);

    isInchScaled = false;
    const inchBtn = document.getElementById('btn-inch');
    if (inchBtn) inchBtn.style.background = '#3a3a3a';
    if (file.path) {
      refreshFolderList(file.path);
    } else {
      currentFilePath = null;
    }

    // Скрываем подсказку
    dropZone.classList.add('hidden');

    // Анимация появления модели
    animateModel();
  };
  reader.readAsArrayBuffer(file);
}

// Создание мерной сетки под размер стола принтера или детали
function createScaleRuler(modelSize) {
  if (scaleRuler) {
    scene.remove(scaleRuler);
    scaleRuler = null;
  }

  const printers = getAllPrinters();
  const activePrinter = settings.showPrinterBox
    ? (printers[settings.printerModel] || DEFAULT_PRINTERS['p1-x1-a1-p2s'])
    : null;

  const group = new THREE.Group();
  const gridColor = new THREE.Color(settings.rulerColor);
  const subGridColor = gridColor.clone().multiplyScalar(0.4);

  if (activePrinter) {
    // Строим сетку строго по площади стола выбранного принтера (шаг 10 мм)
    const width = activePrinter.x;
    const depth = activePrinter.z;
    const step = 10;

    const vertices = [];
    const colors = [];

    const halfW = width / 2;
    const halfD = depth / 2;

    // Линии вдоль оси Z (шаг по X)
    for (let x = -halfW; x <= halfW + 0.01; x += step) {
      const isMajor = Math.round(Math.abs(x)) % 50 === 0 || Math.abs(x) < 0.01;
      const c = isMajor ? gridColor : subGridColor;
      vertices.push(x, 0, -halfD, x, 0, halfD);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    // Линии вдоль оси X (шаг по Z)
    for (let z = -halfD; z <= halfD + 0.01; z += step) {
      const isMajor = Math.round(Math.abs(z)) % 50 === 0 || Math.abs(z) < 0.01;
      const c = isMajor ? gridColor : subGridColor;
      vertices.push(-halfW, 0, z, halfW, 0, z);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true });
    group.add(new THREE.LineSegments(lineGeo, lineMat));

    // Подложка стола принтера
    const planeGeo = new THREE.PlaneGeometry(width, depth);
    const planeMat = new THREE.MeshBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.02;
    group.add(plane);
  } else if (modelSize) {
    // Если камера принтера выключена — строим адаптивную сетку вокруг детали
    const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
    const rawStep = maxDim / 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const residual = rawStep / magnitude;
    let step = magnitude;
    if (residual > 5) step = 10 * magnitude;
    else if (residual > 2) step = 5 * magnitude;
    else if (residual > 1) step = 2 * magnitude;

    const divisions = Math.max(10, Math.ceil((maxDim * 2) / step));
    const gridSize = divisions * step;

    const gridHelper = new THREE.GridHelper(gridSize, divisions, gridColor, subGridColor);
    group.add(gridHelper);

    const planeGeo = new THREE.PlaneGeometry(gridSize, gridSize);
    const planeMat = new THREE.MeshBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.02;
    group.add(plane);
  }

  group.position.y = 0;
  group.visible = settings.showRuler;

  scaleRuler = group;
  scene.add(scaleRuler);
}

// Отрисовка рабочей области принтера и проверка габаритов детали
function updatePrinterVolume() {
  const warningEl = document.getElementById('printer-warning');

  if (printerVolumeBox) {
    scene.remove(printerVolumeBox);
    printerVolumeBox = null;
    printerEdgesMaterial = null;
    printerWallsMaterial = null;
  }

  // Перестраиваем сетку под стол принтера (или обратно под деталь)
  createScaleRuler(currentModelSize);

  if (!settings.showPrinterBox) {
    isPrinterOverflow = false;
    if (warningEl) warningEl.style.display = 'none';
    return;
  }

  const printers = getAllPrinters();
  const printer = printers[settings.printerModel] || DEFAULT_PRINTERS['p1-x1-a1-p2s'];

  // Проверяем габариты (с учётом поворота детали на 90° по столу)
  let fits = true;
  if (currentModelSize) {
    const fitsDirect =
      currentModelSize.x <= printer.x &&
      currentModelSize.y <= printer.y &&
      currentModelSize.z <= printer.z;
    const fitsRotated =
      currentModelSize.z <= printer.x &&
      currentModelSize.y <= printer.y &&
      currentModelSize.x <= printer.z;

    fits = fitsDirect || fitsRotated;
  }

  isPrinterOverflow = !fits;

  // Пользовательский цвет рамки, если помещается, или красный для старта тревоги
  const boxColor = fits ? new THREE.Color(settings.printerBoxColor || '#00ae42') : new THREE.Color(0xff2a2a);

  const group = new THREE.Group();

  const boxGeo = new THREE.BoxGeometry(printer.x, printer.y, printer.z);
  const edges = new THREE.EdgesGeometry(boxGeo);
  printerEdgesMaterial = new THREE.LineBasicMaterial({
    color: boxColor,
    transparent: true,
    opacity: 0.9,
  });
  group.add(new THREE.LineSegments(edges, printerEdgesMaterial));

  printerWallsMaterial = new THREE.MeshBasicMaterial({
    color: boxColor,
    transparent: true,
    opacity: fits ? 0.03 : 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(boxGeo, printerWallsMaterial));

  group.position.set(0, printer.y / 2, 0);
  printerVolumeBox = group;
  scene.add(printerVolumeBox);

  if (warningEl) {
    if (!fits && currentModelSize) {
      warningEl.innerHTML = `Деталь (${currentModelSize.x.toFixed(1)}×${currentModelSize.z.toFixed(1)}×${currentModelSize.y.toFixed(1)} мм) выходит за рабочие рамки <b>${printer.name.split(' (')[0]}</b>!`;
      warningEl.style.display = 'block';
    } else {
      warningEl.style.display = 'none';
    }
  }
}


// Расчёт объёма замкнутой 3D-сетки (в см³) из треугольников геометрии
function calculateVolumeCm3(geometry) {
  const pos = geometry.attributes.position;
  if (!pos) return 0;

  let volumeMm3 = 0;
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const index = geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      p1.fromBufferAttribute(pos, index.getX(i));
      p2.fromBufferAttribute(pos, index.getX(i + 1));
      p3.fromBufferAttribute(pos, index.getX(i + 2));
      cross.crossVectors(p2, p3);
      volumeMm3 += p1.dot(cross) / 6.0;
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      p1.fromBufferAttribute(pos, i);
      p2.fromBufferAttribute(pos, i + 1);
      p3.fromBufferAttribute(pos, i + 2);
      cross.crossVectors(p2, p3);
      volumeMm3 += p1.dot(cross) / 6.0;
    }
  }

  return Math.abs(volumeMm3) / 1000.0; // перевод из мм³ в см³
}

// Обновление информации о габаритах, объёме и примерном весе (PLA / PETG)
function updateScaleInfo(size) {
  const unit = settings.rulerUnit === 'cm' ? 'см' : 'мм';
  const scale = settings.rulerUnit === 'cm' ? 0.1 : 1;

  let info = `Габариты: ${(size.x * scale).toFixed(1)} × ${(size.z * scale).toFixed(1)} × ${(size.y * scale).toFixed(1)} ${unit}`;

  if (currentModel && currentModel.geometry) {
    const volCm3 = calculateVolumeCm3(currentModel.geometry);
    if (volCm3 > 0.01) {
      const weightPla = (volCm3 * 1.24).toFixed(1);
      const weightPetg = (volCm3 * 1.27).toFixed(1);
      info += ` &nbsp;|&nbsp; Объём: ${volCm3.toFixed(1)} см³ (~${weightPla} г PLA / ${weightPetg} г PETG)`;
    }
  }

  scaleInfoEl.innerHTML = info;
}

// Перецентровка детали по X/Z и постановка нижней гранью на стол (Y = 0)
function alignModelToBed() {
  if (!currentModel) return;

  const geo = currentModel.geometry;
  geo.computeBoundingBox();
  const box = geo.boundingBox;

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  geo.translate(-center.x, -box.min.y, -center.z);
  geo.computeBoundingBox();

  currentModelSize = size.clone();
  updatePrinterVolume();
  updateScaleInfo(currentModelSize);
}

// Поворот модели на 90° вокруг выбранной оси ('x', 'y', 'z')
function rotateModel90(axis) {
  if (!currentModel) return;
  const angle = Math.PI / 2;
  if (axis === 'x') currentModel.geometry.rotateX(angle);
  if (axis === 'y') currentModel.geometry.rotateY(angle);
  if (axis === 'z') currentModel.geometry.rotateZ(angle);
  alignModelToBed();
}

// Переключение масштаба дюймы <-> миллиметры (×25.4)
function toggleInchScale() {
  if (!currentModel) return;
  const factor = isInchScaled ? (1 / 25.4) : 25.4;
  isInchScaled = !isInchScaled;

  currentModel.geometry.scale(factor, factor, factor);
  alignModelToBed();
  resetView();

  const btn = document.getElementById('btn-inch');
  if (btn) {
    btn.style.background = isInchScaled ? '#4a9eff' : '#3a3a3a';
  }
}

// Обновление списка файлов в папке для листания стрелками
async function refreshFolderList(filePath) {
  currentFilePath = filePath;
  if (!filePath) {
    folderFiles = [];
    currentFileIndex = -1;
    return;
  }
  folderFiles = await window.electronAPI.getFolderStlFiles(filePath);
  currentFileIndex = folderFiles.findIndex((p) => p.toLowerCase() === filePath.toLowerCase());
}

// Переход к соседнему STL-файлу в папке (-1 или +1)
function navigateFolder(step) {
  if (folderFiles.length <= 1 || currentFileIndex === -1) return;
  const nextIndex = (currentFileIndex + step + folderFiles.length) % folderFiles.length;
  loadSTL(folderFiles[nextIndex]);
}

// Отправка текущей STL-модели в настроенный слайсер
async function handleOpenInSlicer() {
  if (!currentFilePath) {
    alert('Сначала откройте STL файл');
    return;
  }

  let res = await window.electronAPI.launchSlicer({
    slicerPath: settings.slicerPath,
    stlPath: currentFilePath,
  });

  // Если путь не задан или слайсер был перемещён/удалён
  if (res.status === 'missing-slicer') {
    if (settings.slicerPath) {
      alert('Слайсер не найден по старому пути (возможно, он был перемещён или обновлён). Укажите новый путь к программе.');
    }

    const chosenPath = await window.electronAPI.selectSlicerDialog();
    if (!chosenPath) return; // Пользователь нажал «Отмена»

    settings.slicerPath = chosenPath;
    window.electronAPI.saveSettings(settings);

    // Повторно запускаем слайсер по новому пути
    res = await window.electronAPI.launchSlicer({
      slicerPath: settings.slicerPath,
      stlPath: currentFilePath,
    });
  }

  if (res.status === 'error') {
    alert(`Не удалось запустить слайсер: ${res.message}`);
  }
}

// Очистка текущей модели со сцены (если удалён последний файл в папке)
function clearCurrentModel() {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel.geometry.dispose();
    currentModel.material.dispose();
    currentModel = null;
  }
  currentModelSize = null;
  currentFilePath = null;
  folderFiles = [];
  currentFileIndex = -1;

  fileNameEl.textContent = '';
  scaleInfoEl.innerHTML = '';
  dropZone.classList.remove('hidden');
  updatePrinterVolume();
}

// Непосредственное перемещение файла в корзину и загрузка следующего
async function executeTrashCurrentFile() {
  if (!currentFilePath) return;

  const fileToDelete = currentFilePath;
  const res = await window.electronAPI.trashFile(fileToDelete);

  if (res.status !== 'ok') {
    alert(`Не удалось отправить файл в корзину: ${res.message || 'файл не найден'}`);
    return;
  }

  // Убираем удалённый файл из списка папки и переходим к следующему
  const deletedIdx = folderFiles.findIndex((p) => p.toLowerCase() === fileToDelete.toLowerCase());
  if (deletedIdx !== -1) {
    folderFiles.splice(deletedIdx, 1);
  }

  if (folderFiles.length > 0) {
    const nextIdx = Math.min(deletedIdx, folderFiles.length - 1);
    loadSTL(folderFiles[nextIdx]);
  } else {
    clearCurrentModel();
  }
}

// Запрос подтверждения перед удалением STL в корзину
function requestDeleteCurrentFile() {
  if (!currentFilePath) return;

  // Если пользователь ранее выбрал «Больше не спрашивать» — удаляем сразу
  if (settings.confirmDelete === false) {
    executeTrashCurrentFile();
    return;
  }

  // Не открываем второе окно, если диалог уже на экране
  if (document.getElementById('delete-confirm-modal')) return;

  const shortName = currentFilePath.split(/[\\/]/).pop();

  const modalHtml = `
    <div id="delete-confirm-modal" style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    ">
      <div style="
        background: #2a2a2a;
        border: 1px solid #444;
        padding: 20px;
        border-radius: 8px;
        width: 360px;
        color: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      ">
        <h3 style="margin: 0 0 10px 0; font-size: 17px;">Удаление файла</h3>
        <p style="margin: 0 0 14px 0; font-size: 14px; color: #ddd; line-height: 1.4;">
          Вы действительно хотите отправить в корзину файл:<br>
          <b style="color: #fff; word-break: break-all;">${shortName}</b>?
        </p>

        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #bbb; margin-bottom: 18px; cursor: pointer;">
          <input type="checkbox" id="dont-ask-delete">
          Больше не спрашивать повторно
        </label>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="btn-confirm-trash" style="
            background: #e03e3e; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500;
          ">В корзину (Enter)</button>
          <button id="btn-cancel-trash" style="
            background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;
          ">Отмена (Esc)</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('delete-confirm-modal');

  const closeAndConfirm = () => {
    const dontAsk = document.getElementById('dont-ask-delete').checked;
    if (dontAsk) {
      settings.confirmDelete = false;
      window.electronAPI.saveSettings(settings);
    }
    modal.remove();
    executeTrashCurrentFile();
  };

  const closeOnly = () => {
    modal.remove();
  };

  document.getElementById('btn-confirm-trash').addEventListener('click', closeAndConfirm);
  document.getElementById('btn-cancel-trash').addEventListener('click', closeOnly);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeOnly();
  });

  // Поддержка Enter и Escape внутри диалога
  const onModalKey = (e) => {
    if (!document.getElementById('delete-confirm-modal')) {
      window.removeEventListener('keydown', onModalKey);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      window.removeEventListener('keydown', onModalKey);
      closeAndConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      window.removeEventListener('keydown', onModalKey);
      closeOnly();
    }
  };
  window.addEventListener('keydown', onModalKey);
}

// Анимация рендера
function animate() {
  animationFrameId = requestAnimationFrame(animate);

  // Мигание рамки принтера (красный <-> белый) при выходе детали за габариты
  if (isPrinterOverflow && printerEdgesMaterial && printerWallsMaterial) {
    const pulse = (Math.sin(performance.now() * 0.008) + 1) / 2; // от 0 до 1
    const alertColor = new THREE.Color(0xff1e1e).lerp(new THREE.Color(0xffffff), pulse);
    printerEdgesMaterial.color.copy(alertColor);
    printerWallsMaterial.color.copy(alertColor);
    printerWallsMaterial.opacity = 0.05 + pulse * 0.08;
  }

  if (controls) controls.update();
  renderer.render(scene, camera);
}


// Анимация появления модели
function animateModel() {
  if (!currentModel) return;

  let scale = 0;
  const targetScale = 1;
  const speed = 0.1;

  function grow() {
    if (scale < targetScale) {
      scale = Math.min(targetScale, scale + speed);
      currentModel.scale.set(scale, scale, scale);
      requestAnimationFrame(grow);
    }
  }
  grow();
}

// Обработка изменения размера окна
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Сброс вида
// Сброс вида
function resetView() {
  const printers = getAllPrinters();
  const printer = printers[settings.printerModel] || DEFAULT_PRINTERS['p1-x1-a1-p2s'];

  if (settings.showPrinterBox) {
    const maxDim = Math.max(printer.x, printer.y, printer.z);
    if (controls) controls.target.set(0, printer.y / 2, 0);
    camera.position.set(maxDim * 1.1, printer.y * 0.9, maxDim * 1.5);
    camera.lookAt(0, printer.y / 2, 0);
    if (controls) controls.update();
    return;
  }

  if (currentModel) {
    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (controls) {
      controls.target.set(0, size.y / 2, 0);
    }
    camera.position.set(maxDim * 1.2, maxDim * 1.1, maxDim * 1.8);
    camera.lookAt(0, size.y / 2, 0);
    if (controls) controls.update();
  }
}

// Применение настроек
function applySettings(newSettings) {
  settings = { ...settings, ...newSettings };

  if (scene) {
    scene.background = new THREE.Color(settings.backgroundColor);
    createHorizon();
  }

  if (currentModel) {
    currentModel.material.color.set(settings.modelColor);
    currentModel.material.wireframe = settings.wireframe;
  }

  if (scaleRuler) {
    scaleRuler.visible = settings.showRuler;
  }

  updatePrinterVolume();

  if (currentModelSize) {
    updateScaleInfo(currentModelSize);
  }

  window.electronAPI.saveSettings(settings);
}

// Показ настроек
function showSettings() {
  const existingModal = document.getElementById('settings-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const allPrinters = getAllPrinters();
  const isCustomSelected = Boolean(settings.customPrinters && settings.customPrinters[settings.printerModel]);

  const settingsHtml = `
    <div id="settings-modal" style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    ">
      <div style="
        background: #2a2a2a;
        padding: 20px;
        border-radius: 8px;
        width: 380px;
        max-height: 90vh;
        overflow-y: auto;
        color: #fff;
      ">
        <h2 style="margin-top: 0;">Настройки</h2>
        
        <div style="display: flex; gap: 10px; margin: 10px 0;">
          <div style="flex: 1;">
            <label>Цвет фона:</label>
            <input type="color" id="bg-color" value="${settings.backgroundColor}" style="width: 100%;">
          </div>
          <div style="flex: 1;">
            <label>Цвет модели:</label>
            <input type="color" id="model-color" value="${settings.modelColor}" style="width: 100%;">
          </div>
        </div>
        
        <div style="margin: 8px 0;">
          <label>
            <input type="checkbox" id="wireframe" ${settings.wireframe ? 'checked' : ''}>
            Каркасный режим
          </label>
        </div>

        <div style="margin: 8px 0;">
          <label>
            <input type="checkbox" id="confirm-delete" ${settings.confirmDelete !== false ? 'checked' : ''}>
            Подтверждать удаление файлов в корзину
          </label>
        </div>

        <div style="margin: 8px 0;">
          <label>
            <input type="checkbox" id="show-horizon" ${settings.showHorizon !== false ? 'checked' : ''}>
            Показывать линию горизонта
          </label>
        </div>
        
        <div style="margin: 8px 0;">
          <label>
            <input type="checkbox" id="show-ruler" ${settings.showRuler ? 'checked' : ''}>
            Показывать мерную сетку
          </label>
        </div>
        
        <div style="display: flex; gap: 10px; margin: 10px 0;">
          <div style="flex: 1;">
            <label>Цвет сетки:</label>
            <input type="color" id="ruler-color" value="${settings.rulerColor}" style="width: 100%;">
          </div>
          <div style="flex: 1;">
            <label>Единицы габаритов:</label>
            <select id="ruler-unit" style="width: 100%; height: 40px;">
              <option value="mm" ${settings.rulerUnit === 'mm' ? 'selected' : ''}>Миллиметры</option>
              <option value="cm" ${settings.rulerUnit === 'cm' ? 'selected' : ''}>Сантиметры</option>
            </select>
          </div>
        </div>

        <hr style="border: 0; border-top: 1px solid #444; margin: 14px 0;">

        <div style="display: flex; align-items: center; justify-content: space-between; margin: 8px 0;">
          <label style="margin: 0;">
            <input type="checkbox" id="show-printer-box" ${settings.showPrinterBox ? 'checked' : ''}>
            Камера принтера
          </label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 12px; color: #aaa;">Цвет рамки:</span>
            <input type="color" id="printer-box-color" value="${settings.printerBoxColor || '#00ae42'}" style="width: 42px; height: 28px; margin: 0;">
          </div>
        </div>

        <div style="margin: 10px 0;">
          <label>Выбранный принтер:</label>
          <div style="display: flex; gap: 6px;">
            <select id="printer-model" style="flex: 1;">
              ${Object.entries(allPrinters)
                .map(([key, p]) => `<option value="${key}" ${settings.printerModel === key ? 'selected' : ''}>${p.name}</option>`)
                .join('')}
            </select>
            <button id="btn-delete-printer" title="Удалить пользовательский принтер" style="
              display: ${isCustomSelected ? 'inline-block' : 'none'};
              background: #d9383a;
              color: #fff;
              border: none;
              border-radius: 4px;
              padding: 0 10px;
              margin-top: 5px;
              cursor: pointer;
            ">🗑</button>
          </div>
        </div>

        <div style="background: #222; padding: 10px; border-radius: 6px; margin-top: 10px; border: 1px solid #3a3a3a;">
          <div style="font-size: 13px; color: #bbb; margin-bottom: 6px;">Добавить свой принтер (мм):</div>
          <input type="text" id="custom-printer-name" placeholder="Название (напр. Creality K1)" style="
            width: 100%; padding: 6px 8px; margin-bottom: 6px;
            background: #333; border: 1px solid #444; color: #fff; border-radius: 4px;
          ">
          <div style="display: flex; gap: 6px;">
            <input type="number" id="custom-printer-x" placeholder="Ширина X" min="10" style="
              width: 33%; padding: 6px; background: #333; border: 1px solid #444; color: #fff; border-radius: 4px;
            ">
            <input type="number" id="custom-printer-z" placeholder="Глубина Z" min="10" style="
              width: 33%; padding: 6px; background: #333; border: 1px solid #444; color: #fff; border-radius: 4px;
            ">
            <input type="number" id="custom-printer-y" placeholder="Высота Y" min="10" style="
              width: 33%; padding: 6px; background: #333; border: 1px solid #444; color: #fff; border-radius: 4px;
            ">
          </div>
          <button id="btn-add-printer" style="
            width: 100%; margin-top: 8px; padding: 6px;
            background: #3a3a3a; color: #fff; border: 1px solid #555; border-radius: 4px; cursor: pointer;
          ">+ Добавить принтер в список</button>
        </div>
                <hr style="border: 0; border-top: 1px solid #444; margin: 14px 0;">

        <div style="margin: 10px 0;">
          <label>Путь к слайсеру (.exe или ярлык):</label>
          <div style="display: flex; gap: 6px; margin-top: 5px;">
            <input type="text" id="slicer-path-input" readonly value="${settings.slicerPath || ''}" placeholder="Не выбран (спросит при запуске)" style="
              flex: 1; padding: 6px 8px; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; font-size: 12px;
            ">
            <button id="btn-browse-slicer" style="
              background: #3a3a3a; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 0 10px; cursor: pointer;
            ">Обзор...</button>
          </div>
        </div>

        <div style="margin-top: 18px; text-align: right;">
          <button id="btn-save-settings" style="
            background: #4a9eff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;
          ">Сохранить</button>
          <button id="btn-cancel-settings" style="
            background: #666; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 10px;
          ">Отмена</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', settingsHtml);

  const printerSelect = document.getElementById('printer-model');
  const deleteBtn = document.getElementById('btn-delete-printer');

  // Показываем кнопку удаления только для пользовательских принтеров
  printerSelect.addEventListener('change', () => {
    const selected = printerSelect.value;
    const isCustom = Boolean(settings.customPrinters && settings.customPrinters[selected]);
    deleteBtn.style.display = isCustom ? 'inline-block' : 'none';
  });

  // Добавление пользовательского принтера
  document.getElementById('btn-add-printer').addEventListener('click', () => {
    const rawName = document.getElementById('custom-printer-name').value.trim();
    const x = parseFloat(document.getElementById('custom-printer-x').value);
    const z = parseFloat(document.getElementById('custom-printer-z').value);
    const y = parseFloat(document.getElementById('custom-printer-y').value);

    if (!rawName || isNaN(x) || isNaN(y) || isNaN(z) || x <= 0 || y <= 0 || z <= 0) {
      alert('Укажите название и корректные размеры (Ширина, Глубина, Высота в мм).');
      return;
    }

    const id = 'custom-' + Date.now();
    const fullName = `${rawName} (${x}×${z}×${y} мм)`;

    if (!settings.customPrinters) settings.customPrinters = {};
    settings.customPrinters[id] = { name: fullName, x, y, z };
    settings.printerModel = id;
    settings.showPrinterBox = true;

    window.electronAPI.saveSettings(settings);
    document.getElementById('settings-modal').remove();
    updatePrinterVolume();
    showSettings();
  });

  // Удаление пользовательского принтера
  deleteBtn.addEventListener('click', () => {
    const selected = printerSelect.value;
    if (settings.customPrinters && settings.customPrinters[selected]) {
      delete settings.customPrinters[selected];
      settings.printerModel = 'p1-x1-a1-p2s';
      window.electronAPI.saveSettings(settings);
      document.getElementById('settings-modal').remove();
      updatePrinterVolume();
      showSettings();
    }
  });

  // Сохранение всех настроек
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newSettings = {
      backgroundColor: document.getElementById('bg-color').value,
      modelColor: document.getElementById('model-color').value,
      wireframe: document.getElementById('wireframe').checked,
      showHorizon: document.getElementById('show-horizon').checked,
      showRuler: document.getElementById('show-ruler').checked,
      rulerColor: document.getElementById('ruler-color').value,
      rulerUnit: document.getElementById('ruler-unit').value,
      showPrinterBox: document.getElementById('show-printer-box').checked,
      printerBoxColor: document.getElementById('printer-box-color').value,
      printerModel: document.getElementById('printer-model').value,
      slicerPath: document.getElementById('slicer-path-input').value.trim(),
      confirmDelete: document.getElementById('confirm-delete').checked,
    };
    applySettings(newSettings);
    document.getElementById('settings-modal').remove();
  });

  document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').remove();
  });

  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') {
      document.getElementById('settings-modal').remove();
    }
  });
  document.getElementById('btn-browse-slicer').addEventListener('click', async () => {
    const chosen = await window.electronAPI.selectSlicerDialog();
    if (chosen) {
      document.getElementById('slicer-path-input').value = chosen;
    }
  });
}


// Обработчики событий кнопок (перемещены в DOMContentLoaded)
function initApp() {
  initThreeJS();
  updatePrinterVolume();
  window.electronAPI.loadSettings();

  // Кнопки управления окном в шапке
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.electronAPI.minimizeWindow();
  });

  document.getElementById('btn-maximize').addEventListener('click', () => {
    window.electronAPI.maximizeWindow();
  });

  document.getElementById('btn-close').addEventListener('click', () => {
    window.electronAPI.exitApp();
  });

  // Кнопки нижней панели
  document.getElementById('btn-open').addEventListener('click', (e) => {
    e.stopPropagation();
    window.electronAPI.openFileDialog();
  });

  document.getElementById('btn-reset').addEventListener('click', (e) => {
    e.stopPropagation();
    resetView();
  });

  document.getElementById('btn-settings').addEventListener('click', (e) => {
    e.stopPropagation();
    showSettings();
  });

  document.getElementById('btn-exit').addEventListener('click', (e) => {
    e.stopPropagation();
    window.electronAPI.exitApp();
  });
    // Листание файлов в папке
    document.getElementById('btn-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      navigateFolder(-1);
    });
  
    document.getElementById('btn-next').addEventListener('click', (e) => {
      e.stopPropagation();
      navigateFolder(1);
    });
  
    // Поворот детали на 90°
    document.getElementById('btn-rot-x').addEventListener('click', (e) => {
      e.stopPropagation();
      rotateModel90('x');
    });
  
    document.getElementById('btn-rot-y').addEventListener('click', (e) => {
      e.stopPropagation();
      rotateModel90('y');
    });
  
    document.getElementById('btn-rot-z').addEventListener('click', (e) => {
      e.stopPropagation();
      rotateModel90('z');
    });
  
    // Переключение дюймы / мм
    document.getElementById('btn-inch').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInchScale();
    });
  
    // Открыть в слайсере
  document.getElementById('btn-slicer').addEventListener('click', (e) => {
    e.stopPropagation();
    handleOpenInSlicer();
  });

  // Листание стрелками на клавиатуре (← / →)
  window.addEventListener('keydown', (e) => {
    if (document.getElementById('settings-modal') || document.getElementById('delete-confirm-modal')) return;
    if (e.key === 'ArrowLeft') navigateFolder(-1);
    if (e.key === 'ArrowRight') navigateFolder(1);
    if (e.key === 'Delete') requestDeleteCurrentFile();
  });
  
   // Удаление файла в корзину
   document.getElementById('btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    requestDeleteCurrentFile();
  });

}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}


// Обработка открытия файла через IPC
window.electronAPI.onOpenFile((filePath) => {
  loadSTL(filePath);
});

// Обработка загрузки настроек
window.electronAPI.onSettingsLoaded((loadedSettings) => {
  applySettings(loadedSettings);
});

// Обработка показа настроек
window.electronAPI.onShowSettings(() => {
  showSettings();
});

// Очистка при закрытии
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (renderer) {
    renderer.dispose();
  }
});