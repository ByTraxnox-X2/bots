'use strict';

/** Contenido de entretenimiento original del bot (sin citas de personas reales). */
const PHRASES = [
  'La zona se achica, pero tu calma tiene que agrandarse.',
  'Un buen equipo no es el que nunca pierde: es el que siempre se reagrupa.',
  'Rotar a tiempo vale más que pelear en mal lugar.',
  'El mejor disparo es el que se piensa antes de salir de la cobertura.',
  'Escuchar a tu escuadra gana más partidas que cualquier arma.',
  'Cada derrota deja un mapa de lo que toca practicar.',
  'La paciencia también es una estrategia de combate.',
  'Antes de saquear, mira el radar; antes de pelear, mira la salida.',
  'Ganar juntos se siente mejor que ganar solo.',
  'Un buen capitán calla cuando hay que oír y habla cuando hay que decidir.',
  'No persigas la última baja: cuida la primera posición.',
  'Practicar un poco cada día pesa más que un maratón de una noche.',
  'La puntería se entrena; la actitud se elige.',
  'Un respawn de ánimo siempre está disponible: respira y vuelve.',
  'Si el plan falla, el equipo sigue; ajusta y continúa.',
  'Celebra las buenas jugadas de tus compañeros: suben el nivel de todos.',
  'La ventaja de altura vale poco si nadie cubre tu espalda.',
  'Perder una ronda no es perder la serie.',
  'El silencio antes de la emboscada es parte del plan.',
  'Juega para mejorar y los resultados llegan solos.',
];

const JOKES = [
  '¿Por qué el francotirador no hace amigos? Porque siempre los deja a distancia.',
  '¿Qué le dijo un cargador a otro? “Estoy vacío, ¿me prestas munición moral?”.',
  'Mi equipo y yo tenemos una táctica infalible: cada uno corre en una dirección distinta.',
  '¿Cómo se llama el jugador que siempre llega tarde a la zona? Un viajero del tiempo con lag.',
  'Dicen que la práctica hace al maestro; yo sigo esperando a que la práctica se acuerde de mí.',
  '¿Qué hace un jugador en el gimnasio? Entrena el dedo del gatillo, claro.',
  'Mi conexión es tan estable como una torre de cartas en pleno terremoto.',
  '¿Por qué los cuchillos no juegan a las escondidas? Porque siempre los encuentran por filo.',
  'Le dije a mi escuadra “confíen en mí” y ahora estamos todos mirando la pantalla de derrota.',
  'Hay dos tipos de jugadores: los que dicen que tienen lag y los que mienten.',
  '¿Qué le dice una granada a otra? “Nos vemos en un momento explosivo”.',
  'Mi mejor estrategia: llegar de último para que nadie sepa dónde estoy.',
  '¿Cómo se despide un jugador cortés? “¡Nos vemos en el próximo lobby!”.',
  'Mi puntería y mi suerte tienen algo en común: ambas se esconden cuando las necesito.',
  'El café y la zona segura comparten algo: ambos se acaban justo cuando más los necesitas.',
];

const EIGHT_BALL = [
  'Sí, sin duda.', 'Todo apunta a que sí.', 'Probablemente sí.', 'Las señales dicen que sí.', 'Es muy posible.',
  'Pregunta de nuevo más tarde.', 'Mejor no responder ahora.', 'No puedo decidirlo todavía.', 'Concéntrate y vuelve a preguntar.', 'Está nublado, intenta otra vez.',
  'No cuentes con ello.', 'Mi respuesta es no.', 'Todo indica que no.', 'Lo dudo bastante.', 'Muy poco probable.',
];

module.exports = { PHRASES, JOKES, EIGHT_BALL };
