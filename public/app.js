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

let estado = { usuario: null };

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

function desenharTopo(conteudo) {
  topoUsuario.innerHTML = conteudo || '';
  const sair = topoUsuario.querySelector('[data-sair]');
  if (sair) sair.onclick = async () => { await api('/api/sair', { method: 'POST' }); ir('#/'); };
}

function topoDoUsuario(u) {
  const foto = u.foto ? `<img class="avatar" src="${esc(u.foto)}" alt="">` : '<span class="avatar"></span>';
  desenharTopo(`<div class="usuario">${foto}<span>${esc(u.nome)} · ${u.tipo === 'especialista' ? 'Especialista' : 'Instrutor'}</span><button data-sair>Sair</button></div>`);
}

// ---------- telas ----------

function telaInicio() {
  desenharTopo('');
  app.innerHTML = `
    <div class="centro cartao">
      <h1>Bem-vindo</h1>
      <p class="sub">Digite seu CPF para entrar.</p>
      <form id="f">
        <label for="cpf">CPF</label>
        <input id="cpf" type="text" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes">
          <button type="submit">Entrar</button>
          <a class="botao secundario" href="#/admin">Acesso admin</a>
        </div>
      </form>
    </div>`;
  const cpf = document.getElementById('cpf');
  cpf.addEventListener('input', () => (cpf.value = mascaraCpf(cpf.value)));
  cpf.focus();
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/entrar', { json: { cpf: cpf.value } });
      ir(r.primeiroAcesso ? '#/cadastro' : '#/painel');
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
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
      <h1>Primeiro acesso</h1>
      <p class="sub">CPF ${esc(mascaraCpf(r.cpf))}. Complete seu cadastro.</p>
      <form id="f">
        <label for="nome">Nome completo</label>
        <input id="nome" name="nome" type="text" maxlength="200" required>
        <label for="foto">Foto <span class="ajuda">(opcional, até 5MB)</span></label>
        <input id="foto" name="foto" type="file" accept="image/*">
        <label>Você é</label>
        <div class="opcoes">
          <label><input type="radio" name="tipo" value="especialista" required>Especialista</label>
          <label><input type="radio" name="tipo" value="instrutor" required>Instrutor</label>
        </div>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes"><button type="submit">Concluir cadastro</button></div>
      </form>
    </div>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const botao = f.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const foto = f.foto.files[0];
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

async function telaPainel() {
  const u = await exigirUsuario();
  if (!u) return;
  const { turmas } = await api('/api/turmas');
  app.innerHTML = `
    <h1>Olá, ${esc(u.nome.split(' ')[0])}</h1>
    <p class="sub">Suas turmas. Cada turma tem 8 módulos para preencher.</p>
    <div class="lista-turmas">
      ${turmas.map((t) => `
        <a class="cartao turma" href="#/turma/${t.id}/1">
          <h3>Turma ${esc(t.numero)}</h3>
          <div class="meta">${esc(t.cidade)} · ${esc(t.sindicato)}</div>
          <div class="meta">${esc(t.periodo)}</div>
          <div class="meta" style="margin-top:8px">${t.modulos_enviados}/8 módulos enviados${t.feedbacks ? ` · ${t.feedbacks} com feedback` : ''}</div>
        </a>`).join('') || '<p class="meta">Você ainda não cadastrou nenhuma turma.</p>'}
    </div>
    <div class="cartao" style="margin-top:24px">
      <h2 style="margin-top:0">Cadastrar nova turma</h2>
      <form id="f">
        <div class="grade">
          <div><label for="numero">Número da turma</label><input id="numero" name="numero" type="text" maxlength="50" required></div>
          <div><label for="cidade">Cidade</label><input id="cidade" name="cidade" type="text" maxlength="200" required></div>
          <div><label for="sindicato">Sindicato rural</label><input id="sindicato" name="sindicato" type="text" maxlength="200" required></div>
          <div><label for="periodo">Período e horário</label><input id="periodo" name="periodo" type="text" maxlength="200" placeholder="Ex: Mar a Jun/2026, sábados 8h às 12h" required></div>
        </div>
        <div class="erro" id="erro"></div>
        <div class="linha-botoes"><button type="submit">Cadastrar turma</button></div>
      </form>
    </div>`;
  const f = document.getElementById('f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { turma } = await api('/api/turmas', { json: Object.fromEntries(new FormData(f)) });
      avisar('Turma cadastrada.');
      ir(`#/turma/${turma.id}/1`);
    } catch (err) {
      document.getElementById('erro').textContent = err.message;
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
    <h1>Turma ${esc(turma.numero)}</h1>
    <p class="sub">${esc(turma.cidade)} · ${esc(turma.sindicato)} · ${esc(turma.periodo)}</p>
    <nav class="abas">
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
        const enviado = modulos.some((x) => x.numero === n);
        return `<a href="#/turma/${turma.id}/${n}" class="${n === numero ? 'ativa' : ''} ${enviado ? 'enviado' : ''}">Módulo ${n}${enviado ? ' ✓' : ''}</a>`;
      }).join('')}
    </nav>
    <div class="cartao">
      <h2 style="margin-top:0">Módulo ${numero}${especial ? ' · Planejamento' : ''}</h2>
      ${m?.feedback ? `<div class="feedback"><strong>Feedback (${esc(formatarData(m.feedback_em))}):</strong>\n${esc(m.feedback)}</div>` : ''}
      ${m ? `<p class="meta">Último envio: ${esc(formatarData(m.atualizado_em))}</p>` : ''}
      <form id="f">
        ${especial ? formModulo1Especialista(m) : formModuloSimples(m, instrutor)}
        <div class="erro" id="erro"></div>
        <div class="linha-botoes">
          <button type="submit">${m ? 'Salvar alterações' : 'Enviar módulo'}</button>
          ${m?.anexo ? '<label style="margin:0;font-weight:400"><input type="checkbox" name="removerAnexo" value="1"> remover arquivo atual</label>' : ''}
        </div>
      </form>
    </div>`;

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
  desenharTopo('<div class="usuario"><span>Admin</span><button data-sair>Sair</button></div>');
  const { envios, usuarios } = dados;
  const filtro = { tipo: '', modulo: '', feedback: '', busca: '' };
  const selecionados = new Set();
  const abertos = new Set();

  app.innerHTML = `
    <h1>Painel admin</h1>
    <p class="sub">${usuarios.length} cadastrados · ${envios.length} módulos enviados</p>
    <div class="filtros">
      <input id="busca" type="text" placeholder="Buscar por nome, CPF, cidade, turma...">
      <select id="tipo"><option value="">Todos os perfis</option><option value="especialista">Especialistas</option><option value="instrutor">Instrutores</option></select>
      <select id="modulo"><option value="">Todos os módulos</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}">Módulo ${n}</option>`).join('')}</select>
      <select id="feedback"><option value="">Com e sem feedback</option><option value="nao">Sem feedback</option><option value="sim">Com feedback</option></select>
    </div>
    <h2>Envios</h2>
    <div class="tabela"><table>
      <thead><tr>
        <th><input type="checkbox" id="todos" title="Selecionar todos os visíveis"></th>
        <th>Nome</th><th>Perfil</th><th>Turma</th><th>Módulo</th><th>Enviado em</th><th>Feedback</th><th></th>
      </tr></thead>
      <tbody id="corpo"></tbody>
    </table></div>
    <div class="barra-feedback">
      <div class="cartao" style="margin:0">
        <label for="texto-feedback" style="margin-top:0">Feedback em massa <span class="meta" id="qtd"></span></label>
        <textarea id="texto-feedback" maxlength="${MAX}" placeholder="Escreva o feedback que será enviado para todos os envios selecionados"></textarea>
        <div class="linha-botoes" style="margin-top:10px"><button id="enviar">Enviar feedback aos selecionados</button></div>
      </div>
    </div>
    <h2>Cadastrados</h2>
    <div class="tabela"><table>
      <thead><tr><th>Nome</th><th>CPF</th><th>Perfil</th><th>Turmas</th><th>Cadastro</th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr><td>${esc(u.nome)}</td><td>${esc(mascaraCpf(u.cpf))}</td><td>${esc(u.tipo)}</td><td>${u.turmas}</td><td>${esc(formatarData(u.criado_em))}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">Ninguém cadastrado ainda.</td></tr>'}</tbody>
    </table></div>`;

  const corpo = document.getElementById('corpo');
  const visiveis = () => envios.filter((e) => {
    if (filtro.tipo && e.tipo !== filtro.tipo) return false;
    if (filtro.modulo && e.numero !== Number(filtro.modulo)) return false;
    if (filtro.feedback === 'sim' && !e.feedback) return false;
    if (filtro.feedback === 'nao' && e.feedback) return false;
    if (filtro.busca) {
      const alvo = `${e.nome} ${e.cpf} ${e.cidade} ${e.sindicato} ${e.turma_numero}`.toLowerCase();
      if (!alvo.includes(filtro.busca.toLowerCase().replace(/[.-]/g, '')) && !alvo.includes(filtro.busca.toLowerCase())) return false;
    }
    return true;
  });

  function desenhar() {
    const lista = visiveis();
    corpo.innerHTML = lista.map((e) => `
      <tr>
        <td><input type="checkbox" data-id="${e.id}" ${selecionados.has(e.id) ? 'checked' : ''}></td>
        <td>${esc(e.nome)}<div class="meta">${esc(mascaraCpf(e.cpf))}</div></td>
        <td>${esc(e.tipo)}</td>
        <td>${esc(e.turma_numero)}<div class="meta">${esc(e.cidade)} · ${esc(e.sindicato)}</div></td>
        <td>${e.numero}</td>
        <td>${esc(formatarData(e.atualizado_em))}</td>
        <td><span class="tag ${e.feedback ? 'sim' : ''}">${e.feedback ? 'sim' : 'não'}</span></td>
        <td><button class="link" data-ver="${e.id}">${abertos.has(e.id) ? 'fechar' : 'ver'}</button></td>
      </tr>
      ${abertos.has(e.id) ? `<tr class="detalhe"><td></td><td colspan="7">${detalheEnvio(e)}</td></tr>` : ''}`).join('')
      || '<tr><td colspan="8" class="meta">Nenhum envio encontrado.</td></tr>';
    const todos = document.getElementById('todos');
    todos.checked = lista.length > 0 && lista.every((e) => selecionados.has(e.id));
    document.getElementById('qtd').textContent = `(${selecionados.size} selecionado${selecionados.size === 1 ? '' : 's'})`;
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
  document.getElementById('enviar').onclick = async () => {
    const texto = document.getElementById('texto-feedback').value.trim();
    if (!selecionados.size) return avisar('Selecione ao menos um envio.');
    if (!texto) return avisar('Escreva o feedback.');
    try {
      const r = await api('/api/admin/feedback', { json: { ids: [...selecionados], feedback: texto } });
      avisar(`Feedback enviado para ${r.atualizados} envio(s).`);
      telaAdmin();
    } catch (err) {
      avisar(err.message);
    }
  };
  desenhar();
}

// ---------- rotas ----------

async function rotear() {
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  try {
    switch (partes[0]) {
      case '': return telaInicio();
      case 'cadastro': return await telaCadastro();
      case 'painel': return await telaPainel();
      case 'turma': return await telaTurma(partes[1], partes[2]);
      case 'admin': return await telaAdmin();
      default: return ir('#/');
    }
  } catch (err) {
    app.innerHTML = `<div class="cartao erro">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', rotear);
rotear();
