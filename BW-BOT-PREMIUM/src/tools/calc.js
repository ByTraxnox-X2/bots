'use strict';

/**
 * Calculadora segura: analizador recursivo propio. NUNCA usa eval ni Function.
 * Soporta + - * / % ^ ( ), números decimales, constantes (pi, e) y funciones (sqrt abs round floor ceil sin cos tan ln log exp).
 */
const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp };
const CONSTS = { pi: Math.PI, e: Math.E };
const MAX_LEN = 200;

class CalcError extends Error {}

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:[.,]\d+)?|[.,]\d+)|([a-z]+)|(.))/giy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1].replace(',', '.')) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2].toLowerCase() });
    else if (m[3] !== undefined && /[+\-*/%^()×÷x]/i.test(m[3])) out.push({ t: 'op', v: m[3] === '×' || m[3].toLowerCase() === 'x' ? '*' : m[3] === '÷' ? '/' : m[3] });
    else if (m[3] !== undefined && m[3].trim()) throw new CalcError(`Carácter no permitido: “${m[3]}”`);
  }
  return out;
}

function evaluate(expr) {
  const src = String(expr || '').trim();
  if (!src) throw new CalcError('Escribe una operación.');
  if (src.length > MAX_LEN) throw new CalcError(`Máximo ${MAX_LEN} caracteres.`);
  // "x" entre números significa multiplicar, pero "x" suelta como identificador no existe: se tokeniza como identificador y se resuelve aquí.
  const toks = tokenize(src.replace(/(\d)\s*x\s*(\d)/gi, '$1*$2'));
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function primary() {
    const t = take();
    if (!t) throw new CalcError('La operación está incompleta.');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = expression();
      if (!isOp(')')) throw new CalcError('Falta cerrar un paréntesis.');
      take();
      return v;
    }
    if (t.t === 'id') {
      if (t.v in CONSTS) return CONSTS[t.v];
      if (t.v in FUNCS) {
        if (!isOp('(')) throw new CalcError(`${t.v} necesita paréntesis: ${t.v}(…)`);
        take();
        const v = expression();
        if (!isOp(')')) throw new CalcError('Falta cerrar un paréntesis.');
        take();
        return FUNCS[t.v](v);
      }
      throw new CalcError(`No conozco “${t.v}”.`);
    }
    throw new CalcError(`Símbolo inesperado “${t.v}”.`);
  }
  function unary() {
    if (isOp('-')) { take(); return -unary(); }
    if (isOp('+')) { take(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) { take(); return base ** unary(); }
    return base;
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*')) { take(); v *= unary(); }
      else if (isOp('/')) { take(); const d = unary(); if (d === 0) throw new CalcError('No se puede dividir entre cero.'); v /= d; }
      else if (isOp('%')) { take(); const d = unary(); if (d === 0) throw new CalcError('No se puede dividir entre cero.'); v %= d; }
      else return v;
    }
  }
  function expression() {
    let v = term();
    for (;;) {
      if (isOp('+')) { take(); v += term(); }
      else if (isOp('-')) { take(); v -= term(); }
      else return v;
    }
  }
  const result = expression();
  if (i < toks.length) throw new CalcError(`Sobra “${toks[i].v}” en la operación.`);
  if (!Number.isFinite(result)) throw new CalcError('El resultado no es un número finito.');
  return result;
}

function formatResult(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = Number(n.toPrecision(12));
  return Math.abs(s) >= 1e15 || (Math.abs(s) < 1e-6 && s !== 0) ? s.toExponential(6) : String(s);
}

module.exports = { evaluate, formatResult, CalcError };
