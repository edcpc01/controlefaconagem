# Façonagem Rhodia — PWA de Controle de Entradas e Saídas

Sistema PWA para controle de façonagem com lógica FIFO de alocação de NFs.

---

## Stack

- **Frontend**: React + Vite + PWA (vite-plugin-pwa)
- **Banco de Dados**: Firebase Firestore
- **Deploy**: Vercel
- **Versionamento**: GitHub

---

## Regras de Negócio

### Abatimento de 1,5%
Os seguintes tipos de saída têm **abatimento de 1,5%** sobre o volume em kg:
- Faturamento · Sucata · Estopa

**Exemplo**: Estopa 500 kg → Volume abatido = **492,5 kg**

Os tipos de **devolução** (Qualidade, Processo, Final de Campanha) **não têm abatimento**.

### Alocação FIFO
As saídas são alocadas nas NFs de entrada pela ordem de **data de emissão mais antiga**.
O volume (com abatimento) é descontado sequencialmente até zerar cada NF antes de ir para a próxima.
Toda a operação é gravada em **batch atômico** no Firestore.

### Romaneio PDF
Após registrar uma saída, o usuário pode gerar um **Romaneio PDF** com:
- Romaneio Microdata, Código do Produto, Lote, Tipo de saída
- Volume bruto e volume com/sem abatimento
- Tabela FIFO: NF de entrada, data de emissão, volume abatido por NF

---

## Setup Local

### 1. Instalar dependências
```bash
npm install
```

### 2. Criar projeto Firebase
1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um novo projeto (pode ser no plano **Spark gratuito**)
3. Vá em **Build → Firestore Database** e crie o banco (modo **production** ou **test**)
4. Vá em **Configurações do projeto → Seus apps → Adicionar app Web**
5. Copie as credenciais do SDK

### 3. Regras do Firestore
No console Firebase → **Firestore → Regras**, cole:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // ajuste para autenticação em produção
    }
  }
}
```

### 4. Variáveis de ambiente
```bash
cp .env.example .env.local
```
Preencha `.env.local` com as credenciais copiadas do Firebase.

### 5. Rodar localmente
```bash
npm run dev
```

---

## Coleções no Firestore

| Coleção | Descrição |
|---------|-----------|
| `nf_entrada` | NFs de entrada com saldo atualizado via batch |
| `saida` | Registros de saída com volume bruto e abatido |
| `alocacao_saida` | Alocações FIFO entre saídas e NFs de entrada |

---

## Deploy na Vercel

### Via GitHub (recomendado)
1. Faça push para o GitHub.
2. No [Vercel Dashboard](https://vercel.com), importe o repositório.
3. Em **Environment Variables**, adicione todas as variáveis `VITE_FIREBASE_*`.
4. Clique em **Deploy**.

### Via CLI
```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## Estrutura do Projeto

```
faconagem-rhodia/
├── src/
│   ├── lib/
│   │   ├── firebase.js      ← cliente Firebase (initializeApp + getFirestore)
│   │   └── faconagem.js     ← toda a lógica: FIFO, PDF, abatimento
│   ├── pages/
│   │   ├── DashboardPage.jsx
│   │   ├── EntradaPage.jsx
│   │   └── SaidaPage.jsx
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .env.example
├── vercel.json
├── vite.config.js
└── package.json
```
