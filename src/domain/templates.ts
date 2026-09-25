/** Plantillas locales (sin IA) para desglosar tareas comunes. */
const TEMPLATES: { match: RegExp; steps: string[] }[] = [
  {
    match: /reembolso|devoluci|garant/i,
    steps: [
      "Reunir documentación (recibos, fotos, correos)",
      "Redactar la solicitud de reembolso",
      "Enviarla y guardar justificante",
      "Programar recordatorio de seguimiento en 7 días",
    ],
  },
  {
    match: /viaje|vuelo|hotel|vacacion/i,
    steps: [
      "Definir fechas y presupuesto",
      "Comparar y reservar transporte",
      "Reservar alojamiento",
      "Preparar documentación (pasaporte, visados, seguros)",
    ],
  },
  {
    match: /tr[áa]mite|cita previa|renovar|pasaporte|dni|licencia/i,
    steps: [
      "Averiguar requisitos y documentación necesaria",
      "Conseguir cita previa",
      "Preparar papeles y copias",
      "Asistir y registrar el resultado",
    ],
  },
  {
    match: /informe|report|presentaci|propuesta/i,
    steps: [
      "Esquema y estructura del documento",
      "Recopilar datos y fuentes",
      "Redactar el primer borrador",
      "Revisar, pulir y entregar",
    ],
  },
  {
    match: /mudanza|mover|casa nueva/i,
    steps: [
      "Inventario y descarte de lo que no se lleva",
      "Pedir presupuestos de mudanza",
      "Empaquetar por habitaciones",
      "Cambiar dirección (bancos, suscripciones, empadronamiento)",
    ],
  },
  {
    match: /m[ée]dico|dentista|salud|revisi/i,
    steps: [
      "Pedir cita",
      "Preparar síntomas y preguntas",
      "Asistir y anotar indicaciones",
    ],
  },
];

export function localBreakdown(title: string): string[] {
  for (const t of TEMPLATES) {
    if (t.match.test(title)) return t.steps;
  }
  return [];
}
