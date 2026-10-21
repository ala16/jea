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

  -- Índices para o volume de 500 inscritos (perfis, painel do gestor e fórum).
  CREATE INDEX IF NOT EXISTS forum_topicos_usuario_idx ON forum_topicos (usuario_id);
  CREATE INDEX IF NOT EXISTS forum_respostas_usuario_idx ON forum_respostas (usuario_id);
  CREATE INDEX IF NOT EXISTS modulos_atualizado_idx ON modulos (atualizado_em DESC);
  CREATE INDEX IF NOT EXISTS mensagens_para_de_idx ON mensagens (para_id, de_id, id);
  CREATE INDEX IF NOT EXISTS usuarios_foto_idx ON usuarios (foto);
  CREATE INDEX IF NOT EXISTS forum_topicos_imagem_idx ON forum_topicos (imagem);
  CREATE INDEX IF NOT EXISTS forum_respostas_imagem_idx ON forum_respostas (imagem);

  -- "Ciente" dos avisos: o aviso fica pendente para a pessoa até ela clicar em Ciente.
  CREATE TABLE IF NOT EXISTS avisos_ciente (
    aviso_id INTEGER NOT NULL REFERENCES avisos(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (aviso_id, usuario_id)
  );
  CREATE INDEX IF NOT EXISTS avisos_ciente_usuario_idx ON avisos_ciente (usuario_id);

  -- Vários anexos por módulo ([{ url, nome }]) e várias imagens por postagem do fórum ([url]).
  -- As colunas antigas de um arquivo só são copiadas para as novas e esvaziadas.
  ALTER TABLE modulos ADD COLUMN IF NOT EXISTS anexos JSONB NOT NULL DEFAULT '[]';
  UPDATE modulos SET anexos = jsonb_build_array(jsonb_build_object('url', anexo, 'nome', COALESCE(anexo_nome, anexo))),
         anexo = NULL, anexo_nome = NULL
   WHERE anexo IS NOT NULL;
  ALTER TABLE forum_topicos ADD COLUMN IF NOT EXISTS imagens JSONB NOT NULL DEFAULT '[]';
  UPDATE forum_topicos SET imagens = jsonb_build_array(imagem), imagem = NULL WHERE imagem IS NOT NULL;
  ALTER TABLE forum_respostas ADD COLUMN IF NOT EXISTS imagens JSONB NOT NULL DEFAULT '[]';
  UPDATE forum_respostas SET imagens = jsonb_build_array(imagem), imagem = NULL WHERE imagem IS NOT NULL;

  -- Histórico de edições dos módulos: cada linha guarda a versão que existia antes da edição.
  -- enviado_em é o primeiro envio; atualizado_em passa a ser a última edição.
  ALTER TABLE modulos ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ;
  UPDATE modulos SET enviado_em = atualizado_em WHERE enviado_em IS NULL;
  CREATE TABLE IF NOT EXISTS modulos_edicoes (
    id SERIAL PRIMARY KEY,
    modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    dados JSONB,
    texto TEXT,
    anexos JSONB NOT NULL DEFAULT '[]',
    versao_de TIMESTAMPTZ NOT NULL,
    editado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS modulos_edicoes_modulo_idx ON modulos_edicoes (modulo_id, id);

  -- Módulos que o gestor ocultou para cada perfil: não aparecem e não aceitam envio.
  CREATE TABLE IF NOT EXISTS modulos_ocultos (
    tipo TEXT NOT NULL CHECK (tipo IN ('especialista', 'instrutor')),
    numero INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 8),
    PRIMARY KEY (tipo, numero)
  );

  -- Expedições do Agro: 8 por turma do especialista, separadas dos módulos. Ficam na mesma
  -- tabela (area = 'expedicao') e assim têm o mesmo envio, edição, histórico, feedback e exclusão.
  ALTER TABLE modulos ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT 'modulo';
  ALTER TABLE modulos DROP CONSTRAINT IF EXISTS modulos_area_check;
  ALTER TABLE modulos ADD CONSTRAINT modulos_area_check CHECK (area IN ('modulo', 'expedicao'));
  ALTER TABLE modulos DROP CONSTRAINT IF EXISTS modulos_turma_id_numero_key;
  CREATE UNIQUE INDEX IF NOT EXISTS modulos_turma_area_numero_idx ON modulos (turma_id, area, numero);

  -- A Expedição do Agro que estava no fim do módulo 1 passa a ser a Expedição 1, com as fotos,
  -- as datas e o feedback. O módulo 1 fica só com o planejamento. Roda uma vez só: depois disso
  -- nenhum módulo 1 tem mais as chaves da expedição.
  INSERT INTO modulos (turma_id, area, numero, dados, anexos, enviado_em, atualizado_em, feedback, feedback_em)
  SELECT turma_id, 'expedicao', 1,
         jsonb_build_object('expedicao_local', COALESCE(dados->>'expedicao_local', ''),
                            'expedicao_data', COALESCE(dados->>'expedicao_data', ''),
                            'expedicao_objetivo', COALESCE(dados->>'expedicao_objetivo', ''),
                            'expedicao_resultado', COALESCE(dados->>'expedicao_resultado', '')),
         anexos, enviado_em, atualizado_em, feedback, feedback_em
    FROM modulos
   WHERE area = 'modulo' AND numero = 1 AND dados ?| array['expedicao_local', 'expedicao_data', 'expedicao_objetivo', 'expedicao_resultado']
     AND (COALESCE(dados->>'expedicao_local', '') <> '' OR COALESCE(dados->>'expedicao_data', '') <> ''
          OR COALESCE(dados->>'expedicao_objetivo', '') <> '' OR COALESCE(dados->>'expedicao_resultado', '') <> ''
          OR jsonb_array_length(anexos) > 0)
  ON CONFLICT (turma_id, area, numero) DO NOTHING;
  UPDATE modulos SET dados = dados - 'expedicao_local' - 'expedicao_data' - 'expedicao_objetivo' - 'expedicao_resultado',
         anexos = '[]'
   WHERE area = 'modulo' AND numero = 1 AND dados ?| array['expedicao_local', 'expedicao_data', 'expedicao_objetivo', 'expedicao_resultado'];

  -- Expedições que o gestor ainda não liberou para os especialistas.
  CREATE TABLE IF NOT EXISTS expedicoes_ocultas (
    numero INTEGER PRIMARY KEY CHECK (numero BETWEEN 1 AND 8)
  );

  -- Conversa de cada participante com o gestor. do_gestor diz quem escreveu;
  -- lida vale para quem recebeu (o participante, se do_gestor, ou o gestor).
  CREATE TABLE IF NOT EXISTS mensagens_gestor (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    do_gestor BOOLEAN NOT NULL,
    texto TEXT NOT NULL,
    lida BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS mensagens_gestor_usuario_idx ON mensagens_gestor (usuario_id, id);
  CREATE INDEX IF NOT EXISTS mensagens_gestor_nao_lidas_idx ON mensagens_gestor (do_gestor, usuario_id) WHERE NOT lida;
`;

// O esquema só é aplicado quando muda (a versão é o hash do texto). Assim cada nova instância
// da Vercel não roda ALTER TABLE, que trava a tabela enquanto muita gente usa o sistema.
const VERSAO = require('crypto').createHash('sha256').update(SCHEMA).digest('hex').slice(0, 16);
// Vários comandos numa só consulta rodam numa só transação; o lock vale até o fim dela.
const MIGRAR = `
  SELECT pg_advisory_xact_lock(7340121);
  ${SCHEMA}
  CREATE TABLE IF NOT EXISTS jea_schema (id INTEGER PRIMARY KEY, versao TEXT NOT NULL);
  INSERT INTO jea_schema (id, versao) VALUES (1, '${VERSAO}')
    ON CONFLICT (id) DO UPDATE SET versao = excluded.versao;
`;

async function aplicarEsquema(pool) {
  const atual = await pool.query('SELECT versao FROM jea_schema WHERE id = 1').catch(() => null);
  if (atual?.rows[0]?.versao === VERSAO) return;
  await pool.query(MIGRAR);
}

// Na Neon, usa o endereço com pooler (PgBouncer), que aceita milhares de conexões;
// o direto aceita só ~100 e se esgota quando muitas funções abrem ao mesmo tempo.
function comPooler(url) {
  return url.replace(/@(ep-[a-z0-9-]+?)(?<!-pooler)(\.[a-z0-9-]+\.aws\.neon\.tech)/i, '@$1-pooler$2');
}

let pronto;

function conectar() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new Pool({
      connectionString: comPooler(url),
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ssl: local ? false : { rejectUnauthorized: false },
    });
    pool.on('error', (e) => console.warn('[aviso] conexão do banco caiu:', e.message));
    return aplicarEsquema(pool).then(() => (sql, params) => pool.query(sql, params));
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
         FROM usuarios u ORDER BY u.nome`
    ),

  // O que outros participantes podem ver: turmas (sem o conteúdo dos módulos) e postagens do fórum.
  turmasPublicas: (usuarioId) =>
    todos(
      `SELECT t.id, t.cidade, t.sindicato, t.periodo AS horario, COUNT(m.id)::int AS modulos_enviados
         FROM turmas t LEFT JOIN modulos m ON m.turma_id = t.id AND m.area = 'modulo'
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
    const r = await um(
      `SELECT (SELECT COUNT(*) FROM mensagens WHERE para_id = $1 AND NOT lida)
            + (SELECT COUNT(*) FROM mensagens_gestor WHERE usuario_id = $1 AND do_gestor AND NOT lida) AS n`,
      [usuarioId]
    );
    return Number(r.n);
  },

  // Conversa com o gestor, vista pelo participante (gestor = false) ou pelo gestor (gestor = true).
  // Abrir a conversa marca como lidas as mensagens que o outro lado escreveu.
  async conversaGestor(usuarioId, gestor) {
    await q('UPDATE mensagens_gestor SET lida = true WHERE usuario_id = $1 AND do_gestor = $2 AND NOT lida', [
      usuarioId,
      !gestor,
    ]);
    return todos('SELECT * FROM mensagens_gestor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 200', [usuarioId]).then((r) =>
      r.reverse()
    );
  },

  // Resumo da conversa com o gestor para a lista de mensagens do participante.
  resumoGestor: (usuarioId) =>
    um(
      `SELECT texto, criado_em, do_gestor,
              (SELECT COUNT(*)::int FROM mensagens_gestor WHERE usuario_id = $1 AND do_gestor AND NOT lida) AS nao_lidas
         FROM mensagens_gestor WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1`,
      [usuarioId]
    ),

  enviarMensagemGestor: (usuarioId, doGestor, texto) =>
    um('INSERT INTO mensagens_gestor (usuario_id, do_gestor, texto) VALUES ($1, $2, $3) RETURNING *', [
      usuarioId,
      doGestor,
      texto,
    ]),

  // Mensagem do gestor para várias pessoas de uma vez: cada uma recebe na sua conversa.
  async enviarMensagemGestorEmMassa({ ids, tipo }, texto) {
    const r = ids
      ? await q(
          `INSERT INTO mensagens_gestor (usuario_id, do_gestor, texto)
           SELECT id, true, $2 FROM usuarios WHERE id = ANY($1::int[])`,
          [ids, texto]
        )
      : await q(
          `INSERT INTO mensagens_gestor (usuario_id, do_gestor, texto)
           SELECT id, true, $2 FROM usuarios WHERE $1::text IS NULL OR tipo = $1`,
          [tipo || null, texto]
        );
    return r.rowCount;
  },

  // Conversas do gestor: uma por participante, a mais recente primeiro.
  conversasDoGestor: () =>
    todos(
      `SELECT u.id, u.nome, u.tipo, u.foto, c.texto, c.criado_em, c.do_gestor,
              (SELECT COUNT(*)::int FROM mensagens_gestor n WHERE n.usuario_id = u.id AND NOT n.do_gestor AND NOT n.lida) AS nao_lidas
         FROM (SELECT DISTINCT ON (usuario_id) * FROM mensagens_gestor ORDER BY usuario_id, id DESC) c
         JOIN usuarios u ON u.id = c.usuario_id
        ORDER BY c.id DESC`
    ),

  async naoLidasDoGestor() {
    return (await um('SELECT COUNT(*)::int AS n FROM mensagens_gestor WHERE NOT do_gestor AND NOT lida')).n;
  },

  async fotoDePerfil(url) {
    return Boolean(await um('SELECT 1 FROM usuarios WHERE foto = $1', [url]));
  },

  turmasDoUsuario: (usuarioId) =>
    todos(
      `SELECT t.*, t.periodo AS horario,
              COUNT(m.id) FILTER (WHERE m.area = 'modulo')::int AS modulos_enviados,
              COUNT(m.id) FILTER (WHERE m.area = 'expedicao')::int AS expedicoes_enviadas,
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
    const anexos = await todos(
      `SELECT a->>'url' AS url FROM modulos, jsonb_array_elements(anexos) a WHERE turma_id = $1
       UNION SELECT a->>'url' FROM modulos m JOIN modulos_edicoes e ON e.modulo_id = m.id,
              jsonb_array_elements(e.anexos) a WHERE m.turma_id = $1`,
      [id]
    );
    await q('DELETE FROM turmas WHERE id = $1', [id]);
    return anexos.map((r) => r.url);
  },

  // Envio apagado pelo gestor: o módulo volta a ficar pendente e a pessoa envia de novo.
  async excluirEnvio(id) {
    const anexos = await todos(
      `SELECT a->>'url' AS url FROM modulos, jsonb_array_elements(anexos) a WHERE id = $1
       UNION SELECT a->>'url' FROM modulos_edicoes e, jsonb_array_elements(e.anexos) a WHERE e.modulo_id = $1`,
      [id]
    );
    const r = await q('DELETE FROM modulos WHERE id = $1', [id]);
    return r.rowCount ? anexos.map((x) => x.url) : null;
  },

  // Apaga a pessoa e tudo dela (turmas, envios, fórum, mensagens, perguntas) e devolve os arquivos.
  async excluirUsuario(id) {
    const arquivos = await todos(
      `SELECT foto AS url FROM usuarios WHERE id = $1 AND foto IS NOT NULL
       UNION SELECT a->>'url' FROM modulos m JOIN turmas t ON t.id = m.turma_id, jsonb_array_elements(m.anexos) a
              WHERE t.usuario_id = $1
       UNION SELECT a->>'url' FROM modulos_edicoes e JOIN modulos m ON m.id = e.modulo_id JOIN turmas t ON t.id = m.turma_id,
              jsonb_array_elements(e.anexos) a WHERE t.usuario_id = $1
       UNION SELECT i FROM forum_topicos, jsonb_array_elements_text(imagens) i WHERE usuario_id = $1
       UNION SELECT i FROM forum_respostas r JOIN forum_topicos t ON t.id = r.topico_id,
              jsonb_array_elements_text(r.imagens) i WHERE t.usuario_id = $1 OR r.usuario_id = $1`,
      [id]
    );
    const r = await q('DELETE FROM usuarios WHERE id = $1', [id]);
    return r.rowCount ? arquivos.map((x) => x.url) : null;
  },

  // { especialista: [3, 4], instrutor: [] }
  async modulosOcultos() {
    const ocultos = { especialista: [], instrutor: [] };
    for (const r of await todos('SELECT tipo, numero FROM modulos_ocultos ORDER BY numero')) ocultos[r.tipo].push(r.numero);
    return ocultos;
  },

  async expedicoesOcultas() {
    return (await todos('SELECT numero FROM expedicoes_ocultas ORDER BY numero')).map((r) => r.numero);
  },

  async definirExpedicoesOcultas(nums) {
    await q('DELETE FROM expedicoes_ocultas WHERE numero <> ALL($1::int[])', [nums]);
    await q('INSERT INTO expedicoes_ocultas (numero) SELECT unnest($1::int[]) ON CONFLICT DO NOTHING', [nums]);
  },

  async definirModulosOcultos(ocultos) {
    const linhas = Object.entries(ocultos).flatMap(([tipo, nums]) => nums.map((n) => [tipo, n]));
    const params = [linhas.map((l) => l[0]), linhas.map((l) => l[1])];
    await q(
      `DELETE FROM modulos_ocultos WHERE (tipo, numero) NOT IN (SELECT * FROM unnest($1::text[], $2::int[]))`,
      params
    );
    await q(
      `INSERT INTO modulos_ocultos (tipo, numero) SELECT * FROM unnest($1::text[], $2::int[]) ON CONFLICT DO NOTHING`,
      params
    );
  },

  // Módulos ou expedições (area) já enviados na turma.
  modulosDaTurma: (turmaId, area = 'modulo') =>
    todos(
      `SELECT m.*, (SELECT COUNT(*)::int FROM modulos_edicoes e WHERE e.modulo_id = m.id) AS edicoes
         FROM modulos m WHERE m.turma_id = $1 AND m.area = $2 ORDER BY m.numero`,
      [turmaId, area]
    ),

  modulo: (turmaId, area, numero) =>
    um('SELECT * FROM modulos WHERE turma_id = $1 AND area = $2 AND numero = $3', [turmaId, area, numero]),

  // Primeiro envio cria o módulo (ou a expedição); uma edição guarda antes a versão anterior no histórico.
  async salvarModulo(turmaId, area, numero, { dados, texto, anexos }, anterior) {
    const valores = [dados ? JSON.stringify(dados) : null, texto, JSON.stringify(anexos)];
    if (!anterior) {
      return um(
        `INSERT INTO modulos (turma_id, area, numero, dados, texto, anexos, enviado_em) VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (turma_id, area, numero) DO UPDATE SET
           dados = excluded.dados, texto = excluded.texto, anexos = excluded.anexos, atualizado_em = now()
         RETURNING *`,
        [turmaId, area, numero, ...valores]
      );
    }
    return um(
      `WITH h AS (
         INSERT INTO modulos_edicoes (modulo_id, dados, texto, anexos, versao_de)
         SELECT id, dados, texto, anexos, atualizado_em FROM modulos WHERE id = $1
       )
       UPDATE modulos SET dados = $2, texto = $3, anexos = $4, atualizado_em = now() WHERE id = $1 RETURNING *`,
      [anterior.id, ...valores]
    );
  },

  async donoDoArquivo(url) {
    const r = await um(
      `SELECT cpf FROM usuarios WHERE foto = $1
       UNION SELECT u.cpf FROM modulos m JOIN turmas t ON t.id = m.turma_id
              JOIN usuarios u ON u.id = t.usuario_id
              WHERE m.anexos @> jsonb_build_array(jsonb_build_object('url', $1::text))
       UNION SELECT u.cpf FROM modulos_edicoes e JOIN modulos m ON m.id = e.modulo_id
              JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
              WHERE e.anexos @> jsonb_build_array(jsonb_build_object('url', $1::text))`,
      [url]
    );
    return r?.cpf || null;
  },

  todosUsuarios: () =>
    todos(
      `SELECT u.*, (SELECT COUNT(*)::int FROM turmas t WHERE t.usuario_id = u.id) AS turmas,
              (SELECT COUNT(*)::int FROM modulos m JOIN turmas t ON t.id = m.turma_id
                WHERE t.usuario_id = u.id AND m.area = 'modulo') AS envios,
              (SELECT COUNT(*)::int FROM modulos m JOIN turmas t ON t.id = m.turma_id
                WHERE t.usuario_id = u.id AND m.area = 'expedicao') AS expedicoes,
              (SELECT COUNT(*)::int FROM modulos m JOIN turmas t ON t.id = m.turma_id
                WHERE t.usuario_id = u.id AND m.feedback IS NULL) AS sem_feedback
         FROM usuarios u ORDER BY u.nome`
    ),

  // Lista leve para o painel do gestor: sem os textos, que vêm um a um em envio(id).
  // Com 500 inscritos a lista completa passaria do limite de 4,5MB de resposta da Vercel.
  listaEnvios: () =>
    todos(
      `SELECT m.id, m.turma_id, m.area, m.numero, m.atualizado_em, m.enviado_em, m.feedback, m.feedback_em,
              (SELECT COUNT(*)::int FROM modulos_edicoes e WHERE e.modulo_id = m.id) AS edicoes,
              t.cidade, t.sindicato, t.periodo AS horario,
              u.id AS usuario_id, u.nome, u.cpf, u.tipo
         FROM modulos m JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
        ORDER BY m.atualizado_em DESC`
    ),

  envio: (id) =>
    um(
      `SELECT m.*,
              COALESCE((SELECT json_agg(e ORDER BY e.id) FROM modulos_edicoes e WHERE e.modulo_id = m.id), '[]'::json) AS historico,
              t.cidade, t.sindicato, t.periodo AS horario,
              u.id AS usuario_id, u.nome, u.cpf, u.tipo
         FROM modulos m JOIN turmas t ON t.id = m.turma_id JOIN usuarios u ON u.id = t.usuario_id
        WHERE m.id = $1`,
      [id]
    ),

  todosEnvios: (usuarioId) =>
    todos(
      `SELECT m.*,
              COALESCE((SELECT json_agg(e ORDER BY e.id) FROM modulos_edicoes e WHERE e.modulo_id = m.id), '[]'::json) AS historico,
              t.cidade, t.sindicato, t.periodo AS horario,
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

  criarTopico: ({ forum, usuarioId, titulo, texto, imagens }) =>
    um(
      'INSERT INTO forum_topicos (forum, usuario_id, titulo, texto, imagens) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [forum, usuarioId, titulo, texto, JSON.stringify(imagens)]
    ),

  responder: ({ topicoId, usuarioId, texto, imagens }) =>
    um('INSERT INTO forum_respostas (topico_id, usuario_id, texto, imagens) VALUES ($1, $2, $3, $4) RETURNING id', [
      topicoId,
      usuarioId,
      texto,
      JSON.stringify(imagens),
    ]),

  // Imagens do fórum podem ser vistas por qualquer pessoa logada.
  async imagemDoForum(url) {
    const r = await um(
      `SELECT 1 FROM forum_topicos WHERE imagens @> jsonb_build_array($1::text)
       UNION SELECT 1 FROM forum_respostas WHERE imagens @> jsonb_build_array($1::text)`,
      [url]
    );
    return Boolean(r);
  },

  resposta: (id) => um('SELECT * FROM forum_respostas WHERE id = $1', [id]),

  // Apagam e devolvem as imagens que ficaram sem uso, para remover os arquivos.
  async excluirTopico(id) {
    const imgs = await todos(
      `SELECT i AS url FROM forum_topicos, jsonb_array_elements_text(imagens) i WHERE id = $1
       UNION ALL SELECT i FROM forum_respostas, jsonb_array_elements_text(imagens) i WHERE topico_id = $1`,
      [id]
    );
    await q('DELETE FROM forum_topicos WHERE id = $1', [id]);
    return imgs.map((r) => r.url);
  },

  async excluirResposta(id) {
    const r = await um('DELETE FROM forum_respostas WHERE id = $1 RETURNING imagens', [id]);
    return r?.imagens || [];
  },

  // Avisos do perfil da pessoa, com a data em que ela deu ciente (null se ainda não deu).
  avisos: (usuario) =>
    todos(
      `SELECT a.*, c.criado_em AS ciente_em
         FROM avisos a LEFT JOIN avisos_ciente c ON c.aviso_id = a.id AND c.usuario_id = $1
        WHERE a.publico IN ('todos', $2) ORDER BY a.id DESC`,
      [usuario.id, usuario.tipo]
    ),

  // Para o gestor: cada aviso com quem deu ciente (e quando) e quantas pessoas deveriam dar.
  avisosDoGestor: () =>
    todos(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM usuarios u WHERE a.publico = 'todos' OR u.tipo = a.publico) AS total_publico,
              COALESCE((SELECT json_agg(json_build_object('id', u.id, 'nome', u.nome, 'tipo', u.tipo, 'em', c.criado_em)
                                        ORDER BY c.criado_em DESC)
                          FROM avisos_ciente c JOIN usuarios u ON u.id = c.usuario_id
                         WHERE c.aviso_id = a.id), '[]'::json) AS cientes
         FROM avisos a ORDER BY a.id DESC`
    ),

  async darCiente(avisoId, usuario) {
    const r = await um(
      `INSERT INTO avisos_ciente (aviso_id, usuario_id)
         SELECT id, $2 FROM avisos WHERE id = $1 AND publico IN ('todos', $3)
       ON CONFLICT (aviso_id, usuario_id) DO UPDATE SET aviso_id = excluded.aviso_id
       RETURNING criado_em`,
      [avisoId, usuario.id, usuario.tipo]
    );
    return r?.criado_em || null;
  },

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
module.exports.SCHEMA = SCHEMA;
