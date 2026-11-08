'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { verify } = require('../scripts/verify-commands');
const { generateCommandsDoc } = require('../src/commands/docs');
const { CommandRegistry } = require('../src/commands/registry');
const { registerPlugins, PLUGINS } = require('../src/plugins');

test('verify-commands: todos los comandos reales están completos, probados y documentados', () => {
  const { problems, registry } = verify();
  assert.deepEqual(problems, []);
  assert.ok(registry.size >= 9);
});

test('plugins: cada comando cumple el contrato y no hay nombres ni alias duplicados', () => {
  const registry = registerPlugins(new CommandRegistry());
  const keys = [];
  for (const d of registry.list()) {
    keys.push(d.name, ...d.aliases);
    assert.equal(typeof d.handler, 'function');
    assert.ok(d.description.length >= 10, d.name);
  }
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(PLUGINS.length, 15);
});

test('plugins: un conflicto de alias entre plugins falla al registrar con un mensaje claro', () => {
  const registry = registerPlugins(new CommandRegistry());
  assert.throws(
    () => registry.register({ name: 'otro', aliases: ['ayuda'], description: 'Prueba de conflicto', usage: 'otro', example: 'otro', category: 'general', permissions: 'USER', cooldown: 0, handler: () => {} }),
    /Conflicto: "ayuda"/
  );
});

test('COMMANDS.md: coincide con el registro y es determinista', () => {
  const registry = registerPlugins(new CommandRegistry());
  const a = generateCommandsDoc(registry, '.');
  assert.equal(a, generateCommandsDoc(registry, '.'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'COMMANDS.md'), 'utf8'), a + '\n');
  for (const d of registry.list()) assert.ok(a.includes(`\`.${d.name}\``));
});
