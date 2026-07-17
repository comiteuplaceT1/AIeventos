/**
 * Agente IA de Eventos Comunitarios — Lógica completa del chat, registro y calendario.
 * Lee 4 categorías de eventos + registros en tiempo real desde Google Sheets (CSV, costo cero tokens).
 * El registro de asistentes y la validación de morosos se resuelven contra Google Apps Script.
 */

// ⚠️ REEMPLAZA ESTOS LINKS ENTRE COMILLAS POR TUS ENLACES REALES DE GOOGLE SHEETS (CSV)
// Publica cada pestaña por separado: Archivo > Compartir > Publicar en la web > [pestaña] > CSV
const URL_DEPORTIVOS_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=0&single=true&output=csv";
const URL_SOCIALES_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=1456759375&single=true&output=csv";
const URL_CULTURALES_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=433908363&single=true&output=csv";
const URL_IMPACTO_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=1748806311&single=true&output=csv";
const URL_REGISTROS_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vShS7e_v2ttLAYViX9W9bJ-eD_udPwdOgnBXriDz3bRpQEGMwmLTpA_oUXLOAORVieHG8KMYUoLyFVx/pub?gid=942672624&single=true&output=csv";

// ⚠️ COPIA AQUÍ EL LINK DE IMPLEMENTACIÓN DE TU GOOGLE APPS SCRIPT (APLICACIÓN WEB /EXEC)
// Se usa para: registrar asistentes (valida morosos + cupo), panel admin y chat con Gemini.
const URL_AGENTE_EVENTOS = "https://script.google.com/macros/s/AKfycbwuLB7Fk8MEMNoKbxxCTsujTLNBKE6GmzjbO7GhOFekWP5kU_dFBb-aXfloCMdQr-FO/exec";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DIAS_SEMANA_CORTOS = ["D","L","M","M","J","V","S"];
const DIAS_SEMANA_LARGOS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

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
  registros: []
};

// Estado de la conversación de registro en curso (flujo 100% en el chat)
let registroEnCurso = null; // { eventoId, categoria, nombreEvento, paso: 'depto' | 'nombre' | 'confirmando', depto }

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

function csvAObjetos(textoCsv) {
  const lineas = textoCsv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lineas.length <= 1) return [];
  const separador = ",";
  const cabeceras = lineas[0].split(separador).map(c => c.replace(/^"|"$/g, '').trim().toLowerCase());
  const resultados = [];
  for (let i = 1; i < lineas.length; i++) {
    const regex = new RegExp(`${separador}(?=(?:(?:[^"]*"){2})*[^"]*$)`);
    const valores = lineas[i].split(regex).map(v => v.replace(/^"|"$/g, '').trim());
    const obj = {};
    cabeceras.forEach((cab, index) => {
      let val = valores[index] ? valores[index].trim() : "";
      val = val.replace(/\r/g, "").trim();
      obj[cab] = val;
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
function contarConfirmados(eventoId) {
  return DATA.registros.filter(r =>
    String(r.eventoid || "").trim() === String(eventoId).trim() &&
    String(r.estado || "").trim().toLowerCase() === "confirmado"
  ).length;
}
function cupoInfo(evento) {
  const confirmados = contarConfirmados(evento.eventoid);
  const total = Number(evento.cupototal) || 0;
  const disponibles = Math.max(total - confirmados, 0);
  const lleno = confirmados >= total;
  const texto = lleno ? `${total}/${total} Lleno` : `${confirmados}/${total}`;
  return { confirmados, total, disponibles, lleno, texto };
}

// ---------- Carga de datos e Interfaz Lateral Dinámica ----------
async function cargarCsv(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
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

    const scrollContainer = document.getElementById("deportivosList")?.parentNode?.parentNode;
    if (scrollContainer) {
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

    if (messagesEl && messagesEl.children.length === 0) {
      addMessage("👋 *¡Hola! Bienvenido a Eventos Comunitarios de Uplace.*\n\nSoy tu *Agente IA de Eventos* y puedo ayudarte a ver qué hay programado, consultar cupo disponible y registrarte directamente aquí en el chat. Despliega los menús de la izquierda por categoría o pregúntame lo que necesites.", "bot");
    }
  } catch (error) {
    console.error("Error cargando los datos desde Google Sheets:", error);
  }
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
    categoria
  })).filter(ev => ev.eventoid);
}

function crearSeccionMenu(titulo, idLista) {
  const container = document.createElement("div");
  container.className = "mb-4 border border-slate-100 rounded-xl overflow-hidden bg-slate-50/50";
  container.innerHTML = `
    <button type="button" class="w-full flex items-center justify-between px-3 py-3 text-left font-bold text-xs uppercase tracking-wider text-slate-500 hover:bg-slate-100/80 transition"
            onclick="document.getElementById('${idLista}').classList.toggle('hidden')">
      <span>${titulo}</span>
      <span class="text-[10px] text-slate-400">▼</span>
    </button>
    <div id="${idLista}" class="hidden p-2 space-y-1 bg-white border-t border-slate-100"></div>
  `;
  return container;
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
    const info = cupoInfo(evento);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "w-full text-left px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition flex items-center justify-between gap-2 font-medium border-l-2 border-transparent hover:border-brand-500";
    btn.innerHTML = `<span class="truncate">${emoji} ${escapeHtml(evento.nombre)}</span><span class="text-[10px] font-bold ${info.lleno ? 'text-red-500' : 'text-emerald-600'} shrink-0">${info.texto}</span>`;
    btn.onclick = () => mostrarTarjetaEventoEnChat(evento);
    contenedor.appendChild(btn);
  });
}

// ---------- Tarjetas de evento (formato chat) ----------
function tarjetaEventoTexto(evento, incluirBoton = true) {
  const info = cupoInfo(evento);
  const cfg = CATEGORIAS[evento.categoria];
  const fecha = evento.fecha ? formatearFecha(parseFechaLocal(evento.fecha)) : "Sin fecha";
  const badgeCupo = info.lleno ? `🔴 *${info.texto}*` : `🟢 *${info.texto} lugares disponibles*`;

  let lineas = [
    `${cfg ? cfg.emoji : "🎟️"} *${evento.nombre}*`,
    `📁 Categoría: ${evento.categoria}`,
    `📅 Fecha: ${fecha}`,
    `🕐 Horario: ${evento.horainicio || "N/A"} - ${evento.horafin || "N/A"}`,
    `📍 Lugar: ${evento.ubicacion || "N/A"}`,
    `👥 Cupo: ${badgeCupo}`,
  ];
  if (evento.descripcion) lineas.push(`📝 ${evento.descripcion}`);

  let texto = lineas.join("\n");
  if (incluirBoton) {
    if (info.lleno) {
      texto += `\n<button disabled class="mt-2 block text-[11px] font-bold text-slate-400 bg-slate-100 rounded-lg px-3 py-1.5 cursor-not-allowed">Cupo lleno</button>`;
    } else {
      texto += `\n<button onclick="window.iniciarRegistro('${evento.eventoid}','${evento.categoria}', '${escapeHtml(evento.nombre).replace(/'/g, "\\'")}')" class="mt-2 block text-[11px] font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">✅ Registrarme</button>`;
    }
  }
  return texto;
}

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
  const hoyStr = fechaISO(hoyMedianoche());
  const eventos = todosLosEventos().filter(e => e.estado.toLowerCase() === "activo" && e.fecha === hoyStr);
  if (!eventos.length) return "🕊️ No hay eventos comunitarios programados para hoy.";
  let reporte = "🎈 *EVENTOS DE HOY*\n\n";
  eventos.forEach(ev => { reporte += tarjetaEventoTexto(ev) + "\n\n"; });
  return reporte;
}

function respuestaTodosActivos() {
  const eventos = todosLosEventos().filter(e => e.estado.toLowerCase() === "activo")
    .sort((a, b) => parseFechaLocal(a.fecha) - parseFechaLocal(b.fecha));
  if (!eventos.length) return "📋 No hay eventos activos registrados en este momento.";
  let reporte = "🗓️ *TODOS LOS EVENTOS ACTIVOS*\n\n";
  eventos.forEach(ev => { reporte += tarjetaEventoTexto(ev) + "\n\n"; });
  return reporte;
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

  let reporte = "📅 *PROGRAMACIÓN DE EVENTOS DE LA SEMANA*\n\n";
  dias.forEach(f => {
    const iso = fechaISO(f);
    const nombreDia = DIAS_SEMANA_LARGOS[f.getDay()];
    const eventosDia = eventosActivos.filter(e => e.fecha === iso);
    reporte += `*🔹 ${nombreDia.toUpperCase()} (${formatearFecha(f)})*\n`;
    if (!eventosDia.length) {
      reporte += "🕊️ Sin eventos programados.\n\n";
    } else {
      eventosDia.forEach(ev => {
        const info = cupoInfo(ev);
        const cfg = CATEGORIAS[ev.categoria];
        reporte += `${cfg ? cfg.emoji : "🎟️"} *${ev.nombre}* — ${ev.horainicio || "N/A"}h @ ${ev.ubicacion || "N/A"} — ${info.lleno ? "🔴 " : "🟢 "}${info.texto}\n`;
        reporte += `<button onclick="window.iniciarRegistro('${ev.eventoid}','${ev.categoria}', '${escapeHtml(ev.nombre).replace(/'/g, "\\'")}')" ${info.lleno ? "disabled" : ""} class="mt-0.5 mb-1.5 inline-block text-[11px] font-bold ${info.lleno ? 'text-slate-400 bg-slate-100 cursor-not-allowed' : 'text-brand-600 bg-brand-50 hover:bg-brand-100'} rounded-lg px-2 py-1 transition">${info.lleno ? "Cupo lleno" : "✅ Registrarme"}</button>\n`;
      });
      reporte += "\n";
    }
  });
  return reporte;
}

function buscarEventoPorNombreParcial(consulta) {
  const q = consulta.toLowerCase().trim();
  return todosLosEventos().filter(e => e.nombre && e.nombre.toLowerCase().includes(q));
}

// ---------- Flujo de registro conversacional ----------
window.iniciarRegistro = function(eventoId, categoria, nombreEvento) {
  const evento = buscarEventoPorId(eventoId, categoria);
  if (evento) {
    const info = cupoInfo(evento);
    if (info.lleno) {
      addMessage(`🔴 Lo siento, *${nombreEvento}* ya alcanzó su cupo máximo (${info.texto}). No hay lugares disponibles por el momento.`, "bot");
      return;
    }
  }
  registroEnCurso = { eventoId, categoria, nombreEvento, paso: "depto" };
  addMessage(`Vamos a registrarte en *${nombreEvento}*.\n\nPor favor indica tu número de departamento (ej. 3003). Escribe *cancelar* en cualquier momento para salir de este registro.`, "bot");
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
      addMessage("Ese número de departamento no parece válido. Escríbelo solo con números (ej. 3003), o escribe *cancelar*.", "bot");
      return;
    }
    registroEnCurso.depto = txtLimpio;
    registroEnCurso.paso = "nombre";
    addMessage("Gracias. Ahora indica el nombre completo de quien asistirá:", "bot");
    return;
  }

  if (registroEnCurso.paso === "nombre") {
    if (txtLimpio.length < 3) {
      addMessage("Por favor escribe el nombre completo del asistente, o escribe *cancelar*.", "bot");
      return;
    }
    const { eventoId, categoria, nombreEvento, depto } = registroEnCurso;
    addMessage(`Confirmando registro de *${txtLimpio}* (depto ${depto}) en *${nombreEvento}*…`, "bot");
    registroEnCurso = null;
    await confirmarRegistroBackend(eventoId, categoria, depto, txtLimpio);
  }
}

async function confirmarRegistroBackend(eventoId, categoria, depto, nombre) {
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=registrar&eventoId=${encodeURIComponent(eventoId)}&categoria=${encodeURIComponent(categoria)}&depto=${encodeURIComponent(depto)}&nombre=${encodeURIComponent(nombre)}`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await res.json();

    if (data.error && !data.hasOwnProperty("ok")) {
      addMessage(`⚠️ Error al procesar el registro:\n\n${data.detalle || "Sin detalle disponible."}`, "bot");
      return;
    }

    if (data.ok) {
      addMessage(`✅ *${data.mensaje}*\n\n👥 Cupo actualizado: ${data.cupoActual}/${data.cupoTotal} — ${data.lugaresDisponibles} lugar(es) disponible(s).`, "bot");
      // Refresca registros en segundo plano para que el cupo se vea actualizado en toda la UI
      DATA.registros = await cargarCsv(URL_REGISTROS_CSV).then(r => r.map(x => ({
        eventoid: x["eventoid"] || x["EventoID"] || "",
        categoria: x["categoria"] || "",
        depto: x["depto"] || "",
        nombre: x["nombre"] || "",
        estado: x["estado"] || ""
      })));
    } else if (data.moroso) {
      addMessage(`🚫 ${data.error}`, "bot");
    } else if (data.cupoLleno) {
      addMessage(`🔴 ${data.error}`, "bot");
    } else {
      addMessage(`⚠️ No se pudo completar el registro: ${data.error || "Error desconocido."}`, "bot");
    }
  } catch (error) {
    console.error("Error de red al registrar:", error);
    addMessage("⚠️ Ocurrió un problema de conexión al confirmar tu registro. Inténtalo de nuevo en un momento.", "bot");
  }
}

// ---------- Router de mensajes ----------
function responderMensajeLocal(textoOriginal) {
  const texto = textoOriginal.trim();
  const normalizado = texto.toLowerCase();

  if (normalizado.includes("hoy")) return respuestaEventosHoy();
  if (normalizado.includes("semana") || normalizado.includes("agenda") || normalizado.includes("programaci")) return respuestaAgendaSemanal();
  if (normalizado.includes("todos los eventos") || normalizado === "eventos activos" || normalizado.includes("ver eventos")) return respuestaTodosActivos();
  if (normalizado.includes("ayuda") || normalizado === "hola") {
    return "👋 ¡Hola! Puedo mostrarte los eventos de hoy, la programación de la semana, o ayudarte a registrarte a cualquier evento activo directamente aquí en el chat.";
  }

  const candidatos = buscarEventoPorNombreParcial(texto);
  if (candidatos.length > 0) return candidatos.map(ev => tarjetaEventoTexto(ev)).join("\n\n");

  return null; // sin match local -> se consulta a la IA
}

async function preguntarIA(pregunta) {
  try {
    const url = `${URL_AGENTE_EVENTOS}?accion=chat&pregunta=${encodeURIComponent(pregunta)}`;
    const respuesta = await fetch(url, { method: "GET", cache: "no-store" });
    const data = await respuesta.json();
    if (data.error) {
      console.error("Error del agente IA:", data.detalle);
      return `⚠️ Error del asistente IA:\n\n${data.detalle || "Sin detalle disponible."}`;
    }
    return `🤖 *Respuesta generada por IA:*\n\n${data.respuesta_ia}`;
  } catch (error) {
    console.error("Error de red al llamar al agente IA:", error);
    return `⚠️ Error de conexión al llamar al agente IA:\n\n${error.toString()}`;
  }
}

if (chatForm) {
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt) return;
    addMessage(txt, "user");
    chatInput.value = "";

    // Si hay un registro en curso, el siguiente mensaje se interpreta como parte de ese flujo
    if (registroEnCurso) {
      await continuarFlujoRegistro(txt);
      return;
    }

    const respuestaLocal = responderMensajeLocal(txt);
    if (respuestaLocal !== null) {
      setTimeout(() => { addMessage(respuestaLocal, "bot"); }, 400);
      return;
    }

    addMessage("🤖 Consultando al asistente IA…", "bot");
    const respuestaIA = await preguntarIA(txt);
    const ultimoMensaje = messagesEl.lastElementChild;
    if (ultimoMensaje) ultimoMensaje.remove();
    addMessage(respuestaIA, "bot");
  });
}

window.handleQuickAction = function(accion) {
  addMessage(accion, "user");
  setTimeout(() => {
    const respuesta = responderMensajeLocal(accion);
    addMessage(respuesta !== null ? respuesta : "🤔 No pude generar esa vista por ahora.", "bot");
  }, 300);
};

// ---------- Panel Admin (creación / cancelación de eventos, protegido con PIN) ----------
window.abrirPanelAdmin = async function() {
  const pin = prompt("PIN de administración del Comité:");
  if (!pin) return;
  const accion = prompt("¿Qué deseas hacer?\n1 = Crear evento\n2 = Cancelar evento\n\nEscribe 1 o 2:");

  if (accion === "1") {
    const categoria = prompt("Categoría (Deportivos / Sociales / Culturales / Impacto):");
    if (!CATEGORIAS[categoria]) { alert("Categoría inválida."); return; }
    const nombre = prompt("Nombre del evento:");
    const descripcion = prompt("Descripción (opcional):") || "";
    const fecha = prompt("Fecha (YYYY-MM-DD):");
    const horaInicio = prompt("Hora inicio (ej. 10:00):") || "";
    const horaFin = prompt("Hora fin (ej. 12:00):") || "";
    const ubicacion = prompt("Ubicación:") || "";
    const cupoTotal = prompt("Cupo total:") || "0";

    if (!nombre || !fecha) { alert("Nombre y fecha son obligatorios."); return; }

    try {
      const url = `${URL_AGENTE_EVENTOS}?accion=crear_evento&pin=${encodeURIComponent(pin)}&categoria=${encodeURIComponent(categoria)}&nombre=${encodeURIComponent(nombre)}&descripcion=${encodeURIComponent(descripcion)}&fecha=${encodeURIComponent(fecha)}&horaInicio=${encodeURIComponent(horaInicio)}&horaFin=${encodeURIComponent(horaFin)}&ubicacion=${encodeURIComponent(ubicacion)}&cupoTotal=${encodeURIComponent(cupoTotal)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        alert(`Evento creado: ${data.eventoId}`);
        inicializar();
      } else {
        alert(data.error || "No se pudo crear el evento.");
      }
    } catch (err) {
      alert("Error de conexión: " + err.toString());
    }
  } else if (accion === "2") {
    const categoria = prompt("Categoría del evento a cancelar (Deportivos / Sociales / Culturales / Impacto):");
    if (!CATEGORIAS[categoria]) { alert("Categoría inválida."); return; }
    const eventoId = prompt("EventoID a cancelar (ej. DEP-A1B2C3):");
    if (!eventoId) return;
    try {
      const url = `${URL_AGENTE_EVENTOS}?accion=cancelar_evento&pin=${encodeURIComponent(pin)}&categoria=${encodeURIComponent(categoria)}&eventoId=${encodeURIComponent(eventoId)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        alert("Evento cancelado.");
        inicializar();
      } else {
        alert(data.error || "No se pudo cancelar el evento.");
      }
    } catch (err) {
      alert("Error de conexión: " + err.toString());
    }
  }
};

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
  todosLosEventos().forEach(ev => {
    if (ev.estado.toLowerCase() !== "activo") return;
    const fecha = parseFechaLocal(ev.fecha);
    if (isNaN(fecha.getTime())) return;
    if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes) return;
    const dia = fecha.getDate();
    if (!porDia[dia]) porDia[dia] = [];
    porDia[dia].push(ev);
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
      html += `<div class="calendario-item cursor-pointer text-[9px] ${cfg ? cfg.colorClaro : "bg-slate-100 text-slate-700"} rounded px-1 py-0.5 mt-0.5 truncate transition" data-idx="${idx}" title="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</div>`;
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
      const info = cupoInfo(item);
      const idxGlobal = calendarioItemsActuales.length;
      calendarioItemsActuales.push(item);
      return `<div class="calendario-item cursor-pointer border ${cfg ? cfg.colorDia : "bg-slate-50 border-slate-200"} rounded-lg px-3 py-2 mb-2 hover:opacity-80 transition" data-idx="${idxGlobal}">
        <p class="text-sm font-bold text-slate-800">${cfg ? cfg.emoji : ""} ${escapeHtml(item.nombre)}</p>
        <p class="text-xs text-slate-500">${item.categoria} · ${item.horainicio || "N/A"}h · ${item.ubicacion || "N/A"}</p>
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
  const info = cupoInfo(item);
  const cfg = CATEGORIAS[item.categoria];
  const fecha = item.fecha ? formatearFecha(parseFechaLocal(item.fecha)) : "Sin fecha";

  let html = `<p class="text-sm font-bold text-slate-800 mb-2">${cfg ? cfg.emoji : ""} ${escapeHtml(item.nombre)}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Categoría:</strong> ${escapeHtml(item.categoria)}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Fecha:</strong> ${fecha}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Horario:</strong> ${escapeHtml(item.horainicio || "N/A")} - ${escapeHtml(item.horafin || "N/A")}</p>`;
  html += `<p class="text-xs text-slate-600 mb-1.5"><strong class="text-slate-800">Lugar:</strong> ${escapeHtml(item.ubicacion || "N/A")}</p>`;
  html += `<p class="text-xs mb-1.5"><strong class="text-slate-800">Cupo:</strong> <span class="font-bold ${info.lleno ? "text-red-500" : "text-emerald-600"}">${info.lleno ? "🔴" : "🟢"} ${info.texto}</span></p>`;
  if (item.descripcion) html += `<p class="text-xs text-slate-600 mb-2"><strong class="text-slate-800">Descripción:</strong> ${escapeHtml(item.descripcion)}</p>`;

  if (info.lleno) {
    html += `<button disabled class="mt-2 w-full text-xs font-bold text-slate-400 bg-slate-100 rounded-lg px-3 py-2 cursor-not-allowed">Cupo lleno</button>`;
  } else {
    html += `<button id="btnRegistrarDesdeCalendario" class="mt-2 w-full text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-2 transition">✅ Registrarme</button>`;
  }

  body.innerHTML = html;
  modal.classList.remove("hidden");

  const btnRegistrar = document.getElementById("btnRegistrarDesdeCalendario");
  if (btnRegistrar) {
    btnRegistrar.addEventListener("click", () => {
      window.cerrarDetalleCalendario();
      window.cerrarModalCalendario();
      window.iniciarRegistro(item.eventoid, item.categoria, item.nombre);
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

inicializar();
setInterval(inicializar, 60000); // refresca eventos y cupo cada 60s
