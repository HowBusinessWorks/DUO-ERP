# CLAUDE.md

## Regulă obligatorie — verificare Git înainte de orice lucru

Înainte de a începe **orice** task în acest repo (feature nou, modificare, fix, refactor), rulează:

```
git fetch
git status
git log HEAD..origin/<branch-curent> --oneline
```

- Dacă branch-ul local **e la zi** cu remote → poți continua normal.
- Dacă branch-ul local **e în urmă** (sau există commit-uri noi pe remote) → **oprește-te, nu face nicio modificare**, și anunță utilizatorul:
  - ce commit-uri lipsesc local;
  - sugestii concrete (ex: `git pull`, `git merge`, `git rebase`, sau doar continuare pe branch separat dacă schimbările se suprapun cu lucrul curent).
- Nu presupune și nu ghici starea remote-ului — verifică mereu, chiar dacă pare că nu a trecut mult timp de la ultima verificare.

Această verificare precede orice editare de cod, indiferent cât de mică pare task-ul.
