# Façonagem Rhodia v2 — PWA

Sistema PWA para controle de façonagem com Firebase.

## Stack
- **Frontend**: React + Vite + PWA
- **Banco**: Firebase Firestore
- **Auth**: Firebase Authentication (Email/Senha + Google)
- **Deploy**: Vercel

## Funcionalidades v2

### 🔒 Autenticação
- Login com Google ou e-mail/senha
- Todas as rotas protegidas — redireciona para login se não autenticado
- Nome do usuário registrado em cada operação

### ↓ NF de Entrada
- Cadastro com emissão, número, código, lote, volume, valor unitário
- Botão **🔍 Detalhe** por NF — abre tela de rastreabilidade completa

### ↑ Saída
- Botão **# Auto** gera número de romaneio sequencial automático
- Modal de **confirmação prévia** mostrando exatamente quais NFs serão debitadas e quanto
- Filtros no histórico: por texto (romaneio/lote/código), tipo de saída, período (de/até)
- Totalizador dos resultados filtrados
- Botão **📊 Exportar Excel** — gera .xlsx com 3 abas: NFs, Saídas, Alocações FIFO

### 📋 Tela de Detalhe da NF
- Barra de progresso de consumo
- Todos os dados da NF
- Tabela com todas as saídas que consumiram a NF (romaneio, tipo, volume, data)

### 📄 Romaneio PDF
- Logo da empresa no cabeçalho (configurável)
- Numeração sequencial automática
- Campo de assinatura para responsável e conferente

### 📋 Histórico de Ações (Log)
- Timeline de todas as operações: NFs criadas/removidas, saídas registradas
- Registra usuário, descrição e timestamp
- Busca por descrição ou usuário

### ⚙ Configurações
- Upload de logo para o romaneio PDF (salvo no Firestore)
- Alternância de tema escuro/claro
- Informações da conta + botão de logout

## Setup

### 1. Firebase Console
1. Crie projeto em [console.firebase.google.com](https://console.firebase.google.com)
2. **Firestore**: Criar banco → modo produção
3. **Authentication**: Ativar provedores **E-mail/Senha** e **Google**
4. **Regras Firestore** (para começar em desenvolvimento):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 2. Instalar e rodar
```bash
npm install
cp .env.example .env.local
# preencher .env.local com credenciais do Firebase
npm run dev
```

### 3. Deploy Vercel
1. Push para GitHub
2. Importar repo na Vercel
3. Adicionar as 6 variáveis VITE_FIREBASE_* em Environment Variables
4. Deploy

## Coleções Firestore

| Coleção | Descrição |
|---------|-----------|
| `nf_entrada` | NFs com saldo atualizado |
| `saida` | Registros de saída |
| `alocacao_saida` | Alocações FIFO (saída ↔ NF) |
| `log_acoes` | Histórico de ações |
| `counters/romaneio` | Contador sequencial de romaneios |
| `config/app` | Configurações (logo, etc.) |
