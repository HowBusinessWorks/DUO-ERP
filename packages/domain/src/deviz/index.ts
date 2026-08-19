import { Money, Quantity } from '@damina/shared';

/**
 * Devizul — regulile care nu tin de baza de date (pasul 11, sec. 3.3).
 *
 * Patru functii pure, toate cu acelasi rost: cifra care ajunge pe ecran si
 * cifra care ajunge in baza sa fie calculate de acelasi cod. Un total al
 * devizului calculat o data in SQL si a doua oara in React e un total care
 * diverge la prima rotunjire, iar diferenta se descopera in discutia cu
 * clientul, nu in teste.
 *
 * **Bani in `Money`, cantitati in `Quantity`, niciodata `number`.** Regula 2 a
 * pasului. Un deviz cu 500 de pozitii inmultite cu preturi in virgula mobila
 * pierde bani reali pe drum.
 */

// ── Rollup ───────────────────────────────────────────────────────────────────

export interface DevizLineLike {
  readonly id: string;
  /** Operatiunea (nivelul 2) sau categoria (nivelul 1) sub care sta linia. */
  readonly categoryId: string | null;
  readonly quantity: Quantity;
  readonly unitPrice: Money;
  readonly materialCost: Money;
  readonly laborCost: Money;
  readonly equipmentCost: Money;
  readonly transportCost: Money;
}

export interface DevizCategoryLike {
  readonly id: string;
  readonly parentId: string | null;
}

export interface DevizRollupInput {
  readonly lines: readonly DevizLineLike[];
  readonly categories: readonly DevizCategoryLike[];
  /** Fractie: 0.08 = 8%. Doar pe devizul client; pe intern se trimite `null`. */
  readonly indirectPct?: string | number | null;
  readonly profitPct?: string | number | null;
}

/** Ce se aduna pe o categorie, pe o operatiune sau pe tot devizul. */
export interface DevizAmounts {
  readonly direct: Money;
  readonly material: Money;
  readonly labor: Money;
  readonly equipment: Money;
  readonly transport: Money;
}

export interface DevizCategoryRollup extends DevizAmounts {
  readonly categoryId: string;
  readonly parentId: string | null;
  /** Cat aduna singura, fara copii. Egal cu `direct` pentru operatiuni. */
  readonly own: Money;
}

export interface DevizRollup {
  /** Suma liniilor, fara indirecte si fara profit. */
  readonly direct: Money;
  readonly material: Money;
  readonly labor: Money;
  readonly equipment: Money;
  readonly transport: Money;
  readonly indirect: Money;
  readonly profit: Money;
  /** Direct + indirecte + profit. Ce vede clientul. */
  readonly total: Money;
  /** Cate o intrare per categorie SI per operatiune, in ordinea primita. */
  readonly categories: readonly DevizCategoryRollup[];
  /** Liniile fara categorie. Nu se pierd: se aduna in `direct`, si se numara. */
  readonly uncategorizedLineCount: number;
}

const lineTotal = (line: DevizLineLike): Money => line.unitPrice.mul(line.quantity.toString());

const scaled = (value: Money, quantity: Quantity): Money => value.mul(quantity.toString());

const pct = (value: string | number | null | undefined): Money | null =>
  value === null || value === undefined ? null : Money.of(value);

/**
 * Totalurile devizului: pe linie, pe operatiune, pe categorie, pe tot.
 *
 * **Ordinea indirecte -> profit e compusa, si conteaza.** Profitul se aplica
 * peste direct + indirecte, nu peste direct. Asa se calculeaza o oferta in
 * constructii, si asa iese si verificarea #2 a pasului: la 8% si 12% pe 100.000
 * lei, totalul e 120.960, nu 120.000.
 *
 * Categoriile se intorc si ele desfasurate, fiindca editorul arata un subtotal
 * pe fiecare rand de categorie si pe fiecare operatiune (sec. 12.1) — iar acela
 * trebuie sa fie acelasi numar cu ce se aduna in cap.
 */
export function rollupDeviz(input: DevizRollupInput): DevizRollup {
  const own = new Map<string, Money[]>();
  const ownMaterial = new Map<string, Money[]>();
  const ownLabor = new Map<string, Money[]>();
  const ownEquipment = new Map<string, Money[]>();
  const ownTransport = new Map<string, Money[]>();

  const push = (map: Map<string, Money[]>, key: string, value: Money): void => {
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [value]);
    } else {
      bucket.push(value);
    }
  };

  let uncategorizedLineCount = 0;

  for (const line of input.lines) {
    if (line.categoryId === null) {
      uncategorizedLineCount += 1;
      continue;
    }
    push(own, line.categoryId, lineTotal(line));
    push(ownMaterial, line.categoryId, scaled(line.materialCost, line.quantity));
    push(ownLabor, line.categoryId, scaled(line.laborCost, line.quantity));
    push(ownEquipment, line.categoryId, scaled(line.equipmentCost, line.quantity));
    push(ownTransport, line.categoryId, scaled(line.transportCost, line.quantity));
  }

  const sumOf = (map: Map<string, Money[]>, key: string): Money => Money.sum(map.get(key) ?? []);

  const childrenOf = new Map<string, string[]>();
  for (const category of input.categories) {
    if (category.parentId !== null) {
      const bucket = childrenOf.get(category.parentId);
      if (bucket === undefined) {
        childrenOf.set(category.parentId, [category.id]);
      } else {
        bucket.push(category.id);
      }
    }
  }

  /*
   * Arborele are doua niveluri, impuse de trigger in baza (0040). De aceea
   * agregarea nu e recursiva: o categorie aduna liniile ei plus operatiunile
   * ei, si atat. O recursie „ca sa fie" ar sugera un al treilea nivel pe care
   * restul modulului nu-l suporta.
   */
  const categories: DevizCategoryRollup[] = input.categories.map((category) => {
    const children = childrenOf.get(category.id) ?? [];
    const gather = (map: Map<string, Money[]>): Money =>
      Money.sum([sumOf(map, category.id), ...children.map((child) => sumOf(map, child))]);

    return {
      categoryId: category.id,
      parentId: category.parentId,
      own: sumOf(own, category.id),
      direct: gather(own),
      material: gather(ownMaterial),
      labor: gather(ownLabor),
      equipment: gather(ownEquipment),
      transport: gather(ownTransport),
    };
  });

  // Totalul devizului se aduna din LINII, nu din categorii: altfel liniile fara
  // categorie ar disparea din total exact cand omul le uita acolo.
  const direct = Money.sum(input.lines.map(lineTotal));
  const material = Money.sum(input.lines.map((l) => scaled(l.materialCost, l.quantity)));
  const labor = Money.sum(input.lines.map((l) => scaled(l.laborCost, l.quantity)));
  const equipment = Money.sum(input.lines.map((l) => scaled(l.equipmentCost, l.quantity)));
  const transport = Money.sum(input.lines.map((l) => scaled(l.transportCost, l.quantity)));

  const indirectPct = pct(input.indirectPct);
  const profitPct = pct(input.profitPct);

  const indirect = indirectPct === null ? Money.ZERO : direct.mul(indirectPct.toString());
  const profit =
    profitPct === null ? Money.ZERO : direct.add(indirect).mul(profitPct.toString());

  return {
    direct,
    material,
    labor,
    equipment,
    transport,
    indirect,
    profit,
    total: direct.add(indirect).add(profit),
    categories,
    uncategorizedLineCount,
  };
}

// ── Explozia unui articol normat ─────────────────────────────────────────────

export type NormedComponentKind = 'material' | 'manopera' | 'utilaj' | 'transport';

export interface NormedArticleLike {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly uom: string;
}

export interface NormedComponentLike {
  readonly id: string;
  readonly kind: NormedComponentKind;
  readonly productId: string | null;
  readonly qualificationId: string | null;
  /** Cum se numeste componenta: produsul din nomenclator sau calificarea. */
  readonly label: string;
  readonly uom: string;
  readonly quantityPerUom: Quantity;
  readonly normHours: Quantity | null;
  readonly position: number;
}

export interface ExplodedDevizLine {
  readonly normedArticleId: string;
  readonly kind: NormedComponentKind;
  readonly productId: string | null;
  readonly qualificationId: string | null;
  readonly code: string;
  readonly name: string;
  readonly uom: string;
  readonly quantity: Quantity;
  /** Orele totale, cand componenta e manopera cu norma. */
  readonly hours: Quantity | null;
  readonly position: number;
}

/**
 * Ce linii ies din punerea unui articol normat in deviz.
 *
 * **O linie per componenta, nu una singura.** Devizul intern tine material si
 * manopera separate intotdeauna (sec. 8.1), iar pachetele de subcontractant de
 * la pasul 12 se formeaza DIN liniile astea: o linie mixta n-ar putea intra
 * intr-un pachet, fiindca triggerul de acolo refuza materialul.
 *
 * Preturile NU se calculeaza aici. Vin din nomenclator si din `rate_cards`,
 * amandoua istoricizate, deci le pune serviciul care are acces la baza. O
 * functie pura care ar inventa un pret ar fi o functie pura care minte.
 */
export function explodeNormedArticle(
  article: NormedArticleLike,
  components: readonly NormedComponentLike[],
  quantity: Quantity,
): readonly ExplodedDevizLine[] {
  return [...components]
    .sort((a, b) => a.position - b.position)
    .map((component, index) => ({
      normedArticleId: article.id,
      kind: component.kind,
      productId: component.productId,
      qualificationId: component.qualificationId,
      code: article.code,
      name: `${article.name} — ${component.label}`,
      uom: component.uom,
      quantity: component.quantityPerUom.mul(quantity.toString()),
      hours: component.normHours === null ? null : component.normHours.mul(quantity.toString()),
      position: index + 1,
    }));
}

// ── Validarea maparii N:M ────────────────────────────────────────────────────

export interface MappingLike {
  readonly clientLineId: string;
  readonly internLineId: string;
  readonly coefficient: Quantity;
}

export interface MappingCoefficientProblem {
  readonly clientLineId: string;
  readonly sum: Quantity;
}

export interface MappingCheck {
  /** Pozitii client fara nicio pozitie interna in spate. */
  readonly uncoveredClientLineIds: readonly string[];
  /** Pozitii interne care nu urca nicaieri. La pasul 14 devin blocante. */
  readonly unmappedInternLineIds: readonly string[];
  /** Pozitii client ai caror coeficienti nu insumeaza 1. */
  readonly coefficientProblems: readonly MappingCoefficientProblem[];
  /** Adevarat cand niciuna din cele trei liste n-are nimic. */
  readonly isComplete: boolean;
}

const ONE = Quantity.of(1);

/**
 * Ce lipseste din mapare. **Raporteaza, nu blocheaza** (regula 6 a pasului).
 *
 * O mapare incompleta e o stare de lucru normala cat timp se redacteaza
 * devizul: PM-ul sparge o pozitie azi si o mapeaza maine. Blocajul apare abia
 * la pasul 14, cand din mapare se deriva situatia de lucrari catre client — si
 * atunci o pozitie interna cu cantitate aprobata si fara mapare chiar opreste
 * derivarea, fiindca altfel s-ar factura clientului mai putin decat s-a
 * executat, tacut.
 */
export function validateMapping(
  clientLineIds: readonly string[],
  internLineIds: readonly string[],
  mappings: readonly MappingLike[],
): MappingCheck {
  const byClient = new Map<string, Quantity[]>();
  const mappedIntern = new Set<string>();

  for (const mapping of mappings) {
    const bucket = byClient.get(mapping.clientLineId);
    if (bucket === undefined) {
      byClient.set(mapping.clientLineId, [mapping.coefficient]);
    } else {
      bucket.push(mapping.coefficient);
    }
    mappedIntern.add(mapping.internLineId);
  }

  const uncoveredClientLineIds = clientLineIds.filter((id) => !byClient.has(id));
  const unmappedInternLineIds = internLineIds.filter((id) => !mappedIntern.has(id));

  const coefficientProblems: MappingCoefficientProblem[] = [];
  for (const clientLineId of clientLineIds) {
    const coefficients = byClient.get(clientLineId);
    if (coefficients === undefined) {
      continue;
    }
    const sum = Quantity.sum(coefficients);
    if (!sum.equals(ONE)) {
      coefficientProblems.push({ clientLineId, sum });
    }
  }

  return {
    uncoveredClientLineIds,
    unmappedInternLineIds,
    coefficientProblems,
    isComplete:
      uncoveredClientLineIds.length === 0 &&
      unmappedInternLineIds.length === 0 &&
      coefficientProblems.length === 0,
  };
}

// ── „Preia ca deviz intern" ──────────────────────────────────────────────────

export interface AdoptableClientLine {
  readonly id: string;
  readonly categoryId: string | null;
  readonly code: string | null;
  readonly name: string;
  readonly uom: string;
  readonly quantity: Quantity;
  readonly stageId: string | null;
  readonly position: number;
}

export interface OneToOneDraft {
  readonly clientLineId: string;
  readonly categoryId: string | null;
  readonly code: string | null;
  readonly name: string;
  readonly uom: string;
  readonly quantity: Quantity;
  readonly stageId: string | null;
  readonly position: number;
  /** Intotdeauna 1: o pozitie client, o pozitie interna. */
  readonly coefficient: Quantity;
}

/**
 * Maparea 1:1 pentru butonul „preia ca deviz intern".
 *
 * Cand devizul client e deja bine facut, PM-ul nu mai are ce sparge: preia
 * structura ca atare si ajusteaza costurile pe ea.
 *
 * **Costurile pornesc de la zero, nu de la pretul ofertat.** Pretul clientului
 * contine indirecte si profit; copiat in coloana de cost, ar face marja sa
 * arate ca zero — si, mai rau, ar arata ca a fost CALCULATA. Un cost gol se
 * vede ca gol; unul copiat trece drept estimare.
 */
export function deriveOneToOne(clientLines: readonly AdoptableClientLine[]): readonly OneToOneDraft[] {
  return [...clientLines]
    .sort((a, b) => a.position - b.position)
    .map((line, index) => ({
      clientLineId: line.id,
      categoryId: line.categoryId,
      code: line.code,
      name: line.name,
      uom: line.uom,
      quantity: line.quantity,
      stageId: line.stageId,
      position: index + 1,
      coefficient: ONE,
    }));
}
