'use strict';

// Banco Postgres. Na Vercel usa DATABASE_URL (Neon/Vercel Postgres);
// sem DATABASE_URL usa PGlite (Postgres embutido) para rodar localmente.

const path = require('path');
const fs = require('fs');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    cpf TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('especialista', 'instrutor', 'gestor')),
    foto TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS turmas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    numero TEXT,
    cidade TEXT NOT NULL,
    sindicato TEXT NOT NULL,
    periodo TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS turmas_usuario_idx ON turmas (usuario_id);
  -- O número da turma deixou de ser pedido; a coluna periodo guarda o horário.
  ALTER TABLE turmas ALTER COLUMN numero DROP NOT NULL;

  CREATE TABLE IF NOT EXISTS modulos (
    id SERIAL PRIMARY KEY,
    turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 8),
    dados JSONB,
    texto TEXT,
    anexo TEXT,
    anexo_nome TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    feedback TEXT,
    feedback_em TIMESTAMPTZ,
    UNIQUE (turma_id, numero)
  );

  -- Fórum: geral, especialista ou instrutor. Todos leem e publicam nos três.
  CREATE TABLE IF NOT EXISTS forum_topicos (
    id SERIAL PRIMARY KEY,
    forum TEXT NOT NULL CHECK (forum IN ('geral', 'especialista', 'instrutor')),
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS forum_topicos_forum_idx ON forum_topicos (forum, criado_em DESC);

  CREATE TABLE IF NOT EXISTS forum_respostas (
    id SERIAL PRIMARY KEY,
    topico_id INTEGER NOT NULL REFERENCES forum_topicos(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS forum_respostas_topico_idx ON forum_respostas (topico_id, criado_em);
  ALTER TABLE forum_topicos ADD COLUMN IF NOT EXISTS imagem TEXT;
  ALTER TABLE forum_respostas ADD COLUMN IF NOT EXISTS imagem TEXT;

  -- Avisos que o admin envia para todos, só especialistas ou só instrutores.
  CREATE TABLE IF NOT EXISTS avisos (
    id SERIAL PRIMARY KEY,
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL,
    publico TEXT NOT NULL DEFAULT 'todos' CHECK (publico IN ('todos', 'especialista', 'instrutor')),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Links de redes sociais do perfil: { instagram, facebook, linkedin, youtube, site }.
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS redes JSONB;
  -- E-mail de contato (obrigatório nos cadastros novos; só o gestor vê).
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT;
  -- O gestor também tem perfil (foto, redes...): uma linha com tipo 'gestor' e cpf 'gestor'.
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_tipo_check'
                     AND pg_get_constraintdef(oid) LIKE '%gestor%') THEN
      ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
      ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check CHECK (tipo IN ('especialista', 'instrutor', 'gestor'));
    END IF;
  END $$;

  -- Materiais (links do Google Drive, cartilhas...). Só o admin publica; todos veem.
  CREATE TABLE IF NOT EXISTS materiais (
    id SERIAL PRIMARY KEY,
    categoria TEXT NOT NULL CHECK (categoria IN ('geral', 'especialista', 'instrutor')),
    titulo TEXT NOT NULL,
    descricao TEXT,
    url TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Perguntas para o admin: cada pessoa vê as suas; o admin vê todas e responde.
  CREATE TABLE IF NOT EXISTS perguntas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    resposta TEXT,
    respondida_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS perguntas_usuario_idx ON perguntas (usuario_id);

  -- Mensagens diretas entre participantes.
  CREATE TABLE IF NOT EXISTS mensagens (
    id SERIAL PRIMARY KEY,
    de_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    para_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    lida BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS mensagens_para_idx ON mensagens (para_id, lida);
  CREATE INDEX IF NOT EXISTS mensagens_de_para_idx ON mensagens (de_id, para_id);
`;

let pronto;

function conectar() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new Pool({ connectionString: url, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
    return pool.query(SCHEMA).then(() => (sql, params) => pool.query(sql, params));
  }
  if (process.env.VERCEL) {
    // Na Vercel o disco é temporário: sem Postgres os dados se perderiam.
    return Promise.reject(Object.assign(new Error('O banco de dados ainda não foi configurado na Vercel.'), { status: 503 }));
  }
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, 'data', 'pglite');
  if (dir !== 'memory://') fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  return pg.exec(SCHEMA).then(() => async (sql, params) => {
    const r = await pg.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  });
}

async function q(sql, params = []) {
  pronto ??= conectar().catch((e) => {
    pronto = undefined;
    throw e;
  });
  return (await pronto)(sql, params);
}

const um = async (sql, params) => (await q(sql, params)).rows[0];
const todos = async (sql, params) => (await q(sql, params)).rows;

module.exports = {
  usuarioPorCpf: (cpf) => um('SELECT * FROM usuarios WHERE cpf = $1', [cpf]),

  // Perfil do gestor: criado na primeira vez que ele entra.
  async gestor() {
    return (
      (await um("SELECT * FROM usuarios WHERE cpf = 'gestor'")) ||
      (await um(
        `INSERT INTO usuarios (cpf, nome, tipo, redes) VALUES ('gestor', 'Gestor do JEA', 'gestor', '{}')
         ON CONFLICT (cpf) DO UPDATE SET cpf = excluded.cpf RETURNING *`
      ))
    );
  },

  criarUsuario: ({ cpf, nome, email, tipo, foto, redes }) =>
    um(
      'INSERT INTO usuarios (cpf, nome, email, tipo, foto, redes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [cpf, nome, email, tipo, foto, JSON.stringify(redes || {})]
    ),

  atualizarPerfil: (id, { nome, email, foto, redes }) =>
    um('UPDATE usuarios SET nome = $2, email = $3, foto = $4, redes = $5 WHERE id = $1 RETURNING *', [
      id, nome, email, foto, JSON.stringify(redes),
    ]),

  perfil: (id) => um('SELECT id, nome, tipo, foto, redes FROM usuarios WHERE id = $1', [id]),

  // Lista pública de participantes (sem CPF).
  participantes: () =>
    todos(
      `SELECT u.id, u.nome, u.tipo, u.foto,
              (SELECT COUNT(*)::int FROM turmas t WHERE t.usuario_id = u.id) AS turmas
         FROM usuarios u ORDER BY u.tipo = 'gestor' DESC, u.nome`
    ),

  // O que outros participantes podem ver: turmas (sem o conteúdo dos módulos) e postagens do fórum.
  turmasPublicas: (usuarioId) =>
    todos(
      `SELECT t.id, t.cidade, t.sindicato, t.periodo AS horario, COUNT(m.id)::int AS modulos_enviados
         FROM turmas t LEFT JOIN modulos m ON m.turma_id = t.id
        WHERE t.usuario_id = $1 GROUP BY t.id ORDER BY t.id DESC`,
      [usuarioId]
    ),

  postagensDoForum: (usuarioId) =>
    todos(
      `SELECT 'topico' AS tipo, t.id AS topico_id, t.titulo, t.forum, t.texto, t.criado_em
         FROM forum_topicos t WHERE t.usuario_id = $1
       UNION ALL
       SELECT 'resposta', t.id, t.titulo, t.forum, r.texto, r.criado_em
         FROM forum_respostas r JOIN forum_topicos t ON t.id = r.topico_id WHERE r.usuario_id = $1
       ORDER BY criado_em DESC LIMIT 50`,
      [usuarioId]
    ),

  conversas: (usuarioId) =>
    todos(
      `SELECT u.id, u.nome, u.tipo, u.foto, c.texto, c.criado_em, c.de_id,
              (SELECT COUNT(*)::int FROM mensagens n WHERE n.de_id = u.id AND n.para_id = $1 AND NOT n.lida) AS nao_lidas
         FROM (SELECT DISTINCT ON (outro) *, CASE WHEN de_id = $1 THEN para_id ELSE de_id END AS outro
                 FROM mensagens WHERE de_id = $1 OR para_id = $1
                ORDER BY outro, id DESC) c
         JOIN usuarios u ON u.id = c.outro
        ORDER BY c.id DESC`,
      [usuarioId]
    ),

  async conversa(usuarioId, outroId) {
    await q('UPDATE mensagens SET lida = true WHERE de_id = $2 AND para_id = $1 AND NOT lida', [usuarioId, outroId]);
    return todos(
      `SELECT * FROM mensagens WHERE (de_id = $1 AND para_id = $2) OR (de_id = $2 AND para_id = $1)
        ORDER BY id DESC LIMIT 200`,
      [usuarioId, outroId]
    ).then((r) => r.reverse());
  },

  enviarMensagem: (de, para, texto) =>
    um('INSERT INTO mensagens (de_id, para_id, texto) VALUES ($1, $2, $3) RETURNING *', [de, para, texto]),

  async naoLidas(usuarioId) {
    return (await um('SELECT COUNT(*)::int AS n FROM mensagens WHERE para_id = $1 AND NOT lida', [usuarioId])).n;
  },

  async fotoDePerfil(url) {
    return Boolean(await um('SELECT 1 FROM usuarios WHERE foto = $1', [url]));
  },

  turmasDoUsuario: (usuarioId) =>
    todos(
      `SELECT t.*, t.periodo AS horario, COUNT(m.id)::int AS modulos_enviados,
              COUNT(m.feedback)::int AS feedbacks
         FROM turmas t LEFT JOIN modulos m ON m.turma_id = t.id
        WHERE t.usuario_id = $1 GROUP BY t.id ORDER BY t.id DESC`,
      [usuarioId]
    ),

  criarTurma: (usuarioId, { cidade, sindicato, horario }) =>
    um(
      `INSERT INTO turmas (usuario_id, cidade, sindicato, periodo) VALUES ($1, $2, $3, $4)
       RETURNING *, periodo AS horario`,
      [usuarioId, cidade, sindicato, horario]
    ),

  turma: (id) => um('SELECT *, periodo AS horario FROM turmas WHERE id = $1', [id]),

  async excluirTurma(id) {
    const anexos = await todos('SELECT anexo FROM modulos WHERE turma_id = $1 AND anexo IS NOT NULL', [id]);
    await q('DELETE FROM turmas WHERE id = $1', [id]);
    return anexos.map((r) => r.anexo);
  },

  modulosDaTurma: (turmaId) => todos('SELECT * FROM modulos WHERE turma_id = $1 ORDER BY numero', [turmaId]),

  modulo: (turmaId, numero) => um('SELECT * FROM modulos WHERE turma_id = $1 AND numero = $2', [turmaId, numero]),

  salvarModulo: (turmaId, numero, { dados, texto, anexo, anexoNome }) =>
    um(
      `INSERT INTO modulos (turma_id, numero, dados, texto, anexo, anexo_nome)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (turma_id, numero) DO UPDATE SET
         dados = excluded.dados, texto = excluded.texto, anexo = excluded.anexo,
         anexo_nome = excluded.anexo_nome, atualizado_em = now()
       RETURNING *`,
      [turmaId, numero, dados ? JSON.stringify(dados) : null, texto, anexo, anexoNome]
    ),

  async donoDoArquivo(url) {
    const r = await um(
      `SELECT cpf FROM usuarios WHERE foto = $1
       UNION SELECT u.cpf FROM modulos m JOIN turmas t ON t.id = m.turma_id
              JOIN usuarios u ON u.id = t.usuario_id WHERE m.anexo = $1`,
      [url]
    );
    return r?.cpf || null;
  },

  todosUsuarios: () =>
    todos(
      `SELECT u.*, (SELECT COUNT(*)::int FROM turmas t WHERE t.usuario_id = u.id) AS turmas,
              (SELECT COUNT(*)::int FROM modulos m JOIN turmas t ON t.id = m.turma_id WHERE t.usuario_id = u.id) AS envios,
              (SELECT COUNT(*)::int FROM modulos m JOIN turmas t ON t.id = m.turma_id
                WHERE t.usuario_id = u.id AND m.feedback IS NULL) AS sem_feedback
         FROM usuarios u WHERE u.tipo <> 'gestor' ORDER BY u.nome`
    ),

  todosEnvios: (usuarioId) =>
    todos(
      `SELECT m.*, t.cidade, t.sindicato, t.periodo AS horario,
              u.id AS usuario_id, u.nome, u.cpf, u.tipo
         FROM modulos m JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
        ${usuarioId ? 'WHERE u.id = $1' : ''}
        ORDER BY m.atualizado_em DESC`,
      usuarioId ? [usuarioId] : []
    ),

  usuarioPorId: (id) => um('SELECT * FROM usuarios WHERE id = $1', [id]),

  topicos: (forum) =>
    todos(
      `SELECT t.id, t.forum, t.titulo, t.criado_em, t.usuario_id,
              u.nome AS autor, u.tipo AS autor_tipo, u.foto AS autor_foto,
              COUNT(r.id)::int AS respostas,
              GREATEST(t.criado_em, MAX(r.criado_em)) AS ultima_atividade
         FROM forum_topicos t
         LEFT JOIN usuarios u ON u.id = t.usuario_id
         LEFT JOIN forum_respostas r ON r.topico_id = t.id
        WHERE t.forum = $1
        GROUP BY t.id, u.id
        ORDER BY ultima_atividade DESC`,
      [forum]
    ),

  topico: (id) =>
    um(
      `SELECT t.*, u.nome AS autor, u.tipo AS autor_tipo, u.foto AS autor_foto
         FROM forum_topicos t LEFT JOIN usuarios u ON u.id = t.usuario_id WHERE t.id = $1`,
      [id]
    ),

  respostas: (topicoId) =>
    todos(
      `SELECT r.*, u.nome AS autor, u.tipo AS autor_tipo, u.foto AS autor_foto
         FROM forum_respostas r LEFT JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.topico_id = $1 ORDER BY r.criado_em`,
      [topicoId]
    ),

  criarTopico: ({ forum, usuarioId, titulo, texto, imagem }) =>
    um(
      'INSERT INTO forum_topicos (forum, usuario_id, titulo, texto, imagem) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [forum, usuarioId, titulo, texto, imagem]
    ),

  responder: ({ topicoId, usuarioId, texto, imagem }) =>
    um('INSERT INTO forum_respostas (topico_id, usuario_id, texto, imagem) VALUES ($1, $2, $3, $4) RETURNING id', [
      topicoId,
      usuarioId,
      texto,
      imagem,
    ]),

  // Imagens do fórum podem ser vistas por qualquer pessoa logada.
  async imagemDoForum(url) {
    const r = await um(
      'SELECT 1 FROM forum_topicos WHERE imagem = $1 UNION SELECT 1 FROM forum_respostas WHERE imagem = $1',
      [url]
    );
    return Boolean(r);
  },

  resposta: (id) => um('SELECT * FROM forum_respostas WHERE id = $1', [id]),

  // Apagam e devolvem as imagens que ficaram sem uso, para remover os arquivos.
  async excluirTopico(id) {
    const imgs = await todos(
      `SELECT imagem FROM forum_topicos WHERE id = $1 AND imagem IS NOT NULL
       UNION ALL SELECT imagem FROM forum_respostas WHERE topico_id = $1 AND imagem IS NOT NULL`,
      [id]
    );
    await q('DELETE FROM forum_topicos WHERE id = $1', [id]);
    return imgs.map((r) => r.imagem);
  },

  async excluirResposta(id) {
    const r = await um('DELETE FROM forum_respostas WHERE id = $1 RETURNING imagem', [id]);
    return r?.imagem ? [r.imagem] : [];
  },

  avisos: (tipo) =>
    tipo
      ? todos("SELECT * FROM avisos WHERE publico IN ('todos', $1) ORDER BY id DESC", [tipo])
      : todos('SELECT * FROM avisos ORDER BY id DESC'),

  criarAviso: ({ titulo, texto, publico }) =>
    um('INSERT INTO avisos (titulo, texto, publico) VALUES ($1, $2, $3) RETURNING *', [titulo, texto, publico]),

  async excluirAviso(id) {
    return (await q('DELETE FROM avisos WHERE id = $1', [id])).rowCount;
  },

  materiais: () => todos('SELECT * FROM materiais ORDER BY id DESC'),

  criarMaterial: ({ categoria, titulo, descricao, url }) =>
    um('INSERT INTO materiais (categoria, titulo, descricao, url) VALUES ($1, $2, $3, $4) RETURNING *', [
      categoria,
      titulo,
      descricao,
      url,
    ]),

  async excluirMaterial(id) {
    return (await q('DELETE FROM materiais WHERE id = $1', [id])).rowCount;
  },

  perguntas: (usuarioId) =>
    todos(
      `SELECT p.*, u.nome, u.tipo, u.foto FROM perguntas p JOIN usuarios u ON u.id = p.usuario_id
        ${usuarioId ? 'WHERE p.usuario_id = $1' : ''}
        ORDER BY (p.resposta IS NULL) DESC, p.id DESC`,
      usuarioId ? [usuarioId] : []
    ),

  criarPergunta: (usuarioId, texto) =>
    um('INSERT INTO perguntas (usuario_id, texto) VALUES ($1, $2) RETURNING *', [usuarioId, texto]),

  async responderPergunta(id, resposta) {
    return (await q('UPDATE perguntas SET resposta = $2, respondida_em = now() WHERE id = $1', [id, resposta])).rowCount;
  },

  async excluirPergunta(id) {
    return (await q('DELETE FROM perguntas WHERE id = $1', [id])).rowCount;
  },

  async darFeedback(ids, feedback) {
    const r = await q('UPDATE modulos SET feedback = $1, feedback_em = now() WHERE id = ANY($2::int[])', [feedback, ids]);
    return r.rowCount;
  },
};
