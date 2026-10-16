'use strict';

const app = document.getElementById('app');
const topoUsuario = document.getElementById('topo-usuario');
const CAMPOS = window.MODULO1_ESPECIALISTA_CAMPOS;
const MAX = 2000;

// ---------- utilidades ----------

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function mascaraCpf(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

function avisar(msg) {
  const el = document.getElementById('aviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 3000);
}

async function api(url, opcoes = {}) {
  const init = { method: opcoes.method || 'GET', headers: {} };
  if (opcoes.form) init.body = opcoes.form;
  else if (opcoes.json) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opcoes.json);
  }
  if (init.body && init.method === 'GET') init.method = 'POST';
  const r = await fetch(url, init);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(dados.erro || 'Algo deu errado.');
    e.status = r.status;
    throw e;
  }
  return dados;
}

function ir(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

function contador(textarea) {
  const c = textarea.parentElement.querySelector('.contador');
  const rot = textarea.parentElement.querySelector('.ok');
  const atualizar = () => {
    if (c) c.textContent = `${textarea.value.length}/${textarea.maxLength}`;
    if (rot) rot.hidden = !textarea.value.trim();
  };
  textarea.addEventListener('input', atualizar);
  atualizar();
}

function formatarData(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function ehImagem(nome) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(nome || '');
}

function blocoAnexo(arquivo, nomeOriginal) {
  if (!arquivo) return '';
  const url = esc(arquivo);
  return `<div class="anexo-atual">Arquivo atual: <a href="${url}" target="_blank" rel="noopener">${esc(nomeOriginal || arquivo)}</a>
    ${ehImagem(arquivo) ? `<img src="${url}" alt="">` : ''}</div>`;
}

// ---------- upload ----------

let config;
function obterConfig() {
  return (config ??= api('/api/config'));
}

// Envia o arquivo e devolve { url, nome }. Na Vercel vai direto para o Vercel Blob.
async function enviarArquivo(arquivo, imagem) {
  if (arquivo.size > 5 * 1024 * 1024) throw new Error('Arquivo maior que 5MB.');
  if (imagem && !arquivo.type.startsWith('image/')) throw new Error('O arquivo precisa ser uma imagem.');
  const { uploadDireto } = await obterConfig();
  if (!uploadDireto) {
    const fd = new FormData();
    fd.set('arquivo', arquivo);
    return api('/api/upload', { method: 'POST', form: fd });
  }
  let nome = arquivo.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');
  if (!/\.\w+$/.test(nome) && arquivo.type.startsWith('image/')) nome += '.' + arquivo.type.split('/')[1];
  const { upload } = await import('/vendor/blob-client.js');
  const blob = await upload(`jea/${nome}`, arquivo, {
    access: 'public',
    handleUploadUrl: '/api/blob',
    clientPayload: imagem ? 'imagem' : '',
  });
  return { url: blob.url, nome: arquivo.name };
}

// ---------- sessão ----------

let estado = { usuario: null, avisos: Promise.resolve([]) };

async function carregarUsuario() {
  try {
    const r = await api('/api/eu');
    estado.usuario = r.usuario;
    return r;
  } catch {
    estado.usuario = null;
    return null;
  }
}

function desenharTopo(conteudo, inicio = '#/') {
  topoUsuario.innerHTML = conteudo || '';
  // O logo JEA leva para a tela principal de quem está logado.
  document.querySelector('.marca').setAttribute('href', inicio);
  const sair = topoUsuario.querySelector('[data-sair]');
  if (sair) sair.onclick = async () => { await api('/api/sair', { method: 'POST' }); ir('#/'); };
  // Destaca no menu a área em que a pessoa está.
  const atual = location.hash.replace(/^#\/?/, '').split('/')[0];
  topoUsuario.querySelectorAll('.menu a').forEach((a) => {
    a.classList.toggle('ativa', a.dataset.area.split(' ').includes(atual));
  });
}

function avatar(foto, classe = '') {
  return foto ? `<img class="avatar ${classe}" src="${esc(foto)}" alt="">` : `<span class="avatar ${classe}"></span>`;
}

function topoDoUsuario(u) {
  desenharTopo(`<nav class="menu">
      <a href="#/painel" data-area="painel turma">Minhas turmas</a>
      <a href="#/material" data-area="material">Material</a>
      <a href="#/avisos" data-area="avisos">Avisos<span class="badge" id="badge-avisos" hidden></span></a>
      <a href="#/forum/geral" data-area="forum">Fórum</a>
      <a href="#/participantes" data-area="participantes">Participantes</a>
      <a href="#/mensagens" data-area="mensagens">Mensagens<span class="badge" id="badge-mensagens" hidden></span></a>
      <a href="#/perguntas" data-area="perguntas">Perguntas</a>
    </nav>
    <div class="usuario">
      <a class="meu-perfil" href="#/perfil" title="Editar meu perfil">${avatar(u.foto)}<span>${esc(u.nome.split(' ')[0])} · ${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'}</span><span class="lapis" aria-hidden="true">✎</span></a>
      <button data-sair>Sair</button>
    </div>`, '#/painel');
  estado.avisos = api('/api/avisos').then((r) => r.avisos).catch(() => []);
  estado.avisos.then(mostrarNaoLidos);
  api('/api/mensagens/nao-lidas').then(({ total }) => mostrarMensagensNaoLidas(total)).catch(() => {});
}

function topoDoAdmin() {
  desenharTopo(`<nav class="menu">
      <a href="#/admin" data-area="admin">Envios</a>
      <a href="#/admin-avisos" data-area="admin-avisos">Avisos</a>
      <a href="#/material" data-area="material">Material</a>
      <a href="#/perguntas" data-area="perguntas">Perguntas<span class="badge" id="badge-perguntas" hidden></span></a>
      <a href="#/forum/geral" data-area="forum">Fórum</a>
      <a href="#/participantes" data-area="participantes">Participantes</a>
    </nav>
    <div class="usuario"><span>Admin</span><button data-sair>Sair</button></div>`, '#/admin');
  api('/api/perguntas').then(({ perguntas }) => mostrarPendentes(perguntas)).catch(() => {});
}

function mostrarMensagensNaoLidas(n) {
  const badge = document.getElementById('badge-mensagens');
  if (!badge) return;
  badge.textContent = n;
  badge.hidden = !n;
}

function mostrarPendentes(perguntas) {
  const badge = document.getElementById('badge-perguntas');
  if (!badge) return;
  const n = perguntas.filter((p) => !p.resposta).length;
  badge.textContent = n;
  badge.hidden = !n;
}

// ---------- avisos (lidos ficam guardados no navegador) ----------

const PUBLICOS = { todos: 'Para todos', especialista: 'Para especialistas', instrutor: 'Para instrutores' };

function chaveLidos() {
  return `jea-avisos-lidos-${estado.usuario?.id || 0}`;
}

function ultimoLido() {
  try { return Number(localStorage.getItem(chaveLidos())) || 0; } catch { return 0; }
}

function marcarLidos(avisos) {
  try { localStorage.setItem(chaveLidos(), String(Math.max(ultimoLido(), ...avisos.map((a) => a.id)))); } catch { /* sem armazenamento */ }
  mostrarNaoLidos(avisos);
}

function mostrarNaoLidos(avisos) {
  const badge = document.getElementById('badge-avisos');
  if (!badge) return;
  const n = avisos.filter((a) => a.id > ultimoLido()).length;
  badge.textContent = n;
  badge.hidden = !n;
}

function cartaoAviso(a, { novo, apagar } = {}) {
  return `<article class="cartao aviso-item ${novo ? 'novo' : ''}">
      <div class="meta">${novo ? '<span class="tag novo">Novo</span> ' : ''}${esc(formatarData(a.criado_em))} · ${PUBLICOS[a.publico] || ''}
        ${apagar ? `<button class="link perigo" data-apagar-aviso="${a.id}">apagar</button>` : ''}</div>
      <h3>${esc(a.titulo)}</h3>
      <div class="mensagem">${esc(a.texto)}</div>
    </article>`;
}

// ---------- telas ----------

async function telaInicio() {
  // Quem já está logado não precisa ver o login de novo.
  const r = await carregarUsuario();
  if (r) return ir(r.usuario ? '#/painel' : '#/cadastro');
  desenharTopo('');
  app.innerHTML = `
    <div class="centro cartao entrada">
      <h1>Bem-vindo ao JEA</h1>
      <p class="sub">Digite seu CPF para entrar. Se for seu primeiro acesso, o cadastro é feito logo em seguida.</p>
      <form id="f">
        <label for="cpf">Seu CPF</label>
        <input id="cpf" class="grande" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required>
        <div class="erro" id="erro"></div>
        <button type="submit" class="largo">Entrar</button>
      </form>
      <p class="rodape-entrada"><a href="#/admin">Acesso admin</a></p>
    </div>`;
  const cpf = document.getElementById('cpf');
  cpf.addEventListener('input', () => (cpf.value = mascaraCpf(cpf.value)));
  cpf.focus();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector('button');
    botao.disabled = true;
    botao.textContent = 'Entrando...';
    try {
      const r = await api('/api/entrar', { json: { cpf: cpf.value } });
      ir(r.primeiroAcesso ? '#/cadastro' : '#/painel');
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  };
}

async function telaCadastro() {
  const r = await carregarUsuario();
  if (!r) return ir('#/');
  if (r.usuario) return ir('#/painel');
  desenharTopo('<div class="usuario"><button data-sair>Sair</button></div>');
  app.innerHTML = `
    <div class="centro cartao" style="max-width:520px">
      <p class="passo">Primeiro acesso</p>
      <h1>Complete seu cadastro</h1>
      <p class="sub">CPF ${esc(mascaraCpf(r.cpf))}. Só precisa fazer isso uma vez.</p>
      <form id="f">
        <label for="nome">Nome completo</label>
        <input id="nome" name="nome" type="text" maxlength="200" autocomplete="name" required>
        <label>Você é</label>
        <div class="opcoes">
          <label><input type="radio" name="tipo" value="especialista" required><span><strong>Especialista</strong><small>Preenche o planejamento e a expedição do agro</small></span></label>
          <label><input type="radio" name="tipo" value="instrutor" required><span><strong>Instrutor</strong><small>Envia texto e imagem em cada módulo</small></span></label>
        </div>
        <label for="foto">Foto do perfil <span class="ajuda">(opcional, até 5MB)</span></label>
        <div class="foto-perfil"><span class="avatar grande" id="previa"></span><input id="foto" name="foto" type="file" accept="image/*"></div>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes"><button type="submit">Concluir cadastro</button></div>
      </form>
    </div>`;
  const f = document.getElementById('f');
  f.nome.focus();
  f.foto.onchange = () => {
    const arq = f.foto.files[0];
    const previa = document.getElementById('previa');
    previa.style.backgroundImage = arq ? `url(${URL.createObjectURL(arq)})` : '';
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const foto = f.foto.files[0];
      if (foto) botao.textContent = 'Enviando foto...';
      await api('/api/cadastro', {
        json: {
          nome: f.nome.value,
          tipo: f.tipo.value,
          foto: foto ? await enviarArquivo(foto, true) : null,
        },
      });
      ir('#/painel');
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Concluir cadastro';
    }
  };
}

async function exigirUsuario() {
  const r = await carregarUsuario();
  if (!r) { ir('#/'); return null; }
  if (!r.usuario) { ir('#/cadastro'); return null; }
  topoDoUsuario(r.usuario);
  return r.usuario;
}

function barraProgresso(n) {
  return `<div class="progresso" title="${n} de 8 módulos enviados"><span style="width:${(n / 8) * 100}%"></span></div>`;
}

async function telaPainel() {
  const u = await exigirUsuario();
  if (!u) return;
  const [{ turmas }, avisos] = await Promise.all([api('/api/turmas'), estado.avisos]);
  const novos = avisos.filter((a) => a.id > ultimoLido());
  app.innerHTML = `
    <div class="cabecalho">
      <div>
        <h1>Olá, ${esc(u.nome.split(' ')[0])}</h1>
        <p class="sub">Aqui ficam suas turmas. Cada turma tem 8 módulos para preencher.</p>
      </div>
      <button id="nova" class="botao-grande">+ Cadastrar nova turma</button>
    </div>
    <div class="cartao form-turma" id="form-turma" hidden>
      <h2>Nova turma</h2>
      <p class="ajuda">Preencha os 3 campos e clique em <strong>Salvar turma</strong>.</p>
      <form id="f">
        <div class="grade">
          <div><label for="cidade">Cidade</label><input id="cidade" name="cidade" type="text" maxlength="200" placeholder="Ex.: Ribeirão Preto" required></div>
          <div><label for="sindicato">Sindicato rural</label><input id="sindicato" name="sindicato" type="text" maxlength="200" placeholder="Ex.: Sindicato Rural de Ribeirão Preto" required></div>
        </div>
        <label>Horário da aula</label>
        <div class="horario">
          <label>Entrada<input id="entrada" type="time" required></label>
          <label>Saída<input id="saida" type="time" required></label>
        </div>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes">
          <button type="submit">Salvar turma</button>
          <button type="button" class="secundario" id="cancelar">Cancelar</button>
        </div>
      </form>
    </div>
    ${novos.length ? `
      <div class="cartao destaque-avisos">
        <h2>${novos.length === 1 ? 'Você tem 1 aviso novo' : `Você tem ${novos.length} avisos novos`}</h2>
        ${novos.slice(0, 2).map((a) => `<p><strong>${esc(a.titulo)}</strong> · <span class="meta">${esc(formatarData(a.criado_em))}</span></p>`).join('')}
        <a class="botao secundario" href="#/avisos">Ler avisos</a>
      </div>` : ''}
    <h2>Minhas turmas ${turmas.length ? `<span class="meta">(${turmas.length})</span>` : ''}</h2>
    <div class="lista-turmas">
      ${turmas.map((t) => `
        <a class="cartao turma" href="#/turma/${t.id}/${Math.min(8, t.modulos_enviados + 1)}">
          <h3>${esc(t.cidade)}</h3>
          <div class="meta">${esc(t.sindicato)}</div>
          <div class="meta">Horário: ${esc(t.horario)}</div>
          ${barraProgresso(t.modulos_enviados)}
          <div class="meta">${t.modulos_enviados} de 8 módulos enviados${t.feedbacks ? ` · <strong class="verde">${t.feedbacks} feedback${t.feedbacks === 1 ? '' : 's'}</strong>` : ''}</div>
          <span class="abrir">Abrir turma →</span>
        </a>`).join('')}
    </div>
    ${turmas.length ? '' : '<div class="vazio">Você ainda não tem turmas. Clique em <strong>+ Cadastrar nova turma</strong> para começar.</div>'}`;

  const caixa = document.getElementById('form-turma');
  const nova = document.getElementById('nova');
  const f = document.getElementById('f');
  const abrir = (sim) => {
    caixa.hidden = !sim;
    nova.hidden = sim;
    if (sim) f.cidade.focus();
  };
  nova.onclick = () => abrir(true);
  document.getElementById('cancelar').onclick = () => { f.reset(); abrir(false); };
  if (!turmas.length) abrir(true);
  // Clicar em qualquer parte do campo abre o relógio do navegador.
  f.querySelectorAll('input[type=time]').forEach((i) => (i.onclick = () => i.showPicker?.()));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      document.getElementById('erro').textContent = '';
      if (f.saida.value <= f.entrada.value) throw new Error('O horário de saída precisa ser depois da entrada.');
      const dados = Object.fromEntries(new FormData(f));
      dados.horario = `${f.entrada.value} às ${f.saida.value}`;
      const { turma } = await api('/api/turmas', { json: dados });
      avisar('Turma cadastrada. Agora preencha o módulo 1.');
      ir(`#/turma/${turma.id}/1`);
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
    }
  };
}

function campoTexto({ chave, rotulo, ajuda, linha, max }, valor) {
  const id = `c_${chave}`;
  const entrada = linha
    ? `<input id="${id}" name="${chave}" type="text" maxlength="${max}" value="${esc(valor)}">`
    : `<textarea id="${id}" name="${chave}" maxlength="${max}">${esc(valor)}</textarea><div class="contador"></div>`;
  return `<div>
    <label for="${id}">${esc(rotulo)}<span class="ok" hidden>✓</span></label>
    ${ajuda ? `<p class="ajuda">${esc(ajuda)}</p>` : ''}
    ${entrada}
  </div>`;
}

function formModulo1Especialista(m) {
  const dados = m?.dados || {};
  let html = '';
  let aberto = false;
  for (const c of CAMPOS) {
    if (c.grupo) {
      if (aberto) html += '</div>';
      html += `<div class="grupo"><h2 style="margin-top:0">${esc(c.grupo)}</h2>`;
      html += c.ajuda ? `<p class="ajuda">${esc(c.ajuda)}</p>` : '';
      if (c.grupo === 'Itens que devem constar no Planejamento') {
        html += '<p class="ajuda">Preencha cada item para estruturar formalmente o Planejamento da sua turma.</p>';
      }
      aberto = true;
      continue;
    }
    html += campoTexto(c, dados[c.chave]);
  }
  html += `<div>
      <label for="anexo">Foto da expedição</label>
      <p class="ajuda">Selecionar foto (até 5MB)</p>
      <input id="anexo" name="anexo" type="file" accept="image/*">
      ${blocoAnexo(m?.anexo, m?.anexo_nome)}
    </div>`;
  if (aberto) html += '</div>';
  return html;
}

function formModuloSimples(m, instrutor) {
  return `
    ${campoTexto({ chave: 'texto', rotulo: 'Texto', max: MAX }, m?.texto)}
    <div>
      <label for="anexo">${instrutor ? 'Imagem' : 'Anexo'}</label>
      <p class="ajuda">${instrutor ? 'Selecionar imagem (até 5MB)' : 'Selecionar arquivo (até 5MB)'}</p>
      <input id="anexo" name="anexo" type="file" ${instrutor ? 'accept="image/*"' : ''}>
      ${blocoAnexo(m?.anexo, m?.anexo_nome)}
    </div>`;
}

async function telaTurma(turmaId, numero) {
  const u = await exigirUsuario();
  if (!u) return;
  numero = Math.min(8, Math.max(1, Number(numero) || 1));
  let r;
  try {
    r = await api(`/api/turmas/${turmaId}`);
  } catch (err) {
    avisar(err.message);
    return ir('#/painel');
  }
  const { turma, modulos } = r;
  const m = modulos.find((x) => x.numero === numero);
  const instrutor = u.tipo === 'instrutor';
  const especial = !instrutor && numero === 1;

  app.innerHTML = `
    <p><a href="#/painel">← Minhas turmas</a></p>
    <h1>Turma de ${esc(turma.cidade)}</h1>
    <p class="sub">${esc(turma.sindicato)} · Horário: ${esc(turma.horario)}</p>
    <div class="resumo-turma">
      ${barraProgresso(modulos.length)}
      <span class="meta">${modulos.length} de 8 módulos enviados</span>
    </div>
    <p class="ajuda">Escolha o módulo, preencha e clique em <strong>Enviar módulo</strong>. Você pode voltar e alterar quando quiser.</p>
    <nav class="modulos">
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
        const x = modulos.find((y) => y.numero === n);
        const estadoMod = x?.feedback ? 'Com feedback' : x ? 'Enviado' : 'Pendente';
        return `<a href="#/turma/${turma.id}/${n}" class="${n === numero ? 'ativa' : ''} ${x ? 'enviado' : ''} ${x?.feedback ? 'com-feedback' : ''}">
          <strong>Módulo ${n}</strong><small>${x ? '✓ ' : ''}${estadoMod}</small></a>`;
      }).join('')}
    </nav>
    <div class="cartao">
      <h2 style="margin-top:0">Módulo ${numero}${especial ? ' · Planejamento' : ''}</h2>
      ${m?.feedback ? `<div class="feedback"><strong>Feedback do admin (${esc(formatarData(m.feedback_em))}):</strong>\n${esc(m.feedback)}</div>` : ''}
      <p class="meta">${m ? `Enviado em ${esc(formatarData(m.atualizado_em))}` : 'Ainda não enviado.'}</p>
      <form id="f">
        ${especial ? formModulo1Especialista(m) : formModuloSimples(m, instrutor)}
        <div class="erro" id="erro"></div>
        <div class="linha-botoes">
          <button type="submit">${m ? 'Salvar alterações' : 'Enviar módulo'}</button>
          ${m?.anexo ? '<label style="margin:0;font-weight:400"><input type="checkbox" name="removerAnexo" value="1"> remover arquivo atual</label>' : ''}
        </div>
      </form>
    </div>
    <div class="navegacao-modulos">
      ${numero > 1 ? `<a class="botao secundario" href="#/turma/${turma.id}/${numero - 1}">← Módulo ${numero - 1}</a>` : '<span></span>'}
      ${numero < 8 ? `<a class="botao secundario" href="#/turma/${turma.id}/${numero + 1}">Módulo ${numero + 1} →</a>` : ''}
    </div>
    <div class="zona-perigo">
      <button class="link perigo" id="excluir-turma">Excluir esta turma</button>
    </div>`;

  document.getElementById('excluir-turma').onclick = async () => {
    if (!confirm('Excluir esta turma e tudo o que foi enviado nos módulos dela?')) return;
    try {
      await api(`/api/turmas/${turma.id}`, { method: 'DELETE' });
      avisar('Turma excluída.');
      ir('#/painel');
    } catch (err) {
      avisar(err.message);
    }
  };

  const f = document.getElementById('f');
  f.querySelectorAll('textarea').forEach(contador);
  f.querySelectorAll('input[type=text]').forEach((i) => {
    const ok = i.parentElement.querySelector('.ok');
    const atualizar = () => ok && (ok.hidden = !i.value.trim());
    i.addEventListener('input', atualizar);
    atualizar();
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const corpo = {};
      for (const el of f.querySelectorAll('input[type=text], textarea')) corpo[el.name] = el.value;
      corpo.removerAnexo = Boolean(f.removerAnexo?.checked);
      const arquivo = f.anexo.files[0];
      if (arquivo) {
        botao.textContent = 'Enviando arquivo...';
        corpo.anexo = await enviarArquivo(arquivo, instrutor || especial);
      }
      await api(`/api/turmas/${turma.id}/modulos/${numero}`, { json: corpo });
      avisar(`Módulo ${numero} salvo.`);
      telaTurma(turma.id, numero);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = m ? 'Salvar alterações' : 'Enviar módulo';
    }
  };
}

// ---------- admin ----------

function telaAdminLogin(erro) {
  desenharTopo('');
  app.innerHTML = `
    <div class="centro cartao">
      <h1>Acesso admin</h1>
      <form id="f">
        <label for="senha">Senha</label>
        <input id="senha" type="password" required>
        <div class="erro" id="erro">${esc(erro || '')}</div>
        <div class="linha-botoes">
          <button type="submit">Entrar</button>
          <a class="botao secundario" href="#/">Voltar</a>
        </div>
      </form>
    </div>`;
  document.getElementById('senha').focus();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/entrar', { json: { senha: document.getElementById('senha').value } });
      telaAdmin();
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
    }
  };
}

// Caixa de feedback que fica à direita dos envios.
function caixaFeedback(ajuda) {
  return `<aside class="coluna-feedback">
      <div class="cartao">
        <h2 style="margin-top:0">Enviar feedback</h2>
        <p class="ajuda">${ajuda}</p>
        <p class="qtd-selecionados" id="qtd">Nenhum envio marcado</p>
        <textarea id="texto-feedback" maxlength="${MAX}" placeholder="Escreva o feedback"></textarea>
        <div class="contador"></div>
        <button id="enviar" class="largo">Enviar feedback</button>
      </div>
    </aside>`;
}

function mostrarSelecionados(selecionados) {
  const n = selecionados.size;
  const el = document.getElementById('qtd');
  el.textContent = n ? `${n} envio${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'}` : 'Nenhum envio marcado';
  el.classList.toggle('tem', n > 0);
  document.getElementById('enviar').textContent = n > 1 ? `Enviar feedback aos ${n} envios` : 'Enviar feedback';
}

function ligarEnvioFeedback(selecionados, recarregar) {
  contador(document.getElementById('texto-feedback'));
  document.getElementById('enviar').onclick = async (ev) => {
    const texto = document.getElementById('texto-feedback').value.trim();
    if (!selecionados.size) return avisar('Marque ao menos um envio.');
    if (!texto) return avisar('Escreva o feedback.');
    ev.target.disabled = true;
    try {
      const r = await api('/api/admin/feedback', { json: { ids: [...selecionados], feedback: texto } });
      avisar(`Feedback enviado para ${r.atualizados} envio(s).`);
      recarregar();
    } catch (err) {
      avisar(err.message);
      ev.target.disabled = false;
    }
  };
}

async function telaAdminUsuario(id) {
  let dados;
  try {
    dados = await api(`/api/admin/usuarios/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 401) return telaAdminLogin();
    avisar(err.message);
    return ir('#/admin');
  }
  topoDoAdmin();
  app.classList.add('largo');
  const { usuario: u, turmas, envios } = dados;
  const selecionados = new Set();
  const semFeedback = envios.filter((e) => !e.feedback).length;

  const blocoEnvio = (e) => `
    <div class="cartao envio ${e.feedback ? '' : 'pendente'}">
      <div class="envio-topo">
        <label class="marcar"><input type="checkbox" data-id="${e.id}"> <strong>Módulo ${e.numero}</strong></label>
        <span class="meta">Enviado em ${esc(formatarData(e.atualizado_em))}</span>
        <span class="tag ${e.feedback ? 'sim' : 'novo'}">${e.feedback ? 'Com feedback' : 'Sem feedback'}</span>
        <button class="link" data-so="${e.id}">dar feedback só neste</button>
      </div>
      <div class="detalhe">${detalheEnvio(e)}</div>
    </div>`;

  app.innerHTML = `
    <p><a href="#/admin">← Painel admin</a></p>
    <div class="cartao perfil-publico">
      ${avatar(u.foto, 'enorme')}
      <div>
        <h1>${esc(u.nome)}</h1>
        <span class="tag">${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'}</span>
        <p class="meta" style="margin:8px 0 0">CPF ${esc(mascaraCpf(u.cpf))} · cadastro em ${esc(formatarData(u.criado_em))}</p>
        <p class="meta" style="margin:0">${turmas.length} turma${turmas.length === 1 ? '' : 's'} · ${envios.length} módulo${envios.length === 1 ? '' : 's'} enviado${envios.length === 1 ? '' : 's'} · ${semFeedback} sem feedback</p>
        ${linksRedes(u.redes)}
      </div>
    </div>
    <div class="duas-colunas">
      <div class="coluna-envios">
        ${semFeedback ? '<p class="linha-botoes" style="margin-top:0"><button class="secundario" id="marcar-sem">Marcar todos sem feedback</button></p>' : ''}
        ${turmas.map((t) => {
          const daTurma = envios.filter((e) => e.turma_id === t.id).sort((a, b) => a.numero - b.numero);
          const pendentes = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !daTurma.some((e) => e.numero === n));
          return `<section class="turma-ficha">
            <h2>Turma de ${esc(t.cidade)} <span class="meta">${esc(t.sindicato)} · ${esc(t.horario)}</span></h2>
            ${barraProgresso(daTurma.length)}
            <p class="meta">${daTurma.length} de 8 módulos enviados${pendentes.length ? ` · pendentes: ${pendentes.join(', ')}` : ''}</p>
            ${daTurma.map(blocoEnvio).join('') || '<div class="vazio">Nenhum módulo enviado nesta turma.</div>'}
          </section>`;
        }).join('') || '<div class="vazio">Esta pessoa ainda não cadastrou turmas.</div>'}
      </div>
      ${caixaFeedback('Marque os módulos ao lado (ou clique em "dar feedback só neste") e escreva aqui.')}
    </div>`;

  const marcar = (ids, sozinho) => {
    if (sozinho) selecionados.clear();
    ids.forEach((i) => selecionados.add(i));
    app.querySelectorAll('[data-id]').forEach((c) => (c.checked = selecionados.has(Number(c.dataset.id))));
    mostrarSelecionados(selecionados);
  };
  app.onchange = (ev) => {
    const id = Number(ev.target.dataset?.id);
    if (!id) return;
    ev.target.checked ? selecionados.add(id) : selecionados.delete(id);
    mostrarSelecionados(selecionados);
  };
  app.onclick = (ev) => {
    const so = ev.target.closest('[data-so]');
    if (so) {
      const e = envios.find((x) => x.id === Number(so.dataset.so));
      marcar([e.id], true);
      const t = document.getElementById('texto-feedback');
      if (!t.value && e.feedback) t.value = e.feedback;
      t.dispatchEvent(new Event('input'));
      t.focus();
    }
    if (ev.target.id === 'marcar-sem') marcar(envios.filter((e) => !e.feedback).map((e) => e.id), true);
  };
  ligarEnvioFeedback(selecionados, () => telaAdminUsuario(id));
}

function detalheEnvio(e) {
  let itens = [];
  if (e.dados) {
    let grupo = '';
    for (const c of CAMPOS) {
      if (c.grupo) grupo = c.grupo;
      else itens.push([grupo === 'Expedição do Agro' ? `Expedição · ${c.rotulo}` : c.rotulo, e.dados[c.chave]]);
    }
  } else {
    itens.push(['Texto', e.texto]);
  }
  return `<dl>${itens.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v) || '<span class="meta">(vazio)</span>'}</dd>`).join('')}</dl>
    ${blocoAnexo(e.anexo, e.anexo_nome)}
    ${e.feedback ? `<div class="feedback" style="margin-top:12px"><strong>Feedback enviado (${esc(formatarData(e.feedback_em))}):</strong>\n${esc(e.feedback)}</div>` : ''}`;
}

async function telaAdmin() {
  let dados;
  try {
    dados = await api('/api/admin/envios');
  } catch (err) {
    if (err.status === 401) return telaAdminLogin();
    return telaAdminLogin(err.message);
  }
  topoDoAdmin();
  app.classList.add('largo');
  const { envios, usuarios } = dados;
  const filtro = { tipo: '', modulo: '', feedback: '', busca: '' };
  const selecionados = new Set();
  const abertos = new Set();

  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>Painel admin</h1><p class="sub">Veja os envios e dê feedback para vários de uma vez.</p></div>
      <a class="botao-grande" href="#/admin-avisos">+ Enviar aviso</a>
    </div>
    <div class="numeros">
      <div class="cartao"><strong>${usuarios.length}</strong><span>cadastrados</span></div>
      <div class="cartao"><strong>${envios.length}</strong><span>módulos enviados</span></div>
      <div class="cartao"><strong>${envios.filter((e) => !e.feedback).length}</strong><span>aguardando feedback</span></div>
    </div>
    <div class="duas-colunas">
    <div class="coluna-envios">
    <div class="filtros">
      <input id="busca" type="text" placeholder="Buscar por nome, CPF, cidade, sindicato...">
      <select id="tipo"><option value="">Todos os perfis</option><option value="especialista">Especialistas</option><option value="instrutor">Instrutores</option></select>
      <select id="modulo"><option value="">Todos os módulos</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">Módulo ${n}</option>`).join('')}</select>
      <select id="feedback"><option value="">Com e sem feedback</option><option value="nao">Sem feedback</option><option value="sim">Com feedback</option></select>
    </div>
    <h2>Envios</h2>
    <div class="tabela"><table>
      <thead><tr>
        <th><input type="checkbox" id="todos" title="Selecionar todos os visíveis"></th>
        <th>Nome</th><th>Turma</th><th>Módulo</th><th>Enviado em</th><th>Feedback</th><th></th>
      </tr></thead>
      <tbody id="corpo"></tbody>
    </table></div>
    </div>
    ${caixaFeedback('Marque os envios na tabela ao lado e escreva aqui. O mesmo feedback vai para todos os marcados.')}
    </div>
    <h2>Cadastrados</h2>
    <p class="ajuda">Clique no nome para abrir a ficha da pessoa, com todos os envios.</p>
    <div class="tabela"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Perfil</th><th>Turmas</th><th>Cadastro</th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr><td><a href="#/admin/usuario/${u.id}"><strong>${esc(u.nome)}</strong></a></td><td>${esc(mascaraCpf(u.cpf))}</td><td>${esc(u.tipo)}</td><td>${u.turmas}</td><td>${esc(formatarData(u.criado_em))}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Ninguém cadastrado ainda.</td></tr>'}</tbody>
    </table></div>`;

  const corpo = document.getElementById('corpo');
  const visiveis = () => envios.filter((e) => {
    if (filtro.tipo && e.tipo !== filtro.tipo) return false;
    if (filtro.modulo && e.numero !== Number(filtro.modulo)) return false;
    if (filtro.feedback === 'sim' && !e.feedback) return false;
    if (filtro.feedback === 'nao' && e.feedback) return false;
    if (filtro.busca) {
      const alvo = `${e.nome} ${e.cpf} ${e.cidade} ${e.sindicato}`.toLowerCase();
      if (!alvo.includes(filtro.busca.toLowerCase().replace(/[.-]/g, '')) && !alvo.includes(filtro.busca.toLowerCase())) return false;
    }
    return true;
  });

  function desenhar() {
    const lista = visiveis();
    corpo.innerHTML = lista.map((e) => `
      <tr>
        <td><input type="checkbox" data-id="${e.id}" ${selecionados.has(e.id) ? 'checked' : ''}></td>
        <td><a href="#/admin/usuario/${e.usuario_id}"><strong>${esc(e.nome)}</strong></a><div class="meta">${e.tipo === 'especialista' ? 'Especialista' : 'Instrutor'}</div></td>
        <td>${esc(e.cidade)}<div class="meta">${esc(e.sindicato)} · ${esc(e.horario)}</div></td>
        <td>${e.numero}</td>
        <td>${esc(formatarData(e.atualizado_em))}</td>
        <td><span class="tag ${e.feedback ? 'sim' : ''}">${e.feedback ? 'sim' : 'não'}</span></td>
        <td><button class="link" data-ver="${e.id}">${abertos.has(e.id) ? 'fechar' : 'ver'}</button></td>
      </tr>
      ${abertos.has(e.id) ? `<tr class="detalhe"><td></td><td colspan="6">${detalheEnvio(e)}</td></tr>` : ''}`).join('')
      || '<tr><td colspan="7" class="meta">Nenhum envio encontrado.</td></tr>';
    const todos = document.getElementById('todos');
    todos.checked = lista.length > 0 && lista.every((e) => selecionados.has(e.id));
    mostrarSelecionados(selecionados);
  }

  corpo.onclick = (ev) => {
    const ver = ev.target.closest('[data-ver]');
    if (ver) {
      const id = Number(ver.dataset.ver);
      abertos.has(id) ? abertos.delete(id) : abertos.add(id);
      desenhar();
    }
  };
  corpo.onchange = (ev) => {
    const id = Number(ev.target.dataset.id);
    if (!id) return;
    ev.target.checked ? selecionados.add(id) : selecionados.delete(id);
    desenhar();
  };
  document.getElementById('todos').onchange = (ev) => {
    for (const e of visiveis()) ev.target.checked ? selecionados.add(e.id) : selecionados.delete(e.id);
    desenhar();
  };
  for (const k of ['tipo', 'modulo', 'feedback']) {
    document.getElementById(k).onchange = (ev) => { filtro[k] = ev.target.value; desenhar(); };
  }
  document.getElementById('busca').oninput = (ev) => { filtro.busca = ev.target.value.trim(); desenhar(); };
  ligarEnvioFeedback(selecionados, telaAdmin);
  desenhar();
}

// ---------- perfil ----------

const REDES = [
  { chave: 'instagram', nome: 'Instagram', exemplo: 'instagram.com/seuperfil' },
  { chave: 'facebook', nome: 'Facebook', exemplo: 'facebook.com/seuperfil' },
  { chave: 'linkedin', nome: 'LinkedIn', exemplo: 'linkedin.com/in/seuperfil' },
  { chave: 'youtube', nome: 'YouTube', exemplo: 'youtube.com/@seucanal' },
  { chave: 'site', nome: 'Site', exemplo: 'www.seusite.com.br' },
];

function linksRedes(redes) {
  const itens = REDES.filter((r) => redes?.[r.chave]);
  if (!itens.length) return '';
  return `<div class="redes">${itens.map((r) => `<a class="botao secundario" href="${esc(redes[r.chave])}" target="_blank" rel="noopener nofollow">${r.nome}</a>`).join('')}</div>`;
}

async function telaPerfil() {
  const u = await exigirUsuario();
  if (!u) return;
  const redes = u.redes || {};
  app.innerHTML = `
    <p><a href="#/painel">← Minhas turmas</a></p>
    <h1>Meu perfil</h1>
    <p class="sub">Atualize seu nome, sua foto e os links das suas redes sociais. Eles aparecem para os outros participantes no fórum.</p>
    <form id="f" class="cartao">
      <label style="margin-top:0">Foto do perfil <span class="ajuda">(até 5MB)</span></label>
      <div class="foto-perfil">
        <span class="avatar grande" id="previa" style="${u.foto ? `background-image:url('${esc(u.foto)}')` : ''}"></span>
        <div style="flex:1">
          <input id="foto" name="foto" type="file" accept="image/*">
          ${u.foto ? '<label class="remover-foto"><input type="checkbox" name="removerFoto"> remover foto atual</label>' : ''}
        </div>
      </div>
      <label for="nome">Nome completo</label>
      <input id="nome" name="nome" type="text" maxlength="200" value="${esc(u.nome)}" required>
      <label>Perfil</label>
      <p class="meta" style="margin:0">${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'} · CPF ${esc(mascaraCpf(u.cpf))}</p>
      <h2>Redes sociais <span class="ajuda">(opcional)</span></h2>
      <p class="ajuda">Cole o link do seu perfil. Deixe em branco o que não usa.</p>
      <div class="grade">
        ${REDES.map((r) => `<div><label for="r_${r.chave}">${r.nome}</label>
          <input id="r_${r.chave}" name="${r.chave}" type="text" inputmode="url" maxlength="300" placeholder="${r.exemplo}" value="${esc(redes[r.chave] || '')}"></div>`).join('')}
      </div>
      <div class="erro" id="erro"></div>
      <div class="linha-botoes">
        <button type="submit">Salvar perfil</button>
        <a class="botao secundario" href="#/perfil/${u.id}">Ver como os outros veem</a>
      </div>
    </form>`;
  const f = document.getElementById('f');
  f.foto.onchange = () => {
    const arq = f.foto.files[0];
    if (arq) document.getElementById('previa').style.backgroundImage = `url(${URL.createObjectURL(arq)})`;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      const arq = f.foto.files[0];
      if (arq) botao.textContent = 'Enviando foto...';
      const corpo = {
        nome: f.nome.value,
        foto: arq ? await enviarArquivo(arq, true) : null,
        removerFoto: Boolean(f.removerFoto?.checked),
        redes: Object.fromEntries(REDES.map((r) => [r.chave, f[r.chave].value])),
      };
      await api('/api/perfil', { json: corpo });
      avisar('Perfil salvo.');
      telaPerfil();
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Salvar perfil';
    }
  };
}

const NOME_FORUM = { geral: 'Geral', especialista: 'Especialistas', instrutor: 'Instrutores' };
const nomeTipo = (t) => (t === 'especialista' ? 'Especialista' : 'Instrutor');

async function telaVerPerfil(id) {
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let dados;
  try {
    dados = await api(`/api/perfil/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 401) return ir('#/');
    avisar(err.message);
    return ir('#/participantes');
  }
  if (minhaRota !== rotaAtual) return;
  const { perfil, turmas, postagens } = dados;
  const meu = leitor.usuario?.id === perfil.id;
  app.innerHTML = `
    <p><a href="#/participantes">← Participantes</a></p>
    <div class="cartao perfil-publico">
      ${avatar(perfil.foto, 'enorme')}
      <div>
        <h1>${esc(perfil.nome)}</h1>
        <span class="tag">${nomeTipo(perfil.tipo)}</span>
        ${linksRedes(perfil.redes) || '<p class="meta">Nenhuma rede social informada.</p>'}
        <p class="linha-botoes">
          ${meu ? '<a class="botao" href="#/perfil">Editar meu perfil</a>' : ''}
          ${!meu && leitor.usuario ? `<a class="botao" href="#/mensagens/${perfil.id}">Enviar mensagem</a>` : ''}
          ${leitor.admin ? `<a class="botao secundario" href="#/admin/usuario/${perfil.id}">Ver envios (admin)</a>` : ''}
        </p>
      </div>
    </div>
    <h2>Turmas <span class="meta">(${turmas.length})</span></h2>
    <div class="lista-turmas">
      ${turmas.map((t) => `
        <div class="cartao turma">
          <h3>${esc(t.cidade)}</h3>
          <div class="meta">${esc(t.sindicato)}</div>
          <div class="meta">Horário: ${esc(t.horario)}</div>
          ${barraProgresso(t.modulos_enviados)}
          <div class="meta">${t.modulos_enviados} de 8 módulos enviados</div>
        </div>`).join('')}
    </div>
    ${turmas.length ? '' : '<div class="vazio">Nenhuma turma cadastrada.</div>'}
    <h2>Postagens no fórum <span class="meta">(${postagens.length})</span></h2>
    ${postagens.map((p) => `
      <a class="cartao topico" href="#/forum/topico/${p.topico_id}">
        <div class="meta">${p.tipo === 'topico' ? 'Criou o tópico' : 'Respondeu em'} · Fórum ${NOME_FORUM[p.forum] || ''} · ${esc(formatarData(p.criado_em))}</div>
        <h3>${esc(p.titulo)}</h3>
        ${p.texto ? `<div class="meta trecho">${esc(p.texto.slice(0, 200))}${p.texto.length > 200 ? '…' : ''}</div>` : ''}
      </a>`).join('') || '<div class="vazio">Nenhuma postagem no fórum.</div>'}`;
}

// ---------- participantes ----------

async function telaParticipantes() {
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let participantes;
  try {
    ({ participantes } = await api('/api/participantes'));
  } catch (err) {
    if (err.status === 401) return ir('#/');
    throw err;
  }
  if (minhaRota !== rotaAtual) return;
  const contar = (t) => participantes.filter((p) => p.tipo === t).length;
  const filtro = { tipo: '', busca: '' };
  app.innerHTML = `
    <h1>Participantes</h1>
    <p class="sub">Especialistas e instrutores cadastrados. Abra o perfil para ver as turmas e as postagens no fórum${leitor.usuario ? ', ou envie uma mensagem' : ''}.</p>
    <nav class="abas" id="abas">
      <a href="#" data-tipo="" class="ativa">Todos (${participantes.length})</a>
      <a href="#" data-tipo="especialista">Especialistas (${contar('especialista')})</a>
      <a href="#" data-tipo="instrutor">Instrutores (${contar('instrutor')})</a>
    </nav>
    <input id="busca" type="text" placeholder="Buscar pelo nome">
    <div class="lista-participantes" id="lista"></div>`;
  const lista = document.getElementById('lista');
  const desenhar = () => {
    const termo = filtro.busca.toLowerCase();
    const itens = participantes.filter((p) => (!filtro.tipo || p.tipo === filtro.tipo) && p.nome.toLowerCase().includes(termo));
    lista.innerHTML = itens.map((p) => `
      <div class="cartao participante">
        ${avatar(p.foto, 'grande')}
        <div class="info">
          <h3>${esc(p.nome)}</h3>
          <span class="tag">${nomeTipo(p.tipo)}</span>
          <div class="meta">${p.turmas} turma${p.turmas === 1 ? '' : 's'}</div>
        </div>
        <div class="acoes">
          <a class="botao secundario" href="#/perfil/${p.id}">Ver perfil</a>
          ${leitor.usuario && leitor.usuario.id !== p.id ? `<a class="botao" href="#/mensagens/${p.id}">Mensagem</a>` : ''}
        </div>
      </div>`).join('') || '<div class="vazio">Ninguém encontrado.</div>';
  };
  desenhar();
  document.getElementById('abas').onclick = (ev) => {
    const a = ev.target.closest('[data-tipo]');
    if (!a) return;
    ev.preventDefault();
    filtro.tipo = a.dataset.tipo;
    document.querySelectorAll('#abas a').forEach((x) => x.classList.toggle('ativa', x === a));
    desenhar();
  };
  document.getElementById('busca').oninput = (ev) => { filtro.busca = ev.target.value.trim(); desenhar(); };
}

// ---------- mensagens ----------

async function telaMensagens() {
  const u = await exigirUsuario();
  if (!u) return;
  const { conversas } = await api('/api/mensagens');
  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>Mensagens</h1><p class="sub">Converse com outros especialistas e instrutores.</p></div>
      <a class="botao-grande" href="#/participantes">+ Nova mensagem</a>
    </div>
    ${conversas.map((c) => `
      <a class="cartao conversa ${c.nao_lidas ? 'nova' : ''}" href="#/mensagens/${c.id}">
        ${avatar(c.foto, 'grande')}
        <div class="info">
          <h3>${esc(c.nome)} <span class="tag">${nomeTipo(c.tipo)}</span>${c.nao_lidas ? ` <span class="badge">${c.nao_lidas}</span>` : ''}</h3>
          <div class="meta trecho">${c.de_id === u.id ? 'Você: ' : ''}${esc(c.texto.slice(0, 120))}</div>
        </div>
        <span class="meta">${esc(formatarData(c.criado_em))}</span>
      </a>`).join('') || '<div class="vazio">Nenhuma conversa ainda. Clique em <strong>+ Nova mensagem</strong> para escolher alguém.</div>'}`;
}

async function telaConversa(id) {
  const u = await exigirUsuario();
  if (!u) return;
  let dados;
  try {
    dados = await api(`/api/mensagens/${encodeURIComponent(id)}`);
  } catch (err) {
    avisar(err.message);
    return ir('#/mensagens');
  }
  const { outro, mensagens } = dados;
  api('/api/mensagens/nao-lidas').then(({ total }) => mostrarMensagensNaoLidas(total)).catch(() => {});
  app.innerHTML = `
    <p><a href="#/mensagens">← Mensagens</a></p>
    <div class="cabecalho-conversa">
      ${avatar(outro.foto, 'grande')}
      <div><h1><a href="#/perfil/${outro.id}">${esc(outro.nome)}</a></h1><span class="tag">${nomeTipo(outro.tipo)}</span></div>
    </div>
    <div class="cartao chat" id="chat">
      ${mensagens.map((m) => `
        <div class="bolha ${m.de_id === u.id ? 'minha' : ''}">
          <div class="mensagem">${esc(m.texto)}</div>
          <div class="hora">${esc(formatarData(m.criado_em))}</div>
        </div>`).join('') || `<p class="meta" style="text-align:center">Escreva a primeira mensagem para ${esc(outro.nome.split(' ')[0])}.</p>`}
    </div>
    <form id="f" class="enviar-mensagem">
      <textarea id="texto" name="texto" maxlength="${MAX}" placeholder="Escreva sua mensagem" required></textarea>
      <button type="submit">Enviar</button>
    </form>`;
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
  const f = document.getElementById('f');
  f.texto.focus();
  // Enter envia; Shift+Enter quebra a linha.
  f.texto.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      f.requestSubmit();
    }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button');
    if (botao.disabled || !f.texto.value.trim()) return;
    botao.disabled = true;
    try {
      await api(`/api/mensagens/${outro.id}`, { json: { texto: f.texto.value } });
      telaConversa(outro.id);
    } catch (err) {
      avisar(err.message);
      botao.disabled = false;
    }
  };
}

// ---------- material ----------

const CATEGORIAS = [
  { chave: 'geral', nome: 'Material geral', desc: 'Para todos.' },
  { chave: 'especialista', nome: 'Material do especialista', desc: 'Instrutores também podem ver.' },
  { chave: 'instrutor', nome: 'Material do instrutor', desc: 'Especialistas também podem ver.' },
];

function tipoDeLink(url) {
  if (/drive\.google|docs\.google/.test(url)) return 'Google Drive';
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube';
  if (/\.pdf($|\?)/i.test(url)) return 'PDF';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

async function telaMaterial() {
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let dados;
  try {
    dados = await api('/api/materiais');
  } catch (err) {
    if (err.status === 401) return ir('#/');
    throw err;
  }
  if (minhaRota !== rotaAtual) return;
  const { materiais, admin } = dados;
  app.innerHTML = `
    <h1>Material</h1>
    <p class="sub">Cartilhas, arquivos do Google Drive e outros materiais de apoio. ${admin ? 'Só você (admin) pode adicionar ou apagar.' : 'Clique em <strong>Abrir</strong> para ver o material.'}</p>
    ${admin ? `
      <details class="cartao novo-topico" ${materiais.length ? '' : 'open'}>
        <summary>+ Adicionar material</summary>
        <form id="f">
          <label for="titulo">Nome do material</label>
          <input id="titulo" name="titulo" type="text" maxlength="200" placeholder="Ex.: Cartilha do módulo 1" required>
          <label for="url">Link</label>
          <input id="url" name="url" type="text" inputmode="url" maxlength="2000" placeholder="Cole aqui o link do Google Drive, PDF, vídeo..." required>
          <label for="descricao">Descrição <span class="ajuda">(opcional)</span></label>
          <input id="descricao" name="descricao" type="text" maxlength="1000">
          <label>Categoria</label>
          <div class="opcoes">
            ${CATEGORIAS.map((c, i) => `<label><input type="radio" name="categoria" value="${c.chave}" ${i ? '' : 'checked'}>${c.nome.replace('Material ', '').replace(/^./, (l) => l.toUpperCase())}</label>`).join('')}
          </div>
          <p class="ajuda" style="margin-top:8px">Confira se o link do Google Drive está compartilhado como "Qualquer pessoa com o link".</p>
          <div class="erro" id="erro"></div>
          <div class="linha-botoes"><button type="submit">Adicionar</button></div>
        </form>
      </details>` : ''}
    <nav class="abas" id="filtro">
      <a href="#" data-cat="" class="ativa">Todos (${materiais.length})</a>
      ${CATEGORIAS.map((c) => `<a href="#" data-cat="${c.chave}">${c.nome.replace('Material ', '').replace(/^./, (l) => l.toUpperCase())} (${materiais.filter((m) => m.categoria === c.chave).length})</a>`).join('')}
    </nav>
    <div id="lista"></div>`;

  const lista = document.getElementById('lista');
  const desenhar = (cat) => {
    lista.innerHTML = CATEGORIAS.filter((c) => !cat || c.chave === cat).map((c) => {
      const itens = materiais.filter((m) => m.categoria === c.chave);
      if (!itens.length && !cat) return '';
      return `<section class="categoria">
        <h2>${c.nome} <span class="meta">${esc(c.desc)}</span></h2>
        ${itens.map((m) => `
          <div class="cartao material">
            <div>
              <h3>${esc(m.titulo)}</h3>
              ${m.descricao ? `<p class="meta" style="margin:0">${esc(m.descricao)}</p>` : ''}
              <span class="tag">${esc(tipoDeLink(m.url))}</span>
              ${admin ? `<button class="link perigo" data-apagar-material="${m.id}">apagar</button>` : ''}
            </div>
            <a class="botao" href="${esc(m.url)}" target="_blank" rel="noopener">Abrir ↗</a>
          </div>`).join('') || '<div class="vazio">Nenhum material nesta categoria ainda.</div>'}
      </section>`;
    }).join('') || '<div class="vazio">Nenhum material publicado ainda.</div>';
  };
  desenhar('');
  document.getElementById('filtro').onclick = (ev) => {
    const a = ev.target.closest('[data-cat]');
    if (!a) return;
    ev.preventDefault();
    document.querySelectorAll('#filtro a').forEach((x) => x.classList.toggle('ativa', x === a));
    desenhar(a.dataset.cat);
  };

  if (!admin) return;
  app.onclick = async (ev) => {
    const b = ev.target.closest('[data-apagar-material]');
    if (!b || !confirm('Apagar este material?')) return;
    try {
      await api(`/api/admin/materiais/${b.dataset.apagarMaterial}`, { method: 'DELETE' });
      avisar('Material apagado.');
      telaMaterial();
    } catch (err) {
      avisar(err.message);
    }
  };
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      await api('/api/admin/materiais', { json: Object.fromEntries(new FormData(f)) });
      avisar('Material adicionado.');
      telaMaterial();
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
    }
  };
}

// ---------- perguntas ao admin ----------

async function telaPerguntas() {
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let dados;
  try {
    dados = await api('/api/perguntas');
  } catch (err) {
    if (err.status === 401) return ir('#/');
    throw err;
  }
  if (minhaRota !== rotaAtual) return;
  const { perguntas, admin } = dados;
  const pendentes = perguntas.filter((p) => !p.resposta).length;

  const cartao = (p) => `
    <div class="cartao pergunta ${p.resposta ? '' : 'pendente'}">
      <div class="meta">
        ${admin ? `${autor({ usuario_id: p.usuario_id, autor: p.nome, autor_tipo: p.tipo, autor_foto: p.foto })} · ` : ''}${esc(formatarData(p.criado_em))}
        · <span class="tag ${p.resposta ? 'sim' : 'novo'}">${p.resposta ? 'Respondida' : 'Aguardando resposta'}</span>
        ${admin ? `<button class="link perigo" data-apagar-pergunta="${p.id}">apagar</button>` : ''}
      </div>
      <div class="mensagem"><strong>Pergunta:</strong> ${esc(p.texto)}</div>
      ${p.resposta ? `<div class="feedback" style="margin:12px 0 0"><strong>Resposta do admin (${esc(formatarData(p.respondida_em))}):</strong>\n${esc(p.resposta)}</div>` : ''}
      ${admin ? `
        <form class="responder" data-id="${p.id}">
          <label style="margin-top:12px">${p.resposta ? 'Alterar resposta' : 'Sua resposta'}</label>
          <textarea name="resposta" maxlength="${MAX}">${esc(p.resposta || '')}</textarea>
          <div class="linha-botoes" style="margin-top:8px"><button type="submit">${p.resposta ? 'Salvar resposta' : 'Responder'}</button></div>
        </form>` : ''}
    </div>`;

  app.innerHTML = admin ? `
    <h1>Perguntas</h1>
    <p class="sub">${pendentes ? `${pendentes} pergunta${pendentes === 1 ? '' : 's'} aguardando resposta.` : 'Nenhuma pergunta aguardando resposta.'} A resposta aparece só para quem perguntou.</p>
    ${perguntas.map(cartao).join('') || '<div class="vazio">Ninguém fez perguntas ainda.</div>'}` : `
    <h1>Perguntas ao admin</h1>
    <p class="sub">Tem alguma dúvida? Escreva aqui. Só você e o admin veem a pergunta e a resposta.</p>
    <form id="f" class="cartao">
      <label for="texto" style="margin-top:0">Sua pergunta</label>
      <textarea id="texto" name="texto" maxlength="${MAX}" placeholder="Escreva sua dúvida" required></textarea>
      <div class="contador"></div>
      <div class="erro" id="erro"></div>
      <div class="linha-botoes"><button type="submit">Enviar pergunta</button></div>
    </form>
    <h2>Minhas perguntas ${perguntas.length ? `<span class="meta">(${perguntas.length})</span>` : ''}</h2>
    ${perguntas.map(cartao).join('') || '<div class="vazio">Você ainda não fez perguntas.</div>'}`;

  if (admin) {
    mostrarPendentes(perguntas);
    app.onsubmit = async (ev) => {
      const form = ev.target.closest('form.responder');
      if (!form) return;
      ev.preventDefault();
      const botao = form.querySelector('button');
      botao.disabled = true;
      try {
        await api(`/api/admin/perguntas/${form.dataset.id}/resposta`, { json: { resposta: form.resposta.value } });
        avisar('Resposta enviada.');
        telaPerguntas();
      } catch (err) {
        avisar(err.message);
        botao.disabled = false;
      }
    };
    app.onclick = async (ev) => {
      const b = ev.target.closest('[data-apagar-pergunta]');
      if (!b || !confirm('Apagar esta pergunta?')) return;
      try {
        await api(`/api/admin/perguntas/${b.dataset.apagarPergunta}`, { method: 'DELETE' });
        telaPerguntas();
      } catch (err) {
        avisar(err.message);
      }
    };
    return;
  }
  const f = document.getElementById('f');
  contador(f.texto);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      await api('/api/perguntas', { json: { texto: f.texto.value } });
      avisar('Pergunta enviada. A resposta vai aparecer aqui.');
      telaPerguntas();
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
    }
  };
}

// ---------- telas de avisos ----------

async function telaAvisos() {
  const u = await exigirUsuario();
  if (!u) return;
  const avisos = await estado.avisos;
  const lido = ultimoLido();
  app.innerHTML = `
    <h1>Avisos</h1>
    <p class="sub">Comunicados enviados pela coordenação.</p>
    ${avisos.map((a) => cartaoAviso(a, { novo: a.id > lido })).join('') || '<div class="vazio">Nenhum aviso por enquanto.</div>'}`;
  marcarLidos(avisos);
}

async function telaAdminAvisos() {
  let avisos;
  try {
    ({ avisos } = await api('/api/avisos'));
  } catch (err) {
    if (err.status === 401 || err.status === 403) return telaAdminLogin();
    throw err;
  }
  topoDoAdmin();
  app.innerHTML = `
    <h1>Avisos</h1>
    <p class="sub">Os avisos aparecem para os usuários na tela inicial do painel e no menu Avisos.</p>
    <form id="f" class="cartao">
      <h2 style="margin-top:0">Novo aviso</h2>
      <label for="titulo">Título</label>
      <input id="titulo" name="titulo" type="text" maxlength="200" placeholder="Ex.: Prazo do módulo 2" required>
      <label for="texto">Mensagem</label>
      <textarea id="texto" name="texto" maxlength="${MAX}" required></textarea>
      <div class="contador"></div>
      <label>Quem vai receber</label>
      <div class="opcoes">
        <label><input type="radio" name="publico" value="todos" checked>Todos</label>
        <label><input type="radio" name="publico" value="especialista">Só especialistas</label>
        <label><input type="radio" name="publico" value="instrutor">Só instrutores</label>
      </div>
      <div class="erro" id="erro"></div>
      <div class="linha-botoes"><button type="submit">Enviar aviso</button></div>
    </form>
    <h2>Avisos enviados <span class="meta">(${avisos.length})</span></h2>
    ${avisos.map((a) => cartaoAviso(a, { apagar: true })).join('') || '<div class="vazio">Nenhum aviso enviado ainda.</div>'}`;

  const f = document.getElementById('f');
  contador(f.texto);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      await api('/api/admin/avisos', { json: { titulo: f.titulo.value, texto: f.texto.value, publico: f.publico.value } });
      avisar('Aviso enviado.');
      telaAdminAvisos();
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
    }
  };
  app.onclick = async (ev) => {
    const b = ev.target.closest('[data-apagar-aviso]');
    if (!b || !confirm('Apagar este aviso? Ele some para todos.')) return;
    try {
      await api(`/api/admin/avisos/${b.dataset.apagarAviso}`, { method: 'DELETE' });
      avisar('Aviso apagado.');
      telaAdminAvisos();
    } catch (err) {
      avisar(err.message);
    }
  };
}

// ---------- fórum ----------

const FORUNS = [
  { chave: 'geral', nome: 'Geral', desc: 'Para todos: especialistas e instrutores.' },
  { chave: 'especialista', nome: 'Especialistas', desc: 'Assuntos dos especialistas. Todos podem ler e participar.' },
  { chave: 'instrutor', nome: 'Instrutores', desc: 'Assuntos dos instrutores. Todos podem ler e participar.' },
];

// Evita que uma tela antiga, que terminou de carregar depois, sobrescreva a atual.
let rotaAtual = 0;

// Quem está vendo o fórum: um usuário cadastrado ou o admin.
async function leitorDoForum() {
  const r = await carregarUsuario();
  if (r?.usuario) {
    topoDoUsuario(r.usuario);
    return { usuario: r.usuario };
  }
  if (r && !r.usuario) {
    ir('#/cadastro');
    return null;
  }
  topoDoAdmin();
  return { admin: true };
}

function autor(item, link = true) {
  const foto = avatar(item.autor_foto, 'pequeno');
  const tipo = item.autor_tipo === 'especialista' ? 'Especialista' : item.autor_tipo === 'instrutor' ? 'Instrutor' : '';
  const nome = link && item.usuario_id
    ? `<a href="#/perfil/${item.usuario_id}"><strong>${esc(item.autor || 'Usuário')}</strong></a>`
    : `<strong>${esc(item.autor || 'Usuário removido')}</strong>`;
  return `<span class="autor">${foto}${nome}${tipo ? `<span class="tag">${tipo}</span>` : ''}</span>`;
}

function imagemForum(url) {
  return url ? `<a class="imagem-forum" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Imagem enviada"></a>` : '';
}

async function telaForum(chave) {
  const forum = FORUNS.find((f) => f.chave === chave) || FORUNS[0];
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let dados;
  try {
    dados = await api(`/api/forum/${forum.chave}`);
  } catch (err) {
    if (err.status === 401) return ir('#/');
    throw err;
  }
  if (minhaRota !== rotaAtual) return;
  const { topicos, podePublicar } = dados;
  app.innerHTML = `
    <h1>Fórum</h1>
    <nav class="abas">
      ${FORUNS.map((f) => `<a href="#/forum/${f.chave}" class="${f.chave === forum.chave ? 'ativa' : ''}">${f.nome}</a>`).join('')}
    </nav>
    <p class="sub">${esc(forum.desc)}</p>
    ${podePublicar ? `
      <details class="cartao novo-topico">
        <summary>+ Novo tópico em ${esc(forum.nome)}</summary>
        <form id="f">
          <label for="titulo">Título</label>
          <input id="titulo" name="titulo" type="text" maxlength="200" required>
          <label for="texto">Mensagem</label>
          <textarea id="texto" name="texto" maxlength="${MAX}"></textarea>
          <div class="contador"></div>
          <label for="imagem">Imagem <span class="ajuda">(opcional, até 5MB)</span></label>
          <input id="imagem" name="imagem" type="file" accept="image/*">
          <div class="erro" id="erro"></div>
          <div class="linha-botoes"><button type="submit">Publicar</button></div>
        </form>
      </details>` : ''}
    <div class="lista-topicos">
      ${topicos.map((t) => `
        <a class="cartao topico" href="#/forum/topico/${t.id}">
          <h3>${esc(t.titulo)}</h3>
          <div class="meta">${autor(t, false)} · ${t.respostas} resposta${t.respostas === 1 ? '' : 's'} · ${esc(formatarData(t.ultima_atividade))}</div>
        </a>`).join('') || '<div class="vazio">Nenhum tópico ainda. Seja o primeiro a publicar.</div>'}
    </div>`;
  const f = document.getElementById('f');
  if (!f) return;
  contador(f.texto);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      const arquivo = f.imagem.files[0];
      if (arquivo) botao.textContent = 'Enviando imagem...';
      const imagem = arquivo ? await enviarArquivo(arquivo, true) : null;
      const { topico } = await api(`/api/forum/${forum.chave}`, { json: { titulo: f.titulo.value, texto: f.texto.value, imagem } });
      ir(`#/forum/topico/${topico.id}`);
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Publicar';
    }
  };
}

async function telaTopico(id) {
  const minhaRota = rotaAtual;
  const leitor = await leitorDoForum();
  if (!leitor) return;
  let dados;
  try {
    dados = await api(`/api/forum/topico/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 401) return ir('#/');
    avisar(err.message);
    return ir('#/forum/geral');
  }
  if (minhaRota !== rotaAtual) return;
  const { topico, respostas, podePublicar, usuarioId, admin } = dados;
  const forum = FORUNS.find((f) => f.chave === topico.forum);
  const podeApagar = (item) => admin || (usuarioId && item.usuario_id === usuarioId);
  app.innerHTML = `
    <p><a href="#/forum/${topico.forum}">← Fórum ${esc(forum.nome)}</a></p>
    <div class="cartao">
      <h1>${esc(topico.titulo)}</h1>
      <div class="meta">${autor(topico)} · ${esc(formatarData(topico.criado_em))}
        ${podeApagar(topico) ? '<button class="link perigo" data-apagar-topico>apagar tópico</button>' : ''}</div>
      <div class="mensagem">${esc(topico.texto)}</div>
      ${imagemForum(topico.imagem)}
    </div>
    <h2>${respostas.length} resposta${respostas.length === 1 ? '' : 's'}</h2>
    ${respostas.map((r) => `
      <div class="cartao resposta">
        <div class="meta">${autor(r)} · ${esc(formatarData(r.criado_em))}
          ${podeApagar(r) ? `<button class="link perigo" data-apagar-resposta="${r.id}">apagar</button>` : ''}</div>
        <div class="mensagem">${esc(r.texto)}</div>
        ${imagemForum(r.imagem)}
      </div>`).join('')}
    ${podePublicar ? `
      <form id="f" class="cartao">
        <label for="texto" style="margin-top:0">Sua resposta</label>
        <textarea id="texto" name="texto" maxlength="${MAX}"></textarea>
        <div class="contador"></div>
        <label for="imagem">Imagem <span class="ajuda">(opcional, até 5MB)</span></label>
        <input id="imagem" name="imagem" type="file" accept="image/*">
        <div class="erro" id="erro"></div>
        <div class="linha-botoes"><button type="submit">Responder</button></div>
      </form>` : ''}`;

  app.onclick = async (ev) => {
    const t = ev.target.closest('[data-apagar-topico]');
    const r = ev.target.closest('[data-apagar-resposta]');
    if (!t && !r) return;
    if (!confirm(t ? 'Apagar este tópico e todas as respostas?' : 'Apagar esta resposta?')) return;
    try {
      if (t) {
        await api(`/api/forum/topico/${topico.id}`, { method: 'DELETE' });
        app.onclick = null;
        return ir(`#/forum/${topico.forum}`);
      }
      await api(`/api/forum/resposta/${r.dataset.apagarResposta}`, { method: 'DELETE' });
      telaTopico(topico.id);
    } catch (err) {
      avisar(err.message);
    }
  };

  const f = document.getElementById('f');
  if (!f) return;
  contador(f.texto);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      const arquivo = f.imagem.files[0];
      if (arquivo) botao.textContent = 'Enviando imagem...';
      const imagem = arquivo ? await enviarArquivo(arquivo, true) : null;
      await api(`/api/forum/topico/${topico.id}/respostas`, { json: { texto: f.texto.value, imagem } });
      telaTopico(topico.id);
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = 'Responder';
    }
  };
}

// ---------- rotas ----------

async function rotear() {
  app.onclick = null;
  app.onsubmit = null;
  app.onchange = null;
  app.classList.remove('largo');
  rotaAtual++;
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  try {
    switch (partes[0]) {
      case '': return await telaInicio();
      case 'cadastro': return await telaCadastro();
      case 'painel': return await telaPainel();
      case 'turma': return await telaTurma(partes[1], partes[2]);
      case 'admin': return partes[1] === 'usuario' ? await telaAdminUsuario(partes[2]) : await telaAdmin();
      case 'avisos': return await telaAvisos();
      case 'material': return await telaMaterial();
      case 'participantes': return await telaParticipantes();
      case 'mensagens': return partes[1] ? await telaConversa(partes[1]) : await telaMensagens();
      case 'perguntas': return await telaPerguntas();
      case 'perfil': return partes[1] ? await telaVerPerfil(partes[1]) : await telaPerfil();
      case 'admin-avisos': return await telaAdminAvisos();
      case 'forum':
        return partes[1] === 'topico' ? await telaTopico(partes[2]) : await telaForum(partes[1]);
      default: return ir('#/');
    }
  } catch (err) {
    app.innerHTML = `<div class="cartao erro">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', rotear);
rotear();
