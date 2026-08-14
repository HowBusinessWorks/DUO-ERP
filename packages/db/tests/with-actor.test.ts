import { PG_ROLE_BY_PERSONA, closeConnections, withActor, withServiceActor } from '../src/index';
import type { Actor } from '../src/index';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@damina/shared';
import { afterAll, describe, expect, it } from 'vitest';

function actorFor(persona: keyof typeof PG_ROLE_BY_PERSONA, personId = uuidv7()): Actor {
  return {
    personId,
    persona,
    pgRole: PG_ROLE_BY_PERSONA[persona],
    claims: { sub: personId, persona },
  };
}

afterAll(async () => {
  await closeConnections();
});

describe('withActor', () => {
  // Verificarea #6 din Pasul 01.
  it('intra in rolul Postgres al persona si publica actor_id', async () => {
    const actor = actorFor('field');

    const row = await withActor(actor, async (tx) => {
      const result = await tx.execute<{ current_user: string; actor_id: string }>(
        sql`select current_user, current_setting('app.actor_id') as actor_id`,
      );
      return result.rows[0];
    });

    expect(row?.current_user).toBe('app_field');
    expect(row?.actor_id).toBe(actor.personId);
  });

  it('mapeaza fiecare persona pe rolul ei', async () => {
    for (const persona of ['office', 'field', 'subcontractor', 'client'] as const) {
      const row = await withActor(actorFor(persona), async (tx) => {
        const result = await tx.execute<{ current_user: string }>(sql`select current_user`);
        return result.rows[0];
      });
      expect(row?.current_user).toBe(PG_ROLE_BY_PERSONA[persona]);
    }
  });

  it('publica si claim-urile JWT, pentru politicile RLS', async () => {
    const actor = actorFor('office');

    const claims = await withActor(actor, async (tx) => {
      const result = await tx.execute<{ claims: string }>(
        sql`select current_setting('request.jwt.claims') as claims`,
      );
      return JSON.parse(result.rows[0]?.claims ?? '{}') as Record<string, unknown>;
    });

    expect(claims['sub']).toBe(actor.personId);
    expect(claims['persona']).toBe('office');
  });

  it('nu lasa rolul sa se scurga catre urmatoarea tranzactie', async () => {
    await withActor(actorFor('field'), async (tx) => {
      await tx.execute(sql`select 1`);
    });

    // Aceeasi conexiune din pool, actor diferit: trebuie sa fie rolul nou.
    const row = await withActor(actorFor('office'), async (tx) => {
      const result = await tx.execute<{ current_user: string }>(sql`select current_user`);
      return result.rows[0];
    });

    expect(row?.current_user).toBe('app_office');
  });

  it('scrie motivul actiunii cand exista', async () => {
    const actor: Actor = { ...actorFor('office'), reason: 'stornare la cererea clientului' };

    const reason = await withActor(actor, async (tx) => {
      const result = await tx.execute<{ reason: string }>(
        sql`select current_setting('app.action_reason') as reason`,
      );
      return result.rows[0]?.reason;
    });

    expect(reason).toBe('stornare la cererea clientului');
  });

  it('face rollback la exceptie', async () => {
    const id = uuidv7();

    await expect(
      withActor(actorFor('office'), async (tx) => {
        await tx.execute(
          sql`insert into app.companies (id, name, cui) values (${id}, 'Test SRL', ${`RO${Date.now()}`})`,
        );
        throw new Error('esec intentionat');
      }),
    ).rejects.toThrow('esec intentionat');

    const found = await withActor(actorFor('office'), async (tx) => {
      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from app.companies where id = ${id}`,
      );
      return result.rows[0]?.count;
    });

    expect(found).toBe('0');
  });

  it('refuza un rol necunoscut', async () => {
    const broken = { ...actorFor('office'), pgRole: 'postgres' } as unknown as Actor;
    await expect(withActor(broken, async () => undefined)).rejects.toThrow(
      /Rol Postgres necunoscut/,
    );
  });
});

describe('withServiceActor', () => {
  it('ruleaza ca app_service si se identifica prin numele jobului', async () => {
    const row = await withServiceActor('system.ping', async (tx) => {
      const result = await tx.execute<{ current_user: string; reason: string }>(
        sql`select current_user, current_setting('app.action_reason') as reason`,
      );
      return result.rows[0];
    });

    expect(row?.current_user).toBe('app_service');
    expect(row?.reason).toBe('job:system.ping');
  });
});
