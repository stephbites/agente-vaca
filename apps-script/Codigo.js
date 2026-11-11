var TELEGRAM_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN";
var TELEGRAM_CHAT_ID = "YOUR_TELEGRAM_CHAT_ID";


function guardarNota(params) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = ss.getSheetByName("Notas");

    if (!hoja) {
        hoja = ss.insertSheet("Notas");
        hoja.appendRow(["ID", "Fecha", "Hora", "Nota"]);
    }

    var ahora = new Date();
    var fecha = params.fecha || Utilities.formatDate(ahora, "America/Lima", "yyyy-MM-dd");
    var hora = params.hora || Utilities.formatDate(ahora, "America/Lima", "HH:mm");
    var nota = params.nota || "";
    var ultimaFila = hoja.getLastRow();
    var nuevoId = ultimaFila;

    hoja.appendRow([nuevoId, fecha, hora, nota]);

    enviarTelegram("📝 <b>Nueva nota de Vaca</b>\n" + nota + "\n" + hora + " - " + fecha);

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            id: nuevoId,
            nota: nota,
            fecha: fecha,
            hora: hora
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function leerNotas(params) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = ss.getSheetByName("Notas");

    if (!hoja) {
        return ContentService
            .createTextOutput(JSON.stringify({
                resultado: "ok",
                fecha: params.fecha || "",
                total: 0,
                notas: []
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();

    var notas = [];
    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][1]).trim() === fecha) {
            notas.push({
                hora: String(datos[i][2]).trim(),
                nota: String(datos[i][3]).trim()
            });
        }
    }

    notas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            fecha: fecha,
            total: notas.length,
            notas: notas
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function cambiarHora(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var texto = (params.texto || "").toLowerCase();
    var nuevaHora = params.nueva_hora || "";
    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var candidatas = [];
    for (var i = 1; i < datos.length; i++) {
        var fFecha = String(datos[i][indiceFecha]).trim();
        var fEstado = String(datos[i][indiceEstado]).trim().toLowerCase();
        var fTarea = String(datos[i][indiceTarea]).trim();

        if (fFecha === fecha && fEstado === "pendiente" && fTarea.toLowerCase().indexOf(texto) !== -1) {
            candidatas.push({
                fila: i + 1,
                hora: String(datos[i][indiceHora]).trim(),
                tarea: fTarea
            });
        }
    }

    candidatas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (candidatas.length === 0) {
        return ContentService
            .createTextOutput(JSON.stringify({
                resultado: "no_encontrada",
                texto: texto,
                fecha: fecha
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var primera = candidatas[0];
    var horaAnterior = primera.hora;
    hoja.getRange(primera.fila, indiceHora + 1).setValue(nuevaHora);

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            tarea: primera.tarea,
            hora_anterior: horaAnterior,
            hora_nueva: nuevaHora
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function cancelarTarea(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var texto = (params.texto || "").toLowerCase();
    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var candidatas = [];
    for (var i = 1; i < datos.length; i++) {
        var fFecha = String(datos[i][indiceFecha]).trim();
        var fEstado = String(datos[i][indiceEstado]).trim().toLowerCase();
        var fTarea = String(datos[i][indiceTarea]).trim();

        if (fFecha === fecha && fEstado === "pendiente" && fTarea.toLowerCase().indexOf(texto) !== -1) {
            candidatas.push({
                fila: i + 1,
                hora: String(datos[i][indiceHora]).trim(),
                tarea: fTarea
            });
        }
    }

    candidatas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (candidatas.length === 0) {
        return ContentService
            .createTextOutput(JSON.stringify({
                resultado: "no_encontrada",
                texto: texto,
                fecha: fecha
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var primera = candidatas[0];
    hoja.deleteRow(primera.fila);

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            tarea: primera.tarea,
            hora: primera.hora
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function ajustarHorarioBoxeo() {
    var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Agenda");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    // Paso 1: encontrar fechas con boxeo/barre (desde 2026-11-10)
    var fechasAfectadas = {};
    for (var i = 1; i < datos.length; i++) {
        var fecha = String(datos[i][indiceFecha]).trim();
        var tarea = String(datos[i][indiceTarea]).trim().toLowerCase();
        if (fecha >= "2026-11-10" && (tarea.indexOf("boxeo") !== -1 || tarea.indexOf("barre") !== -1)) {
            fechasAfectadas[fecha] = true;
        }
    }

    // Paso 2: recorrer de abajo hacia arriba para borrar boxeo/barre y cambiar horas
    var filasABorrar = [];
    var filasACambiar = [];

    for (var i = 1; i < datos.length; i++) {
        var fecha = String(datos[i][indiceFecha]).trim();
        var hora = String(datos[i][indiceHora]).trim();
        var tarea = String(datos[i][indiceTarea]).trim();
        var tareaLow = tarea.toLowerCase();

        if (!fechasAfectadas[fecha]) continue;

        // Marcar boxeo/barre para borrar
        if (tareaLow.indexOf("boxeo") !== -1 || tareaLow.indexOf("barre") !== -1) {
            filasABorrar.push(i + 1);
            continue;
        }

        // Cambiar Ingles 20:30 -> 16:00
        if (hora === "20:30" && tareaLow.indexOf("ingles") !== -1) {
            filasACambiar.push({ fila: i + 1, columna: indiceHora + 1, valor: "16:00" });
            continue;
        }

        // Cambiar estudio 21:30 -> 17:00
        if (hora === "21:30") {
            filasACambiar.push({ fila: i + 1, columna: indiceHora + 1, valor: "17:00" });
            continue;
        }
    }

    // Aplicar cambios de hora
    for (var c = 0; c < filasACambiar.length; c++) {
        hoja.getRange(filasACambiar[c].fila, filasACambiar[c].columna).setValue(filasACambiar[c].valor);
    }

    // Borrar filas de abajo hacia arriba
    filasABorrar.sort(function(a, b) { return b - a; });
    for (var b = 0; b < filasABorrar.length; b++) {
        hoja.deleteRow(filasABorrar[b]);
    }

    // Paso 3: agregar Caminar/Correr para cada fecha afectada
    var fechas = Object.keys(fechasAfectadas).sort();
    var ultimaFila = hoja.getLastRow();
    for (var f = 0; f < fechas.length; f++) {
        ultimaFila++;
        hoja.appendRow([ultimaFila, fechas[f], "20:00", "Caminar/Correr (8pm - 10pm)", "Pendiente", "Si"]);
    }

    return {
        fechas_afectadas: fechas.length,
        boxeo_eliminados: filasABorrar.length,
        horas_cambiadas: filasACambiar.length,
        caminar_agregados: fechas.length
    };
}


function autorizarCalendar() {
    var calendario = CalendarApp.getDefaultCalendar();
    Logger.log("Calendar autorizado: " + calendario.getName());
}


function enviarTelegram(texto) {
    var url = "https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage";
    UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: texto,
            parse_mode: "HTML"
        })
    });
}


function resumenMatutino() {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var hoy = Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var diaSemana = Utilities.formatDate(new Date(), "America/Lima", "EEEE");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var tareas = [];
    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][indiceFecha]).trim() === hoy && String(datos[i][indiceEstado]).trim().toLowerCase() === "pendiente") {
            tareas.push({
                hora: String(datos[i][indiceHora]).trim(),
                tarea: String(datos[i][indiceTarea]).trim()
            });
        }
    }

    tareas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (tareas.length === 0) {
        enviarTelegram("Buenos dias Steph! Hoy " + diaSemana + " no tienes tareas pendientes.");
        return;
    }

    var mensaje = "Buenos dias Steph! Hoy es <b>" + diaSemana + " " + hoy + "</b>\n\n";
    mensaje += "Tienes <b>" + tareas.length + " tareas</b> para hoy:\n\n";

    for (var k = 0; k < tareas.length; k++) {
        var t = tareas[k];
        var emoji = "📋";
        var nombre = t.tarea.toLowerCase();
        if (nombre.includes("estudio")) emoji = "📚";
        else if (nombre.includes("clases")) emoji = "🎓";
        else if (nombre.includes("boxeo") || nombre.includes("barre")) emoji = "🥊";
        else if (nombre.includes("comsatel") || nombre.includes("proyecto")) emoji = "💻";
        else if (nombre.includes("ingles")) emoji = "🌎";
        else if (nombre.includes("rosatel")) emoji = "🌹";
        else if (nombre.includes("trabajo")) emoji = "💼";

        mensaje += emoji + " <b>" + t.hora + "</b> - " + t.tarea + "\n";
    }

    mensaje += "\nDale con todo! 💪";

    enviarTelegram(mensaje);
}


function doGet(e) {
    var params = e ? e.parameter : {};

    // Si recibe action=registrar, escribe una tarea en la hoja.
    if (params.action === "registrar") {
        return registrarTarea(params);
    }

    // Si recibe action=borrar, elimina filas por rango de IDs.
    if (params.action === "borrar") {
        return borrarFilas(params);
    }

    // Si recibe action=bulk, inserta muchas tareas de golpe (JSON en param "tareas").
    if (params.action === "bulk") {
        return bulkInsert(params);
    }

    // Si recibe action=renombrar, reemplaza texto en columna Tarea.
    if (params.action === "renombrar") {
        return renombrarTarea(params);
    }

    // Si recibe action=borrar_por_texto, elimina filas cuya tarea contenga el texto.
    if (params.action === "borrar_por_texto") {
        return borrarPorTexto(params);
    }

    // Si recibe action=cancelar, elimina la primera tarea pendiente que coincida.
    if (params.action === "cancelar") {
        return cancelarTarea(params);
    }

    // Si recibe action=ajustar_boxeo, hace el cambio masivo de horarios.
    if (params.action === "ajustar_boxeo") {
        var resultado = ajustarHorarioBoxeo();
        return ContentService
            .createTextOutput(JSON.stringify({ resultado: "ok", detalle: resultado }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // Si recibe action=cambiar_hora, cambia la hora de una tarea.
    if (params.action === "cambiar_hora") {
        return cambiarHora(params);
    }

    // Si recibe action=nota, guarda una nota de voz.
    if (params.action === "nota") {
        return guardarNota(params);
    }

    // Si recibe action=leer_notas, devuelve las notas de una fecha.
    if (params.action === "leer_notas") {
        return leerNotas(params);
    }

    // Si recibe action=reunion, crea evento en Calendar con Meet y avisa por Telegram.
    if (params.action === "reunion") {
        return crearReunion(params);
    }

    // Si recibe action=completar, marca la primera tarea pendiente que coincida.
    if (params.action === "completar") {
        return completarTarea(params);
    }

    // Si recibe action=reagendar, mueve una tarea a otra fecha.
    if (params.action === "reagendar") {
        return reagendarTarea(params);
    }

    // Si recibe action=logros, devuelve las tareas completadas del dia.
    if (params.action === "logros") {
        return logrosDia(params);
    }

    // Si recibe action=resumen, devuelve las tareas de una fecha formateadas.
    if (params.action === "resumen") {
        return resumenDia(params);
    }

    // Si recibe action=telegram, envia el resumen del dia por Telegram.
    if (params.action === "telegram") {
        resumenMatutino();
        return ContentService
            .createTextOutput(JSON.stringify({ resultado: "ok", enviado: "telegram" }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    // Si no, devuelve la agenda completa.
    const hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    const datos = hoja.getDataRange().getDisplayValues();

    return ContentService
        .createTextOutput(JSON.stringify(datos))
        .setMimeType(ContentService.MimeType.JSON);
}


function crearReunion(params) {
    var nombre = params.nombre || "Reunion";
    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var hora = params.hora || "10:00";
    var duracion = parseInt(params.duracion) || 60;

    var inicio = fecha + "T" + hora + ":00-05:00";
    var fin_ms = new Date(inicio).getTime() + duracion * 60 * 1000;
    var fin = new Date(fin_ms).toISOString();

    var token = ScriptApp.getOAuthToken();
    var url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1";

    var respuesta = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + token },
        payload: JSON.stringify({
            summary: nombre,
            start: { dateTime: inicio, timeZone: "America/Lima" },
            end: { dateTime: fin, timeZone: "America/Lima" },
            conferenceData: {
                createRequest: {
                    requestId: Utilities.getUuid(),
                    conferenceSolutionKey: { type: "hangoutsMeet" }
                }
            }
        })
    });

    var evento = JSON.parse(respuesta.getContentText());

    var meetLink = "";
    if (evento.conferenceData && evento.conferenceData.entryPoints) {
        for (var i = 0; i < evento.conferenceData.entryPoints.length; i++) {
            if (evento.conferenceData.entryPoints[i].entryPointType === "video") {
                meetLink = evento.conferenceData.entryPoints[i].uri;
                break;
            }
        }
    }

    // Enviar link por Telegram.
    if (meetLink) {
        var mensaje = "<b>Nueva reunion creada</b>\n\n";
        mensaje += nombre + "\n";
        mensaje += fecha + " a las " + hora + "\n";
        mensaje += "Duracion: " + duracion + " min\n\n";
        mensaje += "<a href='" + meetLink + "'>Unirse a Meet</a>";
        enviarTelegram(mensaje);
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            nombre: nombre,
            fecha: fecha,
            hora: hora,
            meet_link: meetLink,
            evento_id: evento.id
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function registrarTarea(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var ultimaFila = hoja.getLastRow();
    var nuevoId = ultimaFila;

    var fecha = params.fecha || "";
    var hora = params.hora || "";
    var tarea = params.tarea || "";
    var estado = "Pendiente";
    var alertar = params.alertar || "No";

    hoja.appendRow([nuevoId, fecha, hora, tarea, estado, alertar]);

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            id: nuevoId,
            tarea: tarea
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function bulkInsert(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var tareas = JSON.parse(params.tareas);
    var ultimaFila = hoja.getLastRow();
    var filas = [];

    for (var i = 0; i < tareas.length; i++) {
        var t = tareas[i];
        var id = ultimaFila + i;
        filas.push([id, t.fecha, t.hora, t.tarea, "Pendiente", t.alertar || "No"]);
    }

    if (filas.length > 0) {
        hoja.getRange(ultimaFila + 1, 1, filas.length, 6).setValues(filas);
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            insertadas: filas.length
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function resumenDia(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    // Buscar indices por nombre (trim para evitar espacios extra).
    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var tareas = [];
    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][indiceFecha]).trim() === fecha && String(datos[i][indiceEstado]).trim().toLowerCase() === "pendiente") {
            tareas.push({
                hora: String(datos[i][indiceHora]).trim(),
                tarea: String(datos[i][indiceTarea]).trim()
            });
        }
    }

    tareas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    return ContentService
        .createTextOutput(JSON.stringify({
            fecha: fecha,
            total: tareas.length,
            tareas: tareas
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function completarTarea(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var texto = (params.texto || "").toLowerCase();
    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    // Buscar tareas pendientes de hoy que coincidan, ordenadas por hora.
    var candidatas = [];
    for (var i = 1; i < datos.length; i++) {
        var fFecha = String(datos[i][indiceFecha]).trim();
        var fEstado = String(datos[i][indiceEstado]).trim().toLowerCase();
        var fTarea = String(datos[i][indiceTarea]).trim();

        if (fFecha === fecha && fEstado === "pendiente" && fTarea.toLowerCase().indexOf(texto) !== -1) {
            candidatas.push({
                fila: i + 1,
                hora: String(datos[i][indiceHora]).trim(),
                tarea: fTarea
            });
        }
    }

    // Ordenar por hora y marcar solo la primera.
    candidatas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (candidatas.length === 0) {
        return ContentService
            .createTextOutput(JSON.stringify({
                resultado: "no_encontrada",
                texto: texto,
                fecha: fecha
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var primera = candidatas[0];
    hoja.getRange(primera.fila, indiceEstado + 1).setValue("Completada");

    // Buscar la siguiente tarea pendiente del dia (cualquier tarea, no solo la misma).
    var siguiente = null;
    var todasPendientes = [];
    for (var k = 1; k < datos.length; k++) {
        var kFecha = String(datos[k][indiceFecha]).trim();
        var kEstado = String(datos[k][indiceEstado]).trim().toLowerCase();
        var kFila = k + 1;

        if (kFecha === fecha && kEstado === "pendiente" && kFila !== primera.fila) {
            todasPendientes.push({
                hora: String(datos[k][indiceHora]).trim(),
                tarea: String(datos[k][indiceTarea]).trim()
            });
        }
    }
    todasPendientes.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (todasPendientes.length > 0) {
        siguiente = todasPendientes[0];
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            tarea: primera.tarea,
            hora: primera.hora,
            pendientes_restantes: candidatas.length - 1,
            siguiente: siguiente,
            total_pendientes: todasPendientes.length
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function reagendarTarea(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var texto = (params.texto || "").toLowerCase();
    var nuevaFecha = params.nueva_fecha || "";
    var fechaOrigen = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var candidatas = [];
    for (var i = 1; i < datos.length; i++) {
        var fFecha = String(datos[i][indiceFecha]).trim();
        var fEstado = String(datos[i][indiceEstado]).trim().toLowerCase();
        var fTarea = String(datos[i][indiceTarea]).trim();

        if (fFecha === fechaOrigen && fEstado === "pendiente" && fTarea.toLowerCase().indexOf(texto) !== -1) {
            candidatas.push({
                fila: i + 1,
                hora: String(datos[i][indiceHora]).trim(),
                tarea: fTarea
            });
        }
    }

    candidatas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    if (candidatas.length === 0) {
        return ContentService
            .createTextOutput(JSON.stringify({
                resultado: "no_encontrada",
                texto: texto,
                fecha: fechaOrigen
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }

    var primera = candidatas[0];
    hoja.getRange(primera.fila, indiceFecha + 1).setValue(nuevaFecha);

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            tarea: primera.tarea,
            hora: primera.hora,
            fecha_anterior: fechaOrigen,
            fecha_nueva: nuevaFecha
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function logrosDia(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var fecha = params.fecha || Utilities.formatDate(new Date(), "America/Lima", "yyyy-MM-dd");
    var datos = hoja.getDataRange().getDisplayValues();
    var encabezados = datos[0];

    var indiceFecha = -1, indiceHora = -1, indiceTarea = -1, indiceEstado = -1;
    for (var j = 0; j < encabezados.length; j++) {
        var col = String(encabezados[j]).trim().toLowerCase();
        if (col === "fecha") indiceFecha = j;
        else if (col === "hora") indiceHora = j;
        else if (col === "tarea") indiceTarea = j;
        else if (col === "estado") indiceEstado = j;
    }

    var completadas = [];
    var pendientes = 0;
    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][indiceFecha]).trim() !== fecha) continue;
        var estado = String(datos[i][indiceEstado]).trim().toLowerCase();
        if (estado === "completada") {
            completadas.push({
                hora: String(datos[i][indiceHora]).trim(),
                tarea: String(datos[i][indiceTarea]).trim()
            });
        } else if (estado === "pendiente") {
            pendientes++;
        }
    }

    completadas.sort(function(a, b) { return a.hora.localeCompare(b.hora); });

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            fecha: fecha,
            completadas: completadas,
            total_completadas: completadas.length,
            total_pendientes: pendientes
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function renombrarTarea(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var buscar = params.buscar || "";
    var reemplazo = params.reemplazo || "";
    var datos = hoja.getDataRange().getDisplayValues();
    var cambiadas = 0;

    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][3]).trim() === buscar) {
            hoja.getRange(i + 1, 4).setValue(reemplazo);
            cambiadas++;
        }
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            cambiadas: cambiadas
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function borrarPorTexto(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var texto = params.texto || "";
    var datos = hoja.getDataRange().getDisplayValues();
    var borradas = 0;

    for (var i = datos.length - 1; i >= 1; i--) {
        if (String(datos[i][3]).indexOf(texto) !== -1) {
            hoja.deleteRow(i + 1);
            borradas++;
        }
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            borradas: borradas
        }))
        .setMimeType(ContentService.MimeType.JSON);
}


function borrarFilas(params) {
    var hoja = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Agenda");

    var desde = parseInt(params.desde);
    var hasta = parseInt(params.hasta);
    var datos = hoja.getDataRange().getDisplayValues();
    var borradas = 0;

    // Borrar de abajo hacia arriba para no desfasar indices.
    for (var i = datos.length - 1; i >= 1; i--) {
        var id = parseInt(datos[i][0]);
        if (id >= desde && id <= hasta) {
            hoja.deleteRow(i + 1);
            borradas++;
        }
    }

    return ContentService
        .createTextOutput(JSON.stringify({
            resultado: "ok",
            borradas: borradas
        }))
        .setMimeType(ContentService.MimeType.JSON);
}
