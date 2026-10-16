'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'jea.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    cpf TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('especialista', 'instrutor')),
    foto TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS turmas (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    cidade TEXT NOT NULL,
    sindicato TEXT NOT NULL,
    periodo TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modulos (
    id INTEGER PRIMARY KEY,
    turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
    numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 8),
    dados TEXT,
    texto TEXT,
    anexo TEXT,
    anexo_nome TEXT,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    feedback TEXT,
    feedback_em TEXT,
    UNIQUE (turma_id, numero)
  );
`);

function modRow(m) {
  if (!m) return m;
  return { ...m, dados: m.dados ? JSON.parse(m.dados) : null };
}

module.exports = {
  usuarioPorCpf(cpf) {
    return db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf);
  },

  criarUsuario({ cpf, nome, tipo, foto }) {
    db.prepare('INSERT INTO usuarios (cpf, nome, tipo, foto) VALUES (?, ?, ?, ?)').run(cpf, nome, tipo, foto);
    return this.usuarioPorCpf(cpf);
  },

  turmasDoUsuario(usuarioId) {
    return db
      .prepare(
        `SELECT t.*, COUNT(m.id) AS modulos_enviados,
                SUM(CASE WHEN m.feedback IS NOT NULL THEN 1 ELSE 0 END) AS feedbacks
           FROM turmas t LEFT JOIN modulos m ON m.turma_id = t.id
          WHERE t.usuario_id = ? GROUP BY t.id ORDER BY t.id DESC`
      )
      .all(usuarioId);
  },

  criarTurma(usuarioId, { numero, cidade, sindicato, periodo }) {
    const r = db
      .prepare('INSERT INTO turmas (usuario_id, numero, cidade, sindicato, periodo) VALUES (?, ?, ?, ?, ?)')
      .run(usuarioId, numero, cidade, sindicato, periodo);
    return this.turma(Number(r.lastInsertRowid));
  },

  turma(id) {
    return db.prepare('SELECT * FROM turmas WHERE id = ?').get(id);
  },

  modulosDaTurma(turmaId) {
    return db.prepare('SELECT * FROM modulos WHERE turma_id = ? ORDER BY numero').all(turmaId).map(modRow);
  },

  modulo(turmaId, numero) {
    return modRow(db.prepare('SELECT * FROM modulos WHERE turma_id = ? AND numero = ?').get(turmaId, numero));
  },

  salvarModulo(turmaId, numero, { dados, texto, anexo, anexoNome }) {
    db.prepare(
      `INSERT INTO modulos (turma_id, numero, dados, texto, anexo, anexo_nome)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (turma_id, numero) DO UPDATE SET
         dados = excluded.dados, texto = excluded.texto, anexo = excluded.anexo,
         anexo_nome = excluded.anexo_nome, atualizado_em = datetime('now')`
    ).run(turmaId, numero, dados ? JSON.stringify(dados) : null, texto, anexo, anexoNome);
  },

  donoDoArquivo(nome) {
    const r = db
      .prepare(
        `SELECT cpf FROM usuarios WHERE foto = ?
         UNION SELECT u.cpf FROM modulos m JOIN turmas t ON t.id = m.turma_id
                JOIN usuarios u ON u.id = t.usuario_id WHERE m.anexo = ?`
      )
      .get(nome, nome);
    return r?.cpf || null;
  },

  todosUsuarios() {
    return db
      .prepare(
        `SELECT u.*, (SELECT COUNT(*) FROM turmas t WHERE t.usuario_id = u.id) AS turmas
           FROM usuarios u ORDER BY u.nome`
      )
      .all();
  },

  todosEnvios() {
    return db
      .prepare(
        `SELECT m.*, t.numero AS turma_numero, t.cidade, t.sindicato, t.periodo,
                u.id AS usuario_id, u.nome, u.cpf, u.tipo
           FROM modulos m JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
          ORDER BY m.atualizado_em DESC`
      )
      .all()
      .map(modRow);
  },

  darFeedback(ids, feedback) {
    const stmt = db.prepare(`UPDATE modulos SET feedback = ?, feedback_em = datetime('now') WHERE id = ?`);
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const id of ids) n += Number(stmt.run(feedback, id).changes);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return n;
  },
};
