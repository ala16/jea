'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const arquivos = require('./arquivos');
const { MODULO1_ESPECIALISTA_CAMPOS, EXPEDICAO_CAMPOS } = require('./public/campos');

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
  if (!sessao(req).admin) return res.status(401).json({ erro: 'Acesso restrito ao gestor.' });
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

// Vários arquivos num mesmo campo: aceita a lista nova (plural) e o formato antigo de um arquivo só.
const MAX_ARQUIVOS = 30;
function lerArquivos(lista, um, opcoes) {
  const itens = [].concat(Array.isArray(lista) ? lista : [], um || []);
  if (itens.length > MAX_ARQUIVOS) throw Object.assign(new Error(`Envie no máximo ${MAX_ARQUIVOS} arquivos por vez.`), { status: 400 });
  return itens.map((v) => lerArquivo(v, opcoes)).filter(Boolean);
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
  const url = `/arquivos/${nome}`;
  // Imagens do fórum e fotos de perfil: qualquer pessoa logada vê.
  if ((await db.imagemDoForum(url)) || (await db.fotoDePerfil(url))) {
    if (!s.admin && !s.cpf) return res.sendStatus(403);
    return res.sendFile(arquivos.caminhoLocal(nome));
  }
  const dono = await db.donoDoArquivo(url);
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

// Perfil: a pessoa edita nome, foto e redes sociais. O perfil (tipo) não muda.
const REDES = ['instagram', 'facebook', 'linkedin', 'site'];

// WhatsApp: guarda só os números, com o 55 do Brasil (ex.: 5516999998888).
function lerWhatsapp(v) {
  let n = texto(v, 40).replace(/\D/g, '');
  if (!n) return '';
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  if (n.length < 12 || n.length > 13) {
    throw Object.assign(new Error('WhatsApp inválido. Digite o DDD e o número, ex.: (16) 99999-8888.'), { status: 400 });
  }
  return n;
}

function erro400(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

function lerNome(v) {
  const nome = texto(v, 200).trim().replace(/\s+/g, ' ');
  if (nome.split(' ').length < 2) throw erro400('Informe seu nome completo.');
  return nome;
}

function lerEmail(v) {
  const email = texto(v, 200).trim().toLowerCase();
  if (!email) throw erro400('Informe seu e-mail.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro400('E-mail inválido.');
  return email;
}

function lerRedes(v) {
  const redes = {};
  const whatsapp = lerWhatsapp(v?.whatsapp);
  if (!whatsapp) throw erro400('Informe seu WhatsApp com DDD.');
  redes.whatsapp = whatsapp;
  for (const r of REDES) {
    const link = lerLink(v?.[r]);
    if (link) redes[r] = link;
  }
  return redes;
}

function lerLink(v) {
  let s = texto(v, 300).trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error();
    return u.href;
  } catch {
    throw Object.assign(new Error(`Link inválido: ${texto(v, 80)}`), { status: 400 });
  }
}

// Primeiro acesso: nome, e-mail, WhatsApp e tipo são obrigatórios; foto e redes, opcionais.
app.post('/api/cadastro', exigirCpf, async (req, res) => {
  if (req.usuario) return res.status(400).json({ erro: 'Cadastro já realizado.' });
  const nome = lerNome(req.body.nome);
  const email = lerEmail(req.body.email);
  const tipo = req.body.tipo;
  if (!['especialista', 'instrutor'].includes(tipo)) return res.status(400).json({ erro: 'Escolha especialista ou instrutor.' });
  const redes = lerRedes(req.body.redes);
  const foto = lerArquivo(req.body.foto, { imagem: true });
  const usuario = await db.criarUsuario({ cpf: req.cpf, nome, email, tipo, foto: foto?.url || null, redes });
  res.json({ usuario });
});

app.post('/api/perfil', exigirUsuario, async (req, res) => {
  const nome = lerNome(req.body.nome);
  const email = lerEmail(req.body.email);
  const redes = lerRedes(req.body.redes);
  const nova = lerArquivo(req.body.foto, { imagem: true });
  const antiga = req.usuario.foto;
  const foto = nova ? nova.url : req.body.removerFoto ? null : antiga;
  const usuario = await db.atualizarPerfil(req.usuario.id, { nome, email, foto, redes });
  if (antiga && antiga !== foto) await arquivos.remover(antiga);
  res.json({ usuario });
});

app.get('/api/perfil/:id', exigirLeitorForum, async (req, res) => {
  const id = Number(req.params.id);
  const perfil = Number.isInteger(id) ? await db.perfil(id) : null;
  if (!perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' });
  // Turmas e postagens do fórum ficam visíveis; o conteúdo dos módulos não.
  const [turmas, postagens] = await Promise.all([db.turmasPublicas(id), db.postagensDoForum(id)]);
  res.json({ perfil, turmas, postagens });
});

app.get('/api/participantes', exigirLeitorForum, async (req, res) => {
  res.json({ participantes: await db.participantes() });
});

// Mensagens diretas entre participantes.
app.get('/api/mensagens', exigirUsuario, async (req, res) => {
  res.json({ conversas: await db.conversas(req.usuario.id) });
});

app.get('/api/mensagens/nao-lidas', exigirUsuario, async (req, res) => {
  res.json({ total: await db.naoLidas(req.usuario.id) });
});

async function carregarOutro(req, res, next) {
  const id = Number(req.params.id);
  req.outro = Number.isInteger(id) && id !== req.usuario.id ? await db.perfil(id) : null;
  if (!req.outro) return res.status(404).json({ erro: 'Participante não encontrado.' });
  next();
}

app.get('/api/mensagens/:id', exigirUsuario, carregarOutro, async (req, res) => {
  res.json({ outro: req.outro, mensagens: await db.conversa(req.usuario.id, req.outro.id) });
});

app.post('/api/mensagens/:id', exigirUsuario, carregarOutro, async (req, res) => {
  const corpo = texto(req.body.texto).trim();
  if (!corpo) return res.status(400).json({ erro: 'Escreva a mensagem.' });
  res.json({ mensagem: await db.enviarMensagem(req.usuario.id, req.outro.id, corpo) });
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

function mudou(antes, depois) {
  const chaves = new Set([...Object.keys(antes.dados || {}), ...Object.keys(depois.dados || {})]);
  if ([...chaves].some((k) => (antes.dados?.[k] || '') !== (depois.dados?.[k] || ''))) return true;
  if ((antes.texto || '') !== (depois.texto || '')) return true;
  const urls = (l) => (l || []).map((a) => a.url).join('\n');
  return urls(antes.anexos) !== urls(depois.anexos);
}

async function carregarTurma(req, res, next) {
  const id = Number(req.params.turmaId);
  const turma = Number.isInteger(id) ? await db.turma(id) : null;
  if (!turma || turma.usuario_id !== req.usuario.id) return res.status(404).json({ erro: 'Turma não encontrada.' });
  req.turma = turma;
  next();
}

// Módulos que o gestor liberou para o perfil da pessoa.
async function modulosDisponiveis(tipo) {
  const ocultos = (await db.modulosOcultos())[tipo];
  return [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !ocultos.includes(n));
}

// Expedições do Agro: só o especialista envia, e só as que o gestor liberou.
async function expedicoesDisponiveis(tipo) {
  if (tipo !== 'especialista') return [];
  const ocultas = await db.expedicoesOcultas();
  return [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !ocultas.includes(n));
}

app.get('/api/turmas/:turmaId', exigirUsuario, carregarTurma, async (req, res) => {
  const [modulos, disponiveis, expedicoes, expedicoesLiberadas] = await Promise.all([
    db.modulosDaTurma(req.turma.id),
    modulosDisponiveis(req.usuario.tipo),
    db.modulosDaTurma(req.turma.id, 'expedicao'),
    expedicoesDisponiveis(req.usuario.tipo),
  ]);
  res.json({ turma: req.turma, modulos, disponiveis, expedicoes, expedicoesDisponiveis: expedicoesLiberadas });
});

app.delete('/api/turmas/:turmaId', exigirUsuario, carregarTurma, async (req, res) => {
  const anexos = await db.excluirTurma(req.turma.id);
  await Promise.all(anexos.map((url) => arquivos.remover(url)));
  res.json({ ok: true });
});

// Envio ou edição de um módulo ou de uma expedição. Mantém os anexos anteriores,
// menos os marcados para remover (removerAnexo antigo remove todos).
async function salvarEnvio(req, res, area, numero, { dados, texto: textoEnvio, imagem }) {
  const novos = lerArquivos(req.body.anexos, req.body.anexo, { imagem });
  const salvo = await db.modulo(req.turma.id, area, numero);
  const anterior = salvo?.anexos || [];
  const remover = new Set(Array.isArray(req.body.removerAnexos) ? req.body.removerAnexos.map(String) : []);
  const fica = (a) => !req.body.removerAnexo && !remover.has(a.url);
  const anexos = [...anterior.filter(fica), ...novos.filter((n) => !anterior.some((a) => a.url === n.url))];
  if (anexos.length > MAX_ARQUIVOS) return res.status(400).json({ erro: `Cada envio aceita até ${MAX_ARQUIVOS} arquivos.` });

  // Salvar sem mudar nada não conta como edição. Os anexos removidos numa edição não são
  // apagados: continuam na versão anterior, que o gestor vê no histórico.
  const novo = { dados, texto: textoEnvio, anexos };
  if (salvo && !mudou(salvo, novo)) return res.json({ modulo: salvo });
  res.json({ modulo: await db.salvarModulo(req.turma.id, area, numero, novo, salvo) });
}

function lerCampos(body, campos) {
  const dados = {};
  for (const c of campos) dados[c.chave] = texto(body[c.chave], c.max || MAX_TEXTO);
  return dados;
}

function numeroValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
}

app.post('/api/turmas/:turmaId/modulos/:numero', exigirUsuario, carregarTurma, async (req, res) => {
  const numero = numeroValido(req.params.numero);
  if (!numero) return res.status(404).json({ erro: 'Módulo inválido.' });
  if (!(await modulosDisponiveis(req.usuario.tipo)).includes(numero)) {
    return res.status(403).json({ erro: 'Este módulo não está liberado para envio.' });
  }
  const instrutor = req.usuario.tipo === 'instrutor';
  // Módulo 1 do especialista é o planejamento; os outros são texto e anexos. Instrutor envia imagens.
  if (!instrutor && numero === 1) {
    return salvarEnvio(req, res, 'modulo', numero, { dados: lerCampos(req.body, MODULO1_ESPECIALISTA_CAMPOS), texto: null });
  }
  return salvarEnvio(req, res, 'modulo', numero, { dados: null, texto: texto(req.body.texto), imagem: instrutor });
});

app.post('/api/turmas/:turmaId/expedicoes/:numero', exigirUsuario, carregarTurma, async (req, res) => {
  const numero = numeroValido(req.params.numero);
  if (!numero) return res.status(404).json({ erro: 'Expedição inválida.' });
  if (req.usuario.tipo !== 'especialista') return res.status(403).json({ erro: 'As expedições são enviadas pelo especialista.' });
  if (!(await expedicoesDisponiveis(req.usuario.tipo)).includes(numero)) {
    return res.status(403).json({ erro: 'Esta expedição não está liberada para envio.' });
  }
  return salvarEnvio(req, res, 'expedicao', numero, { dados: lerCampos(req.body, EXPEDICAO_CAMPOS), texto: null, imagem: true });
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
  const imagens = lerArquivos(req.body.imagens, req.body.imagem, { imagem: true }).map((a) => a.url);
  if (!titulo || (!corpo && !imagens.length)) return res.status(400).json({ erro: 'Escreva o título e a mensagem.' });
  res.json({
    topico: await db.criarTopico({ forum, usuarioId: req.usuario.id, titulo, texto: corpo, imagens }),
  });
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
  const imagens = lerArquivos(req.body.imagens, req.body.imagem, { imagem: true }).map((a) => a.url);
  if (!corpo && !imagens.length) return res.status(400).json({ erro: 'Escreva a resposta ou envie uma imagem.' });
  res.json({
    resposta: await db.responder({ topicoId: req.topico.id, usuarioId: req.usuario.id, texto: corpo, imagens }),
  });
});

app.delete('/api/forum/topico/:id', exigirLeitorForum, carregarTopico, async (req, res) => {
  if (!req.admin && req.topico.usuario_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o autor pode apagar.' });
  const imgs = await db.excluirTopico(req.topico.id);
  await Promise.all(imgs.map((u) => arquivos.remover(u)));
  res.json({ ok: true });
});

app.delete('/api/forum/resposta/:id', exigirLeitorForum, async (req, res) => {
  const id = Number(req.params.id);
  const r = Number.isInteger(id) ? await db.resposta(id) : null;
  if (!r) return res.status(404).json({ erro: 'Resposta não encontrada.' });
  if (!req.admin && r.usuario_id !== req.usuario.id) return res.status(403).json({ erro: 'Só o autor pode apagar.' });
  const imgs = await db.excluirResposta(id);
  await Promise.all(imgs.map((u) => arquivos.remover(u)));
  res.json({ ok: true });
});

// Avisos: o admin publica; cada usuário vê os gerais e os do seu perfil.
const PUBLICOS = ['todos', 'especialista', 'instrutor'];

app.get('/api/avisos', exigirLeitorForum, async (req, res) => {
  res.json({ avisos: req.admin ? await db.avisosDoGestor() : await db.avisos(req.usuario) });
});

// Instrutores e especialistas confirmam que leram o aviso; o gestor vê quem deu ciente e quando.
app.post('/api/avisos/:id/ciente', exigirUsuario, async (req, res) => {
  const id = Number(req.params.id);
  const em = Number.isInteger(id) ? await db.darCiente(id, req.usuario) : null;
  if (!em) return res.status(404).json({ erro: 'Aviso não encontrado.' });
  res.json({ ciente_em: em });
});

app.post('/api/admin/avisos', exigirAdmin, async (req, res) => {
  const titulo = texto(req.body.titulo, 200).trim();
  const corpo = texto(req.body.texto).trim();
  const publico = PUBLICOS.includes(req.body.publico) ? req.body.publico : 'todos';
  if (!titulo || !corpo) return res.status(400).json({ erro: 'Escreva o título e a mensagem do aviso.' });
  res.json({ aviso: await db.criarAviso({ titulo, texto: corpo, publico }) });
});

app.delete('/api/admin/avisos/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await db.excluirAviso(id))) return res.status(404).json({ erro: 'Aviso não encontrado.' });
  res.json({ ok: true });
});

// Materiais: só o admin publica; todos os cadastrados veem as três categorias.
const CATEGORIAS = ['geral', 'especialista', 'instrutor'];

app.get('/api/materiais', exigirLeitorForum, async (req, res) => {
  res.json({ materiais: await db.materiais(), admin: Boolean(req.admin) });
});

app.post('/api/admin/materiais', exigirAdmin, async (req, res) => {
  const titulo = texto(req.body.titulo, 200).trim();
  const descricao = texto(req.body.descricao, 1000).trim();
  const categoria = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'geral';
  if (!titulo) return res.status(400).json({ erro: 'Escreva o nome do material.' });
  if (!texto(req.body.url).trim()) return res.status(400).json({ erro: 'Cole o link do material.' });
  const url = lerLink(req.body.url);
  res.json({ material: await db.criarMaterial({ categoria, titulo, descricao, url }) });
});

app.delete('/api/admin/materiais/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await db.excluirMaterial(id))) return res.status(404).json({ erro: 'Material não encontrado.' });
  res.json({ ok: true });
});

// Perguntas ao admin: a pessoa vê só as suas; o admin vê todas e responde.
app.get('/api/perguntas', exigirLeitorForum, async (req, res) => {
  res.json({ perguntas: await db.perguntas(req.admin ? null : req.usuario.id), admin: Boolean(req.admin) });
});

app.post('/api/perguntas', exigirUsuario, async (req, res) => {
  const corpo = texto(req.body.texto).trim();
  if (!corpo) return res.status(400).json({ erro: 'Escreva sua pergunta.' });
  res.json({ pergunta: await db.criarPergunta(req.usuario.id, corpo) });
});

app.post('/api/admin/perguntas/:id/resposta', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const resposta = texto(req.body.resposta).trim();
  if (!resposta) return res.status(400).json({ erro: 'Escreva a resposta.' });
  if (!Number.isInteger(id) || !(await db.responderPergunta(id, resposta))) return res.status(404).json({ erro: 'Pergunta não encontrada.' });
  res.json({ ok: true });
});

app.delete('/api/admin/perguntas/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await db.excluirPergunta(id))) return res.status(404).json({ erro: 'Pergunta não encontrada.' });
  res.json({ ok: true });
});

// Admin
app.post('/api/admin/entrar', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ erro: 'Acesso do gestor não configurado (defina ADMIN_PASSWORD).' });
  const a = crypto.createHash('sha256').update(String(req.body.senha || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Senha incorreta.' });
  definirCookie(res, 'sessao', assinar('admin:1'), 60 * 60 * 12);
  res.json({ ok: true });
});

app.get('/api/admin/envios', exigirAdmin, async (req, res) => {
  const [envios, usuarios, ocultos, expedicoesOcultas] = await Promise.all([
    db.listaEnvios(), db.todosUsuarios(), db.modulosOcultos(), db.expedicoesOcultas(),
  ]);
  res.json({ envios, usuarios, ocultos, expedicoesOcultas });
});

// O gestor escolhe, para cada perfil, quais módulos ficam ocultos (sem envio).
app.post('/api/admin/modulos-ocultos', exigirAdmin, async (req, res) => {
  const ocultos = {};
  for (const tipo of ['especialista', 'instrutor']) {
    const lista = Array.isArray(req.body[tipo]) ? req.body[tipo].map(Number) : [];
    ocultos[tipo] = [...new Set(lista.filter((n) => Number.isInteger(n) && n >= 1 && n <= 8))];
  }
  await db.definirModulosOcultos(ocultos);
  res.json({ ocultos: await db.modulosOcultos() });
});

// Expedições que ainda não aparecem para os especialistas.
app.post('/api/admin/expedicoes-ocultas', exigirAdmin, async (req, res) => {
  const lista = Array.isArray(req.body.ocultas) ? req.body.ocultas.map(numeroValido).filter(Boolean) : [];
  await db.definirExpedicoesOcultas([...new Set(lista)]);
  res.json({ ocultas: await db.expedicoesOcultas() });
});

// Excluir um envio: o módulo volta a ficar pendente e a pessoa precisa enviar de novo.
app.delete('/api/admin/envios/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const anexos = Number.isInteger(id) ? await db.excluirEnvio(id) : null;
  if (!anexos) return res.status(404).json({ erro: 'Envio não encontrado.' });
  await Promise.all(anexos.map((url) => arquivos.remover(url)));
  res.json({ ok: true });
});

// Excluir uma pessoa com tudo o que ela enviou. Com o mesmo CPF ela pode se cadastrar de novo.
app.delete('/api/admin/usuarios/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const arqs = Number.isInteger(id) ? await db.excluirUsuario(id) : null;
  if (!arqs) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
  await Promise.all(arqs.map((url) => arquivos.remover(url)));
  res.json({ ok: true });
});

app.get('/api/admin/envios/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const envio = Number.isInteger(id) ? await db.envio(id) : null;
  if (!envio) return res.status(404).json({ erro: 'Envio não encontrado.' });
  res.json({ envio });
});

// Ficha de uma pessoa: perfil, turmas e todos os envios.
app.get('/api/admin/usuarios/:id', exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const usuario = Number.isInteger(id) ? await db.usuarioPorId(id) : null;
  if (!usuario) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
  const [turmas, envios] = await Promise.all([db.turmasDoUsuario(id), db.todosEnvios(id)]);
  res.json({ usuario, turmas, envios });
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
