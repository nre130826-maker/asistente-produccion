/* =====================================================================
 *  ASISTENTE DE PRODUCCIÓN · Página web
 *  - Micrófono con la Web Speech API (español de Colombia)
 *  - Lee las respuestas en voz alta con speechSynthesis
 *  - Envía las preguntas al Apps Script (URL /exec) con Content-Type text/plain
 *  La URL y el PIN NO van en este archivo: se guardan en Ajustes (localStorage).
 * ===================================================================== */

// ---------- CONFIG ----------
const CONFIG = {
  IDIOMA: 'es-CO',
  // Botones de preguntas frecuentes (cámbialos a tu gusto)
  FRECUENTES: [
    '¿Qué materiales lleva la Sala Madrid?',
    '¿Cuánta tela lleva la Sala Londres?',
    '¿Cuántas patas lleva la Sala Milán Bananeada?',
    '¿Cuánta espuma lleva el colchón Super Max de 1.40?',
    '¿Qué productos usan Pata Cónica #10?',
    '5 Sala Madrid y 3 Sala Londres, ¿cuánta tela en total?'
  ],
  TIEMPO_MAX_MS: 30000
};

// ---------- Guardado local (con protección por si el navegador lo bloquea) ----------
const guardado = {
  leer(k, def) { try { const v = localStorage.getItem('asistente.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  escribir(k, v) { try { localStorage.setItem('asistente.' + k, JSON.stringify(v)); } catch (e) { /* sin guardado */ } }
};
const sesion = {
  leer(k) { try { return sessionStorage.getItem('asistente.' + k) || ''; } catch (e) { return ''; } },
  escribir(k, v) { try { sessionStorage.setItem('asistente.' + k, v); } catch (e) { /* nada */ } }
};

const ajustes = {
  url: guardado.leer('url', ''),
  pin: guardado.leer('pin', ''),
  voz: guardado.leer('voz', true),
  velocidad: guardado.leer('velocidad', 1.05),
  auto: guardado.leer('auto', true)
};

let contexto = null;      // último producto del que se habló (para "¿y cuánta tela?")
let ultimaPregunta = '';

const $ = (id) => document.getElementById(id);
const chat = $('chat');

// ---------- Utilidades ----------
function escapar(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function bajar() { chat.scrollTop = chat.scrollHeight; }

function burbuja(clase, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + clase;
  div.innerHTML = html;
  chat.appendChild(div);
  bajar();
  return div;
}

function chips(lista, alTocar, clase) {
  const cont = document.createElement('div');
  cont.className = 'chips';
  lista.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (clase ? ' ' + clase : '');
    b.textContent = t;
    b.addEventListener('click', () => alTocar(t));
    cont.appendChild(b);
  });
  return cont;
}

function tablaHtml(d) {
  if (!d || !d.filas || !d.filas.length) return '';
  const numerica = d.columnas.map((c) => /cantidad|total/i.test(c));
  let h = '<div class="titulo">' + escapar(d.titulo) + '</div><div class="tabla-scroll"><table><thead><tr>';
  d.columnas.forEach((c) => { h += '<th>' + escapar(c) + '</th>'; });
  h += '</tr></thead><tbody>';
  d.filas.forEach((f) => {
    h += '<tr>' + f.map((x, i) => '<td' + (numerica[i] ? ' class="num"' : '') + '>' + escapar(x) + '</td>').join('') + '</tr>';
  });
  h += '</tbody></table></div>';
  if (d.nota) h += '<div class="nota">' + escapar(d.nota) + '</div>';
  return h;
}

// ---------- Voz: hablar ----------
let vozElegida = null;
function elegirVoz() {
  if (!('speechSynthesis' in window)) return;
  const voces = speechSynthesis.getVoices();
  vozElegida = voces.find((v) => v.lang === 'es-CO') ||
    voces.find((v) => /^es[-_](US|MX|419)/i.test(v.lang)) ||
    voces.find((v) => /^es/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  elegirVoz();
  speechSynthesis.onvoiceschanged = elegirVoz;
}

function hablar(texto) {
  if (!ajustes.voz || !('speechSynthesis' in window) || !texto) return;
  speechSynthesis.cancel();
  // Leer "#10" como "número 10" y "1.40" como "1 con 40"
  const limpio = String(texto)
    .replace(/#(\d+)/g, 'número $1')
    .replace(/(\d)\.(\d{2})x(\d)\.(\d{2})/g, '$1 $2 por $3 $4')
    .replace(/\b(\d)\.(\d{2})\b/g, '$1 $2');
  const u = new SpeechSynthesisUtterance(limpio);
  u.lang = CONFIG.IDIOMA;
  if (vozElegida) u.voice = vozElegida;
  u.rate = Number(ajustes.velocidad) || 1;
  speechSynthesis.speak(u);
}

// ---------- Voz: escuchar ----------
const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, escuchando = false;

function prepararMicrofono() {
  const btn = $('btnMic');
  if (!Reconocimiento) {
    btn.hidden = true;
    burbuja('el', 'Este navegador no permite usar el micrófono. Puedes escribir la pregunta. ' +
      '<span class="nota">(Funciona mejor en Chrome para Android o computador.)</span>');
    return;
  }
  rec = new Reconocimiento();
  rec.lang = CONFIG.IDIOMA;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => { escuchando = true; btn.classList.add('escuchando'); $('texto').placeholder = 'Te escucho…'; };
  rec.onresult = (e) => {
    let final = '', parcial = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else parcial += t;
    }
    $('texto').value = (final || parcial).trim();
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      burbuja('el error', 'No tengo permiso para usar el micrófono. Revisa el permiso en el candado de la barra de direcciones.');
    } else if (e.error === 'no-speech') {
      $('texto').placeholder = 'No te escuché. Toca el micrófono otra vez.';
    }
  };
  rec.onend = () => {
    escuchando = false; btn.classList.remove('escuchando');
    $('texto').placeholder = 'Escribe o toca el micrófono…';
    if (ajustes.auto && $('texto').value.trim()) enviar($('texto').value);
  };

  btn.addEventListener('click', () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();   // callar si está hablando
    if (escuchando) { rec.stop(); return; }
    $('texto').value = '';
    try { rec.start(); } catch (e) { /* ya estaba iniciado */ }
  });
}

// ---------- Llamar al Apps Script ----------
async function llamar(cuerpo) {
  if (!ajustes.url || !ajustes.pin) { abrirAjustes(); throw new Error('Primero configura la URL y el PIN en Ajustes.'); }
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), CONFIG.TIEMPO_MAX_MS);
  try {
    const r = await fetch(ajustes.url, {
      method: 'POST',
      // text/plain evita el bloqueo de CORS con Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ pin: ajustes.pin }, cuerpo)),
      redirect: 'follow',
      signal: control.signal
    });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (e) { throw new Error('El servidor no respondió bien. Revisa que la URL termine en /exec y que la implementación tenga acceso "Cualquier usuario".'); }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El servidor se demoró mucho. Intenta otra vez.');
    if (e instanceof TypeError) throw new Error('No hay conexión con el servidor. Revisa el internet y la URL.');
    throw e;
  } finally { clearTimeout(reloj); }
}

// ---------- Enviar una pregunta ----------
async function enviar(texto) {
  texto = String(texto || '').trim();
  if (!texto) return;
  $('texto').value = '';
  ultimaPregunta = texto;
  burbuja('yo', escapar(texto));
  const espera = burbuja('el escribiendo', 'Buscando en la hoja…');
  try {
    const r = await llamar({ accion: 'preguntar', pregunta: texto, contexto: contexto, canal: escuchandoUltimo ? 'voz' : 'texto' });
    espera.remove();
    mostrarRespuesta(r);
  } catch (e) {
    espera.remove();
    burbuja('el error', escapar(e.message));
  }
  escuchandoUltimo = false;
}
let escuchandoUltimo = false;

function mostrarRespuesta(r) {
  if (!r.ok) {
    const div = burbuja('el error', escapar(r.error || 'Algo salió mal.'));
    if (r.codigo === 'PIN') div.appendChild(chips(['Abrir ajustes'], abrirAjustes));
    hablar(r.error);
    return;
  }
  if (r.contexto && r.contexto.producto) contexto = r.contexto;
  const div = burbuja('el', escapar(r.texto) + tablaHtml(r.detalle));
  if (r.requiereConfirmacion && r.cambio) {
    div.appendChild(chips(['Confirmar cambio', 'Cancelar'], (t) => {
      if (t === 'Cancelar') { burbuja('el', 'Listo, no cambié nada.'); return; }
      confirmarCambio(r.cambio, r.texto);
    }, 'primario'));
  }
  if (r.sugerencias && r.sugerencias.length) div.appendChild(chips(r.sugerencias, enviar));
  bajar();
  hablar(r.texto);
}

// ---------- Cambios con PIN de edición ----------
function confirmarCambio(cambio, descripcion) {
  const recordado = sesion.leer('pinEdicion');
  if (recordado) { aplicar(cambio, recordado); return; }
  $('txtCambio').textContent = descripcion.replace(/¿Confirmo\?$/, '');
  $('pinEdicion').value = '';
  const dlg = $('dlgEdicion');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') { burbuja('el', 'Listo, no cambié nada.'); return; }
    const pin = $('pinEdicion').value.trim();
    if ($('recordarEdicion').checked) sesion.escribir('pinEdicion', pin);
    aplicar(cambio, pin);
  };
  dlg.showModal();
  setTimeout(() => $('pinEdicion').focus(), 50);
}

async function aplicar(cambio, pinEdicion) {
  const espera = burbuja('el escribiendo', 'Guardando el cambio en la hoja…');
  try {
    const r = await llamar({ accion: 'confirmarCambio', cambio: cambio, pinEdicion: pinEdicion, pregunta: ultimaPregunta });
    espera.remove();
    if (!r.ok && r.codigo === 'PIN_EDICION') sesion.escribir('pinEdicion', '');
    mostrarRespuesta(r.ok ? r : { ok: false, error: r.error });
  } catch (e) {
    espera.remove();
    burbuja('el error', escapar(e.message));
  }
}

// ---------- Ajustes ----------
function abrirAjustes() {
  $('cfgUrl').value = ajustes.url;
  $('cfgPin').value = ajustes.pin;
  $('cfgVoz').checked = !!ajustes.voz;
  $('cfgVelocidad').value = ajustes.velocidad;
  $('cfgAuto').checked = !!ajustes.auto;
  $('estadoConexion').textContent = '';
  const dlg = $('dlgAjustes');
  if (!dlg.open) dlg.showModal();
}

function leerFormularioAjustes() {
  ajustes.url = $('cfgUrl').value.trim();
  ajustes.pin = $('cfgPin').value.trim();
  ajustes.voz = $('cfgVoz').checked;
  ajustes.velocidad = Number($('cfgVelocidad').value);
  ajustes.auto = $('cfgAuto').checked;
}

$('formAjustes').addEventListener('submit', () => {
  leerFormularioAjustes();
  Object.keys(ajustes).forEach((k) => guardado.escribir(k, ajustes[k]));
});

$('btnProbar').addEventListener('click', async () => {
  leerFormularioAjustes();
  const estado = $('estadoConexion');
  estado.className = 'nota';
  estado.textContent = 'Probando…';
  try {
    const r = await llamar({ accion: 'ping' });
    estado.className = 'nota ' + (r.ok ? 'ok' : 'mal');
    estado.textContent = r.ok ? '✔ ' + r.texto + (r.edicionHabilitada ? ' Cambios por voz: activos.' : ' Cambios por voz: falta PIN_EDICION.') : '✖ ' + r.error;
  } catch (e) {
    estado.className = 'nota mal';
    estado.textContent = '✖ ' + e.message;
  }
});

$('btnAjustes').addEventListener('click', abrirAjustes);

// ---------- Arranque ----------
$('formulario').addEventListener('submit', (e) => { e.preventDefault(); enviar($('texto').value); });
$('btnMic').addEventListener('click', () => { escuchandoUltimo = true; });
$('frecuentes').appendChild(chips(CONFIG.FRECUENTES, enviar));
burbuja('el', 'Hola. Pregúntame por los materiales de un producto. Toca el micrófono 🎤 o escribe abajo.');
prepararMicrofono();
if (!ajustes.url || !ajustes.pin) abrirAjustes();
