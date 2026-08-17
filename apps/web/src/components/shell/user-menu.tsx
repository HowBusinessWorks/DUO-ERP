import type { Session } from '@damina/auth';
import { roRO } from '@damina/i18n';
import { LogOut } from 'lucide-react';
import { signOut } from '../../app/(auth)/actions';

/**
 * Cine e logat, si iesirea din cont.
 *
 * Nu e un meniu care se deschide: sunt doua lucruri, si amandoua trebuie sa fie
 * vizibile fara clic. Numele, pentru ca pe o statie partajata de santier e
 * singurul mod in care omul afla ca lucreaza sub contul colegului. Iesirea,
 * pentru ca exact acolo o cauta atunci.
 */
export function UserMenu({ session, compact = false }: { session: Session; compact?: boolean }) {
  const PERSONA_LABEL = {
    office: roRO.workspace.office,
    field: roRO.workspace.field,
    subcontractor: roRO.workspace.portalSubcontractor,
    client: roRO.workspace.portalClient,
  } as const;

  // Rolurile spun mai mult decat persona pentru cine le are; pentru restul,
  // persona e tot ce exista.
  const role =
    session.officeRoles.length > 0
      ? session.officeRoles.join(', ')
      : PERSONA_LABEL[session.persona];

  return (
    <div className="flex items-center gap-2">
      {compact ? null : (
        <div className="hidden min-w-0 text-right lg:block">
          <p className="truncate text-sm font-medium text-ink">{session.fullName}</p>
          <p className="truncate text-xs text-ink-subtle">{role}</p>
        </div>
      )}

      <form action={signOut}>
        <button
          type="submit"
          title={roRO.topbar.signOut}
          aria-label={roRO.topbar.signOut}
          className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
