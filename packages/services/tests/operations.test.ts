import { closeConnections, withActor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createOperation,
  getOperation,
  listOperationMaterials,
  listOperations,
  operationActuals,
  setOperationMaterials,
  updateOperation,
} from '../src/operations';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apara fisierul asta: **manopera din catalog nu se tasteaza.**
 *
 * E singura garantie care face pragul de rutare de 2.000 lei sa insemne ceva. Un
 * catalog in care cifra vine din formular ar fi tot o parere, doar ca pastrata
 * intr-un tabel. De aceea testele verifica derivarea, si verifica si refuzul —
 * fara tarif in vigoare, operatiunea nu are voie sa se salveze cu manopera zero.
 */

interface Ground {
  readonly qualificationId: string;
  /** Calificare fara niciun tarif — pentru testul de refuz. */
  readonly untariffedId: string;
  readonly productA: string;
  readonly productB: string;
  readonly tag: string;
}

async function ground(): Promise<Ground> {
  const qualificationId = uuidv7();
  const untariffedId = uuidv7();
  const productA = uuidv7();
  const productB = uuidv7();
  const tag = qualificationId.slice(-8);

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.qualifications (id, code, name)
      values (${qualificationId}, ${`Q-${tag}`}, 'Instalator'),
             (${untariffedId}, ${`QX-${tag}`}, 'Fara tarif')`);
    // 100 lei/ora: 40 × 1,45 × 1,15 = 66,70. Cifra rotunda ar fi ascuns o
    // greseala de rotunjire, asa ca nu e rotunda.
    await tx.execute(sql`
      insert into app.rate_cards
        (id, qualification_id, valid_from, valid_to, hourly_salary, tax_coefficient, unproductivity_coefficient)
      values (${uuidv7()}, ${qualificationId}, '2020-01-01', null, '40.00', '0.4500', '0.1500')`);
    await tx.execute(sql`
      insert into app.products (id, code, name, uom)
      values (${productA}, ${`P-${tag}`}, 'Garnitura', 'buc'),
             (${productB}, ${`PB-${tag}`}, 'Teava', 'm')`);
  });

  return { qualificationId, untariffedId, productA, productB, tag };
}

const operationInput = (base: Ground, overrides: Record<string, unknown> = {}) => ({
  code: `OP-${base.tag}`,
  name: 'Inlocuire garnitura vana DN80',
  category: 'Instalatii',
  standardHours: '2.0000',
  qualificationId: base.qualificationId,
  estimatedMaterial: '45.00',
  isActive: true,
  ...overrides,
});

describe('catalogul de operatiuni', () => {
  it('deriveaza manopera din tariful curent, nu din formular', async () => {
    const base = await ground();
    const { id } = await createOperation(officeActor('catalog'), operationInput(base));

    const row = await getOperation(officeActor(), id);
    // 2 ore × 66,70 lei/ora.
    expect(row.estimatedLabor).toBe('133.40');
    expect(row.estimatedMaterial).toBe('45.00');
  });

  it('refuza operatiunea cand calificarea n-are tarif in vigoare', async () => {
    const base = await ground();
    const error = await rejection(
      createOperation(
        officeActor('catalog'),
        operationInput(base, { qualificationId: base.untariffedId }),
      ),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('recalculeaza manopera la modificarea normei de timp', async () => {
    const base = await ground();
    const { id } = await createOperation(officeActor('catalog'), operationInput(base));

    await updateOperation(
      officeActor('modificare'),
      id,
      operationInput(base, { standardHours: '5.0000' }),
    );

    const row = await getOperation(officeActor(), id);
    expect(row.estimatedLabor).toBe('333.50');
  });

  it('refuza un cod deja folosit', async () => {
    const base = await ground();
    await createOperation(officeActor('catalog'), operationInput(base));
    const error = await rejection(
      createOperation(officeActor('catalog'), operationInput(base, { name: 'Altceva' })),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('inlocuieste lista de materiale dintr-o bucata', async () => {
    const base = await ground();
    const { id } = await createOperation(officeActor('catalog'), operationInput(base));

    await setOperationMaterials(officeActor('materiale'), {
      operationId: id,
      lines: [
        { productId: base.productA, quantity: '2.0000' },
        { productId: base.productB, quantity: '6.0000' },
      ],
    });
    expect(await listOperationMaterials(officeActor(), id)).toHaveLength(2);

    // A doua salvare cu o singura linie STERGE cealalta: lista e inlocuita, nu
    // completata. Altfel n-ar exista nicio cale de a scoate un material.
    await setOperationMaterials(officeActor('materiale'), {
      operationId: id,
      lines: [{ productId: base.productA, quantity: '1.0000' }],
    });
    const after = await listOperationMaterials(officeActor(), id);
    expect(after).toHaveLength(1);
    expect(after[0]?.quantity).toBe('1.0000');
  });

  it('lista implicita ascunde operatiunile dezactivate', async () => {
    const base = await ground();
    const { id } = await createOperation(officeActor('catalog'), operationInput(base));
    await updateOperation(officeActor('scoatere'), id, operationInput(base, { isActive: false }));

    const active = await listOperations(officeActor(), { query: base.tag });
    expect(active).toHaveLength(0);

    const all = await listOperations(officeActor(), { query: base.tag, includeInactive: true });
    expect(all).toHaveLength(1);
  });

  it('media reala e ponderata cu executiile, nu o medie a mediilor (#22)', async () => {
    const base = await ground();
    const { id } = await createOperation(officeActor('catalog'), operationInput(base));

    const companyId = uuidv7();
    const teamFast = uuidv7();
    const teamSlow = uuidv7();
    const periodId = uuidv7();

    await withActor(officeActor('executii de test'), async (tx) => {
      await tx.execute(
        sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${base.tag}`})`,
      );
      await tx.execute(sql`
        insert into app.teams (id, company_id, name)
        values (${teamFast}, ${companyId}, 'Echipa A'),
               (${teamSlow}, ${companyId}, 'Echipa B')`);
      await tx.execute(sql`
        insert into app.periods (id, company_id, year, month)
        values (${periodId}, ${companyId}, 2026, 8)`);
      // Echipa A: 20 executii a 401 lei. Echipa B: 2 executii a 476 lei.
      // Media aritmetica ar da 438,50 — gresit. Ponderat: 407,82.
      await tx.execute(sql`
        insert into app.operation_actuals
          (operation_id, team_id, period_id, executions, avg_real_cost, avg_estimated_cost)
        values (${id}, ${teamFast}, ${periodId}, 20, '401.00', '400.00'),
               (${id}, ${teamSlow}, ${periodId}, 2, '476.00', '400.00')`);
    });

    const report = await operationActuals(officeActor(), id);
    expect(report.executions).toBe(22);
    expect(report.avgRealCost?.toDbString()).toBe('407.82');
    expect(report.teams).toHaveLength(2);
    // Echipa cu cele mai multe executii e prima: ea decide media.
    expect(report.teams[0]?.teamName).toBe('Echipa A');
    expect(report.teams[1]?.deviationPercent).toBe(19);
  });
});
