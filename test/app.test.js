'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jea-'));
process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = tmp;
process.env.ADMIN_PASSWORD = 'segredo';

const { app, cpfValido } = require('../server');

const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';

let base;
let server;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

function cliente() {
  let cookie = '';
  return async (url, { json, form, method } = {}) => {
    const init = { method: method || (json || form ? 'POST' : 'GET'), headers: { cookie } };
    if (json) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    }
    if (form) init.body = form;
    const r = await fetch(base + url, init);
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
}

test('valida CPF', () => {
  assert.ok(cpfValido('52998224725'));
  assert.ok(!cpfValido('52998224724'));
  assert.ok(!cpfValido('11111111111'));
});

test('fluxo do especialista, instrutor e feedback em massa', async () => {
  const a = cliente();
  assert.equal((await a('/api/entrar', { json: { cpf: '123' } })).status, 400);

  let r = await a('/api/entrar', { json: { cpf: CPF_A } });
  assert.equal(r.body.primeiroAcesso, true);

  assert.equal((await a('/api/turmas')).status, 403);

  const cad = new FormData();
  cad.set('nome', 'Maria da Silva');
  cad.set('tipo', 'especialista');
  cad.set('foto', new Blob([Buffer.from('fakepng')], { type: 'image/png' }), 'eu.png');
  r = await a('/api/cadastro', { form: cad });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.tipo, 'especialista');

  r = await a('/api/entrar', { json: { cpf: CPF_A } });
  assert.equal(r.body.primeiroAcesso, false);

  r = await a('/api/turmas', { json: { numero: '12', cidade: 'Goiânia', sindicato: 'SR Goiânia', periodo: 'sáb 8h-12h' } });
  const turmaId = r.body.turma.id;

  const m1 = new FormData();
  m1.set('titulo', 'teste');
  m1.set('missao', 'teste');
  m1.set('expedicao_local', 'Fazenda X');
  m1.set('anexo', new Blob([Buffer.from('img')], { type: 'image/jpeg' }), 'exp.jpg');
  r = await a(`/api/turmas/${turmaId}/modulos/1`, { form: m1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.modulo.dados.titulo, 'teste');
  assert.equal(r.body.modulo.dados.expedicao_local, 'Fazenda X');
  const anexo = r.body.modulo.anexo;
  assert.ok(anexo);

  const m2 = new FormData();
  m2.set('texto', 'relato do módulo 2');
  m2.set('anexo', new Blob([Buffer.from('%PDF')], { type: 'application/pdf' }), 'doc.pdf');
  assert.equal((await a(`/api/turmas/${turmaId}/modulos/2`, { form: m2 })).status, 200);
  assert.equal((await a(`/api/turmas/${turmaId}/modulos/9`, { form: new FormData() })).status, 404);

  // Instrutor: só imagem
  const b = cliente();
  await b('/api/entrar', { json: { cpf: CPF_B } });
  const cadB = new FormData();
  cadB.set('nome', 'João Souza');
  cadB.set('tipo', 'instrutor');
  await b('/api/cadastro', { form: cadB });
  r = await b('/api/turmas', { json: { numero: '7', cidade: 'Rio Verde', sindicato: 'SR Rio Verde', periodo: 'noite' } });
  const turmaB = r.body.turma.id;
  const pdf = new FormData();
  pdf.set('texto', 'x');
  pdf.set('anexo', new Blob([Buffer.from('%PDF')], { type: 'application/pdf' }), 'doc.pdf');
  assert.equal((await b(`/api/turmas/${turmaB}/modulos/3`, { form: pdf })).status, 400);
  const img = new FormData();
  img.set('texto', 'aula 3');
  img.set('anexo', new Blob([Buffer.from('img')], { type: 'image/png' }), 'a.png');
  assert.equal((await b(`/api/turmas/${turmaB}/modulos/3`, { form: img })).status, 200);

  // Isolamento entre usuários
  assert.equal((await b(`/api/turmas/${turmaId}`)).status, 404);
  assert.equal((await b(`/arquivos/${anexo}`)).status, 403);
  assert.equal((await a(`/arquivos/${anexo}`)).status, 200);

  // Admin
  const adm = cliente();
  assert.equal((await adm('/api/admin/envios')).status, 401);
  assert.equal((await adm('/api/admin/entrar', { json: { senha: 'errada' } })).status, 401);
  assert.equal((await adm('/api/admin/entrar', { json: { senha: 'segredo' } })).status, 200);
  r = await adm('/api/admin/envios');
  assert.equal(r.body.envios.length, 3);
  assert.equal(r.body.usuarios.length, 2);
  assert.equal((await adm(`/arquivos/${anexo}`)).status, 200);

  const ids = r.body.envios.map((e) => e.id);
  r = await adm('/api/admin/feedback', { json: { ids, feedback: 'Muito bom!' } });
  assert.equal(r.body.atualizados, 3);

  r = await a(`/api/turmas/${turmaId}`);
  assert.ok(r.body.modulos.every((m) => m.feedback === 'Muito bom!'));
});
