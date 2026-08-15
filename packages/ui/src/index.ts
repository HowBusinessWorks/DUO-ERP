/**
 * Design system-ul Damina.
 *
 * Nu e un design system complet si nu incearca sa fie. Sunt exact componentele
 * pe care se sprijina regulile de interfata din §30 — fiecare regula
 * implementata O SINGURA DATA, in componenta, nu repetata pe fiecare ecran:
 *
 *   §30.1  modala nu se inchide la click in afara  → `Dialog`
 *   §30.11 nu exista lista fara stare goala        → `EmptyState`, `Table.empty`
 *   §30.10 lacatul pe lunile inchise               → `Banner`
 *   §30.5  tab-urile fara drept LIPSESC            → `Tabs` nu are `disabled`
 *   decizia 11: banii nu trec prin float           → `Money` refuza `number`
 *
 * Un ecran care ar vrea sa incalce una din ele trebuie sa iasa din design
 * system, si atunci se vede la review.
 *
 * Token-urile de culoare, tipografie si densitate stau in `tokens.css`, importat
 * o data de aplicatie. Nu exista valoare de culoare scrisa intr-o componenta.
 */

export { cn } from './lib/cn';

export { Button } from './components/button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button';

export { Badge, CountBadge } from './components/badge';
export type { BadgeProps, BadgeTone, CountBadgeProps } from './components/badge';

export { Banner } from './components/banner';
export type { BannerProps, BannerTone } from './components/banner';

export { Card, CardBody, CardFooter, CardHeader } from './components/card';
export type { CardHeaderProps, CardProps } from './components/card';

export { Checkbox, DateInput, Input, Select, Textarea } from './components/controls';
export type {
  CheckboxProps,
  DateInputProps,
  InputProps,
  SelectOption,
  SelectProps,
  TextareaProps,
} from './components/controls';

export { Dialog } from './components/dialog';
export type { DialogProps } from './components/dialog';

export { EmptyState } from './components/empty-state';
export type { EmptyStateProps } from './components/empty-state';

export {
  Field,
  FieldRow,
  FieldSet,
  Form,
  FormError,
  useField,
  useFormContext,
} from './components/form';
export type { FieldControlProps, FieldProps, FormProps, UseFormReturn } from './components/form';

export { Money, MoneyHidden } from './components/money';
export type { MoneyProps } from './components/money';

export { ProgressBar } from './components/progress-bar';
export type { ProgressBarProps, ProgressTone } from './components/progress-bar';

export { Skeleton, TableSkeleton } from './components/skeleton';

export { Stat } from './components/stat';
export type { StatProps } from './components/stat';

export { CellMeta, CellTitle, Table } from './components/table';
export type { Column, TableProps } from './components/table';

export { Tabs } from './components/tabs';
export type { TabItem, TabsProps } from './components/tabs';

export { ToastProvider, useToast } from './components/toast';
export type { Toast, ToastTone } from './components/toast';
