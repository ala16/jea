'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { MODULO1_ESPECIALISTA_CAMPOS } = require('./public/campos');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
const MAX_TEXTO = 2000;

if (!ADMIN_PASSWORD) {
  console.warn('[aviso] ADMIN_PASSWORD não definida: o acesso admin fica desativado.');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

// Sessão simples em cookie assinado com HMAC (sem dependências extras).
function assinar(valor) {
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(valor).digest('base64url');
  return `${valor}.${mac}`;
}

function verificar(cookie) {
  if (!cookie) return null;
  const i = cookie.lastIndexOf('.');
  if (i < 0) return null;
  const valor = cookie.slice(0, i);
  const esperado = assinar(valor);
  const a = Buffer.from(esperado);
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
  if (process.env.NODE_ENV === 'production') partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

function sessao(req) {
  const valor = verificar(lerCookies(req).sessao);
  if (!valor) return {};
  const [tipo, id] = valor.split(':');
  return tipo === 'cpf' ? { cpf: id } : tipo === 'admin' ? { admin: true } : {};
}

function exigirCpf(req, res, next) {
  const s = sessao(req);
  if (!s.cpf) return res.status(401).json({ erro: 'Faça login com seu CPF.' });
  req.cpf = s.cpf;
  req.usuario = db.usuarioPorCpf(s.cpf) || null;
  next();
}

function exigirUsuario(req, res, next) {
  exigirCpf(req, res, () => {
    if (!req.usuario) return res.status(403).json({ erro: 'Complete seu cadastro primeiro.' });
    next();
  });
}

function exigirAdmin(req, res, next) {
  if (!sessao(req).admin) return res.status(401).json({ erro: 'Acesso restrito ao admin.' });
  next();
}

// ---------- upload ----------

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function apenasImagem(file) {
  return file && /^image\//.test(file.mimetype);
}

function removerArquivo(nome) {
  if (!nome) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(nome)), () => {});
}

// ---------- app ----------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Anexos: só o dono ou o admin podem baixar.
app.get('/arquivos/:nome', (req, res) => {
  const nome = path.basename(req.params.nome);
  const s = sessao(req);
  const dono = db.donoDoArquivo(nome);
  if (!dono) return res.sendStatus(404);
  if (!s.admin && s.cpf !== dono) return res.sendStatus(403);
  res.sendFile(path.join(UPLOAD_DIR, nome));
});

// Login por CPF
app.post('/api/entrar', (req, res) => {
  const cpf = limparCpf(req.body.cpf);
  if (!cpfValido(cpf)) return res.status(400).json({ erro: 'CPF inválido.' });
  definirCookie(res, 'sessao', assinar(`cpf:${cpf}`), 60 * 60 * 24 * 30);
  res.json({ primeiroAcesso: !db.usuarioPorCpf(cpf) });
});

app.post('/api/sair', (req, res) => {
  definirCookie(res, 'sessao', '', 0);
  res.json({ ok: true });
});

app.get('/api/eu', exigirCpf, (req, res) => {
  res.json({ cpf: req.cpf, usuario: req.usuario });
});

// Primeiro acesso: nome, foto opcional, tipo
app.post('/api/cadastro', exigirCpf, upload.single('foto'), (req, res) => {
  if (req.usuario) {
    removerArquivo(req.file?.filename);
    return res.status(400).json({ erro: 'Cadastro já realizado.' });
  }
  const nome = texto(req.body.nome, 200).trim();
  const tipo = req.body.tipo;
  if (nome.split(/\s+/).length < 2) {
    removerArquivo(req.file?.filename);
    return res.status(400).json({ erro: 'Informe seu nome completo.' });
  }
  if (!['especialista', 'instrutor'].includes(tipo)) {
    removerArquivo(req.file?.filename);
    return res.status(400).json({ erro: 'Escolha especialista ou instrutor.' });
  }
  if (req.file && !apenasImagem(req.file)) {
    removerArquivo(req.file.filename);
    return res.status(400).json({ erro: 'A foto precisa ser uma imagem.' });
  }
  const usuario = db.criarUsuario({ cpf: req.cpf, nome, tipo, foto: req.file?.filename || null });
  res.json({ usuario });
});

// Turmas
app.get('/api/turmas', exigirUsuario, (req, res) => {
  res.json({ turmas: db.turmasDoUsuario(req.usuario.id) });
});

app.post('/api/turmas', exigirUsuario, (req, res) => {
  const t = {
    numero: texto(req.body.numero, 50).trim(),
    cidade: texto(req.body.cidade, 200).trim(),
    sindicato: texto(req.body.sindicato, 200).trim(),
    periodo: texto(req.body.periodo, 200).trim(),
  };
  if (!t.numero || !t.cidade || !t.sindicato || !t.periodo) {
    return res.status(400).json({ erro: 'Preencha número, cidade, sindicato rural e período.' });
  }
  res.json({ turma: db.criarTurma(req.usuario.id, t) });
});

function carregarTurma(req, res, next) {
  const turma = db.turma(Number(req.params.turmaId));
  if (!turma || turma.usuario_id !== req.usuario.id) return res.status(404).json({ erro: 'Turma não encontrada.' });
  req.turma = turma;
  next();
}

app.get('/api/turmas/:turmaId', exigirUsuario, carregarTurma, (req, res) => {
  res.json({ turma: req.turma, modulos: db.modulosDaTurma(req.turma.id) });
});

app.post(
  '/api/turmas/:turmaId/modulos/:numero',
  exigirUsuario,
  carregarTurma,
  upload.single('anexo'),
  (req, res) => {
    const numero = Number(req.params.numero);
    if (!(numero >= 1 && numero <= 8)) {
      removerArquivo(req.file?.filename);
      return res.status(404).json({ erro: 'Módulo inválido.' });
    }
    const instrutor = req.usuario.tipo === 'instrutor';
    const modulo1Especialista = !instrutor && numero === 1;

    // Instrutor envia imagem; foto da expedição também é imagem.
    if (req.file && (instrutor || modulo1Especialista) && !apenasImagem(req.file)) {
      removerArquivo(req.file.filename);
      return res.status(400).json({ erro: 'O arquivo precisa ser uma imagem.' });
    }

    let dados = null;
    let textoModulo = null;
    if (modulo1Especialista) {
      dados = {};
      for (const c of MODULO1_ESPECIALISTA_CAMPOS) if (c.chave) dados[c.chave] = texto(req.body[c.chave], c.max || MAX_TEXTO);
    } else {
      textoModulo = texto(req.body.texto);
    }

    const anterior = db.modulo(req.turma.id, numero);
    let anexo = anterior?.anexo || null;
    let anexoNome = anterior?.anexo_nome || null;
    if (req.file) {
      removerArquivo(anexo);
      anexo = req.file.filename;
      anexoNome = texto(req.file.originalname, 200);
    } else if (req.body.removerAnexo === '1') {
      removerArquivo(anexo);
      anexo = null;
      anexoNome = null;
    }

    db.salvarModulo(req.turma.id, numero, { dados, texto: textoModulo, anexo, anexoNome });
    res.json({ modulo: db.modulo(req.turma.id, numero) });
  }
);

// Admin
app.post('/api/admin/entrar', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ erro: 'Acesso admin não configurado (defina ADMIN_PASSWORD).' });
  const a = crypto.createHash('sha256').update(String(req.body.senha || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Senha incorreta.' });
  definirCookie(res, 'sessao', assinar('admin:1'), 60 * 60 * 12);
  res.json({ ok: true });
});

app.get('/api/admin/envios', exigirAdmin, (req, res) => {
  res.json({ envios: db.todosEnvios(), usuarios: db.todosUsuarios() });
});

app.post('/api/admin/feedback', exigirAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  const feedback = texto(req.body.feedback).trim();
  if (!ids.length) return res.status(400).json({ erro: 'Selecione ao menos um envio.' });
  if (!feedback) return res.status(400).json({ erro: 'Escreva o feedback.' });
  res.json({ atualizados: db.darFeedback(ids, feedback) });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ erro: 'Arquivo maior que 5MB.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));
}

module.exports = { app, cpfValido };
