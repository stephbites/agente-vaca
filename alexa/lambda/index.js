const Alexa = require('ask-sdk-core');
const https = require('https');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');

// ==================================================
// HELPER: obtener fecha Lima como string YYYY-MM-DD
// ==================================================
function fechaLima() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

// ==================================================
// HELPER: actualizar racha de días consecutivos
// ==================================================
function actualizarRacha(attrs) {
    const hoy = fechaLima();
    if (!attrs.ultimaFecha) {
        attrs.ultimaFecha = hoy;
        attrs.racha = 1;
        return;
    }
    if (attrs.ultimaFecha === hoy) return;

    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

    if (attrs.ultimaFecha === ayerStr) {
        attrs.racha = (attrs.racha || 0) + 1;
    } else {
        attrs.racha = 1;
    }
    attrs.ultimaFecha = hoy;
}

// ==================================================
// 1. CONSULTAR LA API DE GOOGLE APPS SCRIPT
// ==================================================

function consultarAPI(url, redireccionesRestantes = 5) {
    return new Promise((resolve, reject) => {
        const solicitud = https.get(url, (respuesta) => {
            const status = respuesta.statusCode;

            // Seguir las redirecciones de Google.
            if (
                [301, 302, 303, 307, 308].includes(status) &&
                respuesta.headers.location
            ) {
                respuesta.resume();

                if (redireccionesRestantes <= 0) {
                    reject(
                        new Error('Se superó el límite de redirecciones')
                    );
                    return;
                }

                const nuevaUrl = new URL(
                    respuesta.headers.location,
                    url
                );

                if (nuevaUrl.protocol !== 'https:') {
                    reject(
                        new Error('La redirección no utiliza HTTPS')
                    );
                    return;
                }

                consultarAPI(
                    nuevaUrl.href,
                    redireccionesRestantes - 1
                )
                    .then(resolve)
                    .catch(reject);

                return;
            }

            let datos = '';

            respuesta.setEncoding('utf8');

            respuesta.on('data', (fragmento) => {
                datos += fragmento;
            });

            respuesta.on('end', () => {
                resolve({
                    status: status,
                    texto: datos
                });
            });

            respuesta.on('error', reject);
        });

        solicitud.setTimeout(8000, () => {
            solicitud.destroy(
                new Error('La API tardó demasiado en responder')
            );
        });

        solicitud.on('error', reject);
    });
}

// ==================================================
// 2. SALUDO INICIAL
// ==================================================

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'LaunchRequest';
    },

    async handle(handlerInput) {
        const attrsManager = handlerInput.attributesManager;
        let attrs = await attrsManager.getPersistentAttributes() || {};

        // Inicializar si es primera vez
        if (!attrs.tareasCompletadasTotal) attrs.tareasCompletadasTotal = 0;
        if (!attrs.notasTotal) attrs.notasTotal = 0;
        if (!attrs.racha) attrs.racha = 0;
        if (!attrs.sesiones) attrs.sesiones = 0;

        attrs.sesiones += 1;
        actualizarRacha(attrs);

        attrsManager.setPersistentAttributes(attrs);
        await attrsManager.savePersistentAttributes();

        let saludo = '<audio src="soundbank://soundlibrary/animals/amzn_sfx_dog_small_bark_2x_01"/>';

        if (attrs.sesiones === 1) {
            saludo += '¡Hola Steph! Soy Vaca, tu asistente personal. ¿Qué hacemos?';
        } else if (attrs.racha >= 3) {
            saludo += 'Hola Steph, llevamos ' + attrs.racha + ' días seguidos juntos. ¡Moveré mi colita de la emoción! ¿Qué hacemos?';
        } else {
            saludo += 'Hola Steph, Vaca al servicio. ¿Qué hacemos?';
        }

        return handlerInput.responseBuilder
            .speak(saludo)
            .reprompt('¿Qué deseas hacer?')
            .getResponse();
    }
};

// ==================================================
// 3. INTENCIÓN DE SALUDO
// ==================================================

const HelloWorldIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'HelloWorldIntent';
    },

    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Hola Steph. Soy agente Vaca.')
            .getResponse();
    }
};

// ==================================================
// 4. REGISTRAR TAREA
// Guarda la tarea en Google Sheets via Apps Script.
// ==================================================

const RegistrarTareaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'RegistrarTareaIntent';
    },

    async handle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        const slots = request.intent.slots || {};

        const tarea = slots.tarea && slots.tarea.value;
        const fechaSlot = slots.fecha && slots.fecha.value;
        const horaSlot = slots.hora && slots.hora.value;

        // Si falta algún dato, pedirlo al usuario.
        if (!tarea) {
            return handlerInput.responseBuilder
                .speak('¿Qué tarea quieres registrar?')
                .reprompt('Dime el nombre de la tarea.')
                .addElicitSlotDirective('tarea')
                .getResponse();
        }

        if (!fechaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Para qué fecha?')
                .reprompt('Dime la fecha. Por ejemplo: hoy, mañana, o el viernes.')
                .addElicitSlotDirective('fecha')
                .getResponse();
        }

        if (!horaSlot) {
            return handlerInput.responseBuilder
                .speak('¿A qué hora?')
                .reprompt('Dime la hora. Por ejemplo: a las 3, a las 10 de la mañana.')
                .addElicitSlotDirective('hora')
                .getResponse();
        }

        try {
            // AMAZON.DATE devuelve YYYY-MM-DD.
            const fecha = fechaSlot;

            // AMAZON.TIME devuelve HH:MM (24h).
            const hora = horaSlot;

            // Enviar a Apps Script.
            const params = [
                'action=registrar',
                'tarea=' + encodeURIComponent(tarea),
                'fecha=' + encodeURIComponent(fecha),
                'hora=' + encodeURIComponent(hora),
                'alertar=No'
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);

            console.log('REGISTRO:', resultado.texto);

            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                // Crear recordatorio en Alexa.
                let avisoTexto = ' Te avisaré cuando sea la hora.';
                try {
                    const reminderPayload = {
                        requestTime: new Date().toISOString(),
                        trigger: {
                            type: 'SCHEDULED_ABSOLUTE',
                            scheduledTime: fecha + 'T' + hora + ':00',
                            timeZoneId: 'America/Lima'
                        },
                        alertInfo: {
                            spokenInfo: {
                                content: [{
                                    locale: 'es-MX',
                                    text: 'Steph, tienes pendiente: ' + tarea
                                }]
                            }
                        },
                        pushNotification: {
                            status: 'ENABLED'
                        }
                    };

                    const reminderClient =
                        handlerInput.serviceClientFactory.getReminderManagementServiceClient();

                    await reminderClient.createReminder(reminderPayload);
                } catch (reminderError) {
                    console.log('RECORDATORIO ERROR:', reminderError);
                    avisoTexto = ' No pude crear el recordatorio. Revisa los permisos en la app de Alexa.';
                }

                return handlerInput.responseBuilder
                    .speak(
                        '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_neutral_response_02"/>' +
                        '¡Peeeerfecto! Registré: ' + tarea +
                        ', para las ' + hora + '.' + avisoTexto +
                        ' Moveré mi colita de la emoción.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                throw new Error('Respuesta inesperada de la API');
            }

        } catch (error) {
            console.log('ERROR REGISTRANDO:', error);

            return handlerInput.responseBuilder
                .speak(
                    'Steph, escuché la tarea: ' + tarea +
                    ', pero no pude guardarla. Inténtalo de nuevo.'
                )
                .getResponse();
        }
    }
};

// ==================================================
// 5. CONSULTAR TAREAS PENDIENTES
// ==================================================

const ConsultarPendientesIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'ConsultarPendientesIntent';
    },

    async handle(handlerInput) {
        try {
            // Obtener la fecha solicitada.
            // Si el usuario dice "hoy", Alexa envía la fecha actual.
            // Si no dice fecha, usamos la fecha de hoy en Lima.
            const slots =
                handlerInput.requestEnvelope.request.intent.slots || {};

            let fechaBuscada;

            if (slots.fecha && slots.fecha.value) {
                // AMAZON.DATE devuelve formato YYYY-MM-DD.
                fechaBuscada = slots.fecha.value;
            } else {
                // Calcular la fecha de hoy en Lima (UTC-5).
                const ahora = new Date();
                fechaBuscada = ahora.toLocaleDateString('en-CA', {
                    timeZone: 'America/Lima'
                });
            }

            console.log('FECHA BUSCADA:', fechaBuscada);

            const url =
                'YOUR_APPS_SCRIPT_URL';

            const resultado = await consultarAPI(url);

            console.log('STATUS API:', resultado.status);

            if (
                resultado.status < 200 ||
                resultado.status >= 300
            ) {
                throw new Error(
                    'La API respondió con HTTP ' + resultado.status
                );
            }

            // Convertir el JSON recibido en datos de JavaScript.
            const filas = JSON.parse(resultado.texto);

            if (!Array.isArray(filas) || filas.length === 0) {
                throw new Error(
                    'La API no devolvió una tabla con encabezados'
                );
            }

            // Identificar las columnas por sus nombres.
            const encabezados = filas[0].map((columna) =>
                String(columna).trim()
            );

            const indiceFecha = encabezados.indexOf('Fecha');
            const indiceHora = encabezados.indexOf('Hora');
            const indiceTarea = encabezados.indexOf('Tarea');
            const indiceEstado = encabezados.indexOf('Estado');

            if (indiceTarea === -1 || indiceEstado === -1 || indiceFecha === -1) {
                throw new Error(
                    'No se encontraron las columnas Fecha, Tarea y Estado'
                );
            }

            // Filtrar: solo tareas pendientes de la fecha solicitada.
            const pendientes = filas.slice(1).filter((fila) => {
                const fecha = String(fila[indiceFecha] || '').trim();
                const estado = String(fila[indiceEstado] || '')
                    .trim().toLowerCase();
                const tarea = String(fila[indiceTarea] || '').trim();

                return fecha === fechaBuscada
                    && estado === 'pendiente'
                    && tarea !== '';
            });

            // Ordenar por hora.
            if (indiceHora !== -1) {
                pendientes.sort((a, b) => {
                    const horaA = String(a[indiceHora] || '');
                    const horaB = String(b[indiceHora] || '');
                    return horaA.localeCompare(horaB);
                });
            }

            let speakOutput;

            if (pendientes.length === 0) {
                speakOutput =
                    'Steph, no tienes tareas pendientes para esa fecha. Voy a echarme una siesta entonces.';
            } else {
                const cantidad = pendientes.length;

                // Alexa leerá como máximo cinco tareas por consulta.
                const tareasParaLeer = pendientes
                    .slice(0, 5)
                    .map((fila) => {
                        const hora = String(fila[indiceHora] || '').trim();
                        const tarea = String(fila[indiceTarea]).trim();
                        return hora ? hora + ', ' + tarea : tarea;
                    });

                speakOutput =
                    '¡Ya veo! Tienes ' + cantidad +
                    (cantidad === 1
                        ? ' tarea pendiente. '
                        : ' tareas pendientes. ') +
                    tareasParaLeer.join('. ') + '.';

                if (cantidad > 5) {
                    speakOutput +=
                        ' Hay ' + (cantidad - 5) +
                        ' tareas más.';
                }
            }

            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('¿Qué más necesitas?')
                .getResponse();

        } catch (error) {
            console.log('ERROR CONSULTANDO API:', error);

            return handlerInput.responseBuilder
                .speak(
                    'Steph, no pude consultar tus pendientes. ' +
                    'Inténtalo nuevamente en unos momentos.'
                )
                .getResponse();
        }
    }
};

// ==================================================
// 6. PROGRAMAR RECORDATORIOS DEL DÍA
// Lee las tareas de hoy del Sheet y crea un
// recordatorio de Alexa para cada una.
// ==================================================

const ProgramarDiaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'ProgramarDiaIntent';
    },

    async handle(handlerInput) {
        try {
            // Fecha de hoy en Lima.
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            // Leer solo las tareas de hoy.
            const url =
                'YOUR_APPS_SCRIPT_URL?action=resumen&fecha=' + hoy;

            const resultado = await consultarAPI(url);

            if (resultado.status < 200 || resultado.status >= 300) {
                throw new Error('API error: ' + resultado.status);
            }

            const resumen = JSON.parse(resultado.texto);

            if (resumen.total === 0) {
                return handlerInput.responseBuilder
                    .speak('Steph, no tienes tareas pendientes para hoy.')
                    .getResponse();
            }

            // Leer las primeras 8 tareas (no estudio ni almuerzo).
            const importantes = resumen.tareas.filter(t => {
                const nombre = t.tarea.toLowerCase();
                return !nombre.includes('almuerzo')
                    && !nombre.includes('cena')
                    && !nombre.includes('cierre del dia')
                    && !nombre.includes('inicio del dia');
            });

            const maximo = importantes.slice(0, 8);

            // Crear reminders para tareas futuras (fire and forget).
            let remindersCreados = 0;
            try {
                const reminderClient =
                    handlerInput.serviceClientFactory.getReminderManagementServiceClient();

                const horaActual = ahora.toLocaleTimeString('en-GB', {
                    timeZone: 'America/Lima',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const futuras = importantes.filter(t => t.hora > horaActual);
                const paraRecordar = futuras.slice(0, 8);

                for (const t of paraRecordar) {
                    reminderClient.createReminder({
                        requestTime: new Date().toISOString(),
                        trigger: {
                            type: 'SCHEDULED_ABSOLUTE',
                            scheduledTime: hoy + 'T' + t.hora + ':00',
                            timeZoneId: 'America/Lima'
                        },
                        alertInfo: {
                            spokenInfo: {
                                content: [{
                                    locale: 'es-MX',
                                    text: 'Steph, tienes pendiente: ' + t.tarea
                                }]
                            }
                        },
                        pushNotification: { status: 'ENABLED' }
                    }).catch(e => console.log('Reminder skip:', t.tarea, e.message));
                    remindersCreados++;
                }
            } catch (reminderError) {
                console.log('REMINDERS NO DISPONIBLES:', reminderError.message);
            }

            let speakOutput = '';

            if (remindersCreados > 0) {
                speakOutput += '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_neutral_response_02"/>' +
                    '¡Liiisto! Programé ' + remindersCreados +
                    ' recordatorios para hoy. ';
            } else {
                speakOutput += 'Steph, no hay tareas futuras para programar recordatorios. Voy a echarme una siesta entonces. ';
            }

            speakOutput += 'Tienes ' + resumen.total + ' tareas. Las principales son: ';

            speakOutput += maximo.map(t =>
                'A las ' + t.hora + ', ' + t.tarea
            ).join('. ') + '.';

            if (importantes.length > 8) {
                speakOutput += ' Y ' + (importantes.length - 8) +
                    ' más. Revisa tu agenda para el detalle completo. Ya sabes que necesito atención cuando termines.';
            }

            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('¿Qué más necesitas?')
                .getResponse();

        } catch (error) {
            console.log('ERROR PROGRAMAR DIA:', error);

            return handlerInput.responseBuilder
                .speak(
                    'Steph, no pude leer tu agenda. ' +
                    'Inténtalo de nuevo.'
                )
                .getResponse();
        }
    }
};

// ==================================================
// 7. CANCELAR TAREA
// ==================================================

const CancelarTareaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'CancelarTareaIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const tareaSlot = slots.tarea && slots.tarea.value;

        if (!tareaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Qué tarea quieres eliminar?')
                .reprompt('Dime el nombre de la tarea.')
                .addElicitSlotDirective('tarea')
                .getResponse();
        }

        try {
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            const params = [
                'action=cancelar',
                'texto=' + encodeURIComponent(tareaSlot),
                'fecha=' + hoy
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                return handlerInput.responseBuilder
                    .speak(
                        '¡Te sigo! Eliminé ' + respuesta.tarea +
                        ' de las ' + respuesta.hora + '. Prometo no morderle los zapatos a nadie... hoy.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                return handlerInput.responseBuilder
                    .speak(
                        'Steph, no encontré una tarea pendiente de ' +
                        tareaSlot + ' para hoy.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            }

        } catch (error) {
            console.log('ERROR CANCELANDO:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude eliminar la tarea. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 8. CREAR REUNIÓN CON MEET
// ==================================================

const CrearReunionIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'CrearReunionIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const nombreSlot = slots.nombre && slots.nombre.value;
        const fechaSlot = slots.fecha && slots.fecha.value;
        const horaSlot = slots.hora && slots.hora.value;

        if (!nombreSlot) {
            return handlerInput.responseBuilder
                .speak('¿Cómo se llama la reunión?')
                .reprompt('Dime el nombre de la reunión.')
                .addElicitSlotDirective('nombre')
                .getResponse();
        }

        if (!fechaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Para qué fecha?')
                .reprompt('Dime la fecha. Por ejemplo: hoy, mañana, o el lunes.')
                .addElicitSlotDirective('fecha')
                .getResponse();
        }

        if (!horaSlot) {
            return handlerInput.responseBuilder
                .speak('¿A qué hora?')
                .reprompt('Dime la hora.')
                .addElicitSlotDirective('hora')
                .getResponse();
        }

        try {
            const params = [
                'action=reunion',
                'nombre=' + encodeURIComponent(nombreSlot),
                'fecha=' + encodeURIComponent(fechaSlot),
                'hora=' + encodeURIComponent(horaSlot)
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                let speakOutput = '¡Peeeerfecto! Moveré mi colita para celebrar. Creé la reunión ' +
                    respuesta.nombre + ' para el ' + fechaSlot +
                    ' a las ' + horaSlot + '.';

                if (respuesta.meet_link) {
                    speakOutput += ' Te envié el link de Meet por Telegram.';
                }

                return handlerInput.responseBuilder
                    .speak(speakOutput)
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                throw new Error('Respuesta inesperada');
            }

        } catch (error) {
            console.log('ERROR REUNION:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude crear la reunión. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 8. GUARDAR NOTA POR VOZ
// ==================================================

const GuardarNotaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'GuardarNotaIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const notaSlot = slots.nota && slots.nota.value;

        if (!notaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Qué quieres anotar?')
                .reprompt('Dime lo que quieres que guarde.')
                .addElicitSlotDirective('nota')
                .getResponse();
        }

        try {
            const params = [
                'action=nota',
                'nota=' + encodeURIComponent(notaSlot)
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                // Actualizar contador persistente
                const attrsManager = handlerInput.attributesManager;
                let attrs = await attrsManager.getPersistentAttributes() || {};
                attrs.notasTotal = (attrs.notasTotal || 0) + 1;
                attrsManager.setPersistentAttributes(attrs);
                await attrsManager.savePersistentAttributes();

                return handlerInput.responseBuilder
                    .speak(
                        '¡Te sigo! Anoté: ' + respuesta.nota + '. Ah, y dile a Cuto que es adoptado.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                throw new Error('Respuesta inesperada');
            }

        } catch (error) {
            console.log('ERROR NOTA:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude guardar la nota. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 9. LEER NOTAS DEL DÍA
// ==================================================

const LeerNotasIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'LeerNotasIntent';
    },

    async handle(handlerInput) {
        try {
            const slots =
                handlerInput.requestEnvelope.request.intent.slots || {};

            let fecha;
            if (slots.fecha && slots.fecha.value) {
                fecha = slots.fecha.value;
            } else {
                const ahora = new Date();
                fecha = ahora.toLocaleDateString('en-CA', {
                    timeZone: 'America/Lima'
                });
            }

            const url =
                'YOUR_APPS_SCRIPT_URL?action=leer_notas&fecha=' + fecha;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.total === 0) {
                return handlerInput.responseBuilder
                    .speak('Steph, no tienes notas guardadas para hoy. Si me porto bien, ¿me das una galletita?')
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            }

            let speakOutput = '¡A ver! Tienes ' + respuesta.total +
                (respuesta.total === 1 ? ' nota. ' : ' notas. ');

            const paraLeer = respuesta.notas.slice(0, 5);
            speakOutput += paraLeer.map(n =>
                'A las ' + n.hora + ': ' + n.nota
            ).join('. ') + '.';

            if (respuesta.total > 5) {
                speakOutput += ' Hay ' + (respuesta.total - 5) + ' más.';
            }

            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('¿Qué más necesitas?')
                .getResponse();

        } catch (error) {
            console.log('ERROR LEER NOTAS:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude leer tus notas. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 10. CAMBIAR HORA DE TAREA
// ==================================================

const CambiarHoraTareaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'CambiarHoraTareaIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const tareaSlot = slots.tarea && slots.tarea.value;
        const horaSlot = slots.hora && slots.hora.value;

        if (!tareaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Qué tarea quieres cambiar de hora?')
                .reprompt('Dime el nombre de la tarea.')
                .addElicitSlotDirective('tarea')
                .getResponse();
        }

        if (!horaSlot) {
            return handlerInput.responseBuilder
                .speak('¿A qué hora la muevo?')
                .reprompt('Dime la nueva hora.')
                .addElicitSlotDirective('hora')
                .getResponse();
        }

        try {
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            const params = [
                'action=cambiar_hora',
                'texto=' + encodeURIComponent(tareaSlot),
                'fecha=' + hoy,
                'nueva_hora=' + encodeURIComponent(horaSlot)
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                return handlerInput.responseBuilder
                    .speak(
                        '¡Ya veo! Moví ' + respuesta.tarea +
                        ' de las ' + respuesta.hora_anterior +
                        ' a las ' + horaSlot + '. Eso me da más energía que perseguir mi cola.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                return handlerInput.responseBuilder
                    .speak(
                        'Steph, no encontré una tarea pendiente de ' +
                        tareaSlot + ' para hoy.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            }

        } catch (error) {
            console.log('ERROR CAMBIAR HORA:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude cambiar la hora. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 11. QUIÉN ES CUTO
// ==================================================

const QuienEsCutoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'QuienEsCutoIntent';
    },

    handle(handlerInput) {
        const speakOutput =
            '<audio src="soundbank://soundlibrary/animals/amzn_sfx_dog_small_bark_2x_01"/>' +
            '<prosody rate="95%">' +
            'Cuto. ' +
            '<break time="0.4s"/>' +
            'Mi hermano adoptado. Le decimos Pato, porque tiene la colita corta como pato. ' +
            '<break time="0.3s"/>' +
            'Es leal y buen perrito, eso sí. ' +
            'Pero le encanta robarme la comida, y eso no se lo perdono. ' +
            '<break time="0.5s"/>' +
            'No le gustan los extraños. ' +
            '<break time="0.3s"/>' +
            'Y la vecina gritona le cae especialmente mal. ' +
            '<break time="0.3s"/>' +
            'Pero cuando se porta bien, es un buen compañero. ' +
            '<break time="0.4s"/>' +
            'Eso sí, no tan genial como yo, obvio.' +
            '</prosody>';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('¿Necesitas algo más?')
            .getResponse();
    }
};

// ==================================================
// 11. QUIÉN ES VACA
// ==================================================

const QuienEresIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'QuienEresIntent';
    },

    handle(handlerInput) {
        const speakOutput =
            '<audio src="soundbank://soundlibrary/animals/amzn_sfx_dog_small_bark_2x_01"/>' +
            '<prosody rate="95%">' +
            'Mucho gusto, soy Vaca. ' +
            '<break time="0.4s"/>' +
            'Un perrito refinado de gustos exquisitos. ' +
            '<break time="0.3s"/>' +
            'Solo duermo en camas o en el sofá, porque el suelo no es digno de mi pelaje. ' +
            '<break time="0.3s"/>' +
            'Me mareo en el carro, así que prefiero no ir a ningún lado. ' +
            '<break time="0.3s"/>' +
            'Mi humano favorito es mi papá, ' +
            'y en segundo lugar mi mamá, aunque no se lo digan. ' +
            '<break time="0.6s"/>' +
            'Ahora, lo importante. ' +
            '<break time="0.3s"/>' +
            'Trabajo como agente personal de Steph. ' +
            'Le organizo su día, le recuerdo sus tareas, ' +
            'registro lo que me pida y le aviso qué sigue. ' +
            '<break time="0.3s"/>' +
            'Todo a cambio de pollito, que es mi forma de pago preferida. ' +
            '<break time="0.6s"/>' +
            '¡Ah! Y tengo un hermano, se llama Cuto. Si quieres saber de él, pregúntame quién es Cuto.' +
            '</prosody>';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('¿Necesitas algo más?')
            .getResponse();
    }
};

// ==================================================
// 8. LOGROS DEL DÍA
// ==================================================

const LogrosDelDiaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'LogrosDelDiaIntent';
    },

    async handle(handlerInput) {
        try {
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            const url =
                'YOUR_APPS_SCRIPT_URL?action=logros&fecha=' + hoy;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            const hechas = respuesta.total_completadas;
            const pendientes = respuesta.total_pendientes;
            const total = hechas + pendientes;

            let speakOutput;

            if (hechas === 0) {
                speakOutput = 'Ohhh, aún no has completado tareas hoy. ' +
                    'Tienes ' + pendientes + ' pendientes. Necesito amor... y que completes tus tareas. ¡Vamos con todo!';
            } else {
                speakOutput = '¡A ver! Hoy completaste ' + hechas +
                    ' de ' + total + ' tareas. ';

                if (pendientes === 0) {
                    speakOutput += '<audio src="soundbank://soundlibrary/animals/amzn_sfx_dog_small_bark_2x_01"/>' +
                        '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_intro_01"/>' +
                        '¡Terminaste todo! Eso merece muchos besitos y mucho pollito.';
                } else {
                    speakOutput += 'Te faltan ' + pendientes + ' por hacer. ';

                    const porcentaje = Math.round((hechas / total) * 100);
                    if (porcentaje >= 75) {
                        speakOutput += '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_01"/>' +
                            '¡Ohhh ya casi! ¡Dale dale!';
                    } else if (porcentaje >= 50) {
                        speakOutput += 'Vas por buen camino. No te olvides de mi pollito.';
                    } else {
                        speakOutput += '¡Tú puedes! Ya sabes que necesito atención cuando termines.';
                    }
                }
            }

            return handlerInput.responseBuilder
                .speak(speakOutput)
                .reprompt('¿Qué más necesitas?')
                .getResponse();

        } catch (error) {
            console.log('ERROR LOGROS:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude consultar tus logros. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 9. REAGENDAR TAREA
// ==================================================

const ReagendarTareaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'ReagendarTareaIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const tareaSlot = slots.tarea && slots.tarea.value;
        const fechaSlot = slots.fecha && slots.fecha.value;

        if (!tareaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Qué tarea quieres mover?')
                .reprompt('Dime el nombre de la tarea.')
                .addElicitSlotDirective('tarea')
                .getResponse();
        }

        if (!fechaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Para qué fecha la muevo?')
                .reprompt('Dime la nueva fecha. Por ejemplo: mañana, el lunes, o el viernes.')
                .addElicitSlotDirective('fecha')
                .getResponse();
        }

        try {
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            const params = [
                'action=reagendar',
                'texto=' + encodeURIComponent(tareaSlot),
                'fecha=' + hoy,
                'nueva_fecha=' + encodeURIComponent(fechaSlot)
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                return handlerInput.responseBuilder
                    .speak(
                        '¡Te sigo! Moví ' + respuesta.tarea +
                        ' de las ' + respuesta.hora +
                        ' para el ' + fechaSlot + '. Si me porto bien, ¿me das una galletita?'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                return handlerInput.responseBuilder
                    .speak(
                        'Steph, no encontré una tarea pendiente de ' +
                        tareaSlot + ' para hoy.'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            }

        } catch (error) {
            console.log('ERROR REAGENDANDO:', error);

            return handlerInput.responseBuilder
                .speak('Steph, no pude reagendar la tarea. Inténtalo de nuevo.')
                .getResponse();
        }
    }
};

// ==================================================
// 10. COMPLETAR TAREA
// Marca como completada la primera tarea pendiente
// de hoy que coincida con lo que dijo el usuario.
// ==================================================

const CompletarTareaIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'CompletarTareaIntent';
    },

    async handle(handlerInput) {
        const slots =
            handlerInput.requestEnvelope.request.intent.slots || {};

        const tareaSlot = slots.tarea && slots.tarea.value;

        if (!tareaSlot) {
            return handlerInput.responseBuilder
                .speak('¿Qué tarea terminaste?')
                .reprompt('Dime el nombre de la tarea que completaste.')
                .addElicitSlotDirective('tarea')
                .getResponse();
        }

        try {
            const ahora = new Date();
            const hoy = ahora.toLocaleDateString('en-CA', {
                timeZone: 'America/Lima'
            });

            const params = [
                'action=completar',
                'texto=' + encodeURIComponent(tareaSlot),
                'fecha=' + hoy
            ].join('&');

            const url =
                'YOUR_APPS_SCRIPT_URL?' + params;

            const resultado = await consultarAPI(url);
            const respuesta = JSON.parse(resultado.texto);

            if (respuesta.resultado === 'ok') {
                // Actualizar contador persistente
                const attrsManager = handlerInput.attributesManager;
                let attrs = await attrsManager.getPersistentAttributes() || {};
                attrs.tareasCompletadasTotal = (attrs.tareasCompletadasTotal || 0) + 1;
                attrsManager.setPersistentAttributes(attrs);
                await attrsManager.savePersistentAttributes();

                let speakOutput = '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_01"/>' +
                    '¡Ohhh genial! Marqué como completada: ' +
                    respuesta.tarea + ' de las ' + respuesta.hora + '.';

                // Hitos de tareas completadas
                if (attrs.tareasCompletadasTotal % 50 === 0) {
                    speakOutput += ' ¡Llevas ' + attrs.tareasCompletadasTotal + ' tareas completadas en total! Eso merece mucho pollito.';
                }

                if (respuesta.siguiente) {
                    speakOutput += ' Lo que sigue es: ' +
                        respuesta.siguiente.tarea +
                        ' a las ' + respuesta.siguiente.hora + '.' +
                        ' No te olvides de mi pollito cuando termines.';
                } else {
                    speakOutput += ' <audio src="soundbank://soundlibrary/animals/amzn_sfx_dog_small_bark_2x_01"/>' +
                        '<audio src="soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_intro_01"/>' +
                        'No tienes más pendientes hoy. Eso merece muchos besitos. ¡Buen trabajo!';
                }

                return handlerInput.responseBuilder
                    .speak(speakOutput)
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            } else {
                return handlerInput.responseBuilder
                    .speak(
                        'Steph, no encontré una tarea pendiente de ' +
                        tareaSlot + ' para hoy. ¿Puede que ya la hayas completado?'
                    )
                    .reprompt('¿Qué más necesitas?')
                    .getResponse();
            }

        } catch (error) {
            console.log('ERROR COMPLETANDO:', error);

            return handlerInput.responseBuilder
                .speak(
                    'Steph, no pude marcar la tarea. ' +
                    'Inténtalo de nuevo.'
                )
                .getResponse();
        }
    }
};

// ==================================================
// 8. AYUDA
// ==================================================

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'AMAZON.HelpIntent';
    },

    handle(handlerInput) {
        const mensaje =
            'Puedes decir hola agente Vaca o revisar mis pendientes. ' +
            'También puedes pedirme que registre una tarea.';

        return handlerInput.responseBuilder
            .speak(mensaje)
            .reprompt('¿Qué deseas hacer?')
            .getResponse();
    }
};

// ==================================================
// 7. CANCELAR O DETENER
// ==================================================

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        const tipo = Alexa.getRequestType(
            handlerInput.requestEnvelope
        );

        const intencion = Alexa.getIntentName(
            handlerInput.requestEnvelope
        );

        return tipo === 'IntentRequest'
            && (
                intencion === 'AMAZON.CancelIntent'
                || intencion === 'AMAZON.StopIntent'
            );
    },

    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Hasta luego, Steph.')
            .getResponse();
    }
};

// ==================================================
// 8. FRASE NO RECONOCIDA
// ==================================================

const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest'
            && Alexa.getIntentName(
                handlerInput.requestEnvelope
            ) === 'AMAZON.FallbackIntent';
    },

    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak(
                'No entendí lo que dijiste. ' +
                'Puedes pedirme que revise tus pendientes.'
            )
            .reprompt('¿Qué deseas hacer?')
            .getResponse();
    }
};

// ==================================================
// 9. FIN DE SESIÓN
// ==================================================

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'SessionEndedRequest';
    },

    handle(handlerInput) {
        return handlerInput.responseBuilder.getResponse();
    }
};

// ==================================================
// 10. REFLEJAR OTRAS INTENCIONES
// ==================================================

const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(
            handlerInput.requestEnvelope
        ) === 'IntentRequest';
    },

    handle(handlerInput) {
        const intentName = Alexa.getIntentName(
            handlerInput.requestEnvelope
        );

        return handlerInput.responseBuilder
            .speak('Activaste ' + intentName)
            .getResponse();
    }
};

// ==================================================
// 11. MANEJADOR GENERAL DE ERRORES
// ==================================================

const ErrorHandler = {
    canHandle() {
        return true;
    },

    handle(handlerInput, error) {
        console.log('ERROR GENERAL:', error);

        return handlerInput.responseBuilder
            .speak('Ocurrió un error. Intenta nuevamente.')
            .reprompt('¿Qué deseas hacer?')
            .getResponse();
    }
};

// ==================================================
// 12. REGISTRAR LOS MANEJADORES DE ALEXA
// ==================================================

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        HelloWorldIntentHandler,
        RegistrarTareaIntentHandler,
        ConsultarPendientesIntentHandler,
        ProgramarDiaIntentHandler,
        CancelarTareaIntentHandler,
        GuardarNotaIntentHandler,
        LeerNotasIntentHandler,
        CambiarHoraTareaIntentHandler,
        CrearReunionIntentHandler,
        QuienEsCutoIntentHandler,
        QuienEresIntentHandler,
        LogrosDelDiaIntentHandler,
        ReagendarTareaIntentHandler,
        CompletarTareaIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler
    )
    .addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({
            bucketName: process.env.S3_PERSISTENCE_BUCKET
        })
    )
    .lambda();
