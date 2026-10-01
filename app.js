/* Classic script: no imports, network requests or build step; works with file://. */
(() => {
  "use strict";

  const STORAGE_KEY = "gym-social-planner.v1";
  const ROUTINES = ["Push · Pecho y tríceps", "Pull · Espalda y bíceps", "Piernas", "Full body", "Upper body", "Lower body", "Cardio", "Movilidad", "Otra rutina"];
  const VIEWS = {
    dashboard: ["Overview", "TU RITMO, TU BALANCE", "Un buen día para superarte", "Un poco de esfuerzo, buenos amigos y tiempo para ti.", "workout", "Registrar entreno"],
    gym: ["Entrenamientos", "CADA REPETICIÓN CUENTA", "Construye tu mejor versión", "Tu historial de esfuerzo. Un entrenamiento a la vez.", "workout", "Registrar entreno"],
    body: ["Mi evolución", "EL PROGRESO ES PERSONAL", "Más allá del espejo", "Observa tu evolución sin prisas. Los pequeños cambios también cuentan.", "weight", "Registrar peso"],
    social: ["Planes sociales", "LOS BUENOS MOMENTOS SUMAN", "La vida también pasa fuera", "Haz espacio para tus amigos. El próximo buen recuerdo empieza aquí.", "event", "Crear un plan"],
    challenges: ["Mis retos", "PEQUEÑOS PASOS, GRANDES CAMBIOS", "Ponte un reto. Hazlo tuyo", "Objetivos reales, progreso visible y motivación para seguir.", "challenge", "Crear reto"],
    achievements: ["Logros", "TE LO HAS GANADO", "Celebra cada conquista", "No es solo una insignia. Es todo lo que has hecho para llegar aquí.", null, null],
    stats: ["Estadísticas", "TU PROGRESO EN PERSPECTIVA", "Los números cuentan tu historia", "Descubre tus hábitos y encuentra el equilibrio que funciona para ti.", null, null],
    settings: ["Ajustes y datos", "TU ESPACIO, TUS REGLAS", "Siempre bajo tu control", "Sin cuentas, sin servidores. Tus datos son tuyos.", null, null]
  };
  const $ = (selector) => document.querySelector(selector);
  const icon = (name, extra = "") => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value, digits = 0) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value);
  const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const today = () => localDate();
  const parseDate = (value) => new Date(`${value}T12:00:00`);
  const shiftDate = (value, offset) => { const date = parseDate(value); date.setDate(date.getDate() + offset); return localDate(date); };
  const weekStart = (value = today()) => { const date = parseDate(value); return shiftDate(value, -((date.getDay() + 6) % 7)); };
  const dateText = (value, options = { day: "numeric", month: "short" }) => parseDate(value).toLocaleDateString("es-ES", options);
  const dateTimeText = (value) => new Date(value).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  const timeText = (value) => new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const uid = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const blankState = () => ({ version: 1, demo: false, workouts: [], weights: [], events: [], challenges: [], achievements: {} });
  let state;
  let view = "dashboard";
  let editor = null;
  let confirmation = null;
  let storageProblem = "";
  let corruptRaw = null;
  let workoutFilter = "all";
  let eventFilter = "upcoming";
  let challengeFilter = "active";
  let searchQuery = "";
  let chartWeeks = 8;
  let weightPeriod = 90;
  let dayAtRender = today();

  // Calendar arithmetic uses local dates, avoiding UTC shifts and daylight-saving errors.
  function currentStreak(data = state) {
    const dates = new Set(data.workouts.map((item) => item.date));
    let cursor = dates.has(today()) ? today() : shiftDate(today(), -1);
    let count = 0;
    while (dates.has(cursor)) { count++; cursor = shiftDate(cursor, -1); }
    return count;
  }

  function bestStreak(data = state) {
    const dates = [...new Set(data.workouts.map((item) => item.date))].sort();
    let run = 0;
    let best = 0;
    let previous = null;
    for (const date of dates) {
      run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
      best = Math.max(best, run);
      previous = date;
    }
    return best;
  }

  function goalProgress(goal, data = state) {
    const inRange = (date) => date >= goal.start && (!goal.deadline || date <= goal.deadline) && date <= today();
    if (goal.type === "gym") return data.workouts.filter((item) => inRange(item.date)).length;
    if (goal.type === "social") return data.events.filter((item) => item.completed && inRange(item.datetime.slice(0, 10))).length;
    if (goal.type === "water") return inRange(today()) ? (goal.daily[today()] || 0) : 0;
    return goal.progress;
  }

  const goalComplete = (goal, data = state) => goalProgress(goal, data) >= goal.target;
  const goalExpired = (goal) => !!goal.deadline && goal.deadline < today();
  const goalPercent = (goal) => Math.min(100, Math.round(goalProgress(goal) / goal.target * 100));
  const goalIcon = (goal) => ({ gym: "gym", social: "users", water: "water", manual: "target" })[goal.type];
  const goalColor = (goal) => goal.type === "social" ? "blue" : goal.type === "water" ? "green" : "";
  const goalUnit = (goal) => ({ gym: "entrenos", social: "planes", water: "litros" })[goal.type] || goal.unit;
  const activeGoals = () => state.challenges.filter((goal) => !goalExpired(goal) && (goal.type === "water" || !goalComplete(goal)));
  const completedGoals = () => state.challenges.filter((goal) => goalComplete(goal)).length;

  const ACHIEVEMENTS = [
    { id: "first", title: "El primer paso", description: "Registra tu primer entrenamiento.", icon: "gym", target: 1, value: (data) => data.workouts.length },
    { id: "ten", title: "Ya es un hábito", description: "Acumula 10 entrenamientos. La constancia se nota.", icon: "fire", target: 10, value: (data) => data.workouts.length },
    { id: "thirty", title: "Modo imparable", description: "Suma 30 entrenamientos. Esto va en serio.", icon: "trophy", target: 30, value: (data) => data.workouts.length },
    { id: "challenge", title: "Reto conquistado", description: "Completa tu primer reto, incluido un objetivo diario.", icon: "target", target: 1, value: (data) => data.challenges.some((goal) => goalComplete(goal, data) || (goal.type === "water" && Object.values(goal.daily).some((amount) => amount >= goal.target))) ? 1 : 0 },
    { id: "streak", title: "En tu mejor racha", description: "Entrena 3 días consecutivos. Tú pones el ritmo.", icon: "spark", target: 3, value: bestStreak },
    { id: "social", title: "Mejor en compañía", description: "Completa 5 planes con amigos.", icon: "users", target: 5, value: (data) => data.events.filter((item) => item.completed).length }
  ];

  function unlockAchievements(data) {
    const unlocked = [];
    for (const achievement of ACHIEVEMENTS) {
      if (!data.achievements[achievement.id] && achievement.value(data) >= achievement.target) {
        data.achievements[achievement.id] = new Date().toISOString();
        unlocked.push(achievement);
      }
    }
    return unlocked;
  }

  function demoState() {
    const data = blankState();
    data.demo = true;
    const offsets = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 21, 23, 26, 29, 32, 36, 40];
    data.workouts = offsets.map((offset, index) => ({
      id: uid(), date: shiftDate(today(), -offset), routine: ROUTINES[index % 4],
      duration: [65, 55, 70, 45][index % 4],
      notes: ["Buena energía. Subí el peso en la última serie.", "Controlando la técnica y los descansos.", "Un poco más fuerte que la semana pasada.", "Sesión corta, pero cumplida."][index % 4]
    }));
    data.weights = Array.from({ length: 12 }, (_, index) => ({
      id: uid(), date: shiftDate(today(), -(11 - index) * 4),
      value: Math.round((75.8 - index * .16 + [0, .15, -.1][index % 3]) * 10) / 10
    }));
    const event = (title, offset, hour, place, friends, description, completed = false) => ({
      id: uid(), title, datetime: `${shiftDate(today(), offset)}T${hour}`,
      place, friends, description, completed
    });
    data.events = [
      event("Café & ponerse al día", 1, "17:30", "Café del campus", "Alex, Carla, Dani", "Un café después de clase y cero prisas."),
      event("Viernes de desconexión", 3, "21:00", "La Terraza", "Carla, Leo, Sara, Alex", "Cena, música y lo que surja. Reservar una mesa."),
      event("Un paseo, mil conversaciones", 5, "18:00", "Parque de la ciudad", "Dani, Sara", "Paseo al atardecer. Traer algo para picar."),
      event("Noche de juegos", -4, "20:00", "Piso de Alex", "Alex, Carla, Leo", "Pizza y juegos de mesa.", true),
      event("Brunch de domingo", -10, "11:00", "Café Central", "Sara, Dani", "Nuestro desayuno favorito.", true),
      event("Tarde de cine", -18, "18:30", "Cines del centro", "Alex, Leo", "Una película y unas palomitas.", true)
    ];
    data.challenges = [
      { id: uid(), title: "20 entrenos. Una mejor versión.", type: "gym", target: 20, unit: "", start: shiftDate(today(), -28), deadline: shiftDate(today(), 28), progress: 0, daily: {} },
      { id: uid(), title: "Más recuerdos con mi gente", type: "social", target: 8, unit: "", start: shiftDate(today(), -28), deadline: shiftDate(today(), 28), progress: 0, daily: {} },
      { id: uid(), title: "Hidratación en modo ON", type: "water", target: 2, unit: "", start: shiftDate(today(), -7), deadline: "", progress: 0, daily: { [today()]: .75 } },
      { id: uid(), title: "5 mañanas sin posponer la alarma", type: "manual", target: 5, unit: "mañanas", start: shiftDate(today(), -7), deadline: shiftDate(today(), 14), progress: 3, daily: {} }
    ];
    unlockAchievements(data);
    return data;
  }

  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" && value <= "2100-12-31" && !Number.isNaN(parseDate(value).getTime()) && localDate(parseDate(value)) === value;
  const validDatetime = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && validDate(value.slice(0, 10)) && Number(value.slice(11, 13)) <= 23 && Number(value.slice(14)) <= 59 && !Number.isNaN(new Date(value).getTime());
  const text = (value, max, required = false) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
  const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

  // Validate stored/imported data before it can reach the UI or overwrite a backup.
  function validateState(data) {
    if (!data || typeof data !== "object" || data.version !== 1 || typeof data.demo !== "boolean") throw new Error("El archivo no tiene un formato compatible con Gym & Social Planner.");
    for (const key of ["workouts", "weights", "events", "challenges"]) {
      if (!Array.isArray(data[key]) || data[key].length > 10000) throw new Error(`La colección «${key}» no es válida o supera 10.000 registros.`);
      const ids = new Set();
      for (const item of data[key]) {
        if (!item || !text(item.id, 100, true) || ids.has(item.id)) throw new Error("Hay registros inválidos o identificadores duplicados.");
        ids.add(item.id);
      }
    }
    for (const item of data.workouts) {
      if (!validDate(item.date) || item.date > today() || !ROUTINES.includes(item.routine) || !finite(item.duration, 1, 600) || !Number.isInteger(item.duration) || !text(item.notes, 1000)) throw new Error("Hay un entrenamiento con fecha, rutina o duración no válida.");
    }
    const weightDates = new Set();
    for (const item of data.weights) {
      if (!validDate(item.date) || item.date > today() || !finite(item.value, 20, 350) || weightDates.has(item.date)) throw new Error("Hay un peso no válido o más de un peso en la misma fecha.");
      weightDates.add(item.date);
    }
    for (const item of data.events) {
      if (!text(item.title, 100, true) || !validDatetime(item.datetime) || !text(item.place, 160, true) || !text(item.friends, 300) || !text(item.description, 1000) || typeof item.completed !== "boolean" || (item.completed && new Date(item.datetime) > new Date())) throw new Error("Hay un evento no válido o un plan futuro marcado como completado.");
    }
    for (const item of data.challenges) {
      if (!text(item.title, 100, true) || !["gym", "social", "manual", "water"].includes(item.type) || !finite(item.target, .1, 10000) || (item.type !== "water" && !Number.isInteger(item.target)) || (item.type === "water" && item.target > 10) || !validDate(item.start) || (item.deadline !== "" && (!validDate(item.deadline) || item.deadline < item.start)) || !text(item.unit, 40, item.type === "manual") || !finite(item.progress, 0, 10000) || !Number.isInteger(item.progress) || !item.daily || typeof item.daily !== "object" || Array.isArray(item.daily)) throw new Error("Hay un reto con datos no válidos.");
      if (Object.keys(item.daily).length > 10000 || Object.entries(item.daily).some(([date, amount]) => !validDate(date) || date > today() || date < item.start || (item.deadline && date > item.deadline) || !finite(amount, 0, 20))) throw new Error("El historial de agua contiene datos no válidos.");
    }
    if (!data.achievements || typeof data.achievements !== "object" || Array.isArray(data.achievements)) throw new Error("El historial de logros no es válido.");
    for (const [id, timestamp] of Object.entries(data.achievements)) {
      if (!ACHIEVEMENTS.some((item) => item.id === id) || typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) throw new Error("Hay una fecha de logro no válida.");
    }
    // Rebuild a known schema instead of retaining arbitrary imported properties.
    const clean = blankState();
    clean.demo = data.demo;
    clean.workouts = data.workouts.map(({ id, date, routine, duration, notes }) => ({ id, date, routine, duration, notes }));
    clean.weights = data.weights.map(({ id, date, value }) => ({ id, date, value }));
    clean.events = data.events.map(({ id, title, datetime, place, friends, description, completed }) => ({ id, title, datetime, place, friends, description, completed }));
    clean.challenges = data.challenges.map(({ id, title, type, target, unit, start, deadline, progress, daily }) => ({ id, title, type, target, unit, start, deadline, progress, daily: { ...daily } }));
    clean.achievements = { ...data.achievements };
    return clean;
  }

  function load() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch (error) {
      storageProblem = "El navegador no permite acceder al almacenamiento local. No se podrán guardar cambios. Revisa sus permisos o utiliza un navegador con LocalStorage habilitado.";
      state = demoState();
      return;
    }
    if (raw !== null) {
      try {
        state = validateState(JSON.parse(raw));
        corruptRaw = null;
        storageProblem = "";
      }
      catch (error) {
        corruptRaw = raw;
        storageProblem = `Los datos guardados no se han podido leer: ${error.message} No se han sobrescrito. Exporta los datos originales y restablece o importa una copia desde Ajustes.`;
        state = blankState();
      }
    } else {
      state = demoState();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch (error) { storageProblem = "No se pudieron guardar los datos de ejemplo. El almacenamiento está bloqueado o lleno; los cambios no se guardarán hasta resolverlo."; }
    }
  }

  function persist(next, recovering = false) {
    if (corruptRaw !== null && !recovering) throw new Error("Primero recupera o restablece tus datos desde Ajustes. La copia original no se ha sobrescrito.");
    const clean = validateState(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clean)); }
    catch (error) { throw new Error("No se pudo guardar. El almacenamiento del navegador está bloqueado o lleno. Exporta una copia y revisa los permisos. Tus cambios no se han aplicado."); }
    state = clean;
    storageProblem = "";
    corruptRaw = null;
  }

  function commit(mutator, message) {
    const next = clone(state);
    mutator(next);
    const unlocked = unlockAchievements(next);
    persist(next);
    render();
    if (message) toast(message);
    unlocked.forEach((achievement) => toast(`Nuevo logro: ${achievement.title}`, "achievement"));
  }

  function toast(message, type = "success") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.innerHTML = icon(type === "achievement" ? "trophy" : type === "error" ? "info" : "check") + `<span>${escape(message)}</span>`;
    if (type === "error") item.setAttribute("role", "alert");
    $("#toast-container").append(item);
    setTimeout(() => item.remove(), type === "error" ? 8500 : 4800);
  }

  const stat = (label, value, suffix, foot, name, color = "") => `<article class="stat-card ${color}"><div class="stat-top"><span class="stat-label">${label}</span><span class="icon-tile">${icon(name)}</span></div><div class="stat-value">${value}<small>${suffix}</small></div><div class="stat-foot">${foot}</div></article>`;
  const panelHead = (title, subtitle = "", right = "") => `<div class="panel-header"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${right}</div>`;
  const link = (route, label) => `<a class="text-button" href="#${route}">${label}${icon("arrow")}</a>`;
  const empty = (name, title, description, action = "", label = "") => `<div class="empty-state">${icon(name)}<h3>${title}</h3><p>${description}</p>${action ? `<button class="button primary small" data-action="${action}">${icon("plus")}${label}</button>` : ""}</div>`;
  const badge = (label, color = "", name = "") => `<span class="tag ${color}">${name ? icon(name) : ""}${label}</span>`;
  const editActions = (kind, id) => `<div class="row-actions"><button class="icon-button" data-action="edit" data-kind="${kind}" data-id="${escape(id)}" aria-label="Editar registro">${icon("edit")}</button><button class="icon-button delete" data-action="delete" data-kind="${kind}" data-id="${escape(id)}" aria-label="Eliminar registro">${icon("trash")}</button></div>`;
  const progressBar = (goal) => `<div class="progress-track" role="progressbar" aria-label="${escape(goal.title)}" aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${Math.min(goalProgress(goal), goal.target)}"><div class="progress-fill ${goalColor(goal)}-fill" style="width:${goalPercent(goal)}%"></div></div>`;

  function weekData(count) {
    const current = weekStart();
    return Array.from({ length: count }, (_, index) => {
      const start = shiftDate(current, -(count - 1 - index) * 7);
      const end = shiftDate(start, 6);
      return { start, end, value: state.workouts.filter((item) => item.date >= start && item.date <= end).length };
    });
  }

  function barChart(count = chartWeeks) {
    const rows = weekData(count);
    const max = Math.max(4, ...rows.map((item) => item.value));
    const upper = Math.ceil(max / 4) * 4;
    const width = 600, height = 220, left = 32, right = 14, bottom = 34, top = 20;
    const plotHeight = height - bottom - top;
    const slot = (width - left - right) / count;
    const grids = Array.from({ length: 5 }, (_, index) => {
      const y = top + plotHeight * index / 4;
      return `<line class="grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text x="15" y="${y + 3}" text-anchor="middle">${upper * (4 - index) / 4}</text>`;
    }).join("");
    const bars = rows.map((row, index) => {
      const h = row.value / upper * plotHeight;
      const x = left + index * slot + slot * .23;
      const label = `${dateText(row.start)} – ${dateText(row.end)}: ${row.value} entrenamiento${row.value === 1 ? "" : "s"}${index === count - 1 ? " (semana en curso)" : ""}`;
      return `<g class="chart-point" tabindex="0" role="button" aria-label="${escape(label)}" data-chart-info="${escape(label)}"><title>${escape(label)}</title><rect class="bar ${index === count - 1 ? "bar-current" : ""}" x="${x}" y="${top + plotHeight - Math.max(h, 3)}" width="${slot * .54}" height="${Math.max(h, 3)}" rx="5"/><rect x="${left + index * slot}" y="${top}" width="${slot}" height="${plotHeight + 5}" fill="transparent"/><text x="${left + index * slot + slot / 2}" y="${height - 12}" text-anchor="middle">${dateText(row.start, { day: "numeric", month: "short" }).replace(".", "")}</text></g>`;
    }).join("");
    return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="Entrenamientos por semana. Selecciona una barra para ver sus detalles."><defs><linearGradient id="bar-gradient" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#6950a6"/><stop offset="1" stop-color="#a08ae0"/></linearGradient><linearGradient id="bar-current-gradient" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#7957d8"/><stop offset="1" stop-color="#c0a4ff"/></linearGradient></defs>${grids}${bars}</svg></div><div class="chart-caption"><span class="legend">Entrenamientos · última semana en curso</span><span class="chart-detail" aria-live="polite">Explora las barras</span></div>`;
  }

  function sortedWeights() { return [...state.weights].sort((a, b) => a.date.localeCompare(b.date)); }

  function weightChart() {
    const cutoff = shiftDate(today(), -weightPeriod);
    const rows = sortedWeights().filter((item) => item.date >= cutoff);
    if (!rows.length) return empty("body", "Tu evolución empieza aquí", "No hay registros en este período.", "open-weight", "Registrar peso");
    const min = Math.floor(Math.min(...rows.map((item) => item.value)) - .5);
    const max = Math.ceil(Math.max(...rows.map((item) => item.value)) + .5);
    const width = 600, height = 250, left = 44, right = 26, top = 24, bottom = 40;
    const plotHeight = height - top - bottom;
    const first = parseDate(rows[0].date).getTime();
    const last = parseDate(rows[rows.length - 1].date).getTime();
    const points = rows.map((item) => ({
      ...item, x: rows.length === 1 ? (width + left - right) / 2 : left + (parseDate(item.date).getTime() - first) / (last - first) * (width - left - right),
      y: top + (max - item.value) / (max - min) * plotHeight
    }));
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    const area = `${path} L${points[points.length - 1].x} ${height - bottom} L${points[0].x} ${height - bottom} Z`;
    const grids = Array.from({ length: 5 }, (_, index) => {
      const y = top + index / 4 * plotHeight;
      return `<line class="grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text x="8" y="${y + 3}">${number(max - (max - min) * index / 4, 1)}</text>`;
    }).join("");
    const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || (points.length > 3 && index === Math.floor(points.length / 2))).map((point) => `<text x="${point.x}" y="${height - 14}" text-anchor="middle">${dateText(point.date)}</text>`).join("");
    const dots = points.map((point) => {
      const info = `${dateText(point.date, { day: "numeric", month: "long", year: "numeric" })}: ${number(point.value, 2)} kg`;
      return `<g class="chart-point" tabindex="0" role="button" aria-label="${escape(info)}" data-chart-info="${escape(info)}"><title>${escape(info)}</title><circle cx="${point.x}" cy="${point.y}" r="4" fill="#a58aff" stroke="#181b29" stroke-width="2"/><circle cx="${point.x}" cy="${point.y}" r="12" fill="transparent"/></g>`;
    }).join("");
    return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="Evolución del peso en kilogramos. Selecciona un punto para consultar el registro."><defs><linearGradient id="weight-area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a58aff" stop-opacity=".25"/><stop offset="1" stop-color="#a58aff" stop-opacity="0"/></linearGradient></defs>${grids}<path d="${area}" fill="url(#weight-area)"/><path d="${path}" fill="none" stroke="#a58aff" stroke-width="2.5" stroke-linejoin="round"/>${labels}${dots}</svg></div><div class="chart-caption"><span class="legend">Peso corporal · kg</span><span class="chart-detail" aria-live="polite">Explora los puntos</span></div>`;
  }

  function periodControls(kind) {
    const options = kind === "weeks" ? [[4, "4 sem."], [8, "8 sem."], [12, "12 sem."]] : [[30, "1 mes"], [90, "3 meses"], [365, "1 año"]];
    const active = kind === "weeks" ? chartWeeks : weightPeriod;
    return `<div class="segmented" aria-label="Período del gráfico">${options.map(([value, label]) => `<button data-action="period" data-kind="${kind}" data-value="${value}" class="${active === value ? "active" : ""}" aria-pressed="${active === value}">${label}</button>`).join("")}</div>`;
  }

  function friendsMarkup(friends) {
    const names = friends.split(",").map((name) => name.trim()).filter(Boolean);
    if (!names.length) return `<span class="muted">Tu próximo recuerdo</span>`;
    return `<div class="friend-stack" aria-label="${escape(names.join(", "))}">${names.slice(0, 3).map((name) => `<span class="friend-avatar" title="${escape(name)}">${escape(name[0].toUpperCase())}</span>`).join("")}${names.length > 3 ? `<span class="friend-avatar">+${names.length - 3}</span>` : ""}</div>`;
  }

  function eventRow(event) {
    const date = event.datetime.slice(0, 10);
    return `<article class="event-row"><div class="date-tile"><span>${dateText(date, { month: "short" }).replace(".", "")}</span><strong>${parseDate(date).getDate()}</strong></div><div class="event-info"><h3>${escape(event.title)}</h3><div class="event-meta"><span>${icon("clock")}${timeText(event.datetime)}</span><span>${icon("pin")}${escape(event.place)}</span></div></div>${friendsMarkup(event.friends)}</article>`;
  }

  function goalPreview(goal) {
    return `<div class="challenge-preview"><div class="challenge-line"><div class="challenge-name">${icon(goalIcon(goal))}<span>${escape(goal.title)}</span></div><span class="challenge-count"><strong>${number(goalProgress(goal), 2)}</strong> / ${number(goal.target, 2)}${goal.type === "water" ? " L" : ""}</span></div>${progressBar(goal)}</div>`;
  }

  function dashboard() {
    const start = weekStart();
    const workouts = state.workouts.filter((item) => item.date >= start);
    const previous = state.workouts.filter((item) => item.date >= shiftDate(start, -7) && item.date < start).length;
    const upcoming = state.events.filter((item) => !item.completed && new Date(item.datetime) >= new Date()).sort((a, b) => a.datetime.localeCompare(b.datetime));
    const social = state.events.filter((item) => item.completed && item.datetime.slice(0, 10) >= start).length;
    const latest = sortedWeights().at(-1);
    const gymShare = workouts.length + social ? Math.round(workouts.length / (workouts.length + social) * 100) : 0;
    const circumference = 2 * Math.PI * 66;
    const active = activeGoals();
    const difference = workouts.length - previous;
    const trainingDates = new Set(state.workouts.map((item) => item.date));
    return `${state.demo ? `<div class="demo-strip">${icon("spark")}<span>Estás explorando datos de ejemplo. Todo es editable.</span><a href="#settings">Empezar desde cero ↗</a></div>` : ""}
      <div class="stats-grid">
        ${stat("Entrenos esta semana", workouts.length, "sesiones", `${icon("chart")}<span class="${difference >= 0 ? "positive" : ""}">${difference > 0 ? "+" : ""}${difference} vs. semana anterior</span>`, "gym")}
        ${stat("Tiempo para ti", number(workouts.reduce((sum, item) => sum + item.duration, 0)), "min", `${icon("clock")} Tiempo entrenado esta semana`, "clock", "blue")}
        ${stat("Próximos planes", upcoming.length, "quedadas", `${icon("users")} ${upcoming.length ? "Hay buenos momentos por venir" : "Haz espacio para tu gente"}`, "users", "green")}
        ${stat("Racha actual", currentStreak(), "días", `${icon("fire")} Récord personal: ${bestStreak()} días`, "fire", "orange")}
      </div>
      <div class="dashboard-grid">
        <section class="panel">${panelHead("Tu constancia, en perspectiva", "Cada sesión es una inversión en ti.", `<span class="chip">${icon("calendar")}Últimas ${chartWeeks} semanas</span>`)}${barChart()}<div class="panel-footer"><span>${latest ? `Último peso registrado: <strong>${number(latest.value, 2)} kg</strong>` : "Un entrenamiento a la vez."}</span>${link("stats", "Ver estadísticas")}</div></section>
        <section class="panel balance-panel">${panelHead("Tu balance semanal", "Entrenar y vivir. Hay espacio para ambos.", badge("ESTA SEMANA"))}<div class="balance-content"><div class="balance-ring"><svg viewBox="0 0 170 170" aria-hidden="true"><circle cx="85" cy="85" r="66" stroke="#25283a"/><circle cx="85" cy="85" r="66" stroke="#67baff" stroke-dasharray="${workouts.length + social ? circumference : 0} ${circumference}"/><circle cx="85" cy="85" r="66" stroke="#a58aff" stroke-dasharray="${circumference * gymShare / 100} ${circumference}" stroke-linecap="${gymShare ? "round" : "butt"}"/></svg><div class="balance-center"><strong>${workouts.length + social}</strong><small>momentos para ti</small></div></div><div class="balance-legend"><span class="legend">Gym <strong>${workouts.length}</strong></span><span class="legend blue-legend">Social <strong>${social}</strong></span></div><div class="balance-tip">${icon("spark")}Tu equilibrio no tiene que ser 50/50. Tiene que ser tuyo.</div></div></section>
        <section class="panel">${panelHead("En tu agenda", "Planes que merece la pena esperar.", link("social", "Ver todos"))}<div class="event-list">${upcoming.length ? upcoming.slice(0, 3).map(eventRow).join("") : empty("users", "Un hueco para algo bueno", "Organiza tu próxima quedada.", "open-event", "Crear plan")}</div><div class="panel-footer"><span>Los mejores planes empiezan con un «¿quedamos?».</span></div></section>
        <section class="panel">${panelHead("Objetivos en marcha", `${active.length} retos activos. Tú puedes.`, link("challenges", "Ver retos"))}<div class="challenge-list">${active.length ? active.slice(0, 3).map(goalPreview).join("") : empty("target", "Tu próxima meta te espera", "Elige algo que quieras mejorar.", "open-challenge", "Crear reto")}</div><div class="panel-footer"><span>${completedGoals()} objetivos cumplidos${state.challenges.some((goal) => goal.type === "water") ? " · agua: progreso de hoy" : ""}</span>${icon("target")}</div></section>
        <section class="streak-banner"><div class="streak-left"><span class="streak-flame">${icon("fire")}</span><div><h3>${currentStreak() > 0 ? `Llevas ${currentStreak()} día${currentStreak() === 1 ? "" : "s"} en movimiento. Sigue así.` : "Hoy puede empezar tu próxima racha."}</h3><p>La constancia se construye día a día. Descansar también cuenta.</p></div></div><div class="streak-days">${Array.from({ length: 7 }, (_, index) => {
          const date = shiftDate(start, index);
          return `<div class="streak-day ${trainingDates.has(date) ? "done" : ""} ${date === today() ? "today" : ""}" title="${dateText(date)}: ${trainingDates.has(date) ? "entrenamiento registrado" : "sin entrenamiento"}"><span>${trainingDates.has(date) ? icon("check") : "·"}</span>${["L", "M", "X", "J", "V", "S", "D"][index]}</div>`;
        }).join("")}</div></section>
      </div>`;
  }

  function filterButtons(kind, options, selected) {
    return `<div class="segmented" aria-label="Filtrar registros">${options.map(([value, label]) => `<button class="${value === selected ? "active" : ""}" data-action="filter" data-kind="${kind}" data-value="${value}" aria-pressed="${value === selected}">${label}</button>`).join("")}</div>`;
  }

  function gym() {
    const total = state.workouts.reduce((sum, item) => sum + item.duration, 0);
    const week = state.workouts.filter((item) => item.date >= weekStart()).length;
    const rows = [...state.workouts].filter((item) => (workoutFilter !== "week" || item.date >= weekStart()) && `${item.routine} ${item.notes}`.toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="stats-grid">${stat("Total de entrenamientos", state.workouts.length, "sesiones", "Todo tu historial", "gym")}${stat("Esta semana", week, "sesiones", `Desde el ${dateText(weekStart())}`, "calendar", "blue")}${stat("Tiempo acumulado", number(total / 60, 1), "horas", `${number(total)} minutos de esfuerzo`, "clock", "green")}${stat("Duración media", state.workouts.length ? number(total / state.workouts.length) : "—", "min", "Cada sesión tiene su propio ritmo", "chart", "orange")}</div>
      <section class="panel"><div class="toolbar"><h2>Tu diario de entrenamiento <span class="muted">· ${rows.length}</span></h2><div class="toolbar-controls">${filterButtons("gym", [["all", "Todos"], ["week", "Esta semana"]], workoutFilter)}<label class="visually-hidden" for="workout-search">Buscar rutina o notas</label><input class="search-input" type="search" id="workout-search" placeholder="Buscar rutina o notas…" maxlength="100" value="${escape(searchQuery)}"></div></div>
      ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>ENTRENAMIENTO</th><th>FECHA</th><th>DURACIÓN</th><th><span class="visually-hidden">Acciones</span></th></tr></thead><tbody>${rows.map((item) => `<tr><td><span class="table-title">${icon("gym")}${escape(item.routine)}</span>${item.notes ? `<span class="table-note">${escape(item.notes)}</span>` : ""}</td><td>${dateText(item.date, { day: "numeric", month: "short", year: "numeric" })}</td><td><span class="chip">${icon("clock")}${item.duration} min</span></td><td>${editActions("workout", item.id)}</td></tr>`).join("")}</tbody></table></div>` : empty("gym", state.workouts.length ? "No hay coincidencias" : "El primer paso cuenta", state.workouts.length ? "Prueba otra búsqueda o cambia el filtro." : "Registra tu entrenamiento y empieza a construir tu historial.", "open-workout", "Registrar entreno")}</section>`;
  }

  // Trends compare real observations within 7/30 days, never invent missing measurements.
  function weightTrend(days) {
    const rows = sortedWeights();
    const latest = rows.at(-1);
    if (!latest) return null;
    const cutoff = shiftDate(today(), -days);
    const first = rows.find((item) => item.date >= cutoff && item.date < latest.date);
    if (!first || latest.date < cutoff) return null;
    return { change: Math.round((latest.value - first.value) * 100) / 100, first, latest };
  }

  const trendText = (trend) => trend ? `${trend.change > 0 ? "+" : ""}${number(trend.change, 2)} kg` : "Sin datos suficientes";

  function trendPanel() {
    const week = weightTrend(7), month = weightTrend(30);
    return `<section class="panel">${panelHead("Cambios, no juicios", "Tu tendencia con los registros disponibles.")}<div class="panel-body">${[[7, "Últimos 7 días", week], [30, "Últimos 30 días", month]].map(([, label, trend]) => `<div class="trend-row"><div><span>${label}</span><small>${trend ? `${dateText(trend.first.date)} → ${dateText(trend.latest.date)}` : "Necesitas 2 registros en este período"}</small></div><strong class="purple-text" style="${trend ? "" : "font-size:11px"}">${trend ? trendText(trend) : "—"}</strong></div>`).join("")}<div class="insight">${icon("info")}El peso fluctúa por muchas razones. Estos cambios son descriptivos, no recomendaciones de salud. Mídete en condiciones similares y prioriza cómo te sientes.</div></div></section>`;
  }

  function body() {
    const rows = sortedWeights().reverse();
    const latest = rows[0], first = rows.at(-1);
    return `<div class="stats-grid">${stat("Último peso", latest ? number(latest.value, 2) : "—", "kg", latest ? `Registrado el ${dateText(latest.date)}` : "Añade tu primer registro", "body")}${stat("Cambio semanal", weightTrend(7) ? trendText(weightTrend(7)).replace(" kg", "") : "—", "kg", "Entre registros de los últimos 7 días", "chart", "blue")}${stat("Cambio mensual", weightTrend(30) ? trendText(weightTrend(30)).replace(" kg", "") : "—", "kg", "Entre registros de los últimos 30 días", "calendar", "green")}${stat("Registros", rows.length, "mediciones", first ? `Desde el ${dateText(first.date)}` : "Una foto de tu evolución", "target", "orange")}</div>
      <div class="two-columns"><section class="panel">${panelHead("Tu evolución", "Los pequeños cambios dibujan una gran historia.", periodControls("weight"))}${weightChart()}</section>${trendPanel()}</div>
      <section class="panel section-gap">${panelHead("Historial de mediciones", "Un registro por día. Puedes editarlo cuando quieras.")}${rows.length ? `<div class="table-scroll section-gap"><table><thead><tr><th>FECHA</th><th>PESO</th><th>VS. REGISTRO ANTERIOR</th><th><span class="visually-hidden">Acciones</span></th></tr></thead><tbody>${rows.map((item, index) => {
        const difference = index < rows.length - 1 ? Math.round((item.value - rows[index + 1].value) * 100) / 100 : null;
        return `<tr><td>${dateText(item.date, { day: "numeric", month: "long", year: "numeric" })}</td><td><span class="table-title">${number(item.value, 2)} kg</span></td><td class="muted">${difference === null ? "Primer registro" : `${difference > 0 ? "+" : ""}${number(difference, 2)} kg`}</td><td>${editActions("weight", item.id)}</td></tr>`;
      }).join("")}</tbody></table></div>` : empty("body", "Tu historia empieza contigo", "Registra tu primera medición.", "open-weight", "Registrar peso")}</section>`;
  }

  function eventStatus(event) {
    if (event.completed) return badge("Completado", "green", "check");
    return new Date(event.datetime) < new Date() ? badge("Pendiente de completar", "orange", "clock") : badge("Próximo plan", "blue", "calendar");
  }

  function social() {
    let rows = state.events.filter((item) => eventFilter === "all" || (eventFilter === "completed" ? item.completed : !item.completed));
    rows.sort((a, b) => eventFilter === "completed" ? b.datetime.localeCompare(a.datetime) : a.datetime.localeCompare(b.datetime));
    return `<div class="toolbar" style="padding:0 0 22px"><h2>${state.events.filter((item) => !item.completed).length} planes por vivir <span class="muted">· ${state.events.filter((item) => item.completed).length} recuerdos compartidos</span></h2>${filterButtons("social", [["upcoming", "Pendientes"], ["completed", "Completados"], ["all", "Todos"]], eventFilter)}</div>
      ${rows.length ? `<div class="card-grid">${rows.map((event) => `<article class="panel event-card ${event.completed ? "completed" : ""}"><div class="card-top">${eventStatus(event)}${editActions("event", event.id)}</div><h2>${escape(event.title)}</h2><div class="event-meta"><span>${icon("calendar")}${dateTimeText(event.datetime)} · ${timeText(event.datetime)}</span><span>${icon("pin")}${escape(event.place)}</span>${event.friends ? `<span>${icon("users")}${escape(event.friends)}</span>` : ""}</div><p class="event-description">${escape(event.description || "Un buen plan no necesita mucho más que buena compañía.")}</p><div class="card-bottom">${friendsMarkup(event.friends)}<button class="button secondary small" data-action="toggle-event" data-id="${escape(event.id)}" ${!event.completed && new Date(event.datetime) > new Date() ? 'disabled title="Podrás completarlo cuando llegue su fecha y hora"' : ""}>${icon(event.completed ? "clock" : "check")}${event.completed ? "Reabrir plan" : "Completar"}</button></div></article>`).join("")}</div>` : `<section class="panel">${empty("users", "Los buenos momentos te esperan", "Aquí aparecerán los planes de este filtro.", "open-event", "Crear un plan")}</section>`}
      <div class="insight section-gap">${icon("info")}Los planes futuros se pueden completar cuando llegue su fecha y hora. Los planes pasados pendientes siguen visibles hasta que los completes o elimines.</div>`;
  }

  function goalCard(goal) {
    const value = goalProgress(goal), done = goalComplete(goal), expired = goalExpired(goal);
    const notStarted = goal.start > today();
    const status = done ? badge(goal.type === "water" ? "Objetivo de hoy cumplido" : "Reto cumplido", "green", "check") : expired ? badge("Plazo finalizado", "orange") : notStarted ? badge("Próximamente", "blue") : badge(goal.type === "water" ? "DIARIO" : "EN MARCHA");
    const locked = done || expired || notStarted;
    return `<article class="panel goal-card"><div class="card-top"><span class="goal-icon ${goalColor(goal)}">${icon(goalIcon(goal))}</span>${editActions("challenge", goal.id)}</div><h2>${escape(goal.title)}</h2><div>${status}</div><div class="goal-progress-number">${number(value, 2)} <small>/ ${number(goal.target, 2)} ${escape(goalUnit(goal))}${goal.type === "water" ? " hoy" : ""}</small></div>${progressBar(goal)}<div class="goal-subline"><span>${goalPercent(goal)}% completado</span><span>${goal.deadline ? `Hasta ${dateText(goal.deadline)}` : "Sin fecha límite"}</span></div><p>${goal.type === "gym" ? "Se actualiza con tus entrenamientos desde la fecha de inicio." : goal.type === "social" ? "Se actualiza al completar planes desde la fecha de inicio." : goal.type === "water" ? "Registra el agua de hoy. El contador se renueva cada día." : "Registra cada paso hacia tu objetivo."}</p><div class="card-bottom"><span>Desde ${dateText(goal.start)}</span>${goal.type === "manual" || goal.type === "water" ? `<div class="row-actions"><button class="icon-button" data-action="goal-minus" data-id="${escape(goal.id)}" aria-label="${goal.type === "water" ? "Restar 250 ml de hoy" : "Restar un paso"}" ${value <= 0 || expired || notStarted ? "disabled" : ""}>−</button><button class="button secondary small" data-action="goal-plus" data-id="${escape(goal.id)}" ${locked ? "disabled" : ""}>${icon(done ? "check" : "plus")}${goal.type === "water" ? "250 ml" : "1 paso"}</button></div>` : `<span class="goal-completed">${icon(done ? "check" : "pulse")}${done ? "¡Lo has conseguido!" : "Automático"}</span>`}</div></article>`;
  }

  function challenges() {
    const rows = state.challenges.filter((goal) => challengeFilter === "all" || (challengeFilter === "completed" ? goalComplete(goal) : !goalExpired(goal) && (goal.type === "water" || !goalComplete(goal))));
    return `<div class="toolbar" style="padding:0 0 22px"><h2>${activeGoals().length} retos activos <span class="muted">· ${completedGoals()} cumplidos${state.challenges.some((goal) => goal.type === "water") ? " (agua: hoy)" : ""}</span></h2>${filterButtons("challenges", [["active", "Activos"], ["completed", "Cumplidos"], ["all", "Todos"]], challengeFilter)}</div>${rows.length ? `<div class="card-grid">${rows.map(goalCard).join("")}</div>` : `<section class="panel">${empty("target", "Una nueva meta, una nueva motivación", "No hay retos en este filtro. Crea el próximo.", "open-challenge", "Crear reto")}</section>`}`;
  }

  function achievements() {
    const count = Object.keys(state.achievements).length;
    return `<div class="insight" style="margin-bottom:22px">${icon("trophy")}Has desbloqueado <strong>${count} de ${ACHIEVEMENTS.length} logros</strong>. Los logros ganados se conservan aunque edites o elimines registros después.</div><div class="card-grid">${ACHIEVEMENTS.map((item) => {
      const unlocked = state.achievements[item.id];
      const value = Math.min(item.value(state), item.target);
      return `<article class="panel achievement-card ${unlocked ? "" : "locked"}"><div class="achievement-medal">${icon(item.icon)}</div><h2>${item.title}</h2><p>${item.description}</p>${unlocked ? badge("Desbloqueado", "green", "check") + `<div class="progress-label" style="margin-top:12px">${new Date(unlocked).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</div>` : `${badge("Por desbloquear", "", "lock")}<div class="progress-track" role="progressbar" aria-label="${item.title}" aria-valuemin="0" aria-valuemax="${item.target}" aria-valuenow="${value}"><div class="progress-fill" style="width:${value / item.target * 100}%"></div></div><span class="progress-label">${value} / ${item.target} ${item.id === "streak" ? "días seguidos" : item.id === "challenge" ? "retos" : item.id === "social" ? "planes" : "entrenos"}</span>`}</article>`;
    }).join("")}</div>`;
  }

  function stats() {
    const weeks = weekData(chartWeeks);
    const completed = completedGoals();
    const percent = state.challenges.length ? Math.round(completed / state.challenges.length * 100) : 0;
    const workoutCount = weeks.reduce((sum, item) => sum + item.value, 0);
    return `<div class="stats-grid">${stat("Entrenos en el período", workoutCount, "sesiones", `Últimas ${chartWeeks} semanas · actual incluida`, "gym")}${stat("Media semanal", number(workoutCount / chartWeeks, 1), "sesiones", "La semana actual puede estar incompleta", "chart", "blue")}${stat("Objetivos cumplidos", percent, "%", `${completed} de ${state.challenges.length} · agua: hoy`, "target", "green")}${stat("Planes compartidos", state.events.filter((item) => item.completed).length, "planes", "Total de eventos completados", "users", "orange")}</div>
      <div class="two-columns"><section class="panel">${panelHead("Entrenamientos por semana", "Un hábito que se construye con el tiempo.", periodControls("weeks"))}${barChart()}</section><section class="panel">${panelHead("Cumplimiento de objetivos", "Progreso individual de todos tus retos.", badge(`${completed}/${state.challenges.length}`, "green"))}<div class="challenge-list">${state.challenges.length ? state.challenges.map(goalPreview).join("") : empty("target", "Aún no hay objetivos", "Crea un reto para ver tu progreso.", "open-challenge", "Crear reto")}</div></section></div>
      <div class="two-columns section-gap"><section class="panel">${panelHead("Peso corporal", "Tu evolución, con contexto.", periodControls("weight"))}${weightChart()}</section>${trendPanel()}</div>`;
  }

  function settings() {
    const count = state.workouts.length + state.weights.length + state.events.length + state.challenges.length;
    return `<div class="settings-grid"><section class="panel">${panelHead("Tus datos", `${count} registros en este navegador · formato local v1`)}<div class="panel-body">
      <div class="settings-row"><div><h3>Exportar una copia</h3><p>Descarga tus datos como JSON. Guárdalos para recuperar tu progreso en otro navegador.</p></div><button class="button secondary small" data-action="export">${icon("download")}Exportar</button></div>
      ${corruptRaw !== null ? `<div class="settings-row"><div><h3>Recuperar archivo original</h3><p>Descarga los datos que no se han podido leer antes de restablecerlos.</p></div><button class="button secondary small" data-action="export-raw">${icon("download")}Recuperar</button></div>` : ""}
      <div class="settings-row"><div><h3>Importar una copia</h3><p>Reemplaza los datos actuales con una copia compatible. Te pediremos confirmación.</p></div><button class="button secondary small" data-action="import">${icon("upload")}Importar</button></div>
      <div class="settings-row"><div><h3>Explorar con datos de ejemplo</h3><p>Vuelve a cargar entrenos, pesos, planes y retos de demostración. Sustituye los datos actuales.</p></div><button class="button secondary small" data-action="demo">${icon("spark")}Cargar demo</button></div>
      <div class="settings-row"><div><h3>Empezar desde cero</h3><p>Elimina todos los registros y logros de esta aplicación. Esta acción no se puede deshacer sin una copia.</p></div><button class="button danger small" data-action="reset">${icon("trash")}Borrar datos</button></div>
      </div></section><section class="panel"><div class="panel-body privacy-copy"><div class="privacy-icon">${icon("lock")}</div><h2>Tu vida no es un producto.</h2><p>Gym & Social Planner funciona completamente en tu dispositivo. No necesita cuentas, instalación, servidores ni conexión a Internet.</p><div class="privacy-item">${icon("check")}Sin seguimiento ni analítica externa</div><div class="privacy-item">${icon("check")}Sin librerías o recursos descargados</div><div class="privacy-item">${icon("check")}Datos guardados en LocalStorage</div><div class="privacy-item">${icon("moon")}Diseño oscuro, de día y de noche</div><div class="insight section-gap">Los datos pertenecen a este navegador y a esta ubicación del archivo. Si borras los datos del navegador, usas el modo privado o mueves la app, podrían no estar disponibles. Exporta copias periódicamente.<br><br>LocalStorage no está cifrado: evita guardar información sensible en dispositivos compartidos.</div></div></section></div>`;
  }

  function render() {
    dayAtRender = today();
    const config = VIEWS[view];
    $("#breadcrumb-current").textContent = config[0];
    $("#page-eyebrow").textContent = config[1];
    $("#page-title").innerHTML = `${config[2]}<span class="heading-dot">.</span>`;
    $("#page-description").textContent = config[3];
    $("#today-label").textContent = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
    $("#today-label").dateTime = today();
    $("#primary-action").hidden = !config[4];
    if (config[4]) {
      $("#primary-action").dataset.action = `open-${config[4]}`;
      $("#primary-action").innerHTML = `${icon("plus")}${config[5]}`;
    }
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item.dataset.view === view;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    });
    $("#achievement-count").textContent = Object.keys(state.achievements).length;
    $("#storage-alert").hidden = !storageProblem;
    $("#storage-alert").innerHTML = storageProblem ? `${escape(storageProblem)} <a href="#settings">Abrir ajustes</a>` : "";
    $("#content").innerHTML = ({ dashboard, gym, body, social, challenges, achievements, stats, settings })[view]();
    document.title = `${config[0]} · Gym & Social Planner`;
  }

  function route() {
    const hash = location.hash.slice(1);
    view = Object.hasOwn(VIEWS, hash) ? hash : "dashboard";
    render();
  }

  const field = (id, label, control, help = "") => `<div class="field"><label for="${id}">${label}</label>${control}${help ? `<p class="field-help">${help}</p>` : ""}</div>`;
  const input = (id, type, value, attributes = "") => `<input id="${id}" name="${id}" type="${type}" value="${escape(value ?? "")}" ${attributes}>`;

  function openEditor(kind, id = null) {
    const collection = { workout: "workouts", weight: "weights", event: "events", challenge: "challenges" }[kind];
    const item = id ? state[collection].find((record) => record.id === id) : null;
    if (id && !item) throw new Error("Este registro ya no existe. Actualiza la vista.");
    editor = { kind, id, collection };
    $("#dialog-title").textContent = `${item ? "Editar" : "Nuevo"} ${({ workout: "entrenamiento", weight: "registro de peso", event: "plan con amigos", challenge: "reto personal" })[kind]}`;
    $("#dialog-eyebrow").textContent = { workout: "CADA SESIÓN SUMA", weight: "TU EVOLUCIÓN, A TU RITMO", event: "HAZ SITIO PARA TU GENTE", challenge: "TU PRÓXIMA CONQUISTA" }[kind];
    $("#form-error").hidden = true;
    $("#save-button").textContent = item ? "Guardar cambios" : { workout: "Guardar entreno", weight: "Guardar peso", event: "Crear plan", challenge: "Crear reto" }[kind];
    const pastDate = `required min="1900-01-01" max="${today()}"`;
    let fields = "";
    if (kind === "workout") {
      fields = field("routine", "Tipo de rutina", `<select id="routine" name="routine" required>${ROUTINES.map((routine) => `<option value="${escape(routine)}" ${item?.routine === routine ? "selected" : ""}>${escape(routine)}</option>`).join("")}</select>`) +
        `<div class="field-row">${field("date", "Fecha", input("date", "date", item?.date || today(), pastDate))}${field("duration", "Duración <span>· minutos</span>", input("duration", "number", item?.duration ?? 60, 'required min="1" max="600" step="1"'))}</div>` +
        field("notes", "Notas <span>· opcional</span>", `<textarea id="notes" name="notes" maxlength="1000" placeholder="¿Cómo ha ido? ¿Algún nuevo récord?">${escape(item?.notes || "")}</textarea>`);
    } else if (kind === "weight") {
      fields = `<div class="field-row">${field("date", "Fecha", input("date", "date", item?.date || today(), pastDate))}${field("value", "Peso corporal <span>· kg</span>", input("value", "number", item?.value ?? "", 'required min="20" max="350" step="0.01" placeholder="74,5"'))}</div><div class="insight">Un registro por fecha. Si ya tienes una medición para ese día, edítala desde el historial.</div>`;
    } else if (kind === "event") {
      fields = field("title", "Nombre del plan", input("title", "text", item?.title, 'required maxlength="100" placeholder="Una cena, un café, una aventura…"')) +
        field("datetime", "Fecha y hora", input("datetime", "datetime-local", item?.datetime || `${shiftDate(today(), 1)}T18:00`, 'required min="1900-01-01T00:00" max="2100-12-31T23:59"')) +
        field("place", "Lugar", input("place", "text", item?.place, 'required maxlength="160" placeholder="¿Dónde quedamos?"')) +
        field("friends", "Amigos <span>· opcional</span>", input("friends", "text", item?.friends, 'maxlength="300" placeholder="Alex, Carla, Dani"'), "Separa los nombres con comas.") +
        field("description", "Descripción <span>· opcional</span>", `<textarea id="description" name="description" maxlength="1000" placeholder="Los detalles del plan…">${escape(item?.description || "")}</textarea>`);
    } else {
      fields = field("title", "Nombre de tu reto", input("title", "text", item?.title, 'required maxlength="100" placeholder="Algo que te motive de verdad…"')) +
        field("type", "Tipo de seguimiento", `<select id="type" name="type" ${item ? "disabled" : ""}><option value="gym" ${item?.type === "gym" ? "selected" : ""}>Gimnasio · automático</option><option value="social" ${item?.type === "social" ? "selected" : ""}>Planes completados · automático</option><option value="water" ${item?.type === "water" ? "selected" : ""}>Agua diaria · registro en litros</option><option value="manual" ${item?.type === "manual" ? "selected" : ""}>Personalizado · progreso manual</option></select>`, item ? "El tipo no se puede cambiar para conservar el historial." : "El gym y los planes se calculan a partir de tus registros.") +
        `<div class="field-row">${field("target", "Objetivo <span id=\"target-unit\">· entrenos</span>", input("target", "number", item?.target ?? 20, 'required min="1" max="10000" step="1"'))}${field("unit", "Unidad <span>· reto manual</span>", input("unit", "text", item?.unit, 'maxlength="40" placeholder="días, libros, sesiones…"'))}</div>` +
        `<div class="field-row">${field("start", "Fecha de inicio", input("start", "date", item?.start || today(), 'required min="1900-01-01" max="2100-12-31"'))}${field("deadline", "Fecha límite <span>· opcional</span>", input("deadline", "date", item?.deadline || "", 'min="1900-01-01" max="2100-12-31"'))}</div>` +
        `<div id="manual-progress-field">${field("progress", "Pasos ya completados", input("progress", "number", item?.progress ?? 0, 'min="0" max="10000" step="1" required'))}</div><div class="insight" id="goal-help"></div>`;
    }
    $("#form-fields").innerHTML = fields;
    if (kind === "challenge") syncGoalFields(!item);
    $("#editor-dialog").showModal();
  }

  function syncGoalFields(resetTarget = false) {
    const type = $("#type").value;
    const target = $("#target");
    $("#unit").disabled = type !== "manual";
    $("#unit").required = type === "manual";
    $("#manual-progress-field").hidden = type !== "manual";
    $("#progress").disabled = type !== "manual";
    target.step = type === "water" ? ".1" : "1";
    target.min = type === "water" ? ".1" : "1";
    target.max = type === "water" ? "10" : "10000";
    if (resetTarget) target.value = ({ gym: 20, social: 8, water: 2, manual: 5 })[type];
    $("#target-unit").textContent = `· ${{ gym: "entrenos", social: "planes", water: "litros al día", manual: "pasos" }[type]}`;
    $("#goal-help").textContent = {
      gym: "Cada entrenamiento entre el inicio y el plazo suma un paso. Incluye los registros que ya tengas en esas fechas.",
      social: "Cada evento completado dentro de las fechas del reto suma un paso.",
      water: "El objetivo es diario, no acumulado. Añade agua en pasos de 250 ml; puedes corregir con el botón −. El historial se conserva.",
      manual: "El progreso se actualiza desde la tarjeta del reto, con +1 y −1. Usa una unidad que puedas contar."
    }[type];
  }

  function saveForm(event) {
    event.preventDefault();
    const form = $("#editor-form");
    if (!form.reportValidity() || !editor) return;
    const values = new FormData(form);
    const get = (name) => String(values.get(name) || "").trim();
    const existing = editor.id ? state[editor.collection].find((item) => item.id === editor.id) : null;
    let record = { id: editor.id || uid() };
    try {
      if (editor.kind === "workout") {
        record = { ...record, date: get("date"), routine: get("routine"), duration: Number(get("duration")), notes: get("notes") };
      } else if (editor.kind === "weight") {
        const date = get("date");
        if (state.weights.some((item) => item.date === date && item.id !== editor.id)) throw new Error("Ya hay un peso registrado para esta fecha. Edita ese registro o elige otro día.");
        record = { ...record, date, value: Number(get("value")) };
      } else if (editor.kind === "event") {
        const datetime = get("datetime");
        if (existing?.completed && new Date(datetime) > new Date()) throw new Error("Reabre este plan antes de moverlo a una fecha futura.");
        record = { ...record, title: get("title"), datetime, place: get("place"), friends: get("friends"), description: get("description"), completed: existing?.completed || false };
      } else {
        const start = get("start"), deadline = get("deadline");
        if (deadline && deadline < start) throw new Error("La fecha límite debe ser igual o posterior al inicio.");
        const type = existing ? existing.type : get("type");
        if (existing?.type === "water" && Object.keys(existing.daily).some((date) => date < start || (deadline && date > deadline))) throw new Error("Estas fechas excluirían agua que ya has registrado. Elige un intervalo que conserve tu historial.");
        record = { ...record, title: get("title"), type, target: Number(get("target")), unit: type === "manual" ? get("unit") : "", start, deadline, progress: type === "manual" ? Number(get("progress")) : existing?.progress || 0, daily: existing?.daily || {} };
      }
      const kind = editor.kind;
      const collection = editor.collection;
      commit((data) => {
        if (existing) data[collection] = data[collection].map((item) => item.id === existing.id ? record : item);
        else data[collection].push(record);
      }, { workout: "Entrenamiento guardado. Cada sesión suma.", weight: "Peso guardado. Tu evolución, a tu ritmo.", event: "Plan guardado. Que vengan los buenos momentos.", challenge: "Reto guardado. A por ello." }[kind]);
      $("#editor-dialog").close();
    } catch (error) {
      $("#form-error").textContent = error.message;
      $("#form-error").hidden = false;
    }
  }

  function askConfirmation(title, description, label, callback) {
    confirmation = callback;
    $("#confirm-title").textContent = title;
    $("#confirm-description").textContent = description;
    $("#confirm-button").textContent = label;
    $("#confirm-dialog").showModal();
    $("#confirm-dialog").querySelector('[data-action="close-confirm"]').focus();
  }

  function download(data, filename, raw = false) {
    const url = URL.createObjectURL(new Blob([raw ? data : JSON.stringify(data, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function importFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("El archivo supera los 5 MB. Selecciona una copia más pequeña.");
      const imported = validateState(JSON.parse(await file.text()));
      const count = imported.workouts.length + imported.weights.length + imported.events.length + imported.challenges.length;
      askConfirmation("¿Restaurar esta copia?", `Se reemplazarán todos los datos actuales por ${count} registros del archivo «${file.name}». Exporta primero tu información si quieres conservarla.`, "Restaurar copia", () => {
        unlockAchievements(imported);
        persist(imported, true);
        render();
        toast("Copia importada. Tu espacio está listo.");
      });
    } catch (error) { toast(`No se pudo importar: ${error.message}`, "error"); }
  }

  function handleAction(button) {
    const { action, id, kind, value } = button.dataset;
    if (action.startsWith("open-")) { openEditor(action.slice(5)); return; }
    if (action === "edit") { openEditor(kind, id); return; }
    if (action === "delete") {
      const collection = { workout: "workouts", weight: "weights", event: "events", challenge: "challenges" }[kind];
      askConfirmation("¿Eliminar este registro?", "No podrás deshacerlo. El progreso automático de los retos se recalculará; los logros que ya hayas ganado se conservan.", "Eliminar", () => commit((data) => { data[collection] = data[collection].filter((item) => item.id !== id); }, "Registro eliminado."));
    } else if (action === "close-dialog") $("#editor-dialog").close();
    else if (action === "close-confirm") $("#confirm-dialog").close();
    else if (action === "filter") {
      if (kind === "gym") workoutFilter = value;
      if (kind === "social") eventFilter = value;
      if (kind === "challenges") challengeFilter = value;
      render();
    } else if (action === "period") {
      if (kind === "weeks") chartWeeks = Number(value); else weightPeriod = Number(value);
      render();
    } else if (action === "toggle-event") {
      const item = state.events.find((event) => event.id === id);
      if (!item) throw new Error("Este plan ya no existe.");
      if (!item.completed && new Date(item.datetime) > new Date()) throw new Error("Este plan todavía no ha empezado. Podrás completarlo cuando llegue su fecha y hora.");
      commit((data) => { const event = data.events.find((record) => record.id === id); event.completed = !event.completed; }, item.completed ? "Plan reabierto." : "Un buen recuerdo más. Plan completado.");
    } else if (action === "goal-plus" || action === "goal-minus") {
      const goal = state.challenges.find((item) => item.id === id);
      if (!goal || !["manual", "water"].includes(goal.type)) throw new Error("Este reto no permite progreso manual.");
      if (goalExpired(goal) || goal.start > today()) throw new Error("Solo puedes registrar progreso dentro del período del reto.");
      if (action === "goal-plus" && goalComplete(goal)) throw new Error("Ya has cumplido este objetivo.");
      const wasComplete = goalComplete(goal);
      commit((data) => {
        const item = data.challenges.find((record) => record.id === id);
        const delta = (action === "goal-plus" ? 1 : -1) * (goal.type === "water" ? .25 : 1);
        if (item.type === "water") item.daily[today()] = Math.round(Math.max(0, (item.daily[today()] || 0) + delta) * 100) / 100;
        else item.progress = Math.max(0, item.progress + delta);
      }, "");
      const updated = state.challenges.find((item) => item.id === id);
      toast(!wasComplete && goalComplete(updated) ? goal.type === "water" ? "¡Objetivo de agua de hoy cumplido!" : "¡Reto cumplido! Celebra tu progreso." : goal.type === "water" ? `Agua de hoy: ${number(goalProgress(updated), 2)} L.` : "Progreso actualizado.");
    } else if (action === "export") {
      download(state, `gym-social-${today()}.json`);
      toast("Copia exportada. Guárdala en un lugar seguro.");
    } else if (action === "export-raw") {
      if (corruptRaw === null) throw new Error("No hay un archivo original pendiente de recuperar.");
      download(corruptRaw, `gym-social-recuperacion-${today()}.json`, true);
    } else if (action === "import") $("#import-file").click();
    else if (action === "reset" || action === "demo") {
      const isDemo = action === "demo";
      askConfirmation(isDemo ? "¿Cargar la demostración?" : "¿Empezar desde cero?", "Se reemplazarán todos tus registros y logros. Exporta una copia antes si quieres conservar tu progreso.", isDemo ? "Cargar demo" : "Borrar todos los datos", () => {
        persist(isDemo ? demoState() : blankState(), true);
        workoutFilter = "all"; eventFilter = "upcoming"; challengeFilter = "active"; searchQuery = "";
        render();
        toast(isDemo ? "Datos de ejemplo cargados." : "Tu espacio está limpio. Todo empieza con un primer paso.");
      });
    }
  }

  function showChartDetail(event) {
    const target = event.target.closest("[data-chart-info]");
    if (!target) return;
    const detail = target.closest(".panel").querySelector(".chart-detail");
    if (detail) detail.textContent = target.dataset.chartInfo;
  }

  document.addEventListener("click", (event) => {
    showChartDetail(event);
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    try { handleAction(button); } catch (error) { toast(error.message, "error"); }
  });
  document.addEventListener("mouseover", showChartDetail);
  document.addEventListener("focusin", showChartDetail);
  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-chart-info]")) { event.preventDefault(); showChartDetail(event); }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "type") syncGoalFields(true);
  });
  document.addEventListener("input", (event) => {
    if (event.target.id !== "workout-search") return;
    searchQuery = event.target.value;
    const position = event.target.selectionStart;
    render();
    const search = $("#workout-search");
    search.focus();
    search.setSelectionRange(position, position);
  });
  $("#editor-form").addEventListener("submit", saveForm);
  $("#editor-dialog").addEventListener("close", () => { editor = null; });
  $("#confirm-dialog").addEventListener("close", () => { confirmation = null; });
  $("#confirm-button").addEventListener("click", () => {
    const callback = confirmation;
    try { if (callback) callback(); $("#confirm-dialog").close(); }
    catch (error) { $("#confirm-dialog").close(); toast(error.message, "error"); }
  });
  $("#import-file").addEventListener("change", importFile);
  window.addEventListener("hashchange", route);
  // A second tab must not overwrite changes made elsewhere in the same browser.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if ($("#editor-dialog").open) $("#editor-dialog").close();
    if ($("#confirm-dialog").open) $("#confirm-dialog").close();
    load();
    route();
    toast("Los datos han cambiado en otra ventana. La vista se ha actualizado.");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && today() !== dayAtRender) render();
  });
  setInterval(() => {
    // Daily water resets without discarding its history; future plans become completable.
    if (!document.hidden && !$("#editor-dialog").open && !$("#confirm-dialog").open && view !== "gym") render();
    else if (!document.hidden && today() !== dayAtRender && !$("#editor-dialog").open) render();
  }, 60000);

  load();
  route();
})();
