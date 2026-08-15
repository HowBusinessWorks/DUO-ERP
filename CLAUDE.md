# CLAUDE.md

## Regulă obligatorie — verificare Git înainte de modificări de cod

Această regulă se aplică **doar** când urmează să faci modificări în codebase (feature nou,
modificare, fix, refactor). **Nu** se aplică la întrebări simple, explicații sau lecturi de
fișiere/plan — la acelea răspunde direct, fără să raportezi starea git.

Înainte de a începe orice task care modifică cod în acest repo, rulează:

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

Această verificare precede orice editare de cod, indiferent cât de mică pare task-ul. Pentru
întrebări care nu implică editare de cod, nu e nevoie să menționezi verificarea git.

## Eficiență la implementare

Când implementezi featureuri, fii eficient — nu face lucruri fără sens care irosesc tokeni
degeaba (fișiere/abstracții inutile, explorări sau explicații excesive, cod nefolosit).

Performanța contează: nu tăia funcționalitate doar ca să pari mai "eficient". E însă ok să tai
din lucruri care nu sunt strict necesare sau să faci mai rapid ce se poate face mai rapid.
