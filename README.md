# JEA · Sistema de turmas

Sistema web com acesso por CPF para especialistas e instrutores cadastrarem turmas e preencherem os 8 módulos, e um painel admin para ver todos os envios e dar feedback em massa.

## Como rodar

Requer Node.js 22.13 ou superior (usa o SQLite embutido do Node, sem banco externo).

```bash
npm install
ADMIN_PASSWORD=sua-senha SESSION_SECRET=um-texto-longo-aleatorio npm start
# abre em http://localhost:3000
```

## Variáveis de ambiente

| Variável | Para que serve |
| --- | --- |
| `ADMIN_PASSWORD` | Senha do acesso admin. Sem ela o admin fica desativado. |
| `SESSION_SECRET` | Chave que assina o cookie de sessão. Defina em produção, senão todos são deslogados a cada reinício. |
| `PORT` | Porta do servidor (padrão 3000). |
| `DB_PATH` | Arquivo do banco SQLite (padrão `data/jea.db`). |
| `UPLOAD_DIR` | Pasta das fotos e anexos (padrão `data/uploads`). |
| `NODE_ENV=production` | Marca o cookie como `Secure` (use com HTTPS). |

## Funcionalidades

- **Entrada por CPF** (com validação dos dígitos). No primeiro acesso a pessoa informa nome completo, foto opcional e se é especialista ou instrutor.
- **Painel**: cadastra quantas turmas quiser (número, cidade, sindicato rural, período e horário).
- **8 módulos por turma**:
  - Especialista, módulo 1: Planejamento (título, missão, objetivo, metas, valores, visão, cronograma, orçamento) e Expedição do Agro (local, data, objetivo, resultado, foto).
  - Especialista, módulos 2 a 8: texto e anexo.
  - Instrutor, módulos 1 a 8: texto e imagem.
  - Textos com limite de 2000 caracteres e arquivos de até 5MB.
- **Admin** (botão "Acesso admin" na tela inicial): lista todos os envios com filtros por perfil, módulo, feedback e busca; seleciona vários e envia o mesmo feedback para todos. O feedback aparece para o usuário no módulo.

## Testes

```bash
npm test
```
