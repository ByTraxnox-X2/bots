'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

/** ¿La IP es privada, local o reservada? (protección contra SSRF) */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true;
}

class UnsafeUrlError extends Error {}

/** Solo http(s) y solo hosts públicos (salvo allowPrivate, pensado únicamente para pruebas locales). */
async function assertPublicUrl(rawUrl, { allowPrivate = false, lookup = dns.lookup } = {}) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('URL inválida');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new UnsafeUrlError('Solo se permiten URLs http(s)');
  if (u.username || u.password) throw new UnsafeUrlError('La URL no puede llevar credenciales');
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new UnsafeUrlError('Host no permitido');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError('El host apunta a una red privada');
  return u;
}

module.exports = { isPrivateIp, assertPublicUrl, UnsafeUrlError };
