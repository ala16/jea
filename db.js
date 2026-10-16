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
    tipo TEXT NOT NULL CHECK (tipo IN ('especialista', 'instrutor')),
    foto TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS turmas (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    cidade TEXT NOT NULL,
    sindicato TEXT NOT NULL,
    periodo TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS turmas_usuario_idx ON turmas (usuario_id);

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

  criarUsuario: ({ cpf, nome, tipo, foto }) =>
    um('INSERT INTO usuarios (cpf, nome, tipo, foto) VALUES ($1, $2, $3, $4) RETURNING *', [cpf, nome, tipo, foto]),

  turmasDoUsuario: (usuarioId) =>
    todos(
      `SELECT t.*, COUNT(m.id)::int AS modulos_enviados,
              COUNT(m.feedback)::int AS feedbacks
         FROM turmas t LEFT JOIN modulos m ON m.turma_id = t.id
        WHERE t.usuario_id = $1 GROUP BY t.id ORDER BY t.id DESC`,
      [usuarioId]
    ),

  criarTurma: (usuarioId, { numero, cidade, sindicato, periodo }) =>
    um(
      'INSERT INTO turmas (usuario_id, numero, cidade, sindicato, periodo) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [usuarioId, numero, cidade, sindicato, periodo]
    ),

  turma: (id) => um('SELECT * FROM turmas WHERE id = $1', [id]),

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
      `SELECT u.*, (SELECT COUNT(*)::int FROM turmas t WHERE t.usuario_id = u.id) AS turmas
         FROM usuarios u ORDER BY u.nome`
    ),

  todosEnvios: () =>
    todos(
      `SELECT m.*, t.numero AS turma_numero, t.cidade, t.sindicato, t.periodo,
              u.id AS usuario_id, u.nome, u.cpf, u.tipo
         FROM modulos m JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
        ORDER BY m.atualizado_em DESC`
    ),

  async darFeedback(ids, feedback) {
    const r = await q('UPDATE modulos SET feedback = $1, feedback_em = now() WHERE id = ANY($2::int[])', [feedback, ids]);
    return r.rowCount;
  },
};
