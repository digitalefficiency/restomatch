import { routeAccess } from '@/lib/roleLens';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { Breadcrumbs, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { components } from '@/lib/i18n/messages/components';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { RecipeEditor } from '../recipe-editor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRecipePage({ params }: { params: Promise<{ recipeId: string }> }) {
  const { recipeId } = await params;
  if (!UUID.test(recipeId)) notFound();
  const caller = await createServerCaller();
  const { enabled } = await caller.recipes.enabled();
  if (!enabled) notFound();
  // A foreign / deleted id is NOT_FOUND from the API → 404 here.
  const detail = await caller.recipes.get({ id: recipeId }).catch(() => null);
  if (!detail) notFound();
  const [t, tc, session] = await Promise.all([getT(recipesNs), getT(components), auth()]);
  // Owner decision I3 via the IA lens: a read-only role (the bookkeeper) reads the recipe (₪ included) and edits nothing.
  const role = session?.user?.role;
  const readOnly = !!role && routeAccess(role, `/dashboard/recipes/${recipeId}`) === 'read';
  return (
    <div>
      <Breadcrumbs
        label={tc('breadcrumbs.label')}
        items={[{ label: t('breadcrumb'), href: '/dashboard/recipes' }, { label: detail.recipe.name }]}
      />
      <SectionHeader level={1} title={t('editor.titleEdit')} />
      <RecipeEditor recipeId={recipeId} readOnly={readOnly} />
    </div>
  );
}
