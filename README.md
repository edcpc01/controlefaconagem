# Façonagem Rhodia — PWA de Controle de Entradas e Saídas

Sistema PWA para controle de façonagem com lógica FIFO de alocação de NFs.

---

## Stack

- **Frontend**: React + Vite + PWA (vite-plugin-pwa)
- **Banco de Dados**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **Versionamento**: GitHub

---

## Regras de Negócio

### Abatimento de 1,5%
Os seguintes tipos de saída têm **abatimento de 1,5%** sobre o volume em kg:
- Faturamento
- Sucata
- Estopa

**Exemplo**: Estopa, 500 kg → Volume abatido = 492,5 kg

Os tipos de **devolução** (Qualidade, Processo, Final de Campanha) **não têm abatimento**.

### Alocação FIFO
As saídas são alocadas nas NFs de entrada pela ordem de **data de emissão mais antiga** (FIFO):
1. O volume da saída (já com abatimento) é descontado da NF mais antiga com saldo.
2. Quando a NF zera, o restante é descontado da próxima NF mais antiga.
3. O processo repete até zerar o volume da saída.

### Romaneio PDF
Ao finalizar uma saída, o usuário pode gerar um **Romaneio PDF** contendo:
- Romaneio Microdata, Código do Produto, Lote
- Tipo de saída
- Volume bruto e volume com abatimento
- Tabela de alocações FIFO: NF de entrada, data de emissão, volume abatido por NF

---

## Setup Local

### 1. Clonar o repositório
```bash
git clone https://github.com/SEU_USUARIO/faconagem-rhodia.git
cd faconagem-rhodia
npm install
```

### 2. Configurar Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto.
2. No **SQL Editor**, execute o script em `supabase/migrations/001_schema.sql`.
3. Copie a **URL** e a **Anon Key** do projeto (Settings → API).

### 3. Variáveis de ambiente
```bash
cp .env.example .env.local
```
Edite `.env.local`:
```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Rodar localmente
```bash
npm run dev
```
Acesse: http://localhost:5173

---

## Deploy na Vercel

### Via CLI
```bash
npm i -g vercel
vercel login
vercel
```

### Via GitHub (recomendado)
1. Faça push para o GitHub.
2. No [Vercel Dashboard](https://vercel.com), importe o repositório.
3. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Clique em **Deploy**.

---

## Estrutura do Projeto

```
faconagem-rhodia/
├── public/                  # Assets estáticos (ícones PWA)
├── src/
│   ├── lib/
│   │   ├── supabase.js      # Cliente Supabase
│   │   └── faconagem.js     # Lógica de negócio (FIFO, PDF, abatimento)
│   ├── pages/
│   │   ├── DashboardPage.jsx
│   │   ├── EntradaPage.jsx
│   │   └── SaidaPage.jsx
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── supabase/
│   └── migrations/
│       └── 001_schema.sql   # Schema do banco de dados
├── .env.example
├── vercel.json
├── vite.config.js
└── package.json
```

---

## Tabelas Supabase

| Tabela | Descrição |
|--------|-----------|
| `nf_entrada` | NFs de entrada com saldo atualizado |
| `saida` | Registros de saída com volume bruto e abatido |
| `alocacao_saida` | Relação FIFO entre saídas e NFs de entrada |
