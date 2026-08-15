CREATE TABLE "app"."document_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_type" "app"."numbered_document_type" NOT NULL,
	"series" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_series_company_type_series_unique" UNIQUE("company_id","document_type","series"),
	CONSTRAINT "document_series_next_number_positive" CHECK ("app"."document_series"."next_number" >= 1),
	CONSTRAINT "document_series_series_not_blank" CHECK (btrim("app"."document_series"."series") <> '')
);
--> statement-breakpoint
ALTER TABLE "app"."document_series" ADD CONSTRAINT "document_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── Alocatorul de numere, fara goluri ───────────────────────────────────────
/*
 * `update ... returning` ia lock exclusiv pe randul seriei si il tine pana la
 * finalul tranzactiei. A doua tranzactie care cere un numar din aceeasi serie
 * asteapta, deci numerele ies strict consecutive.
 *
 * Daca tranzactia esueaza, incrementul se intoarce odata cu ea si numarul se
 * refoloseste — exact ce nu face un `sequence`, si exact motivul pentru care nu
 * folosim unul.
 *
 * Se cheama cat mai TARZIU in tranzactia care creeaza documentul: cat sta
 * lock-ul, nimeni altcineva nu poate numerota pe aceeasi serie.
 *
 * `security definer` face din functie singura poarta: `update` pe
 * `app.document_series` nu e acordat niciunui rol, deci `next_number` nu poate
 * fi impins altfel.
 */
create function app.allocate_document_number(
  p_company uuid,
  p_type    app.numbered_document_type,
  p_series  text
) returns text
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_number integer;
begin
  update app.document_series
     set next_number = next_number + 1
   where company_id    = p_company
     and document_type = p_type
     and series        = p_series
     and is_active
  returning next_number - 1 into v_number;

  if v_number is null then
    raise exception 'NOT_FOUND: seria "%" pentru % nu e definita sau e inactiva la firma %',
      p_series, p_type, p_company
      using errcode = 'P0001';
  end if;

  -- Separatorul si cele 6 cifre sunt o conventie, nu o cerinta fiscala. Se pot
  -- schimba cat timp tabela e goala; dupa prima factura emisa, nu.
  return format('%s-%s', p_series, lpad(v_number::text, 6, '0'));
end
$$;
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
grant select on app.document_series to app_office, app_service;
--> statement-breakpoint

-- Definirea unei serii e treaba de administrare. `update` nu se acorda nimanui:
-- `next_number` se misca doar prin alocator.
grant insert, delete on app.document_series to app_office;
--> statement-breakpoint

grant execute on function
  app.allocate_document_number(uuid, app.numbered_document_type, text)
  to app_office, app_service;
