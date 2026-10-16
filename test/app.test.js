'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jea-'));
process.env.PGLITE_DIR = 'memory://';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.BLOB_READ_WRITE_TOKEN;
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

async function subir(c, conteudo, tipo, nome) {
  const fd = new FormData();
  fd.set('arquivo', new Blob([Buffer.from(conteudo)], { type: tipo }), nome);
  const r = await c('/api/upload', { form: fd });
  assert.equal(r.status, 200);
  return r.body;
}

test('fluxo do especialista, instrutor e feedback em massa', async () => {
  const a = cliente();
  assert.equal((await a('/api/entrar', { json: { cpf: '123' } })).status, 400);

  let r = await a('/api/entrar', { json: { cpf: CPF_A } });
  assert.equal(r.body.primeiroAcesso, true);

  assert.equal((await a('/api/turmas')).status, 403);

  const foto = await subir(a, 'fakepng', 'image/png', 'eu.png');
  r = await a('/api/cadastro', { json: { nome: 'Maria da Silva', tipo: 'especialista', foto } });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.tipo, 'especialista');
  assert.equal((await a(foto.url)).status, 200);

  r = await a('/api/entrar', { json: { cpf: CPF_A } });
  assert.equal(r.body.primeiroAcesso, false);

  r = await a('/api/turmas', { json: { cidade: 'Goiânia', sindicato: 'SR Goiânia', horario: 'sáb 8h-12h' } });
  const turmaId = r.body.turma.id;

  // Módulo 1 do especialista: só aceita imagem
  const pdfA = await subir(a, '%PDF', 'application/pdf', 'doc.pdf');
  r = await a(`/api/turmas/${turmaId}/modulos/1`, { json: { titulo: 'x', anexo: pdfA } });
  assert.equal(r.status, 400);

  const exp = await subir(a, 'img', 'image/jpeg', 'exp.jpg');
  r = await a(`/api/turmas/${turmaId}/modulos/1`, {
    json: { titulo: 'teste', missao: 'teste', expedicao_local: 'Fazenda X', anexo: exp },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.modulo.dados.titulo, 'teste');
  assert.equal(r.body.modulo.dados.expedicao_local, 'Fazenda X');
  const anexo = r.body.modulo.anexo;
  assert.equal(anexo, exp.url);

  // Salvar de novo sem arquivo mantém o anexo
  r = await a(`/api/turmas/${turmaId}/modulos/1`, { json: { titulo: 'teste 2' } });
  assert.equal(r.body.modulo.anexo, anexo);

  assert.equal((await a(`/api/turmas/${turmaId}/modulos/2`, { json: { texto: 'relato', anexo: pdfA } })).status, 200);
  assert.equal((await a(`/api/turmas/${turmaId}/modulos/9`, { json: {} })).status, 404);
  assert.equal((await a(`/api/turmas/${turmaId}/modulos/3`, { json: { anexo: { url: 'https://evil.example/x.png' } } })).status, 400);

  // Instrutor: só imagem
  const b = cliente();
  await b('/api/entrar', { json: { cpf: CPF_B } });
  await b('/api/cadastro', { json: { nome: 'João Souza', tipo: 'instrutor' } });
  r = await b('/api/turmas', { json: { cidade: 'Rio Verde', sindicato: 'SR Rio Verde', horario: 'noite' } });
  const turmaB = r.body.turma.id;
  const pdfB = await subir(b, '%PDF', 'application/pdf', 'doc.pdf');
  assert.equal((await b(`/api/turmas/${turmaB}/modulos/3`, { json: { texto: 'x', anexo: pdfB } })).status, 400);
  const img = await subir(b, 'img', 'image/png', 'a.png');
  assert.equal((await b(`/api/turmas/${turmaB}/modulos/3`, { json: { texto: 'aula 3', anexo: img } })).status, 200);

  // Isolamento entre usuários
  assert.equal((await b(`/api/turmas/${turmaId}`)).status, 404);
  assert.equal((await b(anexo)).status, 403);
  assert.equal((await a(anexo)).status, 200);

  // Admin
  const adm = cliente();
  assert.equal((await adm('/api/admin/envios')).status, 401);
  assert.equal((await adm('/api/admin/entrar', { json: { senha: 'errada' } })).status, 401);
  assert.equal((await adm('/api/admin/entrar', { json: { senha: 'segredo' } })).status, 200);
  r = await adm('/api/admin/envios');
  assert.equal(r.body.envios.length, 3);
  assert.equal(r.body.usuarios.length, 2);
  assert.equal((await adm(anexo)).status, 200);

  const ids = r.body.envios.map((e) => e.id);
  r = await adm('/api/admin/feedback', { json: { ids, feedback: 'Muito bom!' } });
  assert.equal(r.body.atualizados, 3);

  r = await a(`/api/turmas/${turmaId}`);
  assert.ok(r.body.modulos.every((m) => m.feedback === 'Muito bom!'));

  // Excluir turma: só o dono, e some da lista
  assert.equal((await b(`/api/turmas/${turmaId}`, { method: 'DELETE' })).status, 404);
  assert.equal((await a(`/api/turmas/${turmaId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a('/api/turmas')).body.turmas.length, 0);
  assert.equal((await a(anexo)).status, 404);
});

test('fórum: todos leem e publicam nos três fóruns', async () => {
  const esp = cliente();
  await esp('/api/entrar', { json: { cpf: '390.533.447-05' } });
  await esp('/api/cadastro', { json: { nome: 'Ana Especialista', tipo: 'especialista' } });
  const ins = cliente();
  await ins('/api/entrar', { json: { cpf: '168.995.350-09' } });
  await ins('/api/cadastro', { json: { nome: 'Beto Instrutor', tipo: 'instrutor' } });

  assert.equal((await cliente()('/api/forum/geral')).status, 401);

  let r = await esp('/api/forum/especialista', { json: { titulo: 'Dúvida', texto: 'Como faço o orçamento?' } });
  assert.equal(r.status, 200);
  const topicoEsp = r.body.topico.id;
  assert.equal((await esp('/api/forum/instrutor', { json: { titulo: 'Para instrutores', texto: 'y' } })).status, 200);
  assert.equal((await ins('/api/forum/geral', { json: { titulo: 'Oi', texto: 'Olá a todos' } })).status, 200);
  assert.equal((await ins('/api/forum/qualquer')).status, 404);

  // Instrutor lê e publica no fórum dos especialistas
  r = await ins('/api/forum/especialista');
  assert.equal(r.body.topicos.length, 1);
  assert.equal(r.body.podePublicar, true);
  r = await ins(`/api/forum/topico/${topicoEsp}`);
  assert.equal(r.body.topico.texto, 'Como faço o orçamento?');
  assert.equal((await ins(`/api/forum/topico/${topicoEsp}/respostas`, { json: { texto: 'Eu uso uma planilha.' } })).status, 200);

  r = await esp(`/api/forum/topico/${topicoEsp}/respostas`, { json: { texto: 'Por módulo.' } });
  assert.equal(r.status, 200);
  const resp = r.body.resposta.id;
  r = await esp('/api/forum/especialista');
  assert.equal(r.body.topicos[0].respostas, 2);

  // Só o autor ou o admin apagam
  assert.equal((await ins(`/api/forum/resposta/${resp}`, { method: 'DELETE' })).status, 403);
  const adm = cliente();
  await adm('/api/admin/entrar', { json: { senha: 'segredo' } });
  assert.equal((await adm('/api/forum/instrutor')).status, 200);
  assert.equal((await adm(`/api/forum/resposta/${resp}`, { method: 'DELETE' })).status, 200);
  assert.equal((await ins(`/api/forum/topico/${topicoEsp}`, { method: 'DELETE' })).status, 403);
  assert.equal((await esp(`/api/forum/topico/${topicoEsp}`, { method: 'DELETE' })).status, 200);
  assert.equal((await esp('/api/forum/especialista')).body.topicos.length, 0);
});
