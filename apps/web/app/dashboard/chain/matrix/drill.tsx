import Link from 'next/link';

interface DrillLinkProps {
  href: string;
  children?: React.ReactNode;
  className?: string;
  title?: string;
  lang?: string;
  dir?: string;
  scroll?: boolean;
  'aria-label'?: string;
  'aria-current'?: 'true' | 'page';
  'data-testid'?: string;
}

/**
 * Local interim for W2-09b's `DrillLink` (not on main yet): the same call
 * shape — an in-app soft navigation (no reload) that keeps the scroll — so the
 * matrix swaps to the shared component by import once W2-09b lands.
 */
export function DrillLink({ scroll = false, href, children, ...rest }: DrillLinkProps) {
  return (
    <Link href={href} scroll={scroll} data-drill="" {...rest}>
      {children}
    </Link>
  );
}
