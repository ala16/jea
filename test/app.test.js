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

  // Imagem no fórum: qualquer pessoa logada vê
  const img = await subir(ins, 'img', 'image/png', 'quadro.png');
  const pdf = await subir(ins, '%PDF', 'application/pdf', 'doc.pdf');
  assert.equal((await ins(`/api/forum/topico/${topicoEsp}/respostas`, { json: { texto: '', imagem: pdf } })).status, 400);
  r = await ins(`/api/forum/topico/${topicoEsp}/respostas`, { json: { texto: '', imagem: img } });
  assert.equal(r.status, 200);
  const respImg = r.body.resposta.id;
  assert.equal((await esp(img.url)).status, 200);
  assert.equal((await cliente()(img.url)).status, 403);
  assert.equal((await ins(`/api/forum/topico/${topicoEsp}/respostas`, { json: { texto: '  ' } })).status, 400);
  assert.equal((await ins(`/api/forum/resposta/${respImg}`, { method: 'DELETE' })).status, 200);
  assert.equal((await esp(img.url)).status, 404);

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

test('avisos: admin publica, cada perfil vê os seus', async () => {
  const esp = cliente();
  await esp('/api/entrar', { json: { cpf: '714.602.380-01' } });
  await esp('/api/cadastro', { json: { nome: 'Carla Especialista', tipo: 'especialista' } });
  const ins = cliente();
  await ins('/api/entrar', { json: { cpf: '935.411.347-80' } });
  await ins('/api/cadastro', { json: { nome: 'Davi Instrutor', tipo: 'instrutor' } });
  const adm = cliente();
  await adm('/api/admin/entrar', { json: { senha: 'segredo' } });

  assert.equal((await esp('/api/admin/avisos', { json: { titulo: 'x', texto: 'y' } })).status, 401);
  assert.equal((await adm('/api/admin/avisos', { json: { titulo: '', texto: 'y' } })).status, 400);
  let r = await adm('/api/admin/avisos', { json: { titulo: 'Reunião', texto: 'Sexta às 9h', publico: 'todos' } });
  assert.equal(r.status, 200);
  r = await adm('/api/admin/avisos', { json: { titulo: 'Só instrutores', texto: 'Entreguem o módulo 3', publico: 'instrutor' } });
  const soInstrutor = r.body.aviso.id;

  assert.deepEqual((await esp('/api/avisos')).body.avisos.map((a) => a.titulo), ['Reunião']);
  assert.deepEqual((await ins('/api/avisos')).body.avisos.map((a) => a.titulo), ['Só instrutores', 'Reunião']);
  assert.equal((await adm('/api/avisos')).body.avisos.length, 2);
  assert.equal((await cliente()('/api/avisos')).status, 401);

  assert.equal((await adm(`/api/admin/avisos/${soInstrutor}`, { method: 'DELETE' })).status, 200);
  assert.equal((await adm(`/api/admin/avisos/${soInstrutor}`, { method: 'DELETE' })).status, 404);
  assert.equal((await ins('/api/avisos')).body.avisos.length, 1);
});

test('perfil: editar nome, foto e redes; outros veem', async () => {
  const a = cliente();
  await a('/api/entrar', { json: { cpf: '286.255.878-87' } });
  await a('/api/cadastro', { json: { nome: 'Eva Perfil', tipo: 'instrutor' } });
  const foto = await subir(a, 'img', 'image/png', 'eu.png');
  let r = await a('/api/perfil', {
    json: { nome: 'Eva Perfil Souza', foto, redes: { instagram: 'instagram.com/eva', site: '', linkedin: 'javascript:alert(1)' } },
  });
  assert.equal(r.status, 400);
  r = await a('/api/perfil', { json: { nome: 'Eva Perfil Souza', foto, redes: { instagram: 'instagram.com/eva', facebook: 'https://facebook.com/eva' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.nome, 'Eva Perfil Souza');
  assert.deepEqual(r.body.usuario.redes, { instagram: 'https://instagram.com/eva', facebook: 'https://facebook.com/eva' });
  const id = r.body.usuario.id;

  const b = cliente();
  await b('/api/entrar', { json: { cpf: '529.982.247-25' } });
  r = await b(`/api/perfil/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.perfil.redes.instagram, 'https://instagram.com/eva');
  assert.equal(r.body.perfil.cpf, undefined);
  assert.equal((await b(foto.url)).status, 200);
  assert.equal((await cliente()(`/api/perfil/${id}`)).status, 401);

  // Trocar a foto apaga a antiga; remover deixa sem foto
  const nova = await subir(a, 'img2', 'image/png', 'nova.png');
  r = await a('/api/perfil', { json: { nome: 'Eva Perfil Souza', foto: nova } });
  assert.equal(r.body.usuario.foto, nova.url);
  assert.equal((await a(foto.url)).status, 404);
  r = await a('/api/perfil', { json: { nome: 'Eva Perfil Souza', removerFoto: true } });
  assert.equal(r.body.usuario.foto, null);
  assert.equal(r.body.usuario.tipo, 'instrutor');

  // WhatsApp: só números, com 55; número curto é recusado
  assert.equal((await a('/api/perfil', { json: { nome: 'Eva Perfil Souza', redes: { whatsapp: '9999' } } })).status, 400);
  r = await a('/api/perfil', { json: { nome: 'Eva Perfil Souza', redes: { whatsapp: '(16) 99999-8888', youtube: 'youtube.com/x' } } });
  assert.deepEqual(r.body.usuario.redes, { whatsapp: '5516999998888' });
});

test('material e perguntas ao admin', async () => {
  const esp = cliente();
  await esp('/api/entrar', { json: { cpf: '390.533.447-05' } });
  const ins = cliente();
  await ins('/api/entrar', { json: { cpf: '168.995.350-09' } });
  const adm = cliente();
  await adm('/api/admin/entrar', { json: { senha: 'segredo' } });

  // Material: só o admin publica; todos veem as três categorias
  assert.equal((await esp('/api/admin/materiais', { json: { titulo: 'x', url: 'drive.google.com/x' } })).status, 401);
  assert.equal((await adm('/api/admin/materiais', { json: { titulo: 'x', url: 'javascript:alert(1)' } })).status, 400);
  let r = await adm('/api/admin/materiais', {
    json: { titulo: 'Cartilha do especialista', categoria: 'especialista', url: 'drive.google.com/file/d/abc' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.material.url, 'https://drive.google.com/file/d/abc');
  await adm('/api/admin/materiais', { json: { titulo: 'Guia do instrutor', categoria: 'instrutor', url: 'https://drive.google.com/y' } });
  r = await ins('/api/materiais');
  assert.deepEqual(r.body.materiais.map((m) => m.categoria).sort(), ['especialista', 'instrutor']);
  assert.equal((await esp('/api/materiais')).body.materiais.length, 2);
  assert.equal((await cliente()('/api/materiais')).status, 401);
  assert.equal((await adm(`/api/admin/materiais/${r.body.materiais[0].id}`, { method: 'DELETE' })).status, 200);

  // Perguntas: cada um vê só as suas; o admin responde
  assert.equal((await esp('/api/perguntas', { json: { texto: '  ' } })).status, 400);
  r = await esp('/api/perguntas', { json: { texto: 'Qual o prazo do módulo 2?' } });
  const pid = r.body.pergunta.id;
  await ins('/api/perguntas', { json: { texto: 'Posso mudar o horário?' } });
  assert.equal((await esp('/api/perguntas')).body.perguntas.length, 1);
  assert.equal((await adm('/api/perguntas')).body.perguntas.length, 2);
  assert.equal((await ins(`/api/admin/perguntas/${pid}/resposta`, { json: { resposta: 'x' } })).status, 401);
  assert.equal((await adm(`/api/admin/perguntas/${pid}/resposta`, { json: { resposta: 'Até sexta.' } })).status, 200);
  r = await esp('/api/perguntas');
  assert.equal(r.body.perguntas[0].resposta, 'Até sexta.');
  assert.equal((await adm(`/api/admin/perguntas/${pid}`, { method: 'DELETE' })).status, 200);
  assert.equal((await esp('/api/perguntas')).body.perguntas.length, 0);
});

test('admin: ficha da pessoa com turmas e envios', async () => {
  const a = cliente();
  await a('/api/entrar', { json: { cpf: '458.537.100-10' } });
  await a('/api/cadastro', { json: { nome: 'Fabio Ficha', tipo: 'instrutor' } });
  const { turma } = (await a('/api/turmas', { json: { cidade: 'Franca', sindicato: 'SR Franca', horario: '08:00 às 12:00' } })).body;
  await a(`/api/turmas/${turma.id}/modulos/2`, { json: { texto: 'aula 2' } });
  const id = (await a('/api/eu')).body.usuario.id;

  assert.equal((await a(`/api/admin/usuarios/${id}`)).status, 401);
  const adm = cliente();
  await adm('/api/admin/entrar', { json: { senha: 'segredo' } });
  let r = await adm(`/api/admin/usuarios/${id}`);
  assert.equal(r.body.usuario.nome, 'Fabio Ficha');
  assert.equal(r.body.turmas.length, 1);
  assert.equal(r.body.envios.length, 1);
  assert.equal(r.body.envios[0].texto, 'aula 2');
  assert.equal((await adm('/api/admin/usuarios/999999')).status, 404);
  await adm('/api/admin/feedback', { json: { ids: [r.body.envios[0].id], feedback: 'Ótimo' } });
  r = await a(`/api/turmas/${turma.id}`);
  assert.equal(r.body.modulos[0].feedback, 'Ótimo');
});

test('participantes e mensagens diretas', async () => {
  const a = cliente();
  await a('/api/entrar', { json: { cpf: '529.982.247-25' } }); // especialista Maria (fluxo anterior)
  const b = cliente();
  await b('/api/entrar', { json: { cpf: '111.444.777-35' } }); // instrutor João
  const idA = (await a('/api/eu')).body.usuario.id;
  const idB = (await b('/api/eu')).body.usuario.id;

  let r = await b('/api/participantes');
  assert.ok(r.body.participantes.some((p) => p.id === idA && p.tipo === 'especialista'));
  assert.ok(r.body.participantes.every((p) => p.cpf === undefined));

  // Perfil de outro: turmas e fórum, sem conteúdo dos módulos
  r = await b(`/api/perfil/${idA}`);
  assert.ok(Array.isArray(r.body.turmas) && Array.isArray(r.body.postagens));
  assert.ok(r.body.turmas.every((t) => t.dados === undefined && t.texto === undefined));

  assert.equal((await a(`/api/mensagens/${idA}`, { json: { texto: 'eu' } })).status, 404);
  assert.equal((await a(`/api/mensagens/${idB}`, { json: { texto: ' ' } })).status, 400);
  assert.equal((await a(`/api/mensagens/${idB}`, { json: { texto: 'Oi João!' } })).status, 200);
  assert.equal((await a(`/api/mensagens/${idB}`, { json: { texto: 'Tudo bem?' } })).status, 200);
  assert.equal((await b('/api/mensagens/nao-lidas')).body.total, 2);
  r = await b('/api/mensagens');
  assert.equal(r.body.conversas[0].id, idA);
  assert.equal(r.body.conversas[0].nao_lidas, 2);
  assert.equal(r.body.conversas[0].texto, 'Tudo bem?');
  r = await b(`/api/mensagens/${idA}`);
  assert.deepEqual(r.body.mensagens.map((m) => m.texto), ['Oi João!', 'Tudo bem?']);
  assert.equal((await b('/api/mensagens/nao-lidas')).body.total, 0);
  await b(`/api/mensagens/${idA}`, { json: { texto: 'Tudo ótimo.' } });
  assert.equal((await a('/api/mensagens')).body.conversas[0].nao_lidas, 1);
  assert.equal((await cliente()('/api/mensagens')).status, 401);
});
