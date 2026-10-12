# Fllatech Money API

API NestJS do Livro Caixa, contas financeiras e categorias, persistida em PostgreSQL.

## Desenvolvimento

1. Configure `DATABASE_URL` no arquivo `.env` usando `.env.example` como referência.
2. Instale as dependências com `pnpm install`.
3. Inicie a API com `pnpm start:dev`.

Na inicialização, a API aplica as migrações SQL pendentes. A migração inicial cria as contas e categorias operacionais e não importa lançamentos fictícios. As operações usam PostgreSQL `NUMERIC(14,2)` e retornam valores monetários como strings decimais.

## Recursos

- `/cash-book`: CRUD, consulta filtrada e resumo mensal do Livro Caixa.
- `/transfers`: criação, edição e exclusão lógica de transferências em transação atômica.
- `/financial-accounts`: consulta e cadastro de contas, com saldo e data de referência.
- `/financial-categories`: consulta e cadastro de categorias de receita e despesa.

O frontend usa `/api` em desenvolvimento, encaminhado pelo proxy do Vite para a API local. Configure `VITE_API_BASE_URL` para a URL direta da API quando publicar o frontend. `FRONTEND_ORIGIN` limita o CORS da API; no desenvolvimento pode ficar em `http://localhost:5173`.

## Verificação

- `pnpm test`
- `pnpm test:e2e` (usa o PostgreSQL configurado em `DATABASE_URL`)
- `pnpm build`
- `pnpm lint`
