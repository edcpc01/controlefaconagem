# Regras do Firestore — Façonagem Rhodia

Cole estas regras no Console Firebase → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Qualquer usuário autenticado pode ler/gravar em todas as coleções
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

> **Nota:** Para produção, restrinja conforme necessário (ex: apenas admins podem editar `usuarios`).
