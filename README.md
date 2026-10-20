# JEA · Sistema de turmas

Sistema web com acesso por CPF para especialistas e instrutores cadastrarem turmas e preencherem os 8 módulos, e um painel admin para ver todos os envios e dar feedback em massa.

## Publicar na Vercel (https://jea.senarsp.com.br)

A Vercel faz o deploy direto do GitHub a cada push na `main`. O projeto já vem configurado (`vercel.json`): as páginas saem da pasta `public/` e a API roda como função serverless em `api/index.js`.

1. Na Vercel, **Add New → Project** e importe o repositório `ala16/jea` (Framework Preset: *Other*, sem build).
2. Em **Storage**, crie e conecte ao projeto:
   - um banco **Postgres** (Neon). Ele cria a variável `DATABASE_URL`; as tabelas são criadas sozinhas no primeiro acesso.
   - um **Blob** com acesso *público*. Ele cria a variável `BLOB_READ_WRITE_TOKEN`.
3. Em **Settings → Environment Variables**, adicione:
   - `ADMIN_PASSWORD`: a senha do acesso admin.
   - `SESSION_SECRET` (opcional): um texto longo e aleatório. Sem ele, a chave da sessão é derivada do `DATABASE_URL`.
4. Faça um novo deploy (**Deployments → Redeploy**) para as variáveis valerem.
5. Em **Settings → Domains**, adicione `jea.senarsp.com.br`. No DNS do `senarsp.com.br`, crie o registro que a Vercel mostrar (normalmente `CNAME jea → cname.vercel-dns.com`).

Fotos e anexos (até 5MB) vão do navegador direto para o Vercel Blob, porque as funções da Vercel só aceitam requisições de até 4,5MB. Os links dos arquivos têm um sufixo aleatório e não são listados em lugar nenhum, mas quem tiver o link consegue abrir.

## Capacidade (até 500 inscritos)

O sistema está ajustado para 500 pessoas usando ao mesmo tempo (cadastro, módulos, fórum, mensagens e imagens):

- **Banco**: a conexão usa o pooler da Neon (endereço `-pooler`, aceito automaticamente), que suporta milhares de conexões simultâneas. As tabelas só são alteradas quando o esquema muda, e há índices para perfis, fórum, mensagens e o painel do gestor.
- **Imagens**: o navegador reduz as fotos antes de enviar (até 1600px; foto de perfil até 400px), deixando cada uma com algumas centenas de KB. Com 500 pessoas e 8 módulos, o Blob fica na faixa de 1 a 2GB. As imagens carregam só quando aparecem na tela.
- **Painel do gestor**: a lista de envios vem sem os textos, que são buscados ao clicar em "ver envio", para não passar do limite de 4,5MB por resposta da Vercel.

Planos: no gratuito (Hobby) da Vercel o Blob tem 1GB e a Neon gratuita tem 0,5GB de banco. Para 500 inscritos com imagens, vale o plano Pro da Vercel (ou um plano pago do Blob) e o Launch da Neon.

## Rodar localmente

Requer Node.js 20 ou superior. Sem `DATABASE_URL` o sistema usa um Postgres embutido (PGlite) em `data/pglite`, e sem `BLOB_READ_WRITE_TOKEN` guarda os arquivos em `data/uploads`.

```bash
npm install
ADMIN_PASSWORD=sua-senha npm start
# abre em http://localhost:3000
```

## Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `ADMIN_PASSWORD` | Senha do acesso admin. Sem ela o admin fica desativado. |
| `SESSION_SECRET` | Chave que assina o cookie de sessão. Opcional: sem ela é derivada do `DATABASE_URL`. |
| `DATABASE_URL` | Conexão Postgres (criada pela Vercel ao conectar o Neon). `POSTGRES_URL` também é aceita. |
| `BLOB_READ_WRITE_TOKEN` | Token do Vercel Blob (criado pela Vercel ao conectar o Blob). |
| `PORT` | Porta local (padrão 3000). |
| `PGLITE_DIR` / `UPLOAD_DIR` | Pastas do banco e dos arquivos no modo local. |

## Funcionalidades

- **Entrada por CPF** (com validação dos dígitos). No primeiro acesso a pessoa informa nome completo, e-mail, WhatsApp e se é especialista ou instrutor (obrigatórios); foto e redes sociais são opcionais e podem ser preenchidos depois no perfil.
- **Painel**: cadastra quantas turmas quiser (cidade, sindicato rural e horário).
- **8 módulos por turma**:
  - Especialista, módulo 1: Planejamento (título, objetivo, missão, visão, valores, metas, cronograma, orçamento) e anexos opcionais.
  - Especialista, módulos 2 a 8: texto e anexo.
  - Instrutor, módulos 1 a 8: texto e imagem.
  - Depois de enviado, o módulo aparece só para leitura, com o botão **Editar envio**. Cada edição guarda a versão anterior (inclusive os anexos removidos) e o gestor vê o histórico de edições no envio, com o antes e depois de cada campo.
  - Textos com limite de 2000 caracteres e arquivos de até 5MB.
- **8 Expedições do Agro por turma** (só especialista), numa aba própria da turma, separada dos módulos: local, data, objetivo, resultado e fotos. Têm a mesma edição com histórico, feedback, exclusão pelo gestor e liberação (o gestor escolhe quais expedições aparecem). A expedição que antes ficava no fim do módulo 1 foi passada para a Expedição 1, com fotos, datas e feedback.
- **Perfil**: clicando na foto ou no nome no topo, a pessoa edita nome, e-mail, foto e links das redes sociais (WhatsApp, Instagram, Facebook, LinkedIn, site). No fórum, o nome do autor abre o perfil dele.
- **Participantes**: lista de especialistas e instrutores (filtro por perfil e busca). O perfil mostra as turmas, o progresso e as postagens no fórum, mas não o conteúdo dos módulos.
- **Mensagens**: conversas diretas entre participantes, com contador de não lidas no menu.
- **Fórum** com três áreas: Geral, Especialistas e Instrutores. Todos os cadastrados leem, publicam e respondem nas três. O autor pode apagar o que escreveu, e o admin pode apagar qualquer mensagem.
- **Avisos**: o admin escreve avisos para todos, só especialistas ou só instrutores. Eles aparecem no painel de quem entra e no menu Avisos, com a contagem dos não lidos.
- **Material**: o admin publica links (Google Drive, cartilhas, vídeos) nas categorias Geral, Especialista e Instrutor. Todos os cadastrados veem as três.
- **Perguntas**: cada pessoa envia dúvidas ao admin e vê só as suas; o admin vê todas, responde e o menu mostra quantas aguardam resposta.
- **Admin** (link "Acesso do gestor" na tela inicial): uma linha por envio, cada um com a sua caixa de feedback ao lado. A tabela de cadastrados mostra quantos envios cada pessoa fez. Clicar no nome abre a ficha da pessoa, com perfil, turmas e todos os envios, cada um com a sua caixa de feedback. O e-mail aparece só para o gestor, na tabela de cadastrados e na ficha. O feedback aparece para o usuário no módulo.

## Testes

```bash
npm test
```
