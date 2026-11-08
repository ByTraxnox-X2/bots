'use strict';

/**
 * Bancos de preguntas. Solo hechos comprobables. Formato: [pregunta, correcta, [incorrectas…]].
 * El banco de Free Fire es deliberadamente corto y conservador (no se inventan datos del juego);
 * un SUPERADMIN puede ampliarlo con ".quizff agregar".
 */
const TRIVIA = [
  ['¿Cuál es la capital de Ecuador?', 'Quito', ['Guayaquil', 'Cuenca', 'Loja']],
  ['¿Cuál es el planeta más grande del Sistema Solar?', 'Júpiter', ['Saturno', 'Marte', 'Neptuno']],
  ['¿Qué océano es el más grande?', 'Pacífico', ['Atlántico', 'Índico', 'Ártico']],
  ['¿Quién escribió "Don Quijote de la Mancha"?', 'Miguel de Cervantes', ['Lope de Vega', 'Gabriel García Márquez', 'Pablo Neruda']],
  ['¿Cuántos lados tiene un hexágono?', '6', ['5', '7', '8']],
  ['¿Cuál es la capital de Argentina?', 'Buenos Aires', ['Córdoba', 'Rosario', 'Montevideo']],
  ['¿Cuál es la capital de Perú?', 'Lima', ['Cusco', 'Arequipa', 'Quito']],
  ['¿Cuál es la capital de Colombia?', 'Bogotá', ['Medellín', 'Cali', 'Caracas']],
  ['¿Cuánto es 7 × 8?', '56', ['54', '58', '64']],
  ['¿Qué planeta se conoce como el planeta rojo?', 'Marte', ['Venus', 'Mercurio', 'Júpiter']],
  ['¿Cuál es el idioma oficial de Brasil?', 'Portugués', ['Español', 'Inglés', 'Francés']],
  ['¿Qué gas absorben las plantas para hacer la fotosíntesis?', 'Dióxido de carbono', ['Oxígeno', 'Nitrógeno', 'Helio']],
  ['¿Cuál es el símbolo químico del oro?', 'Au', ['Ag', 'Or', 'Go']],
  ['¿Cuántos jugadores tiene cada equipo de fútbol en el campo?', '11', ['9', '10', '12']],
  ['¿Cuál es el animal más grande del planeta?', 'Ballena azul', ['Elefante africano', 'Tiburón ballena', 'Jirafa']],
  ['¿Cuál es la raíz cuadrada de 144?', '12', ['11', '14', '16']],
  ['¿A qué país pertenecen las islas Galápagos?', 'Ecuador', ['Perú', 'Chile', 'Colombia']],
  ['¿Cuál es la moneda de Japón?', 'Yen', ['Won', 'Yuan', 'Rupia']],
  ['¿En qué continente está Egipto?', 'África', ['Asia', 'Europa', 'Oceanía']],
  ['¿Cuál es la capital de Chile?', 'Santiago', ['Valparaíso', 'Concepción', 'Lima']],
];

const QUIZ_FF = [
  ['¿Qué empresa publica Free Fire?', 'Garena', ['Tencent', 'Activision', 'Supercell']],
  ['¿De qué género es Free Fire?', 'Battle royale', ['MOBA', 'Carreras', 'Estrategia por turnos']],
  ['¿Cuántos jugadores tiene un escuadrón en el modo clásico?', '4', ['2', '6', '8']],
  ['¿Qué mensaje aparece al ganar una partida?', 'BOOYAH!', ['VICTORY!', 'GAME OVER', 'WINNER WINNER']],
  ['¿Cuál de estos es un mapa de Free Fire?', 'Bermuda', ['Erangel', 'Sanhok', 'Vikendi']],
  ['¿Cómo se llama la moneda premium de Free Fire?', 'Diamantes', ['Rubíes', 'Gemas', 'Esmeraldas']],
  ['¿Cómo se llama el área que se va reduciendo durante una partida?', 'La zona segura', ['La base', 'La arena', 'La isla']],
];

module.exports = { TRIVIA, QUIZ_FF };
