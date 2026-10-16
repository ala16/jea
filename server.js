'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const arquivos = require('./arquivos');
const { MODULO1_ESPECIALISTA_CAMPOS } = require('./public/campos');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRODUCAO = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
// Sem SESSION_SECRET, deriva a chave de outro segredo estável do ambiente (banco ou Blob),
// para o site funcionar na Vercel sem configuração extra.
const SEGREDO_BASE =
  process.env.SESSION_SECRET || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.BLOB_READ_WRITE_TOKEN;
const SESSION_SECRET = SEGREDO_BASE
  ? crypto.createHash('sha256').update(`jea-sessao:${SEGREDO_BASE}`).digest('hex')
  : PRODUCAO
    ? null
    : crypto.randomBytes(32).toString('hex');
const MAX_TEXTO = 2000;

if (!ADMIN_PASSWORD) console.warn('[aviso] ADMIN_PASSWORD não definida: o acesso admin fica desativado.');
if (!SESSION_SECRET) console.error('[erro] Banco de dados não configurado: conecte um Postgres (DATABASE_URL).');

// ---------- utilidades ----------

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (len) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(cpf[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

function limparCpf(v) {
  return String(v || '').replace(/\D/g, '');
}

function texto(v, max = MAX_TEXTO) {
  return String(v ?? '').slice(0, max);
}

// Sessão simples em cookie assinado com HMAC (funciona em serverless, sem estado no servidor).
function assinar(valor) {
  if (!SESSION_SECRET) {
    throw Object.assign(new Error('O banco de dados ainda não foi configurado na Vercel.'), { status: 503 });
  }
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(valor).digest('base64url');
  return `${valor}.${mac}`;
}

function verificar(cookie) {
  if (!cookie) return null;
  const i = cookie.lastIndexOf('.');
  if (i < 0) return null;
  const valor = cookie.slice(0, i);
  const a = Buffer.from(assinar(valor));
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return valor;
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function definirCookie(res, nome, valor, maxAgeSeg) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeg !== undefined) partes.push(`Max-Age=${maxAgeSeg}`);
  if (PRODUCAO) partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

function sessao(req) {
  const valor = verificar(lerCookies(req).sessao);
  if (!valor) return {};
  const [tipo, id] = valor.split(':');
  return tipo === 'cpf' ? { cpf: id } : tipo === 'admin' ? { admin: true } : {};
}

// Express 5 já repassa erros de funções async para o tratador de erros.
async function exigirCpf(req, res, next) {
  const s = sessao(req);
  if (!s.cpf) return res.status(401).json({ erro: 'Faça login com seu CPF.' });
  req.cpf = s.cpf;
  req.usuario = (await db.usuarioPorCpf(s.cpf)) || null;
  next();
}

async function exigirUsuario(req, res, next) {
  await exigirCpf(req, res, () => {
    if (!req.usuario) return res.status(403).json({ erro: 'Complete seu cadastro primeiro.' });
    next();
  });
}

function exigirAdmin(req, res, next) {
  if (!sessao(req).admin) return res.status(401).json({ erro: 'Acesso restrito ao admin.' });
  next();
}

// Lê { url, nome } enviado pelo navegador depois do upload e confere se é um arquivo nosso.
function lerArquivo(v, { imagem } = {}) {
  if (!v || typeof v !== 'object') return null;
  const url = String(v.url || '');
  if (!arquivos.urlValida(url)) throw Object.assign(new Error('Arquivo inválido.'), { status: 400 });
  if (imagem && !arquivos.ehImagem(url)) throw Object.assign(new Error('O arquivo precisa ser uma imagem.'), { status: 400 });
  return { url, nome: texto(v.nome || path.basename(url), 200) };
}

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ uploadDireto: arquivos.usaBlob });
});

// Upload: na Vercel o navegador envia direto para o Vercel Blob (limite de 4,5MB das funções);
// localmente o arquivo vem para o servidor e fica em disco.
app.post('/api/blob', exigirCpf, async (req, res) => {
  res.json(await arquivos.gerarTokenBlob(req));
});

app.post('/api/upload', exigirCpf, arquivos.uploadLocal);

app.get('/arquivos/:nome', async (req, res) => {
  const nome = path.basename(req.params.nome);
  const s = sessao(req);
  const dono = await db.donoDoArquivo(`/arquivos/${nome}`);
  if (!dono) return res.sendStatus(404);
  if (!s.admin && s.cpf !== dono) return res.sendStatus(403);
  res.sendFile(arquivos.caminhoLocal(nome));
});

// Login por CPF
app.post('/api/entrar', async (req, res) => {
  const cpf = limparCpf(req.body.cpf);
  if (!cpfValido(cpf)) return res.status(400).json({ erro: 'CPF inválido.' });
  definirCookie(res, 'sessao', assinar(`cpf:${cpf}`), 60 * 60 * 24 * 30);
  res.json({ primeiroAcesso: !(await db.usuarioPorCpf(cpf)) });
});

app.post('/api/sair', (req, res) => {
  definirCookie(res, 'sessao', '', 0);
  res.json({ ok: true });
});

app.get('/api/eu', exigirCpf, (req, res) => {
  res.json({ cpf: req.cpf, usuario: req.usuario });
});

// Primeiro acesso: nome, foto opcional, tipo
app.post('/api/cadastro', exigirCpf, async (req, res) => {
  if (req.usuario) return res.status(400).json({ erro: 'Cadastro já realizado.' });
  const nome = texto(req.body.nome, 200).trim();
  const tipo = req.body.tipo;
  if (nome.split(/\s+/).length < 2) return res.status(400).json({ erro: 'Informe seu nome completo.' });
  if (!['especialista', 'instrutor'].includes(tipo)) return res.status(400).json({ erro: 'Escolha especialista ou instrutor.' });
  const foto = lerArquivo(req.body.foto, { imagem: true });
  const usuario = await db.criarUsuario({ cpf: req.cpf, nome, tipo, foto: foto?.url || null });
  res.json({ usuario });
});

// Turmas
app.get('/api/turmas', exigirUsuario, async (req, res) => {
  res.json({ turmas: await db.turmasDoUsuario(req.usuario.id) });
});

app.post('/api/turmas', exigirUsuario, async (req, res) => {
  const t = {
    cidade: texto(req.body.cidade, 200).trim(),
    sindicato: texto(req.body.sindicato, 200).trim(),
    horario: texto(req.body.horario, 200).trim(),
  };
  if (!t.cidade || !t.sindicato || !t.horario) {
    return res.status(400).json({ erro: 'Preencha cidade, sindicato rural e horário.' });
  }
  res.json({ turma: await db.criarTurma(req.usuario.id, t) });
});

async function carregarTurma(req, res, next) {
  const id = Number(req.params.turmaId);
  const turma = Number.isInteger(id) ? await db.turma(id) : null;
  if (!turma || turma.usuario_id !== req.usuario.id) return res.status(404).json({ erro: 'Turma não encontrada.' });
  req.turma = turma;
  next();
}

app.get('/api/turmas/:turmaId', exigirUsuario, carregarTurma, async (req, res) => {
  res.json({ turma: req.turma, modulos: await db.modulosDaTurma(req.turma.id) });
});

app.delete('/api/turmas/:turmaId', exigirUsuario, carregarTurma, async (req, res) => {
  const anexos = await db.excluirTurma(req.turma.id);
  await Promise.all(anexos.map((url) => arquivos.remover(url)));
  res.json({ ok: true });
});

app.post('/api/turmas/:turmaId/modulos/:numero', exigirUsuario, carregarTurma, async (req, res) => {
  const numero = Number(req.params.numero);
  if (!(Number.isInteger(numero) && numero >= 1 && numero <= 8)) return res.status(404).json({ erro: 'Módulo inválido.' });
  const instrutor = req.usuario.tipo === 'instrutor';
  const modulo1Especialista = !instrutor && numero === 1;

  // Instrutor envia imagem; a foto da expedição também é imagem.
  const novo = lerArquivo(req.body.anexo, { imagem: instrutor || modulo1Especialista });

  let dados = null;
  let textoModulo = null;
  if (modulo1Especialista) {
    dados = {};
    for (const c of MODULO1_ESPECIALISTA_CAMPOS) if (c.chave) dados[c.chave] = texto(req.body[c.chave], c.max || MAX_TEXTO);
  } else {
    textoModulo = texto(req.body.texto);
  }

  const anterior = await db.modulo(req.turma.id, numero);
  let anexo = anterior?.anexo || null;
  let anexoNome = anterior?.anexo_nome || null;
  if (novo || req.body.removerAnexo) {
    if (anexo && anexo !== novo?.url) await arquivos.remover(anexo);
    anexo = novo?.url || null;
    anexoNome = novo?.nome || null;
  }

  const modulo = await db.salvarModulo(req.turma.id, numero, { dados, texto: textoModulo, anexo, anexoNome });
  res.json({ modulo });
});

// Fórum: todos os cadastrados leem e publicam nos três fóruns.
// O admin lê tudo e pode apagar qualquer mensagem.
const FORUNS = ['geral', 'especialista', 'instrutor'];

async function exigirLeitorForum(req, res, next) {
  if (sessao(req).admin) {
    req.admin = true;
    return next();
  }
  await exigirUsuario(req, res, next);
}

function podePublicar(usuario) {
  return Boolean(usuario);
}

app.get('/api/forum/:forum', exigirLeitorForum, async (req, res) => {
  const forum = req.params.forum;
  if (!FORUNS.includes(forum)) return res.status(404).json({ erro: 'Fórum não encontrado.' });
  res.json({ topicos: await db.topicos(forum), podePublicar: podePublicar(req.usuario) });
});

app.post('/api/forum/:forum', exigirUsuario, async (req, res) => {
  const forum = req.params.forum;
  if (!FORUNS.includes(forum)) return res.status(404).json({ erro: 'Fórum não encontrado.' });
  const titulo = texto(req.body.titulo, 200).trim();
  const corpo = texto(req.body.texto).trim();
  if (!titulo || !corpo) return res.status(400).json({ erro: 'Escreva o título e a mensagem.' });
  res.json({ topico: await db.criarTopico({ forum, usuarioId: req.usuario.id, titulo, texto: corpo }) });
});

async function carregarTopico(req, res, next) {
  const id = Number(req.params.id);
  req.topico = Number.isInteger(id) ? await db.topico(id) : null;
  if (!req.topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });
  next();
}

app.get('/api/forum/topico/:id', exigirLeitorForum, carregarTopico, async (req, res) => {
  res.json({
    topico: req.topico,
    respostas: await db.respostas(req.topico.id),
    podePublicar: podePublicar(req.usuario),
    usuarioId: req.usuario?.id || null,
    admin: Boolean(req.admin),
  });
});

app.post('/api/forum/topico/:id/respostas', exigirUsuario, carregarTopico, async (req, res) => {
  const corpo = texto(req.body.texto).trim();
  if (!corpo) return res.status(400).json({ erro: 'Escreva a resposta.' });
  res.json({ resposta: await db.responder({ topicoId: req.topico.id, usuarioId: req.usuario.id, texto: corpo }) });
});

app.delete('/api/forum/topico/:id', exigirLeitorForum, carregarTopico, async (req, res) => {
  if (!req.admin && req.topico.usuario_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o autor pode apagar.' });
  await db.excluirTopico(req.topico.id);
  res.json({ ok: true });
});

app.delete('/api/forum/resposta/:id', exigirLeitorForum, async (req, res) => {
  const id = Number(req.params.id);
  const r = Number.isInteger(id) ? await db.resposta(id) : null;
  if (!r) return res.status(404).json({ erro: 'Resposta não encontrada.' });
  if (!req.admin && r.usuario_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o autor pode apagar.' });
  await db.excluirResposta(id);
  res.json({ ok: true });
});

// Admin
app.post('/api/admin/entrar', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ erro: 'Acesso admin não configurado (defina ADMIN_PASSWORD).' });
  const a = crypto.createHash('sha256').update(String(req.body.senha || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Senha incorreta.' });
  definirCookie(res, 'sessao', assinar('admin:1'), 60 * 60 * 12);
  res.json({ ok: true });
});

app.get('/api/admin/envios', exigirAdmin, async (req, res) => {
  const [envios, usuarios] = await Promise.all([db.todosEnvios(), db.todosUsuarios()]);
  res.json({ envios, usuarios });
});

app.post('/api/admin/feedback', exigirAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  const feedback = texto(req.body.feedback).trim();
  if (!ids.length) return res.status(400).json({ erro: 'Selecione ao menos um envio.' });
  if (!feedback) return res.status(400).json({ erro: 'Escreva o feedback.' });
  res.json({ atualizados: await db.darFeedback(ids, feedback) });
});

app.use((err, req, res, next) => {
  if (err.status && (err.status < 500 || err.status === 503)) return res.status(err.status).json({ erro: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ erro: 'Arquivo maior que 5MB.' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
}

module.exports = app;
module.exports.app = app;
module.exports.cpfValido = cpfValido;
