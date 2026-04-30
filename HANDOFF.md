# Handoff — Sessão de 30/04/2026

Resumo das alterações implementadas nesta sessão de trabalho no projeto **Controle Façonagem**.

---

## 1. Óleo de Encimagem (operação Nilit)

**Regra de negócio**: em saídas Nilit com abatimento (`faturamento`/`sucata`/`estopa`) de materiais POY (`tipo_material === 'materia_prima'`), o % de abatimento é debitado das NFs do material **23033 STANTEX® UNF** via FIFO, registrado como "Óleo de Encimagem". Não se aplica a saídas de insumo, ao próprio 23033, nem a tipos sem abatimento.

**Arquivos**:
- [src/lib/faconagem.js](src/lib/faconagem.js):
  - Constante `MATERIAL_OLEO_ENCIMAGEM_NILIT = { codigo: '23033', descricao: 'STANTEX® UNF' }`
  - Helper `isOleoEncimagemNilitAplicavel(colecoes, codigoMaterial, tipoMaterial)`
  - `previewFIFO` retorna `previewOleoEncimagem` (FIFO das NFs do 23033)
  - `criarSaida` aloca o débito do óleo nas NFs do 23033 e grava `tipo_companion: 'oleo_encimagem_nilit'` no doc da saída
  - `_buildRomaneioPDF` renderiza bloco âmbar **"ÓLEO DE ENCIMAGEM"** quando `tipo_companion === 'oleo_encimagem_nilit'`
- [src/pages/SaidaPage.jsx](src/pages/SaidaPage.jsx):
  - `ConfirmacaoModal` mostra preview FIFO do débito 23033
  - `SucessoModal` mostra alocações do óleo após registro
  - Toast antecipado se faltar saldo no 23033

**Estorno**: usa o mecanismo existente — `deletarSaida` itera todas as alocações do `alocacao_saida` e estorna o saldo nas NFs correspondentes (incluindo as companion 23033).

---

## 2. PDF do romaneio multi-saídas — NFs de origem

Antes não havia rastreabilidade da NF de origem no PDF de multi-saídas.

**Arquivos**:
- [src/pages/SaidaPage.jsx](src/pages/SaidaPage.jsx) — `handleGerarMulti` agora coleta `alocacoes` e `alocacoesCompanion` de cada `criarSaida` em `multiResultado.itens`.
- [src/lib/faconagem.js](src/lib/faconagem.js) — `gerarMultiSaidaPDF` ganhou:
  1. **DETALHAMENTO FIFO — NFs DE ORIGEM POR ITEM**: linha por (item × NF debitada).
  2. **ÓLEO DE ENCIMAGEM**: lista as NFs do 23033 debitadas, agrupadas por item de origem (Nilit).

---

## 3. PDF de saída individual de insumo

Usuário pediu o **mesmo layout** do romaneio multi-saídas para saídas individuais de insumo.

**Implementação**:
- Refatorei `gerarMultiSaidaPDF` em uma função interna `_buildMultiSaidaPDF(dados, config)` que retorna o `pdoc` (sem `save`).
- O wrapper público `gerarMultiSaidaPDF` chama `_buildMultiSaidaPDF` e salva como `romaneio_multi_*.pdf`.
- Em `_buildRomaneioPDF`, quando `saida.tipo_saida === 'insumo'`, monta um `dados` com 1 item e delega para `_buildMultiSaidaPDF` — assim a saída individual de insumo herda o mesmo layout.
- **Título dinâmico**: "ROMANEIO DE SAÍDA" (1 item) vs "ROMANEIO DE SAÍDA MÚLTIPLA" (2+ itens).
- Filename do insumo individual permanece `romaneio_NUMBER_DATE.pdf` (não `romaneio_multi_*`), pois o save é feito pelo wrapper `gerarRomaneioPDF`.
- Outros tipos (POY com abatimento etc.) **mantêm o layout antigo**.

**SaidaPage.jsx** — `handleGerarPDF` e `handleEmailIndividual` enriquecem `saida` com `descricao_material` (lookup em `nfs`) antes de chamar o PDF, para a coluna Descrição aparecer preenchida.

---

## 4. Cadastro Sankhia (Material → Cód. Sankhia)

Sistema de mapeamento entre o **código de material da NF** (ex.: `23033`) e o **código interno do ERP Sankhia** (ex.: `63747`).

### Decisões arquiteturais
- **Por operação**: coleção separada por operação (`codigo_sankhia` para Rhodia, `codigo_sankhia_nilit` para Nilit) — segue o padrão existente do projeto.
- **Código exibido**: o código interno Sankhia (ex.: `63747`), não o complemento (`SK23033`).
- **Acesso**: novo menu "🔗 Sankhia" disponível para todos os perfis com acesso ao app.
- **Importação**: XLSX usando colunas `CODPROD` (Sankhia) × `COMPLDESC` (NF, com prefixo "SK" que é removido). Coluna `DESCRPROD` opcional para descrição.

### Arquivos novos
- [src/pages/CadastroSankhiaPage.jsx](src/pages/CadastroSankhiaPage.jsx):
  - CRUD manual (form de novo + edição inline)
  - Importação XLSX
  - Lista combinada: cadastros + materiais das NFs ainda não mapeados (badge "⚠ Faltando")
  - Filtros: busca textual e "apenas faltando"
  - KPIs: total cadastrados / faltando

### Arquivos modificados
- [src/lib/OperacaoContext.jsx](src/lib/OperacaoContext.jsx) — coleção `codigo_sankhia` em ambas as operações.
- [src/lib/faconagem.js](src/lib/faconagem.js):
  - `COLECOES_PADRAO` ganhou `codigo_sankhia`
  - Funções novas: `listarCodigosSankhia`, `carregarMapaSankhia`, `salvarCodigoSankhia`, `deletarCodigoSankhia`, `importarCodigosSankhiaXLSX`, `normalizarCodigoNFFromSankhia`
  - Logs: `SANKHIA_CRIADO`, `SANKHIA_ATUALIZADO`, `SANKHIA_EXCLUIDO`, `SANKHIA_IMPORT`
  - `_buildMultiSaidaPDF` ganhou coluna **Cód. Sankhia** (em destaque azul) na tabela de itens e no DETALHAMENTO FIFO
  - `_buildRomaneioPDF` (POY individual) — campo "Código do Material" mostra `XXXX (SK YYYY)` quando há mapeamento
- [src/App.jsx](src/App.jsx) — rota `/sankhia` + item de menu "🔗 Sankhia" (NAV_BASE e NAV_SUPERVISOR).
- [src/pages/SaidaPage.jsx](src/pages/SaidaPage.jsx):
  - Carrega `sankhiaMap` em paralelo a NFs/config
  - Helper `sankhiaDe(codigoMaterial)` para lookup
  - Form individual: chip "SK xxxx" (azul) ou "⚠ sem SK" (warn) ao lado do label
  - `ConfirmacaoModal` e `SucessoModal` mostram `Mat. XXX · SK YYY`
  - Tabela do resultado multi-saídas ganhou coluna **Cód. Sankhia**
  - Itens da multi carregam `codigo_sankhia` para o PDF
  - `handleGerarPDF` e `handleEmailIndividual` enriquecem `saida` com `codigo_sankhia`

---

## Permissões / Firebase Rules

As coleções novas precisam de regras de leitura/escrita no `firestore.rules` (se aplicável), seguindo o padrão das outras coleções da operação:

- `codigo_sankhia` (Rhodia)
- `codigo_sankhia_nilit` (Nilit)

Nenhuma alteração foi feita em arquivo de regras nesta sessão. Verificar se o ambiente atual tem regras restritivas que possam bloquear o acesso.

---

## Como testar (sequência sugerida)

1. **Subir o dev server**: `npm run dev`
2. **Cadastro Sankhia** (`/sankhia`):
   - Importar a planilha XLSX exportada do Sankhia (colunas `CODPROD`, `COMPLDESC`).
   - Conferir KPIs e o status "✓ Cadastrado" / "⚠ Faltando".
   - Cadastrar manualmente um material que falta.
3. **Saída de POY individual**:
   - Preencher form → conferir badge "SK xxxx" no campo Código do Material.
   - Modal de confirmação deve mostrar "Mat. X · SK Y".
   - Gerar PDF → conferir `Código do Material: XXXX (SK YYYY)` no box.
4. **Saída de POY com abatimento (Nilit)**:
   - Conferir que o débito do 23033 aparece no modal de confirmação.
   - PDF deve ter o bloco âmbar "ÓLEO DE ENCIMAGEM".
   - Conferir saldo do 23033 reduzido na tela de NFs Entrada.
5. **Saída de insumo individual**:
   - Conferir que o PDF usa o **layout multi** (cabeçalho "ROMANEIO DE SAÍDA", tabela com Cód. Material/Sankhia/Lote/Descrição/Volume + DETALHAMENTO FIFO).
6. **Multi-saídas** (2+ itens):
   - Conferir coluna **Cód. Sankhia** na tabela de resultado e no PDF.
   - Item sem Sankhia cadastrado deve aparecer como "—".

---

## Caveats / TODOs futuros

- **Não testado visualmente**: todas as alterações foram feitas sem rodar o dev server. Necessário teste manual antes de subir para produção.
- **Importação XLSX**: usa `xlsx` (já presente no projeto). Linhas sem `CODPROD` ou `COMPLDESC` são contadas como **ignoradas**.
- **Estorno do óleo de encimagem**: funciona automaticamente via `deletarSaida` (mecanismo existente).
- **PDF multi com 1 item**: agora exibe título "ROMANEIO DE SAÍDA" (sem "MÚLTIPLA"), o que é mais correto.
- **Saídas antigas (pré-mudança)**:
  - Não têm `tipo_companion` no doc → o PDF detecta isso como "saída sem companion" e mantém layout antigo.
  - Multi-saídas antigas geradas antes desta sessão **não terão alocações em memória** quando reabrir a tela; usar o histórico individual (📄 na grid) para gerar romaneio com FIFO.

---

## Estrutura de coleções Firestore (após esta sessão)

| Operação | NF Entrada | Saída | Alocação | Config | Sankhia |
|---|---|---|---|---|---|
| Rhodia | `nf_entrada` | `saida` | `alocacao_saida` | `config` | `codigo_sankhia` |
| Nilit | `nf_entrada_nilit` | `saida_nilit` | `alocacao_saida_nilit` | `config_nilit` | `codigo_sankhia_nilit` |

**Doc de saída** ganhou o campo `tipo_companion`: `'rhodia_135612'` | `'oleo_encimagem_nilit'` | `null`.

**Doc de Sankhia** (`codigo_sankhia` / `codigo_sankhia_nilit`):

```json
{
  "codigo_material":   "23033",
  "codigo_sankhia":    "63747",
  "descricao_sankhia": "STANTEX® UNF",
  "criado_em":         "Timestamp",
  "atualizado_em":     "Timestamp"
}
```

---

## Arquivos modificados nesta sessão

```
src/App.jsx
src/lib/OperacaoContext.jsx
src/lib/faconagem.js
src/pages/SaidaPage.jsx
src/pages/CadastroSankhiaPage.jsx   (NOVO)
HANDOFF.md                          (NOVO)
```

Nenhum arquivo deletado.
