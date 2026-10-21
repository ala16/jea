'use strict';

const app = document.getElementById('app');
const topoUsuario = document.getElementById('topo-usuario');
const CAMPOS = window.MODULO1_ESPECIALISTA_CAMPOS;
const CAMPOS_EXPEDICAO = window.EXPEDICAO_CAMPOS;
const { lerValor, formatarReais } = window;
const AREAS = {
  modulo: { nome: 'Módulo', plural: 'módulos', rota: '' },
  expedicao: { nome: 'Expedição', plural: 'expedições', rota: 'expedicao/' },
};

// "Módulo 3" ou "Expedição 3".
function nomeEnvio(e) {
  return `${AREAS[e.area || 'modulo'].nome} ${e.numero}`;
}
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
  // Login, cadastro, perfil e saída mudam quem está logado: a próxima tela pergunta de novo.
  if (init.method !== 'GET') sessaoEmCache = null;
  const r = await fetch(url, init);
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401) sessaoEmCache = null;
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

// Lista os anexos já enviados ([{ url, nome }]). Com removivel, cada um ganha a opção de remover.
function blocoAnexos(anexos, removivel = false) {
  if (!anexos?.length) return '';
  return `<ul class="anexos-atuais">${anexos.map((a) => {
    const url = esc(a.url);
    return `<li class="anexo-atual"><a href="${url}" target="_blank" rel="noopener">${esc(a.nome || a.url)}</a>
      ${ehImagem(a.url) ? `<img src="${url}" alt="" loading="lazy">` : ''}
      ${removivel ? `<label class="remover-anexo"><input type="checkbox" name="removerAnexos" value="${url}"> remover</label>` : ''}</li>`;
  }).join('')}</ul>`;
}

// Campo de arquivo que aceita vários de uma vez; mostra o que foi escolhido antes de enviar.
function campoArquivos(id, rotulo, { imagem = false, ajuda = '', atuais = [] } = {}) {
  return `<div>
      <label for="${id}">${rotulo}</label>
      <p class="ajuda">${ajuda || (imagem ? 'Selecione uma ou mais imagens' : 'Selecione um ou mais arquivos')}</p>
      <input id="${id}" name="${id}" type="file" multiple ${imagem ? 'accept="image/*"' : ''}>
      <ul class="escolhidos"></ul>
      ${blocoAnexos(atuais, true)}
    </div>`;
}

document.addEventListener('change', (ev) => {
  const input = ev.target;
  if (!input.matches?.('input[type=file][multiple]')) return;
  const lista = input.nextElementSibling;
  if (!lista?.classList.contains('escolhidos')) return;
  lista.innerHTML = [...input.files].map((f) => `<li>${esc(f.name)} <span class="meta">(${tamanho(f.size)})</span></li>`).join('');
});

function tamanho(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
}

// ---------- upload ----------

let config;
function obterConfig() {
  return (config ??= api('/api/config'));
}

// Fotos de celular têm 3 a 8MB. Antes de enviar, reduz para no máximo 1600px em JPEG,
// o que deixa cada uma com uns 300KB: o envio fica rápido e o armazenamento aguenta 500 pessoas.
const LADO_MAXIMO = 1600;
async function reduzirImagem(arquivo, ladoMaximo = LADO_MAXIMO) {
  if (!/^image\/(jpeg|png|webp|heic|heif|bmp)$/.test(arquivo.type) || arquivo.size < 150 * 1024) return arquivo;
  try {
    const img = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= arquivo.size) return arquivo;
    const nome = arquivo.name.replace(/\.[^.]*$/, '') + '.jpg';
    return new File([blob], nome, { type: 'image/jpeg' });
  } catch {
    return arquivo;
  }
}

// Envia o arquivo e devolve { url, nome }. Na Vercel vai direto para o Vercel Blob.
// Fotos de perfil aparecem pequenas (e 500 de uma vez em Participantes): bastam 400px.
async function enviarArquivo(arquivo, imagem, ladoMaximo) {
  if (arquivo.type.startsWith('image/')) arquivo = await reduzirImagem(arquivo, ladoMaximo);
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
    // Arquivos grandes vão em partes: mais rápido e sem limite de tamanho.
    multipart: arquivo.size > 20 * 1024 * 1024,
  });
  return { url: blob.url, nome: arquivo.name };
}

// Envia vários arquivos, um por vez, mostrando o andamento no botão.
async function enviarArquivos(arquivos, imagem, botao) {
  const enviados = [];
  for (const [i, arquivo] of [...arquivos].entries()) {
    if (botao) botao.textContent = arquivos.length > 1 ? `Enviando arquivo ${i + 1} de ${arquivos.length}...` : 'Enviando arquivo...';
    enviados.push(await enviarArquivo(arquivo, imagem));
  }
  return enviados;
}

// ---------- sessão ----------

let estado = { usuario: null, avisos: Promise.resolve([]) };

// Guarda a resposta de /api/eu entre as telas, para não esperar o servidor a cada clique.
let sessaoEmCache = null;

async function carregarUsuario() {
  sessaoEmCache ??= api('/api/eu').catch(() => null);
  const pedido = sessaoEmCache;
  const r = await pedido;
  if (!r && sessaoEmCache === pedido) sessaoEmCache = null;
  estado.usuario = r?.usuario ?? null;
  return r;
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
  return foto ? `<img class="avatar ${classe}" src="${esc(foto)}" alt="" loading="lazy" decoding="async">` : `<span class="avatar ${classe}"></span>`;
}

// Ícones do menu (traço simples, herdam a cor do texto).
const ICONES = {
  turmas: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M7 9v5c0 1.5 2.2 3 5 3s5-1.5 5-3V9"/>',
  material: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5z"/><path d="M8 7h6"/>',
  avisos: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  forum: '<path d="M4 4h16v11H8l-4 4V4z"/><path d="M8 9h8M8 12h5"/>',
  participantes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  mensagens: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  perguntas: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.5h.01"/>',
  envios: '<path d="M9 4h6v3H9z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="M9 13l2 2 4-4"/>',
};

// Ícones da página da turma: áreas (módulos e expedições) e situação dos envios.
const ICONES_TURMA = {
  modulo: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  expedicao: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  enviado: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'com-feedback': '<path d="M4 4h16v11H8l-4 4V4z"/><path d="M8 9h8M8 12h5"/>',
};

function icone(caminhos) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos}</svg>`;
}

const SETA_ESQ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const SETA_DIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// Link "voltar" no topo das páginas internas.
function voltar(href, rotulo) {
  return `<a class="voltar" href="${href}">${SETA_ESQ}<span>${rotulo}</span></a>`;
}

function itemMenu(href, area, icone, rotulo, badge) {
  return `<a href="${href}" data-area="${area}" title="${rotulo}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[icone]}</svg>
    <span>${rotulo}</span>${badge ? `<span class="badge" id="${badge}" hidden></span>` : ''}</a>`;
}

function topoDoUsuario(u) {
  desenharTopo(`<nav class="menu" aria-label="Menu principal">
      ${itemMenu('#/painel', 'painel turma', 'turmas', 'Minhas turmas')}
      ${itemMenu('#/material', 'material', 'material', 'Material')}
      ${itemMenu('#/avisos', 'avisos', 'avisos', 'Avisos', 'badge-avisos')}
      ${itemMenu('#/forum/geral', 'forum', 'forum', 'Fórum')}
      ${itemMenu('#/participantes', 'participantes perfil', 'participantes', 'Participantes')}
      ${itemMenu('#/mensagens', 'mensagens', 'mensagens', 'Mensagens', 'badge-mensagens')}
      ${itemMenu('#/perguntas', 'perguntas', 'perguntas', 'Perguntas')}
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
  desenharTopo(`<nav class="menu" aria-label="Menu principal">
      ${itemMenu('#/admin', 'admin', 'envios', 'Envios')}
      ${itemMenu('#/admin-avisos', 'admin-avisos', 'avisos', 'Avisos')}
      ${itemMenu('#/material', 'material', 'material', 'Material')}
      ${itemMenu('#/perguntas', 'perguntas', 'perguntas', 'Perguntas', 'badge-perguntas')}
      ${itemMenu('#/forum/geral', 'forum', 'forum', 'Fórum')}
      ${itemMenu('#/participantes', 'participantes perfil', 'participantes', 'Participantes')}
    </nav>
    <div class="usuario"><span>Gestor</span><button data-sair>Sair</button></div>`, '#/admin');
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

// ---------- avisos (a notificação só some quando a pessoa clica em Ciente) ----------

const PUBLICOS = { todos: 'Para todos', especialista: 'Para especialistas', instrutor: 'Para instrutores' };

function mostrarNaoLidos(avisos) {
  const badge = document.getElementById('badge-avisos');
  if (!badge) return;
  const n = avisos.filter((a) => !a.ciente_em).length;
  badge.textContent = n;
  badge.hidden = !n;
}

function rodapeCiente(a) {
  return a.ciente_em
    ? `<p class="ciente-feito">✓ Você deu ciente em ${esc(formatarData(a.ciente_em))}</p>`
    : `<button class="botao-ciente" data-ciente="${a.id}">👍 Ciente</button>`;
}

function listaCientes(a) {
  const n = a.cientes.length;
  return `<details class="cientes">
      <summary>👍 ${n} de ${a.total_publico} deram ciente</summary>
      ${n ? `<ul>${a.cientes.map((c) => `<li><span>${esc(c.nome)} <span class="tag">${nomeTipo(c.tipo)}</span></span>
        <span class="meta">${esc(formatarData(c.em))}</span></li>`).join('')}</ul>` : '<p class="meta">Ninguém deu ciente ainda.</p>'}
    </details>`;
}

function cartaoAviso(a, { gestor } = {}) {
  const novo = !gestor && !a.ciente_em;
  return `<article class="cartao aviso-item ${novo ? 'novo' : ''}">
      <div class="meta">${novo ? '<span class="tag novo">Novo</span> ' : ''}${esc(formatarData(a.criado_em))} · ${PUBLICOS[a.publico] || ''}
        ${gestor ? `<button class="link perigo" data-apagar-aviso="${a.id}">apagar</button>` : ''}</div>
      <h3>${esc(a.titulo)}</h3>
      <div class="mensagem">${esc(a.texto)}</div>
      ${gestor ? listaCientes(a) : rodapeCiente(a)}
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
      <p class="rodape-entrada"><a href="#/admin">Acesso do gestor</a></p>
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

const OBRIG = '<span class="obrig" aria-hidden="true">*</span>';
const OPCIONAL = '<span class="tag-opcional">opcional</span>';

// Campos de WhatsApp e redes sociais, usados no cadastro e no perfil.
function campoWhatsapp(redes = {}) {
  return `<label for="r_whatsapp">WhatsApp ${OBRIG} <span class="ajuda">(só o número com DDD)</span></label>
    <input id="r_whatsapp" name="whatsapp" type="tel" inputmode="numeric" maxlength="16" autocomplete="tel-national" placeholder="(16) 99999-8888" value="${esc(redes.whatsapp ? formatarWhatsapp(redes.whatsapp) : '')}" required>`;
}

// Links das redes sociais (opcionais), usados no cadastro e no perfil.
function camposRedes(redes = {}) {
  return `<div class="grade">
    ${REDES.filter((r) => r.chave !== 'whatsapp').map((r) => `<div><label for="r_${r.chave}">${r.nome} ${OPCIONAL}</label>
        <input id="r_${r.chave}" name="${r.chave}" type="text" inputmode="url" maxlength="300" placeholder="${r.exemplo}" value="${esc(redes[r.chave] || '')}"></div>`).join('')}
  </div>`;
}

function lerCamposRedes(f) {
  return Object.fromEntries(REDES.map((r) => [r.chave, f[r.chave].value]));
}

async function telaCadastro() {
  const r = await carregarUsuario();
  if (!r) return ir('#/');
  if (r.usuario) return ir('#/painel');
  desenharTopo('<div class="usuario"><button data-sair>Sair</button></div>');
  app.innerHTML = `
    <div class="centro cartao" style="max-width:640px">
      <p class="passo">Primeiro acesso</p>
      <h1>Complete seu cadastro</h1>
      <p class="sub">Os campos com ${OBRIG} são obrigatórios. O resto é opcional e você pode preencher depois em <strong>Meu perfil</strong>.</p>
      <form id="f" novalidate>
        <h2 style="margin-top:8px">Dados obrigatórios</h2>
        <label for="nome">Nome completo ${OBRIG}</label>
        <input id="nome" name="nome" type="text" maxlength="200" autocomplete="name" required>
        <label for="email">E-mail ${OBRIG}</label>
        <input id="email" name="email" type="email" maxlength="200" autocomplete="email" placeholder="seunome@email.com" required>
        ${campoWhatsapp()}
        <label for="cpf">CPF ${OBRIG}</label>
        <input id="cpf" type="text" value="${esc(mascaraCpf(r.cpf))}" disabled>
        <label>Você é ${OBRIG}</label>
        <div class="opcoes">
          <label><input type="radio" name="tipo" value="especialista" required><span><strong>Especialista</strong><small>Preenche o planejamento, os módulos e as 8 expedições do agro</small></span></label>
          <label><input type="radio" name="tipo" value="instrutor" required><span><strong>Instrutor</strong><small>Envia texto e imagem em cada módulo</small></span></label>
        </div>
        <div class="secao-form">
          <h2>Opcional</h2>
          <p class="ajuda">Pode deixar em branco e completar depois em Meu perfil. Nas redes, cole o link do seu perfil.</p>
          <label for="foto">Foto do perfil ${OPCIONAL}</label>
          <div class="foto-perfil"><span class="avatar grande" id="previa"></span><input id="foto" name="foto" type="file" accept="image/*"></div>
          ${camposRedes()}
        </div>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes"><button type="submit">Concluir cadastro</button></div>
      </form>
    </div>`;
  const f = document.getElementById('f');
  f.nome.focus();
  f.whatsapp.oninput = () => (f.whatsapp.value = mascaraWhatsapp(f.whatsapp.value));
  f.foto.onchange = () => {
    const arq = f.foto.files[0];
    const previa = document.getElementById('previa');
    previa.style.backgroundImage = arq ? `url(${URL.createObjectURL(arq)})` : '';
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const erro = document.getElementById('erro');
    const falta = !f.nome.value.trim() ? 'Informe seu nome completo.'
      : !f.email.value.trim() ? 'Informe seu e-mail.'
      : !f.whatsapp.value.trim() ? 'Informe seu WhatsApp com DDD.'
      : !f.tipo.value ? 'Escolha se você é especialista ou instrutor.' : '';
    if (falta) { erro.textContent = falta; return; }
    const botao = f.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const foto = f.foto.files[0];
      if (foto) botao.textContent = 'Enviando foto...';
      await api('/api/cadastro', {
        json: {
          nome: f.nome.value,
          email: f.email.value,
          tipo: f.tipo.value,
          redes: lerCamposRedes(f),
          foto: foto ? await enviarArquivo(foto, true, 400) : null,
        },
      });
      ir('#/painel');
    } catch (err) {
      erro.textContent = err.message;
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

// Horário: lista de 30 em 30 minutos, mas a pessoa também pode digitar.
const HORAS = Array.from({ length: 36 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

function campoHora(nome, exemplo) {
  return `<input id="${nome}" name="${nome}" type="text" inputmode="numeric" list="horas" maxlength="5" autocomplete="off" placeholder="Ex.: ${exemplo}" required>`;
}

// Enquanto digita: só números e dois pontos; com 4 números põe o ':' (0730 -> 07:30).
function mascaraHora(v) {
  if (v.includes(':')) {
    const [h, m = ''] = v.replace(/[^\d:]/g, '').split(':');
    return `${h.slice(0, 2)}:${m.slice(0, 2)}`;
  }
  const n = v.replace(/\D/g, '').slice(0, 4);
  return n.length === 4 ? `${n.slice(0, 2)}:${n.slice(2)}` : n;
}

// Ao sair do campo: 8 -> 08:00, 830 -> 08:30, 13h -> 13:00. Retorna '' se inválido.
function normalizarHora(v) {
  v = String(v).trim();
  const n = v.replace(/\D/g, '');
  if (!n) return '';
  let h; let m;
  const partes = v.match(/^(\d{1,2})\s*[:hH]\s*(\d{0,2})/);
  if (partes) { h = +partes[1]; m = +(partes[2] || 0); } else if (n.length <= 2) { h = +n; m = 0; } else if (n.length === 3) { h = +n[0]; m = +n.slice(1); } else { h = +n.slice(0, 2); m = +n.slice(2, 4); }
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function ligarHorario(f) {
  const resumo = document.getElementById('resumo-horario');
  const atualizar = () => {
    const e = normalizarHora(f.entrada.value);
    const s = normalizarHora(f.saida.value);
    if (!e || !s || f.entrada.value.length < 5 || f.saida.value.length < 5) { resumo.hidden = true; return; }
    const min = (+s.slice(0, 2) * 60 + +s.slice(3)) - (+e.slice(0, 2) * 60 + +e.slice(3));
    resumo.hidden = false;
    resumo.classList.toggle('erro', min <= 0);
    resumo.textContent = min <= 0
      ? 'A saída precisa ser depois da entrada.'
      : `Aula das ${e} às ${s} (${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}).`;
  };
  for (const campo of [f.entrada, f.saida]) {
    campo.oninput = (ev) => {
      // Escolher na lista já vem com ":"; digitando, a máscara coloca.
      if (!ev.inputType?.startsWith('delete')) campo.value = mascaraHora(campo.value);
      campo.setCustomValidity('');
      atualizar();
    };
    campo.onblur = () => {
      if (!campo.value) return;
      const h = normalizarHora(campo.value);
      if (h) campo.value = h;
      campo.setCustomValidity(h ? '' : 'Horário inválido. Use o formato 08:00.');
      atualizar();
    };
  }
}

async function telaPainel() {
  const u = await exigirUsuario();
  if (!u) return;
  const [{ turmas }, avisos] = await Promise.all([api('/api/turmas'), estado.avisos]);
  const novos = avisos.filter((a) => !a.ciente_em);
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
          <div><label for="cidade">Cidade</label><input id="cidade" name="cidade" type="text" maxlength="200" placeholder="Ex.: Atibaia" required></div>
          <div><label for="sindicato">Sindicato rural</label><input id="sindicato" name="sindicato" type="text" maxlength="200" placeholder="Ex.: Sindicato Rural de Atibaia" required></div>
        </div>
        <label>Horário da aula</label>
        <p class="ajuda">Escolha na lista ou digite só os números (ex.: 0730 vira 07:30).</p>
        <div class="horario">
          <label>Entrada${campoHora('entrada', '08:00')}</label>
          <span class="horario-ate">às</span>
          <label>Saída${campoHora('saida', '12:00')}</label>
        </div>
        <p class="horario-resumo" id="resumo-horario" hidden></p>
        <datalist id="horas">${HORAS.map((h) => `<option value="${h}">`).join('')}</datalist>
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
          <div class="meta">${t.modulos_enviados} de 8 módulos enviados${u.tipo === 'especialista' ? ` · ${t.expedicoes_enviadas} de 8 expedições` : ''}${t.feedbacks ? ` · <strong class="verde">${t.feedbacks} feedback${t.feedbacks === 1 ? '' : 's'}</strong>` : ''}</div>
          <span class="abrir">Abrir turma ${SETA_DIR}</span>
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
  ligarHorario(f);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    if (botao.disabled) return;
    botao.disabled = true;
    try {
      document.getElementById('erro').textContent = '';
      const entrada = normalizarHora(f.entrada.value);
      const saida = normalizarHora(f.saida.value);
      if (!entrada) throw new Error('Informe o horário de entrada, ex.: 08:00.');
      if (!saida) throw new Error('Informe o horário de saída, ex.: 12:00.');
      if (saida <= entrada) throw new Error('O horário de saída precisa ser depois da entrada.');
      f.entrada.value = entrada;
      f.saida.value = saida;
      const dados = Object.fromEntries(new FormData(f));
      delete dados.entrada;
      delete dados.saida;
      dados.horario = `${entrada} às ${saida}`;
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

// Antes das tabelas, cronograma e orçamento eram texto livre: o que já foi escrito continua à mostra.
function textoAnterior(dados, chave) {
  return typeof dados[chave] === 'string' ? dados[chave] : dados[`${chave}_anterior`] || '';
}

function linhasDe(dados, chave) {
  return Array.isArray(dados[chave]) ? dados[chave] : [];
}

function totalTabela(c, linhas) {
  const col = c.colunas.find((x) => x.valor);
  return col ? linhas.reduce((s, l) => s + (lerValor(l?.[col.chave]) || 0), 0) : null;
}

function campoTabela(c, dados) {
  const linhas = linhasDe(dados, c.chave);
  const anterior = textoAnterior(dados, c.chave);
  const temValor = c.colunas.some((x) => x.valor);
  const celula = (col, l, n) => {
    const v = l?.[col.chave];
    const rot = `${col.rotulo} do módulo ${n}`;
    if (col.valor) {
      const txt = v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `<input type="text" inputmode="decimal" data-col="${col.chave}" data-valor="1" aria-label="${esc(rot)}" placeholder="${esc(col.exemplo || '')}" value="${esc(txt)}">`;
    }
    if (col.max > 100) return `<textarea data-col="${col.chave}" maxlength="${col.max}" aria-label="${esc(rot)}">${esc(v)}</textarea>`;
    return `<input type="text" data-col="${col.chave}" maxlength="${col.max}" aria-label="${esc(rot)}" placeholder="${esc(col.exemplo || '')}" value="${esc(v)}">`;
  };
  return `<div class="campo-tabela" data-tabela="${c.chave}">
    <label>${esc(c.rotulo)}<span class="ok" hidden>✓</span></label>
    ${c.ajuda ? `<p class="ajuda">${esc(c.ajuda)}</p>` : ''}
    ${anterior ? `<div class="texto-anterior">
      <label for="c_${c.chave}_anterior">O que você já tinha escrito</label>
      <p class="ajuda">Passe estas informações para a tabela abaixo. Quando terminar, apague este texto e salve.</p>
      <textarea id="c_${c.chave}_anterior" name="${c.chave}_anterior" maxlength="${MAX}">${esc(anterior)}</textarea><div class="contador"></div>
    </div>` : ''}
    <div class="tabela"><table class="tabela-modulos">
      <thead><tr><th>Módulo</th>${c.colunas.map((col) => `<th>${esc(col.rotulo)}</th>`).join('')}</tr></thead>
      <tbody>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<tr>
        <th scope="row">Módulo ${n}</th>
        ${c.colunas.map((col) => `<td data-rotulo="${esc(col.rotulo)}">${celula(col, linhas[n - 1], n)}</td>`).join('')}
      </tr>`).join('')}</tbody>
      ${temValor ? `<tfoot><tr><th>Total geral</th><td colspan="${c.colunas.length}" class="total">${formatarReais(totalTabela(c, linhas))}</td></tr></tfoot>` : ''}
    </table></div>
  </div>`;
}

// Liga o ✓ e o total de uma tabela de módulos e devolve uma função que lê as linhas.
function ligarTabela(div) {
  const ok = div.querySelector(':scope > label .ok');
  const total = div.querySelector('.total');
  const ler = () => [...div.querySelectorAll('tbody tr')].map((tr) => Object.fromEntries(
    [...tr.querySelectorAll('[data-col]')].map((el) => [el.dataset.col, el.value]),
  ));
  const atualizar = () => {
    if (ok) ok.hidden = !ler().some((l) => Object.values(l).some((v) => v.trim()));
    if (total) {
      let soma = 0;
      for (const el of div.querySelectorAll('[data-valor]')) {
        const n = lerValor(el.value);
        el.classList.toggle('invalido', Boolean(el.value.trim()) && n == null);
        soma += n || 0;
      }
      total.textContent = formatarReais(soma);
    }
  };
  div.addEventListener('input', atualizar);
  atualizar();
  return ler;
}

// Cronograma/orçamento enviados: tabela para ler e texto para comparar no histórico.
function leituraTabela(c, dados) {
  const linhas = linhasDe(dados, c.chave);
  const anterior = textoAnterior(dados, c.chave);
  const vazio = (v) => v == null || v === '';
  const preenchidas = linhas.filter((l) => c.colunas.some((col) => !vazio(l?.[col.chave])));
  const temValor = c.colunas.some((x) => x.valor);
  const cel = (col, l) => (col.valor ? (vazio(l?.[col.chave]) ? '' : formatarReais(l[col.chave])) : l?.[col.chave] || '');
  const total = formatarReais(totalTabela(c, linhas));

  const partes = anterior ? [`Texto livre: ${anterior}`] : [];
  for (const l of preenchidas) partes.push(`Módulo ${l.modulo}: ${c.colunas.map((col) => cel(col, l) || '—').join(' · ')}`);
  if (temValor && preenchidas.length) partes.push(`Total geral: ${total}`);

  let html = anterior ? `<div class="texto-anterior-leitura"><span class="meta">Texto livre:</span>\n${esc(anterior)}</div>` : '';
  if (preenchidas.length) {
    html += `<div class="tabela"><table class="tabela-modulos leitura">
      <thead><tr><th>Módulo</th>${c.colunas.map((col) => `<th${col.valor ? ' class="num"' : ''}>${esc(col.rotulo)}</th>`).join('')}</tr></thead>
      <tbody>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<tr><th scope="row">Módulo ${n}</th>${c.colunas.map((col) => `<td${col.valor ? ' class="num"' : ''}>${esc(cel(col, linhas[n - 1])) || '<span class="meta">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      ${temValor ? `<tfoot><tr><th>Total geral</th><td colspan="${c.colunas.length}">${esc(total)}</td></tr></tfoot>` : ''}
    </table></div>`;
  }
  return { texto: partes.join('\n'), html };
}

function formModulo1Especialista(m) {
  const dados = m?.dados || {};
  return `<div class="grupo"><h2 style="margin-top:0">${esc(CAMPOS[0].grupo)}</h2>
      <p class="ajuda">Preencha cada item para estruturar formalmente o Planejamento da sua turma.</p>
      ${CAMPOS.filter((c) => c.chave).map((c) => (c.tabela ? campoTabela(c, dados) : campoTexto(c, dados[c.chave]))).join('')}
      ${campoArquivos('anexos', `Anexos ${OPCIONAL}`, { atuais: m?.anexos })}
    </div>`;
}

function formExpedicao(m) {
  const dados = m?.dados || {};
  return `<p class="ajuda">Registre os detalhes da expedição realizada pela turma.</p>
    ${CAMPOS_EXPEDICAO.map((c) => campoTexto(c, dados[c.chave])).join('')}
    ${campoArquivos('anexos', 'Fotos da expedição', { imagem: true, ajuda: 'Selecione uma ou mais fotos', atuais: m?.anexos })}`;
}

function formModuloSimples(m, instrutor) {
  return `
    ${campoTexto({ chave: 'texto', rotulo: 'Texto', max: MAX }, m?.texto)}
    ${campoArquivos('anexos', instrutor ? 'Imagens' : 'Anexos', { imagem: instrutor, atuais: m?.anexos })}`;
}

// Depois de enviado, o módulo (ou a expedição) aparece só para leitura; o botão Editar abre o formulário.
// O especialista tem duas áreas na turma: os 8 módulos e as 8 Expedições do Agro.
async function telaTurma(turmaId, area, numero, editando = false) {
  const u = await exigirUsuario();
  if (!u) return;
  const instrutor = u.tipo === 'instrutor';
  if (instrutor) area = 'modulo';
  numero = Math.min(8, Math.max(1, Number(numero) || 1));
  let r;
  try {
    r = await api(`/api/turmas/${turmaId}`);
  } catch (err) {
    avisar(err.message);
    return ir('#/painel');
  }
  const { turma } = r;
  const expedicao = area === 'expedicao';
  const A = AREAS[area];
  const enviados = expedicao ? r.expedicoes || [] : r.modulos;
  const disponiveis = (expedicao ? r.expedicoesDisponiveis : r.disponiveis) || [1, 2, 3, 4, 5, 6, 7, 8];
  // Oculto pelo gestor: abre o primeiro liberado que ainda falta enviar.
  if (!disponiveis.includes(numero)) {
    numero = disponiveis.find((n) => !enviados.some((x) => x.numero === n)) ?? disponiveis[0];
  }
  const m = enviados.find((x) => x.numero === numero);
  const especial = !instrutor && !expedicao && numero === 1;
  const anterior = disponiveis.filter((n) => n < numero).pop();
  const proximo = disponiveis.find((n) => n > numero);
  const link = (n) => `#/turma/${turma.id}/${A.rota}${n}`;
  const titulo = expedicao ? `Expedição do Agro ${numero}` : `Módulo ${numero}${especial ? ' · Planejamento' : ''}`;

  // Situação de cada envio: Pendente, Enviado ou Com feedback (cor e ícone próprios).
  const situacao = (x) => x?.feedback ? { classe: 'com-feedback', rotulo: 'Com feedback' }
    : x ? { classe: 'enviado', rotulo: expedicao ? 'Enviada' : 'Enviado' } : { classe: 'pendente', rotulo: 'Pendente' };
  const sit = situacao(m);
  const qtd = (lista) => (lista || []).length;
  const abaArea = (chave, href, ativa, n) => `
      <a href="${href}" class="area-${chave} ${ativa ? 'ativa' : ''}" ${ativa ? 'aria-current="page"' : ''}>
        <span class="area-icone">${icone(ICONES_TURMA[chave])}</span>
        <span class="area-texto">
          <strong>${chave === 'expedicao' ? 'Expedições do Agro' : 'Módulos'}</strong>
          <small>${n} de 8 enviad${chave === 'expedicao' ? 'as' : 'os'}</small>
          <span class="progresso"><span style="width:${(n / 8) * 100}%"></span></span>
        </span>
      </a>`;

  app.innerHTML = `
    ${voltar('#/painel', 'Minhas turmas')}
    <h1>Turma de ${esc(turma.cidade)}</h1>
    <p class="sub">${esc(turma.sindicato)} · Horário: ${esc(turma.horario)}</p>
    ${instrutor ? `
    <div class="resumo-turma">
      ${barraProgresso(enviados.length)}
      <span class="meta">${enviados.length} de 8 ${A.plural} enviados</span>
    </div>` : `
    <nav class="areas-turma" aria-label="Áreas da turma">
      ${abaArea('modulo', `#/turma/${turma.id}/1`, !expedicao, qtd(r.modulos))}
      ${abaArea('expedicao', `#/turma/${turma.id}/expedicao/1`, expedicao, qtd(r.expedicoes))}
    </nav>`}
    <ol class="passos">
      <li><b>1</b><span>Escolha ${expedicao ? 'a expedição' : 'o módulo'} na lista abaixo</span></li>
      <li><b>2</b><span>Preencha e clique em <strong>${expedicao ? 'Enviar expedição' : 'Enviar módulo'}</strong></span></li>
      <li><b>3</b><span>Precisa mudar? Use <strong>Editar envio</strong></span></li>
    </ol>
    ${numero === undefined ? `<div class="vazio">Nenhum${expedicao ? 'a expedição' : ' módulo'} está liberad${expedicao ? 'a' : 'o'} para envio no momento. Aguarde o gestor liberar.</div>` : `
    <nav class="modulos" aria-label="${expedicao ? 'Expedições' : 'Módulos'}">
      ${disponiveis.map((n) => {
        const s = situacao(enviados.find((y) => y.numero === n));
        return `<a href="${link(n)}" class="${s.classe} ${n === numero ? 'ativa' : ''}" ${n === numero ? 'aria-current="page"' : ''}>
          <span class="mod-num">${s.classe === 'pendente' ? n : icone(ICONES_TURMA[s.classe])}</span>
          <span class="mod-info"><strong>${A.nome} ${n}</strong><small class="situacao ${s.classe}">${s.rotulo}</small></span></a>`;
      }).join('')}
    </nav>
    <div class="cartao cartao-envio">
      <div class="cabecalho-envio">
        <h2>${titulo}</h2>
        <span class="situacao ${sit.classe}">${sit.rotulo}</span>
      </div>
      ${m?.feedback ? `<div class="feedback"><strong>Feedback do gestor (${esc(formatarData(m.feedback_em))}):</strong>\n${esc(m.feedback)}</div>` : ''}
      <p class="meta">${m ? datasEnvio(m) : `Ainda não enviad${expedicao ? 'a' : 'o'}.`}</p>
      ${m && !editando ? `
      <div class="detalhe">${detalheEnvio({ ...m, area }, false)}</div>
      <div class="linha-botoes">
        <button type="button" id="editar">Editar envio</button>
      </div>` : `
      <form id="f">
        ${expedicao ? formExpedicao(m) : especial ? formModulo1Especialista(m) : formModuloSimples(m, instrutor)}
        <div class="erro" id="erro"></div>
        <div class="linha-botoes">
          <button type="submit">${m ? 'Salvar alterações' : expedicao ? 'Enviar expedição' : 'Enviar módulo'}</button>
          ${m ? '<button type="button" class="secundario" id="cancelar">Cancelar</button>' : ''}
        </div>
      </form>`}
    </div>
    <div class="navegacao-modulos">
      ${anterior ? `<a class="botao secundario" href="${link(anterior)}">${SETA_ESQ}<span>${A.nome} ${anterior}</span></a>` : '<span></span>'}
      ${proximo ? `<a class="botao secundario" href="${link(proximo)}"><span>${A.nome} ${proximo}</span>${SETA_DIR}</a>` : ''}
    </div>`}
    <div class="zona-perigo">
      <button class="link perigo" id="excluir-turma">Excluir esta turma</button>
    </div>`;

  document.getElementById('excluir-turma').onclick = async () => {
    if (!confirm('Excluir esta turma e tudo o que foi enviado nos módulos e expedições dela?')) return;
    try {
      await api(`/api/turmas/${turma.id}`, { method: 'DELETE' });
      avisar('Turma excluída.');
      ir('#/painel');
    } catch (err) {
      avisar(err.message);
    }
  };

  if (numero === undefined) return;
  const f = document.getElementById('f');
  if (!f) {
    document.getElementById('editar').onclick = () => telaTurma(turma.id, area, numero, true);
    return;
  }
  const cancelar = document.getElementById('cancelar');
  if (cancelar) cancelar.onclick = () => telaTurma(turma.id, area, numero);
  const tabelas = [...f.querySelectorAll('[data-tabela]')].map((div) => [div.dataset.tabela, ligarTabela(div)]);
  f.querySelectorAll('textarea[name]').forEach(contador);
  f.querySelectorAll('input[type=text][name]').forEach((i) => {
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
      for (const el of f.querySelectorAll('input[type=text][name], textarea[name]')) corpo[el.name] = el.value;
      for (const [chave, ler] of tabelas) {
        const linhas = ler();
        const ruim = linhas.findIndex((l) => l.valor?.trim() && lerValor(l.valor) == null);
        if (ruim >= 0) throw new Error(`Valor inválido no orçamento do módulo ${ruim + 1}. Use só números, por exemplo 1.250,00.`);
        corpo[chave] = linhas;
      }
      corpo.removerAnexos = [...f.querySelectorAll('input[name=removerAnexos]:checked')].map((c) => c.value);
      corpo.anexos = await enviarArquivos(f.anexos.files, instrutor || expedicao, botao);
      await api(`/api/turmas/${turma.id}/${expedicao ? 'expedicoes' : 'modulos'}/${numero}`, { json: corpo });
      avisar(m ? `Alterações ${expedicao ? 'da expedição' : 'do módulo'} ${numero} salvas.` : `${A.nome} ${numero} enviad${expedicao ? 'a' : 'o'}.`);
      telaTurma(turma.id, area, numero);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
      botao.disabled = false;
      botao.textContent = m ? 'Salvar alterações' : expedicao ? 'Enviar expedição' : 'Enviar módulo';
    }
  };
}

// ---------- admin ----------

function telaAdminLogin(erro) {
  desenharTopo('');
  app.innerHTML = `
    <div class="centro cartao">
      <h1>Acesso do gestor</h1>
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

// Caixa de feedback de um envio: cada envio tem a sua.
// O selo no topo diz se o feedback é de um módulo ou de uma expedição.
function caixaFeedbackEnvio(e) {
  const expedicao = e.area === 'expedicao';
  const alvo = `${expedicao ? 'da' : 'do'} ${nomeEnvio(e)}`;
  return `<form class="fb ${e.feedback ? 'com' : ''}" data-id="${e.id}">
      <div class="fb-alvo">Feedback ${expedicao ? 'da' : 'do'} <span class="selo-area ${expedicao ? 'expedicao' : 'modulo'}">${expedicao ? 'Expedição do Agro' : 'Módulo'} ${e.numero}</span></div>
      <textarea name="feedback" maxlength="${MAX}" aria-label="Feedback ${alvo}" placeholder="Escreva o feedback ${alvo.toLowerCase()}">${esc(e.feedback || '')}</textarea>
      <div class="fb-rodape">
        <span class="fb-estado">${e.feedback ? `✓ Enviado em ${esc(formatarData(e.feedback_em))}` : 'Sem feedback'}</span>
        <button type="submit">${e.feedback ? 'Atualizar' : 'Enviar'}</button>
      </div>
    </form>`;
}

// Envia o feedback de qualquer caixa dentro do container e atualiza só aquela caixa.
function ligarFeedbacks(container, envios, depois) {
  container.onsubmit = async (ev) => {
    const form = ev.target.closest('form.fb');
    if (!form) return;
    ev.preventDefault();
    const texto = form.feedback.value.trim();
    if (!texto) return avisar('Escreva o feedback.');
    const botao = form.querySelector('button');
    botao.disabled = true;
    botao.textContent = 'Enviando...';
    try {
      await api('/api/admin/feedback', { json: { ids: [Number(form.dataset.id)], feedback: texto } });
      const e = envios.find((x) => x.id === Number(form.dataset.id));
      Object.assign(e, { feedback: texto, feedback_em: new Date().toISOString() });
      form.closest('.sem-fb, .pendente')?.classList.remove('sem-fb', 'pendente');
      form.outerHTML = caixaFeedbackEnvio(e);
      avisar('Feedback enviado.');
      depois?.();
    } catch (err) {
      avisar(err.message);
      botao.disabled = false;
      botao.textContent = 'Enviar';
    }
  };
}

// Exclusões do gestor: sempre pedem confirmação antes.
async function excluirEnvio(e) {
  const nome = `${e.area === 'expedicao' ? 'da' : 'do'} ${nomeEnvio(e).toLowerCase()}`;
  if (!confirm(`Excluir o envio ${nome} de ${e.nome || 'esta pessoa'}?\n\nO conteúdo, os anexos, o histórico e o feedback são apagados e a pessoa precisará enviar de novo.`)) return false;
  try {
    await api(`/api/admin/envios/${e.id}`, { method: 'DELETE' });
    avisar(`Envio ${nome} excluído. A pessoa precisa enviar de novo.`);
    return true;
  } catch (err) {
    avisar(err.message);
    return false;
  }
}

async function excluirUsuario(u) {
  if (!confirm(`Excluir ${u.nome}?\n\nO cadastro, as turmas, todos os envios, as postagens no fórum, as mensagens e as perguntas dessa pessoa são apagados. Não dá para desfazer.`)) return false;
  try {
    await api(`/api/admin/usuarios/${u.id}`, { method: 'DELETE' });
    avisar(`${u.nome} foi excluído(a).`);
    return true;
  } catch (err) {
    avisar(err.message);
    return false;
  }
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
  const semFeedback = envios.filter((e) => !e.feedback).length;
  const modulosEnv = envios.filter((e) => e.area !== 'expedicao').length;

  const blocoEnvio = (e) => `
    <div class="cartao envio ${e.feedback ? '' : 'pendente'}">
      <div class="envio-conteudo">
        <div class="envio-topo">
          <strong>${nomeEnvio(e)}</strong>
          <span class="meta">${datasEnvio(e)}</span>
        </div>
        <div class="detalhe">${detalheEnvio(e, false)}</div>
        <button class="link perigo" data-excluir-envio="${e.id}">excluir envio</button>
      </div>
      ${caixaFeedbackEnvio(e)}
    </div>`;

  app.innerHTML = `
    ${voltar('#/admin', 'Painel do gestor')}
    <div class="cartao perfil-publico">
      ${avatar(u.foto, 'enorme')}
      <div>
        <h1>${esc(u.nome)}</h1>
        <span class="tag">${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'}</span>
        <p class="meta" style="margin:8px 0 0">CPF ${esc(mascaraCpf(u.cpf))}${u.email ? ` · <a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : ''} · cadastro em ${esc(formatarData(u.criado_em))}</p>
        <p class="meta" style="margin:0">${turmas.length} turma${turmas.length === 1 ? '' : 's'} · ${modulosEnv} módulo${modulosEnv === 1 ? '' : 's'} enviado${modulosEnv === 1 ? '' : 's'}${u.tipo === 'especialista' ? ` · ${envios.length - modulosEnv} expedição${envios.length - modulosEnv === 1 ? '' : 'ões'} enviada${envios.length - modulosEnv === 1 ? '' : 's'}` : ''} · ${semFeedback} sem feedback</p>
        ${linksRedes(u.redes)}
      </div>
    </div>
    <div>
        ${turmas.map((t) => {
          const daTurma = (area) => envios.filter((e) => e.turma_id === t.id && (e.area || 'modulo') === area)
            .sort((a, b) => a.numero - b.numero);
          const parte = (area) => {
            const lista = daTurma(area);
            const { plural } = AREAS[area];
            const pendentes = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !lista.some((e) => e.numero === n));
            return `${area === 'expedicao' ? '<h3>Expedições do Agro</h3>' : ''}
              ${barraProgresso(lista.length)}
              <p class="meta">${lista.length} de 8 ${plural} enviad${area === 'expedicao' ? 'as' : 'os'}${pendentes.length ? ` · pendentes: ${pendentes.join(', ')}` : ''}</p>
              ${lista.map(blocoEnvio).join('') || `<div class="vazio">Nenhum${area === 'expedicao' ? 'a expedição enviada' : ' módulo enviado'} nesta turma.</div>`}`;
          };
          return `<section class="turma-ficha">
            <h2>Turma de ${esc(t.cidade)} <span class="meta">${esc(t.sindicato)} · ${esc(t.horario)}</span></h2>
            ${parte('modulo')}
            ${u.tipo === 'especialista' ? parte('expedicao') : ''}
          </section>`;
        }).join('') || '<div class="vazio">Esta pessoa ainda não cadastrou turmas.</div>'}
    </div>
    <div class="zona-perigo">
      <button class="link perigo" id="excluir-usuario">Excluir esta pessoa</button>
    </div>`;

  ligarFeedbacks(app, envios);
  document.getElementById('excluir-usuario').onclick = async () => {
    if (await excluirUsuario(u)) ir('#/admin');
  };
  app.onclick = async (ev) => {
    const b = ev.target.closest('[data-excluir-envio]');
    if (!b) return;
    const e = envios.find((x) => x.id === Number(b.dataset.excluirEnvio));
    if (await excluirEnvio({ ...e, nome: u.nome })) telaAdminUsuario(u.id);
  };
}

// "Enviado em ... · editado 2 vezes, a última em ...".
function datasEnvio(e) {
  const enviado = `Enviado em ${esc(formatarData(e.enviado_em || e.atualizado_em))}`;
  const n = e.edicoes ?? e.historico?.length ?? 0;
  if (!n) return enviado;
  return `${enviado} · editado ${n === 1 ? '1 vez' : `${n} vezes`}, a última em ${esc(formatarData(e.atualizado_em))}`;
}

// Campos de um envio como [rótulo, valor, html?], na ordem do formulário. As tabelas
// trazem o html para ler e o valor em texto, que o histórico compara.
// As versões do histórico não trazem a área: vem do envio atual.
function camposEnvio(e, area = e.area) {
  const itens = [];
  if (area === 'expedicao') {
    for (const c of CAMPOS_EXPEDICAO) itens.push([c.rotulo, e.dados?.[c.chave]]);
  } else if (e.dados) {
    for (const c of CAMPOS) {
      if (!c.chave) continue;
      if (!c.tabela) {
        itens.push([c.rotulo, e.dados[c.chave]]);
        continue;
      }
      const { texto, html } = leituraTabela(c, e.dados);
      itens.push([c.rotulo, texto, html]);
    }
  } else {
    itens.push(['Texto', e.texto]);
  }
  return itens;
}

// Histórico para o gestor: cada edição mostra o que mudou da versão anterior para a seguinte.
function historicoEnvio(e) {
  const hist = e.historico || [];
  if (!hist.length) return '';
  const versoes = [...hist, e];
  const edicoes = hist.map((antes, i) => {
    const depois = versoes[i + 1];
    const a = camposEnvio(antes, e.area);
    const d = camposEnvio(depois, e.area);
    const campos = d.filter(([, v], j) => (v || '') !== (a[j]?.[1] || '')).map(([rotulo, v]) => {
      const anterior = a.find(([r]) => r === rotulo)?.[1];
      return `<div class="mudanca"><strong>${esc(rotulo)}</strong>
        <div class="antes"><span class="meta">Antes</span>${esc(anterior) || '<span class="meta">(vazio)</span>'}</div>
        <div class="depois"><span class="meta">Depois</span>${esc(v) || '<span class="meta">(vazio)</span>'}</div></div>`;
    });
    const urlsAntes = new Set((antes.anexos || []).map((x) => x.url));
    const urlsDepois = new Set((depois.anexos || []).map((x) => x.url));
    const incluidos = (depois.anexos || []).filter((x) => !urlsAntes.has(x.url));
    const removidos = (antes.anexos || []).filter((x) => !urlsDepois.has(x.url));
    if (incluidos.length) campos.push(`<div class="mudanca"><strong>Anexos incluídos</strong>${blocoAnexos(incluidos)}</div>`);
    if (removidos.length) campos.push(`<div class="mudanca"><strong>Anexos removidos</strong>${blocoAnexos(removidos)}</div>`);
    const posFeedback = e.feedback_em && new Date(antes.editado_em) > new Date(e.feedback_em);
    return `<li><div class="meta">Edição de ${esc(formatarData(antes.editado_em))}${posFeedback ? ' · <span class="tag novo">depois do feedback</span>' : ''}</div>
      ${campos.join('') || '<p class="meta">Sem mudanças no conteúdo.</p>'}</li>`;
  }).reverse();
  return `<details class="historico"><summary>Histórico de edições (${hist.length})</summary>
    <p class="meta">Primeiro envio em ${esc(formatarData(e.enviado_em || hist[0].versao_de))}. Da edição mais recente para a mais antiga.</p>
    <ol>${edicoes.join('')}</ol></details>`;
}

function detalheEnvio(e, mostrarFeedback = true) {
  const itens = camposEnvio(e);
  return `<dl>${itens.map(([k, v, html]) => `<dt>${esc(k)}</dt><dd>${html || esc(v) || '<span class="meta">(vazio)</span>'}</dd>`).join('')}</dl>
    ${blocoAnexos(e.anexos)}
    ${mostrarFeedback && e.feedback ? `<div class="feedback" style="margin-top:12px"><strong>Feedback enviado (${esc(formatarData(e.feedback_em))}):</strong>\n${esc(e.feedback)}</div>` : ''}
    ${historicoEnvio(e)}`;
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
  const ocultos = dados.ocultos || { especialista: [], instrutor: [] };
  const expedicoesOcultas = dados.expedicoesOcultas || [];
  const filtro = { tipo: '', modulo: '', feedback: '', busca: '' };
  const abertos = new Set();

  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>Painel do gestor</h1><p class="sub">Cada linha é um envio. Escreva o feedback na caixa ao lado dele e clique em Enviar.</p></div>
      <a class="botao-grande" href="#/admin-avisos">+ Enviar aviso</a>
    </div>
    <div class="numeros">
      <div class="cartao"><strong>${usuarios.length}</strong><span>cadastrados</span></div>
      <div class="cartao"><strong>${envios.filter((e) => e.area !== 'expedicao').length}</strong><span>módulos enviados</span></div>
      <div class="cartao"><strong>${envios.filter((e) => e.area === 'expedicao').length}</strong><span>expedições enviadas</span></div>
      <div class="cartao"><strong>${envios.filter((e) => !e.feedback).length}</strong><span>aguardando feedback</span></div>
    </div>
    <div class="filtros">
      <input id="busca" type="text" placeholder="Buscar por nome, CPF, cidade, sindicato...">
      <select id="tipo"><option value="">Todos os perfis</option><option value="especialista">Especialistas</option><option value="instrutor">Instrutores</option></select>
      <select id="modulo"><option value="">Módulos e expedições</option>
        <option value="modulo">Só módulos</option><option value="expedicao">Só expedições</option>
        ${['modulo', 'expedicao'].map((a) => `<optgroup label="${a === 'modulo' ? 'Módulos' : 'Expedições do Agro'}">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${a}:${n}">${AREAS[a].nome} ${n}</option>`).join('')}</optgroup>`).join('')}</select>
      <select id="feedback"><option value="">Com e sem feedback</option><option value="nao">Sem feedback</option><option value="sim">Com feedback</option></select>
    </div>
    <details class="cartao modulos-liberados" id="liberados">
      <summary><strong>Módulos e expedições liberados para envio</strong>
        <span class="meta">${['especialista', 'instrutor'].map((t) => `${nomeTipo(t)}: ${8 - ocultos[t].length} de 8`).join(' · ')} · Expedições: ${8 - expedicoesOcultas.length} de 8</span></summary>
      <p class="ajuda">Desmarque os módulos e as expedições que ainda não devem aparecer. Os ocultos somem da tela da turma e não aceitam envio; o que já foi enviado continua guardado.</p>
      <form id="f-liberados">
        ${['especialista', 'instrutor'].map((t) => `
          <fieldset><legend>${t === 'especialista' ? 'Especialistas' : 'Instrutores'}</legend>
            ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<label class="check"><input type="checkbox" name="${t}" value="${n}" ${ocultos[t].includes(n) ? '' : 'checked'}> Módulo ${n}</label>`).join('')}
          </fieldset>`).join('')}
        <fieldset><legend>Expedições do Agro (especialistas)</legend>
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<label class="check"><input type="checkbox" name="expedicao" value="${n}" ${expedicoesOcultas.includes(n) ? '' : 'checked'}> Expedição ${n}</label>`).join('')}
        </fieldset>
        <div class="linha-botoes"><button type="submit">Salvar liberados</button></div>
      </form>
    </details>
    <h2>Envios</h2>
    <div class="tabela"><table class="tabela-envios">
      <thead><tr>
        <th>Nome</th><th>Turma</th><th>Envio</th><th>Enviado em</th><th class="col-fb">Feedback</th>
      </tr></thead>
      <tbody id="corpo"></tbody>
    </table></div>
    <h2>Cadastrados</h2>
    <p class="ajuda">Clique no nome para abrir a ficha da pessoa, com todos os envios.</p>
    <div class="tabela"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>E-mail</th><th>Perfil</th><th>Turmas</th><th>Envios</th><th>Cadastro</th><th></th></tr></thead>
      <tbody id="cadastrados">${usuarios.map((u) => `<tr><td><a href="#/admin/usuario/${u.id}"><strong>${esc(u.nome)}</strong></a></td><td>${esc(mascaraCpf(u.cpf))}</td><td>${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : '<span class="meta">—</span>'}</td><td>${nomeTipo(u.tipo)}</td><td>${u.turmas}</td>
        <td><strong>${u.envios}</strong> de ${u.turmas * 8}${u.tipo === 'especialista' ? `<div class="meta">${u.expedicoes} de ${u.turmas * 8} expedições</div>` : ''}${u.sem_feedback ? `<div class="meta"><span class="tag novo">${u.sem_feedback} sem feedback</span></div>` : ''}</td>
        <td>${esc(formatarData(u.criado_em))}</td>
        <td><button class="link perigo" data-excluir-usuario="${u.id}">excluir</button></td></tr>`).join('') || '<tr><td colspan="8" class="meta">Ninguém cadastrado ainda.</td></tr>'}</tbody>
    </table></div>`;

  const corpo = document.getElementById('corpo');
  const visiveis = () => envios.filter((e) => {
    if (filtro.tipo && e.tipo !== filtro.tipo) return false;
    if (filtro.modulo) {
      const [area, n] = filtro.modulo.split(':');
      if ((e.area || 'modulo') !== area || (n && e.numero !== Number(n))) return false;
    }
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
      <tr class="${e.feedback ? '' : 'sem-fb'}">
        <td><a href="#/admin/usuario/${e.usuario_id}"><strong>${esc(e.nome)}</strong></a><div class="meta">${nomeTipo(e.tipo)}</div></td>
        <td>${esc(e.cidade)}<div class="meta">${esc(e.sindicato)} · ${esc(e.horario)}</div></td>
        <td><strong>${nomeEnvio(e)}</strong><div><button class="link" data-ver="${e.id}">${abertos.has(e.id) ? 'fechar envio' : 'ver envio'}</button></div>
          <div><button class="link perigo" data-excluir-envio="${e.id}">excluir</button></div></td>
        <td>${esc(formatarData(e.enviado_em || e.atualizado_em))}${e.edicoes ? `<div class="meta"><span class="tag">editado ${e.edicoes === 1 ? '1 vez' : `${e.edicoes} vezes`}</span></div><div class="meta">última em ${esc(formatarData(e.atualizado_em))}</div>` : ''}</td>
        <td class="col-fb">${caixaFeedbackEnvio(e)}</td>
      </tr>
      ${abertos.has(e.id) && detalhes.has(e.id) ? `<tr class="detalhe"><td colspan="5">${detalheEnvio({ area: e.area, ...detalhes.get(e.id) }, false)}</td></tr>` : ''}`).join('')
      || '<tr><td colspan="5" class="meta">Nenhum envio encontrado.</td></tr>';
  }

  // A lista vem sem os textos; o conteúdo de cada envio é buscado ao abrir.
  const detalhes = new Map();
  corpo.onclick = async (ev) => {
    const excluir = ev.target.closest('[data-excluir-envio]');
    if (excluir) {
      const e = envios.find((x) => x.id === Number(excluir.dataset.excluirEnvio));
      if (await excluirEnvio(e)) telaAdmin();
      return;
    }
    const ver = ev.target.closest('[data-ver]');
    if (!ver) return;
    const id = Number(ver.dataset.ver);
    if (abertos.has(id)) {
      abertos.delete(id);
      return desenhar();
    }
    if (!detalhes.has(id)) {
      ver.disabled = true;
      ver.textContent = 'abrindo...';
      try {
        detalhes.set(id, (await api(`/api/admin/envios/${id}`)).envio);
      } catch (err) {
        avisar(err.message);
        return desenhar();
      }
    }
    abertos.add(id);
    desenhar();
  };
  for (const k of ['tipo', 'modulo', 'feedback']) {
    document.getElementById(k).onchange = (ev) => { filtro[k] = ev.target.value; desenhar(); };
  }
  document.getElementById('busca').oninput = (ev) => { filtro.busca = ev.target.value.trim(); desenhar(); };
  ligarFeedbacks(corpo, envios);
  desenhar();

  document.getElementById('cadastrados').onclick = async (ev) => {
    const b = ev.target.closest('[data-excluir-usuario]');
    if (!b) return;
    if (await excluirUsuario(usuarios.find((u) => u.id === Number(b.dataset.excluirUsuario)))) telaAdmin();
  };

  document.getElementById('f-liberados').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const corpoOcultos = {};
    for (const t of ['especialista', 'instrutor']) {
      corpoOcultos[t] = [...f.querySelectorAll(`input[name=${t}]`)].filter((c) => !c.checked).map((c) => Number(c.value));
    }
    const expedicoes = [...f.querySelectorAll('input[name=expedicao]')].filter((c) => !c.checked).map((c) => Number(c.value));
    const botao = f.querySelector('button');
    botao.disabled = true;
    try {
      await api('/api/admin/modulos-ocultos', { json: corpoOcultos });
      await api('/api/admin/expedicoes-ocultas', { json: { ocultas: expedicoes } });
      avisar('Módulos liberados atualizados.');
      await telaAdmin();
      document.getElementById('liberados').open = true;
    } catch (err) {
      avisar(err.message);
      botao.disabled = false;
    }
  };
}

// ---------- perfil ----------

const REDES = [
  { chave: 'whatsapp', nome: 'WhatsApp', exemplo: '(16) 99999-8888' },
  { chave: 'instagram', nome: 'Instagram', exemplo: 'instagram.com/seuperfil' },
  { chave: 'facebook', nome: 'Facebook', exemplo: 'facebook.com/seuperfil' },
  { chave: 'linkedin', nome: 'LinkedIn', exemplo: 'linkedin.com/in/seuperfil' },
  { chave: 'site', nome: 'Site', exemplo: 'www.seusite.com.br' },
];

// 5516999998888 -> (16) 99999-8888
function formatarWhatsapp(n) {
  const d = String(n || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function mascaraWhatsapp(v) {
  const d = String(v).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function linksRedes(redes) {
  const itens = REDES.filter((r) => redes?.[r.chave]);
  if (!itens.length) return '';
  return `<div class="redes">${itens.map((r) => r.chave === 'whatsapp'
    ? `<a class="botao whatsapp" href="https://wa.me/${esc(String(redes.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener nofollow">WhatsApp ${esc(formatarWhatsapp(redes.whatsapp))}</a>`
    : `<a class="botao secundario" href="${esc(redes[r.chave])}" target="_blank" rel="noopener nofollow">${r.nome}</a>`).join('')}</div>`;
}

async function telaPerfil() {
  const u = await exigirUsuario();
  if (!u) return;
  const redes = u.redes || {};
  const faltando = [!u.email && 'o seu e-mail', !redes.whatsapp && 'o seu WhatsApp'].filter(Boolean);
  app.innerHTML = `
    ${voltar('#/painel', 'Minhas turmas')}
    <h1>Meu perfil</h1>
    <p class="sub">Os campos com ${OBRIG} são obrigatórios; o resto é opcional. Seu e-mail e CPF só o gestor vê; o WhatsApp aparece no seu perfil.</p>
    ${faltando.length ? `<p class="alerta-email">Falta ${faltando.join(' e ')}. Preencha abaixo e salve o perfil.</p>` : ''}
    <form id="f" class="cartao">
      <label style="margin-top:0">Foto do perfil ${OPCIONAL}</label>
      <div class="foto-perfil">
        <span class="avatar grande" id="previa" style="${u.foto ? `background-image:url('${esc(u.foto)}')` : ''}"></span>
        <div style="flex:1">
          <input id="foto" name="foto" type="file" accept="image/*">
          ${u.foto ? '<label class="remover-foto"><input type="checkbox" name="removerFoto"> remover foto atual</label>' : ''}
        </div>
      </div>
      <label for="nome">Nome completo ${OBRIG}</label>
      <input id="nome" name="nome" type="text" maxlength="200" value="${esc(u.nome)}" required>
      <label for="email">E-mail ${OBRIG}</label>
      <input id="email" name="email" type="email" maxlength="200" autocomplete="email" placeholder="seunome@email.com" value="${esc(u.email || '')}" required>
      ${campoWhatsapp(redes)}
      <label>Perfil</label>
      <p class="meta" style="margin:0">${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'} · CPF ${esc(mascaraCpf(u.cpf))}</p>
      <h2>Redes sociais ${OPCIONAL}</h2>
      <p class="ajuda">Cole o link do seu perfil. Deixe em branco o que não usa.</p>
      ${camposRedes(redes)}
      <div class="erro" id="erro"></div>
      <div class="linha-botoes">
        <button type="submit">Salvar perfil</button>
        <a class="botao secundario" href="#/perfil/${u.id}">Ver como os outros veem</a>
      </div>
    </form>`;
  const f = document.getElementById('f');
  f.whatsapp.oninput = () => (f.whatsapp.value = mascaraWhatsapp(f.whatsapp.value));
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
        email: f.email.value,
        foto: arq ? await enviarArquivo(arq, true, 400) : null,
        removerFoto: Boolean(f.removerFoto?.checked),
        redes: lerCamposRedes(f),
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
    ${voltar('#/participantes', 'Participantes')}
    <div class="cartao perfil-publico">
      ${avatar(perfil.foto, 'enorme')}
      <div>
        <h1>${esc(perfil.nome)}</h1>
        <span class="tag">${nomeTipo(perfil.tipo)}</span>
        ${linksRedes(perfil.redes) || '<p class="meta">Nenhuma rede social informada.</p>'}
        <p class="linha-botoes">
          ${meu ? '<a class="botao" href="#/perfil">Editar meu perfil</a>' : ''}
          ${!meu && leitor.usuario ? `<a class="botao" href="#/mensagens/${perfil.id}">Enviar mensagem</a>` : ''}
          ${leitor.admin ? `<a class="botao secundario" href="#/admin/usuario/${perfil.id}">Ver envios (gestor)</a>` : ''}
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
    ${voltar('#/mensagens', 'Mensagens')}
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
    <p class="sub">Cartilhas, arquivos do Google Drive e outros materiais de apoio. ${admin ? 'Só você (gestor) pode adicionar ou apagar.' : 'Clique em <strong>Abrir</strong> para ver o material.'}</p>
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
      ${p.resposta ? `<div class="feedback" style="margin:12px 0 0"><strong>Resposta do gestor (${esc(formatarData(p.respondida_em))}):</strong>\n${esc(p.resposta)}</div>` : ''}
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
    <h1>Perguntas ao gestor</h1>
    <p class="sub">Tem alguma dúvida? Escreva aqui. Só você e o gestor veem a pergunta e a resposta.</p>
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
  const pendentes = avisos.filter((a) => !a.ciente_em).length;
  app.innerHTML = `
    <h1>Avisos</h1>
    <p class="sub">Comunicados enviados pela coordenação.${pendentes ? ' Depois de ler, clique em <strong>Ciente</strong> para confirmar.' : ''}</p>
    ${avisos.map((a) => cartaoAviso(a)).join('') || '<div class="vazio">Nenhum aviso por enquanto.</div>'}`;
  mostrarNaoLidos(avisos);
  app.onclick = async (ev) => {
    const b = ev.target.closest('[data-ciente]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      const { ciente_em } = await api(`/api/avisos/${b.dataset.ciente}/ciente`, { method: 'POST' });
      const a = avisos.find((x) => String(x.id) === b.dataset.ciente);
      a.ciente_em = ciente_em;
      const cartao = b.closest('.aviso-item');
      cartao.classList.remove('novo');
      cartao.querySelector('.tag.novo')?.remove();
      b.outerHTML = rodapeCiente(a);
      mostrarNaoLidos(avisos);
    } catch (err) {
      b.disabled = false;
      avisar(err.message);
    }
  };
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
    <p class="sub">Os avisos aparecem para os usuários na tela inicial do painel e no menu Avisos. A notificação só some depois que a pessoa clica em Ciente; abra a contagem em cada aviso para ver quem já deu ciente e quando.</p>
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
    ${avisos.map((a) => cartaoAviso(a, { gestor: true })).join('') || '<div class="vazio">Nenhum aviso enviado ainda.</div>'}`;

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

function imagensForum(urls) {
  return (urls || []).map((url) => `<a class="imagem-forum" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Imagem enviada" loading="lazy"></a>`).join('');
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
          ${campoArquivos('imagens', `Imagens ${OPCIONAL}`, { imagem: true })}
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
      const imagens = (await enviarArquivos(f.imagens.files, true, botao)).map((a) => a.url);
      const { topico } = await api(`/api/forum/${forum.chave}`, { json: { titulo: f.titulo.value, texto: f.texto.value, imagens } });
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
    ${voltar(`#/forum/${topico.forum}`, `Fórum ${esc(forum.nome)}`)}
    <div class="cartao">
      <h1>${esc(topico.titulo)}</h1>
      <div class="meta">${autor(topico)} · ${esc(formatarData(topico.criado_em))}
        ${podeApagar(topico) ? '<button class="link perigo" data-apagar-topico>apagar tópico</button>' : ''}</div>
      <div class="mensagem">${esc(topico.texto)}</div>
      ${imagensForum(topico.imagens)}
    </div>
    <h2>${respostas.length} resposta${respostas.length === 1 ? '' : 's'}</h2>
    ${respostas.map((r) => `
      <div class="cartao resposta">
        <div class="meta">${autor(r)} · ${esc(formatarData(r.criado_em))}
          ${podeApagar(r) ? `<button class="link perigo" data-apagar-resposta="${r.id}">apagar</button>` : ''}</div>
        <div class="mensagem">${esc(r.texto)}</div>
        ${imagensForum(r.imagens)}
      </div>`).join('')}
    ${podePublicar ? `
      <form id="f" class="cartao">
        <label for="texto" style="margin-top:0">Sua resposta</label>
        <textarea id="texto" name="texto" maxlength="${MAX}"></textarea>
        <div class="contador"></div>
        ${campoArquivos('imagens', `Imagens ${OPCIONAL}`, { imagem: true })}
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
      const imagens = (await enviarArquivos(f.imagens.files, true, botao)).map((a) => a.url);
      await api(`/api/forum/topico/${topico.id}/respostas`, { json: { texto: f.texto.value, imagens } });
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
      case 'turma': return partes[2] === 'expedicao'
        ? await telaTurma(partes[1], 'expedicao', partes[3])
        : await telaTurma(partes[1], 'modulo', partes[2]);
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
