/**
 * Agente de Eventos Comunitarios — Lógica completa del chat, registro y calendario.
 * Lee 4 categorías de eventos + registros en tiempo real desde Google Sheets (CSV, costo cero tokens).
 * El registro de asistentes y la validación de morosos se resuelven contra Google Apps Script.
 */

// ⚠️ REEMPLAZA ESTOS LINKS ENTRE COMILLAS POR TUS ENLACES REALES DE GOOGLE SHEETS (CSV)
// Publica cada pestaña por separado: Archivo > Compartir > Publicar en la web > [pestaña] > CSV
const URL_DEPORTIVOS_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=1330295260&single=true&output=csv";
const URL_SOCIALES_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=1456759375&single=true&output=csv";
const URL_CULTURALES_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=433908363&single=true&output=csv";
const URL_IMPACTO_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=1748806311&single=true&output=csv";
const URL_REGISTROS_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=942672624&single=true&output=csv";

// ⚠️ COPIA AQUÍ EL LINK DE IMPLEMENTACIÓN DE TU GOOGLE APPS SCRIPT (APLICACIÓN WEB /EXEC)
// Se usa para: registrar asistentes (valida morosos + cupo), panel admin y chat con Gemini.
const URL_AGENTE_EVENTOS = "https://script.google.com/macros/s/AKfycbxwj8qMFP8E4c6Umd3Ei4MZRu2A4TnvApZghyWr7pDpmgSjGl9nnRBq7VzIujGs44PX/exec";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DIAS_SEMANA_CORTOS = ["D","L","M","M","J","V","S"];
const DIAS_SEMANA_LARGOS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

// ⚠️ AJUSTA esta lista con los valores exactos de tus áreas/amenidades — se usa
// como selector de "Ubicación" al crear un evento desde el Panel del Comité.
const UBICACIONES = [
  "Alberca / Jacuzzi P6",
  "Chapoteadero P6",
  "Salón Yoga P6",
  "Jardín P6",
  "Coffee Place PB",
  "Lobby PB",
  "Terraza P31",
  "Skylounge P31"
];

const DIAS_CHECKBOX = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const CATEGORIAS = {
  "Deportivos": { emoji: "🏀", colorClaro: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200", colorDia: "bg-emerald-50 border-emerald-200", labelSidebar: "EVENTOS DEPORTIVOS" },
  "Sociales":   { emoji: "🎉", colorClaro: "bg-purple-100 text-purple-700 hover:bg-purple-200", colorDia: "bg-purple-50 border-purple-200", labelSidebar: "EVENTOS SOCIALES" },
  "Culturales": { emoji: "🎭", colorClaro: "bg-amber-100 text-amber-700 hover:bg-amber-200", colorDia: "bg-amber-50 border-amber-200", labelSidebar: "EVENTOS CULTURALES" },
  "Impacto":    { emoji: "🌱", colorClaro: "bg-sky-100 text-sky-700 hover:bg-sky-200", colorDia: "bg-sky-50 border-sky-200", labelSidebar: "IMPACTO COMUNITARIO" }
};

let DATA = {
  edificio: { nombre: "Uplace", departamentos: 208 },
  Deportivos: [],
  Sociales: [],
  Culturales: [],
  Impacto: [],
  registros: [],
  cuposLive: {} // { eventoId: confirmados } leído directo del backend, sin caché de CSV publicado
};

// Estado de la conversación de registro en curso (flujo 100% en el chat)
let registroEnCurso = null; // { eventoId, categoria, nombreEvento, fechaSesion, esRecurrente, paso: 'depto'|'nombre'|'dias', depto, nombreAsistente }
let consultaEnCurso = null; // { tipo: 'consultar'|'cancelar', nombreFiltro, paso: 'depto' }

// Se recuerdan mientras dure la pestaña abierta (viven en memoria, no en localStorage/
// sessionStorage) para no repetir depto/nombre en cada flujo — se pierden con un refresh.
let deptoRecordado = null;
let nombreRecordado = null;

const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sidebar = document.getElementById("sidebar");
const edificioSummary = document.getElementById("edificioSummary");
const openSidebarBtn = document.getElementById("openSidebarBtn");
const closeSidebarBtn = document.getElementById("closeSidebarBtn");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function abrirSidebar() {
  if (sidebar) sidebar.classList.remove("-translate-x-full");
  if (sidebarOverlay) sidebarOverlay.classList.remove("hidden");
}
function cerrarSidebar() {
  if (sidebar) sidebar.classList.add("-translate-x-full");
  if (sidebarOverlay) sidebarOverlay.classList.add("hidden");
}
if (openSidebarBtn) openSidebarBtn.addEventListener("click", abrirSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", cerrarSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener("click", cerrarSidebar);

// ---------- Render de mensajes en el DOM ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Parser CSV robusto (máquina de estados, carácter por carácter). El anterior
// partía el texto por saltos de línea ANTES de fijarse si estaban dentro de
// comillas — así que cualquier descripción con salto de línea embebido (ej.
// "Estos son los paquetes:\nClase Suelta...\nBOX - Cada Martes...") se cortaba
// a la mitad, generando "filas" fantasma con columnas corridas (por eso salía
// "Zumba" como si fuera un evento aparte: era un fragmento de la descripción
// larga de "Clases Grupales Deportivas" mal cortado). Este parser sí entiende
// comillas con comas/saltos de línea adentro, y comillas escapadas ("").
function parseCSVCompleto(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let dentroComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else { dentroComillas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      dentroComillas = true;
    } else if (c === ",") {
      fila.push(campo); campo = "";
    } else if (c === "\r") {
      // se ignora; el salto real de fila lo maneja el \n
    } else if (c === "\n") {
      fila.push(campo); campo = "";
      filas.push(fila); fila = [];
    } else {
      campo += c;
    }
  }
  if (campo.length > 0 || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

function csvAObjetos(textoCsv) {
  const filas = parseCSVCompleto(textoCsv).filter(f => f.some(v => String(v).trim() !== ""));
  if (filas.length <= 1) return [];
  const cabeceras = filas[0].map(c => String(c).trim().toLowerCase());
  const resultados = [];
  for (let i = 1; i < filas.length; i++) {
    const obj = {};
    cabeceras.forEach((cab, index) => {
      obj[cab] = filas[i][index] !== undefined ? String(filas[i][index]).trim() : "";
    });
    resultados.push(obj);
  }
  return resultados;
}

function formatearContenido(texto) {
  let safe = escapeHtml(texto);
  safe = safe.replace(/\*(.+?)\*/g, "<strong>$1</strong>");
  return safe.replace(/\n/g, "<br>");
}

function addMessage(texto, sender = "bot") {
  const wrapper = document.createElement("div");
  wrapper.className = `msg-enter flex ${sender === "user" ? "justify-end" : "justify-start"} mb-4`;
  const bubble = document.createElement("div");
  const baseClasses = "max-w-[90%] md:max-w-full whitespace-pre-wrap text-sm leading-relaxed rounded-2xl px-4 py-3 shadow-sm";
  if (sender === "user") {
    bubble.className = `${baseClasses} bg-blue-600 text-white rounded-tr-none`;
    bubble.innerHTML = formatearContenido(texto);
  } else {
    bubble.className = `${baseClasses} bg-white text-gray-800 border border-gray-100 rounded-tl-none`;
    if (texto.includes("<button")) {
      bubble.innerHTML = texto.replace(/\n/g, "<br>").replace(/\*(.+?)\*/g, "<strong>$1</strong>");
    } else {
      bubble.innerHTML = formatearContenido(texto);
    }
  }
  wrapper.appendChild(bubble);
  if (messagesEl) {
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  return wrapper;
}

// ---------- Utilidades de fecha ----------
function parseFechaLocal(fechaStr) {
  if (!fechaStr || typeof fechaStr !== "string") return new Date(NaN);
  let limpia = fechaStr.trim().replace(/\r/g, "");
  let y, m, d, partes;
  if (limpia.indexOf("/") !== -1) {
    partes = limpia.split("/");
    d = Number(partes[0]); m = Number(partes[1]); y = Number(partes[2]);
  } else {
    partes = limpia.split("-");
    y = Number(partes[0]); m = Number(partes[1]); d = Number(partes[2]);
  }
  // Si el año viene en 2 dígitos (ej. Sheets exportó "31/08/26" al CSV porque la celda
  // es una fecha nativa, no texto), JS interpretaría 26 como 1926. Lo corregimos a 2026.
  if (y < 100) y += 2000;
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}
function formatearFecha(fecha) {
  const dd = String(fecha.getDate()).padStart(2, "0");
  return `${dd}/${MESES[fecha.getMonth()]}/${fecha.getFullYear()}`;
}
function fechaISO(fecha) {
  const y = fecha.getFullYear(), m = String(fecha.getMonth() + 1).padStart(2, "0"), d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function hoyMedianoche() {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate(), 12, 0, 0);
}
function inicioSemana(fechaBase) {
  const f = new Date(fechaBase);
  const diaSemana = f.getDay(); // 0=domingo
  const offsetLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  f.setDate(f.getDate() + offsetLunes);
  return new Date(f.getFullYear(), f.getMonth(), f.getDate(), 12, 0, 0);
}

// ---------- Cupo ----------
function contarConfirmados(eventoId, fechaSesion) {
  const idNorm = String(eventoId).trim();
  const fechaNorm = String(fechaSesion).trim();
  const key = `${idNorm}|${fechaNorm}`;
  // Prioriza el cupo leído en vivo del backend (sin el retraso de caché del CSV publicado).
  if (DATA.cuposLive && Object.prototype.hasOwnProperty.call(DATA.cuposLive, key)) {
    return DATA.cuposLive[key];
  }
  return DATA.registros.filter(r =>
    String(r.eventoid || "").trim() === idNorm &&
    String(r.fechasesion || "").trim() === fechaNorm &&
    String(r.estado || "").trim().toLowerCase() === "confirmado"
  ).length;
}

// Cupo de UNA sesión específica (fechaSesion en formato YYYY-MM-DD). Para eventos
// de un solo día, fechaSesion normalmente es evento.fecha.
function cupoInfo(evento, fechaSesion) {
  const fecha = fechaSesion || evento.fecha;
  const cupoRaw = (evento.cupototal || "").toString().trim().toLowerCase();
  const sinLimite = cupoRaw === "" || cupoRaw === "sin límite" || cupoRaw === "sin limite";
  const confirmados = contarConfirmados(evento.eventoid, fecha);

  if (sinLimite) {
    return {
      confirmados,
      total: null,
      disponibles: null,
      lleno: false,
      sinLimite: true,
      fecha,
      texto: `Sin límite (${confirmados} registrado${confirmados !== 1 ? "s" : ""})`
    };
  }

  const total = Number(evento.cupototal) || 0;
  const disponibles = Math.max(total - confirmados, 0);
  const lleno = confirmados >= total;
  const texto = lleno ? "Cupo Lleno" : `Cupo: ${confirmados}/${total}`;
  return { confirmados, total, disponibles, lleno, sinLimite: false, fecha, texto };
}

// Cupo de las próximas N sesiones de un evento (para mostrarlo quiando no hay una
// fecha de sesión específica en contexto, ej. la tarjeta genérica del sidebar).
function proximasSesionesInfo(evento, cantidad) {
  if (!esRecurrente(evento)) {
    return [cupoInfo(evento, evento.fecha)];
  }
  const hoy = hoyMedianoche();
  const finSerie = evento.fechafin ? parseFechaLocal(evento.fechafin) : hoy;
  const ocurrencias = generarOcurrenciasEnRango(evento, hoy, finSerie).slice(0, cantidad);
  return ocurrencias.map(fecha => cupoInfo(evento, fechaISO(fecha)));
}

// ---------- Carga de datos e Interfaz Lateral Dinámica ----------
async function cargarCsv(url) {
  try {
    const separador = url.includes("?") ? "&" : "?";
    const urlSinCache = `${url}${separador}_ts=${Date.now()}`;
    const res = await fetch(urlSinCache, { cache: "no-store" });
    const texto = await res.text();
    return csvAObjetos(texto);
  } catch (e) {
    console.log("No se pudo cargar CSV:", url, e);
    return [];
  }
}

async function inicializar() {
  try {
    const [deportivos, sociales, culturales, impacto, registros] = await Promise.all([
      cargarCsv(URL_DEPORTIVOS_CSV),
      cargarCsv(URL_SOCIALES_CSV),
      cargarCsv(URL_CULTURALES_CSV),
      cargarCsv(URL_IMPACTO_CSV),
      cargarCsv(URL_REGISTROS_CSV)
    ]);

    DATA.Deportivos = normalizarEventos(deportivos, "Deportivos");
    DATA.Sociales = normalizarEventos(sociales, "Sociales");
    DATA.Culturales = normalizarEventos(culturales, "Culturales");
    DATA.Impacto = normalizarEventos(impacto, "Impacto");
    DATA.registros = registros.map(r => ({
      eventoid: r["eventoid"] || r["EventoID"] || "",
      fechasesion: r["fechasesion"] || r["FechaSesion"] || "",
      categoria: r["categoria"] || "",
      depto: r["depto"] || "",
      nombre: r["nombre"] || "",
      estado: r["estado"] || ""
    }));

    if (edificioSummary) {
      const totalActivos = ["Deportivos", "Sociales", "Culturales", "Impacto"]
        .reduce((acc, cat) => acc + DATA[cat].filter(e => e.estado.toLowerCase() === "activo").length, 0);
      edificioSummary.textContent = `${totalActivos} eventos activos · ${DATA.edificio.departamentos} deptos`;
    }

    const quickActionBtns = document.querySelectorAll(".quick-action");
    quickActionBtns.forEach(btn => {
      const query = btn.getAttribute("data-query");
      if (query) {
        btn.onclick = (e) => { e.preventDefault(); window.handleQuickAction(query); };
      }
    });

    renderSidebarEventos();
    refrescarCuposLive();

    if (messagesEl && messagesEl.children.length === 0) {
      addMessage(`👋 *¡Hola! Bienvenido a Eventos Comunitarios de Uplace.*\n\nSoy tu *Agente de Eventos*. Aquí puedes:\n\n🎈 Ver los eventos de *hoy* o de la *semana*\n🔍 Preguntar por un evento específico (ej. "¿qué días y horario tiene Zumba?")\n✅ *Registrarte* directamente desde el chat\n📋 Consultar *tus registros* actuales\n🗑️ *Cancelar* un registro\n\n📂 También puedes explorar el menú de la izquierda por categoría para ver el detalle completo de cualquier evento, o preguntar directamente en el chat (ej. "¿que deportes hay?", "alguna actividad social?, o directamente "deportes", "social") \n\nElige una opción o escríbeme lo que necesites:`, "bot");
      addMessage(mensajeBotonesBienvenida(), "bot");
    }
  } catch (error) {
    console.error("Error cargando los datos desde Google Sheets:", error);
  }
}

// Refresca SOLO el cupo (llamada liviana y frecuente al backend, sin pasar por el
// caché del CSV publicado de Google). Repinta el sidebar con datos reales.
async function refrescarCuposLive() {
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=obtener_cupos&_ts=${Date.now()}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      DATA.cuposLive = data.cupos || {};
      renderSidebarEventos();
    }
  } catch (e) {
    console.log("No se pudo refrescar el cupo en vivo:", e);
  }
}

// Reconstruye SOLO los acordeones del sidebar (badges de cupo) sin recargar todo ni
// reescribir el mensaje de bienvenida. Se usa tras un registro para reflejar el cupo
// nuevo de inmediato, sin esperar el refresco automático cada 60s.
function renderSidebarEventos() {
  const scrollContainer = document.getElementById("deportivosList")?.parentNode?.parentNode;
  if (!scrollContainer) return;
  scrollContainer.innerHTML = "";
  Object.keys(CATEGORIAS).forEach(categoria => {
    const cfg = CATEGORIAS[categoria];
    const idLista = `${categoria.toLowerCase()}Accordion`;
    const div = crearSeccionMenu(cfg.labelSidebar, idLista);
    scrollContainer.appendChild(div);
    const eventosActivos = DATA[categoria].filter(e => e.estado.toLowerCase() === "activo");
    inyectarSubmenuEventos(idLista, eventosActivos, categoria, cfg.emoji);
  });
}

function normalizarTexto(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizarEventos(lista, categoria) {
  return lista.map(ev => ({
    eventoid: ev["eventoid"] || ev["EventoID"] || "",
    nombre: ev["nombre"] || "",
    descripcion: ev["descripcion"] || "",
    fecha: ev["fecha"] || "",
    horainicio: ev["horainicio"] || "",
    horafin: ev["horafin"] || "",
    ubicacion: ev["ubicacion"] || "",
    cupototal: ev["cupototal"] || "0",
    estado: ev["estado"] || "Activo",
    tienecosto: String(ev["tienecosto"] || "").trim().toLowerCase() === "si",
    diasemana: String(ev["diassemana"] || "").split(",").map(d => d.trim()).filter(d => d),
    fechafin: ev["fechafin"] || "",
    categoria
  })).filter(ev => ev.eventoid && ev.fecha);
}

// ---------- Recurrencia semanal (clases tipo Zumba Lun/Mié/Sáb) ----------
function esRecurrente(evento) {
  return evento.diasemana && evento.diasemana.length > 0;
}

// ¿El evento tiene una sesión programada en esta fecha exacta?
function esOcurrenciaEnFecha(evento, fechaDate) {
  if (!esRecurrente(evento)) {
    return evento.fecha === fechaISO(fechaDate);
  }
  const inicio = parseFechaLocal(evento.fecha);
  const fin = evento.fechafin ? parseFechaLocal(evento.fechafin) : null;
  if (isNaN(inicio.getTime())) return false;
  if (fechaDate < inicio) return false;
  if (fin && fechaDate > fin) return false;
  const nombreDia = normalizarTexto(DIAS_SEMANA_LARGOS[fechaDate.getDay()]);
  return evento.diasemana.some(d => normalizarTexto(d) === nombreDia);
}

// Devuelve todas las fechas (Date) en que el evento tiene sesión dentro de [rangoInicio, rangoFin]
function generarOcurrenciasEnRango(evento, rangoInicio, rangoFin) {
  if (!esRecurrente(evento)) {
    const fecha = parseFechaLocal(evento.fecha);
    if (isNaN(fecha.getTime())) return [];
    if (fecha >= rangoInicio && fecha <= rangoFin) return [fecha];
    return [];
  }
  const inicio = parseFechaLocal(evento.fecha);
  const finSerie = evento.fechafin ? parseFechaLocal(evento.fechafin) : rangoFin;
  const desde = inicio > rangoInicio ? inicio : rangoInicio;
  const hasta = finSerie < rangoFin ? finSerie : rangoFin;
  if (isNaN(inicio.getTime()) || desde > hasta) return [];

  const diasNormalizados = evento.diasemana.map(normalizarTexto);
  const ocurrencias = [];
  const cursor = new Date(desde);
  while (cursor <= hasta) {
    const nombreDia = normalizarTexto(DIAS_SEMANA_LARGOS[cursor.getDay()]);
    if (diasNormalizados.includes(nombreDia)) ocurrencias.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return ocurrencias;
}

// Ocurrencias de un evento recurrente dentro del mes calendario en curso (a partir de
// hoy), respetando FechaFin si es antes de que termine el mes.
function ocurrenciasDelMesActual(evento) {
  const hoy = hoyMedianoche();
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 12, 0, 0);
  const finSerie = evento.fechafin ? parseFechaLocal(evento.fechafin) : finMes;
  const limite = finSerie < finMes ? finSerie : finMes;
  return generarOcurrenciasEnRango(evento, hoy, limite);
}

function recurrenciaTexto(evento) {
  if (!esRecurrente(evento)) return null;
  const dias = evento.diasemana.join(", ");
  const fin = evento.fechafin ? formatearFecha(parseFechaLocal(evento.fechafin)) : "sin fecha fin definida";
  return `🔁 Se repite: ${dias} · hasta ${fin}`;
}

function crearSeccionMenu(titulo, idLista) {
  const container = document.createElement("div");
  container.className = "mb-4 border border-slate-100 rounded-xl bg-slate-50/50";
  container.innerHTML = `
    <button type="button" class="w-full flex items-center justify-between px-3 py-3 text-left font-bold text-xs uppercase tracking-wider text-slate-500 hover:bg-slate-100/80 rounded-t-xl transition"
            onclick="document.getElementById('${idLista}').classList.toggle('hidden')">
      <span>${titulo}</span>
      <span class="text-[10px] text-slate-400">▼</span>
    </button>
    <div id="${idLista}" class="hidden p-2 space-y-1 bg-white border-t border-slate-100 rounded-b-xl"></div>
  `;
  return container;
}

// Resumen de cupo para la tarjeta del sidebar de un evento recurrente: usa la
// PRÓXIMA sesión del mes con lugar disponible (no "Recurrente" a secas). Si
// todas las sesiones restantes del mes están llenas, se marca como lleno.
function infoCupoResumenRecurrente(evento) {
  const ocurrencias = ocurrenciasDelMesActual(evento);
  if (!ocurrencias.length) return { lleno: true, texto: "Sin sesiones este mes" };
  for (let i = 0; i < ocurrencias.length; i++) {
    const info = cupoInfo(evento, fechaISO(ocurrencias[i]));
    if (!info.lleno) return { lleno: false, texto: info.sinLimite ? info.texto : `${info.texto} (próx. sesión)` };
  }
  return { lleno: true, texto: "Cupo Lleno" };
}


function inyectarSubmenuEventos(idContenedor, eventos, categoria, emoji) {
  const contenedor = document.getElementById(idContenedor);
  if (!contenedor) return;
  if (!eventos.length) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400 px-2 py-1";
    p.textContent = "Sin eventos activos por ahora.";
    contenedor.appendChild(p);
    return;
  }
  eventos.forEach(evento => {
    const recurrente = esRecurrente(evento);
    const badgeTexto = recurrente ? infoCupoResumenRecurrente(evento).texto : cupoInfo(evento, evento.fecha).texto;
    const badgeLleno = recurrente ? infoCupoResumenRecurrente(evento).lleno : cupoInfo(evento, evento.fecha).lleno;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group relative w-full text-left px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition flex items-center justify-between gap-2 font-medium border-l-2 border-transparent hover:border-brand-500";
    btn.innerHTML = `<span class="truncate">${emoji} ${escapeHtml(evento.nombre)}</span><span class="text-[10px] font-bold ${badgeLleno ? 'text-red-500' : 'text-emerald-600'} shrink-0">${badgeTexto}</span>
      <span class="pointer-events-none absolute left-1 right-1 bottom-[calc(100%+6px)] z-50 hidden group-hover:flex justify-center">
        <span class="relative max-w-[240px] bg-slate-900 text-white text-[11px] font-semibold leading-snug text-center rounded-lg px-2.5 py-1.5 shadow-lg whitespace-normal break-words">
          ${escapeHtml(evento.nombre)}
          <span class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></span>
        </span>
      </span>`;
    btn.title = evento.nombre;
    btn.onclick = () => mostrarTarjetaEventoEnChat(evento);
    contenedor.appendChild(btn);
  });
}

function horarioTexto(evento) {
  if (!evento.horainicio && !evento.horafin) return "Por confirmar";
  return `${evento.horainicio || "N/A"} - ${evento.horafin || "N/A"}`;
}

// ---------- Tarjetas de evento (formato chat) ----------
function tarjetaEventoTexto(evento, incluirBoton = true, fechaSesion = null) {
  const cfg = CATEGORIAS[evento.categoria];
  const fecha = evento.fecha ? formatearFecha(parseFechaLocal(evento.fecha)) : "Sin fecha";
  const recurrente = esRecurrente(evento);

  let lineas = [
    `${cfg ? cfg.emoji : "🎟️"} *${evento.nombre}*`,
    `📁 Categoría: ${evento.categoria}`,
  ];

  if (!recurrente || fechaSesion) {
    // Evento de un solo día, o una sesión puntual ya elegida (ej. desde el calendario)
    const fechaMostrar = fechaSesion ? formatearFecha(parseFechaLocal(fechaSesion)) : fecha;
    const info = cupoInfo(evento, fechaSesion || evento.fecha);
    const badgeCupo = info.sinLimite
      ? `🟢 *${info.texto}*`
      : (info.lleno ? "🔴 *Cupo Lleno*" : `🟢 *${info.texto}* (${info.disponibles} disponible${info.disponibles !== 1 ? "s" : ""})`);
    lineas.push(`📅 Fecha: ${fechaMostrar}`);
    lineas.push(`🕐 Horario: ${horarioTexto(evento)}`);
    lineas.push(`📍 Lugar: ${evento.ubicacion || "N/A"}`);
    lineas.push(`👥 Cupo: ${badgeCupo}`);
  } else {
    // Evento recurrente sin sesión puntual: se muestra un resumen de próximas sesiones
    lineas.push(`🕐 Horario: ${horarioTexto(evento)}`);
    lineas.push(`📍 Lugar: ${evento.ubicacion || "N/A"}`);
    const proximas = proximasSesionesInfo(evento, 4);
    if (proximas.length) {
      lineas.push(`👥 *Próximas sesiones y su cupo:*`);
      proximas.forEach(info => {
        const nombreDia = DIAS_SEMANA_LARGOS[parseFechaLocal(info.fecha).getDay()];
        const badge = info.sinLimite ? "🟢" : (info.lleno ? "🔴" : "🟢");
        lineas.push(`   ${badge} ${nombreDia.slice(0, 3)} ${formatearFecha(parseFechaLocal(info.fecha))} — ${info.texto}`);
      });
    } else {
      lineas.push(`👥 No hay sesiones futuras dentro del rango de esta serie.`);
    }
  }

  if (evento.tienecosto) lineas.push(`💰 *Este evento tiene costo* (consulta el monto con el Comité)`);
  const recTexto = recurrenciaTexto(evento);
  if (recTexto) lineas.push(recTexto);
  if (evento.descripcion) lineas.push(`📝 ${evento.descripcion}`);

  let texto = lineas.join("\n");
  if (incluirBoton) {
    // La selección de fecha/sesión (para eventos recurrentes) ahora vive DENTRO
    // del modal "Registrarme a Evento" (checkboxes por fecha + "todas"), no aquí
    // en la tarjeta del chat — un solo botón abre el modal ya con el evento
    // preseleccionado, con o sin sesión puntual.
    const bloqueadoDelTodo = recurrente
      ? ocurrenciasDelMesActual(evento).length > 0 && ocurrenciasDelMesActual(evento).every(f => cupoInfo(evento, fechaISO(f)).lleno)
      : cupoInfo(evento, fechaSesion || evento.fecha).lleno;
    if (bloqueadoDelTodo) {
      texto += `\n<button disabled class="mt-2 block text-[11px] font-bold text-slate-400 bg-slate-100 rounded-lg px-3 py-1.5 cursor-not-allowed">Cupo lleno</button>`;
    } else {
      const fechaArg = fechaSesion ? `, '${fechaSesion}'` : "";
      texto += `\n<button onclick="window.iniciarRegistro('${evento.eventoid}','${evento.categoria}', '${escapeHtml(evento.nombre).replace(/'/g, "\\'")}'${fechaArg})" class="mt-2 block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">✅ Registrarme</button>`;
    }
  }
  return texto;
}

// Compatibilidad hacia atrás por si algún mensaje viejo en el historial del
// chat todavía referencia el selector embebido (ya no se genera en tarjetas
// nuevas — ver tarjetaEventoTexto). Simplemente delega en iniciarRegistro.
window.iniciarRegistroDesdeTarjeta = function(chkGrupo, eventoId, categoria, nombreEvento) {
  window.iniciarRegistro(eventoId, categoria, nombreEvento, null);
};

function mostrarTarjetaEventoEnChat(evento) {
  addMessage(tarjetaEventoTexto(evento), "bot");
}

function buscarEventoPorId(eventoId, categoria) {
  return (DATA[categoria] || []).find(e => e.eventoid === eventoId);
}

function todosLosEventos() {
  return [...DATA.Deportivos, ...DATA.Sociales, ...DATA.Culturales, ...DATA.Impacto];
}

// ---------- Generadores de respuestas ----------
function respuestaEventosHoy() {
  const hoy = hoyMedianoche();
  const hoyStr = fechaISO(hoy);
  const eventos = todosLosEventos().filter(e => e.estado.toLowerCase() === "activo" && esOcurrenciaEnFecha(e, hoy));
  if (!eventos.length) return "🕊️ No hay eventos comunitarios programados para hoy." + tipSiguientePaso();
  let reporte = "🎈 *EVENTOS DE HOY*\n\n";
  eventos.forEach(ev => { reporte += tarjetaEventoTexto(ev, true, esRecurrente(ev) ? hoyStr : null) + "\n\n"; });
  return reporte + tipSiguientePaso();
}

function respuestaPorCategoria(categoria) {
  const cfg = CATEGORIAS[categoria];
  const eventos = (DATA[categoria] || []).filter(e => e.estado.toLowerCase() === "activo")
    .sort((a, b) => parseFechaLocal(a.fecha) - parseFechaLocal(b.fecha));
  if (!eventos.length) return `${cfg ? cfg.emoji : ""} No hay eventos activos en ${cfg ? cfg.labelSidebar.toLowerCase() : categoria} por ahora.` + tipSiguientePaso();
  let reporte = `${cfg ? cfg.emoji : ""} *${cfg ? cfg.labelSidebar : categoria.toUpperCase()}*\n\n`;
  eventos.forEach(ev => { reporte += tarjetaEventoTexto(ev) + "\n\n"; });
  return reporte.trim() + tipSiguientePaso();
}

// Detecta si el mensaje pregunta por una categoría completa (ej. "eventos sociales",
// "qué hay en deportivos", "impacto comunitario") y regresa la clave de CATEGORIAS o null.
function detectarCategoriaEnTexto(texto) {
  const n = normalizarTexto(texto);
  // "deportiv" no cubría "deporte"/"deportes" (sin el sufijo "-ivo"); "cultural" no
  // cubría "cultura" (sin la "l" final) — por eso preguntas normales como "qué hay
  // en deportes" o "eventos de cultura" caían en la IA en vez de responderse local.
  if (/deport/.test(n)) return "Deportivos";
  if (/social|sociabiliz|socializ/.test(n)) return "Sociales";
  if (/cultur|\bculto\b|\bcultos\b/.test(n)) return "Culturales";
  if (/impacto|comunitari|donaci|\bdonar\b|donativ|donando/.test(n)) return "Impacto";
  return null;
}

function respuestaAgendaSemanal() {
  const lunes = inicioSemana(new Date());
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const f = new Date(lunes);
    f.setDate(lunes.getDate() + i);
    dias.push(f);
  }
  const eventosActivos = todosLosEventos().filter(e => e.estado.toLowerCase() === "activo");

  let reporte = "📅 *EVENTOS DE LA SEMANA*\n\n";
  dias.forEach(f => {
    const nombreDia = DIAS_SEMANA_LARGOS[f.getDay()];
    const eventosDia = eventosActivos.filter(e => esOcurrenciaEnFecha(e, f));
    reporte += `*🔹 ${nombreDia.toUpperCase()} (${formatearFecha(f)})*\n`;
    if (!eventosDia.length) {
      reporte += "🕊️ Sin eventos programados.\n\n";
    } else {
      eventosDia.forEach(ev => {
        const info = cupoInfo(ev, fechaISO(f));
        const cfg = CATEGORIAS[ev.categoria];
        const costoTag = ev.tienecosto ? " · 💰 con costo" : "";
        const recurrenteTag = esRecurrente(ev) ? " 🔁" : "";
        reporte += `${cfg ? cfg.emoji : "🎟️"} *${ev.nombre}*${recurrenteTag} — ${horarioTexto(ev)} @ ${ev.ubicacion || "N/A"}${costoTag} — ${info.lleno ? "🔴 " : "🟢 "}${info.texto}\n`;
        reporte += `<button onclick="window.iniciarRegistro('${ev.eventoid}','${ev.categoria}', '${escapeHtml(ev.nombre).replace(/'/g, "\\'")}', '${fechaISO(f)}')" ${info.lleno ? "disabled" : ""} class="mt-0.5 mb-1.5 inline-block text-[11px] font-bold ${info.lleno ? 'text-slate-400 bg-slate-100 cursor-not-allowed' : 'text-brand-600 bg-brand-50 hover:bg-brand-100'} rounded-lg px-2 py-1 transition">${info.lleno ? "Cupo lleno" : "✅ Registrarme"}</button>\n`;
      });
      reporte += "\n";
    }
  });
  return reporte + tipSiguientePaso();
}

// Palabras demasiado comunes en preguntas de residentes como para servir de pista real
// (si las dejáramos, "cupo en zumba" y "cupo en yoga" competirían por la palabra "cupo")
const PALABRAS_IGNORAR_BUSQUEDA = [
  "el", "la", "los", "las", "de", "del", "en", "hay", "sitio", "cupo", "cupos",
  "para", "con", "por", "un", "una", "unos", "unas", "info", "informacion",
  "quiero", "tengo", "ya", "me", "mi", "que", "como", "cuando", "donde",
  "es", "esta", "estan", "hoy", "lugares", "lugar", "disponible", "disponibles",
  "reserva", "registrado", "registro", "todavia", "aun", "queda", "quedan"
];

function buscarEventoPorNombreParcial(consulta) {
  const q = normalizarTexto(consulta);
  const palabrasQuery = q.split(/\s+/).filter(w => w.length >= 3 && !PALABRAS_IGNORAR_BUSQUEDA.includes(w));
  if (!palabrasQuery.length) return [];

  return todosLosEventos().filter(ev => {
    if (!ev.nombre) return false;
    const nombreNorm = normalizarTexto(ev.nombre);
    // Coincidencia directa de frase completa en cualquier dirección (ej. el nombre exacto)
    if (q.includes(nombreNorm) || nombreNorm.includes(q)) return true;
    // Coincidencia por al menos una palabra clave compartida (ej. "zumba" dentro de "Clases de Zumba")
    const palabrasNombre = nombreNorm.split(/\s+/).filter(w => w.length >= 3);
    return palabrasQuery.some(pw => palabrasNombre.includes(pw));
  });
}

// Palabras que indican que el residente quiere DATOS operativos del evento (cupo,
// horario, lugar, registro) — sin al menos una de estas, aunque mencione el nombre
// del evento, es más probable que sea una pregunta de conocimiento general (ej. "¿cómo
// se juega waterpolo?") y conviene dejarla pasar a la IA en vez de mostrar la tarjeta.
const PALABRAS_INTENCION_OPERATIVA = [
  "cupo", "cupos", "espacio", "espacios", "lugar", "lugares", "disponible", "disponibles",
  "fecha", "hora", "horario", "dia", "dias", "cuando", "donde", "ubicacion",
  "registrar", "registro", "registrarme", "apuntar", "apuntarme", "inscribir", "inscripcion",
  "costo", "precio", "gratis", "info", "informacion", "detalle", "detalles", "reserva", "reservar",
  "lleno", "queda", "quedan", "hay sitio"
];

function tieneIntencionOperativa(texto) {
  const n = normalizarTexto(texto);
  return PALABRAS_INTENCION_OPERATIVA.some(p => n.includes(p));
}

// ---------- Punto de entrada único hacia el modal "Registrarme a Evento" ----------
// Todas las tarjetas/botones "Registrarme" del chat (categoría, agenda semanal,
// calendario) llaman esta misma función. Antes arrancaba un flujo conversacional
// paso a paso; ahora abre el modal directo en el formulario de ESE evento, ya con
// la fecha (si venía de la agenda/calendario) o el selector de fechas del mes
// (si es recurrente y no se especificó una sesión puntual).
window.iniciarRegistro = function(eventoId, categoria, nombreEvento, fechaSesion) {
  const evento = buscarEventoPorId(eventoId, categoria);
  if (!evento) { addMessage("⚠️ No encontré ese evento.", "bot"); return; }

  if (fechaSesion || !esRecurrente(evento)) {
    const info = cupoInfo(evento, fechaSesion || evento.fecha);
    if (info.lleno) {
      addMessage(`🔴 Lo siento, *${nombreEvento}* ya alcanzó su cupo máximo para esa fecha (${info.confirmados}/${info.total}). No hay lugares disponibles por el momento.`, "bot");
      return;
    }
  }

  abrirFormularioEvento(evento, fechaSesion || null);
};

window.usarDatosRecordados = async function(eventoId, categoria, nombreEvento, fechaSesion, diasCsv) {
  const depto = deptoRecordado;
  const nombre = nombreRecordado;
  const evento = buscarEventoPorId(eventoId, categoria);
  const recurrente = evento ? esRecurrente(evento) : false;
  const dias = diasCsv ? diasCsv.split(",").filter(d => d) : null;

  if (recurrente && !fechaSesion) {
    if (dias && dias.length) {
      await procesarDiasElegidos(eventoId, categoria, depto, nombre, nombreEvento, dias);
    } else {
      mostrarBotonesDias(eventoId, categoria, depto, nombre, nombreEvento);
    }
    return;
  }

  addMessage(`Confirmando registro de *${nombre}* (depto ${depto}) en *${nombreEvento}*…`, "bot");
  await confirmarRegistroBackend(eventoId, categoria, depto, nombre, { fechaSesion: fechaSesion || null });
};

window.cambiarDatosRegistro = function(eventoId, categoria, nombreEvento, fechaSesion, diasCsv) {
  const evento = buscarEventoPorId(eventoId, categoria);
  registroEnCurso = {
    eventoId, categoria, nombreEvento,
    fechaSesion: fechaSesion || null,
    esRecurrente: evento ? esRecurrente(evento) : false,
    diasPreseleccionados: diasCsv ? diasCsv.split(",").filter(d => d) : null,
    paso: "depto"
  };
  addMessage(`Ok, indica el nuevo número de departamento (ej. 3801 o 605):`, "bot");
  if (chatInput) chatInput.focus();
};

async function continuarFlujoRegistro(texto) {
  const txtLimpio = texto.trim();

  if (txtLimpio.toLowerCase() === "cancelar") {
    registroEnCurso = null;
    addMessage("Registro cancelado. Si quieres intentarlo de nuevo, usa el botón *Registrarme* del evento.", "bot");
    return;
  }

  if (registroEnCurso.paso === "depto") {
    if (!/^[0-9]{2,5}$/.test(txtLimpio)) {
      addMessage("Ese número de departamento no parece válido. Escríbelo solo con números (ej. 3801 o 605), o escribe *cancelar*.", "bot");
      return;
    }
    registroEnCurso.depto = txtLimpio;
    deptoRecordado = txtLimpio;
    registroEnCurso.paso = "nombre";
    addMessage("Gracias. Ahora indica el nombre completo de quien asistirá:", "bot");
    return;
  }

  if (registroEnCurso.paso === "nombre") {
    if (txtLimpio.toLowerCase() === "cambiar depto") {
      registroEnCurso.paso = "depto";
      addMessage("Ok, indica el número de departamento correcto:", "bot");
      return;
    }
    if (txtLimpio.length < 3) {
      addMessage("Por favor escribe el nombre completo del asistente, o escribe *cancelar*.", "bot");
      return;
    }
    registroEnCurso.nombreAsistente = txtLimpio;
    nombreRecordado = txtLimpio;

    // Evento recurrente sin sesión puntual ya elegida: si los días ya se marcaron
    // en el selector de la tarjeta (diasPreseleccionados), se procesan directo —
    // si no, se muestran los botones de días aquí (fallback, ej. atajo "usar mismos
    // datos" sin selector previo).
    if (registroEnCurso.esRecurrente && !registroEnCurso.fechaSesion) {
      const { eventoId, categoria, nombreEvento, depto, nombreAsistente, diasPreseleccionados } = registroEnCurso;
      registroEnCurso = null;
      if (diasPreseleccionados && diasPreseleccionados.length) {
        await procesarDiasElegidos(eventoId, categoria, depto, nombreAsistente, nombreEvento, diasPreseleccionados);
      } else {
        mostrarBotonesDias(eventoId, categoria, depto, nombreAsistente, nombreEvento);
      }
      return;
    }

    const { eventoId, categoria, nombreEvento, depto, fechaSesion } = registroEnCurso;
    addMessage(`Confirmando registro de *${txtLimpio}* (depto ${depto}) en *${nombreEvento}*…`, "bot");
    registroEnCurso = null;
    await confirmarRegistroBackend(eventoId, categoria, depto, txtLimpio, { fechaSesion });
    return;
  }
}

// ---------- Selección de sesión por botones (sin escribir texto) ----------
// IMPORTANTE: los días se muestran como checkboxes (selección múltiple), no como
// botones de acción inmediata. Antes, cada botón de día ejecutaba elegirDiaRegistro()
// al primer clic y registraba de una vez, sin forma de sumar un segundo día (ej.
// Lunes Y Martes) en la misma pasada — y el backend además bloqueaba un segundo
// registro para el mismo evento aunque fuera otro día (ver fix en Code.gs). Ahora se
// marcan uno o varios días y se confirma con un botón explícito.
function mostrarBotonesDias(eventoId, categoria, depto, nombreAsistente, nombreEvento) {
  const evento = buscarEventoPorId(eventoId, categoria);
  const diasSerie = evento ? evento.diasemana : [];
  const nombreAsistenteEsc = escapeHtml(nombreAsistente).replace(/'/g, "\\'");
  const nombreEventoEsc = escapeHtml(nombreEvento).replace(/'/g, "\\'");
  const grupoId = `diasGrp${Date.now()}`;

  let msg = `¿A qué día(s) quieres registrarte en *${nombreEvento}*? Puedes marcar más de uno (ej. Lunes y Martes):\n\n`;
  diasSerie.forEach(dia => {
    msg += `<label class="mr-1 mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"><input type="checkbox" class="${grupoId} align-middle" value="${dia}"> ${dia}</label>`;
  });
  msg += `<br>`;
  msg += `<button onclick="window.confirmarDiasSeleccionados('${grupoId}','${eventoId}','${categoria}','${depto}','${nombreAsistenteEsc}','${nombreEventoEsc}')" class="mt-1 mr-1.5 inline-block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">✅ Registrarme en los días marcados</button>`;
  msg += `<button onclick="window.elegirDiaRegistro('${eventoId}','${categoria}','${depto}','${nombreAsistenteEsc}','${nombreEventoEsc}','todos')" class="mt-1 inline-block text-[11px] font-bold text-white bg-brand-800 hover:bg-brand-900 rounded-lg px-3 py-1.5 transition">Todos los días</button>`;
  msg += `\n📌 El registro cubre solo las sesiones de este mes — el próximo mes deberás volver a confirmar.`;
  addMessage(msg, "bot");
}

// Lee los checkboxes marcados del grupo y delega en procesarDiasElegidos (misma
// lógica que usa el selector embebido en la tarjeta del evento).
window.confirmarDiasSeleccionados = async function(grupoId, eventoId, categoria, depto, nombreAsistente, nombreEvento) {
  const marcados = Array.from(document.querySelectorAll(`.${grupoId}:checked`)).map(c => c.value);
  if (!marcados.length) {
    addMessage("Marca al menos un día antes de confirmar (o usa el botón *Todos los días*).", "bot");
    return;
  }
  addMessage(marcados.join(" y "), "user");
  await procesarDiasElegidos(eventoId, categoria, depto, nombreAsistente, nombreEvento, marcados);
};

// Junta las fechas candidatas de todos los días elegidos (unión, sin duplicados) y
// registra directo si hay una sola sesión posible, o deja elegir cuál(es) si hay
// varias. La usan tanto el selector de la tarjeta (iniciarRegistroDesdeTarjeta) como
// los botones de días del flujo de chat (confirmarDiasSeleccionados).
async function procesarDiasElegidos(eventoId, categoria, depto, nombreAsistente, nombreEvento, dias) {
  const evento = buscarEventoPorId(eventoId, categoria);
  if (!evento) { addMessage("⚠️ No encontré ese evento.", "bot"); return; }

  const candidatasSet = new Set();
  dias.forEach(dia => calcularFechasCandidatas(evento, dia).forEach(f => candidatasSet.add(f)));
  const candidatas = Array.from(candidatasSet).sort();

  if (!candidatas.length) {
    addMessage(`No encontré sesiones de *${nombreEvento}* este mes para esos días. Intenta el próximo mes o revisa con el Comité.`, "bot");
    return;
  }
  if (candidatas.length === 1) {
    addMessage(`Confirmando registro de *${nombreAsistente}* (depto ${depto}) en *${nombreEvento}* para el ${formatearFecha(parseFechaLocal(candidatas[0]))}…`, "bot");
    await confirmarRegistroBackend(eventoId, categoria, depto, nombreAsistente, { fechaSesion: candidatas[0] });
    return;
  }
  mostrarConfirmacionMultiSesion(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatas);
}

// Fechas candidatas de ESTE MES para un día específico (o todos los días de la serie)
function calcularFechasCandidatas(evento, diaTexto) {
  const esTodos = normalizarTexto(diaTexto) === "todos";
  const ocurrencias = ocurrenciasDelMesActual(evento);
  const candidatas = esTodos
    ? ocurrencias
    : ocurrencias.filter(f => normalizarTexto(DIAS_SEMANA_LARGOS[f.getDay()]) === normalizarTexto(diaTexto));
  return candidatas.map(f => fechaISO(f));
}

window.elegirDiaRegistro = async function(eventoId, categoria, depto, nombreAsistente, nombreEvento, diaTexto) {
  addMessage(diaTexto === "todos" ? "Todos los días" : diaTexto, "user");

  const evento = buscarEventoPorId(eventoId, categoria);
  if (!evento) { addMessage("⚠️ No encontré ese evento.", "bot"); return; }

  const candidatas = calcularFechasCandidatas(evento, diaTexto);
  if (!candidatas.length) {
    addMessage(`No encontré sesiones de *${nombreEvento}* este mes para esa opción. Intenta el próximo mes o revisa con el Comité.`, "bot");
    return;
  }
  if (candidatas.length === 1) {
    addMessage(`Confirmando registro de *${nombreAsistente}* (depto ${depto}) en *${nombreEvento}* para el ${formatearFecha(parseFechaLocal(candidatas[0]))}…`, "bot");
    await confirmarRegistroBackend(eventoId, categoria, depto, nombreAsistente, { fechaSesion: candidatas[0] });
    return;
  }
  mostrarConfirmacionMultiSesion(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatas);
};

// El residente YA eligió los días (en la tarjeta o en los checkboxes del chat) —
// volver a pedirle que elija sesión por sesión (como antes) es redundante. En vez
// de eso se muestra un resumen de las fechas ya encontradas y se pide una sola
// confirmación; "Elegir días específicos" queda como escape hacia la selección
// granular (mostrarSeleccionSesiones) por si el residente cambia de opinión.
function mostrarConfirmacionMultiSesion(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatas) {
  const nombreAsistenteEsc = escapeHtml(nombreAsistente).replace(/'/g, "\\'");
  const nombreEventoEsc = escapeHtml(nombreEvento).replace(/'/g, "\\'");
  const todasCsv = candidatas.join(",");

  let msg = `Vas a registrarte en *${nombreEvento}* para estas ${candidatas.length} sesiones de este mes:\n\n`;
  candidatas.forEach(fechaIso => {
    const fechaDate = parseFechaLocal(fechaIso);
    const nombreDia = DIAS_SEMANA_LARGOS[fechaDate.getDay()].slice(0, 3);
    msg += `   🟢 ${nombreDia} ${formatearFecha(fechaDate)}\n`;
  });
  msg += `\n<button onclick="window.confirmarRegistroConFechas('${eventoId}','${categoria}','${depto}','${nombreAsistenteEsc}','${todasCsv}','${nombreEventoEsc}')" class="mt-1 mr-1.5 inline-block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">✅ Sí, registrarme a todas</button>`;
  msg += `<button onclick="window.elegirSesionesIndividualmente('${eventoId}','${categoria}','${depto}','${nombreAsistenteEsc}','${nombreEventoEsc}','${todasCsv}')" class="inline-block text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition">✏️ Elegir días específicos</button>`;
  addMessage(msg.trim(), "bot");
}

// Escape hacia la selección granular (una sesión a la vez o todas) cuando el
// residente no quiere las 5 fechas completas de mostrarConfirmacionMultiSesion.
window.elegirSesionesIndividualmente = function(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatasCsv) {
  const candidatas = candidatasCsv.split(",").filter(f => f);
  mostrarSeleccionSesiones(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatas);
};

function mostrarSeleccionSesiones(eventoId, categoria, depto, nombreAsistente, nombreEvento, candidatas) {
  const nombreAsistenteEsc = escapeHtml(nombreAsistente).replace(/'/g, "\\'");
  const nombreEventoEsc = escapeHtml(nombreEvento).replace(/'/g, "\\'");
  const chkGrupo = `sesGrp${Date.now()}`;

  let msg = `¿A cuál(es) de estas sesiones de *${nombreEvento}* quieres registrarte?\n\n`;
  candidatas.forEach(fechaIso => {
    const fechaDate = parseFechaLocal(fechaIso);
    const nombreDia = DIAS_SEMANA_LARGOS[fechaDate.getDay()].slice(0, 3);
    msg += `<label class="mr-1 mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"><input type="checkbox" class="${chkGrupo}" value="${fechaIso}"> ${nombreDia} ${formatearFecha(fechaDate)}</label>`;
  });
  msg += `<br><label class="mr-1 mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold bg-brand-50 text-brand-700 hover:bg-brand-100 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"><input type="checkbox" class="${chkGrupo}Todas"> Seleccionar todas</label>`;
  msg += `<br><button onclick="window.confirmarSesionesSeleccionadas('${chkGrupo}','${eventoId}','${categoria}','${depto}','${nombreAsistenteEsc}','${nombreEventoEsc}')" class="mt-1 inline-block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">✅ Registrarme a las seleccionadas</button>`;
  addMessage(msg.trim(), "bot");
}

window.confirmarSesionesSeleccionadas = async function(chkGrupo, eventoId, categoria, depto, nombreAsistente, nombreEvento) {
  const todasChk = document.querySelector(`.${chkGrupo}Todas`);
  const fechas = (todasChk && todasChk.checked)
    ? Array.from(document.querySelectorAll(`.${chkGrupo}`)).map(c => c.value)
    : Array.from(document.querySelectorAll(`.${chkGrupo}:checked`)).map(c => c.value);

  if (!fechas.length) {
    addMessage("Marca al menos una sesión (o *Seleccionar todas*) antes de confirmar.", "bot");
    return;
  }
  await window.confirmarRegistroConFechas(eventoId, categoria, depto, nombreAsistente, fechas.join(","), nombreEvento);
};

window.confirmarRegistroConFechas = async function(eventoId, categoria, depto, nombreAsistente, fechasCsv, nombreEvento) {
  addMessage(`Confirmando registro de *${nombreAsistente}* (depto ${depto}) en *${nombreEvento}*…`, "bot");
  const opciones = fechasCsv.includes(",") ? { fechasSesion: fechasCsv } : { fechaSesion: fechasCsv };
  await confirmarRegistroBackend(eventoId, categoria, depto, nombreAsistente, opciones);
};

async function confirmarRegistroBackend(eventoId, categoria, depto, nombre, opciones) {
  opciones = opciones || {};
  try {
    let url = `${URL_AGENTE_EVENTOS}?accion=registrar&eventoId=${encodeURIComponent(eventoId)}&categoria=${encodeURIComponent(categoria)}&depto=${encodeURIComponent(depto)}&nombre=${encodeURIComponent(nombre)}`;
    if (opciones.fechaSesion) url += `&fechaSesion=${encodeURIComponent(opciones.fechaSesion)}`;
    if (opciones.fechasSesion) url += `&fechasSesion=${encodeURIComponent(opciones.fechasSesion)}`;
    if (opciones.diasElegidos) url += `&diasElegidos=${encodeURIComponent(opciones.diasElegidos)}`;

    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();

    if (data.error && !data.hasOwnProperty("ok")) {
      addMessage(`⚠️ Error al procesar el registro:\n\n${data.detalle || "Sin detalle disponible."}`, "bot");
      return;
    }

    if (data.multiSesion) {
      mostrarResultadoMultiSesion(eventoId, data);
    } else if (data.ok) {
      let extra;
      if (data.sinLimite) {
        extra = `\n\n👥 Este evento no tiene límite de cupo — llevas ${data.cupoActual} registro(s) confirmado(s).`;
      } else {
        extra = `\n\n👥 Cupo actualizado: ${data.cupoActual}/${data.cupoTotal} — ${data.lugaresDisponibles} lugar(es) disponible(s).`;
      }
      if (data.huellasMaxDepto) extra += `\n🏠 Depto ${depto}: ${data.huellasUsadasDepto}/${data.huellasMaxDepto} registros usados para esa sesión.`;
      addMessage(`✅ *${data.mensaje}*${extra}\n\n¿Quieres registrarte a otro evento o revisar tus registros?`, "bot");
      addMessage(botonesSeguimientoRegistro(), "bot");
      if (data.fecha) DATA.cuposLive[`${String(eventoId).trim()}|${data.fecha}`] = data.cupoActual;
      renderSidebarEventos();
      refrescarRegistrosYCupos();
    } else if (data.moroso) {
      addMessage(`🚫 ${data.error}`, "bot");
    } else if (data.cupoLleno) {
      addMessage(`🔴 ${data.error}`, "bot");
    } else if (data.huellasAgotadas) {
      addMessage(`🚫 ${data.error}`, "bot");
    } else {
      addMessage(`⚠️ No se pudo completar el registro: ${data.error || "Error desconocido."}`, "bot");
    }
  } catch (error) {
    console.error("Error de red al registrar:", error);
    addMessage("⚠️ Ocurrió un problema de conexión al confirmar tu registro. Inténtalo de nuevo en un momento.", "bot");
  }
}

function mostrarResultadoMultiSesion(eventoId, data) {
  const confirmadas = data.detalle.filter(d => d.ok);
  const fallidas = data.detalle.filter(d => !d.ok);

  let msg = confirmadas.length > 0
    ? `✅ *Registro procesado para "${data.nombreEvento}"*\n\nSe confirmaron ${confirmadas.length} de ${data.totalSolicitadas} sesión(es) solicitadas:\n`
    : `🔴 *No se pudo confirmar ninguna sesión para "${data.nombreEvento}"*\n\n`;

  confirmadas.forEach(d => {
    const fechaTxt = formatearFecha(parseFechaLocal(d.fecha));
    const cupoTxt = d.sinLimite ? `sin límite (${d.cupoActual} registrados)` : `${d.cupoActual}/${d.cupoTotal}`;
    msg += `✅ ${fechaTxt} — Cupo: ${cupoTxt}\n`;
    DATA.cuposLive[`${String(eventoId).trim()}|${d.fecha}`] = d.cupoActual;
  });

  if (fallidas.length) {
    msg += `\n⚠️ No se pudieron confirmar ${fallidas.length} sesión(es):\n`;
    fallidas.forEach(d => {
      const fechaTxt = formatearFecha(parseFechaLocal(d.fecha));
      let motivoTxt;
      if (d.motivo === "cupo") {
        motivoTxt = "cupo lleno";
      } else if (d.motivo === "huellas") {
        motivoTxt = d.huellasMaxDepto > 1
          ? `el depto ya alcanzó su máximo de ${d.huellasMaxDepto} registro(s) para esa fecha`
          : "el depto ya tiene un registro confirmado para esa fecha";
      } else {
        motivoTxt = "no se pudo confirmar";
      }
      msg += `❌ ${fechaTxt} — ${motivoTxt}\n`;
    });
  }

  if (confirmadas.length > 0) {
    msg += `\n📌 Este registro cubre solo las sesiones de este mes. Para seguir el próximo mes con tus sesiones, vuelve a escribir "quiero registrarme" en *${data.nombreEvento}* a partir del mes que viene.`;
  }

  addMessage(msg.trim(), "bot");
  if (confirmadas.length > 0) {
    addMessage("¿Quieres registrarte a otro evento o revisar tus registros?", "bot");
    addMessage(botonesSeguimientoRegistro(), "bot");
  }
  renderSidebarEventos();
  refrescarRegistrosYCupos();
}

function refrescarRegistrosYCupos() {
  cargarCsv(URL_REGISTROS_CSV).then(r => {
    DATA.registros = r.map(x => ({
      eventoid: x["eventoid"] || x["EventoID"] || "",
      fechasesion: x["fechasesion"] || x["FechaSesion"] || "",
      categoria: x["categoria"] || "",
      depto: x["depto"] || "",
      nombre: x["nombre"] || "",
      estado: x["estado"] || ""
    }));
  });
  refrescarCuposLive();
}

// ---------- Autoservicio: "¿tengo reserva?" / "mis registros" / cancelar los propios ----------
function detectarIntentCancelarPropio(texto) {
  const n = normalizarTexto(texto);
  return /cancelar mi (registro|reserva|inscripcion)|quiero cancelar|dar de baja mi registro/.test(n);
}

function detectarIntentConsultarPropio(texto) {
  const n = normalizarTexto(texto);
  // Cubre variantes como "qué actividades tengo registradas", "en qué estoy
  // registrado", "qué tengo agendado", además de las frases originales — antes
  // frases así no matcheaban ningún patrón y el mensaje se iba directo a la IA,
  // que no tiene forma de consultar el Sheet de Registros por depto.
  return /tengo reserva|ya tengo registro|estoy registrado|estoy inscrito|apuntado a|confirmas mi registro|confirmar mi (registro|reserva)|mis registros|mis eventos|mis reservas|mis actividades|mis inscripciones|a que estoy apuntado|que actividades tengo|actividades tengo registrad|actividad(es)? registrada|que tengo registrado|en que (estoy|eventos estoy) registrado|cuales son mis (registros|eventos|actividades|reservas)|que eventos tengo|eventos (que )?tengo registrad|que tengo agendado|mi agenda de eventos|que tengo apuntado/.test(n);
}

// Intenta reconocer el nombre de un evento activo mencionado dentro del texto libre
function extraerNombreEventoDeTexto(texto) {
  const n = normalizarTexto(texto);
  const match = todosLosEventos().find(ev => ev.nombre && n.includes(normalizarTexto(ev.nombre)));
  return match ? match.nombre : null;
}

function iniciarConsultaPropia(tipo, nombreFiltro) {
  if (deptoRecordado) {
    const intro = tipo === "cancelar"
      ? (nombreFiltro ? `Vamos a cancelar tu registro a *${nombreFiltro}* (depto ${deptoRecordado}, el mismo de antes).` : `Vamos a revisar tus registros del depto ${deptoRecordado} (el mismo de antes) para que elijas cuál cancelar.`)
      : (nombreFiltro ? `Voy a revisar si el depto ${deptoRecordado} (el mismo de antes) tiene reserva en *${nombreFiltro}*.` : `Voy a revisar los registros del depto ${deptoRecordado} (el mismo de antes).`);
    addMessage(`${intro}\n\nSi no es tu depto, escribe *cambiar depto*.`, "bot");
    ejecutarConsultaPropia(tipo, nombreFiltro, deptoRecordado);
    return;
  }
  consultaEnCurso = { tipo, nombreFiltro, paso: "depto" };
  const intro = tipo === "cancelar"
    ? (nombreFiltro ? `Vamos a cancelar tu registro a *${nombreFiltro}*.` : `Vamos a revisar tus registros para que elijas cuál cancelar.`)
    : (nombreFiltro ? `Voy a revisar si tienes reserva en *${nombreFiltro}*.` : `Voy a revisar tus registros.`);
  addMessage(`${intro}\n\nPor favor indica tu número de departamento (ej. 3801 o 605). Escribe *cancelar* para salir.`, "bot");
  if (chatInput) chatInput.focus();
}

async function continuarConsultaPropia(texto) {
  const txt = texto.trim();
  if (txt.toLowerCase() === "cancelar") {
    consultaEnCurso = null;
    addMessage("Consulta cancelada.", "bot");
    return;
  }
  if (consultaEnCurso.paso === "depto") {
    if (!/^[0-9]{2,5}$/.test(txt)) {
      addMessage("Ese número de departamento no parece válido. Escríbelo solo con números (ej. 3801 o 605), o escribe *cancelar*.", "bot");
      return;
    }
    consultaEnCurso.depto = txt;
    deptoRecordado = txt;
    const { tipo, nombreFiltro, depto } = consultaEnCurso;
    consultaEnCurso = null;
    await ejecutarConsultaPropia(tipo, nombreFiltro, depto);
  }
}

async function ejecutarConsultaPropia(tipo, nombreFiltro, depto) {
  addMessage(`Buscando registros del depto ${depto}…`, "bot");
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=mis_registros&depto=${encodeURIComponent(depto)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();
    if (!data.ok) {
      addMessage(`⚠️ ${data.error || "No se pudo consultar tus registros."}`, "bot");
      return;
    }
    let registros = data.registros || [];
    if (nombreFiltro) {
      const nf = normalizarTexto(nombreFiltro);
      registros = registros.filter(r => normalizarTexto(r.nombreEvento).includes(nf));
    }
    // Tanto "mis registros" como "cancelar mi registro" convergen en la misma vista:
    // se listan agrupados por evento y desde ahí mismo se puede cancelar. Antes eran
    // dos vistas separadas (una de solo lectura, otra con un botón por sesión) —
    // unificarlas evita mantener dos formatos de fecha/hora en paralelo.
    mostrarResultadoConsultaPropia(depto, nombreFiltro, registros);
  } catch (e) {
    console.error("Error consultando mis_registros:", e);
    addMessage("⚠️ Error de conexión al consultar tus registros.", "bot");
  }
}

// Botones de seguimiento: el usuario pidió que los 4 botones principales (hoy,
// semana, mis registros, cancelar) aparezcan siempre, sin importar el contexto —
// antes estas dos funciones mostraban subconjuntos distintos (2 o 3 botones) según
// dónde se usaran, lo cual era inconsistente. Ahora ambas son el mismo set de 4.
function botonesSeguimientoConsulta() {
  return mensajeBotonesBienvenida();
}

function botonesSeguimientoRegistro() {
  return mensajeBotonesBienvenida();
}

// Tip de siguiente paso: se agrega al final de las respuestas informativas (hoy,
// semana, categoría, ficha de un evento) para que un usuario nuevo siempre tenga a
// mano las 4 acciones principales, sin tener que adivinar qué escribir.
function tipSiguientePaso() {
  return `\n\n💬 ¿Qué más quieres hacer?\n` + mensajeBotonesBienvenida();
}

// Botones de bienvenida: las 4 acciones principales que un usuario nuevo necesita
// para entender el agente desde el primer mensaje — qué hay, registrarse, ver sus
// registros y cancelar. Se usan en el mensaje de bienvenida, en "ayuda" y como pie
// de casi todas las respuestas informativas (tipSiguientePaso).
function mensajeBotonesBienvenida() {
  return `<button onclick="window.abrirModalEventoRegistro('menu')" class="mr-1 mb-1.5 inline-block text-[11px] font-bold text-white bg-brand-700 hover:bg-brand-800 rounded-lg px-3 py-1.5 transition">🎟️ Registrarme a Evento</button>`
    + `<button onclick="window.handleQuickAction('Ver eventos de hoy')" class="mr-1 mb-1.5 inline-block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">🎈 Eventos de hoy</button>`
    + `<button onclick="window.handleQuickAction('Ver eventos de la semana')" class="mr-1 mb-1.5 inline-block text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 transition">📅 Eventos de la Semana</button>`
    + `<button onclick="window.abrirModalCalendario()" class="mr-1 mb-1.5 inline-block text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 transition">📆 Calendario Mensual</button>`
    + `<button onclick="window.abrirModalEventoRegistro('verificar_identidad')" class="mb-1.5 inline-block text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 transition">📋 Consultar mis registros o realizar cancelación</button>`;
}

// Registros del último "mis registros" agrupados por evento, guardados en memoria
// para que el botón "Cancelar alguno de estos registros" no tenga que codificar un
// arreglo completo dentro del atributo onclick (poco práctico y frágil de escapar).
// Se pierde con un refresh, igual que deptoRecordado/nombreRecordado.
let gruposCancelablesTemp = {};

function mostrarResultadoConsultaPropia(depto, nombreFiltro, registros) {
  if (!registros.length) {
    const msg = nombreFiltro
      ? `❌ El departamento ${depto} no tiene registro confirmado en *${nombreFiltro}*.`
      : `El departamento ${depto} no tiene registros futuros confirmados en ningún evento.`;
    addMessage(`${msg}\n\n¿Quieres ver qué eventos tenemos disponibles?`, "bot");
    addMessage(botonesSeguimientoConsulta(), "bot");
    return;
  }

  // Agrupamos por evento (no una fila por sesión) — así "Ping Pong" con 8 sesiones
  // aparece UNA vez con sus 8 fechas adentro, no repetido 8 veces en la lista.
  const grupos = {};
  const orden = [];
  registros.forEach(r => {
    const key = `${r.eventoId}|${r.categoria}`;
    if (!grupos[key]) { grupos[key] = { eventoId: r.eventoId, categoria: r.categoria, nombreEvento: r.nombreEvento, items: [] }; orden.push(key); }
    grupos[key].items.push({ registroId: r.registroId, fechaSesion: r.fechaSesion });
  });

  let msg = `✅ El departamento ${depto} tiene ${registros.length} registro(s) confirmado(s):\n\n`;
  orden.forEach(key => {
    const g = grupos[key];
    const evento = buscarEventoPorId(g.eventoId, g.categoria);
    const cfg = evento ? CATEGORIAS[evento.categoria] : null;
    const nombreEsc = escapeHtml(g.nombreEvento).replace(/'/g, "\\'");

    msg += `${cfg ? cfg.emoji : "📌"} *${g.nombreEvento}*\n`;
    if (evento) msg += `🕐 ${horarioTexto(evento)} · 📍 ${evento.ubicacion || "N/A"}\n`;

    const itemsOrdenados = g.items.slice().sort((a, b) => String(a.fechaSesion).localeCompare(String(b.fechaSesion)));
    itemsOrdenados.forEach((item, idx) => {
      const fechaDate = item.fechaSesion ? parseFechaLocal(item.fechaSesion) : null;
      const valido = fechaDate && !isNaN(fechaDate);
      // "Sin fecha" solo debería verse en registros muy viejos, creados antes de que
      // el backend guardara FechaSesion (ver fix en Code.gs). Se numeran para poder
      // distinguirlos entre sí si hay varios del mismo evento.
      const linea = valido ? `${DIAS_SEMANA_LARGOS[fechaDate.getDay()].slice(0, 3)} ${formatearFecha(fechaDate)}` : `Sin fecha registrada (#${idx + 1})`;
      msg += `   🟢 ${linea}\n`;
    });

    const grupoId = `cancelGrp${Date.now()}${orden.indexOf(key)}`;
    gruposCancelablesTemp[grupoId] = { depto, nombreEvento: g.nombreEvento, items: itemsOrdenados };
    msg += `<button onclick="window.abrirCancelacionEvento('${grupoId}')" class="mt-0.5 mb-2 inline-block text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5 transition">🗑️ Cancelar alguno de estos registros</button>\n\n`;
  });

  msg += `¿Quieres registrarte a algún otro evento?\n`;
  msg += botonesSeguimientoConsulta();
  addMessage(msg.trim(), "bot");
}

// Abre el selector de sesiones a cancelar: un checkbox por fecha registrada + una
// opción "Seleccionar todas", igual que el patrón ya usado para elegir días al
// registrarse (confirmarDiasSeleccionados). Evita cancelar de un solo clic por
// accidente y deja elegir exactamente cuáles sesiones dar de baja.
window.abrirCancelacionEvento = function(grupoId) {
  const grupo = gruposCancelablesTemp[grupoId];
  if (!grupo || !grupo.items.length) {
    addMessage("⚠️ No encontré esos registros (puede que la lista haya cambiado). Escribe *mis registros* de nuevo.", "bot");
    return;
  }
  addMessage(`Cancelar ${grupo.nombreEvento}`, "user");

  const chkGrupo = `cancelChk${Date.now()}`;
  let msg = `¿Qué sesión(es) de *${grupo.nombreEvento}* quieres cancelar?\n\n`;
  grupo.items.forEach((item, idx) => {
    const fechaDate = item.fechaSesion ? parseFechaLocal(item.fechaSesion) : null;
    const valido = fechaDate && !isNaN(fechaDate);
    const etiqueta = valido ? `${DIAS_SEMANA_LARGOS[fechaDate.getDay()].slice(0, 3)} ${formatearFecha(fechaDate)}` : `Sin fecha registrada (#${idx + 1})`;
    msg += `<label class="mr-1 mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"><input type="checkbox" class="${chkGrupo}" value="${item.registroId}"> ${etiqueta}</label>`;
  });
  msg += `<br><label class="mr-1 mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold bg-red-50 text-red-700 hover:bg-red-100 rounded-lg px-2.5 py-1.5 cursor-pointer select-none"><input type="checkbox" class="${chkGrupo}Todas"> Seleccionar todas</label>`;
  msg += `<br><button onclick="window.confirmarCancelacionMultiple('${chkGrupo}','${grupoId}')" class="mt-1 inline-block text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5 transition">🗑️ Cancelar seleccionadas</button>`;
  addMessage(msg, "bot");
};

window.confirmarCancelacionMultiple = function(chkGrupo, grupoId) {
  const grupo = gruposCancelablesTemp[grupoId];
  if (!grupo) { addMessage("⚠️ Esa selección ya expiró, escribe *mis registros* de nuevo.", "bot"); return; }

  const todasChk = document.querySelector(`.${chkGrupo}Todas`);
  const ids = (todasChk && todasChk.checked)
    ? grupo.items.map(i => i.registroId)
    : Array.from(document.querySelectorAll(`.${chkGrupo}:checked`)).map(c => c.value);

  if (!ids.length) {
    addMessage("Marca al menos una sesión (o *Seleccionar todas*) antes de confirmar.", "bot");
    return;
  }
  window.cancelarMiRegistroDesdeChat(grupo.depto, ids.join(","), grupo.nombreEvento, null);
};

window.cancelarMiRegistroDesdeChat = async function(depto, registroIdsCsv, etiqueta, fecha) {
  const detalleFecha = fecha ? ` (${formatearFecha(parseFechaLocal(fecha))})` : "";
  addMessage(`Cancelando *${etiqueta}*${detalleFecha}…`, "bot");
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=cancelar_mi_registro&depto=${encodeURIComponent(depto)}&registroIds=${encodeURIComponent(registroIdsCsv)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();
    if (data.ok && data.totalCanceladas > 0) {
      addMessage(`✅ Se canceló(aron) ${data.totalCanceladas} registro(s) del depto ${depto}. El cupo queda liberado.\n\n¿Quieres registrarte a otro evento o ver qué más hay disponible?`, "bot");
      addMessage(botonesSeguimientoConsulta(), "bot");
      renderSidebarEventos();
      refrescarRegistrosYCupos();
    } else {
      addMessage(`⚠️ ${data.error || "No se pudo cancelar (puede que ya estuviera cancelado)."}`, "bot");
    }
  } catch (e) {
    console.error("Error cancelando mi registro:", e);
    addMessage("⚠️ Error de conexión al cancelar tu registro.", "bot");
  }
};

// ---------- Chat IA (fallback vía Apps Script + Gemini) ----------
// Se usa SOLO cuando ningún patrón local coincide (ver responderMensajeLocal /
// procesarMensajeUsuario) — es decir, para preguntas abiertas que no son "hoy",
// "semana", una categoría, un evento por nombre, "mis registros" o "cancelar".
// El backend (accion=chat en Code.gs) enruta vía OpenRouter con fallback de modelo
// (DeepSeek gratuito -> Gemini gratuito), así que aquí solo hace falta cubrir
// errores de red/timeout del lado del navegador y respuestas con {error: true}.
async function preguntarAgenteIA(pregunta) {
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=chat&pregunta=${encodeURIComponent(pregunta)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();

    if (data.error) {
      console.error("Error del agente IA:", data.detalle || data.error);
      return null; // se resuelve con el mensaje de ayuda fijo, no con el error crudo
    }
    if (!data.respuesta_ia) return null;
    // El backend actual regresa el error de OpenRouter como texto dentro de
    // respuesta_ia cuando ambos modelos fallan — no debe mostrarse al residente
    // como si fuera una respuesta real de la IA.
    if (String(data.respuesta_ia).startsWith("Error OpenRouter:")) {
      console.error("Error del agente IA (OpenRouter):", data.respuesta_ia);
      return null;
    }
    return data.respuesta_ia;
  } catch (error) {
    console.error("Error de red al llamar al agente IA:", error);
    return null;
  }
}

// ---------- Router de mensajes ----------
function responderMensajeLocal(textoOriginal) {
  const texto = textoOriginal.trim();
  const normalizado = texto.toLowerCase();

  // Prioridad 1: si menciona un evento específico con intención operativa (cupo,
  // horario, días, etc.), responde con ESE evento — antes que cualquier trigger
  // genérico. Así "qué días hay Ping Pong" no dispara toda la agenda semanal solo
  // porque la frase natural para preguntarlo incluye la palabra "semana"/"días".
  const candidatos = buscarEventoPorNombreParcial(texto);
  if (candidatos.length > 0 && tieneIntencionOperativa(texto)) {
    return candidatos.map(ev => tarjetaEventoTexto(ev)).join("\n\n") + tipSiguientePaso();
  }

  if (normalizado.includes("hoy")) return respuestaEventosHoy();
  if (normalizado.includes("semana") || normalizado.includes("agenda") || normalizado.includes("programaci")) return respuestaAgendaSemanal();

  const categoriaDetectada = detectarCategoriaEnTexto(texto);
  if (categoriaDetectada) return respuestaPorCategoria(categoriaDetectada);

  if (normalizado.includes("ayuda") || normalizado === "hola") {
    return `👋 ¡Hola! Esto es lo que puedo hacer por ti:\n\n🎟️ *Registrarme a Evento* — botón de abajo, para registrarte, consultar o cancelar tus registros\n🎈 *"Eventos de hoy"* — qué hay programado hoy\n📅 *"Eventos de la Semana"* — agenda completa de lunes a domingo\n🔍 El *nombre de un evento* (ej. "días y horario de Zumba") — para ver cupo, fecha y horario\n\n📂 También puedes explorar el menú de la izquierda por categoría para ver el detalle completo de cualquier evento.\n\n¿Con cuál empezamos?` + "\n\n" + mensajeBotonesBienvenida();
  }

  return null; // sin match local (o mención del evento sin intención operativa) -> se consulta a la IA
}

// Router unificado: TODO mensaje del usuario (venga de texto escrito o de un botón
// de acción rápida) pasa por aquí, en el mismo orden de prioridad. Antes, los
// botones de acción rápida (sidebar y mensaje de bienvenida) llamaban directo a
// responderMensajeLocal() y se saltaban la detección de "mis registros" / "cancelar
// mi registro" / flujos en curso — por eso un botón "Mis registros" no funcionaba.
async function procesarMensajeUsuario(txt) {
  if (registroEnCurso) {
    await continuarFlujoRegistro(txt);
    return;
  }
  if (consultaEnCurso) {
    await continuarConsultaPropia(txt);
    return;
  }
  if (normalizarTexto(txt) === "cambiar depto" || normalizarTexto(txt) === "olvidar depto") {
    deptoRecordado = null;
    addMessage("Listo, olvidé el depto guardado. La próxima vez que lo necesite te lo voy a preguntar de nuevo.", "bot");
    return;
  }
  if (detectarIntentCancelarPropio(txt) || detectarIntentConsultarPropio(txt)) {
    addMessage("Para eso usa el menú *Consultar mis registros o realizar cancelación* — así verificamos que eres tú antes de mostrar o modificar cualquier registro:", "bot");
    window.abrirModalEventoRegistro("verificar_identidad");
    return;
  }

  const respuestaLocal = responderMensajeLocal(txt);
  if (respuestaLocal !== null) {
    setTimeout(() => { addMessage(respuestaLocal, "bot"); }, 400);
    return;
  }

  // Nada de lo anterior hizo match: se consulta al agente IA (Gemini vía Apps Script)
  // como último recurso, mostrando un mensaje temporal mientras responde. Si Gemini
  // falla (cuota, modelo caído, timeout, etc.) se elimina el mensaje temporal y se
  // cae al mensaje de ayuda fijo con los 4 botones, en vez de mostrar un error crudo.
  const pensando = addMessage("🤖 Consultando al asistente IA…", "bot");
  const respuestaIA = await preguntarAgenteIA(txt);
  if (pensando && pensando.parentNode) pensando.remove();

  if (respuestaIA) {
    addMessage(`🤖 ${respuestaIA}`, "bot");
    return;
  }

  const respuestaSinMatch = `🤔 No pude generarte una respuesta para eso ahora mismo. Puedo ayudarte con:\n\n🎟️ *Registrarme a Evento* — para registrarte, consultar o cancelar\n🎈 *"Eventos de hoy"* — qué hay programado hoy\n📅 *"Eventos de la Semana"* — agenda completa\n🔍 El *nombre de un evento* (ej. "días y horario de Zumba")\n\n📂 También puedes usar el menú de la izquierda por categoría.\n\n¿Qué te gustaría hacer?` + "\n\n" + mensajeBotonesBienvenida();
  addMessage(respuestaSinMatch, "bot");
}

if (chatForm) {
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt) return;
    addMessage(txt, "user");
    chatInput.value = "";
    await procesarMensajeUsuario(txt);
  });
}

window.handleQuickAction = async function(accion) {
  addMessage(accion, "user");
  await procesarMensajeUsuario(accion);
};

// ---------- Panel Admin (modal): creación / cancelación de eventos, protegido con PIN ----------
let adminState = { paso: "pin", pin: null, categoria: null, evento: null };

window.abrirPanelAdmin = function() {
  adminState = { paso: "pin", pin: null, categoria: null, evento: null };
  const modal = document.getElementById("modalAdmin");
  if (modal) modal.classList.remove("hidden");
  renderAdminPanel();
};

window.cerrarModalAdmin = function() {
  const modal = document.getElementById("modalAdmin");
  if (modal) modal.classList.add("hidden");
};

function renderAdminPanel() {
  const body = document.getElementById("adminBody");
  if (!body) return;

  // ---- Paso 1: PIN ----
  if (adminState.paso === "pin") {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">Ingresa el PIN de administración del Comité:</p>
      <input id="adminPinInput" type="password" autocomplete="off"
        class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-brand-500/40" placeholder="PIN">
      <p id="adminPinError" class="text-xs text-red-600 font-bold mb-2 hidden">PIN incorrecto. Intenta de nuevo.</p>
      <button id="adminPinContinuar" class="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Continuar</button>
    `;
    const input = document.getElementById("adminPinInput");
    const errorEl = document.getElementById("adminPinError");
    const btn = document.getElementById("adminPinContinuar");
    const continuar = async () => {
      const pin = input.value.trim();
      if (!pin) return;
      errorEl.classList.add("hidden");
      btn.disabled = true;
      btn.textContent = "Verificando…";
      try {
        const url = `${URL_AGENTE_EVENTOS}?accion=validar_pin&pin=${encodeURIComponent(pin)}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
          adminState.pin = pin;
          adminState.paso = "menu";
          renderAdminPanel();
        } else {
          errorEl.classList.remove("hidden");
          btn.disabled = false;
          btn.textContent = "Continuar";
          input.select();
        }
      } catch (err) {
        errorEl.textContent = "Error de conexión: " + err.toString();
        errorEl.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Continuar";
      }
    };
    btn.addEventListener("click", continuar);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") continuar(); });
    input.focus();
    return;
  }

  // ---- Paso 2: Menú ----
  if (adminState.paso === "menu") {
    body.innerHTML = `
      <div class="space-y-2">
        <button id="adminBtnCrear" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-lg py-2.5 transition">➕ Crear evento</button>
        <button id="adminBtnCancelar" class="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg py-2.5 transition">🛑 Cancelar evento</button>
        <button id="adminBtnBajaResidente" class="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg py-2.5 transition">🙅 Dar de baja a un residente</button>
      </div>
    `;
    document.getElementById("adminBtnCrear").addEventListener("click", () => { adminState.paso = "crear"; renderAdminPanel(); });
    document.getElementById("adminBtnCancelar").addEventListener("click", () => { adminState.paso = "cancelar_categoria"; renderAdminPanel(); });
    document.getElementById("adminBtnBajaResidente").addEventListener("click", () => { adminState.paso = "baja_categoria"; renderAdminPanel(); });
    return;
  }

  // ---- Paso 3a: Crear evento (con date/time/ubicación pickers) ----
  if (adminState.paso === "crear") {
    body.innerHTML = `
      <div class="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Categoría</label>
          <select id="fCategoria" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            ${Object.keys(CATEGORIAS).map(c => `<option value="${c}">${CATEGORIAS[c].emoji} ${CATEGORIAS[c].labelSidebar}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Nombre del evento</label>
          <input id="fNombre" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Descripción</label>
          <textarea id="fDescripcion" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"></textarea>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Fecha</label>
          <input id="fFecha" type="date" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
            <input id="fSinHora" type="checkbox" class="rounded border-slate-300 text-brand-600 focus:ring-brand-500">
            Sin hora específica (ej. eventos de fin de mes)
          </label>
        </div>
        <div id="wrapperHoras" class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-xs font-bold text-slate-500 mb-1">Hora inicio</label>
            <input id="fHoraInicio" type="time" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-500 mb-1">Hora fin</label>
            <input id="fHoraFin" type="time" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Ubicación</label>
          <select id="fUbicacion" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            ${UBICACIONES.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
            <input id="fTieneCosto" type="checkbox" class="rounded border-slate-300 text-brand-600 focus:ring-brand-500">
            Este evento tiene costo (no se pide el monto, solo se avisa en el detalle)
          </label>
        </div>
        <div>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
            <input id="fSinCupo" type="checkbox" class="rounded border-slate-300 text-brand-600 focus:ring-brand-500">
            Sin límite de cupo (ej. donativos, colectas)
          </label>
        </div>
        <div id="wrapperCupo">
          <label class="block text-xs font-bold text-slate-500 mb-1">Cupo total (por sesión si es recurrente)</label>
          <input id="fCupo" type="number" min="1" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Excepción de personas por depto (opcional)</label>
          <input id="fHuellasMaxDepto" type="number" min="1" placeholder="Vacío = usa el máximo real de huellas del depto" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <p class="text-[10px] text-slate-400 mt-1">Por default, cada depto puede registrar hasta el número de huellas que tiene asignadas en la pestaña "Departamentos" del Sheet (titular + acompañantes cuentan como huellas). Llena este campo SOLO si este evento en particular necesita un tope distinto (ej. máximo 2 por depto aunque el depto tenga más huellas).</p>
        </div>
        <div class="border-t border-slate-100 pt-2.5">
          <label class="block text-xs font-bold text-slate-500 mb-1.5">¿Se repite cada semana? (ej. Zumba Lun/Mié/Sáb)</label>
          <p class="text-[10px] text-slate-400 mb-2">Cada sesión tendrá su propio cupo independiente (el de arriba), no uno compartido para toda la serie.</p>
          <div class="flex flex-wrap gap-1.5 mb-2">
            ${DIAS_CHECKBOX.map(d => `
              <label class="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 cursor-pointer">
                <input type="checkbox" class="fDiaSemana rounded border-slate-300 text-brand-600 focus:ring-brand-500" value="${d}"> ${d}
              </label>`).join("")}
          </div>
          <div id="wrapperFechaFin" class="hidden">
            <label class="block text-xs font-bold text-slate-500 mb-1">Fecha fin de la serie</label>
            <input id="fFechaFin" type="date" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            <p class="text-[10px] text-slate-400 mt-1">La fecha de arriba es el inicio; se repetirá en los días marcados hasta esta fecha.</p>
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-4">
        <button id="adminBtnVolverMenu1" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="adminBtnGuardarEvento" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Crear evento</button>
      </div>
    `;
    document.querySelectorAll(".fDiaSemana").forEach(chk => {
      chk.addEventListener("change", () => {
        const algunoMarcado = Array.from(document.querySelectorAll(".fDiaSemana")).some(c => c.checked);
        document.getElementById("wrapperFechaFin").classList.toggle("hidden", !algunoMarcado);
      });
    });
    document.getElementById("fSinHora").addEventListener("change", (e) => {
      const wrapper = document.getElementById("wrapperHoras");
      const hi = document.getElementById("fHoraInicio");
      const hf = document.getElementById("fHoraFin");
      if (e.target.checked) {
        wrapper.classList.add("opacity-40", "pointer-events-none");
        hi.value = ""; hf.value = "";
      } else {
        wrapper.classList.remove("opacity-40", "pointer-events-none");
      }
    });
    document.getElementById("fSinCupo").addEventListener("change", (e) => {
      const wrapper = document.getElementById("wrapperCupo");
      const cupoInput = document.getElementById("fCupo");
      if (e.target.checked) {
        wrapper.classList.add("opacity-40", "pointer-events-none");
        cupoInput.value = "";
      } else {
        wrapper.classList.remove("opacity-40", "pointer-events-none");
      }
    });
    document.getElementById("adminBtnVolverMenu1").addEventListener("click", () => { adminState.paso = "menu"; renderAdminPanel(); });
    document.getElementById("adminBtnGuardarEvento").addEventListener("click", crearEventoDesdeAdmin);
    return;
  }

  // ---- Paso 3b-1: Cancelar — elegir categoría ----
  if (adminState.paso === "cancelar_categoria") {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">¿De qué categoría es el evento a cancelar?</p>
      <div class="space-y-2">
        ${Object.keys(CATEGORIAS).map(c => `<button class="admin-cat-btn w-full text-left bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg px-3 py-2.5 transition" data-cat="${c}">${CATEGORIAS[c].emoji} ${CATEGORIAS[c].labelSidebar}</button>`).join("")}
      </div>
      <button id="adminBtnVolverMenu2" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    document.querySelectorAll(".admin-cat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        adminState.categoria = btn.getAttribute("data-cat");
        adminState.paso = "cancelar_lista";
        renderAdminPanel();
      });
    });
    document.getElementById("adminBtnVolverMenu2").addEventListener("click", () => { adminState.paso = "menu"; renderAdminPanel(); });
    return;
  }

  // ---- Paso 3b-2: Cancelar — elegir evento de una lista (ya no se escribe el ID a mano) ----
  if (adminState.paso === "cancelar_lista") {
    const activos = (DATA[adminState.categoria] || []).filter(e => e.estado.toLowerCase() === "activo")
      .sort((a, b) => parseFechaLocal(a.fecha) - parseFechaLocal(b.fecha));
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">Eventos activos en <strong>${adminState.categoria}</strong>:</p>
      <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        ${activos.length ? activos.map(ev => `
          <button class="admin-ev-btn w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 transition" data-id="${ev.eventoid}">
            <span class="font-bold text-slate-800 text-sm block">${esRecurrente(ev) ? "🔁 " : ""}${escapeHtml(ev.nombre)}</span>
            <span class="text-xs text-slate-500">${ev.fecha} · ${horarioTexto(ev)} · ${escapeHtml(ev.ubicacion || "N/A")}</span>
          </button>`).join("")
          : `<p class="text-xs text-slate-400">No hay eventos activos en esta categoría.</p>`}
      </div>
      <button id="adminBtnVolverCat" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    document.querySelectorAll(".admin-ev-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        adminState.evento = activos.find(e => e.eventoid === btn.getAttribute("data-id"));
        adminState.paso = "cancelar_confirmar";
        renderAdminPanel();
      });
    });
    document.getElementById("adminBtnVolverCat").addEventListener("click", () => { adminState.paso = "cancelar_categoria"; renderAdminPanel(); });
    return;
  }

  // ---- Paso 3b-3: Cancelar — confirmación con detalles del evento ----
  if (adminState.paso === "cancelar_confirmar") {
    const ev = adminState.evento;
    const recurrente = esRecurrente(ev);
    const info = recurrente ? null : cupoInfo(ev, ev.fecha);
    const fecha = ev.fecha ? formatearFecha(parseFechaLocal(ev.fecha)) : "Sin fecha";
    body.innerHTML = `
      <p class="text-sm font-bold text-red-700 mb-2">⚠️ Vas a cancelar este evento:</p>
      <div class="bg-red-50 border border-red-100 rounded-lg p-3 mb-3 text-sm text-slate-700 space-y-1">
        <p class="font-bold text-slate-800">${escapeHtml(ev.nombre)}</p>
        <p>Categoría: ${ev.categoria}</p>
        <p>Fecha: ${fecha} · ${horarioTexto(ev)}</p>
        <p>Lugar: ${escapeHtml(ev.ubicacion || "N/A")}</p>
        ${info ? `<p>${info.texto}</p>` : ""}
        ${recurrente ? `<p class="text-amber-700 font-bold">${recurrenciaTexto(ev)} — se cancela TODA la serie, no solo la próxima sesión.</p>` : ""}
      </div>
      <p class="text-xs text-slate-500 mb-3">Esta acción no se puede deshacer desde aquí. Los residentes ya registrados no reciben notificación automática — avísales por otro medio si aplica.</p>
      <div class="flex gap-2">
        <button id="adminBtnVolverLista" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="adminBtnConfirmarCancelar" class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Confirmar cancelación</button>
      </div>
    `;
    document.getElementById("adminBtnVolverLista").addEventListener("click", () => { adminState.paso = "cancelar_lista"; renderAdminPanel(); });
    document.getElementById("adminBtnConfirmarCancelar").addEventListener("click", confirmarCancelacionDesdeAdmin);
    return;
  }

  // ---- Baja de residente, paso 1: elegir categoría ----
  if (adminState.paso === "baja_categoria") {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">¿De qué categoría es el evento?</p>
      <div class="space-y-2">
        ${Object.keys(CATEGORIAS).map(c => `<button class="admin-cat-btn w-full text-left bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg px-3 py-2.5 transition" data-cat="${c}">${CATEGORIAS[c].emoji} ${CATEGORIAS[c].labelSidebar}</button>`).join("")}
      </div>
      <button id="adminBtnVolverMenu3" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    document.querySelectorAll(".admin-cat-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        adminState.categoria = btn.getAttribute("data-cat");
        adminState.paso = "baja_evento";
        renderAdminPanel();
      });
    });
    document.getElementById("adminBtnVolverMenu3").addEventListener("click", () => { adminState.paso = "menu"; renderAdminPanel(); });
    return;
  }

  // ---- Baja de residente, paso 2: elegir el evento (activos, con o sin recurrencia) ----
  if (adminState.paso === "baja_evento") {
    const activos = (DATA[adminState.categoria] || []).filter(e => e.estado.toLowerCase() === "activo")
      .sort((a, b) => parseFechaLocal(a.fecha) - parseFechaLocal(b.fecha));
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">¿De qué evento quieres dar de baja a un residente?</p>
      <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        ${activos.length ? activos.map(ev => `
          <button class="admin-ev-btn w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 transition" data-id="${ev.eventoid}">
            <span class="font-bold text-slate-800 text-sm block">${esRecurrente(ev) ? "🔁 " : ""}${escapeHtml(ev.nombre)}</span>
            <span class="text-xs text-slate-500">${ev.fecha} · ${horarioTexto(ev)} · ${escapeHtml(ev.ubicacion || "N/A")}</span>
          </button>`).join("")
          : `<p class="text-xs text-slate-400">No hay eventos activos en esta categoría.</p>`}
      </div>
      <button id="adminBtnVolverCat3" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    document.querySelectorAll(".admin-ev-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        adminState.evento = activos.find(e => e.eventoid === btn.getAttribute("data-id"));
        adminState.paso = "baja_depto";
        renderAdminPanel();
      });
    });
    document.getElementById("adminBtnVolverCat3").addEventListener("click", () => { adminState.paso = "baja_categoria"; renderAdminPanel(); });
    return;
  }

  // ---- Baja de residente, paso 3: indicar el depto y confirmar ----
  if (adminState.paso === "baja_depto") {
    const ev = adminState.evento;
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-2">Evento: <strong>${escapeHtml(ev.nombre)}</strong>${esRecurrente(ev) ? ` (${recurrenciaTexto(ev)})` : ""}</p>
      <label class="block text-xs font-bold text-slate-500 mb-1">Número de departamento</label>
      <input id="fBajaDepto" type="text" placeholder="ej. 3801 o 605" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-2">
      <p class="text-[11px] text-slate-400 mb-3">Se cancelarán TODAS las sesiones futuras confirmadas de este depto para este evento (a partir de hoy). Las sesiones ya pasadas no se tocan — quedan como historial.</p>
      <div class="flex gap-2">
        <button id="adminBtnVolverEvento3" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="adminBtnConfirmarBaja" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Dar de baja</button>
      </div>
      <div id="bajaResultado" class="mt-3 text-xs"></div>
    `;
    document.getElementById("adminBtnVolverEvento3").addEventListener("click", () => { adminState.paso = "baja_evento"; renderAdminPanel(); });
    document.getElementById("adminBtnConfirmarBaja").addEventListener("click", darDeBajaDesdeAdmin);
    return;
  }
}

async function crearEventoDesdeAdmin() {
  const btn = document.getElementById("adminBtnGuardarEvento");
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "Guardando…"; }

  const categoria = document.getElementById("fCategoria").value;
  const nombre = document.getElementById("fNombre").value.trim();
  const descripcion = document.getElementById("fDescripcion").value.trim();
  const fecha = document.getElementById("fFecha").value;
  const horaInicio = document.getElementById("fHoraInicio").value;
  const horaFin = document.getElementById("fHoraFin").value;
  const ubicacion = document.getElementById("fUbicacion").value;
  const sinCupo = document.getElementById("fSinCupo").checked;
  const cupoTotal = sinCupo ? "" : (document.getElementById("fCupo").value || "0");
  const tieneCosto = document.getElementById("fTieneCosto").checked;
  const huellasMaxDepto = document.getElementById("fHuellasMaxDepto").value.trim();
  const diasSeleccionados = Array.from(document.querySelectorAll(".fDiaSemana:checked")).map(c => c.value);
  const diasSemana = diasSeleccionados.join(",");
  const fechaFin = diasSeleccionados.length ? document.getElementById("fFechaFin").value : "";

  if (!nombre || !fecha) {
    alert("Nombre y fecha son obligatorios.");
    if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
    return;
  }
  if (!sinCupo && (!cupoTotal || Number(cupoTotal) <= 0)) {
    alert("Indica un cupo total mayor a 0, o marca \"Sin límite de cupo\".");
    if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
    return;
  }
  if (diasSeleccionados.length && !fechaFin) {
    alert("Marcaste días de repetición: indica la fecha fin de la serie.");
    if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
    return;
  }
  if (diasSeleccionados.length && fechaFin < fecha) {
    alert("La fecha fin no puede ser anterior a la fecha de inicio.");
    if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
    return;
  }

  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=crear_evento&pin=${encodeURIComponent(adminState.pin)}&categoria=${encodeURIComponent(categoria)}&nombre=${encodeURIComponent(nombre)}&descripcion=${encodeURIComponent(descripcion)}&fecha=${encodeURIComponent(fecha)}&horaInicio=${encodeURIComponent(horaInicio)}&horaFin=${encodeURIComponent(horaFin)}&ubicacion=${encodeURIComponent(ubicacion)}&cupoTotal=${encodeURIComponent(cupoTotal)}&sinCupo=${sinCupo ? "1" : "0"}&tieneCosto=${tieneCosto ? "1" : "0"}&diasSemana=${encodeURIComponent(diasSemana)}&fechaFin=${encodeURIComponent(fechaFin)}&huellasMaxDepto=${encodeURIComponent(huellasMaxDepto)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      alert(`Evento creado: ${data.eventoId}`);
      window.cerrarModalAdmin();
      inicializar();
    } else {
      alert(data.error || "No se pudo crear el evento. Verifica el PIN.");
      if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
    }
  } catch (err) {
    alert("Error de conexión: " + err.toString());
    if (btn) { btn.disabled = false; btn.textContent = "Crear evento"; }
  }
}

async function confirmarCancelacionDesdeAdmin() {
  const btn = document.getElementById("adminBtnConfirmarCancelar");
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "Cancelando…"; }

  const ev = adminState.evento;
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=cancelar_evento&pin=${encodeURIComponent(adminState.pin)}&categoria=${encodeURIComponent(ev.categoria)}&eventoId=${encodeURIComponent(ev.eventoid)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      alert("Evento cancelado correctamente.");
      window.cerrarModalAdmin();
      inicializar();
    } else {
      alert(data.error || "No se pudo cancelar el evento. Verifica el PIN.");
      if (btn) { btn.disabled = false; btn.textContent = "Confirmar cancelación"; }
    }
  } catch (err) {
    alert("Error de conexión: " + err.toString());
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar cancelación"; }
  }
}

async function darDeBajaDesdeAdmin() {
  const btn = document.getElementById("adminBtnConfirmarBaja");
  const resultadoEl = document.getElementById("bajaResultado");
  const depto = document.getElementById("fBajaDepto").value.trim();
  if (!depto) { alert("Indica el número de departamento."); return; }
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = "Procesando…"; }

  const ev = adminState.evento;
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=cancelar_registro_depto&pin=${encodeURIComponent(adminState.pin)}&eventoId=${encodeURIComponent(ev.eventoid)}&categoria=${encodeURIComponent(ev.categoria)}&depto=${encodeURIComponent(depto)}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      if (data.totalCanceladas > 0) {
        const fechas = data.detalle.map(d => formatearFecha(parseFechaLocal(d.fecha))).join(", ");
        resultadoEl.innerHTML = `<p class="text-emerald-700 font-bold">✅ Se dieron de baja ${data.totalCanceladas} sesión(es) futuras del depto ${depto}: ${fechas}.</p>`;
      } else {
        resultadoEl.innerHTML = `<p class="text-slate-500">El depto ${depto} no tenía sesiones futuras confirmadas para este evento.</p>`;
      }
      refrescarCuposLive();
      cargarCsv(URL_REGISTROS_CSV); // refresca en segundo plano, sin bloquear la UI
    } else {
      resultadoEl.innerHTML = `<p class="text-red-600 font-bold">${data.error || "No se pudo procesar. Verifica el PIN."}</p>`;
    }
  } catch (err) {
    resultadoEl.innerHTML = `<p class="text-red-600 font-bold">Error de conexión: ${err.toString()}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Dar de baja"; }
  }
}

// ---------- Calendario Mensual de Eventos ----------
let calendarioState = null;
let calendarioItemsActuales = [];
let calendarioDiasActuales = {};
let calendarioListenerAttached = false;

function renderCalendario(anio, mes) {
  const body = document.getElementById("calendarioBody");
  const label = document.getElementById("calendarioMesLabel");
  if (!body || !label) return;

  label.textContent = `${MESES_LARGOS[mes]} ${anio}`;
  calendarioItemsActuales = [];
  calendarioDiasActuales = {};

  const porDia = {};
  const inicioMes = new Date(anio, mes, 1, 12, 0, 0);
  const finMes = new Date(anio, mes + 1, 0, 12, 0, 0);
  todosLosEventos().forEach(ev => {
    if (ev.estado.toLowerCase() !== "activo") return;
    const ocurrencias = generarOcurrenciasEnRango(ev, inicioMes, finMes);
    ocurrencias.forEach(fechaOcurrencia => {
      const dia = fechaOcurrencia.getDate();
      if (!porDia[dia]) porDia[dia] = [];
      // Cada ocurrencia lleva su propia fecha de sesión (clave para el cupo por sesión)
      porDia[dia].push({ ...ev, _fechaSesion: fechaISO(fechaOcurrencia) });
    });
  });

  const primerDiaSemana = new Date(anio, mes, 1).getDay();
  const totalDias = new Date(anio, mes + 1, 0).getDate();

  let html = `<div class="grid grid-cols-7 gap-1 mb-2">`;
  DIAS_SEMANA_CORTOS.forEach(d => { html += `<div class="text-center text-[10px] font-bold text-slate-400">${d}</div>`; });
  html += `</div><div class="grid grid-cols-7 gap-1">`;

  for (let i = 0; i < primerDiaSemana; i++) html += `<div></div>`;

  const hoy = new Date();
  const esMesActual = hoy.getFullYear() === anio && hoy.getMonth() === mes;

  for (let dia = 1; dia <= totalDias; dia++) {
    const items = (porDia[dia] || []).slice().sort((a, b) => (a.horainicio || "").localeCompare(b.horainicio || ""));
    calendarioDiasActuales[dia] = items;
    const esHoy = esMesActual && hoy.getDate() === dia;
    html += `<div class="calendario-dia cursor-pointer border border-slate-100 rounded-lg p-1 min-h-[70px] hover:border-brand-300 transition ${esHoy ? "bg-brand-50 border-brand-300" : "bg-white"}" data-dia="${dia}">
      <div class="text-[10px] font-bold ${esHoy ? "text-brand-700" : "text-slate-400"}">${dia}</div>`;
    items.slice(0, 3).forEach(item => {
      const cfg = CATEGORIAS[item.categoria];
      const idx = calendarioItemsActuales.length;
      calendarioItemsActuales.push(item);
      html += `<div class="calendario-item cursor-pointer text-[9px] ${cfg ? cfg.colorClaro : "bg-slate-100 text-slate-700"} rounded px-1 py-0.5 mt-0.5 truncate transition" data-idx="${idx}" title="${escapeHtml(item.nombre)}">${esRecurrente(item) ? "🔁 " : ""}${escapeHtml(item.nombre)}</div>`;
    });
    if (items.length > 3) html += `<div class="text-[9px] text-slate-400 mt-0.5">+${items.length - 3} más</div>`;
    html += `</div>`;
  }
  html += `</div>`;
  body.innerHTML = html;
}

function attachCalendarioListener() {
  if (calendarioListenerAttached) return;
  document.addEventListener("click", (e) => {
    const itemTarget = e.target.closest(".calendario-item");
    if (itemTarget) {
      const idx = Number(itemTarget.getAttribute("data-idx"));
      const item = calendarioItemsActuales[idx];
      if (item) mostrarDetalleCalendario(item);
      return;
    }
    const diaTarget = e.target.closest(".calendario-dia");
    if (diaTarget) {
      const dia = Number(diaTarget.getAttribute("data-dia"));
      if (dia) renderVistaDia(dia);
    }
  });
  calendarioListenerAttached = true;
}

function renderVistaDia(dia) {
  const body = document.getElementById("calendarioBody");
  const label = document.getElementById("calendarioMesLabel");
  if (!body || !calendarioState) return;

  label.textContent = `${dia} de ${MESES_LARGOS[calendarioState.month]} ${calendarioState.year}`;
  const items = calendarioDiasActuales[dia] || [];
  let html = `<button class="volver-mes-btn mb-3 text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1">← Volver al mes</button>`;

  if (!items.length) {
    html += `<p class="text-sm text-slate-500">No hay eventos programados este día.</p>`;
  } else {
    html += items.map(item => {
      const cfg = CATEGORIAS[item.categoria];
      const info = cupoInfo(item, item._fechaSesion);
      const idxGlobal = calendarioItemsActuales.length;
      calendarioItemsActuales.push(item);
      return `<div class="calendario-item cursor-pointer border ${cfg ? cfg.colorDia : "bg-slate-50 border-slate-200"} rounded-lg px-3 py-2 mb-2 hover:opacity-80 transition" data-idx="${idxGlobal}">
        <p class="text-sm font-bold text-slate-800">${cfg ? cfg.emoji : ""} ${esRecurrente(item) ? "🔁 " : ""}${escapeHtml(item.nombre)}</p>
        <p class="text-xs text-slate-500">${item.categoria} · ${horarioTexto(item)} · ${item.ubicacion || "N/A"}</p>
        <p class="text-xs font-bold ${info.lleno ? "text-red-500" : "text-emerald-600"} mt-0.5">${info.lleno ? "🔴" : "🟢"} ${info.texto}</p>
      </div>`;
    }).join("");
  }
  body.innerHTML = html;

  const volverBtn = body.querySelector(".volver-mes-btn");
  if (volverBtn) volverBtn.addEventListener("click", () => renderCalendario(calendarioState.year, calendarioState.month));
}

function mostrarDetalleCalendario(item) {
  const modal = document.getElementById("modalDetalleCalendario");
  const body = document.getElementById("detalleCalendarioBody");
  if (!modal || !body) return;
  const fechaSesion = item._fechaSesion || item.fecha;
  const info = cupoInfo(item, fechaSesion);
  const cfg = CATEGORIAS[item.categoria];
  const fecha = fechaSesion ? formatearFecha(parseFechaLocal(fechaSesion)) : "Sin fecha";

  let html = `<p class="text-sm font-bold text-slate-800 mb-2">${cfg ? cfg.emoji : ""} ${esRecurrente(item) ? "🔁 " : ""}${escapeHtml(item.nombre)}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Categoría:</strong> ${escapeHtml(item.categoria)}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">${esRecurrente(item) ? "Fecha de esta sesión" : "Fecha"}:</strong> ${fecha}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Horario:</strong> ${horarioTexto(item)}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Lugar:</strong> ${escapeHtml(item.ubicacion || "N/A")}</p>`;
  if (item.tienecosto) html += `<p class="text-xs font-bold text-amber-600 mb-1.5">💰 Este evento tiene costo (consulta el monto con el Comité)</p>`;
  const recTexto = recurrenciaTexto(item);
  if (recTexto) html += `<p class="text-xs font-bold text-indigo-600 mb-1.5">${recTexto}</p>`;
  html += `<p class="text-xs mb-1.5"><span class="font-bold ${info.lleno ? "text-red-500" : "text-emerald-600"}">${info.lleno ? "🔴" : "🟢"} ${info.texto}</span></p>`;
  if (item.descripcion) html += `<p class="text-xs text-slate-600 mb-2"><strong class="text-slate-800">Descripción:</strong> ${escapeHtml(item.descripcion)}</p>`;

  if (info.lleno) {
    html += `<button disabled class="mt-2 w-full text-xs font-bold text-slate-400 bg-slate-100 rounded-lg px-3 py-2 cursor-not-allowed">Cupo lleno</button>`;
  } else {
    html += `<button id="btnRegistrarDesdeCalendario" class="mt-2 w-full text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-2 transition">✅ Registrarme${esRecurrente(item) ? ` a esta sesión (${fecha})` : ""}</button>`;
  }

  body.innerHTML = html;
  modal.classList.remove("hidden");

  const btnRegistrar = document.getElementById("btnRegistrarDesdeCalendario");
  if (btnRegistrar) {
    btnRegistrar.addEventListener("click", () => {
      window.cerrarDetalleCalendario();
      window.cerrarModalCalendario();
      window.iniciarRegistro(item.eventoid, item.categoria, item.nombre, fechaSesion);
    });
  }
}

window.cerrarDetalleCalendario = function() {
  const modal = document.getElementById("modalDetalleCalendario");
  if (modal) modal.classList.add("hidden");
};

window.abrirModalCalendario = function() {
  const modal = document.getElementById("modalCalendario");
  if (!modal) return;
  if (!calendarioState) {
    const hoy = new Date();
    calendarioState = { year: hoy.getFullYear(), month: hoy.getMonth() };
  }
  modal.classList.remove("hidden");
  renderCalendario(calendarioState.year, calendarioState.month);
  attachCalendarioListener();
};

window.cerrarModalCalendario = function() {
  const modal = document.getElementById("modalCalendario");
  if (modal) modal.classList.add("hidden");
};

window.cambiarMesCalendario = function(delta) {
  if (!calendarioState) return;
  let { year, month } = calendarioState;
  month += delta;
  if (month > 11) { month = 0; year++; }
  if (month < 0) { month = 11; year--; }
  calendarioState = { year, month };
  renderCalendario(year, month);
};

window.irMesActualCalendario = function() {
  const hoy = new Date();
  calendarioState = { year: hoy.getFullYear(), month: hoy.getMonth() };
  renderCalendario(calendarioState.year, calendarioState.month);
};

// =====================================================================
// MODAL "Registrarme a Evento" — flujo completo por menús. Reemplaza el
// registro/consulta/cancelación que antes vivían en el chat como conversación
// paso a paso. El chat con IA (Gemini/OpenRouter) para preguntas abiertas y las
// respuestas informativas (hoy/semana/categoría) NO se tocan.
// =====================================================================

function estadoInicialRegModal() {
  return {
    paso: "menu",
    categoria: null,
    evento: null,
    fechaUnica: null,
    fechasDisponiblesMes: [],
    fechasSeleccionadas: [],
    depto: "",
    nombreAsistente: "",
    tieneAcompanantes: false,
    numAcompanantes: 0,
    nombresAcompanantes: "",
    fotoBase64: null,
    fotoMime: null,
    fotoNombre: null,
    aceptaTerminos: false,
    mostrandoConfirmacion: false,
    errorFormulario: null,
    huellasInfo: null,
    enviando: false,
    resultadoData: null,
    deptoConsulta: "",
    nombreConsulta: "",
    registros: [],
    registroSeleccionado: null,
    errorVerificacion: null,
    buscando: false,
    nuevoNumAcomp: 0,
    nuevosNombresAcomp: ""
  };
}

let regModal = estadoInicialRegModal();

window.abrirModalEventoRegistro = function(pasoInicial) {
  const depto = regModal ? regModal.deptoConsulta : "";
  const nombre = regModal ? regModal.nombreConsulta : "";
  regModal = estadoInicialRegModal();
  if (pasoInicial) regModal.paso = pasoInicial;
  if (pasoInicial === "verificar_identidad") {
    regModal.deptoConsulta = depto || deptoRecordado || "";
    regModal.nombreConsulta = nombre || nombreRecordado || "";
  }
  const modal = document.getElementById("modalEventoRegistro");
  if (modal) modal.classList.remove("hidden");
  renderModalEventoRegistro();
};

window.cerrarModalEventoRegistro = function() {
  const modal = document.getElementById("modalEventoRegistro");
  if (modal) modal.classList.add("hidden");
};

function abrirFormularioEvento(evento, fechaUnica) {
  regModal = estadoInicialRegModal();
  regModal.categoria = evento.categoria;
  regModal.evento = evento;
  regModal.paso = "formulario";
  if (fechaUnica) {
    regModal.fechaUnica = fechaUnica;
  } else if (esRecurrente(evento)) {
    regModal.fechasDisponiblesMes = ocurrenciasDelMesActual(evento).map(f => fechaISO(f));
  }
  if (deptoRecordado) regModal.depto = deptoRecordado;
  if (nombreRecordado) regModal.nombreAsistente = nombreRecordado;

  const modal = document.getElementById("modalEventoRegistro");
  if (modal) modal.classList.remove("hidden");
  renderModalEventoRegistro();
}

function seleccionarEventoDesdeLista(evento) {
  regModal.evento = evento;
  regModal.fechaUnica = null;
  regModal.fechasDisponiblesMes = esRecurrente(evento) ? ocurrenciasDelMesActual(evento).map(f => fechaISO(f)) : [];
  regModal.fechasSeleccionadas = [];
  if (deptoRecordado && !regModal.depto) regModal.depto = deptoRecordado;
  if (nombreRecordado && !regModal.nombreAsistente) regModal.nombreAsistente = nombreRecordado;
  regModal.paso = "formulario";
  renderModalEventoRegistro();
}

function infoEventoParaListaModal(evento) {
  if (!esRecurrente(evento)) {
    const info = cupoInfo(evento, evento.fecha);
    return { lleno: info.lleno, texto: info.texto, fechaTexto: formatearFecha(parseFechaLocal(evento.fecha)) };
  }
  const ocurrencias = ocurrenciasDelMesActual(evento);
  if (!ocurrencias.length) return { lleno: true, texto: "Sin sesiones este mes", fechaTexto: "Recurrente" };
  const todasLlenas = ocurrencias.every(f => cupoInfo(evento, fechaISO(f)).lleno);
  return { lleno: todasLlenas, texto: todasLlenas ? "Cupo Lleno" : `${ocurrencias.length} sesión(es) este mes`, fechaTexto: "Recurrente" };
}

function leerArchivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderModalEventoRegistro() {
  const body = document.getElementById("regBody");
  if (!body || !regModal) return;

  // ---- Menú principal ----
  if (regModal.paso === "menu") {
    body.innerHTML = `
      <div class="space-y-2">
        <button id="regBtnNuevo" class="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-3 transition">✅ Registrarme a un evento nuevo</button>
        <button id="regBtnConsultar" class="w-full bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-lg py-3 transition">📋 Consultar mis registros o realizar cancelación</button>
      </div>
    `;
    document.getElementById("regBtnNuevo").addEventListener("click", () => { regModal.paso = "categorias"; renderModalEventoRegistro(); });
    document.getElementById("regBtnConsultar").addEventListener("click", () => { regModal.paso = "verificar_identidad"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Categorías ----
  if (regModal.paso === "categorias") {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">¿A qué tipo de evento te quieres registrar?</p>
      <div class="space-y-2">
        ${Object.keys(CATEGORIAS).map(c => `<button class="reg-cat-btn w-full text-left bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg px-3 py-2.5 transition" data-cat="${c}">${CATEGORIAS[c].emoji} ${CATEGORIAS[c].labelSidebar}</button>`).join("")}
      </div>
      <button id="regBtnVolverMenu" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    document.querySelectorAll(".reg-cat-btn").forEach(btn => {
      btn.addEventListener("click", () => { regModal.categoria = btn.getAttribute("data-cat"); regModal.paso = "lista_eventos"; renderModalEventoRegistro(); });
    });
    document.getElementById("regBtnVolverMenu").addEventListener("click", () => { regModal.paso = "menu"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Lista de eventos del mes por categoría (costo/gratis, cupo/lleno) ----
  if (regModal.paso === "lista_eventos") {
    const cfg = CATEGORIAS[regModal.categoria];
    const eventos = (DATA[regModal.categoria] || []).filter(e => e.estado.toLowerCase() === "activo")
      .sort((a, b) => parseFechaLocal(a.fecha) - parseFechaLocal(b.fecha));
    body.innerHTML = `
      <p class="text-xs font-bold text-slate-500 mb-2">${cfg.emoji} ${cfg.labelSidebar} · eventos activos</p>
      <div class="space-y-2 max-h-[55vh] overflow-y-auto pr-1" id="regListaEventos"></div>
      <button id="regBtnVolverCat" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    const cont = document.getElementById("regListaEventos");
    if (!eventos.length) {
      cont.innerHTML = `<p class="text-xs text-slate-400">No hay eventos activos en esta categoría por ahora.</p>`;
    } else {
      eventos.forEach(ev => {
        const info = infoEventoParaListaModal(ev);
        const costoTag = ev.tienecosto ? `<span class="text-amber-600 font-bold">💰 Con costo</span>` : `<span class="text-emerald-600 font-bold">🆓 Gratis</span>`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.disabled = info.lleno;
        btn.className = `w-full text-left border rounded-lg px-3 py-2.5 transition ${info.lleno ? "bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed" : "bg-white border-slate-200 hover:border-brand-300 hover:bg-brand-50"}`;
        btn.innerHTML = `
          <p class="text-sm font-bold text-slate-800">${esRecurrente(ev) ? "🔁 " : ""}${escapeHtml(ev.nombre)}</p>
          <p class="text-[11px] text-slate-500">${info.fechaTexto} · ${horarioTexto(ev)} · ${escapeHtml(ev.ubicacion || "N/A")}</p>
          <p class="text-[11px] font-bold mt-0.5 flex items-center gap-2">${costoTag} <span class="${info.lleno ? "text-red-500" : "text-emerald-600"}">${info.lleno ? "🔴" : "🟢"} ${info.texto}</span></p>
        `;
        if (!info.lleno) btn.addEventListener("click", () => seleccionarEventoDesdeLista(ev));
        cont.appendChild(btn);
      });
    }
    document.getElementById("regBtnVolverCat").addEventListener("click", () => { regModal.paso = "categorias"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Formulario de registro ----
  if (regModal.paso === "formulario") { renderFormularioEvento(); return; }

  // ---- Resultado del registro ----
  if (regModal.paso === "resultado_ok") {
    const data = regModal.resultadoData || {};
    let detalleHtml;
    if (data.multiSesion) {
      const confirmadas = (data.detalle || []).filter(d => d.ok);
      const fallidas = (data.detalle || []).filter(d => !d.ok);
      detalleHtml = `<p class="text-xs text-slate-600 mb-2">Se confirmaron ${confirmadas.length} de ${data.totalSolicitadas} sesión(es) solicitadas.</p>`;
      if (fallidas.length) detalleHtml += `<p class="text-xs text-red-600 mb-2">⚠️ No se pudieron confirmar ${fallidas.length} sesión(es) (cupo o huellas agotadas).</p>`;
    } else {
      detalleHtml = `<p class="text-xs text-slate-600 mb-2">${escapeHtml(data.mensaje || "")}</p>`;
    }
    body.innerHTML = `
      <p class="text-sm font-bold text-emerald-700 mb-2">✅ ¡Registro confirmado!</p>
      ${detalleHtml}
      <div class="space-y-2 mt-3">
        <button id="regBtnOtroEvento" class="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Registrarme a otro evento</button>
        <button id="regBtnVerMisRegistros" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">Ver mis registros</button>
        <button id="regBtnCerrar" class="w-full bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">Cerrar</button>
      </div>
    `;
    document.getElementById("regBtnOtroEvento").addEventListener("click", () => { regModal.paso = "categorias"; renderModalEventoRegistro(); });
    document.getElementById("regBtnVerMisRegistros").addEventListener("click", () => { regModal.paso = "verificar_identidad"; renderModalEventoRegistro(); });
    document.getElementById("regBtnCerrar").addEventListener("click", window.cerrarModalEventoRegistro);
    return;
  }

  // ---- Verificación de identidad (depto + nombre) ----
  if (regModal.paso === "verificar_identidad") {
    body.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">Para ver o modificar tus registros, confírmanos con quién te registraste (así evitamos que alguien más los consulte o cancele):</p>
      <div class="space-y-2.5">
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Número de departamento</label>
          <input id="verDepto" type="text" inputmode="numeric" placeholder="Ej. 3801 o 605" value="${escapeHtml(regModal.deptoConsulta || "")}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Nombre con el que te registraste</label>
          <input id="verNombre" type="text" value="${escapeHtml(regModal.nombreConsulta || "")}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
      </div>
      ${regModal.errorVerificacion ? `<p class="text-xs font-bold text-red-600 mt-2">⚠️ ${escapeHtml(regModal.errorVerificacion)}</p>` : ""}
      <div class="flex gap-2 mt-3">
        <button id="regBtnVolverMenu2" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="regBtnBuscarRegistros" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">${regModal.buscando ? "Buscando…" : "Buscar mis registros"}</button>
      </div>
    `;
    document.getElementById("verDepto").addEventListener("input", (e) => regModal.deptoConsulta = e.target.value.trim());
    document.getElementById("verNombre").addEventListener("input", (e) => regModal.nombreConsulta = e.target.value);
    document.getElementById("regBtnVolverMenu2").addEventListener("click", () => { regModal.paso = "menu"; renderModalEventoRegistro(); });
    const btnBuscar = document.getElementById("regBtnBuscarRegistros");
    btnBuscar.disabled = regModal.buscando;
    btnBuscar.addEventListener("click", buscarMisRegistrosModal);
    return;
  }

  // ---- Lista de mis registros verificados ----
  if (regModal.paso === "lista_registros") {
    const registros = regModal.registros || [];
    body.innerHTML = `
      <p class="text-xs text-slate-500 mb-2">Depto ${escapeHtml(regModal.deptoConsulta)} · ${escapeHtml(regModal.nombreConsulta)}</p>
      <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-1" id="regListaRegistros"></div>
      <button id="regBtnVolverMenu3" class="w-full mt-3 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver</button>
    `;
    const cont = document.getElementById("regListaRegistros");
    if (!registros.length) {
      cont.innerHTML = `<p class="text-xs text-slate-400">No se encontraron registros futuros con esos datos.</p>`;
    } else {
      registros.forEach(r => {
        const cfg = CATEGORIAS[r.categoria];
        const fechaDate = parseFechaLocal(r.fechaSesion);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "w-full text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 transition";
        btn.innerHTML = `
          <p class="text-sm font-bold text-slate-800">${cfg ? cfg.emoji : "📌"} ${escapeHtml(r.nombreEvento)}</p>
          <p class="text-[11px] text-slate-500">${formatearFecha(fechaDate)}${r.numAcompanantes > 0 ? ` · 👥 +${r.numAcompanantes} acompañante(s)` : ""}</p>
        `;
        btn.addEventListener("click", () => { regModal.registroSeleccionado = r; regModal.errorFormulario = null; regModal.paso = "detalle_registro"; renderModalEventoRegistro(); });
        cont.appendChild(btn);
      });
    }
    document.getElementById("regBtnVolverMenu3").addEventListener("click", () => { regModal.paso = "menu"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Detalle de un registro ----
  if (regModal.paso === "detalle_registro") {
    const r = regModal.registroSeleccionado;
    const cfg = CATEGORIAS[r.categoria];
    const fechaDate = parseFechaLocal(r.fechaSesion);
    body.innerHTML = `
      <div class="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-3 text-xs text-slate-700 space-y-1">
        <p class="text-sm font-bold text-slate-800">${cfg ? cfg.emoji : "📌"} ${escapeHtml(r.nombreEvento)}</p>
        <p><strong>Fecha:</strong> ${formatearFecha(fechaDate)}</p>
        <p><strong>Asistente:</strong> ${escapeHtml(r.nombre)}</p>
        <p><strong>Acompañantes:</strong> ${r.numAcompanantes || 0}${r.nombresAcompanantes ? " — " + escapeHtml(r.nombresAcompanantes) : ""}</p>
        ${r.comprobantePago ? `<p><a href="${r.comprobantePago}" target="_blank" rel="noopener" class="text-brand-600 underline font-bold">Ver comprobante subido</a></p>` : ""}
      </div>
      <div class="space-y-2">
        <button id="regBtnEditarAcomp" class="w-full bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-lg py-2.5 transition">✏️ Modificar acompañantes</button>
        <button id="regBtnCancelarRegistro" class="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg py-2.5 transition">🗑️ Cancelar este registro</button>
        <button id="regBtnVolverLista2" class="w-full bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-lg py-2 transition">← Volver a mis registros</button>
      </div>
    `;
    document.getElementById("regBtnEditarAcomp").addEventListener("click", () => {
      regModal.nuevoNumAcomp = r.numAcompanantes || 0;
      regModal.nuevosNombresAcomp = r.nombresAcompanantes || "";
      regModal.errorFormulario = null;
      regModal.paso = "editar_acompanantes";
      renderModalEventoRegistro();
    });
    document.getElementById("regBtnCancelarRegistro").addEventListener("click", () => { regModal.paso = "confirmar_cancelacion"; renderModalEventoRegistro(); });
    document.getElementById("regBtnVolverLista2").addEventListener("click", () => { regModal.paso = "lista_registros"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Editar acompañantes ----
  if (regModal.paso === "editar_acompanantes") {
    const r = regModal.registroSeleccionado;
    body.innerHTML = `
      <p class="text-sm font-bold text-slate-800 mb-2">Modificar acompañantes — ${escapeHtml(r.nombreEvento)}</p>
      <div class="space-y-2.5">
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Número de acompañantes</label>
          <input id="editNumAcomp" type="number" min="0" value="${regModal.nuevoNumAcomp}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <p class="text-[10px] text-slate-400 mt-1">Máximo total permitido para tu depto en esta sesión: ${r.huellasMaxDepto} persona(s), incluyéndote a ti.</p>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Nombres de los acompañantes</label>
          <textarea id="editNombresAcomp" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">${escapeHtml(regModal.nuevosNombresAcomp)}</textarea>
        </div>
      </div>
      ${regModal.errorFormulario ? `<p class="text-xs font-bold text-red-600 mt-2">⚠️ ${escapeHtml(regModal.errorFormulario)}</p>` : ""}
      <div class="flex gap-2 mt-3">
        <button id="regBtnVolverDetalle" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="regBtnGuardarAcomp" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Guardar cambios</button>
      </div>
    `;
    document.getElementById("editNumAcomp").addEventListener("input", (e) => regModal.nuevoNumAcomp = Math.max(0, parseInt(e.target.value, 10) || 0));
    document.getElementById("editNombresAcomp").addEventListener("input", (e) => regModal.nuevosNombresAcomp = e.target.value);
    document.getElementById("regBtnVolverDetalle").addEventListener("click", () => { regModal.paso = "detalle_registro"; renderModalEventoRegistro(); });
    document.getElementById("regBtnGuardarAcomp").addEventListener("click", () => { regModal.errorFormulario = null; regModal.paso = "confirmar_edicion"; renderModalEventoRegistro(); });
    return;
  }

  // ---- Confirmar edición de acompañantes ----
  if (regModal.paso === "confirmar_edicion") {
    const r = regModal.registroSeleccionado;
    body.innerHTML = `
      <p class="text-sm text-slate-700 mb-3">¿Confirmas actualizar tu registro de <strong>${escapeHtml(r.nombreEvento)}</strong> a ${regModal.nuevoNumAcomp} acompañante(s)?</p>
      ${regModal.errorFormulario ? `<p class="text-xs font-bold text-red-600 mb-2">⚠️ ${escapeHtml(regModal.errorFormulario)}</p>` : ""}
      <div class="flex gap-2">
        <button id="regBtnCancelarEdicion" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
        <button id="regBtnConfirmarEdicion" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">${regModal.enviando ? "Guardando…" : "✅ Confirmar cambio"}</button>
      </div>
    `;
    document.getElementById("regBtnCancelarEdicion").addEventListener("click", () => { regModal.paso = "editar_acompanantes"; renderModalEventoRegistro(); });
    const btn = document.getElementById("regBtnConfirmarEdicion");
    btn.disabled = regModal.enviando;
    btn.addEventListener("click", guardarEdicionAcompanantes);
    return;
  }

  // ---- Confirmar cancelación ----
  if (regModal.paso === "confirmar_cancelacion") {
    const r = regModal.registroSeleccionado;
    body.innerHTML = `
      <p class="text-sm font-bold text-red-700 mb-2">⚠️ ¿Confirmas cancelar este registro?</p>
      <div class="bg-red-50 border border-red-100 rounded-lg p-3 mb-3 text-xs text-slate-700">
        <p class="font-bold">${escapeHtml(r.nombreEvento)}</p>
        <p>${formatearFecha(parseFechaLocal(r.fechaSesion))}</p>
      </div>
      <p class="text-[11px] text-slate-500 mb-3">El lugar quedará disponible para otro residente de inmediato.</p>
      ${regModal.errorFormulario ? `<p class="text-xs font-bold text-red-600 mb-2">⚠️ ${escapeHtml(regModal.errorFormulario)}</p>` : ""}
      <div class="flex gap-2">
        <button id="regBtnNoCancelar" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← No, volver</button>
        <button id="regBtnSiCancelar" class="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg py-2.5 transition">${regModal.enviando ? "Cancelando…" : "Sí, cancelar"}</button>
      </div>
    `;
    document.getElementById("regBtnNoCancelar").addEventListener("click", () => { regModal.paso = "detalle_registro"; renderModalEventoRegistro(); });
    const btn = document.getElementById("regBtnSiCancelar");
    btn.disabled = regModal.enviando;
    btn.addEventListener("click", confirmarCancelacionModal);
    return;
  }
}

// ---- Formulario de registro a un evento (paso "formulario") ----
function renderFormularioEvento() {
  const body = document.getElementById("regBody");
  if (!body) return;
  if (regModal.mostrandoConfirmacion) { renderConfirmacionRegistro(); return; }

  const ev = regModal.evento;
  const cfg = CATEGORIAS[ev.categoria];
  const recurrenteSinFecha = !regModal.fechaUnica && esRecurrente(ev);

  let fechasHtml = "";
  if (regModal.fechaUnica) {
    fechasHtml = `<p class="text-xs text-slate-600 mb-2">📅 Sesión: <strong>${formatearFecha(parseFechaLocal(regModal.fechaUnica))}</strong></p>`;
  } else if (recurrenteSinFecha) {
    if (!regModal.fechasDisponiblesMes.length) {
      fechasHtml = `<p class="text-xs text-red-600 font-bold mb-2">No hay sesiones disponibles este mes para este evento.</p>`;
    } else {
      fechasHtml = `<label class="block text-xs font-bold text-slate-500 mb-1">¿A qué fecha(s) te registras este mes?</label><div class="space-y-1 mb-1 max-h-32 overflow-y-auto pr-1">`;
      regModal.fechasDisponiblesMes.forEach(f => {
        const info = cupoInfo(ev, f);
        const fechaDate = parseFechaLocal(f);
        const etiqueta = `${DIAS_SEMANA_LARGOS[fechaDate.getDay()].slice(0, 3)} ${formatearFecha(fechaDate)}`;
        fechasHtml += `<label class="flex items-center gap-2 text-xs font-medium ${info.lleno ? "opacity-40" : ""}"><input type="checkbox" class="regFechaChk" value="${f}" ${info.lleno ? "disabled" : ""} ${regModal.fechasSeleccionadas.includes(f) ? "checked" : ""}> ${etiqueta} ${info.lleno ? "· 🔴 lleno" : ""}</label>`;
      });
      fechasHtml += `</div><label class="flex items-center gap-2 text-xs font-bold text-brand-700 mb-2"><input type="checkbox" id="regFechaTodas"> Seleccionar todas las disponibles</label>`;
    }
  }

  const huellasInfoHtml = regModal.huellasInfo
    ? `<p class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mb-2">🚫 ${escapeHtml(regModal.huellasInfo.error)}</p>` : "";

  body.innerHTML = `
    <p class="text-sm font-bold text-slate-800 mb-1">${cfg ? cfg.emoji : ""} ${escapeHtml(ev.nombre)}</p>
    <p class="text-[11px] text-slate-500 mb-3">${horarioTexto(ev)} · ${escapeHtml(ev.ubicacion || "N/A")} ${ev.tienecosto ? "· 💰 Con costo" : "· 🆓 Gratis"}</p>

    ${fechasHtml}

    ${(deptoRecordado || nombreRecordado) ? `<button id="regBtnUsarDatos" type="button" class="w-full mb-2 text-[11px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-lg py-2 transition">↺ Usar mis datos (depto ${escapeHtml(deptoRecordado || "—")} · ${escapeHtml(nombreRecordado || "—")})</button>` : ""}

    <div class="space-y-2.5">
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1">Número de departamento</label>
        <input id="regDepto" type="text" inputmode="numeric" placeholder="Ej. 3801 o 605" value="${escapeHtml(regModal.depto)}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
      </div>
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1">Nombre completo de quien asistirá</label>
        <input id="regNombre" type="text" value="${escapeHtml(regModal.nombreAsistente)}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
      </div>
      <div>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
          <input id="regTieneAcomp" type="checkbox" ${regModal.tieneAcompanantes ? "checked" : ""}> ¿Vienes acompañado?
        </label>
      </div>
      <div id="regWrapperAcomp" class="${regModal.tieneAcompanantes ? "" : "hidden"} space-y-2 pl-2 border-l-2 border-slate-100">
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">¿Cuántos acompañantes?</label>
          <input id="regNumAcomp" type="number" min="0" value="${regModal.numAcompanantes || 0}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 mb-1">Nombre(s) de los acompañantes</label>
          <textarea id="regNombresAcomp" rows="2" placeholder="Separa los nombres con coma" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">${escapeHtml(regModal.nombresAcompanantes)}</textarea>
        </div>
      </div>
      ${huellasInfoHtml}
      ${ev.tienecosto ? `
      <div>
        <label class="block text-xs font-bold text-slate-500 mb-1">Comprobante de pago (foto)</label>
        <input id="regFoto" type="file" accept="image/*" class="w-full text-xs">
        ${regModal.fotoBase64 ? `<p class="text-[11px] text-emerald-600 font-bold mt-1">✅ Foto cargada (${escapeHtml(regModal.fotoNombre || "")})</p>` : ""}
      </div>` : ""}
      <div>
        <label class="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer">
          <input id="regAcepta" type="checkbox" class="mt-0.5" ${regModal.aceptaTerminos ? "checked" : ""}>
          <span>Entiendo que al registrarme estoy ocupando un lugar que otra persona podría usar. Si no puedo asistir, cancelaré con tiempo suficiente; de lo contrario el Comité podría restringirme el acceso a nuevos registros.</span>
        </label>
      </div>
    </div>

    ${regModal.errorFormulario ? `<p class="text-xs font-bold text-red-600 mt-2">⚠️ ${escapeHtml(regModal.errorFormulario)}</p>` : ""}

    <div class="flex gap-2 mt-3">
      <button id="regBtnVolverLista" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Volver</button>
      <button id="regBtnContinuar" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">Continuar</button>
    </div>
  `;

  document.getElementById("regDepto").addEventListener("input", (e) => regModal.depto = e.target.value.trim());
  document.getElementById("regNombre").addEventListener("input", (e) => regModal.nombreAsistente = e.target.value);
  document.getElementById("regTieneAcomp").addEventListener("change", (e) => {
    regModal.tieneAcompanantes = e.target.checked;
    if (!e.target.checked) { regModal.numAcompanantes = 0; regModal.nombresAcompanantes = ""; }
    renderFormularioEvento();
  });
  const numAcompInput = document.getElementById("regNumAcomp");
  if (numAcompInput) numAcompInput.addEventListener("input", (e) => regModal.numAcompanantes = Math.max(0, parseInt(e.target.value, 10) || 0));
  const nombresAcompInput = document.getElementById("regNombresAcomp");
  if (nombresAcompInput) nombresAcompInput.addEventListener("input", (e) => regModal.nombresAcompanantes = e.target.value);
  document.getElementById("regAcepta").addEventListener("change", (e) => regModal.aceptaTerminos = e.target.checked);

  const fotoInput = document.getElementById("regFoto");
  if (fotoInput) {
    fotoInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      regModal.fotoBase64 = await leerArchivoComoBase64(file);
      regModal.fotoMime = file.type;
      regModal.fotoNombre = file.name;
      renderFormularioEvento();
    });
  }

  const btnUsarDatos = document.getElementById("regBtnUsarDatos");
  if (btnUsarDatos) btnUsarDatos.addEventListener("click", () => {
    regModal.depto = deptoRecordado || regModal.depto;
    regModal.nombreAsistente = nombreRecordado || regModal.nombreAsistente;
    renderFormularioEvento();
  });

  document.querySelectorAll(".regFechaChk").forEach(chk => {
    chk.addEventListener("change", () => {
      regModal.fechasSeleccionadas = Array.from(document.querySelectorAll(".regFechaChk:checked")).map(c => c.value);
    });
  });
  const chkTodas = document.getElementById("regFechaTodas");
  if (chkTodas) chkTodas.addEventListener("change", (e) => {
    document.querySelectorAll(".regFechaChk:not(:disabled)").forEach(c => { c.checked = e.target.checked; });
    regModal.fechasSeleccionadas = Array.from(document.querySelectorAll(".regFechaChk:checked")).map(c => c.value);
  });

  document.getElementById("regBtnVolverLista").addEventListener("click", () => {
    regModal.paso = regModal.categoria ? "lista_eventos" : "menu";
    renderModalEventoRegistro();
  });

  document.getElementById("regBtnContinuar").addEventListener("click", () => {
    regModal.errorFormulario = null;
    regModal.huellasInfo = null;
    if (!/^[0-9]{2,5}$/.test(regModal.depto || "")) { regModal.errorFormulario = "Indica un número de depto válido (solo números)."; renderFormularioEvento(); return; }
    if (!regModal.nombreAsistente || regModal.nombreAsistente.trim().length < 3) { regModal.errorFormulario = "Indica el nombre completo del asistente."; renderFormularioEvento(); return; }
    if (regModal.tieneAcompanantes && regModal.numAcompanantes > 0 && !regModal.nombresAcompanantes.trim()) { regModal.errorFormulario = "Indica el/los nombre(s) de tus acompañantes."; renderFormularioEvento(); return; }
    if (recurrenteSinFecha && !regModal.fechasSeleccionadas.length) { regModal.errorFormulario = "Marca al menos una fecha para registrarte."; renderFormularioEvento(); return; }
    if (ev.tienecosto && !regModal.fotoBase64) { regModal.errorFormulario = "Este evento tiene costo: adjunta tu comprobante de pago."; renderFormularioEvento(); return; }
    if (!regModal.aceptaTerminos) { regModal.errorFormulario = "Debes aceptar el aviso de responsabilidad para continuar."; renderFormularioEvento(); return; }
    regModal.mostrandoConfirmacion = true;
    renderModalEventoRegistro();
  });
}

function renderConfirmacionRegistro() {
  const body = document.getElementById("regBody");
  if (!body) return;
  const ev = regModal.evento;
  const fechas = regModal.fechaUnica ? [regModal.fechaUnica] : regModal.fechasSeleccionadas;
  const fechasTexto = fechas.map(f => formatearFecha(parseFechaLocal(f))).join(", ");

  body.innerHTML = `
    <p class="text-sm font-bold text-slate-800 mb-2">Confirma tu registro:</p>
    <div class="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-3 text-xs text-slate-700 space-y-1">
      <p><strong>Evento:</strong> ${escapeHtml(ev.nombre)}</p>
      <p><strong>Fecha(s):</strong> ${fechasTexto}</p>
      <p><strong>Depto:</strong> ${escapeHtml(regModal.depto)}</p>
      <p><strong>Asistente:</strong> ${escapeHtml(regModal.nombreAsistente)}</p>
      ${regModal.numAcompanantes > 0 ? `<p><strong>Acompañantes:</strong> ${regModal.numAcompanantes} — ${escapeHtml(regModal.nombresAcompanantes || "")}</p>` : ""}
      ${ev.tienecosto ? `<p><strong>Comprobante:</strong> ${regModal.fotoBase64 ? "Adjuntado ✅" : "⚠️ No adjuntado"}</p>` : ""}
    </div>
    ${regModal.errorFormulario ? `<p class="text-xs font-bold text-red-600 mb-2">⚠️ ${escapeHtml(regModal.errorFormulario)}</p>` : ""}
    <div class="flex gap-2">
      <button id="regBtnVolverEditar" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg py-2.5 transition">← Editar</button>
      <button id="regBtnConfirmarEnvio" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg py-2.5 transition">${regModal.enviando ? "Enviando…" : "✅ Confirmar registro"}</button>
    </div>
  `;
  document.getElementById("regBtnVolverEditar").addEventListener("click", () => { regModal.mostrandoConfirmacion = false; renderModalEventoRegistro(); });
  const btnConfirmar = document.getElementById("regBtnConfirmarEnvio");
  btnConfirmar.disabled = regModal.enviando;
  btnConfirmar.addEventListener("click", enviarRegistroModal);
}

async function enviarRegistroModal() {
  const ev = regModal.evento;
  const fechas = regModal.fechaUnica ? [regModal.fechaUnica] : regModal.fechasSeleccionadas;
  regModal.enviando = true;
  regModal.errorFormulario = null;
  renderConfirmacionRegistro();

  const payload = {
    accion: "registrar",
    eventoId: ev.eventoid,
    categoria: ev.categoria,
    depto: regModal.depto,
    nombre: regModal.nombreAsistente,
    numAcompanantes: regModal.numAcompanantes,
    nombresAcompanantes: regModal.nombresAcompanantes,
    aceptaTerminos: regModal.aceptaTerminos ? "1" : "0"
  };
  if (fechas.length === 1) payload.fechaSesion = fechas[0];
  else payload.fechasSesion = fechas.join(",");
  if (regModal.fotoBase64) {
    payload.fotoBase64 = regModal.fotoBase64;
    payload.fotoMime = regModal.fotoMime;
    payload.fotoNombre = regModal.fotoNombre;
  }

  try {
    const res = await fetch(URL_AGENTE_EVENTOS, { method: "POST", body: JSON.stringify(payload) });
    const data = await res.json();
    regModal.enviando = false;

    if (data.error && !data.hasOwnProperty("ok")) {
      regModal.errorFormulario = data.detalle || "Error al procesar el registro.";
      renderConfirmacionRegistro();
      return;
    }
    if (data.ok || (data.multiSesion && (data.detalle || []).some(d => d.ok))) {
      deptoRecordado = regModal.depto;
      nombreRecordado = regModal.nombreAsistente;
      renderSidebarEventos();
      refrescarRegistrosYCupos();
      regModal.resultadoData = data;
      regModal.paso = "resultado_ok";
      renderModalEventoRegistro();
      return;
    }
    regModal.errorFormulario = data.error || "No se pudo completar el registro.";
    regModal.huellasInfo = data.huellasAgotadas ? data : null;
    if (regModal.huellasInfo) {
      // Vuelve al formulario (no a la confirmación) para que pueda ajustar el
      // número de acompañantes con el máximo permitido ya visible.
      regModal.mostrandoConfirmacion = false;
      renderModalEventoRegistro();
    } else {
      renderConfirmacionRegistro();
    }
  } catch (e) {
    regModal.enviando = false;
    regModal.errorFormulario = "Error de conexión. Intenta de nuevo.";
    renderConfirmacionRegistro();
  }
}

async function buscarMisRegistrosModal() {
  regModal.errorVerificacion = null;
  if (!/^[0-9]{2,5}$/.test(regModal.deptoConsulta || "")) { regModal.errorVerificacion = "Indica un número de depto válido."; renderModalEventoRegistro(); return; }
  if (!regModal.nombreConsulta || regModal.nombreConsulta.trim().length < 3) { regModal.errorVerificacion = "Indica el nombre completo con el que te registraste."; renderModalEventoRegistro(); return; }
  regModal.buscando = true;
  renderModalEventoRegistro();
  try {
    const res = await fetch(URL_AGENTE_EVENTOS, { method: "POST", body: JSON.stringify({ accion: "mis_registros", depto: regModal.deptoConsulta, nombre: regModal.nombreConsulta }) });
    const data = await res.json();
    regModal.buscando = false;
    if (!data.ok) { regModal.errorVerificacion = data.error || "No se pudo verificar tus datos."; renderModalEventoRegistro(); return; }
    regModal.registros = data.registros || [];
    deptoRecordado = regModal.deptoConsulta;
    nombreRecordado = regModal.nombreConsulta;
    regModal.paso = "lista_registros";
    renderModalEventoRegistro();
  } catch (e) {
    regModal.buscando = false;
    regModal.errorVerificacion = "Error de conexión. Intenta de nuevo.";
    renderModalEventoRegistro();
  }
}

async function guardarEdicionAcompanantes() {
  const r = regModal.registroSeleccionado;
  regModal.enviando = true;
  regModal.errorFormulario = null;
  renderModalEventoRegistro();
  try {
    const res = await fetch(URL_AGENTE_EVENTOS, {
      method: "POST",
      body: JSON.stringify({
        accion: "modificar_registro",
        registroId: r.registroId,
        depto: regModal.deptoConsulta,
        nombre: regModal.nombreConsulta,
        numAcompanantes: regModal.nuevoNumAcomp,
        nombresAcompanantes: regModal.nuevosNombresAcomp
      })
    });
    const data = await res.json();
    regModal.enviando = false;
    if (!data.ok) { regModal.errorFormulario = data.error || "No se pudo actualizar tu registro."; regModal.paso = "confirmar_edicion"; renderModalEventoRegistro(); return; }
    r.numAcompanantes = regModal.nuevoNumAcomp;
    r.nombresAcompanantes = regModal.nuevosNombresAcomp;
    renderSidebarEventos();
    refrescarRegistrosYCupos();
    regModal.paso = "detalle_registro";
    renderModalEventoRegistro();
  } catch (e) {
    regModal.enviando = false;
    regModal.errorFormulario = "Error de conexión al guardar los cambios.";
    regModal.paso = "confirmar_edicion";
    renderModalEventoRegistro();
  }
}

async function confirmarCancelacionModal() {
  const r = regModal.registroSeleccionado;
  regModal.enviando = true;
  regModal.errorFormulario = null;
  renderModalEventoRegistro();
  try {
    const res = await fetch(URL_AGENTE_EVENTOS, {
      method: "POST",
      body: JSON.stringify({ accion: "cancelar_mi_registro", depto: regModal.deptoConsulta, nombre: regModal.nombreConsulta, registroIds: r.registroId })
    });
    const data = await res.json();
    regModal.enviando = false;
    if (!data.ok || !data.totalCanceladas) { regModal.errorFormulario = data.error || "No se pudo cancelar el registro."; renderModalEventoRegistro(); return; }
    regModal.registros = (regModal.registros || []).filter(x => x.registroId !== r.registroId);
    renderSidebarEventos();
    refrescarRegistrosYCupos();
    regModal.paso = "lista_registros";
    renderModalEventoRegistro();
  } catch (e) {
    regModal.enviando = false;
    regModal.errorFormulario = "Error de conexión al cancelar.";
    renderModalEventoRegistro();
  }
}

inicializar();
setInterval(inicializar, 60000); // refresca eventos completos cada 60s
setInterval(refrescarCuposLive, 12000); // refresca SOLO el cupo cada 12s (llamada liviana, sin caché)