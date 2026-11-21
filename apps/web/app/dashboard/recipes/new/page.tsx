import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { RecipeEditor } from '../recipe-editor';

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ sub?: string }> }) {
  const caller = await createServerCaller();
  const { enabled } = await caller.recipes.enabled();
  if (!enabled) notFound();
  // Owner decision I3: the bookkeeper reads recipes but never creates one.
  if ((await auth())?.user?.role === 'bookkeeper') redirect('/dashboard/recipes');
  const [{ sub }, t, tc] = await Promise.all([searchParams, getT(recipesNs), getT(components)]);
  const isSub = sub === '1';
  const title = isSub ? t('editor.titleNewSub') : t('editor.titleNew');
  return (
    <div>
      <Breadcrumbs label={tc('breadcrumbs.label')} items={[{ label: t('breadcrumb'), href: '/dashboard/recipes' }, { label: title }]} />
      <SectionHeader level={1} title={title} />
      <RecipeEditor startAsSub={isSub} />
    </div>
  );
}
