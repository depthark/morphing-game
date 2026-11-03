# MORPH

Retro hry, ktoré sa ti menia priamo pod rukami. Keď splníš míľnik, aktuálna hra sa začne postupne prelievať do ďalšej. Pravidlá, grafika, hudba aj ovládanie sa menia počas hrania.

**▶ Hraj:** https://depthark.github.io/morphing-game/

## Reťaz

| Hra | Míľnik | Morph do ďalšej |
|---|---|---|
| SNAKE | dĺžka 10 | Namiesto jabĺk sa objavia čerešne a chomperi. Každý skráti hada a okolo rastie bludisko. |
| CHOMPER | zjedz 2 duchov | SPACE kladie bomby, steny sa menia na tehly a piliere, duchovia sa dajú vybuchnúť. |
| BOMBER | znič všetkých nepriateľov | Tehly sa zoradia do formácie votrelcov a piliere do štítov. Gravitácia ťa stiahne dole, z bômb sú strely. |
| ALIEN RAID | zostreľ všetkých okrem 5 | Strely sa odrážajú, votrelci sa zlepia do súperovho pádla a loď sa sploští na pádlo. |
| PADDLE | 5 bodov proti CPU | Na loptičku začne pôsobiť gravitácia, SPACE = mávnutie, prichádzajú potrubia. |
| FLAPPER | prelet 8 potrubí | Potrubia sa rozpadnú na bloky, ktoré popadajú do vznikajúcej jamy. |
| BLOCKFALL | 4 riadky | Padajúci kúsok ožije ako had a stack sa zmení na drobky na jedenie. Nasleduje ďalšie kolo, rýchlejšie. |

Skóre a 3 životy sú spoločné pre všetky hry. Hore v strede je lišta: počas hry sa plní k míľniku, počas morphu sa vyprázdňuje.

## Ovládanie

- **Klávesnica:** šípky / WASD, SPACE akcia (bomba, streľba, mávnutie, hard drop), ↑ / X otočenie, Z otočenie naopak, P pauza, M zvuk
- **Dotyk:** swipe = smer, tap = akcia (v Tetrise otočenie, swipe ↓ = drop), ťahanie prstom = pádlo / loď

## Vývoj

```bash
bun install
bun run dev      # http://localhost:5173
bun run test     # simulácia celej reťaze (2 kolá) + kontrola bludiska
bun run build
```

Debug: `?debug` zapne klávesu **N** (skok na morph / dokončenie morphu), `?start=bomber` spustí priamo danú hru.

Po pushi na `main` sa hra automaticky nasadí na GitHub Pages (`.github/workflows/static.yml`).
